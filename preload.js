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

    // 쉘 작업 (Finder/탐색기에서 열기, 클립보드 복사)
    showItemInFolder: (path) => ipcRenderer.invoke('shell-show-item-in-folder', path),
    copyToClipboard: (text) => ipcRenderer.invoke('clipboard-write-text', text),

    // 앱 재시작
    relaunchApp: () => ipcRenderer.invoke('app-relaunch'),

    // 자동 업데이트 API
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    onUpdateStatus: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    },

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

    // 라이선스 변경 시 ExtensionManager 업데이트
    updateLicense: () => ipcRenderer.invoke('extensions:updateLicense'),

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
    sendInputBoxResult: (id, value) => ipcRenderer.send('inputbox:result', { id, value }),

    // P2P 메신저 확장 설치 (zip 파일 경로)
    installP2PExtension: (zipPath) => ipcRenderer.invoke('p2p-extension:install', zipPath),

    // P2P 메신저 확장 상태 확인
    getP2PExtensionStatus: () => ipcRenderer.invoke('p2p-extension:status'),

    // ========== 마켓플레이스 API ==========

    // 마켓플레이스 URL 설정
    setMarketplaceUrl: (url) => ipcRenderer.invoke('marketplace:setUrl', url),

    // 마켓플레이스 확장 목록 조회
    getMarketplaceExtensions: () => ipcRenderer.invoke('marketplace:getExtensions'),

    // 마켓플레이스에서 확장 설치
    installFromMarketplace: (extensionId) => ipcRenderer.invoke('marketplace:install', extensionId),

    // 업데이트 확인
    checkForUpdates: () => ipcRenderer.invoke('marketplace:checkUpdates'),

    // 모든 확장 업데이트
    updateAllExtensions: () => ipcRenderer.invoke('marketplace:updateAll'),

    // 마켓플레이스 이벤트 수신
    onMarketplaceEvent: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('marketplace-event', handler);
        return () => ipcRenderer.removeListener('marketplace-event', handler);
    }
});

// Messenger Database API (메인 패널에서도 사용)
contextBridge.exposeInMainWorld('messengerDB', {
    // 연락처 관리
    getContacts: () => ipcRenderer.invoke('messenger:getContacts'),
    addContact: (contact) => ipcRenderer.invoke('messenger:addContact', contact),
    deleteContact: (id) => ipcRenderer.invoke('messenger:deleteContact', id),
    updateContactStatus: (id, status) => ipcRenderer.invoke('messenger:updateContactStatus', id, status),

    // 그룹 관리
    getGroups: () => ipcRenderer.invoke('messenger:getGroups'),
    createGroup: (group) => ipcRenderer.invoke('messenger:createGroup', group),
    getGroupMembers: (groupId) => ipcRenderer.invoke('messenger:getGroupMembers', groupId),
    addGroupMember: (groupId, contactId, role) => ipcRenderer.invoke('messenger:addGroupMember', groupId, contactId, role),
    deleteGroup: (id) => ipcRenderer.invoke('messenger:deleteGroup', id),

    // 채팅방 관리
    getRooms: () => ipcRenderer.invoke('messenger:getRooms'),
    createRoom: (room) => ipcRenderer.invoke('messenger:createRoom', room),
    getRoom: (id) => ipcRenderer.invoke('messenger:getRoom', id),
    getRoomParticipants: (roomId) => ipcRenderer.invoke('messenger:getRoomParticipants', roomId),
    addRoomParticipant: (roomId, contactId, nickname) => ipcRenderer.invoke('messenger:addRoomParticipant', roomId, contactId, nickname),
    leaveRoom: (roomId, contactId) => ipcRenderer.invoke('messenger:leaveRoom', roomId, contactId),
    updateRoom: (id, updates) => ipcRenderer.invoke('messenger:updateRoom', id, updates),
    deleteRoom: (id) => ipcRenderer.invoke('messenger:deleteRoom', id),

    // 메시지 관리
    saveMessage: (message) => ipcRenderer.invoke('messenger:saveMessage', message),
    getRoomMessages: (roomId, limit, offset) => ipcRenderer.invoke('messenger:getRoomMessages', roomId, limit, offset),
    markAsRead: (roomId, contactId) => ipcRenderer.invoke('messenger:markAsRead', roomId, contactId),
    searchMessages: (query, roomId) => ipcRenderer.invoke('messenger:searchMessages', query, roomId),

    // 설정 관리
    getSetting: (key, defaultValue) => ipcRenderer.invoke('messenger:getSetting', key, defaultValue),
    setSetting: (key, value) => ipcRenderer.invoke('messenger:setSetting', key, value),

    // 데이터 변경 이벤트 수신
    onRoomChanged: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('messenger:roomChanged', handler);
        return () => ipcRenderer.removeListener('messenger:roomChanged', handler);
    },
    onGroupChanged: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('messenger:groupChanged', handler);
        return () => ipcRenderer.removeListener('messenger:groupChanged', handler);
    },
    onContactChanged: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('messenger:contactChanged', handler);
        return () => ipcRenderer.removeListener('messenger:contactChanged', handler);
    }
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
    sendFile: (filePath, cloudInfo) => ipcRenderer.invoke('p2p:sendFile', filePath, cloudInfo),
    openDownloads: () => ipcRenderer.invoke('p2p:openDownloads'),

    // 채팅 윈도우 열기
    openChatWindow: () => ipcRenderer.invoke('p2p:openChatWindow'),

    // 채팅 윈도우에 1:1 채팅 시작 요청
    startDirectChatWith: (nickname) => ipcRenderer.invoke('p2p:startDirectChatWith', nickname),

    // 채팅 윈도우에서 특정 채팅방 선택
    selectRoomInChat: (roomId) => ipcRenderer.invoke('p2p:selectRoomInChat', roomId),

    // 상태
    getStatus: () => ipcRenderer.invoke('p2p:getStatus'),
    getUsers: () => ipcRenderer.invoke('p2p:getUsers'),

    // 클라우드 서버 API
    getCloudStatus: () => ipcRenderer.invoke('cloud:getStatus'),
    getCloudFiles: () => ipcRenderer.invoke('cloud:getFiles'),
    uploadToCloud: (filePath) => ipcRenderer.invoke('cloud:uploadFile', filePath),
    deleteFromCloud: (fileId) => ipcRenderer.invoke('cloud:deleteFile', fileId),
    selectAndUploadToCloud: () => ipcRenderer.invoke('cloud:selectAndUpload'),
    openCloudStorage: () => ipcRenderer.invoke('cloud:openStorage'),

    // 클라우드 이벤트
    onCloudFileUploaded: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('cloud:file-uploaded', handler);
        return () => ipcRenderer.removeListener('cloud:file-uploaded', handler);
    },
    onCloudFileDeleted: (callback) => {
        const handler = (event, data) => callback(data);
        ipcRenderer.on('cloud:file-deleted', handler);
        return () => ipcRenderer.removeListener('cloud:file-deleted', handler);
    },

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
