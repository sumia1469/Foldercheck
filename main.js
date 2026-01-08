// Electron 메인 프로세스
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, systemPreferences, session, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execSync, spawn } = require('child_process');
const net = require('net');
// autoUpdater는 app ready 이후에 동적으로 로드
let autoUpdater = null;

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
let chatWindow = null; // P2P 채팅 윈도우
let tray;
let ollamaProcess = null; // 내장 Ollama 프로세스
const PORT = 4400;
const OLLAMA_PORT = 11434;

// Extension System (동적 로딩 - 파일이 없어도 에러 없이 동작)
let ExtensionManager = null;
let ExtensionHost = null;
let ExtensionAPI = null;
const license = require('./license');

try {
    ExtensionManager = require('./extensions/ExtensionManager');
    ExtensionHost = require('./extensions/ExtensionHost');
    ExtensionAPI = require('./extensions/ExtensionAPI');
    console.log('[Extension] 확장 시스템 모듈 로드됨');
} catch (e) {
    console.log('[Extension] 확장 시스템 모듈 없음 - 나중에 다운로드 필요');
}

let extensionManager = null;
let extensionHost = null;
let extensionAPI = null;

// P2P Messenger System (동적 로딩 - 확장으로 분리됨)
let P2PMessenger = null;
let MessengerDB = null;
let p2pMessenger = null;
let messengerDB = null;

// P2P 메신저 확장 로드 시도
function loadP2PMessengerExtension() {
    // 1. 개발 모드에서 루트 폴더 확인 (빌드에는 포함 안됨)
    if (!isPackaged) {
        try {
            P2PMessenger = require('./p2p-messenger');
            MessengerDB = require('./messenger-db');
            console.log('[P2P] 메신저 모듈 로드됨 (개발 모드 - 루트)');
            return true;
        } catch (e) {
            // 루트에 없음
        }
    }

    // 2. 확장 폴더에서 시도 (프로덕션에서는 이 경로만 사용)
    const extensionsDir = path.join(getUserDataDir(), 'extensions', 'p2p-messenger');
    try {
        if (fs.existsSync(path.join(extensionsDir, 'p2p-messenger.js'))) {
            // 캐시 제거 후 다시 로드
            const modulePath = path.join(extensionsDir, 'p2p-messenger.js');
            const dbPath = path.join(extensionsDir, 'messenger-db.js');
            delete require.cache[require.resolve(modulePath)];
            delete require.cache[require.resolve(dbPath)];

            P2PMessenger = require(modulePath);
            MessengerDB = require(dbPath);
            console.log('[P2P] 메신저 모듈 로드됨 (확장 폴더)');
            return true;
        }
    } catch (e) {
        console.log('[P2P] 확장 폴더에서 로드 실패:', e.message);
    }

    console.log('[P2P] 메신저 확장 없음 - 다운로드 필요');
    return false;
}

// 확장 zip 파일 설치
async function installExtensionFromZip(zipPath) {
    const unzipper = require('unzipper');

    // zip 파일에서 manifest.json 읽기
    const directory = await unzipper.Open.file(zipPath);
    const manifestEntry = directory.files.find(f => f.path === 'manifest.json');

    if (!manifestEntry) {
        throw new Error('manifest.json not found in extension zip');
    }

    const manifestContent = await manifestEntry.buffer();
    const manifest = JSON.parse(manifestContent.toString('utf8'));

    const extensionId = manifest.id;
    const extensionsDir = path.join(getUserDataDir(), 'extensions', extensionId);

    // 확장 폴더 생성
    if (!fs.existsSync(extensionsDir)) {
        fs.mkdirSync(extensionsDir, { recursive: true });
    }

    // 모든 파일 압축 해제
    console.log(`[Extension] ${manifest.name} 설치 중...`);

    await directory.extract({ path: extensionsDir });

    console.log(`[Extension] ${manifest.name} v${manifest.version} 설치 완료: ${extensionsDir}`);

    return {
        id: extensionId,
        name: manifest.name,
        version: manifest.version,
        path: extensionsDir
    };
}

// P2P 메신저 확장 설치 IPC 핸들러
ipcMain.handle('p2p-extension:install', async (event, zipPath) => {
    try {
        const result = await installExtensionFromZip(zipPath);

        // 설치 후 바로 로드 시도
        if (result.id === 'p2p-messenger') {
            loadP2PMessengerExtension();
        }

        return { success: true, ...result };
    } catch (e) {
        console.error('[Extension] 설치 실패:', e);
        return { success: false, error: e.message };
    }
});

// P2P 메신저 확장 상태 확인
ipcMain.handle('p2p-extension:status', () => {
    const extensionsDir = path.join(getUserDataDir(), 'extensions', 'p2p-messenger');
    // package.json 또는 manifest.json 둘 다 확인
    const packageJsonPath = path.join(extensionsDir, 'package.json');
    const manifestJsonPath = path.join(extensionsDir, 'manifest.json');
    const installed = fs.existsSync(packageJsonPath) || fs.existsSync(manifestJsonPath);

    let version = null;
    if (installed) {
        try {
            // package.json 우선 확인
            if (fs.existsSync(packageJsonPath)) {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                version = pkg.version;
            } else if (fs.existsSync(manifestJsonPath)) {
                const manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
                version = manifest.version;
            }
        } catch (e) {}
    }

    return {
        installed,
        loaded: P2PMessenger !== null,
        version,
        path: extensionsDir
    };
});

