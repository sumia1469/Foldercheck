/**
 * P2P Messenger - 메인 프로세스 엔트리
 *
 * 이 파일은 확장이 활성화될 때 메인 프로세스에서 실행됩니다.
 * IPC 핸들러 등록, P2P 서버 초기화 등을 담당합니다.
 */

const path = require('path');
const fs = require('fs');
const { BrowserWindow, dialog, shell, Notification } = require('electron');

// 모듈 참조 (확장 폴더에서 로드)
let P2PMessenger = null;
let MessengerDB = null;
let p2pMessenger = null;
let messengerDB = null;
let messengerDBInitializing = null;

// 컨텍스트 참조
let ctx = null;
let chatWindow = null;
let registeredHandlers = [];

/**
 * 확장 활성화
 */
async function activate(context) {
    ctx = context;
    console.log('[P2P Extension Main] 활성화 시작');

    // P2P 모듈 로드
    const extensionPath = context.extensionPath;
    const p2pPath = path.join(extensionPath, 'p2p-messenger.js');
    const dbPath = path.join(extensionPath, 'messenger-db.js');

    if (fs.existsSync(p2pPath) && fs.existsSync(dbPath)) {
        delete require.cache[require.resolve(p2pPath)];
        delete require.cache[require.resolve(dbPath)];
        P2PMessenger = require(p2pPath);
        MessengerDB = require(dbPath);
        console.log('[P2P Extension Main] 모듈 로드 완료');
    } else {
        console.error('[P2P Extension Main] 모듈 파일을 찾을 수 없습니다:', p2pPath);
        throw new Error('P2P 모듈 파일을 찾을 수 없습니다');
    }

    // IPC 핸들러 등록
    registerIpcHandlers(context.ipcMain);

    console.log('[P2P Extension Main] 활성화 완료');

    return {
        getP2PMessenger: () => p2pMessenger,
        getMessengerDB: () => messengerDB
    };
}

/**
 * 확장 비활성화
 */
async function deactivate(context) {
    console.log('[P2P Extension Main] 비활성화 시작');

    // P2P 연결 정리
    if (p2pMessenger) {
        if (p2pMessenger.mode === 'host') {
            await p2pMessenger.stopHost();
        } else if (p2pMessenger.mode === 'guest') {
            await p2pMessenger.disconnect();
        }
        p2pMessenger = null;
    }

    // DB 정리
    if (messengerDB) {
        messengerDB.close();
        messengerDB = null;
    }

    // 채팅 윈도우 정리
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.close();
        chatWindow = null;
    }

    // IPC 핸들러 제거
    unregisterIpcHandlers(context.ipcMain);

    console.log('[P2P Extension Main] 비활성화 완료');
}

/**
 * IPC 핸들러 등록
 */
function registerIpcHandlers(ipcMain) {
    if (!ipcMain) {
        console.error('[P2P Extension Main] ipcMain이 제공되지 않았습니다');
        return;
    }

    const handlers = [
        // P2P 핸들러
        ['p2p:startHost', handleStartHost],
        ['p2p:stopHost', handleStopHost],
        ['p2p:connect', handleConnect],
        ['p2p:disconnect', handleDisconnect],
        ['p2p:sendMessage', handleSendMessage],
        ['p2p:sendFile', handleSendFile],
        ['p2p:getStatus', handleGetStatus],
        ['p2p:getUsers', handleGetUsers],
        ['p2p:getHistory', handleGetHistory],
        ['p2p:selectFile', handleSelectFile],
        ['p2p:openDownloads', handleOpenDownloads],
        ['p2p:openChatWindow', handleOpenChatWindow],
        ['p2p:startDirectChatWith', handleStartDirectChatWith],
        ['p2p:selectRoomInChat', handleSelectRoomInChat],

        // 클라우드 핸들러
        ['cloud:getStatus', handleCloudGetStatus],
        ['cloud:getFiles', handleCloudGetFiles],
        ['cloud:uploadFile', handleCloudUploadFile],
        ['cloud:deleteFile', handleCloudDeleteFile],
        ['cloud:selectAndUpload', handleCloudSelectAndUpload],
        ['cloud:openStorage', handleCloudOpenStorage],

        // 채팅 윈도우 컨트롤
        ['chat:minimize', () => chatWindow && chatWindow.minimize()],
        ['chat:maximize', () => {
            if (chatWindow) {
                chatWindow.isMaximized() ? chatWindow.unmaximize() : chatWindow.maximize();
            }
        }],
        ['chat:close', () => chatWindow && chatWindow.close()],
        ['chat:showNotification', handleShowNotification],
        ['chat:openFile', handleOpenFile],

        // Messenger DB 핸들러
        ['messenger:getContacts', handleGetContacts],
        ['messenger:addContact', handleAddContact],
        ['messenger:deleteContact', handleDeleteContact],
        ['messenger:updateContactStatus', handleUpdateContactStatus],
        ['messenger:getGroups', handleGetGroups],
        ['messenger:createGroup', handleCreateGroup],
        ['messenger:getGroupMembers', handleGetGroupMembers],
        ['messenger:addGroupMember', handleAddGroupMember],
        ['messenger:deleteGroup', handleDeleteGroup],
        ['messenger:getRooms', handleGetRooms],
        ['messenger:createRoom', handleCreateRoom],
        ['messenger:getRoom', handleGetRoom],
        ['messenger:getRoomParticipants', handleGetRoomParticipants],
        ['messenger:addRoomParticipant', handleAddRoomParticipant],
        ['messenger:leaveRoom', handleLeaveRoom],
        ['messenger:updateRoom', handleUpdateRoom],
        ['messenger:deleteRoom', handleDeleteRoom],
        ['messenger:saveMessage', handleSaveMessage],
        ['messenger:getRoomMessages', handleGetRoomMessages],
        ['messenger:markAsRead', handleMarkAsRead],
        ['messenger:searchMessages', handleSearchMessages],
        ['messenger:getSetting', handleGetSetting],
        ['messenger:setSetting', handleSetSetting]
    ];

    for (const [channel, handler] of handlers) {
        try {
            ipcMain.handle(channel, handler);
            registeredHandlers.push(channel);
        } catch (err) {
            // 이미 등록된 핸들러가 있으면 스킵
            console.warn(`[P2P Extension Main] IPC 핸들러 이미 등록됨: ${channel}`);
        }
    }

    console.log(`[P2P Extension Main] ${registeredHandlers.length}개 IPC 핸들러 등록 완료`);
}

