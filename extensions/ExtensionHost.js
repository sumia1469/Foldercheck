/**
 * ExtensionHost - 확장 격리 실행 환경
 *
 * 보안:
 * - Worker Thread 기반 격리
 * - 메시지 패싱 통신
 * - 제한된 API만 노출
 */

const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class ExtensionHost extends EventEmitter {
    constructor(apiProvider) {
        super();
        this.apiProvider = apiProvider;
        this.workers = new Map(); // extensionId -> { worker, pendingCalls }
        this.callId = 0;
    }

    /**
     * 확장 로드 및 실행
     */
    async loadExtension(extension) {
        return new Promise((resolve, reject) => {
            const workerPath = path.join(__dirname, 'ExtensionWorker.js');

            let worker;
            try {
                worker = new Worker(workerPath, {
                    workerData: {
                        extensionPath: extension.path,
                        extensionId: extension.id,
                        manifest: extension.manifest,
                        permissions: extension.manifest.permissions || []
                    }
                });
            } catch (err) {
                reject(new Error(`Worker 생성 실패: ${err.message}`));
                return;
            }

            const workerInfo = {
                worker,
                pendingCalls: new Map(),
                activationResolve: resolve,
                activationReject: reject
            };

            // 메시지 핸들링
            worker.on('message', (msg) => this.handleWorkerMessage(extension.id, msg, workerInfo));

            worker.on('error', (err) => {
                console.error(`[ExtensionHost] Worker 에러 (${extension.id}):`, err);
                this.workers.delete(extension.id);
                if (workerInfo.activationReject) {
                    workerInfo.activationReject(err);
                    workerInfo.activationReject = null;
                }
            });

            worker.on('exit', (code) => {
                console.log(`[ExtensionHost] Worker 종료 (${extension.id}): code=${code}`);
                this.workers.delete(extension.id);
                if (code !== 0 && workerInfo.activationReject) {
                    workerInfo.activationReject(new Error(`Worker 비정상 종료: ${code}`));
                    workerInfo.activationReject = null;
                }
            });

            this.workers.set(extension.id, workerInfo);

            // 활성화 요청
            worker.postMessage({ type: 'activate' });

            // 타임아웃 설정 (30초)
            setTimeout(() => {
                if (workerInfo.activationReject) {
                    workerInfo.activationReject(new Error('확장 활성화 타임아웃'));
                    workerInfo.activationReject = null;
                    this.unloadExtension(extension);
                }
            }, 30000);
        });
    }

    /**
     * Worker 메시지 핸들링
     */
    handleWorkerMessage(extensionId, msg, workerInfo) {
        switch (msg.type) {
            case 'activated':
                console.log(`[ExtensionHost] 확장 활성화 완료: ${extensionId}`);
                if (workerInfo.activationResolve) {
                    workerInfo.activationResolve(msg.exports || {});
                    workerInfo.activationResolve = null;
                    workerInfo.activationReject = null;
                }
                break;

            case 'error':
                console.error(`[ExtensionHost] 확장 에러 (${extensionId}):`, msg.error);
                if (workerInfo.activationReject) {
                    workerInfo.activationReject(new Error(msg.error));
                    workerInfo.activationResolve = null;
                    workerInfo.activationReject = null;
                }
                break;

            case 'api-call':
                // 확장에서 API 호출 요청
                this.handleApiCall(extensionId, msg);
                break;

            case 'log':
                // 확장에서 로그 출력
                const prefix = `[Extension:${extensionId}]`;
                switch (msg.level) {
                    case 'error':
                        console.error(prefix, ...msg.args);
                        break;
                    case 'warn':
                        console.warn(prefix, ...msg.args);
                        break;
                    default:
                        console.log(prefix, ...msg.args);
                }
                break;

            case 'emit-event':
                // 확장에서 이벤트 발생
                this.emit('extension-event', {
                    extensionId,
                    event: msg.event,
                    data: msg.data
                });
                break;

            default:
                console.warn(`[ExtensionHost] 알 수 없는 메시지 타입: ${msg.type}`);
        }
    }

    /**
     * API 호출 핸들링 (확장 -> Host)
     */
    async handleApiCall(extensionId, msg) {
        const workerInfo = this.workers.get(extensionId);
        if (!workerInfo) return;

        try {
            const result = await this.apiProvider.call(
                extensionId,
                msg.namespace,
                msg.method,
                msg.args || []
            );

            workerInfo.worker.postMessage({
                type: 'api-response',
                callId: msg.callId,
                result
            });
        } catch (err) {
            workerInfo.worker.postMessage({
                type: 'api-response',
                callId: msg.callId,
                error: err.message
            });
        }
    }

    /**
     * 확장에 메시지 전송
     */
    postToExtension(extensionId, message) {
        const workerInfo = this.workers.get(extensionId);
        if (workerInfo && workerInfo.worker) {
            workerInfo.worker.postMessage(message);
        }
    }

    /**
     * 확장 언로드
     */
    async unloadExtension(extension) {
        const workerInfo = this.workers.get(extension.id);
        if (!workerInfo) return;

        try {
            // 비활성화 요청
            workerInfo.worker.postMessage({ type: 'deactivate' });

            // graceful shutdown 대기 (최대 5초)
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve();
                }, 5000);

                workerInfo.worker.once('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            // 아직 살아있으면 강제 종료
            if (this.workers.has(extension.id)) {
                workerInfo.worker.terminate();
            }
        } catch (err) {
            console.error(`[ExtensionHost] 확장 언로드 에러 (${extension.id}):`, err);
            workerInfo.worker.terminate();
        }

        this.workers.delete(extension.id);
    }

    /**
     * 모든 확장에 이벤트 브로드캐스트
     */
    broadcast(event, data) {
        for (const [id, workerInfo] of this.workers) {
            try {
                workerInfo.worker.postMessage({ type: 'event', event, data });
            } catch (err) {
                console.error(`[ExtensionHost] 브로드캐스트 실패 (${id}):`, err);
            }
        }
    }

    /**
     * 특정 이벤트 발생 (활성화 트리거용)
     */
    triggerEvent(event, data) {
        this.broadcast(event, data);
        this.emit('trigger-activation', event);
    }

    /**
     * 활성 확장 수
     */
    getActiveCount() {
        return this.workers.size;
    }

    /**
     * 모든 워커 종료
     */
    async shutdown() {
        console.log('[ExtensionHost] 모든 워커 종료 중...');

        const promises = [];
        for (const [id, workerInfo] of this.workers) {
            promises.push(
                this.unloadExtension({ id }).catch(err => {
                    console.error(`[ExtensionHost] 종료 중 에러 (${id}):`, err);
                })
            );
        }

        await Promise.all(promises);
        console.log('[ExtensionHost] 모든 워커 종료 완료');
    }
}

module.exports = ExtensionHost;