// 모든 윈도우에 이벤트 브로드캐스트 (전역 헬퍼 함수)
function broadcastToAllWindows(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send(channel, data);
    }
}

// 패키징 여부 확인 (asar 내부인지 체크 - app.isPackaged보다 먼저 사용 가능)
const isPackaged = __dirname.includes('app.asar');

// 사용자 데이터 디렉토리 계산
function getUserDataDir() {
    const appName = 'docwatch';
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', appName);
    } else if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), appName);
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
const DEFAULT_AI_MODEL = 'qwen2.5:7b-instruct-q4_K_M';

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

    // 플랫폼별 윈도우 설정
    // 아이콘 경로 설정
    const iconPath = process.platform === 'win32'
        ? path.join(__dirname, 'build', 'icons', 'icon.ico')
        : path.join(__dirname, 'build', 'icons', 'icon.png');

    const windowOptions = {
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        title: 'DocWatch',
        icon: iconPath,
        center: true,
        frame: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        show: true
    };

    // macOS 전용 설정
    if (process.platform === 'darwin') {
        windowOptions.titleBarStyle = 'hidden';
        windowOptions.trafficLightPosition = { x: 12, y: 12 };
        windowOptions.transparent = true;
        windowOptions.backgroundColor = '#00000000';
        windowOptions.vibrancy = 'under-window';
    } else {
        // Windows/Linux: 커스텀 타이틀바 사용
        windowOptions.backgroundColor = '#1a1f2e';
    }

    mainWindow = new BrowserWindow(windowOptions);

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
        // Mac: Template 이미지 사용 (메뉴바에 맞게 자동 색상 조정)
        const trayPath = path.join(__dirname, 'build', 'icons', 'tray', 'trayTemplate-22.png');
        if (fs.existsSync(trayPath)) {
            trayIcon = nativeImage.createFromPath(trayPath);
            trayIcon.setTemplateImage(true);
        } else {
            trayIcon = nativeImage.createEmpty();
        }
    } else {
        // Windows: 전용 트레이 ICO 사용 (여백 없이 크게)
        const trayIcoPath = path.join(__dirname, 'build', 'icons', 'tray', 'tray.ico');
        const fallbackPath = path.join(__dirname, 'build', 'icons', 'icon.ico');

        if (fs.existsSync(trayIcoPath)) {
            trayIcon = nativeImage.createFromPath(trayIcoPath);
        } else if (fs.existsSync(fallbackPath)) {
            trayIcon = nativeImage.createFromPath(fallbackPath);
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

// ========================================
// 자동 업데이트 시스템
// ========================================

function setupAutoUpdater() {
    // 개발 모드에서는 업데이트 체크 건너뛰기
    if (!isPackaged) {
        console.log('개발 모드: 자동 업데이트 비활성화');
        return;
    }

    // autoUpdater 동적 로드 (app ready 이후에만 사용 가능)
    if (!autoUpdater) {
        autoUpdater = require('electron-updater').autoUpdater;
    }

    // 로깅 활성화
    autoUpdater.logger = {
        info: (msg) => console.log('[AutoUpdater] INFO:', msg),
        warn: (msg) => console.log('[AutoUpdater] WARN:', msg),
        error: (msg) => console.error('[AutoUpdater] ERROR:', msg),
        debug: (msg) => console.log('[AutoUpdater] DEBUG:', msg)
    };

    // 자동 다운로드 비활성화 (사용자 확인 후 다운로드)
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // 업데이트 확인 가능
    autoUpdater.on('checking-for-update', () => {
        console.log('업데이트 확인 중...');
        sendUpdateStatus('checking', '업데이트 확인 중...');
    });

    // 업데이트 가능
    autoUpdater.on('update-available', (info) => {
        console.log('새 업데이트 발견:', info.version);
        sendUpdateStatus('available', `새 버전 ${info.version}을 사용할 수 있습니다.`, info);

        // 사용자에게 업데이트 알림
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: '업데이트 발견',
                message: `DocWatch ${info.version} 버전을 사용할 수 있습니다.`,
                detail: '지금 다운로드하시겠습니까?',
                buttons: ['다운로드', '나중에'],
                defaultId: 0,
                cancelId: 1
            }).then(result => {
                if (result.response === 0) {
                    autoUpdater.downloadUpdate();
                }
            });
        }
    });

    // 업데이트 없음
    autoUpdater.on('update-not-available', (info) => {
        console.log('최신 버전 사용 중');
        sendUpdateStatus('not-available', '최신 버전을 사용 중입니다.');
    });

    // 다운로드 진행률
    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        console.log(`다운로드 진행: ${percent}%`);
        sendUpdateStatus('downloading', `다운로드 중: ${percent}%`, {
            percent: percent,
            bytesPerSecond: progressObj.bytesPerSecond,
            transferred: progressObj.transferred,
            total: progressObj.total
        });
    });

    // 다운로드 완료
    autoUpdater.on('update-downloaded', (info) => {
        console.log('업데이트 다운로드 완료:', info.version);
        sendUpdateStatus('downloaded', '업데이트가 준비되었습니다.', info);

        // 사용자에게 재시작 알림
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: '업데이트 준비 완료',
                message: 'DocWatch 업데이트가 다운로드되었습니다.',
                detail: '지금 재시작하여 업데이트를 적용하시겠습니까?',
                buttons: ['지금 재시작', '나중에'],
                defaultId: 0,
                cancelId: 1
            }).then(result => {
                if (result.response === 0) {
                    autoUpdater.quitAndInstall(false, true);
                }
            });
        }
    });

    // 오류 처리
    autoUpdater.on('error', (err) => {
        console.error('업데이트 오류:', err.message);
        sendUpdateStatus('error', `업데이트 오류: ${err.message}`);
    });

    // 업데이트 확인 시작 (30초 후)
    setTimeout(() => {
        console.log('자동 업데이트 확인 시작...');
        autoUpdater.checkForUpdates().catch(err => {
            console.error('업데이트 확인 실패:', err.message);
        });
    }, 30000);

    // 이후 6시간마다 업데이트 확인
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(err => {
            console.error('업데이트 확인 실패:', err.message);
        });
    }, 6 * 60 * 60 * 1000);
}

