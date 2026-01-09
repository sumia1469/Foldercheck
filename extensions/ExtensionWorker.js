/**
 * ExtensionWorker - 샌드박스 내 확장 실행
 *
 * Worker Thread 내에서 실행되어 메인 프로세스와 격리
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// 확장 정보
const { extensionPath, extensionId, manifest, permissions } = workerData;

// API 호출 관리
let callId = 0;
const pendingCalls = new Map();

// 확장 인스턴스
let extensionModule = null;
let docwatchApi = null;

/**
 * DocWatch API 프록시 생성
 */
function createApiProxy() {
    const createNamespaceProxy = (namespace) => {
        return new Proxy({}, {
            get(target, method) {
                // 특수 메서드
                if (method === 'then' || method === 'catch' || method === 'finally') {
                    return undefined;
                }

                return (...args) => {
                    return new Promise((resolve, reject) => {
                        const id = callId++;
                        pendingCalls.set(id, { resolve, reject });

                        parentPort.postMessage({
                            type: 'api-call',
                            callId: id,
                            namespace,
                            method,
                            args
                        });

                        // 타임아웃 (30초)
                        setTimeout(() => {
                            if (pendingCalls.has(id)) {
                                pendingCalls.delete(id);
                                reject(new Error(`API 호출 타임아웃: ${namespace}.${method}`));
                            }
                        }, 30000);
                    });
                };
            }
        });
    };

    // IPC 이벤트 리스너
    const ipcListeners = new Map();

    // 명령어 핸들러
    const commandHandlers = new Map();

    // docwatch.* API 네임스페이스
    return {
        files: createNamespaceProxy('files'),
        meetings: createNamespaceProxy('meetings'),
        ui: createNamespaceProxy('ui'),
        llm: createNamespaceProxy('llm'),
        storage: createNamespaceProxy('storage'),

        // Commands 네임스페이스 (로컬 핸들러 지원)
        commands: {
            register: (commandId, handler, options = {}) => {
                // 로컬에 핸들러 저장
                commandHandlers.set(commandId, handler);

                // Host에 명령어 등록 알림
                return new Promise((resolve, reject) => {
                    const id = callId++;
                    pendingCalls.set(id, { resolve, reject });

                    parentPort.postMessage({
                        type: 'api-call',
                        callId: id,
                        namespace: 'commands',
                        method: 'register',
                        args: [commandId, options]
                    });

                    setTimeout(() => {
                        if (pendingCalls.has(id)) {
                            pendingCalls.delete(id);
                            reject(new Error(`명령어 등록 타임아웃: ${commandId}`));
                        }
                    }, 30000);
                });
            },
            execute: (commandId, ...args) => {
                return new Promise((resolve, reject) => {
                    const id = callId++;
                    pendingCalls.set(id, { resolve, reject });

                    parentPort.postMessage({
                        type: 'api-call',
                        callId: id,
                        namespace: 'commands',
                        method: 'execute',
                        args: [commandId, ...args]
                    });

                    setTimeout(() => {
                        if (pendingCalls.has(id)) {
                            pendingCalls.delete(id);
                            reject(new Error(`명령어 실행 타임아웃: ${commandId}`));
                        }
                    }, 30000);
                });
            },
            getAll: () => {
                return new Promise((resolve, reject) => {
                    const id = callId++;
                    pendingCalls.set(id, { resolve, reject });

                    parentPort.postMessage({
                        type: 'api-call',
                        callId: id,
                        namespace: 'commands',
                        method: 'getAll',
                        args: []
                    });

                    setTimeout(() => {
                        if (pendingCalls.has(id)) {
                            pendingCalls.delete(id);
                            reject(new Error('명령어 목록 조회 타임아웃'));
                        }
                    }, 30000);
                });
            },
            // 내부 사용: 명령어 실행 이벤트 처리
            _executeHandler: async (commandId, args) => {
                const handler = commandHandlers.get(commandId);
                if (handler) {
                    try {
                        return await handler(...(args || []));
                    } catch (e) {
                        console.error(`Command handler error (${commandId}):`, e);
                        throw e;
                    }
                } else {
                    throw new Error(`Unknown command: ${commandId}`);
                }
            }
        },

        // IPC 네임스페이스 (직접 구현)
        ipc: {
            invoke: (channel, ...args) => {
                return new Promise((resolve, reject) => {
                    const id = callId++;
                    pendingCalls.set(id, { resolve, reject });

                    parentPort.postMessage({
                        type: 'api-call',
                        callId: id,
                        namespace: 'ipc',
                        method: 'invoke',
                        args: [channel, ...args]
                    });

                    setTimeout(() => {
                        if (pendingCalls.has(id)) {
                            pendingCalls.delete(id);
                            reject(new Error(`IPC 호출 타임아웃: ${channel}`));
                        }
                    }, 30000);
                });
            },
            on: (channel, callback) => {
                // 로컬에 리스너 저장
                if (!ipcListeners.has(channel)) {
                    ipcListeners.set(channel, []);
                }
                ipcListeners.get(channel).push(callback);

                // ExtensionHost에 등록 요청
                parentPort.postMessage({
                    type: 'api-call',
                    callId: callId++,
                    namespace: 'ipc',
                    method: 'on',
                    args: [channel]
                });

                // 정리 함수 반환
                return () => {
                    const listeners = ipcListeners.get(channel);
                    if (listeners) {
                        const index = listeners.indexOf(callback);
                        if (index > -1) {
                            listeners.splice(index, 1);
                        }
                    }
                };
            },
            send: (channel, ...args) => {
                parentPort.postMessage({
                    type: 'api-call',
                    callId: callId++,
                    namespace: 'ipc',
                    method: 'send',
                    args: [channel, ...args]
                });
            },
            // 내부 사용: IPC 이벤트 발생 시 호출
            _triggerListeners: (channel, data) => {
                const listeners = ipcListeners.get(channel);
                if (listeners) {
                    for (const listener of listeners) {
                        try {
                            listener(data);
                        } catch (e) {
                            console.error(`IPC listener error (${channel}):`, e);
                        }
                    }
                }
            }
        },

        // 확장 컨텍스트
        context: {
            extensionPath,
            extensionId,
            storagePath: path.join(extensionPath, '.storage')
        },

        // 이벤트 발생
        emit: (event, data) => {
            parentPort.postMessage({
                type: 'emit-event',
                event,
                data
            });
        }
    };
}

