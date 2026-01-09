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
let mainWindow = null;
let extensionPath = null;

/**
 * 확장 활성화
 */
function activate(context) {
    mainWindow = context.mainWindow;
    extensionPath = context.extensionPath;

    // P2PMessenger 인스턴스 생성
    const P2PMessenger = require(path.join(extensionPath, 'p2p-messenger.js'));
    p2pMessenger = new P2PMessenger();

    console.log('[P2P Extension] 활성화됨');

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

    p2pMessenger.on('statusChanged', (status) => {
        broadcast('p2p:statusChanged', status);
    });

    p2pMessenger.on('message', (msg) => {
        broadcast('p2p:message', msg);
    });

    p2pMessenger.on('userJoined', (user) => {
        broadcast('p2p:userJoined', user);
    });

    p2pMessenger.on('userLeft', (user) => {
        broadcast('p2p:userLeft', user);
    });

    p2pMessenger.on('file_received', (file) => {
        broadcast('p2p:fileReceived', file);
    });

    p2pMessenger.on('cloud_file_uploaded', (file) => {
        broadcast('p2p:cloudFileUploaded', file);
    });
}

/**
 * 메인 윈도우로 이벤트 브로드캐스트
 */
function broadcast(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
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
    ipcMain.handle('p2p:sendMessage', async (event, message) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return p2pMessenger.sendMessage(message);
    });

    // 파일 전송
    ipcMain.handle('p2p:sendFile', async (event, filePath, targetUserId) => {
        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
        return await p2pMessenger.sendFile(filePath, targetUserId);
    });

    // 채팅 윈도우 열기
    ipcMain.handle('p2p:openChatWindow', async () => {
        const chatHtmlPath = path.join(extensionPath, 'public', 'chat-window.html');
        const preloadPath = path.join(extensionPath, 'preload-chat.js');

        if (!fs.existsSync(chatHtmlPath)) {
            throw new Error('채팅 윈도우 파일을 찾을 수 없습니다');
        }

        const chatWindow = new BrowserWindow({
            width: 900,
            height: 700,
            minWidth: 600,
            minHeight: 400,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: preloadPath
            },
            title: 'P2P 메신저'
        });

        chatWindow.loadFile(chatHtmlPath);
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

    console.log('[P2P Extension] IPC 핸들러 등록 완료');
}

/**
 * IPC 핸들러 제거
 */
function unregisterIpcHandlers() {
    const channels = [
        'p2p:startHost', 'p2p:stopHost', 'p2p:connect', 'p2p:disconnect',
        'p2p:getStatus', 'p2p:getUsers', 'p2p:sendMessage', 'p2p:sendFile',
        'p2p:openChatWindow', 'p2p:getCloudFiles', 'p2p:uploadToCloud', 'p2p:deleteFromCloud'
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
