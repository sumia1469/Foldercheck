/**
 * P2P 메신저 확장 - 메인 프로세스 엔트리
 *
 * 이 파일은 확장 활성화 시 메인 프로세스에서 직접 로드되어
 * IPC 핸들러를 등록합니다.
 */

const { ipcMain, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let p2pMessenger = null;
let messengerDB = null;
let mainWindow = null;
let extensionPath = null;
let chatWindow = null; // 채팅 윈도우 참조

/**
 * 확장 활성화
 */
async function activate(context) {
    mainWindow = context.mainWindow;
    extensionPath = context.extensionPath;

    console.log('[P2P Extension] 활성화 시작, mainWindow:', !!mainWindow);

    // P2PMessenger 인스턴스 생성
    const P2PMessenger = require(path.join(extensionPath, 'p2p-messenger.js'));
    p2pMessenger = new P2PMessenger();

    // MessengerDB 인스턴스 생성 및 초기화 (완료될 때까지 대기)
    const MessengerDB = require(path.join(extensionPath, 'messenger-db.js'));
    messengerDB = new MessengerDB();
    try {
        await messengerDB.initialize();
        console.log('[P2P Extension] MessengerDB 초기화 완료');
    } catch (err) {
        console.error('[P2P Extension] MessengerDB 초기화 실패:', err);
        // 초기화 실패해도 기본 P2P 기능은 사용 가능
    }

    console.log('[P2P Extension] 활성화됨, p2pMessenger:', !!p2pMessenger, 'messengerDB:', !!messengerDB?.db);

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

    // DB 정리
    if (messengerDB) {
        messengerDB.close();
        messengerDB = null;
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

    p2pMessenger.on('userJoined', (user) => {
        broadcast('p2p:user-joined', user);
    });

    p2pMessenger.on('userLeft', (user) => {
        broadcast('p2p:user-left', user);
    });

    p2pMessenger.on('file_received', (file) => {
        broadcast('p2p:file-received', file);
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
        console.log('[P2P Extension] mainWindow로 이벤트 전송:', channel);
    }

    // 채팅 윈도우로도 전송
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(channel, data);
        console.log('[P2P Extension] chatWindow로 이벤트 전송:', channel);
    }

    if (!mainWindow && !chatWindow) {
        console.warn('[P2P Extension] 윈도우 없음, 이벤트 전송 실패:', channel);
    }
}

/**
 * IPC 핸들러 등록
 */
function registerIpcHandlers() {
    console.log('[P2P Extension] IPC 핸들러 등록 시작...');

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
    ipcMain.handle('p2p:sendMessage', async (event, message) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return p2pMessenger.sendMessage(message);
    });

    // 파일 선택 다이얼로그 (파일 정보 포함 반환)
    ipcMain.handle('p2p:selectFile', async () => {
        const { dialog } = require('electron');
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [
                { name: '모든 파일', extensions: ['*'] }
            ]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        const filePath = result.filePaths[0];

        // 파일 정보 가져오기
        try {
            const stats = fs.statSync(filePath);
            const filename = path.basename(filePath);
            return {
                path: filePath,
                name: filename,
                size: stats.size
            };
        } catch (err) {
            console.error('파일 정보 조회 실패:', err);
            // 에러 시에도 경로는 반환 (하위 호환성)
            return {
                path: filePath,
                name: path.basename(filePath),
                size: 0
            };
        }
    });

    // 파일 전송
    ipcMain.handle('p2p:sendFile', async (event, filePath, targetUserId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.sendFile(filePath, targetUserId);
    });

    // 채팅 윈도우 열기
    ipcMain.handle('p2p:openChatWindow', async () => {
        // 이미 열린 채팅 윈도우가 있으면 포커스
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.focus();
            return { success: true };
        }

        const chatHtmlPath = path.join(extensionPath, 'public', 'chat-window.html');
        const preloadPath = path.join(extensionPath, 'preload-chat.js');

        if (!fs.existsSync(chatHtmlPath)) {
            throw new Error('채팅 윈도우 파일을 찾을 수 없습니다');
        }

        chatWindow = new BrowserWindow({
            width: 900,
            height: 700,
            minWidth: 600,
            minHeight: 400,
            frame: false,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath,
                devTools: true
            },
            title: 'P2P 메신저'
        });

        // 메뉴바 완전히 제거
        chatWindow.setMenu(null);

        // 윈도우 닫힐 때 참조 정리
        chatWindow.on('closed', () => {
            chatWindow = null;
        });

        // 개발 모드에서 개발자 도구 열기 (Cmd+Option+I 또는 F12로도 열 수 있음)
        chatWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'F12' || (input.meta && input.alt && input.key === 'i')) {
                chatWindow.webContents.toggleDevTools();
            }
        });

        chatWindow.loadFile(chatHtmlPath);
        console.log('[P2P Extension] 채팅 윈도우 생성됨');
        return { success: true };
    });

    // 채팅 윈도우 컨트롤
    ipcMain.handle('chat:minimize', () => {
        console.log('[P2P Extension] chat:minimize 호출됨, chatWindow:', !!chatWindow);
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.minimize();
            return { success: true };
        }
        return { success: false, error: 'chatWindow가 없습니다' };
    });

    ipcMain.handle('chat:maximize', () => {
        console.log('[P2P Extension] chat:maximize 호출됨, chatWindow:', !!chatWindow);
        if (chatWindow && !chatWindow.isDestroyed()) {
            if (chatWindow.isMaximized()) {
                chatWindow.unmaximize();
            } else {
                chatWindow.maximize();
            }
            return { success: true };
        }
        return { success: false, error: 'chatWindow가 없습니다' };
    });

    ipcMain.handle('chat:close', () => {
        console.log('[P2P Extension] chat:close 호출됨, chatWindow:', !!chatWindow);
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.close();
            return { success: true };
        }
        return { success: false, error: 'chatWindow가 없습니다' };
    });

    // 파일 열기
    ipcMain.handle('chat:openFile', async (event, filePath) => {
        const { shell } = require('electron');
        if (filePath && fs.existsSync(filePath)) {
            await shell.openPath(filePath);
            return { success: true };
        }
        return { success: false, error: '파일을 찾을 수 없습니다' };
    });

    // 파일이 있는 폴더 열기
    ipcMain.handle('chat:openFileFolder', async (event, filePath) => {
        const { shell } = require('electron');
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
            return { success: true };
        }
        return { success: false, error: '파일을 찾을 수 없습니다' };
    });

    // 파일 다운로드 후 열기
    ipcMain.handle('chat:downloadAndOpenFile', async (event, url, filename) => {
        const { shell, app, net } = require('electron');
        const downloadsPath = app.getPath('downloads');
        const savePath = path.join(downloadsPath, filename);

        try {
            // 파일 다운로드
            const response = await new Promise((resolve, reject) => {
                const request = net.request(url);
                let data = [];

                request.on('response', (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }

                    response.on('data', (chunk) => {
                        data.push(chunk);
                    });

                    response.on('end', () => {
                        resolve(Buffer.concat(data));
                    });

                    response.on('error', reject);
                });

                request.on('error', reject);
                request.end();
            });

            // 파일 저장
            fs.writeFileSync(savePath, response);

            // 파일 열기
            await shell.openPath(savePath);

            return { success: true, filePath: savePath };
        } catch (err) {
            console.error('[P2P Extension] 다운로드 및 열기 실패:', err);
            return { success: false, error: err.message };
        }
    });

    // 알림 표시
    ipcMain.handle('chat:showNotification', async (event, title, body) => {
        const { Notification } = require('electron');
        if (Notification.isSupported()) {
            new Notification({ title, body }).show();
            return { success: true };
        }
        return { success: false };
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

    // ============================================
    // Messenger DB IPC 핸들러
    // ============================================

    // 연락처 관리
    ipcMain.handle('messenger:getContacts', () => {
        if (!messengerDB) return [];
        return messengerDB.getAllContacts();
    });

    ipcMain.handle('messenger:addContact', (event, contact) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.addContact(contact);
    });

    ipcMain.handle('messenger:deleteContact', (event, id) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.deleteContact(id);
    });

    ipcMain.handle('messenger:updateContactStatus', (event, id, status) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.updateContactStatus(id, status);
    });

    // 그룹 관리
    ipcMain.handle('messenger:getGroups', () => {
        if (!messengerDB) return [];
        return messengerDB.getAllGroups();
    });

    ipcMain.handle('messenger:createGroup', (event, group) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.createGroup(group);
    });

    ipcMain.handle('messenger:getGroupMembers', (event, groupId) => {
        if (!messengerDB) return [];
        return messengerDB.getGroupMembers(groupId);
    });

    ipcMain.handle('messenger:addGroupMember', (event, groupId, contactId, role) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.addGroupMember(groupId, contactId, role);
    });

    ipcMain.handle('messenger:deleteGroup', (event, id) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.deleteGroup(id);
    });

    // 채팅방 관리
    ipcMain.handle('messenger:getRooms', () => {
        if (!messengerDB) return [];
        return messengerDB.getAllRooms();
    });

    ipcMain.handle('messenger:createRoom', (event, room) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.createRoom(room);
    });

    ipcMain.handle('messenger:getRoom', (event, id) => {
        if (!messengerDB) return null;
        return messengerDB.getRoom(id);
    });

    ipcMain.handle('messenger:getRoomParticipants', (event, roomId) => {
        if (!messengerDB) return [];
        return messengerDB.getRoomParticipants(roomId);
    });

    ipcMain.handle('messenger:addRoomParticipant', (event, roomId, contactId, nickname) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.addRoomParticipant(roomId, contactId, nickname);
    });

    ipcMain.handle('messenger:leaveRoom', (event, roomId, contactId) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.leaveRoom(roomId, contactId);
    });

    ipcMain.handle('messenger:updateRoom', (event, id, updates) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.updateRoom(id, updates);
    });

    ipcMain.handle('messenger:deleteRoom', (event, id) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.deleteRoom(id);
    });

    // 메시지 관리
    ipcMain.handle('messenger:saveMessage', (event, message) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.saveMessage(message);
    });

    ipcMain.handle('messenger:getRoomMessages', (event, roomId, limit, offset) => {
        if (!messengerDB) return [];
        return messengerDB.getRoomMessages(roomId, limit, offset);
    });

    ipcMain.handle('messenger:markAsRead', (event, roomId, contactId) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.markMessagesAsRead(roomId, contactId);
    });

    ipcMain.handle('messenger:searchMessages', (event, query, roomId) => {
        if (!messengerDB) return [];
        return messengerDB.searchMessages(query, roomId);
    });

    // 설정 관리
    ipcMain.handle('messenger:getSetting', (event, key, defaultValue) => {
        if (!messengerDB) return defaultValue;
        return messengerDB.getSetting(key, defaultValue);
    });

    ipcMain.handle('messenger:setSetting', (event, key, value) => {
        if (!messengerDB) throw new Error('MessengerDB가 초기화되지 않았습니다');
        return messengerDB.setSetting(key, value);
    });

    // ============================================
    // Cloud IPC 핸들러
    // ============================================

    ipcMain.handle('cloud:getStatus', () => {
        if (!p2pMessenger) return { status: 'stopped', port: null };
        return p2pMessenger.getCloudStatus ? p2pMessenger.getCloudStatus() : { status: 'stopped', port: null };
    });

    ipcMain.handle('cloud:getFiles', () => {
        if (!p2pMessenger) return [];
        return p2pMessenger.getCloudFiles ? p2pMessenger.getCloudFiles() : [];
    });

    ipcMain.handle('cloud:uploadFile', async (event, filePath) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        if (!p2pMessenger.uploadToCloud) throw new Error('클라우드 업로드 기능을 사용할 수 없습니다');
        return await p2pMessenger.uploadToCloud(filePath);
    });

    ipcMain.handle('cloud:deleteFile', (event, fileId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        if (!p2pMessenger.deleteFromCloud) throw new Error('클라우드 삭제 기능을 사용할 수 없습니다');
        return p2pMessenger.deleteFromCloud(fileId);
    });

    console.log('[P2P Extension] IPC 핸들러 등록 완료 (P2P, Messenger, Cloud)');
}