/**
 * 안전한 console 래퍼
 */
function createSafeConsole() {
    return {
        log: (...args) => {
            parentPort.postMessage({ type: 'log', level: 'log', args: args.map(stringify) });
        },
        error: (...args) => {
            parentPort.postMessage({ type: 'log', level: 'error', args: args.map(stringify) });
        },
        warn: (...args) => {
            parentPort.postMessage({ type: 'log', level: 'warn', args: args.map(stringify) });
        },
        info: (...args) => {
            parentPort.postMessage({ type: 'log', level: 'log', args: args.map(stringify) });
        },
        debug: (...args) => {
            parentPort.postMessage({ type: 'log', level: 'log', args: args.map(stringify) });
        }
    };
}

/**
 * 값을 문자열로 변환 (순환 참조 안전)
 */
function stringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'function') return '[Function]';
    if (typeof value === 'symbol') return value.toString();
    if (value instanceof Error) return `${value.name}: ${value.message}`;

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * 안전한 require 생성 (허용된 모듈만)
 */
function createSafeRequire(basePath, perms) {
    const allowedBuiltins = ['path', 'url', 'querystring', 'util', 'events', 'stream', 'string_decoder'];

    // 권한에 따른 추가 모듈
    if (perms.includes('fs:read') || perms.includes('fs:write')) {
        allowedBuiltins.push('fs');
    }
    if (perms.includes('network')) {
        allowedBuiltins.push('http', 'https', 'net', 'dgram', 'dns');
    }
    if (perms.includes('crypto')) {
        allowedBuiltins.push('crypto');
    }

    return (modulePath) => {
        // 내장 모듈 체크
        if (allowedBuiltins.includes(modulePath)) {
            return require(modulePath);
        }

        // 상대 경로 (확장 내부 모듈)
        if (modulePath.startsWith('.') || modulePath.startsWith('/')) {
            const resolved = path.resolve(basePath, modulePath);
            // 확장 디렉토리 내부인지 확인
            if (resolved.startsWith(basePath)) {
                return require(resolved);
            }
            throw new Error(`확장 외부 모듈 접근 차단: ${modulePath}`);
        }

        // node_modules (확장 로컬)
        const localModule = path.join(basePath, 'node_modules', modulePath);
        if (fs.existsSync(localModule)) {
            return require(localModule);
        }

        // 일부 유틸리티 패키지 허용
        const safePackages = ['lodash', 'dayjs', 'moment', 'uuid'];
        if (safePackages.includes(modulePath.split('/')[0])) {
            try {
                return require(modulePath);
            } catch {
                // 무시
            }
        }

        throw new Error(`허용되지 않은 모듈: ${modulePath}`);
    };
}

