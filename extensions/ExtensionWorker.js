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

    // docwatch.* API 네임스페이스
    return {
        files: createNamespaceProxy('files'),
        meetings: createNamespaceProxy('meetings'),
        ui: createNamespaceProxy('ui'),
        commands: createNamespaceProxy('commands'),
        llm: createNamespaceProxy('llm'),
        storage: createNamespaceProxy('storage'),

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
        allowedBuiltins.push('http', 'https');
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
