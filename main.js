// Electron 메인 프로세스
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const net = require('net');

let mainWindow;
let tray;
const PORT = 4400;

// 패키징 여부 확인 (asar 내부인지 체크 - app.isPackaged보다 먼저 사용 가능)
const isPackaged = __dirname.includes('app.asar');

// 사용자 데이터 디렉토리 계산
function getUserDataDir() {
    const appName = 'docwatch';
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', appName);
    } else if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    } else {
        return path.join(os.homedir(), '.config', appName);
    }
}

// 로그 파일 설정
const LOG_DIR = isPackaged
    ? path.join(getUserDataDir(), 'logs')
    : path.join(__dirname, 'logs');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_FILE = path.join(LOG_DIR, `docwatch-${new Date().toISOString().slice(0, 10)}.log`);

// 기존 console 함수 저장
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

function writeLog(level, message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;
    try {
        fs.appendFileSync(LOG_FILE, logLine + '\n');
    } catch (e) {
        // 로그 쓰기 실패 시 무시
    }

    // 원본 콘솔에도 출력
    if (level === 'ERROR') {
        originalConsoleError(logLine);
    } else {
        originalConsoleLog(logLine);
    }
}

// console 함수 래핑
console.log = (...args) => {
    writeLog('INFO', args.join(' '));
};
console.error = (...args) => {
    writeLog('ERROR', args.join(' '));
};

console.log('=== DocWatch 시작 ===');
console.log(`로그 파일: ${LOG_FILE}`);
console.log(`앱 패키징 여부: ${isPackaged}`);

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

// 서버가 응답할 때까지 대기
function waitForServer(port, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        const tryConnect = () => {
            const http = require('http');
            const req = http.get(`http://localhost:${port}/`, (res) => {
                console.log(`Server responded with status: ${res.statusCode}`);
                resolve();
            });

            req.on('error', (err) => {
                if (Date.now() - startTime > timeout) {
                    console.log('Server timeout, proceeding anyway...');
                    resolve(); // 타임아웃 시에도 진행
                } else {
                    console.log('Server not ready, retrying...');
                    setTimeout(tryConnect, 500);
                }
            });

            req.setTimeout(2000, () => {
                req.destroy();
                if (Date.now() - startTime > timeout) {
                    resolve();
                } else {
                    setTimeout(tryConnect, 500);
                }
            });
        };

        // 서버 시작 후 1초 대기 후 연결 시도
        setTimeout(tryConnect, 1000);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        title: 'DocWatch',
        center: true,
        frame: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 12, y: 12 },
        transparent: true,
        backgroundColor: '#00000000',
        vibrancy: 'under-window',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: true
    });

    // 서버 로드 시 오류 처리
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
        // 로드 실패 시 재시도
        setTimeout(() => {
            console.log('Retrying to load...');
            mainWindow.loadURL(`http://localhost:${PORT}`);
        }, 2000);
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 개발 시 DevTools 열기 (필요 시 주석 해제)
    // mainWindow.webContents.openDevTools();

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
        console.log('__dirname:', __dirname);
        console.log('process.resourcesPath:', process.resourcesPath);

        // macOS 마이크 권한 요청
        if (process.platform === 'darwin') {
            const micStatus = systemPreferences.getMediaAccessStatus('microphone');
            console.log('마이크 권한 상태:', micStatus);

            if (micStatus !== 'granted') {
                console.log('마이크 권한 요청 중...');
                const granted = await systemPreferences.askForMediaAccess('microphone');
                console.log('마이크 권한 결과:', granted ? '허용됨' : '거부됨');
            }
        }

        await ensurePortAvailable();

        // 서버 모듈 로드
        try {
            console.log('Loading server.js...');
            require('./server.js');
            console.log('server.js loaded successfully');
        } catch (err) {
            console.error('Failed to load server.js:', err.message);
            console.error('Stack:', err.stack);

            // 오류 발생 시에도 기본 창은 표시
            const { dialog } = require('electron');
            dialog.showErrorBox('서버 시작 오류', `서버를 시작할 수 없습니다.\n\n${err.message}`);
            return;
        }

        // 서버가 완전히 시작될 때까지 대기
        console.log('Waiting for server to be ready...');
        await waitForServer(PORT, 30000); // 최대 30초 대기

        console.log('Server ready, creating window...');
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

// macOS 기본 메뉴 (Cmd+Q, 복사/붙여넣기 지원)
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
        },
        {
            label: '편집',
            submenu: [
                { label: '실행 취소', accelerator: 'Cmd+Z', role: 'undo' },
                { label: '다시 실행', accelerator: 'Shift+Cmd+Z', role: 'redo' },
                { type: 'separator' },
                { label: '잘라내기', accelerator: 'Cmd+X', role: 'cut' },
                { label: '복사', accelerator: 'Cmd+C', role: 'copy' },
                { label: '붙여넣기', accelerator: 'Cmd+V', role: 'paste' },
                { label: '모두 선택', accelerator: 'Cmd+A', role: 'selectAll' }
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

// IPC 핸들러: 윈도우 컨트롤
ipcMain.handle('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.handle('window-close', () => {
    if (mainWindow) mainWindow.close();
});