// 업데이트 상태를 렌더러 프로세스로 전송
function sendUpdateStatus(status, message, data = null) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-status', { status, message, data });
    }
}

// IPC 핸들러: 수동 업데이트 확인
ipcMain.handle('check-for-updates', async () => {
    if (!isPackaged) {
        return { status: 'dev-mode', message: '개발 모드에서는 업데이트를 확인할 수 없습니다.' };
    }
    try {
        // autoUpdater가 아직 로드되지 않았으면 로드
        if (!autoUpdater) {
            autoUpdater = require('electron-updater').autoUpdater;
        }
        const result = await autoUpdater.checkForUpdates();
        return { status: 'success', data: result };
    } catch (err) {
        return { status: 'error', message: err.message };
    }
});

// IPC 핸들러: 현재 버전 가져오기
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

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

        // Extension 시스템 초기화
        console.log('Initializing extension system...');
        try {
            await initializeExtensions();
            console.log('Extension system initialized');
        } catch (err) {
            console.error('Extension system initialization failed:', err.message);
        }

        // 자동 업데이트 설정
        setupAutoUpdater();
    });
}

// 앱 종료 전 처리
app.on('before-quit', async () => {
    app.isQuitting = true;
    stopEmbeddedOllama(); // 내장 Ollama 종료

    // Extension 시스템 종료
    if (extensionHost) {
        try {
            await extensionHost.shutdown();
        } catch (err) {
            console.error('Extension shutdown error:', err.message);
        }
    }
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

// 쉘 작업: Finder/탐색기에서 항목 표시
ipcMain.handle('shell-show-item-in-folder', (event, filePath) => {
    try {
        // 경로 정규화 (Windows에서 슬래시/백슬래시 처리)
        const normalizedPath = path.normalize(filePath);

        // 파일/폴더 존재 여부 확인
        const fs = require('fs');
        if (!fs.existsSync(normalizedPath)) {
            console.error('[Shell] 경로가 존재하지 않음:', normalizedPath);
            return { success: false, error: '경로를 찾을 수 없습니다: ' + normalizedPath };
        }

        // Windows에서 shell.showItemInFolder가 실패할 경우를 대비한 대체 로직
        if (process.platform === 'win32') {
            const { spawn } = require('child_process');
            const stats = fs.statSync(normalizedPath);

            if (stats.isDirectory()) {
                // 폴더인 경우: 해당 폴더를 직접 열기
                const explorer = spawn('explorer', [normalizedPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsVerbatimArguments: true
                });
                explorer.unref();
                explorer.on('error', (error) => {
                    console.error('[Shell] explorer 실행 실패:', error);
                });
            } else {
                // 파일인 경우: /select 옵션으로 파일 선택 상태로 열기
                const explorer = spawn('explorer', ['/select,', normalizedPath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsVerbatimArguments: true
                });
                explorer.unref();
                explorer.on('error', (error) => {
                    console.error('[Shell] explorer /select 실행 실패:', error);
                });
            }
            return { success: true };
        } else {
            // macOS/Linux: 기존 shell API 사용
            shell.showItemInFolder(normalizedPath);
            return { success: true };
        }
    } catch (err) {
        console.error('[Shell] showItemInFolder 실패:', err);
        return { success: false, error: err.message };
    }
});

// 클립보드에 텍스트 복사
ipcMain.handle('clipboard-write-text', (event, text) => {
    try {
        clipboard.writeText(text);
        return { success: true };
    } catch (err) {
        console.error('[Clipboard] writeText 실패:', err);
        return { success: false, error: err.message };
    }
});

// ========================================
// Extension System IPC Handlers

// 앱 재시작
ipcMain.handle('app-relaunch', () => {
    try {
        app.relaunch();
        app.exit(0);
        return { success: true };
    } catch (err) {
        console.error('[App] relaunch 실패:', err);
        return { success: false, error: err.message };
    }
});
// ========================================

/**
 * 확장 시스템 초기화
 */
async function initializeExtensions() {
    // 확장 모듈이 로드되지 않았으면 스킵
    if (!ExtensionManager || !ExtensionHost || !ExtensionAPI) {
        console.log('[Extensions] 확장 시스템 모듈이 없어 초기화 스킵');
        return;
    }

    try {
        console.log('[Extensions] 확장 시스템 초기화 시작...');

        // Extension API 생성
        extensionAPI = new ExtensionAPI({
            mainWindow,
            extensionsDir: path.join(getUserDataDir(), 'extensions')
        });

        // Extension Host 생성
        extensionHost = new ExtensionHost(extensionAPI);

        // Extension Manager 생성
        extensionManager = new ExtensionManager({
            extensionsDir: path.join(getUserDataDir(), 'extensions'),
            bundledDir: path.join(__dirname, 'bundled-extensions')
        });
        extensionManager.extensionHost = extensionHost;

        // 이벤트 리스너 설정
        extensionManager.on('extension:activated', (ext) => {
            if (mainWindow) {
                mainWindow.webContents.send('extension-state-change', {
                    type: 'activated',
                    extension: { id: ext.id, state: ext.state }
                });
            }
        });

        extensionManager.on('extension:deactivated', (ext) => {
            if (mainWindow) {
                mainWindow.webContents.send('extension-state-change', {
                    type: 'deactivated',
                    extension: { id: ext.id, state: ext.state }
                });
            }
        });

        extensionManager.on('extension:error', ({ extension, error }) => {
            console.error(`[Extensions] 확장 에러 (${extension.id}):`, error);
            if (mainWindow) {
                mainWindow.webContents.send('extension-state-change', {
                    type: 'error',
                    extension: { id: extension.id, state: extension.state, error: error.message }
                });
            }
        });

        // 확장 비활성화 시 정리
        extensionManager.on('extension:deactivated', (ext) => {
            extensionAPI.cleanupExtension(ext.id);
        });

        // Extension Host 이벤트 처리
        extensionHost.on('trigger-activation', async (event) => {
            await extensionManager.activateByEvent(event);
        });

        // ExtensionAPI에서 IPC invoke 이벤트 처리
        extensionAPI.on('ipc:invoke', async ({ requestId, channel, args, extensionId }) => {
            try {
                let result;
                // P2P 관련 채널은 직접 처리
                switch (channel) {
                    case 'p2p:startHost':
                        initializeP2PMessenger();
                        result = await p2pMessenger.startHost(args[0], args[1]);
                        break;
                    case 'p2p:stopHost':
                        if (p2pMessenger) result = await p2pMessenger.stopHost();
                        break;
                    case 'p2p:connect':
                        initializeP2PMessenger();
                        result = await p2pMessenger.connect(args[0], args[1], args[2]);
                        break;
                    case 'p2p:disconnect':
                        if (p2pMessenger) result = await p2pMessenger.disconnect();
                        break;
                    case 'p2p:sendMessage':
                        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
                        result = p2pMessenger.sendMessage(args[0]);
                        break;
                    case 'p2p:sendFile':
                        if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
                        result = await p2pMessenger.sendFile(args[0], args[1]); // args[1] = cloudInfo
                        break;
                    case 'p2p:getStatus':
                        result = p2pMessenger ? p2pMessenger.getStatus() :
                            { mode: 'offline', nickname: '', port: 9900, connectedUsers: [], userCount: 0 };
                        break;
                    case 'p2p:getUsers':
                        result = p2pMessenger ? p2pMessenger.getUsers() : [];
                        break;
                    case 'p2p:selectFile':
                        const fileResult = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openFile'],
                            title: '전송할 파일 선택'
                        });
                        result = fileResult.canceled ? null : fileResult.filePaths[0];
                        break;
                    case 'p2p:openDownloads':
                        const downloadsDir = path.join(getUserDataDir(), 'p2p-downloads');
                        if (!fs.existsSync(downloadsDir)) {
                            fs.mkdirSync(downloadsDir, { recursive: true });
                        }
                        shell.openPath(downloadsDir);
                        result = { success: true };
                        break;
                    case 'select-folder':
                        const folderResult = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory'],
                            title: '폴더 선택'
                        });
                        result = folderResult.canceled ? null : folderResult.filePaths[0];
                        break;
                    case 'select-file':
                        const selectFileResult = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openFile'],
                            title: '파일 선택'
                        });
                        result = selectFileResult.canceled ? null : selectFileResult.filePaths[0];
                        break;
                    case 'shell-show-item-in-folder':
                        shell.showItemInFolder(args[0]);
                        result = { success: true };
                        break;
                    case 'clipboard-write-text':
                        clipboard.writeText(args[0]);
                        result = { success: true };
                        break;
                    default:
                        throw new Error(`알 수 없는 IPC 채널: ${channel}`);
                }

                extensionAPI.emit('ipc:response', { requestId, result });
            } catch (err) {
                extensionAPI.emit('ipc:response', { requestId, error: err.message });
            }
        });

        // 초기화
        await extensionManager.initialize();

        // 라이선스 타입 설정
        const licenseStatus = license.getLicenseStatus();
        extensionManager.setLicenseType(licenseStatus.type);

        // 시작 시 모든 '*' 활성화 이벤트 확장 활성화
        await extensionManager.activateByEvent('*');

        console.log('[Extensions] 확장 시스템 초기화 완료');
        console.log(`[Extensions] 활성 확장 수: ${extensionHost.getActiveCount()}`);

    } catch (err) {
        console.error('[Extensions] 확장 시스템 초기화 실패:', err);
    }
}

