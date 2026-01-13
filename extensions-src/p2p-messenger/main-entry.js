/**
 * P2P 메신저 확장 - 메인 프로세스 엔트리
 *
 * 이 파일은 확장 활성화 시 메인 프로세스에서 직접 로드되어
 * IPC 핸들러를 등록합니다.
 */

const { ipcMain, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

let p2pMessenger = null;
let mainWindow = null;
let extensionPath = null;
let chatWindow = null;
let messengerDB = null;
let messengerDBReady = false;

/**
 * 확장 활성화
 */
function activate(context) {
    mainWindow = context.mainWindow;
    extensionPath = context.extensionPath;

    console.log('[P2P Extension] 활성화 시작, mainWindow:', !!mainWindow);

    // P2PMessenger 인스턴스 생성
    const P2PMessenger = require(path.join(extensionPath, 'p2p-messenger.js'));
    p2pMessenger = new P2PMessenger();

    // MessengerDB 인스턴스 생성
    try {
        const MessengerDB = require(path.join(extensionPath, 'messenger-db.js'));
        messengerDB = new MessengerDB();
        messengerDB.initialize().then(() => {
            // db가 실제로 초기화되었는지 확인
            if (messengerDB && messengerDB.db) {
                messengerDBReady = true;
                console.log('[P2P Extension] MessengerDB 초기화 완료');
            } else {
                console.error('[P2P Extension] MessengerDB db 객체가 null입니다');
                messengerDBReady = false;
            }
        }).catch(err => {
            console.error('[P2P Extension] MessengerDB 초기화 실패:', err);
            messengerDBReady = false;
        });
    } catch (err) {
        console.error('[P2P Extension] MessengerDB 로드 실패:', err);
        messengerDB = null;
        messengerDBReady = false;
    }

    console.log('[P2P Extension] 활성화됨, p2pMessenger:', !!p2pMessenger);

    // 이벤트 리스너 설정
    setupEventListeners();

    // IPC 핸들러 등록
    registerIpcHandlers();

    return {
        messenger: p2pMessenger
    };
}

/**
 * 확장 비활성화
 */
function deactivate() {
    console.log('[P2P Extension] 비활성화됨');

    // IPC 핸들러 제거
    unregisterIpcHandlers();

    // 연결 정리
    if (p2pMessenger) {
        if (p2pMessenger.mode === 'host') {
            p2pMessenger.stopHost();
        } else if (p2pMessenger.mode === 'guest') {
            p2pMessenger.disconnect();
        }
        p2pMessenger = null;
    }
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    if (!p2pMessenger) return;

    console.log('[P2P Extension] 이벤트 리스너 설정 시작');

    p2pMessenger.on('status', (status) => {
        console.log('[P2P Extension] status 이벤트 발생:', status);
        broadcast('p2p:status', status);
    });

    p2pMessenger.on('message', (msg) => {
        broadcast('p2p:message', msg);
    });

    p2pMessenger.on('user_joined', (user) => {
        broadcast('p2p:user-joined', user);
    });

    p2pMessenger.on('user_left', (user) => {
        broadcast('p2p:user-left', user);
    });

    p2pMessenger.on('user_list', (users) => {
        broadcast('p2p:user-list', users);
    });

    p2pMessenger.on('file_received', (file) => {
        broadcast('p2p:file-received', file);
    });

    p2pMessenger.on('file_sent', (file) => {
        broadcast('p2p:file-sent', file);
    });

    p2pMessenger.on('cloud_file_uploaded', (file) => {
        broadcast('cloud:file-uploaded', file);
    });
}

/**
 * 모든 윈도우로 이벤트 브로드캐스트 (mainWindow + chatWindow)
 */
function broadcast(channel, data) {
    console.log('[P2P Extension] broadcast 호출:', channel, 'mainWindow:', !!mainWindow, 'chatWindow:', !!chatWindow);

    // 메인 윈도우로 전송
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
        console.log('[P2P Extension] mainWindow로 이벤트 전송 완료:', channel);
    }

    // 채팅 윈도우로 전송
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(channel, data);
        console.log('[P2P Extension] chatWindow로 이벤트 전송 완료:', channel);
    }

    if ((!mainWindow || mainWindow.isDestroyed()) && (!chatWindow || chatWindow.isDestroyed())) {
        console.warn('[P2P Extension] 전송 가능한 윈도우 없음:', channel);
    }
}

/**
 * IPC 핸들러 등록
 */
