// Electron 메인 프로세스
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, systemPreferences, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const net = require('net');

// Windows 콘솔 UTF-8 인코딩 설정
if (process.platform === 'win32') {
    // 환경변수로 UTF-8 강제 설정
    process.env.LANG = 'ko_KR.UTF-8';
    process.env.LC_ALL = 'ko_KR.UTF-8';
    process.env.PYTHONIOENCODING = 'utf-8';

    // chcp 65001 실행하여 콘솔 코드페이지 변경
    try {
        execSync('chcp 65001', { stdio: 'pipe', encoding: 'utf8' });
    } catch (e) {
        // 무시
    }
}

let mainWindow;
let tray;
let ollamaProcess = null; // 내장 Ollama 프로세스
const PORT = 4400;
const OLLAMA_PORT = 11434;

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

// UTF-8 BOM (Byte Order Mark) - Windows에서 UTF-8 파일 인식용
const UTF8_BOM = '\ufeff';

// 로그 파일 초기화 (UTF-8 BOM 추가)
function initLogFile() {
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, UTF8_BOM, { encoding: 'utf8' });
    }
}

// 기존 console 함수 저장
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

function writeLog(level, message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}`;
    try {
        // 로그 파일 초기화 (BOM 추가)
        initLogFile();
        fs.appendFileSync(LOG_FILE, logLine + '\n', { encoding: 'utf8' });
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

// ===== 첫 실행 시 자동 설정 =====

// 리소스 복사 함수 (재귀)
function copyFolderSync(src, dest) {
    if (!fs.existsSync(src)) return false;
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
    return true;
}

// 첫 실행 시 번들된 리소스를 사용자 데이터 폴더로 복사
async function setupBundledResources() {
    const userDataDir = getUserDataDir();
    const setupFlagFile = path.join(userDataDir, '.setup_complete');

    // 이미 설정 완료되었으면 스킵
    if (fs.existsSync(setupFlagFile)) {
        console.log('이미 초기 설정이 완료되었습니다.');
        return;
    }

    console.log('첫 실행 감지 - 리소스 설정 시작...');

    // 사용자 데이터 디렉토리 생성
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    // 번들된 리소스 경로 (패키징된 경우)
    const resourcesPath = isPackaged ? process.resourcesPath : __dirname;

    // 1. Whisper 모델 복사
    const bundledModelsDir = path.join(resourcesPath, 'models');
    const userModelsDir = path.join(userDataDir, 'models');
    if (fs.existsSync(bundledModelsDir)) {
        console.log('Whisper 모델 복사 중...');
        copyFolderSync(bundledModelsDir, userModelsDir);
        console.log('Whisper 모델 복사 완료');
    }

    // 2. Whisper CLI 복사 (Windows)
    const bundledBinDir = path.join(resourcesPath, 'bin');
    const userBinDir = path.join(userDataDir, 'bin');
    if (fs.existsSync(bundledBinDir)) {
        console.log('Whisper CLI 복사 중...');
        copyFolderSync(bundledBinDir, userBinDir);
        console.log('Whisper CLI 복사 완료');
    }

    // 3. 템플릿 복사
    const bundledTemplatesDir = path.join(resourcesPath, 'templates');
    const userTemplatesDir = path.join(userDataDir, 'templates');
    if (fs.existsSync(bundledTemplatesDir) && !fs.existsSync(userTemplatesDir)) {
        console.log('템플릿 복사 중...');
        copyFolderSync(bundledTemplatesDir, userTemplatesDir);
        console.log('템플릿 복사 완료');
    }

    // 4. 회의록 폴더 생성
    const meetingsDir = path.join(userDataDir, 'meetings');
    if (!fs.existsSync(meetingsDir)) {
        fs.mkdirSync(meetingsDir, { recursive: true });
    }

    // 5. 녹음 폴더 생성
    const recordingsDir = path.join(userDataDir, 'recordings');
    if (!fs.existsSync(recordingsDir)) {
        fs.mkdirSync(recordingsDir, { recursive: true });
    }

    // 설정 완료 플래그 생성
    fs.writeFileSync(setupFlagFile, new Date().toISOString());
    console.log('초기 설정 완료!');
}

// ===== 내장 Ollama 관련 함수 =====

// 내장 Ollama 경로 반환
function getEmbeddedOllamaPath() {
    if (isPackaged) {
        // 패키징된 앱: resources/ollama 폴더
        return path.join(process.resourcesPath, 'ollama');
    } else {
        // 개발 모드: 프로젝트 폴더의 resources/ollama
        return path.join(__dirname, 'resources', 'ollama');
    }
}

// Ollama 모델 디렉토리 설정 (내장 모델 사용)
function getOllamaModelsPath() {
    const ollamaDir = getEmbeddedOllamaPath();
    const modelsPath = path.join(ollamaDir, 'models');

    // 내장 모델이 있으면 사용, 없으면 기본 경로
    if (fs.existsSync(modelsPath)) {
        return modelsPath;
    }
    return path.join(os.homedir(), '.ollama', 'models');
}

// Ollama가 실행 중인지 확인
async function isOllamaRunning() {
    return new Promise((resolve) => {
        const http = require('http');
        const req = http.get(`http://localhost:${OLLAMA_PORT}/api/tags`, (res) => {
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

