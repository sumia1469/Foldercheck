// preload.js - 렌더러와 메인 프로세스 간 안전한 통신
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 폴더 선택 다이얼로그
    selectFolder: () => ipcRenderer.invoke('select-folder'),

    // 파일 선택 다이얼로그
    selectFile: () => ipcRenderer.invoke('select-file'),

    // 여러 항목 선택 (폴더 또는 파일)
    selectMultiple: (type) => ipcRenderer.invoke('select-multiple', type),

    // 윈도우 컨트롤
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),

    // Electron 환경 확인
    isElectron: true
});

// Extension API
contextBridge.exposeInMainWorld('extensionAPI', {
    // 확장 목록 조회
    getExtensions: () => ipcRenderer.invoke('extensions:getAll'),

    // 확장 정보 조회
    getExtension: (id) => ipcRenderer.invoke('extensions:get', id),

    // 확장 활성화
    activate: (id) => ipcRenderer.invoke('extensions:activate', id),

    // 확장 비활성화
    deactivate: (id) => ipcRenderer.invoke('extensions:deactivate', id),

    // 확장 활성화/비활성화 토글
    toggle: (id, enabled) => ipcRenderer.invoke('extensions:toggle', id, enabled),

    // 확장 설치
    install: (source) => ipcRenderer.invoke('extensions:install', source),

    // 확장 제거
    uninstall: (id) => ipcRenderer.invoke('extensions:uninstall', id),

    // 확장 설정 조회
    getSettings: (id) => ipcRenderer.invoke('extensions:getSettings', id),

    // 확장 설정 저장
    setSettings: (id, settings) => ipcRenderer.invoke('extensions:setSettings', id, settings),

    // 명령어 목록 조회
    getCommands: () => ipcRenderer.invoke('extensions:getCommands'),

    // 명령어 실행
    executeCommand: (commandId, ...args) => ipcRenderer.invoke('extensions:executeCommand', commandId, ...args),

    // 확장 이벤트 수신
    onEvent: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('extension-api', handler);
        return () => ipcRenderer.removeListener('extension-api', handler);
    },

    // 확장 상태 변경 이벤트 수신
    onExtensionStateChange: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('extension-state-change', handler);
        return () => ipcRenderer.removeListener('extension-state-change', handler);
    },

    // QuickPick 결과 전송
    sendQuickPickResult: (id, selected) => ipcRenderer.send('quickpick:result', { id, selected }),

    // InputBox 결과 전송
    sendInputBoxResult: (id, value) => ipcRenderer.send('inputbox:result', { id, value })
});

// P2P Messenger API
contextBridge.exposeInMainWorld('p2pAPI', {
    // 호스트 모드
    startHost: (port, nickname) => ipcRenderer.invoke('p2p:startHost', port, nickname),
    stopHost: () => ipcRenderer.invoke('p2p:stopHost'),

    // 게스트 모드
    connect: (host, port, nickname) => ipcRenderer.invoke('p2p:connect', host, port, nickname),
    disconnect: () => ipcRenderer.invoke('p2p:disconnect'),

    // 메시징
    sendMessage: (content) => ipcRenderer.invoke('p2p:sendMessage', content),
    getHistory: () => ipcRenderer.invoke('p2p:getHistory'),

    // 파일 전송
    selectFile: () => ipcRenderer.invoke('p2p:selectFile'),
    sendFile: (filePath) => ipcRenderer.invoke('p2p:sendFile', filePath),
    openDownloads: () => ipcRenderer.invoke('p2p:openDownloads'),

    // 상태
    getStatus: () => ipcRenderer.invoke('p2p:getStatus'),
    getUsers: () => ipcRenderer.invoke('p2p:getUsers'),

    // 이벤트 리스너
    onStatus: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:status', handler);
        return () => ipcRenderer.removeListener('p2p:status', handler);
    },
    onMessage: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:message', handler);
        return () => ipcRenderer.removeListener('p2p:message', handler);
    },
    onUserJoined: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:user-joined', handler);
        return () => ipcRenderer.removeListener('p2p:user-joined', handler);
    },
    onUserLeft: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:user-left', handler);
        return () => ipcRenderer.removeListener('p2p:user-left', handler);
    },
    onUserList: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:user-list', handler);
        return () => ipcRenderer.removeListener('p2p:user-list', handler);
    },
    onError: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:error', handler);
        return () => ipcRenderer.removeListener('p2p:error', handler);
    },
    onDisconnected: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:disconnected', handler);
        return () => ipcRenderer.removeListener('p2p:disconnected', handler);
    },
    onFileStart: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:file-start', handler);
        return () => ipcRenderer.removeListener('p2p:file-start', handler);
    },
    onFileProgress: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:file-progress', handler);
        return () => ipcRenderer.removeListener('p2p:file-progress', handler);
    },
    onFileReceived: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:file-received', handler);
        return () => ipcRenderer.removeListener('p2p:file-received', handler);
    },
    onFileSent: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('p2p:file-sent', handler);
        return () => ipcRenderer.removeListener('p2p:file-sent', handler);
    }
});
