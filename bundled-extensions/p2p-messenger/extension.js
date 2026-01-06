/**
 * P2P 메신저 확장
 *
 * 폐쇄망 환경에서 TCP 기반 호스트/게스트 방식으로 동작하는 메신저
 */

let docwatch;
let statusBarItem;
let currentMode = 'offline';
let cleanupFunctions = [];

/**
 * 확장 활성화
 */
async function activate(context) {
    docwatch = context;
    console.log('[P2P Extension] 활성화됨');

    // 명령어 등록
    registerCommands();

    // 상태바 업데이트
    updateStatusBar();

    // IPC 이벤트 리스너 등록
    registerEventListeners();

    return {
        getStatus: () => currentMode
    };
}

/**
 * 확장 비활성화
 */
async function deactivate() {
    console.log('[P2P Extension] 비활성화됨');

    // 정리 함수 실행
    for (const cleanup of cleanupFunctions) {
        try {
            cleanup();
        } catch (e) {
            console.error('[P2P Extension] 정리 중 오류:', e);
        }
    }
    cleanupFunctions = [];
}

/**
 * 명령어 등록
 */
function registerCommands() {
    // 호스트 시작
    docwatch.commands.register('p2p-messenger.startHost', async () => {
        try {
            const config = await docwatch.storage.get('config') || {};
            const port = config.defaultPort || 9900;
            const nickname = config.nickname || 'Host';

            await docwatch.ipc.invoke('p2p:startHost', port, nickname);
            currentMode = 'host';
            updateStatusBar();

            docwatch.ui.showNotification({
                type: 'info',
                message: `호스트 시작됨 (포트: ${port})`
            });
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `호스트 시작 실패: ${err.message}`
            });
        }
    });

    // 호스트 중지
    docwatch.commands.register('p2p-messenger.stopHost', async () => {
        try {
            await docwatch.ipc.invoke('p2p:stopHost');
            currentMode = 'offline';
            updateStatusBar();

            docwatch.ui.showNotification({
                type: 'info',
                message: '호스트가 중지되었습니다.'
            });
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `호스트 중지 실패: ${err.message}`
            });
        }
    });

    // 서버 연결
    docwatch.commands.register('p2p-messenger.connect', async () => {
        try {
            // 연결 정보 입력 받기
            const host = await docwatch.ui.showInputBox({
                prompt: '호스트 IP 주소를 입력하세요',
                placeholder: '192.168.1.100',
                value: ''
            });

            if (!host) return;

            const portStr = await docwatch.ui.showInputBox({
                prompt: '포트 번호를 입력하세요',
                placeholder: '9900',
                value: '9900'
            });

            if (!portStr) return;

            const config = await docwatch.storage.get('config') || {};
            const nickname = config.nickname || 'Guest';

            await docwatch.ipc.invoke('p2p:connect', host, parseInt(portStr), nickname);
            currentMode = 'guest';
            updateStatusBar();

            docwatch.ui.showNotification({
                type: 'info',
                message: `${host}:${portStr}에 연결되었습니다.`
            });
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `연결 실패: ${err.message}`
            });
        }
    });

    // 연결 해제
    docwatch.commands.register('p2p-messenger.disconnect', async () => {
        try {
            await docwatch.ipc.invoke('p2p:disconnect');
            currentMode = 'offline';
            updateStatusBar();

            docwatch.ui.showNotification({
                type: 'info',
                message: '연결이 해제되었습니다.'
            });
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `연결 해제 실패: ${err.message}`
            });
        }
    });

    // 메시지 전송
    docwatch.commands.register('p2p-messenger.sendMessage', async (content) => {
        if (currentMode === 'offline') {
            docwatch.ui.showNotification({
                type: 'warning',
                message: '먼저 연결해주세요.'
            });
            return;
        }

        try {
            if (!content) {
                content = await docwatch.ui.showInputBox({
                    prompt: '메시지를 입력하세요',
                    placeholder: '메시지...'
                });
            }

            if (!content) return;

            await docwatch.ipc.invoke('p2p:sendMessage', content);
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `메시지 전송 실패: ${err.message}`
            });
        }
    });

    // 파일 전송
    docwatch.commands.register('p2p-messenger.sendFile', async () => {
        if (currentMode === 'offline') {
            docwatch.ui.showNotification({
                type: 'warning',
                message: '먼저 연결해주세요.'
            });
            return;
        }

        try {
            const result = await docwatch.ipc.invoke('p2p:selectFile');
            if (!result || !result.success || !result.filePath) return;

            await docwatch.ipc.invoke('p2p:sendFile', result.filePath);

            docwatch.ui.showNotification({
                type: 'info',
                message: '파일 전송을 시작했습니다.'
            });
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `파일 전송 실패: ${err.message}`
            });
        }
    });

    // 다운로드 폴더 열기
    docwatch.commands.register('p2p-messenger.openDownloads', async () => {
        try {
            await docwatch.ipc.invoke('p2p:openDownloads');
        } catch (err) {
            docwatch.ui.showNotification({
                type: 'error',
                message: `폴더 열기 실패: ${err.message}`
            });
        }
    });
}