/**
 * 확장 활성화
 */
async function activate() {
    try {
        // 진입점 경로
        const mainPath = path.join(extensionPath, manifest.main);

        if (!fs.existsSync(mainPath)) {
            throw new Error(`진입점을 찾을 수 없음: ${manifest.main}`);
        }

        // API 프록시 생성
        docwatchApi = createApiProxy();

        // 전역 객체 설정
        global.console = createSafeConsole();
        global.docwatch = docwatchApi;

        // 안전한 require 설정
        const safeRequire = createSafeRequire(extensionPath, permissions);

        // 모듈 로드
        // Node.js의 require 캐시를 사용하되, 경로를 정규화
        const normalizedPath = path.normalize(mainPath);
        delete require.cache[normalizedPath];

        // 모듈의 require를 오버라이드하기 위한 래퍼
        const Module = require('module');
        const originalRequire = Module.prototype.require;

        Module.prototype.require = function(id) {
            // 확장 내부에서의 require만 제한
            if (this.filename && this.filename.startsWith(extensionPath)) {
                return safeRequire(id);
            }
            return originalRequire.apply(this, arguments);
        };

        try {
            extensionModule = require(normalizedPath);
        } finally {
            // require 복원
            Module.prototype.require = originalRequire;
        }

        // activate 함수 호출
        let result = {};
        if (typeof extensionModule.activate === 'function') {
            result = await extensionModule.activate(docwatchApi) || {};
        }

        parentPort.postMessage({ type: 'activated', exports: serializeExports(result) });

    } catch (err) {
        parentPort.postMessage({ type: 'error', error: err.message, stack: err.stack });
    }
}

/**
 * 확장 비활성화
 */
async function deactivate() {
    try {
        if (extensionModule && typeof extensionModule.deactivate === 'function') {
            await extensionModule.deactivate();
        }
    } catch (err) {
        console.error('비활성화 중 에러:', err);
    }

    process.exit(0);
}

/**
 * exports를 직렬화 가능한 형태로 변환
 */
function serializeExports(exports) {
    if (!exports || typeof exports !== 'object') {
        return {};
    }

    const result = {};
    for (const key of Object.keys(exports)) {
        const value = exports[key];
        if (typeof value === 'function') {
            result[key] = '[Function]';
        } else if (typeof value === 'object') {
            result[key] = '[Object]';
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * 메시지 핸들링
 */
parentPort.on('message', async (msg) => {
    switch (msg.type) {
        case 'activate':
            await activate();
            break;

        case 'deactivate':
            await deactivate();
            break;

        case 'api-response':
            const pending = pendingCalls.get(msg.callId);
            if (pending) {
                pendingCalls.delete(msg.callId);
                if (msg.error) {
                    pending.reject(new Error(msg.error));
                } else {
                    pending.resolve(msg.result);
                }
            }
            break;

        case 'event':
            // 이벤트 전달
            if (extensionModule && typeof extensionModule.onEvent === 'function') {
                try {
                    extensionModule.onEvent(msg.event, msg.data);
                } catch (err) {
                    console.error('이벤트 핸들러 에러:', err);
                }
            }
            break;

        case 'ipc-event':
            // IPC 이벤트 전달
            if (docwatchApi && docwatchApi.ipc && docwatchApi.ipc._triggerListeners) {
                try {
                    docwatchApi.ipc._triggerListeners(msg.channel, msg.data);
                } catch (err) {
                    console.error('IPC 이벤트 핸들러 에러:', err);
                }
            }
            break;

        case 'command-execute':
            // 명령어 실행
            if (docwatchApi && docwatchApi.commands && docwatchApi.commands._executeHandler) {
                try {
                    const result = await docwatchApi.commands._executeHandler(msg.commandId, msg.args);
                    parentPort.postMessage({
                        type: 'command-result',
                        requestId: msg.requestId,
                        result
                    });
                } catch (err) {
                    parentPort.postMessage({
                        type: 'command-result',
                        requestId: msg.requestId,
                        error: err.message
                    });
                }
            }
            break;

        default:
            console.warn('알 수 없는 메시지 타입:', msg.type);
    }
});

// 예외 처리
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    parentPort.postMessage({ type: 'error', error: err.message });
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