// 확장 목록 조회
ipcMain.handle('extensions:getAll', () => {
    if (!extensionManager) return [];
    return extensionManager.getExtensions();
});

// 확장 정보 조회
ipcMain.handle('extensions:get', (event, id) => {
    if (!extensionManager) return null;
    return extensionManager.getExtension(id);
});

// 확장 활성화
ipcMain.handle('extensions:activate', async (event, id) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    await extensionManager.activateExtension(id);
    return { success: true };
});

// 확장 비활성화
ipcMain.handle('extensions:deactivate', async (event, id) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    await extensionManager.deactivateExtension(id);
    return { success: true };
});

// 확장 토글
ipcMain.handle('extensions:toggle', async (event, id, enabled) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    await extensionManager.toggleExtension(id, enabled);
    return { success: true };
});

// 확장 설치
ipcMain.handle('extensions:install', async (event, source) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    const id = await extensionManager.installExtension(source);
    return { success: true, id };
});

// R2 마켓플레이스에서 확장 설치 (URL로 다운로드)
ipcMain.handle('extensions:installFromUrl', async (event, downloadUrl, expectedSha256) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    try {
        console.log('[Extensions] URL에서 설치 시작:', downloadUrl);

        // URL에서 확장 ID 추출 (p2p-messenger-v1.0.0.zip -> p2p-messenger)
        const filename = downloadUrl.split('/').pop();
        const extIdMatch = filename.match(/^(.+)-v[\d.]+\.zip$/);
        const extensionId = extIdMatch ? extIdMatch[1] : filename.replace('.zip', '');

        // installFromMarketplace 사용 (ExtensionManager에 구현된 기능)
        const result = await extensionManager.installFromMarketplace(extensionId);
        return { success: true, id: result.id, version: result.version };
    } catch (err) {
        console.error('[Extensions] URL 설치 실패:', err);
        return { success: false, error: err.message };
    }
});

