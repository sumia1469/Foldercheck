const { app, BrowserWindow, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const net = require('net');

let mainWindow;
let tray;

const PORT = 4400;

// 캐시 삭제 함수
function clearCache() {
    const userDataPath = app.getPath('userData');
    const cacheFolders = [
        'Cache',
        'Code Cache',
        'GPUCache',
        'DawnCache',
        'blob_storage',
        'Session Storage',
        'Local Storage'
    ];

    cacheFolders.forEach(folder => {
        const folderPath = path.join(userDataPath, folder);
        try {
            if (fs.existsSync(folderPath)) {
                fs.rmSync(folderPath, { recursive: true, force: true });
                console.log(`캐시 삭제: ${folder}`);
            }
        } catch (e) {
            console.log(`캐시 삭제 실패: ${folder}`, e.message);
        }
    });
}

// 포트 사용 중인 프로세스 종료
function killProcessOnPort(port) {
    try {
        // netstat로 포트 사용 중인 PID 찾기
        const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
        const lines = result.trim().split('\n');

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];

            if (pid && pid !== '0') {
                try {
                    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
                    console.log(`포트 ${port} 사용 중인 프로세스 종료: PID ${pid}`);
                } catch (e) {
                    // 이미 종료되었거나 권한 없음
                }
            }
        }
    } catch (e) {
        // 포트 사용 중인 프로세스 없음
    }
}

// 포트 사용 가능 여부 확인
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

// 서버 시작 전 포트 확인 및 정리
async function ensurePortAvailable() {
    const available = await isPortAvailable(PORT);
    if (!available) {
        console.log(`포트 ${PORT} 사용 중. 기존 프로세스 종료 중...`);
        killProcessOnPort(PORT);
        // 잠시 대기
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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 닫기 버튼 클릭 시 트레이로 최소화
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // 메뉴바 숨기기
    mainWindow.setMenuBarVisibility(false);
}

function createTray() {
    const iconPath = path.join(__dirname, 'icon.ico');

    try {
        tray = new Tray(iconPath);
    } catch (e) {
        const { nativeImage } = require('electron');
        const emptyIcon = nativeImage.createEmpty();
        tray = new Tray(emptyIcon);
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '열기',
            click: () => {
                mainWindow.show();
            }
        },
        { type: 'separator' },
        {
            label: '종료',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('DocWatch - 로컬 업무 자동화');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        mainWindow.show();
    });
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
        // 캐시 삭제 (새 버전 적용을 위해)
        clearCache();

        // 포트 정리 후 서버 시작
        await ensurePortAvailable();
        require('./server.js');

        createWindow();
        createTray();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