// 기본 AI 모델 설정
const DEFAULT_AI_MODEL = 'qwen2.5:3b';

// 모델 설치 여부 확인
async function checkModelInstalled() {
    return new Promise((resolve) => {
        const req = http.get(`http://localhost:${OLLAMA_PORT}/api/tags`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const models = result.models || [];
                    const hasModel = models.some(m => m.name.startsWith(DEFAULT_AI_MODEL.split(':')[0]));
                    resolve({ hasModel, models });
                } catch (e) {
                    resolve({ hasModel: false, models: [] });
                }
            });
        });
        req.on('error', () => resolve({ hasModel: false, models: [] }));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve({ hasModel: false, models: [] });
        });
    });
}

// 모델 자동 다운로드
async function autoDownloadModel() {
    console.log(`기본 AI 모델(${DEFAULT_AI_MODEL}) 설치 확인 중...`);

    const { hasModel } = await checkModelInstalled();

    if (hasModel) {
        console.log('AI 모델이 이미 설치되어 있습니다.');
        return true;
    }

    console.log(`AI 모델(${DEFAULT_AI_MODEL}) 다운로드 시작...`);
    console.log('※ 첫 실행 시 약 2GB 다운로드가 필요합니다. 잠시 기다려주세요...');

    return new Promise((resolve) => {
        const postData = JSON.stringify({
            name: DEFAULT_AI_MODEL,
            stream: true
        });

        const options = {
            hostname: 'localhost',
            port: OLLAMA_PORT,
            path: '/api/pull',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let buffer = '';
            let lastProgress = 0;

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        if (data.completed && data.total) {
                            const progress = Math.round((data.completed / data.total) * 100);
                            // 10% 단위로만 로그 출력
                            if (progress >= lastProgress + 10) {
                                console.log(`AI 모델 다운로드: ${progress}%`);
                                lastProgress = progress;
                            }
                        }

                        if (data.error) {
                            console.error('모델 다운로드 오류:', data.error);
                            resolve(false);
                            return;
                        }
                    } catch (e) {
                        // JSON 파싱 오류 무시
                    }
                }
            });

            res.on('end', () => {
                console.log('AI 모델 다운로드 완료!');
                resolve(true);
            });
        });

        req.on('error', (err) => {
            console.error('모델 다운로드 요청 오류:', err.message);
            resolve(false);
        });

        req.setTimeout(1800000, () => { // 30분 타임아웃
            console.error('모델 다운로드 시간 초과');
            req.destroy();
            resolve(false);
        });

        req.write(postData);
        req.end();
    });
}