// 확장 제거
ipcMain.handle('extensions:uninstall', async (event, id) => {
    if (!extensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    await extensionManager.uninstallExtension(id);
    return { success: true };
});

// 확장 설정 조회
ipcMain.handle('extensions:getSettings', (event, id) => {
    if (!extensionManager) return {};
    return extensionManager.getExtensionSettings(id);
});

// 확장 설정 저장
ipcMain.handle('extensions:setSettings', (event, id, settings) => {
    if (!extensionManager) return { success: false };
    extensionManager.setExtensionSettings(id, settings);
    return { success: true };
});

// 라이선스 변경 시 ExtensionManager 업데이트
ipcMain.handle('extensions:updateLicense', () => {
    if (!extensionManager) return { success: false };
    const licenseStatus = license.getLicenseStatus();
    extensionManager.setLicenseType(licenseStatus.type);
    console.log(`[Extensions] 라이선스 타입 업데이트: ${licenseStatus.type}`);
    return { success: true, licenseType: licenseStatus.type };
});

// 명령어 목록 조회
ipcMain.handle('extensions:getCommands', () => {
    if (!extensionAPI) return [];
    return extensionAPI.commandsGetAll('__main__');
});

// 명령어 실행
ipcMain.handle('extensions:executeCommand', async (event, commandId, ...args) => {
    if (!extensionAPI) throw new Error('확장 시스템이 초기화되지 않았습니다');

    // 명령어 정보 조회
    const cmd = extensionAPI.commands.get(commandId);
    if (!cmd) {
        throw new Error(`명령어를 찾을 수 없습니다: ${commandId}`);
    }

    // 확장에 명령어 실행 요청 전송
    const requestId = `cmd:${Date.now()}`;

    return new Promise((resolve, reject) => {
        // 결과 핸들러 설정
        const resultHandler = (msg) => {
            if (msg.type === 'command-result' && msg.requestId === requestId) {
                extensionHost.removeListener('message', resultHandler);
                if (msg.error) {
                    reject(new Error(msg.error));
                } else {
                    resolve({ success: true, result: msg.result });
                }
            }
        };

        // 타임아웃
        const timeout = setTimeout(() => {
            extensionHost.removeListener('message', resultHandler);
            reject(new Error('명령어 실행 타임아웃'));
        }, 30000);

        // Worker 메시지 리스너 설정
        const workerInfo = extensionHost.workers.get(cmd.extensionId);
        if (workerInfo && workerInfo.worker) {
            workerInfo.worker.on('message', (msg) => {
                if (msg.type === 'command-result' && msg.requestId === requestId) {
                    clearTimeout(timeout);
                    if (msg.error) {
                        reject(new Error(msg.error));
                    } else {
                        resolve({ success: true, result: msg.result });
                    }
                }
            });

            // 명령어 실행 요청 전송
            workerInfo.worker.postMessage({
                type: 'command-execute',
                requestId,
                commandId: cmd.id,
                args
            });
        } else {
            clearTimeout(timeout);
            reject(new Error(`확장이 활성화되지 않았습니다: ${cmd.extensionId}`));
        }
    });
});

// ========== 마켓플레이스 API ==========

// 마켓플레이스 URL 설정
ipcMain.handle('marketplace:setUrl', (event, url) => {
    if (!ExtensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    extensionManager.setMarketplaceUrl(url);
    return { success: true };
});

// 마켓플레이스 확장 목록 조회
ipcMain.handle('marketplace:getExtensions', async () => {
    if (!ExtensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    return await extensionManager.fetchMarketplaceExtensions();
});

// 마켓플레이스에서 확장 설치
ipcMain.handle('marketplace:install', async (event, extensionId) => {
    if (!ExtensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    return await extensionManager.installFromMarketplace(extensionId);
});

// 업데이트 확인
ipcMain.handle('marketplace:checkUpdates', async () => {
    if (!ExtensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    return await extensionManager.checkForUpdates();
});

// 모든 확장 업데이트
ipcMain.handle('marketplace:updateAll', async () => {
    if (!ExtensionManager) throw new Error('확장 시스템이 초기화되지 않았습니다');
    return await extensionManager.updateAllExtensions();
});

// QuickPick 결과 수신
ipcMain.on('quickpick:result', (event, { id, selected }) => {
    if (extensionAPI) {
        extensionAPI.emit('quickpick:result', { id, selected });
    }
});

// InputBox 결과 수신
ipcMain.on('inputbox:result', (event, { id, value }) => {
    if (extensionAPI) {
        extensionAPI.emit('inputbox:result', { id, value });
    }
});

// ========================================
// P2P Messenger IPC Handlers
// ========================================

/**
 * P2P 메신저 초기화
 */
function initializeP2PMessenger() {
    if (p2pMessenger) return;

    // P2P 메신저 확장 로드 시도
    if (!P2PMessenger && !loadP2PMessengerExtension()) {
        console.log('[P2P] 메신저 확장이 설치되지 않음');
        return false;
    }

    p2pMessenger = new P2PMessenger();

    // P2P 이벤트를 확장 시스템으로 전달하는 헬퍼 함수
    const notifyExtensions = (channel, data) => {
        if (extensionHost) {
            extensionHost.broadcast({ type: 'ipc-event', channel, data });
        }
    };

    // 이벤트 리스너 설정
    // P2P 이벤트를 mainWindow와 chatWindow 모두에 전송하는 헬퍼 함수
    const sendToAllWindows = (channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
        if (chatWindow && !chatWindow.isDestroyed()) {
            chatWindow.webContents.send(channel, data);
        }
        notifyExtensions(channel, data);
    };

    p2pMessenger.on('status', (data) => {
        sendToAllWindows('p2p:status', data);
    });

    p2pMessenger.on('message', (msg) => {
        sendToAllWindows('p2p:message', msg);
    });

    p2pMessenger.on('user_joined', (data) => {
        sendToAllWindows('p2p:user-joined', data);
    });

    p2pMessenger.on('user_left', (data) => {
        sendToAllWindows('p2p:user-left', data);
    });

    p2pMessenger.on('user_list', (users) => {
        sendToAllWindows('p2p:user-list', users);
    });

    p2pMessenger.on('error', (err) => {
        sendToAllWindows('p2p:error', err);
    });

    p2pMessenger.on('disconnected', (data) => {
        sendToAllWindows('p2p:disconnected', data);
    });

    p2pMessenger.on('file_start', (data) => {
        sendToAllWindows('p2p:file-start', data);
    });

    p2pMessenger.on('file_progress', (data) => {
        sendToAllWindows('p2p:file-progress', data);
    });

    p2pMessenger.on('file_received', (data) => {
        // 파일 저장 경로 결정
        const downloadsDir = path.join(getUserDataDir(), 'p2p-downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir, { recursive: true });
        }

        const savePath = path.join(downloadsDir, data.filename);
        fs.writeFileSync(savePath, data.data);

        const eventData = {
            filename: data.filename,
            size: data.size,
            from: data.from,
            savedPath: savePath,
            cloudFileId: data.cloudFileId || '',
            cloudUrl: data.cloudUrl || ''
        };

        sendToAllWindows('p2p:file-received', eventData);
    });

    p2pMessenger.on('file_sent', (data) => {
        sendToAllWindows('p2p:file-sent', data);
    });

    // 클라우드 파일 이벤트
    p2pMessenger.on('cloud_file_uploaded', (data) => {
        sendToAllWindows('cloud:file-uploaded', data);
    });

    p2pMessenger.on('cloud_file_deleted', (data) => {
        sendToAllWindows('cloud:file-deleted', data);
    });

    console.log('[P2P] 메신저 시스템 초기화 완료');
}

// 호스트 시작
ipcMain.handle('p2p:startHost', async (event, port, nickname) => {
    initializeP2PMessenger();
    return await p2pMessenger.startHost(port, nickname);
});

// 호스트 중지
ipcMain.handle('p2p:stopHost', async () => {
    if (!p2pMessenger) return;
    return await p2pMessenger.stopHost();
});

// 서버 연결 (게스트)
ipcMain.handle('p2p:connect', async (event, host, port, nickname) => {
    initializeP2PMessenger();
    return await p2pMessenger.connect(host, port, nickname);
});

// 연결 해제
ipcMain.handle('p2p:disconnect', async () => {
    if (!p2pMessenger) return;
    return await p2pMessenger.disconnect();
});

// 메시지 전송
ipcMain.handle('p2p:sendMessage', (event, content) => {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return p2pMessenger.sendMessage(content);
});

// 파일 전송
ipcMain.handle('p2p:sendFile', async (event, filePath, cloudInfo) => {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return await p2pMessenger.sendFile(filePath, cloudInfo);
});

// 상태 조회
ipcMain.handle('p2p:getStatus', () => {
    if (!p2pMessenger) return { mode: 'offline', nickname: '', port: 9900, connectedUsers: [], userCount: 0 };
    return p2pMessenger.getStatus();
});

// 사용자 목록 조회
ipcMain.handle('p2p:getUsers', () => {
    if (!p2pMessenger) return [];
    return p2pMessenger.getUsers();
});

// 메시지 히스토리 조회
ipcMain.handle('p2p:getHistory', () => {
    if (!p2pMessenger) return [];
    return p2pMessenger.getHistory();
});

// 파일 선택 다이얼로그
ipcMain.handle('p2p:selectFile', async (event) => {
    // 호출한 윈도우를 부모로 사용 (채팅 윈도우에서 호출 시 채팅 윈도우가 부모가 됨)
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const parentWindow = senderWindow || chatWindow || mainWindow;

    const result = await dialog.showOpenDialog(parentWindow, {
        properties: ['openFile'],
        title: '전송할 파일 선택'
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, filePath: null };
    }

    return { success: true, filePath: result.filePaths[0] };
});

// P2P 다운로드 폴더 열기
ipcMain.handle('p2p:openDownloads', () => {
    const downloadsDir = path.join(getUserDataDir(), 'p2p-downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }
    require('electron').shell.openPath(downloadsDir);
});

// ========================================
// 클라우드 파일 서버 API
// ========================================

// 클라우드 상태 조회
ipcMain.handle('cloud:getStatus', () => {
    if (!p2pMessenger) return { status: 'stopped' };
    return p2pMessenger.getCloudStatus();
});

// 클라우드 파일 목록 조회
ipcMain.handle('cloud:getFiles', () => {
    if (!p2pMessenger) return [];
    return p2pMessenger.getCloudFiles();
});

// 클라우드에 파일 업로드
ipcMain.handle('cloud:uploadFile', async (event, filePath) => {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return await p2pMessenger.uploadToCloud(filePath);
});

// 클라우드에서 파일 삭제
ipcMain.handle('cloud:deleteFile', (event, fileId) => {
    if (!p2pMessenger) throw new Error('P2P 메신저가 초기화되지 않았습니다');
    return p2pMessenger.deleteFromCloud(fileId);
});

// 클라우드 파일 선택 및 업로드
ipcMain.handle('cloud:selectAndUpload', async (event) => {
    // 호출한 윈도우를 부모로 사용
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const parentWindow = senderWindow || chatWindow || mainWindow;

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
});

// 클라우드 스토리지 폴더 열기
ipcMain.handle('cloud:openStorage', () => {
    if (!p2pMessenger || !p2pMessenger.cloudStoragePath) {
        const cloudDir = path.join(getUserDataDir(), 'cloud-files');
        if (!fs.existsSync(cloudDir)) {
            fs.mkdirSync(cloudDir, { recursive: true });
        }
        require('electron').shell.openPath(cloudDir);
    } else {
        require('electron').shell.openPath(p2pMessenger.cloudStoragePath);
    }
});

// ========================================
// P2P 채팅 윈도우
// ========================================

/**
 * 채팅 윈도우 생성
 */
function createChatWindow() {
    if (chatWindow) {
        chatWindow.focus();
        return chatWindow;
    }

    const iconPath = process.platform === 'win32'
        ? path.join(__dirname, 'build', 'icons', 'icon.ico')
        : path.join(__dirname, 'build', 'icons', 'icon.png');

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

    // HTML 파일 로드
    chatWindow.loadFile(path.join(__dirname, 'public', 'chat-window.html'));

    chatWindow.once('ready-to-show', () => {
        chatWindow.show();
    });

    chatWindow.on('closed', () => {
        chatWindow = null;
    });

    return chatWindow;
}

// 채팅 윈도우 열기
ipcMain.handle('p2p:openChatWindow', () => {
    createChatWindow();
    return { success: true };
});

// 채팅 윈도우에 1:1 채팅 시작 요청
ipcMain.handle('p2p:startDirectChatWith', (event, nickname) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat:startDirectChat', nickname);
        chatWindow.focus();
        return { success: true };
    }
    return { success: false, error: '채팅 윈도우가 열려있지 않습니다' };
});

// 채팅 윈도우에서 특정 채팅방 선택
ipcMain.handle('p2p:selectRoomInChat', (event, roomId) => {
    if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat:selectRoom', roomId);
        chatWindow.focus();
        return { success: true };
    }
    return { success: false, error: '채팅 윈도우가 열려있지 않습니다' };
});

// 채팅 윈도우 컨트롤
ipcMain.handle('chat:minimize', () => {
    if (chatWindow) chatWindow.minimize();
});

ipcMain.handle('chat:maximize', () => {
    if (chatWindow) {
        if (chatWindow.isMaximized()) {
            chatWindow.unmaximize();
        } else {
            chatWindow.maximize();
        }
    }
});

ipcMain.handle('chat:close', () => {
    if (chatWindow) chatWindow.close();
});

// 알림 표시
ipcMain.handle('chat:showNotification', (event, title, body) => {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: title,
            body: body,
            icon: path.join(__dirname, 'build', 'icons', 'icon.png'),
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
});

// 파일 열기
ipcMain.handle('chat:openFile', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        shell.openPath(filePath);
        return { success: true };
    }
    return { success: false, error: '파일을 찾을 수 없습니다' };
});

// ========================================
// 메신저 데이터베이스 IPC 핸들러
// ========================================

/**
 * MessengerDB 초기화
 */
let messengerDBInitializing = null; // 초기화 진행 중 Promise

async function initializeMessengerDB() {
    // 이미 초기화 완료된 경우
    if (messengerDB && messengerDB.db) return messengerDB;

    // 초기화 진행 중인 경우 기존 Promise 반환
    if (messengerDBInitializing) return messengerDBInitializing;

    // 새로운 초기화 시작
    messengerDBInitializing = (async () => {
        try {
            const db = new MessengerDB();
            const success = await db.initialize();
            if (success && db.db) {
                messengerDB = db;
                console.log('[MessengerDB] 초기화 완료');
                return messengerDB;
            } else {
                console.error('[MessengerDB] 초기화 실패: DB 객체가 null');
                return null;
            }
        } catch (err) {
            console.error('[MessengerDB] 초기화 오류:', err);
            return null;
        } finally {
            messengerDBInitializing = null;
        }
    })();

    return messengerDBInitializing;
}

// 연락처 관리
ipcMain.handle('messenger:getContacts', async () => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllContacts();
});

