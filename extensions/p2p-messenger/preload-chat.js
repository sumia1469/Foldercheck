// preload-chat.js - P2P 채팅 윈도우 전용 preload 스크립트
const { contextBridge, ipcRenderer } = require('electron');

// 채팅 윈도우 API
contextBridge.exposeInMainWorld('chatAPI', {
    // 윈도우 컨트롤
    minimize: () => ipcRenderer.invoke('chat:minimize'),
    maximize: () => ipcRenderer.invoke('chat:maximize'),
    close: () => ipcRenderer.invoke('chat:close'),

    // 알림
    showNotification: (title, body) => ipcRenderer.invoke('chat:showNotification', title, body),

    // 파일 열기
    openFile: (filePath) => ipcRenderer.invoke('chat:openFile', filePath),
    openDownloads: () => ipcRenderer.invoke('p2p:openDownloads'),

    // 1:1 채팅 시작 이벤트 수신
    onStartDirectChat: (callback) => {
        const handler = (event, nickname) => callback(nickname);
        ipcRenderer.on('chat:startDirectChat', handler);
        return () => ipcRenderer.removeListener('chat:startDirectChat', handler);
    },

    // 채팅방 선택 이벤트 수신
    onSelectRoom: (callback) => {
        const handler = (event, roomId) => callback(roomId);
        ipcRenderer.on('chat:selectRoom', handler);
        return () => ipcRenderer.removeListener('chat:selectRoom', handler);
    },

    // Electron 환경 확인
    isElectron: true
});

// 메신저 데이터베이스 API (확장 전용 - 채팅 윈도우에서 사용)
contextBridge.exposeInMainWorld('messengerDB', {
    // 연락처 관리
    getContacts: () => ipcRenderer.invoke('messenger:getContacts').catch(() => []),
    addContact: (contact) => ipcRenderer.invoke('messenger:addContact', contact).catch(() => null),
    deleteContact: (id) => ipcRenderer.invoke('messenger:deleteContact', id).catch(() => false),
    updateContactStatus: (id, status) => ipcRenderer.invoke('messenger:updateContactStatus', id, status).catch(() => false),

    // 그룹 관리
    getGroups: () => ipcRenderer.invoke('messenger:getGroups').catch(() => []),
    createGroup: (group) => ipcRenderer.invoke('messenger:createGroup', group).catch(() => null),
    getGroupMembers: (groupId) => ipcRenderer.invoke('messenger:getGroupMembers', groupId).catch(() => []),
    addGroupMember: (groupId, contactId, role) => ipcRenderer.invoke('messenger:addGroupMember', groupId, contactId, role).catch(() => false),
    deleteGroup: (id) => ipcRenderer.invoke('messenger:deleteGroup', id).catch(() => false),

    // 채팅방 관리
    getRooms: () => ipcRenderer.invoke('messenger:getRooms').catch(() => []),
    createRoom: (room) => ipcRenderer.invoke('messenger:createRoom', room).catch(() => null),
    getRoom: (id) => ipcRenderer.invoke('messenger:getRoom', id).catch(() => null),
    getRoomParticipants: (roomId) => ipcRenderer.invoke('messenger:getRoomParticipants', roomId).catch(() => []),
    addRoomParticipant: (roomId, contactId, nickname) => ipcRenderer.invoke('messenger:addRoomParticipant', roomId, contactId, nickname).catch(() => false),
    leaveRoom: (roomId, contactId) => ipcRenderer.invoke('messenger:leaveRoom', roomId, contactId).catch(() => false),
    updateRoom: (id, updates) => ipcRenderer.invoke('messenger:updateRoom', id, updates).catch(() => false),
    deleteRoom: (id) => ipcRenderer.invoke('messenger:deleteRoom', id).catch(() => false),

    // 메시지 관리
    saveMessage: (message) => ipcRenderer.invoke('messenger:saveMessage', message).catch(() => null),
    getRoomMessages: (roomId, limit, offset) => ipcRenderer.invoke('messenger:getRoomMessages', roomId, limit, offset).catch(() => []),
    markAsRead: (roomId, contactId) => ipcRenderer.invoke('messenger:markAsRead', roomId, contactId).catch(() => false),
    searchMessages: (query, roomId) => ipcRenderer.invoke('messenger:searchMessages', query, roomId).catch(() => []),

    // 설정 관리
    getSetting: (key, defaultValue) => ipcRenderer.invoke('messenger:getSetting', key, defaultValue).catch(() => defaultValue),
    setSetting: (key, value) => ipcRenderer.invoke('messenger:setSetting', key, value).catch(() => false),

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

// P2P Messenger API (확장 전용 - 채팅 윈도우에서 사용)
contextBridge.exposeInMainWorld('p2pAPI', {
    // 호스트 모드
    startHost: (port, nickname) => ipcRenderer.invoke('p2p:startHost', port, nickname).catch(() => ({ success: false })),
    stopHost: () => ipcRenderer.invoke('p2p:stopHost').catch(() => ({ success: false })),

    // 게스트 모드
    connect: (host, port, nickname) => ipcRenderer.invoke('p2p:connect', host, port, nickname).catch(() => ({ success: false })),
    disconnect: () => ipcRenderer.invoke('p2p:disconnect').catch(() => ({ success: false })),

    // 메시징
    sendMessage: (content) => ipcRenderer.invoke('p2p:sendMessage', content).catch(() => ({ success: false })),
    getHistory: () => ipcRenderer.invoke('p2p:getHistory').catch(() => []),

    // 파일 전송
    selectFile: () => ipcRenderer.invoke('p2p:selectFile').catch(() => null),
    sendFile: (filePath, cloudInfo) => ipcRenderer.invoke('p2p:sendFile', filePath, cloudInfo).catch(() => ({ success: false })),
    openDownloads: () => ipcRenderer.invoke('p2p:openDownloads').catch(() => null),

    // 상태
    getStatus: () => ipcRenderer.invoke('p2p:getStatus').catch(() => ({ mode: 'offline', users: [] })),
    getUsers: () => ipcRenderer.invoke('p2p:getUsers').catch(() => []),

    // 클라우드 서버 API
    getCloudStatus: () => ipcRenderer.invoke('cloud:getStatus').catch(() => ({ status: 'stopped', port: null })),
    getCloudFiles: () => ipcRenderer.invoke('cloud:getFiles').catch(() => []),
    uploadToCloud: (filePath) => ipcRenderer.invoke('cloud:uploadFile', filePath).catch(() => ({ success: false })),
    deleteFromCloud: (fileId) => ipcRenderer.invoke('cloud:deleteFile', fileId).catch(() => ({ success: false })),
    selectAndUploadToCloud: () => ipcRenderer.invoke('cloud:selectAndUpload').catch(() => null),
    openCloudStorage: () => ipcRenderer.invoke('cloud:openStorage').catch(() => null),

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