/**
 * IPC 핸들러 제거
 */
function unregisterIpcHandlers(ipcMain) {
    if (!ipcMain) return;

    for (const channel of registeredHandlers) {
        try {
            ipcMain.removeHandler(channel);
        } catch (err) {
            console.warn(`[P2P Extension Main] IPC 핸들러 제거 실패: ${channel}`);
        }
    }

    registeredHandlers = [];
    console.log('[P2P Extension Main] IPC 핸들러 제거 완료');
}

/**
 * P2P 메신저 초기화
 */
function initializeP2PMessenger() {
    if (p2pMessenger) return true;

    if (!P2PMessenger) {
        console.log('[P2P Extension Main] P2PMessenger 모듈이 로드되지 않았습니다');
        return false;
    }

    p2pMessenger = new P2PMessenger();

    // 이벤트 리스너 설정
    const sendToAllWindows = (channel, data) => {
        const mainWindow = ctx.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send(channel, data);
        }
    };

    p2pMessenger.on('status', (data) => sendToAllWindows('p2p:status', data));
    p2pMessenger.on('message', (msg) => sendToAllWindows('p2p:message', msg));
    p2pMessenger.on('user_joined', (data) => sendToAllWindows('p2p:user-joined', data));
    p2pMessenger.on('user_left', (data) => sendToAllWindows('p2p:user-left', data));
    p2pMessenger.on('user_list', (users) => sendToAllWindows('p2p:user-list', users));
    p2pMessenger.on('error', (err) => sendToAllWindows('p2p:error', err));
    p2pMessenger.on('disconnected', (data) => sendToAllWindows('p2p:disconnected', data));
    p2pMessenger.on('file_start', (data) => sendToAllWindows('p2p:file-start', data));
    p2pMessenger.on('file_progress', (data) => sendToAllWindows('p2p:file-progress', data));

    p2pMessenger.on('file_received', (data) => {
        const downloadsDir = path.join(ctx.userDataDir, 'p2p-downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }
        const savePath = path.join(downloadsDir, data.filename);
        fs.writeFileSync(savePath, data.data);

        sendToAllWindows('p2p:file-received', {
            filename: data.filename,
            size: data.size,
            from: data.from,
            savedPath: savePath,
            cloudFileId: data.cloudFileId || '',
            cloudUrl: data.cloudUrl || ''
        });
    });

    p2pMessenger.on('file_sent', (data) => sendToAllWindows('p2p:file-sent', data));
    p2pMessenger.on('cloud_file_uploaded', (data) => sendToAllWindows('cloud:file-uploaded', data));
    p2pMessenger.on('cloud_file_deleted', (data) => sendToAllWindows('cloud:file-deleted', data));

    console.log('[P2P Extension Main] P2P 메신저 초기화 완료');
    return true;
}

/**
 * MessengerDB 초기화
 */