ipcMain.handle('messenger:addContact', async (event, contact) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.addContact(contact);
    // 모든 윈도우에 연락처 추가 이벤트 전송
    broadcastToAllWindows('messenger:contactChanged', { action: 'added', contactId: id, contact: { ...contact, id } });
    return { success: true, id };
});

ipcMain.handle('messenger:deleteContact', async (event, id) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteContact(id);
    // 모든 윈도우에 연락처 삭제 이벤트 전송
    broadcastToAllWindows('messenger:contactChanged', { action: 'deleted', contactId: id });
    return { success: true };
});

ipcMain.handle('messenger:updateContactStatus', async (event, id, status) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.updateContactStatus(id, status);
    return { success: true };
});

// 그룹 관리
ipcMain.handle('messenger:getGroups', async () => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllGroups();
});

ipcMain.handle('messenger:createGroup', async (event, group) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.createGroup(group);
    // 모든 윈도우에 그룹 생성 이벤트 전송
    broadcastToAllWindows('messenger:groupChanged', { action: 'created', groupId: id, group: { ...group, id } });
    console.log(`[Messenger] 그룹 생성: ${group.name} (ID: ${id})`);
    return { success: true, id };
});

ipcMain.handle('messenger:getGroupMembers', async (event, groupId) => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getGroupMembers(groupId);
});