function registerIpcHandlers() {
    // 호스트 시작
    ipcMain.handle('p2p:startHost', async (event, port, nickname) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.startHost(port, nickname);
    });

    // 호스트 중지
    ipcMain.handle('p2p:stopHost', async () => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.stopHost();
    });

    // 서버 연결 (게스트)
    ipcMain.handle('p2p:connect', async (event, host, port, nickname) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.connect(host, port, nickname);
    });

    // 연결 해제
    ipcMain.handle('p2p:disconnect', async () => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.disconnect();
    });

    // 상태 조회
    ipcMain.handle('p2p:getStatus', () => {
        if (!p2pMessenger) return { mode: 'offline', users: [] };
        return p2pMessenger.getStatus();
    });

    // 사용자 목록 조회
    ipcMain.handle('p2p:getUsers', () => {
        if (!p2pMessenger) return [];
        return p2pMessenger.getUsers();
    });

    // 메시지 전송
    ipcMain.handle('p2p:sendMessage', async (event, content, options = {}) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return p2pMessenger.sendMessage(content, options);
    });

    // 파일 전송
    ipcMain.handle('p2p:sendFile', async (event, filePath, targetUserId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.sendFile(filePath, targetUserId);
    });

    // 파일 선택 다이얼로그
    ipcMain.handle('p2p:selectFile', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: '모든 파일', extensions: ['*'] }
            ]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }
        return { success: true, filePath: result.filePaths[0] };
    });

    // 채팅 윈도우 열기
    ipcMain.handle('p2p:openChatWindow', async () => {
        const chatHtmlPath = path.join(extensionPath, 'public', 'chat-window.html');
        const preloadPath = path.join(extensionPath, 'preload-chat.js');

        if (!fs.existsSync(chatHtmlPath)) {
            throw new Error('채팅 윈도우 파일을 찾을 수 없습니다');
        }

        // 아이콘 경로 설정
        let iconPath = null;
        const possibleIconPaths = [
            path.join(__dirname, '..', '..', 'build', 'icons', 'icon.ico'),  // 개발 환경
            path.join(process.resourcesPath, 'build', 'icons', 'icon.ico'),  // 빌드된 앱
            path.join(__dirname, '..', '..', 'build', 'icon.ico'),
            path.join(process.resourcesPath, 'icon.ico')
        ];
        for (const iconCandidate of possibleIconPaths) {
            if (fs.existsSync(iconCandidate)) {
                iconPath = iconCandidate;
                break;
            }
        }

        chatWindow = new BrowserWindow({
            width: 900,
            height: 700,
            minWidth: 600,
            minHeight: 400,
            frame: false,
            autoHideMenuBar: true,
            icon: iconPath,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath
            },
            title: 'P2P 메신저'
        });

        // 메뉴바 완전히 제거
        chatWindow.setMenu(null);

        chatWindow.loadFile(chatHtmlPath);

        // 디버깅용: 개발자 도구 항상 허용
        // const isPackaged = require('electron').app.isPackaged;
        // if (isPackaged) {
        //     chatWindow.webContents.on('before-input-event', (event, input) => {
        //         // F12, Ctrl+Shift+I, Cmd+Option+I 차단
        //         if (input.key === 'F12' ||
        //             (input.control && input.shift && input.key.toLowerCase() === 'i') ||
        //             (input.meta && input.alt && input.key.toLowerCase() === 'i')) {
        //             event.preventDefault();
        //         }
        //     });
        // }

        chatWindow.on('closed', () => {
            chatWindow = null;
        });

        return { success: true };
    });

    // 채팅 윈도우 컨트롤
    ipcMain.handle('chat:minimize', () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.minimize();
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('chat:maximize', () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
            if (chatWindow.isMaximized()) {
                chatWindow.unmaximize();
            } else {
                chatWindow.maximize();
            }
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('chat:close', () => {
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.close();
            return { success: true };
        }
        return { success: false };
    });

    // 알림
    ipcMain.handle('chat:showNotification', async (event, title, body) => {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
            new Notification({ title, body }).show();
            return { success: true };
        }
        return { success: false };
    });

    // 이미지 파일을 Base64로 읽기 (file:// 프로토콜 대신 사용)
    ipcMain.handle('chat:readImageAsBase64', async (event, filePath) => {
        try {
            if (!filePath || !fs.existsSync(filePath)) {
                return { success: false, error: '파일을 찾을 수 없습니다' };
            }

            // 파일 확장자로 MIME 타입 결정
            const ext = path.extname(filePath).toLowerCase().slice(1);
            const mimeTypes = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'bmp': 'image/bmp',
                'webp': 'image/webp',
                'svg': 'image/svg+xml'
            };
            const mimeType = mimeTypes[ext] || 'image/png';

            // 파일을 Base64로 읽기
            const imageBuffer = fs.readFileSync(filePath);
            const base64 = imageBuffer.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64}`;

            return { success: true, dataUrl };
        } catch (err) {
            console.error('[P2P Extension] 이미지 읽기 실패:', err);
            return { success: false, error: err.message };
        }
    });

    // 파일 열기
    ipcMain.handle('chat:openFile', async (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            await shell.openPath(filePath);
            return { success: true };
        }
        return { success: false, error: '파일을 찾을 수 없습니다' };
    });

    // 파일 폴더 열기
    ipcMain.handle('chat:openFileFolder', async (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return { success: true };
        }
        return { success: false, error: '파일을 찾을 수 없습니다' };
    });

    // 파일 다운로드 후 열기
    ipcMain.handle('chat:downloadAndOpenFile', async (event, url, filename) => {
        try {
            const downloadsPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');
            const filePath = path.join(downloadsPath, filename);

            const protocol = url.startsWith('https') ? https : http;

            await new Promise((resolve, reject) => {
                const file = fs.createWriteStream(filePath);
                protocol.get(url, (response) => {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close(resolve);
                    });
                }).on('error', (err) => {
                    fs.unlink(filePath, () => {});
                    reject(err);
                });
            });

            await shell.openPath(filePath);
            return { success: true, path: filePath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // 다운로드 폴더 열기
    ipcMain.handle('p2p:openDownloads', async () => {
        const downloadsPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');
        await shell.openPath(downloadsPath);
        return { success: true };
    });

    // 클라우드 파일 목록
    ipcMain.handle('p2p:getCloudFiles', () => {
        if (!p2pMessenger) return [];
        return p2pMessenger.getCloudFiles();
    });

    // 클라우드 파일 업로드
    ipcMain.handle('p2p:uploadToCloud', async (event, filePath) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.uploadToCloud(filePath);
    });

    // 클라우드 파일 삭제
    ipcMain.handle('p2p:deleteFromCloud', async (event, fileId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return p2pMessenger.deleteFromCloud(fileId);
    });

    // 클라우드 상태 조회
    ipcMain.handle('cloud:getStatus', () => {
        if (!p2pMessenger) return { connected: false };
        return p2pMessenger.getCloudStatus ? p2pMessenger.getCloudStatus() : { connected: false };
    });

    // 클라우드 파일 목록 (cloud: 네임스페이스)
    ipcMain.handle('cloud:getFiles', () => {
        if (!p2pMessenger) return [];
        return p2pMessenger.getCloudFiles();
    });

    // 클라우드 파일 업로드 (cloud: 네임스페이스)
    ipcMain.handle('cloud:uploadFile', async (event, filePath) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.uploadToCloud(filePath);
    });

    // 클라우드 파일 삭제 (cloud: 네임스페이스)
    ipcMain.handle('cloud:deleteFile', async (event, fileId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return p2pMessenger.deleteFromCloud(fileId);
    });

    // 파일 선택 후 클라우드 업로드
    ipcMain.handle('cloud:selectAndUpload', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: '모든 파일', extensions: ['*'] }
            ]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, canceled: true };
        }
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.uploadToCloud(result.filePaths[0]);
    });

    // 클라우드 저장소 폴더 열기
    ipcMain.handle('cloud:openStorage', async () => {
        if (!p2pMessenger || !p2pMessenger.cloudStoragePath) {
            // 기본 경로 사용
            const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'P2PCloud');
            await shell.openPath(defaultPath);
            return { success: true, path: defaultPath };
        }
        await shell.openPath(p2pMessenger.cloudStoragePath);
        return { success: true, path: p2pMessenger.cloudStoragePath };
    });

    // ============================================
    // MessengerDB 관련 IPC 핸들러
    // ============================================

    // 연락처 관리
    ipcMain.handle('messenger:getContacts', () => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getAllContacts();
    });

    ipcMain.handle('messenger:addContact', (event, contact) => {
        if (!messengerDB || !messengerDBReady) return null;
        return messengerDB.addContact(contact);
    });

    ipcMain.handle('messenger:deleteContact', (event, id) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.deleteContact(id);
        return true;
    });

    ipcMain.handle('messenger:updateContactStatus', (event, id, status) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.updateContactStatus(id, status);
        return true;
    });

    // 그룹 관리
    ipcMain.handle('messenger:getGroups', () => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getAllGroups();
    });

    ipcMain.handle('messenger:createGroup', (event, group) => {
        if (!messengerDB || !messengerDBReady) return null;
        return messengerDB.createGroup(group);
    });

    ipcMain.handle('messenger:getGroupMembers', (event, groupId) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getGroupMembers(groupId);
    });

    ipcMain.handle('messenger:addGroupMember', (event, groupId, contactId, role) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.addGroupMember(groupId, contactId, role);
        return true;
    });

    ipcMain.handle('messenger:deleteGroup', (event, id) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.deleteGroup(id);
        return true;
    });

    // 채팅방 관리
    ipcMain.handle('messenger:getRooms', () => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getAllRooms();
    });

    ipcMain.handle('messenger:createRoom', (event, room) => {
        if (!messengerDB || !messengerDBReady) return null;
        return messengerDB.createRoom(room);
    });

    ipcMain.handle('messenger:getRoom', (event, id) => {
        if (!messengerDB || !messengerDBReady) return null;
        return messengerDB.getRoom(id);
    });

    ipcMain.handle('messenger:getRoomParticipants', (event, roomId) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getRoomParticipants(roomId);
    });

    ipcMain.handle('messenger:addRoomParticipant', (event, roomId, contactId, nickname) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.addRoomParticipant(roomId, contactId, nickname);
        return true;
    });

    ipcMain.handle('messenger:leaveRoom', (event, roomId, contactId) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.leaveRoom(roomId, contactId);
        return true;
    });

    ipcMain.handle('messenger:updateRoom', (event, id, updates) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.updateRoom(id, updates);
        return true;
    });

    ipcMain.handle('messenger:deleteRoom', (event, id) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.deleteRoom(id);
        return true;
    });

    // 메시지 관리
    ipcMain.handle('messenger:saveMessage', (event, message) => {
        if (!messengerDB || !messengerDBReady) return null;
        return messengerDB.saveMessage(message);
    });

    ipcMain.handle('messenger:getRoomMessages', (event, roomId, limit, offset) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getRoomMessages(roomId, limit, offset);
    });

    ipcMain.handle('messenger:markAsRead', (event, roomId, contactId) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.markMessagesAsRead(roomId, contactId);
        return true;
    });

    ipcMain.handle('messenger:searchMessages', (event, query, roomId) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.searchMessages(query, roomId);
    });

    // 설정 관리
    ipcMain.handle('messenger:getSetting', (event, key, defaultValue) => {
        if (!messengerDB || !messengerDBReady) return defaultValue;
        return messengerDB.getSetting(key, defaultValue);
    });

    ipcMain.handle('messenger:setSetting', (event, key, value) => {
        if (!messengerDB || !messengerDBReady) return false;
        messengerDB.setSetting(key, value);
        return true;
    });

    // 리액션 관리
    ipcMain.handle('messenger:toggleReaction', (event, messageId, userId, userNickname, reaction) => {
        if (!messengerDB || !messengerDBReady) return null;
        const result = messengerDB.toggleReaction(messageId, userId, userNickname, reaction);
        // 다른 윈도우에 리액션 변경 알림
        broadcast('messenger:reactionChanged', { messageId, ...result });
        return result;
    });

    ipcMain.handle('messenger:getMessageReactions', (event, messageId) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getMessageReactions(messageId);
    });

    ipcMain.handle('messenger:getUserReactions', (event, messageId, userId) => {
        if (!messengerDB || !messengerDBReady) return [];
        return messengerDB.getUserReactions(messageId, userId);
    });

    console.log('[P2P Extension] IPC 핸들러 등록 완료');
}

/**
 * IPC 핸들러 제거
 */
function unregisterIpcHandlers() {
    const channels = [
        'p2p:startHost', 'p2p:stopHost', 'p2p:connect', 'p2p:disconnect',
        'p2p:getStatus', 'p2p:getUsers', 'p2p:sendMessage', 'p2p:sendFile',
        'p2p:selectFile', 'p2p:openChatWindow', 'p2p:getCloudFiles', 'p2p:uploadToCloud', 'p2p:deleteFromCloud',
        'p2p:openDownloads',
        'chat:minimize', 'chat:maximize', 'chat:close', 'chat:showNotification', 'chat:readImageAsBase64',
        'chat:openFile', 'chat:openFileFolder', 'chat:downloadAndOpenFile',
        'cloud:getStatus', 'cloud:getFiles', 'cloud:uploadFile', 'cloud:deleteFile', 'cloud:selectAndUpload', 'cloud:openStorage',
        'messenger:getContacts', 'messenger:addContact', 'messenger:deleteContact', 'messenger:updateContactStatus',
        'messenger:getGroups', 'messenger:createGroup', 'messenger:getGroupMembers', 'messenger:addGroupMember', 'messenger:deleteGroup',
        'messenger:getRooms', 'messenger:createRoom', 'messenger:getRoom', 'messenger:getRoomParticipants',
        'messenger:addRoomParticipant', 'messenger:leaveRoom', 'messenger:updateRoom', 'messenger:deleteRoom',
        'messenger:saveMessage', 'messenger:getRoomMessages', 'messenger:markAsRead', 'messenger:searchMessages',
        'messenger:getSetting', 'messenger:setSetting',
        'messenger:toggleReaction', 'messenger:getMessageReactions', 'messenger:getUserReactions'
    ];

    channels.forEach(channel => {
        try {
            ipcMain.removeHandler(channel);
        } catch (e) {
            // 핸들러가 없을 수 있음
        }
    });

    console.log('[P2P Extension] IPC 핸들러 제거 완료');
}

module.exports = {
    activate,
    deactivate
};