async function initializeMessengerDB() {
    if (messengerDB && messengerDB.db) return messengerDB;
    if (messengerDBInitializing) return messengerDBInitializing;

    messengerDBInitializing = (async () => {
        try {
            if (!MessengerDB) {
                console.error('[P2P Extension Main] MessengerDB 모듈이 로드되지 않았습니다');
                return null;
            }
            const db = new MessengerDB();
            const success = await db.initialize();
            if (success && db.db) {
                messengerDB = db;
                console.log('[P2P Extension Main] MessengerDB 초기화 완료');
                return messengerDB;
            }
            return null;
        } catch (err) {
            console.error('[P2P Extension Main] MessengerDB 초기화 오류:', err);
            return null;
        } finally {
            messengerDBInitializing = null;
        }
    })();

    return messengerDBInitializing;
}

/**
 * 채팅 윈도우 생성
 */
function createChatWindow() {
    if (chatWindow) {
        chatWindow.focus();
        return chatWindow;
    }

    const iconPath = process.platform === 'win32'
        ? path.join(__dirname, '..', '..', 'build', 'icons', 'icon.ico')
        : path.join(__dirname, '..', '..', 'build', 'icons', 'icon.png');

    chatWindow = new BrowserWindow({
        width: 900,
        height: 650,
        minWidth: 700,
        minHeight: 500,
        title: 'P2P 메신저',
        icon: iconPath,
        frame: false,
        backgroundColor: '#1a1a1a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload-chat.js')
        },
        show: false
    });

    chatWindow.loadFile(path.join(__dirname, 'public', 'chat-window.html'));

    chatWindow.once('ready-to-show', () => chatWindow.show());
    chatWindow.on('closed', () => { chatWindow = null; });

    return chatWindow;
}

/**
 * 모든 윈도우에 브로드캐스트
 */
function broadcastToAllWindows(channel, data) {
    const mainWindow = ctx.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(channel, data);
    }
}

// ========================================
// P2P 핸들러 구현
// ========================================

async function handleStartHost(event, port, nickname) {
    initializeP2PMessenger();
    return await p2pMessenger.startHost(port, nickname);
}

async function handleStopHost() {
    if (!p2pMessenger) return;
    return await p2pMessenger.stopHost();
}

async function handleConnect(event, host, port, nickname) {
    initializeP2PMessenger();
    return await p2pMessenger.connect(host, port, nickname);
}

async function handleDisconnect() {
    if (!p2pMessenger) return;
    return await p2pMessenger.disconnect();
}

function handleSendMessage(event, content) {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return p2pMessenger.sendMessage(content);
}

async function handleSendFile(event, filePath, cloudInfo) {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return await p2pMessenger.sendFile(filePath, cloudInfo);
}

function handleGetStatus() {
    if (!p2pMessenger) return { mode: 'offline', nickname: '', port: 9900, connectedUsers: [], userCount: 0 };
    return p2pMessenger.getStatus();
}

function handleGetUsers() {
    if (!p2pMessenger) return [];
    return p2pMessenger.getUsers();
}

function handleGetHistory() {
    if (!p2pMessenger) return [];
    return p2pMessenger.getHistory();
}

async function handleSelectFile(event) {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const parentWindow = senderWindow || chatWindow || ctx.getMainWindow();

    const result = await dialog.showOpenDialog(parentWindow, {
        properties: ['openFile'],
        title: '전송할 파일 선택'
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, filePath: null };
    }
    return { success: true, filePath: result.filePaths[0] };
}

function handleOpenDownloads() {
    const downloadsDir = path.join(ctx.userDataDir, 'p2p-downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
    shell.openPath(downloadsDir);
}

function handleOpenChatWindow() {
    createChatWindow();
    return { success: true };
}

function handleStartDirectChatWith(event, nickname) {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat:startDirectChat', nickname);
        chatWindow.focus();
        return { success: true };
    }
    return { success: false, error: '채팅 윈도우가 열려있지 않습니다' };
}

function handleSelectRoomInChat(event, roomId) {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat:selectRoom', roomId);
        chatWindow.focus();
        return { success: true };
    }
    return { success: false, error: '채팅 윈도우가 열려있지 않습니다' };
}

// ========================================
// 클라우드 핸들러 구현
// ========================================

function handleCloudGetStatus() {
    if (!p2pMessenger) return { status: 'stopped' };
    return p2pMessenger.getCloudStatus();
}

function handleCloudGetFiles() {
    if (!p2pMessenger) return [];
    return p2pMessenger.getCloudFiles();
}

async function handleCloudUploadFile(event, filePath) {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return await p2pMessenger.uploadToCloud(filePath);
}

function handleCloudDeleteFile(event, fileId) {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return p2pMessenger.deleteFromCloud(fileId);
}