ipcMain.handle('messenger:addGroupMember', async (event, groupId, contactId, role) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.addGroupMember(groupId, contactId, role);
    return { success: true };
});

ipcMain.handle('messenger:deleteGroup', async (event, id) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteGroup(id);
    // 모든 윈도우에 그룹 삭제 이벤트 전송
    broadcastToAllWindows('messenger:groupChanged', { action: 'deleted', groupId: id });
    console.log(`[Messenger] 그룹 삭제 (ID: ${id})`);
    return { success: true };
});

// 채팅방 관리
ipcMain.handle('messenger:getRooms', async () => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getAllRooms();
});

ipcMain.handle('messenger:createRoom', async (event, room) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.createRoom(room);
    // 모든 윈도우에 채팅방 생성 이벤트 전송
    broadcastToAllWindows('messenger:roomChanged', { action: 'created', roomId: id, room: { ...room, id } });
    console.log(`[Messenger] 채팅방 생성: ${room.name || room.type} (ID: ${id})`);
    return { success: true, id };
});

ipcMain.handle('messenger:getRoom', async (event, id) => {
    const db = await initializeMessengerDB();
    if (!db) return null;
    return db.getRoom(id);
});

ipcMain.handle('messenger:getRoomParticipants', async (event, roomId) => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getRoomParticipants(roomId);
});