/**
 * 상태바 업데이트
 */
function updateStatusBar() {
    const statusText = {
        'offline': 'P2P: 오프라인',
        'host': 'P2P: 호스트',
        'guest': 'P2P: 연결됨'
    };

    const statusIcon = {
        'offline': '$(circle-slash)',
        'host': '$(server)',
        'guest': '$(plug)'
    };

    // 상태바 아이템 업데이트 (UI API 사용)
    if (docwatch && docwatch.ui) {
        docwatch.ui.updateStatusBarItem('p2p-status', {
            text: `${statusIcon[currentMode]} ${statusText[currentMode]}`,
            tooltip: `P2P 메신저 - ${statusText[currentMode]}`
        });
    }
}

/**
 * IPC 이벤트 리스너 등록
 */
function registerEventListeners() {
    // 상태 변경
    const cleanupStatus = docwatch.ipc.on('p2p:status', (data) => {
        currentMode = data.mode;
        updateStatusBar();
    });
    cleanupFunctions.push(cleanupStatus);

    // 메시지 수신
    const cleanupMessage = docwatch.ipc.on('p2p:message', (msg) => {
        // 메시지 이벤트 발행 (UI에서 처리)
        docwatch.emit('p2p:message', msg);
    });
    cleanupFunctions.push(cleanupMessage);

    // 사용자 입장
    const cleanupUserJoined = docwatch.ipc.on('p2p:user-joined', (data) => {
        docwatch.emit('p2p:user-joined', data);
    });
    cleanupFunctions.push(cleanupUserJoined);

    // 사용자 퇴장
    const cleanupUserLeft = docwatch.ipc.on('p2p:user-left', (data) => {
        docwatch.emit('p2p:user-left', data);
    });
    cleanupFunctions.push(cleanupUserLeft);

    // 에러
    const cleanupError = docwatch.ipc.on('p2p:error', (data) => {
        docwatch.ui.showNotification({
            type: 'error',
            message: `P2P 오류: ${data.message}`
        });
    });
    cleanupFunctions.push(cleanupError);

    // 연결 해제됨
    const cleanupDisconnected = docwatch.ipc.on('p2p:disconnected', (data) => {
        currentMode = 'offline';
        updateStatusBar();

        docwatch.ui.showNotification({
            type: 'warning',
            message: data.message || '연결이 종료되었습니다.'
        });
    });
    cleanupFunctions.push(cleanupDisconnected);

    // 파일 수신 완료
    const cleanupFileReceived = docwatch.ipc.on('p2p:file-received', (data) => {
        docwatch.ui.showNotification({
            type: 'info',
            message: `파일 수신: ${data.filename} (${formatFileSize(data.size)})`
        });
        docwatch.emit('p2p:file-received', data);
    });
    cleanupFunctions.push(cleanupFileReceived);

    // 파일 전송 완료
    const cleanupFileSent = docwatch.ipc.on('p2p:file-sent', (data) => {
        docwatch.ui.showNotification({
            type: 'info',
            message: `파일 전송 완료: ${data.filename}`
        });
    });
    cleanupFunctions.push(cleanupFileSent);
}

/**
 * 파일 크기 포맷
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

module.exports = { activate, deactivate };
