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

/**
 * 확장 활성화
 */
async function activate(api) {
    docwatch = api;
    console.log('P2P 메신저 확장 활성화됨');

    // 저장된 설정 로드
    const savedSettings = await docwatch.storage.get('settings', {});
    settings = { ...settings, ...savedSettings };

    // 명령어 등록
    await docwatch.commands.register('startHost', {
        title: 'P2P 메신저: 호스트 시작',
        category: '메신저'
    });

    await docwatch.commands.register('stopHost', {
        title: 'P2P 메신저: 호스트 중지',
        category: '메신저'
    });

    await docwatch.commands.register('connect', {
        title: 'P2P 메신저: 서버 연결',
        category: '메신저'
    });

    await docwatch.commands.register('disconnect', {
        title: 'P2P 메신저: 연결 해제',
        category: '메신저'
    });

    await docwatch.commands.register('sendFile', {
        title: 'P2P 메신저: 파일 전송',
        category: '메신저'
    });

    await docwatch.commands.register('openSettings', {
        title: 'P2P 메신저: 설정 열기',
        category: '메신저'
    });

    // 상태바 아이템
    await docwatch.ui.registerStatusBarItem({
        text: '💬 P2P: 오프라인',
        tooltip: 'P2P 메신저 상태',
        position: 'right'
    });

    // 시작 알림
    await docwatch.ui.showNotification('P2P 메신저가 활성화되었습니다', {
        type: 'info',
        duration: 3000
    });

    return {
        getSettings: () => settings,
        updateSettings: async (newSettings) => {
            settings = { ...settings, ...newSettings };
            await docwatch.storage.set('settings', settings);
        }
    };
}

/**
 * 확장 비활성화
 */
function deactivate() {
    console.log('P2P 메신저 확장 비활성화됨');
    if (docwatch) {
        docwatch.storage.set('settings', settings);
    }
    docwatch = null;
}

/**
 * 이벤트 핸들러
 */
function onEvent(event, data) {
    if (!docwatch) return;

    // 메인 프로세스로부터 상태 업데이트 수신
    if (event === 'p2p:status') {
        updateStatusBar(data);
    }

    // 메시지 수신 알림
    if (event === 'p2p:message' && settings.notifyOnMessage) {
        docwatch.ui.showNotification(`${data.sender}: ${data.content.substring(0, 50)}`, {
            type: 'info',
            duration: 3000
        });
    }

    // 파일 수신 알림
    if (event === 'p2p:file-received' && settings.notifyOnFile) {
        docwatch.ui.showNotification(`파일 수신: ${data.fileName}`, {
            type: 'success',
            duration: 5000
        });
    }
}

/**
 * 상태바 업데이트
 */
function updateStatusBar(data) {
    const statusText = data.mode === 'host' ? `💬 호스트 (${data.port})` :
                      data.mode === 'guest' ? '💬 연결됨' :
                      '💬 P2P: 오프라인';

    // 상태바 업데이트는 메인 프로세스에서 처리
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

module.exports = {
    activate,
    deactivate,
    onEvent,
    settingsSchema
};