ipcMain.handle('messenger:addRoomParticipant', async (event, roomId, contactId, nickname) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.addRoomParticipant(roomId, contactId, nickname);
    return { success: true };
});

ipcMain.handle('messenger:leaveRoom', async (event, roomId, contactId) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.leaveRoom(roomId, contactId);
    return { success: true };
});

ipcMain.handle('messenger:updateRoom', async (event, id, updates) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.updateRoom(id, updates);
    // 모든 윈도우에 채팅방 업데이트 이벤트 전송
    broadcastToAllWindows('messenger:roomChanged', { action: 'updated', roomId: id, updates });
    return { success: true };
});

ipcMain.handle('messenger:deleteRoom', async (event, id) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.deleteRoom(id);
    // 모든 윈도우에 채팅방 삭제 이벤트 전송
    broadcastToAllWindows('messenger:roomChanged', { action: 'deleted', roomId: id });
    console.log(`[Messenger] 채팅방 삭제 (ID: ${id})`);
    return { success: true };
});

// 메시지 관리
ipcMain.handle('messenger:saveMessage', async (event, message) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    const id = db.saveMessage(message);
    return { success: true, id };
});

ipcMain.handle('messenger:getRoomMessages', async (event, roomId, limit, offset) => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.getRoomMessages(roomId, limit, offset);
});

ipcMain.handle('messenger:markAsRead', async (event, roomId, contactId) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.markMessagesAsRead(roomId, contactId);
    return { success: true };
});

ipcMain.handle('messenger:searchMessages', async (event, query, roomId) => {
    const db = await initializeMessengerDB();
    if (!db) return [];
    return db.searchMessages(query, roomId);
});

// 설정 관리
ipcMain.handle('messenger:getSetting', async (event, key, defaultValue) => {
    const db = await initializeMessengerDB();
    if (!db) return defaultValue;
    return db.getSetting(key, defaultValue);
});

ipcMain.handle('messenger:setSetting', async (event, key, value) => {
    const db = await initializeMessengerDB();
    if (!db) return { success: false, error: 'DB 초기화 실패' };
    db.setSetting(key, value);
    return { success: true };
});

// 앱 종료 시 확장 시스템 정리
app.on('before-quit', async () => {
    if (extensionManager) {
        await extensionManager.shutdown();
    }
    if (extensionHost) {
        await extensionHost.shutdown();
    }
    // P2P 메신저 정리
    if (p2pMessenger) {
        if (p2pMessenger.mode === 'host') {
            await p2pMessenger.stopHost();
        } else if (p2pMessenger.mode === 'guest') {
            await p2pMessenger.disconnect();
        }
    }
    // MessengerDB 정리
    if (messengerDB) {
        messengerDB.close();
    }
});