async function handleCloudSelectAndUpload(event) {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const parentWindow = senderWindow || chatWindow || ctx.getMainWindow();

    const result = await dialog.showOpenDialog(parentWindow, {
        properties: ['openFile'],
        title: '클라우드에 업로드할 파일 선택'
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
    }

    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    const uploadResult = await p2pMessenger.uploadToCloud(result.filePaths[0]);
    return { success: true, ...uploadResult };
}

function handleCloudOpenStorage() {
    if (!p2pMessenger || !p2pMessenger.cloudStoragePath) {
        const cloudDir = path.join(ctx.userDataDir, 'cloud-files');
        if (!fs.existsSync(cloudDir)) {
            fs.mkdirSync(cloudDir, { recursive: true });
        }
        shell.openPath(cloudDir);
    } else {
        shell.openPath(p2pMessenger.cloudStoragePath);
    }
}

// ========================================
// 채팅 윈도우 핸들러 구현
// ========================================

function handleShowNotification(event, title, body) {
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: title,
            body: body,
            icon: path.join(__dirname, '..', '..', 'build', 'icons', 'icon.png'),
            silent: false
        });
        notification.show();
        notification.on('click', () => {
            if (chatWindow) {
                chatWindow.show();
                chatWindow.focus();
            }
        });
    }
    return { success: true };
}

function handleOpenFile(event, filePath) {
    if (filePath && fs.existsSync(filePath)) {
        shell.openPath(filePath);
        return { success: true };
    }
    return { success: false, error: '파일을 찾을 수 없습니다' };
}

// ========================================
// Messenger DB 핸들러 구현
// ========================================

async function handleGetContacts() {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllContacts();
}

async function handleAddContact(event, contact) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.addContact(contact);
    broadcastToAllWindows('messenger:contactChanged', { action: 'added', contactId: id, contact: { ...contact, id } });
    return { success: true, id };
}

async function handleDeleteContact(event, id) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteContact(id);
    broadcastToAllWindows('messenger:contactChanged', { action: 'deleted', contactId: id });
    return { success: true };
}

async function handleUpdateContactStatus(event, id, status) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.updateContactStatus(id, status);
    return { success: true };
}

async function handleGetGroups() {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllGroups();
}

async function handleCreateGroup(event, group) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.createGroup(group);
    broadcastToAllWindows('messenger:groupChanged', { action: 'created', groupId: id, group: { ...group, id } });
    return { success: true, id };
}

async function handleGetGroupMembers(event, groupId) {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getGroupMembers(groupId);
}

async function handleAddGroupMember(event, groupId, contactId, role) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.addGroupMember(groupId, contactId, role);
    return { success: true };
}

async function handleDeleteGroup(event, id) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteGroup(id);
    broadcastToAllWindows('messenger:groupChanged', { action: 'deleted', groupId: id });
    return { success: true };
}

async function handleGetRooms() {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllRooms();
}

async function handleCreateRoom(event, room) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.createRoom(room);
    broadcastToAllWindows('messenger:roomChanged', { action: 'created', roomId: id, room: { ...room, id } });
    return { success: true, id };
}

async function handleGetRoom(event, id) {
    const db = await initializeMessengerDB();
    if (!db) return null;
    return db.getRoom(id);
}

async function handleGetRoomParticipants(event, roomId) {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getRoomParticipants(roomId);
}

async function handleAddRoomParticipant(event, roomId, contactId, nickname) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.addRoomParticipant(roomId, contactId, nickname);
    return { success: true };
}

async function handleLeaveRoom(event, roomId, contactId) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.leaveRoom(roomId, contactId);
    return { success: true };
}

async function handleUpdateRoom(event, id, updates) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.updateRoom(id, updates);
    broadcastToAllWindows('messenger:roomChanged', { action: 'updated', roomId: id, updates });
    return { success: true };
}

async function handleDeleteRoom(event, id) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteRoom(id);
    broadcastToAllWindows('messenger:roomChanged', { action: 'deleted', roomId: id });
    return { success: true };
}

async function handleSaveMessage(event, message) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.saveMessage(message);
    return { success: true, id };
}

async function handleGetRoomMessages(event, roomId, limit, offset) {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getRoomMessages(roomId, limit, offset);
}

async function handleMarkAsRead(event, roomId, contactId) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.markMessagesAsRead(roomId, contactId);
    return { success: true };
}

async function handleSearchMessages(event, query, roomId) {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.searchMessages(query, roomId);
}

async function handleGetSetting(event, key, defaultValue) {
    const db = await initializeMessengerDB();
    if (!db) return defaultValue;
    return db.getSetting(key, defaultValue);
}

async function handleSetSetting(event, key, value) {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.setSetting(key, value);
    return { success: true };
}

module.exports = { activate, deactivate };
