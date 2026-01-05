/**
 * P2P 메신저 확장
 *
 * 이 확장은 메인 프로세스에서 실행되는 P2P 기능과 연동됩니다.
 * Worker Thread에서는 네트워크 모듈 사용이 제한되므로,
 * 확장은 UI 연동과 설정 관리만 담당합니다.
 */

let docwatch = null;
let settings = {
    defaultPort: 9900,
    defaultNickname: '',
    autoConnect: false,
    downloadPath: '',
    notifyOnMessage: true,
    notifyOnFile: true
};

// 현재 연결 상태
let connectionState = {
    mode: 'offline', // 'offline' | 'host' | 'guest'
    port: 9900,
    host: '',
    nickname: ''
};

/**
 * 확장 활성화
 */
async function activate(api) {
    docwatch = api;
    console.log('[P2P 메신저] 확장 활성화됨');

    // 저장된 설정 로드
    const savedSettings = await docwatch.storage.get('settings', {});
    settings = { ...settings, ...savedSettings };

    // 명령어 등록
    await registerCommands();

    // 사이드바 아이콘 등록
    await docwatch.ui.registerActivityBarItem({
        id: 'messenger',
        icon: '💬',
        title: 'P2P 메신저',
        section: 'messenger'
    });

    // 상태바 아이템 등록
    await docwatch.ui.registerStatusBarItem({
        id: 'p2pMessenger.status',
        text: '💬 P2P: 오프라인',
        tooltip: 'P2P 메신저 상태',
        position: 'right',
        command: 'p2pMessenger.showStatus'
    });

    // 시작 알림
    await docwatch.ui.showNotification('P2P 메신저가 활성화되었습니다', {
        type: 'info',
        duration: 3000
    });

    // 확장 API 반환
    return {
        getSettings: () => settings,
        updateSettings: async (newSettings) => {
            settings = { ...settings, ...newSettings };
            await docwatch.storage.set('settings', settings);
        },
        getConnectionState: () => connectionState,
        // 웹뷰 UI 정보
        getWebviewContent: () => ({
            htmlFile: 'src/webview.html',
            section: 'messenger'
        })
    };
}

/**
 * 명령어 등록
 */
async function registerCommands() {
    // 호스트 시작
    await docwatch.commands.register('startHost', {
        title: 'P2P 메신저: 호스트 시작',
        category: '메신저',
        handler: async (args) => {
            const port = args?.port || settings.defaultPort;
            const nickname = args?.nickname || settings.defaultNickname || '호스트';

            try {
                // 메인 프로세스에 호스트 시작 요청
                const result = await docwatch.ipc.invoke('p2p:startHost', port, nickname);
                connectionState = { mode: 'host', port, nickname };
                updateStatusBar();

                await docwatch.ui.showNotification(`호스트 시작됨 (포트: ${port})`, {
                    type: 'success',
                    duration: 3000
                });

                return result;
            } catch (err) {
                await docwatch.ui.showNotification(`호스트 시작 실패: ${err.message}`, {
                    type: 'error',
                    duration: 5000
                });
                throw err;
            }
        }
    });

    // 호스트 중지
    await docwatch.commands.register('stopHost', {
        title: 'P2P 메신저: 호스트 중지',
        category: '메신저',
        handler: async () => {
            try {
                await docwatch.ipc.invoke('p2p:stopHost');
                connectionState = { mode: 'offline', port: settings.defaultPort, nickname: '' };
                updateStatusBar();

                await docwatch.ui.showNotification('호스트가 중지되었습니다', {
                    type: 'info',
                    duration: 3000
                });
            } catch (err) {
                await docwatch.ui.showNotification(`호스트 중지 실패: ${err.message}`, {
                    type: 'error',
                    duration: 5000
                });
                throw err;
            }
        }
    });

    // 서버 연결 (게스트)
    await docwatch.commands.register('connect', {
        title: 'P2P 메신저: 서버 연결',
        category: '메신저',
        handler: async (args) => {
            const host = args?.host;
            const port = args?.port || settings.defaultPort;
            const nickname = args?.nickname || settings.defaultNickname || '게스트';

            if (!host) {
                throw new Error('호스트 주소가 필요합니다');
            }

            try {
                const result = await docwatch.ipc.invoke('p2p:connect', host, port, nickname);
                connectionState = { mode: 'guest', host, port, nickname };
                updateStatusBar();

                await docwatch.ui.showNotification(`${host}:${port}에 연결됨`, {
                    type: 'success',
                    duration: 3000
                });

                return result;
            } catch (err) {
                await docwatch.ui.showNotification(`연결 실패: ${err.message}`, {
                    type: 'error',
                    duration: 5000
                });
                throw err;
            }
        }
    });

    // 연결 해제
    await docwatch.commands.register('disconnect', {
        title: 'P2P 메신저: 연결 해제',
        category: '메신저',
        handler: async () => {
            try {
                await docwatch.ipc.invoke('p2p:disconnect');
                connectionState = { mode: 'offline', port: settings.defaultPort, nickname: '' };
                updateStatusBar();

                await docwatch.ui.showNotification('연결이 해제되었습니다', {
                    type: 'info',
                    duration: 3000
                });
            } catch (err) {
                await docwatch.ui.showNotification(`연결 해제 실패: ${err.message}`, {
                    type: 'error',
                    duration: 5000
                });
                throw err;
            }
        }
    });

    // 메시지 전송
    await docwatch.commands.register('sendMessage', {
        title: 'P2P 메신저: 메시지 전송',
        category: '메신저',
        handler: async (args) => {
            const content = args?.content;
            if (!content) {
                throw new Error('메시지 내용이 필요합니다');
            }

            return await docwatch.ipc.invoke('p2p:sendMessage', content);
        }
    });

    // 파일 전송
    await docwatch.commands.register('sendFile', {
        title: 'P2P 메신저: 파일 전송',
        category: '메신저',
        handler: async (args) => {
            let filePath = args?.filePath;

            // 파일 경로가 없으면 선택 다이얼로그 표시
            if (!filePath) {
                filePath = await docwatch.ipc.invoke('p2p:selectFile');
                if (!filePath) {
                    return null; // 취소됨
                }
            }

            try {
                const result = await docwatch.ipc.invoke('p2p:sendFile', filePath);
                await docwatch.ui.showNotification(`파일 전송 완료: ${result.filename}`, {
                    type: 'success',
                    duration: 3000
                });
                return result;
            } catch (err) {
                await docwatch.ui.showNotification(`파일 전송 실패: ${err.message}`, {
                    type: 'error',
                    duration: 5000
                });
                throw err;
            }
        }
    });

    // 설정 열기
    await docwatch.commands.register('openSettings', {
        title: 'P2P 메신저: 설정 열기',
        category: '메신저',
        handler: async () => {
            // 설정 페이지로 이동
            await docwatch.ui.showSection('settings', { category: 'p2p-messenger' });
        }
    });

    // 상태 표시
    await docwatch.commands.register('showStatus', {
        title: 'P2P 메신저: 상태 표시',
        category: '메신저',
        handler: async () => {
            const status = await docwatch.ipc.invoke('p2p:getStatus');
            const statusText = status.mode === 'host'
                ? `호스트 모드 (포트: ${status.port}, 접속자: ${status.userCount}명)`
                : status.mode === 'guest'
                ? `게스트 모드 (연결됨)`
                : '오프라인';

            await docwatch.ui.showNotification(`P2P 상태: ${statusText}`, {
                type: 'info',
                duration: 5000
            });
        }
    });

    // 다운로드 폴더 열기
    await docwatch.commands.register('openDownloads', {
        title: 'P2P 메신저: 다운로드 폴더 열기',
        category: '메신저',
        handler: async () => {
            await docwatch.ipc.invoke('p2p:openDownloads');
        }
    });
}