// 시스템 Ollama 찾기
function findSystemOllama() {
    try {
        if (process.platform === 'win32') {
            const result = execSync('where ollama', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            return result.trim().split('\n')[0];
        } else {
            const result = execSync('which ollama', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            return result.trim();
        }
    } catch (e) {
        return null;
    }
}

// 내장 Ollama 실행
async function startEmbeddedOllama() {
    // 이미 Ollama가 실행 중이면 스킵
    if (await isOllamaRunning()) {
        console.log('Ollama가 이미 실행 중입니다.');
        return true;
    }

    const ollamaDir = getEmbeddedOllamaPath();
    const ollamaBinary = path.join(ollamaDir, process.platform === 'win32' ? 'ollama.exe' : 'ollama');

    // 내장 Ollama 존재 확인
    if (!fs.existsSync(ollamaBinary)) {
        console.log('내장 Ollama를 찾을 수 없습니다:', ollamaBinary);

        // 시스템 Ollama 확인
        const systemOllama = findSystemOllama();
        if (systemOllama) {
            console.log('시스템 Ollama 사용:', systemOllama);
            return true; // 시스템 Ollama가 있으면 사용
        }

        return false;
    }

    console.log('내장 Ollama 실행 중...', ollamaBinary);

    // 환경 변수 설정 (모델 경로)
    const env = {
        ...process.env,
        OLLAMA_MODELS: getOllamaModelsPath(),
        OLLAMA_HOST: `localhost:${OLLAMA_PORT}`,
        LANG: 'ko_KR.UTF-8',
        LC_ALL: 'ko_KR.UTF-8'
    };

    return new Promise((resolve) => {
        try {
            // Ollama serve 실행
            ollamaProcess = spawn(ollamaBinary, ['serve'], {
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
            });

            // UTF-8 인코딩 설정
            if (ollamaProcess.stdout) ollamaProcess.stdout.setEncoding('utf8');
            if (ollamaProcess.stderr) ollamaProcess.stderr.setEncoding('utf8');

            ollamaProcess.stdout.on('data', (data) => {
                console.log('[Ollama]', data.trim());
            });

            ollamaProcess.stderr.on('data', (data) => {
                console.log('[Ollama]', data.trim());
            });

            ollamaProcess.on('error', (err) => {
                console.error('Ollama 실행 오류:', err.message);
                resolve(false);
            });

            ollamaProcess.on('exit', (code) => {
                console.log('Ollama 종료됨, 코드:', code);
                ollamaProcess = null;
            });

            // Ollama가 준비될 때까지 대기
            let retries = 0;
            const maxRetries = 30;

            const checkReady = async () => {
                if (await isOllamaRunning()) {
                    console.log('내장 Ollama 시작 완료!');
                    resolve(true);
                } else if (retries < maxRetries) {
                    retries++;
                    setTimeout(checkReady, 1000);
                } else {
                    console.log('Ollama 시작 시간 초과');
                    resolve(false);
                }
            };

            setTimeout(checkReady, 2000);

        } catch (err) {
            console.error('Ollama 실행 실패:', err.message);
            resolve(false);
        }
    });
}

// 내장 Ollama 종료
function stopEmbeddedOllama() {
    if (ollamaProcess) {
        console.log('내장 Ollama 종료 중...');
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /F /PID ${ollamaProcess.pid}`, { stdio: 'ignore' });
            } else {
                ollamaProcess.kill('SIGTERM');
            }
        } catch (e) {
            console.log('Ollama 종료 오류:', e.message);
        }
        ollamaProcess = null;
    }
}

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
    // 미디어 장치(마이크, 카메라) 권한 자동 허용
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowedPermissions = ['media', 'mediaKeySystem', 'geolocation', 'notifications', 'midi', 'midiSysex'];
        if (allowedPermissions.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // 미디어 권한 체크 핸들러 (Electron 12+)
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        if (permission === 'media') {
            return true;
        }
        return true;
    });

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

        // 첫 실행 시 번들된 리소스 설정 (Whisper 모델, CLI 등)
        await setupBundledResources();

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

        // 내장 Ollama 시작
        console.log('내장 AI 엔진 시작 중...');
        const ollamaStarted = await startEmbeddedOllama();
        if (ollamaStarted) {
            console.log('AI 엔진 준비 완료');

            // 모델 자동 다운로드 (백그라운드에서 진행)
            autoDownloadModel().then(success => {
                if (success) {
                    console.log('AI 모델 준비 완료');
                } else {
                    console.log('AI 모델 다운로드 실패. 설정에서 수동으로 설치해주세요.');
                }
            }).catch(err => {
                console.error('AI 모델 다운로드 오류:', err.message);
            });
        } else {
            console.log('AI 엔진을 시작할 수 없습니다. 일부 기능이 제한됩니다.');
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
    stopEmbeddedOllama(); // 내장 Ollama 종료
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