/**
 * IPC 핸들러 제거
 */
function unregisterIpcHandlers() {
    const channels = [
        // P2P 핸들러
        'p2p:startHost', 'p2p:stopHost', 'p2p:connect', 'p2p:disconnect',
        'p2p:getStatus', 'p2p:getUsers', 'p2p:sendMessage', 'p2p:selectFile', 'p2p:sendFile',
        'p2p:openChatWindow', 'p2p:getCloudFiles', 'p2p:uploadToCloud', 'p2p:deleteFromCloud',
        // 채팅 윈도우 컨트롤 핸들러
        'chat:minimize', 'chat:maximize', 'chat:close', 'chat:openFile', 'chat:openFileFolder', 'chat:downloadAndOpenFile', 'chat:showNotification',
        // Messenger DB 핸들러
        'messenger:getContacts', 'messenger:addContact', 'messenger:deleteContact', 'messenger:updateContactStatus',
        'messenger:getGroups', 'messenger:createGroup', 'messenger:getGroupMembers', 'messenger:addGroupMember', 'messenger:deleteGroup',
        'messenger:getRooms', 'messenger:createRoom', 'messenger:getRoom', 'messenger:getRoomParticipants',
        'messenger:addRoomParticipant', 'messenger:leaveRoom', 'messenger:updateRoom', 'messenger:deleteRoom',
        'messenger:saveMessage', 'messenger:getRoomMessages', 'messenger:markAsRead', 'messenger:searchMessages',
        'messenger:getSetting', 'messenger:setSetting',
        // Cloud 핸들러
        'cloud:getStatus', 'cloud:getFiles', 'cloud:uploadFile', 'cloud:deleteFile'
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
