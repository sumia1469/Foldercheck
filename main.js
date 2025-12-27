// Electron 메인 프로세스
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const net = require('net');

let mainWindow;
let tray;
const PORT = 4400;

// 포트 사용 중인 프로세스 종료 (크로스 플랫폼)
function killProcessOnPort(port) {
    try {
        if (process.platform === 'win32') {
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
            const lines = result.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') {
                    try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (e) {}
                }
            }
        } else {
            try {
                const result = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
                const pids = result.trim().split('\n').filter(p => p);
                for (const pid of pids) {
                    try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); } catch (e) {}
                }
            } catch (e) {}
        }
    } catch (e) {}
}

function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port);
    });
}

async function ensurePortAvailable() {
    const available = await isPortAvailable(PORT);
    if (!available) {
        console.log(`포트 ${PORT} 사용 중. 기존 프로세스 종료 중...`);
        killProcessOnPort(PORT);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        title: 'DocWatch',
        center: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: true
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    if (process.platform !== 'darwin') {
        mainWindow.setMenuBarVisibility(false);
    }
}

function createTray() {
    let trayIcon;
    if (process.platform === 'darwin') {
        trayIcon = nativeImage.createEmpty();
    } else {
        const iconPath = path.join(__dirname, 'icon.ico');
        if (fs.existsSync(iconPath)) {
            trayIcon = nativeImage.createFromPath(iconPath);
        } else {
            trayIcon = nativeImage.createEmpty();
        }
    }

    try {
        tray = new Tray(trayIcon);
        const contextMenu = Menu.buildFromTemplate([
            { label: '열기', click: () => { if (mainWindow) mainWindow.show(); } },
            { type: 'separator' },
            { label: '종료', click: () => { app.isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip('DocWatch - 로컬 업무 자동화');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
    } catch (e) {
        console.log('트레이 생성 실패:', e.message);
    }
}

// 단일 인스턴스 실행
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        console.log('App ready, starting server...');
        await ensurePortAvailable();
        require('./server.js');
        createWindow();
        createTray();
    });
}

// 앱 종료 전 처리
app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow) {
        mainWindow.show();
    } else if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// macOS 기본 메뉴 (Cmd+Q 지원)
if (process.platform === 'darwin') {
    const template = [
        {
            label: app.name,
            submenu: [
                { label: 'DocWatch 정보', role: 'about' },
                { type: 'separator' },
                { label: '숨기기', role: 'hide' },
                { label: '다른 앱 숨기기', role: 'hideOthers' },
                { label: '모두 보기', role: 'unhide' },
                { type: 'separator' },
                { label: '종료', accelerator: 'Cmd+Q', click: () => { app.isQuitting = true; app.quit(); } }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC 핸들러: 폴더 선택 다이얼로그
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '감시할 폴더 선택'
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

// IPC 핸들러: 파일 선택 다이얼로그
ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: '감시할 파일 선택'
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

// IPC 핸들러: 여러 파일/폴더 선택
ipcMain.handle('select-multiple', async (event, type) => {
    const properties = type === 'folder'
        ? ['openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'];

    const result = await dialog.showOpenDialog(mainWindow, {
        properties,
        title: type === 'folder' ? '감시할 폴더 선택 (여러 개 가능)' : '감시할 파일 선택 (여러 개 가능)'
    });
    if (result.canceled) return [];
    return result.filePaths;
});