/**
 * 상태바 업데이트
 */
function updateStatusBar() {
    if (!docwatch) return;

    const statusText = connectionState.mode === 'host'
        ? `💬 호스트 (${connectionState.port})`
        : connectionState.mode === 'guest'
        ? '💬 연결됨'
        : '💬 P2P: 오프라인';

    docwatch.ui.updateStatusBarItem('p2pMessenger.status', {
        text: statusText
    });
}

/**
 * 확장 비활성화
 */
function deactivate() {
    console.log('[P2P 메신저] 확장 비활성화됨');

    // 설정 저장
    if (docwatch) {
        docwatch.storage.set('settings', settings);
    }

    // 연결 상태 정리 (메인 프로세스에서 처리)
    docwatch = null;
}

/**
 * 이벤트 핸들러
 */
function onEvent(event, data) {
    if (!docwatch) return;

    switch (event) {
        // 메인 프로세스로부터 상태 업데이트 수신
        case 'p2p:status':
            connectionState.mode = data.mode || 'offline';
            if (data.port) connectionState.port = data.port;
            updateStatusBar();
            break;

        // 메시지 수신 알림
        case 'p2p:message':
            if (settings.notifyOnMessage && data.nickname !== connectionState.nickname) {
                docwatch.ui.showNotification(`${data.nickname}: ${data.content.substring(0, 50)}`, {
                    type: 'info',
                    duration: 3000
                });
            }
            break;

        // 파일 수신 알림
        case 'p2p:file-received':
            if (settings.notifyOnFile) {
                docwatch.ui.showNotification(`파일 수신: ${data.fileName}`, {
                    type: 'success',
                    duration: 5000
                });
            }
            break;

        // 사용자 입장
        case 'p2p:user-joined':
            docwatch.ui.showNotification(`${data.nickname}님이 입장했습니다`, {
                type: 'info',
                duration: 3000
            });
            break;

        // 사용자 퇴장
        case 'p2p:user-left':
            docwatch.ui.showNotification(`${data.nickname}님이 퇴장했습니다`, {
                type: 'info',
                duration: 3000
            });
            break;

        // 연결 끊김
        case 'p2p:disconnected':
            connectionState = { mode: 'offline', port: settings.defaultPort, nickname: '' };
            updateStatusBar();
            docwatch.ui.showNotification(data.message || '연결이 끊어졌습니다', {
                type: 'warning',
                duration: 5000
            });
            break;
    }
}

/**
 * 설정 스키마 (확장 설정 UI용)
 */
const settingsSchema = {
    defaultPort: {
        type: 'number',
        title: '기본 포트',
        description: '호스트 모드에서 사용할 기본 포트 번호',
        default: 9900,
        minimum: 1024,
        maximum: 65535
    },
    defaultNickname: {
        type: 'string',
        title: '기본 닉네임',
        description: '채팅에서 사용할 기본 닉네임',
        default: ''
    },
    notifyOnMessage: {
        type: 'boolean',
        title: '메시지 알림',
        description: '새 메시지 수신 시 알림 표시',
        default: true
    },
    notifyOnFile: {
        type: 'boolean',
        title: '파일 알림',
        description: '파일 수신 시 알림 표시',
        default: true
    }
};

/**
 * 확장 정보
 */
const extensionInfo = {
    // 사이드바에 표시할 섹션 정보
    contributes: {
        section: {
            id: 'messenger',
            title: 'P2P 메신저',
            icon: '💬',
            webview: 'src/webview.html'
        }
    }
};

module.exports = {
    activate,
    deactivate,
    onEvent,
    settingsSchema,
    extensionInfo
};
