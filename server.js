const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const unzipper = require('unzipper');
const xml2js = require('xml2js');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { execSync, spawn } = require('child_process');

// 라이선스 모듈
const license = require('./license');

// 패키징 여부 확인 (asar 내부인지 체크)
const isPackaged = __dirname.includes('app.asar');

// 사용자 데이터 디렉토리 (패키징 시 쓰기 가능한 경로)
let USER_DATA_DIR;
if (isPackaged) {
    // main.js에서 설정한 환경변수 또는 process.resourcesPath 상위 경로 사용
    // macOS: ~/Library/Application Support/docwatch
    // Windows: %APPDATA%/docwatch
    const os = require('os');
    const appName = 'docwatch';
    if (process.platform === 'darwin') {
        USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', appName);
    } else if (process.platform === 'win32') {
        USER_DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    } else {
        USER_DATA_DIR = path.join(os.homedir(), '.config', appName);
    }
} else {
    USER_DATA_DIR = __dirname;
}

// 개발 모드 (Pro 토글 버튼 등 개발용 기능 활성화)
const DEV_MODE = process.env.NODE_ENV !== 'production';

// FFmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegPath);

// Whisper 설정
const WHISPER_MODEL_PATH = path.join(__dirname, 'models', 'ggml-small.bin');
const WHISPER_CLI_PATH = '/opt/homebrew/bin/whisper-cli';

// Ollama 설정 (로컬 LLM)
const OLLAMA_HOST = 'http://localhost:11434';

// 사용 가능한 AI 모델 목록 (로컬 전용 - 폐쇄망 환경)
const AVAILABLE_MODELS = {
    // 로컬 모델 (저사양 PC 호환)
    'qwen2.5:3b': {
        name: 'Qwen 2.5 (3B)',
        description: '경량 AI 모델 - 저사양 PC 호환 (1.9GB, 4GB RAM 이상)',
        size: '1.9GB',
        type: 'local'
    }
};

// 기본 AI 모델
let CURRENT_AI_MODEL = 'qwen2.5:3b';

const PORT = 4400;

// 설정 파일들은 userData 디렉토리에 저장
const CONFIG_FILE = path.join(USER_DATA_DIR, 'folderList.json');
const SETTINGS_FILE = path.join(USER_DATA_DIR, 'settings.json');
const MEETINGS_FILE = path.join(USER_DATA_DIR, 'meetings.json');
const CONVERSATIONS_FILE = path.join(USER_DATA_DIR, 'conversations.json');

// 패키징 환경에서는 userData 디렉토리 사용, 개발 환경에서는 프로젝트 디렉토리 사용
const MEETINGS_DIR = path.join(USER_DATA_DIR, 'meetings');
const TEMPLATES_DIR = path.join(USER_DATA_DIR, 'templates');

console.log('isPackaged:', isPackaged);
console.log('USER_DATA_DIR:', USER_DATA_DIR);
console.log('MEETINGS_DIR:', MEETINGS_DIR);
console.log('TEMPLATES_DIR:', TEMPLATES_DIR);

// userData 디렉토리 초기화 (패키징 환경에서 필수)
if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

// 디렉토리 초기화
if (!fs.existsSync(MEETINGS_DIR)) {
    fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// 회의록 저장소
let meetings = [];

// 대화 주제 저장소
let conversations = [];

// 대화 로드
function loadConversations() {
    try {
        if (fs.existsSync(CONVERSATIONS_FILE)) {
            const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');
            conversations = JSON.parse(data);
        }
    } catch (err) {
        console.error('대화 로드 오류:', err);
        conversations = [];
    }
    return conversations;
}

// 대화 저장
function saveConversations() {
    try {
        fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(conversations, null, 2), 'utf8');
    } catch (err) {
        console.error('대화 저장 오류:', err);
    }
}

// 새 대화 생성
function createConversation(title = null) {
    const now = new Date();
    const id = `conv_${Date.now()}`;
    const conversation = {
        id,
        title: title || `새 대화 ${now.toLocaleDateString('ko-KR')} ${now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`,
        messages: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    conversations.unshift(conversation);
    saveConversations();
    return conversation;
}

// 대화에 메시지 추가
function addMessageToConversation(conversationId, role, content) {
    const conv = conversations.find(c => c.id === conversationId);
    if (conv) {
        conv.messages.push({
            role,
            content,
            timestamp: new Date().toISOString()
        });
        conv.updatedAt = new Date().toISOString();

        // 첫 사용자 메시지로 제목 자동 설정
        if (role === 'user' && conv.messages.filter(m => m.role === 'user').length === 1) {
            conv.title = content.substring(0, 30) + (content.length > 30 ? '...' : '');
        }

        saveConversations();
    }
    return conv;
}

// 대화 삭제
function deleteConversation(conversationId) {
    const index = conversations.findIndex(c => c.id === conversationId);
    if (index !== -1) {
        conversations.splice(index, 1);
        saveConversations();
        return true;
    }
    return false;
}

// Whisper 상태
let whisperReady = false;

// Whisper 준비 상태 확인
function checkWhisperModel() {
    const modelExists = fs.existsSync(WHISPER_MODEL_PATH);
    const cliExists = fs.existsSync(WHISPER_CLI_PATH);
    whisperReady = modelExists && cliExists;
    return whisperReady;
}

// Whisper CLI 경로 찾기 (다양한 플랫폼 지원)
function findWhisperCli() {
    const paths = [
        '/opt/homebrew/bin/whisper-cli',  // macOS (Apple Silicon)
        '/usr/local/bin/whisper-cli',      // macOS (Intel) / Linux
        path.join(__dirname, 'whisper-cpp', 'build', 'bin', 'whisper-cli'),  // 로컬 빌드
        path.join(__dirname, 'whisper-cli.exe')  // Windows
    ];

    for (const p of paths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

// WebM을 WAV로 변환
function convertToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioFrequency(16000)
            .audioChannels(1)
            .audioCodec('pcm_s16le')
            .format('wav')
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

// 로컬 Whisper로 음성을 텍스트로 변환
async function transcribeAudio(audioPath) {
    if (!checkWhisperModel()) {
        throw new Error('음성 인식 모델이 없습니다. models/ggml-small.bin 파일이 필요합니다.');
    }

    // 고유한 타임스탬프 생성 (파일 충돌 방지)
    const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(7);

    // WAV로 변환 (이미 WAV인 경우 _converted 접미사 추가)
    const ext = path.extname(audioPath).toLowerCase();
    let wavPath;

    if (ext === '.wav') {
        // 이미 WAV 파일인 경우: Whisper 형식(16kHz, mono)으로 변환 (고유 ID 포함)
        wavPath = audioPath.replace('.wav', `_converted_${uniqueId}.wav`);
        await convertToWav(audioPath, wavPath);
    } else {
        // 다른 형식인 경우: WAV로 변환 (고유 ID 포함)
        wavPath = audioPath.replace(/\.[^.]+$/, `_${uniqueId}.wav`);
        await convertToWav(audioPath, wavPath);
    }

    console.log('로컬 음성 인식 시작...');
    console.log('WAV 파일:', wavPath);

    // 예상되는 JSON 출력 경로 - 이전 실행에서 남은 파일이 있으면 삭제
    const expectedJsonPath = wavPath + '.json';
    if (fs.existsSync(expectedJsonPath)) {
        console.log('이전 JSON 파일 삭제:', expectedJsonPath);
        try {
            fs.unlinkSync(expectedJsonPath);
        } catch (e) {
            console.log('이전 JSON 파일 삭제 실패 (무시):', e.message);
        }
    }

    // whisper-cli로 음성 인식 (JSON 출력)
    return new Promise((resolve, reject) => {
        const args = [
            '-m', WHISPER_MODEL_PATH,
            '-f', wavPath,
            '-l', 'ko',
            '-oj',  // JSON 출력
            '-pp'   // 진행상황 표시
        ];

        console.log('실행 명령:', WHISPER_CLI_PATH, args.join(' '));

        const whisperProcess = spawn(WHISPER_CLI_PATH, args);
        let stdout = '';
        let stderr = '';

        whisperProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        whisperProcess.stderr.on('data', (data) => {
            stderr += data.toString();
            console.log('음성 인식:', data.toString().trim());
        });

        whisperProcess.on('close', (code) => {
            if (code !== 0) {
                console.error('음성 인식 오류:', stderr);
                // 임시 WAV 파일 정리
                if (wavPath.includes('_converted_') || wavPath.includes(`_${uniqueId}`)) {
                    try { fs.unlinkSync(wavPath); } catch (e) { /* 무시 */ }
                }
                reject(new Error(`음성 인식 처리 실패: ${stderr}`));
                return;
            }

            try {
                // JSON 출력 파싱
                const jsonPath = wavPath + '.json';
                let result = '';

                if (fs.existsSync(jsonPath)) {
                    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    console.log('Whisper JSON 출력:', JSON.stringify(jsonData).substring(0, 200));

                    if (jsonData.transcription && Array.isArray(jsonData.transcription)) {
                        for (const seg of jsonData.transcription) {
                            const start = seg.offsets?.from || 0;
                            const startSec = Math.floor(start / 1000);
                            const minutes = Math.floor(startSec / 60);
                            const seconds = startSec % 60;
                            const timestamp = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
                            const text = (seg.text || '').trim();
                            if (text) {
                                result += `${timestamp} ${text}\n`;
                            }
                        }
                    }
                    // JSON 파일 정리
                    try {
                        fs.unlinkSync(jsonPath);
                        console.log('JSON 파일 삭제 완료:', jsonPath);
                    } catch (e) {
                        console.log('JSON 파일 삭제 실패:', e.message);
                    }
                } else {
                    // stdout에서 텍스트 추출
                    console.log('JSON 파일 없음, stdout 사용:', stdout.substring(0, 200));
                    result = stdout.trim();
                }

                console.log('음성 인식 완료, 결과 길이:', result.length);
                console.log('음성 인식 결과 미리보기:', result.substring(0, 100));
                resolve({ text: result.trim() || '(인식된 텍스트 없음)', wavPath });
            } catch (e) {
                console.error('결과 파싱 오류:', e);
                reject(e);
            }
        });

        whisperProcess.on('error', (err) => {
            console.error('음성 인식 실행 오류:', err);
            // 임시 WAV 파일 정리
            if (wavPath.includes('_converted_') || wavPath.includes(`_${uniqueId}`)) {
                try { fs.unlinkSync(wavPath); } catch (e) { /* 무시 */ }
            }
            reject(err);
        });
    });
}

let watchedFolders = [];
let changeLog = [];
let watchers = {};

// 회의록 처리 진행 상황
let processingProgress = {
    active: false,
    stage: '',
    percent: 0,
    detail: ''
};

function updateProgress(stage, percent, detail = '') {
    processingProgress = { active: true, stage, percent, detail };
    console.log(`[진행] ${stage} ${percent}% ${detail}`);
}

function clearProgress() {
    processingProgress = { active: false, stage: '', percent: 0, detail: '' };
}

let settings = {
    filters: [],           // 확장자 필터 (예: ['.txt', '.xlsx'])
    excludePatterns: [],   // 제외 패턴 (예: ['node_modules', '.git'])
    notifications: {
        desktop: true,
        sound: true
    },
    telegram: {
        enabled: false,
        botToken: '',
        chatId: ''
    },
    aiModel: 'qwen2.5:3b'  // 현재 선택된 AI 모델
};
let stats = {
    created: 0,
    modified: 0,
    deleted: 0,
    byExtension: {},
    byHour: Array(24).fill(0)
};

// 설정 파일 로드
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const config = JSON.parse(data);
            watchedFolders = config.folders || [];
            console.log(`설정 로드 완료: ${watchedFolders.length}개 폴더`);
        }
    } catch (e) {
        console.error('설정 파일 로드 실패:', e.message);
        watchedFolders = [];
    }
}

// 설정 파일 저장
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ folders: watchedFolders }, null, 2));
    } catch (e) {
        console.error('설정 저장 실패:', e.message);
    }
}

// 고급 설정 로드
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            settings = { ...settings, ...JSON.parse(data) };
            // AI 모델 설정 로드
            if (settings.aiModel && AVAILABLE_MODELS[settings.aiModel]) {
                CURRENT_AI_MODEL = settings.aiModel;
                console.log(`AI 모델 설정 로드: ${CURRENT_AI_MODEL}`);
            }
            console.log('고급 설정 로드 완료');
        }
    } catch (e) {
        console.error('고급 설정 로드 실패:', e.message);
    }
}

// 고급 설정 저장
function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('고급 설정 저장 실패:', e.message);
    }
}

// 필터 체크: 확장자 필터
function passesFilter(filename) {
    if (settings.filters.length === 0) return true;
    const ext = path.extname(filename).toLowerCase();
    return settings.filters.includes(ext);
}

// 제외 패턴 체크
function isExcluded(filePath) {
    // 사용자 정의 제외 패턴
    for (const pattern of settings.excludePatterns) {
        if (filePath.includes(pattern)) return true;
    }

    // Office 임시 파일 자동 제외 (파일 열기 시 생성되는 파일들)
    const filename = path.basename(filePath);

    // ~$로 시작하는 Office 임시 파일
    if (filename.startsWith('~$')) return true;

    // .tmp 임시 파일
    if (filename.endsWith('.tmp')) return true;

    // ~로 시작하는 임시 파일
    if (filename.startsWith('~')) return true;

    // .DS_Store (macOS)
    if (filename === '.DS_Store') return true;

    // Thumbs.db (Windows)
    if (filename === 'Thumbs.db') return true;

    return false;
}

// 파일 변경 디바운싱 (중복 이벤트 방지)
const fileChangeDebounce = new Map();
const DEBOUNCE_DELAY = 1000; // 1초 내 중복 이벤트 무시

function shouldProcessChange(filePath) {
    const now = Date.now();
    const lastChange = fileChangeDebounce.get(filePath);

    if (lastChange && (now - lastChange) < DEBOUNCE_DELAY) {
        return false; // 디바운스 기간 내 중복 이벤트
    }

    fileChangeDebounce.set(filePath, now);

    // 오래된 항목 정리 (5분 이상)
    if (fileChangeDebounce.size > 100) {
        for (const [key, time] of fileChangeDebounce.entries()) {
            if (now - time > 300000) {
                fileChangeDebounce.delete(key);
            }
        }
    }

    return true;
}

// 파일이 사용 가능한지 확인 (저장 완료 대기)
async function waitForFileReady(filePath, maxWait = 8000) {
    const start = Date.now();
    const checkInterval = 300;
    let lastSize = -1;
    let stableCount = 0;

    console.log(`[waitForFileReady] 시작: ${filePath}`);

    while (Date.now() - start < maxWait) {
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`[waitForFileReady] 파일 없음, 대기 중...`);
                await new Promise(r => setTimeout(r, checkInterval));
                continue;
            }

            const stats = fs.statSync(filePath);
            const currentSize = stats.size;

            console.log(`[waitForFileReady] 크기: ${currentSize}, 이전: ${lastSize}`);

            // 파일 크기가 0보다 크고, 이전과 같으면 안정적
            if (currentSize > 0 && currentSize === lastSize) {
                stableCount++;
                if (stableCount >= 2) {
                    // 파일 읽기 시도
                    try {
                        const fd = fs.openSync(filePath, 'r');
                        fs.closeSync(fd);
                        console.log(`[waitForFileReady] 성공: ${filePath}`);
                        return true;
                    } catch (e) {
                        console.log(`[waitForFileReady] 파일 잠김: ${e.message}`);
                        stableCount = 0;
                    }
                }
            } else {
                stableCount = 0;
            }

            lastSize = currentSize;
        } catch (e) {
            console.log(`[waitForFileReady] 오류: ${e.message}`);
            stableCount = 0;
        }
        await new Promise(r => setTimeout(r, checkInterval));
    }

    console.log(`[waitForFileReady] 타임아웃: ${filePath}`);
    return false;
}

// 텔레그램 알림 전송
function sendTelegramNotification(message) {
    if (!settings.telegram.enabled || !settings.telegram.botToken || !settings.telegram.chatId) {
        return;
    }

    const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
    const data = JSON.stringify({
        chat_id: settings.telegram.chatId,
        text: message,
        parse_mode: 'HTML'
    });

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(url, options, (res) => {
        if (res.statusCode !== 200) {
            console.error('텔레그램 알림 전송 실패:', res.statusCode);
        }
    });

    req.on('error', (e) => {
        console.error('텔레그램 오류:', e.message);
    });

    req.write(data);
    req.end();
}

// 통계 업데이트
function updateStats(action, filename) {
    if (action === '생성') stats.created++;
    else if (action === '수정') stats.modified++;
    else if (action === '삭제') stats.deleted++;

    const ext = path.extname(filename).toLowerCase() || '(없음)';
    stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;

    const hour = new Date().getHours();
    stats.byHour[hour]++;
}

// 경로가 파일인지 폴더인지 확인
function isFile(targetPath) {
    try {
        return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
    } catch (e) {
        return false;
    }
}

// 폴더 또는 파일 감시 시작
function startWatching(targetPath) {
    if (watchers[targetPath]) return;

    if (!fs.existsSync(targetPath)) {
        console.error(`경로가 존재하지 않음: ${targetPath}`);
        return;
    }

    try {
        const isTargetFile = isFile(targetPath);

        if (isTargetFile) {
            // 파일 감시: 부모 폴더를 감시하고 특정 파일만 필터링
            const parentDir = path.dirname(targetPath);
            const targetFilename = path.basename(targetPath);

            watchers[targetPath] = fs.watch(parentDir, async (eventType, filename) => {
                // 디버그 로그
                console.log(`[감시 이벤트] ${eventType} - ${filename} (대상: ${targetFilename})`);

                if (!filename) return;

                // 파일명 비교 (대소문자 무시, 유니코드 정규화 - macOS NFD 처리)
                const normalizedFilename = filename.normalize('NFC').toLowerCase();
                const normalizedTarget = targetFilename.normalize('NFC').toLowerCase();
                const isMatch = normalizedFilename === normalizedTarget;

                console.log(`[비교] "${normalizedFilename}" vs "${normalizedTarget}" => ${isMatch}`);

                if (!isMatch) {
                    // 다른 파일 이벤트는 무시
                    return;
                }

                console.log(`[매칭됨] ${filename}`);

                // 임시 파일 제외
                if (isExcluded(filename)) {
                    console.log(`[제외됨] ${filename}`);
                    return;
                }

                console.log(`[임시파일 체크 통과] ${filename}`);

                // 디바운싱: 1초 내 중복 이벤트 무시
                if (!shouldProcessChange(targetPath)) {
                    console.log(`[디바운스] ${targetPath} - 중복 이벤트 무시`);
                    return;
                }

                console.log(`[디바운스 통과] ${filename}`);

                const timestamp = new Date().toISOString();
                let action = '';

                // macOS에서 Office 저장 시 rename 이벤트가 발생할 수 있음
                if (eventType === 'rename') {
                    action = fs.existsSync(targetPath) ? '수정' : '삭제';  // rename도 수정으로 처리
                } else if (eventType === 'change') {
                    action = '수정';
                }

                // action이 비어있으면 무시
                if (!action) {
                    console.log(`[무시] ${targetPath} - 알 수 없는 이벤트 타입: ${eventType}`);
                    return;
                }

                console.log(`[처리 시작] ${action} - ${targetPath}`);

                // Office 파일인 경우 저장 완료 대기
                const ext = path.extname(targetFilename).toLowerCase();
                const officeExts = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
                if (officeExts.includes(ext) && action !== '삭제') {
                    console.log(`[파일 대기] ${targetPath}`);
                    const isReady = await waitForFileReady(targetPath);
                    if (!isReady) {
                        console.log(`[대기 초과] ${targetPath} - 파일이 아직 사용 중`);
                        return;
                    }
                    console.log(`[파일 준비됨] ${targetPath}`);
                }

                const logEntry = {
                    timestamp,
                    folder: parentDir,
                    file: targetFilename,
                    action,
                    fullPath: targetPath,
                    extension: ext,
                    isFile: true,
                    changeSummary: null
                };

                // 빠른 변경 분석 수행 (비동기)
                let analysis = null;
                try {
                    analysis = await quickChangeAnalysis(targetPath, action);
                    console.log(`[분석 결과] ${targetPath}:`, analysis ? JSON.stringify(analysis).substring(0, 200) : 'null');
                } catch (e) {
                    console.error('변경 분석 오류:', e.message);
                }

                // 첫 감지(기준 버전 저장)일 경우에만 로그에 기록하지 않음
                // analysis가 null이 아니면 무조건 알림 발생
                if (analysis === null) {
                    console.log(`[알림 생략] ${targetPath} - analysis가 null`);
                    return;
                }

                logEntry.changeSummary = analysis;
                changeLog.unshift(logEntry);
                if (changeLog.length > 500) changeLog.pop();

                updateStats(action, targetFilename);
                console.log(`[${action}] ${targetPath}${logEntry.changeSummary ? ` (${logEntry.changeSummary.summary})` : ''}`);

                if (settings.telegram.enabled) {
                    const summaryText = logEntry.changeSummary ? `\n📊 ${logEntry.changeSummary.summary}` : '';
                    const msg = `📄 <b>[DocWatch] 파일 ${action}</b>\n📄 ${targetFilename}${summaryText}\n📂 ${parentDir}\n🕐 ${new Date().toLocaleString('ko-KR')}`;
                    sendTelegramNotification(msg);
                }
            });

            console.log(`파일 감시 시작: ${targetPath}`);
        } else {
            // 폴더 감시 (기존 로직)
            watchers[targetPath] = fs.watch(targetPath, { recursive: true }, async (eventType, filename) => {
                if (!filename) return;

                // 제외 패턴 체크 (임시 파일 포함)
                if (isExcluded(filename)) return;

                // 확장자 필터 체크
                if (!passesFilter(filename)) return;

                const fullPath = path.join(targetPath, filename);

                // 디바운싱: 1초 내 중복 이벤트 무시 (Office 앱이 여러 번 저장하는 경우)
                if (!shouldProcessChange(fullPath)) {
                    return;
                }

                const timestamp = new Date().toISOString();
                let action = '';

                if (eventType === 'rename') {
                    action = fs.existsSync(fullPath) ? '생성' : '삭제';
                } else if (eventType === 'change') {
                    action = '수정';
                }

                // Office 파일인 경우 저장 완료 대기
                const ext = path.extname(filename).toLowerCase();
                const officeExts = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
                if (officeExts.includes(ext) && action !== '삭제') {
                    const isReady = await waitForFileReady(fullPath);
                    if (!isReady) {
                        console.log(`[대기 초과] ${fullPath} - 파일이 아직 사용 중`);
                        return; // 파일이 준비되지 않으면 무시
                    }
                }

                const logEntry = {
                    timestamp,
                    folder: targetPath,
                    file: filename,
                    action,
                    fullPath,
                    extension: ext,
                    isFile: false,
                    changeSummary: null
                };

                // 빠른 변경 분석 수행 (비동기)
                let analysis = null;
                try {
                    analysis = await quickChangeAnalysis(fullPath, action);
                } catch (e) {
                    console.error('변경 분석 오류:', e.message);
                }

                // 첫 감지(기준 버전 저장)일 경우 로그에 기록하지 않음
                if (analysis === null) {
                    return;
                }

                logEntry.changeSummary = analysis;
                changeLog.unshift(logEntry);
                if (changeLog.length > 500) changeLog.pop();

                updateStats(action, filename);
                console.log(`[${action}] ${fullPath}${logEntry.changeSummary ? ` (${logEntry.changeSummary.summary})` : ''}`);

                if (settings.telegram.enabled) {
                    const summaryText = logEntry.changeSummary ? `\n📊 ${logEntry.changeSummary.summary}` : '';
                    const msg = `📁 <b>[DocWatch] 파일 ${action}</b>\n📄 ${filename}${summaryText}\n📂 ${targetPath}\n🕐 ${new Date().toLocaleString('ko-KR')}`;
                    sendTelegramNotification(msg);
                }
            });

            console.log(`폴더 감시 시작: ${targetPath}`);
        }
    } catch (e) {
        console.error(`감시 실패: ${targetPath} - ${e.message}`);
    }
}

// 빠른 변경 분석 (로그용 - AI 없이 간단 분석)
async function quickChangeAnalysis(filePath, action) {
    try {
        const ext = path.extname(filePath).toLowerCase();
        const analyzableExts = [
            '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
            '.txt', '.md', '.markdown', '.pdf',
            '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
            '.css', '.scss', '.less', '.html', '.xml', '.json', '.yaml', '.yml'
        ];

        if (!analyzableExts.includes(ext)) {
            return null;
        }

        const fileKey = filePath.replace(/[^a-zA-Z0-9]/g, '_');
        const previousVersion = documentHistory[fileKey];

        // 파일 타입별 분류
        const textExts = ['.txt', '.md', '.markdown', '.js', '.ts', '.jsx', '.tsx', '.py',
                        '.java', '.c', '.cpp', '.h', '.css', '.scss', '.less', '.html',
                        '.xml', '.json', '.yaml', '.yml'];

        // 컨텐츠 추출 함수
        async function extractContent() {
            if (!fs.existsSync(filePath)) return null;

            if (textExts.includes(ext)) {
                return extractTextContent(filePath);
            } else if (ext === '.pptx' || ext === '.ppt') {
                return await extractPptxContent(filePath);
            } else if (ext === '.docx' || ext === '.doc') {
                return await extractDocxContent(filePath);
            } else if (ext === '.xlsx' || ext === '.xls') {
                return extractXlsxContent(filePath);
            }
            return null;
        }

        // 새 파일 생성 시 - 기준 버전 저장 (알림 없음)
        if (action === '생성') {
            try {
                const currentContent = await extractContent();
                if (currentContent && currentContent.text) {
                    documentHistory[fileKey] = {
                        content: currentContent,
                        analyzedAt: new Date().toISOString(),
                        fileName: path.basename(filePath)
                    };
                    saveDocHistory();
                    console.log(`[기준 버전 저장] ${path.basename(filePath)}`);
                }
            } catch (e) {
                console.log('새 파일 분석 스킵:', e.message);
            }
            return null;  // 첫 감지 시 알림 없음
        }

        if (action === '삭제') {
            if (documentHistory[fileKey]) {
                delete documentHistory[fileKey];
                saveDocHistory();
            }
            return { type: 'deleted', summary: '파일 삭제됨' };
        }

        // 수정된 경우 - 이전 버전과 비교
        if (action === '수정') {
            let currentContent = null;

            try {
                currentContent = await extractContent();
            } catch (e) {
                console.log('컨텐츠 추출 실패:', e.message);
                return { type: 'modified', summary: '파일 수정됨' };
            }

            // 이전 버전이 없으면 현재 버전 저장 후 알림 없이 종료 (첫 감지 시)
            if (!previousVersion) {
                if (currentContent && currentContent.text) {
                    documentHistory[fileKey] = {
                        content: currentContent,
                        analyzedAt: new Date().toISOString(),
                        fileName: path.basename(filePath)
                    };
                    saveDocHistory();
                    console.log(`[기준 버전 저장] ${path.basename(filePath)}`);
                }
                return null;  // 첫 감지 시 알림 없음
            }

            // 비교 분석
            if (currentContent && currentContent.text && previousVersion.content && previousVersion.content.text) {
                const prevText = previousVersion.content.text;
                const currText = currentContent.text;

                // 실제 내용이 동일하면 알림 없이 종료 (파일 열기만 한 경우)
                const prevNormalized = prevText.replace(/\s+/g, ' ').trim();
                const currNormalized = currText.replace(/\s+/g, ' ').trim();
                if (prevNormalized === currNormalized) {
                    console.log(`[내용 동일] ${path.basename(filePath)} - 알림 생략`);
                    return null;
                }

                let summaryParts = [];
                let addedTexts = [];
                let removedTexts = [];

                // 텍스트 길이 변화
                const lengthDiff = currText.length - prevText.length;
                if (Math.abs(lengthDiff) > 10) {
                    summaryParts.push(`${lengthDiff > 0 ? '+' : ''}${lengthDiff}자`);
                }

                // 파일 타입별 추가 정보
                if (textExts.includes(ext)) {
                    const prevLines = prevText.split('\n').length;
                    const currLines = currText.split('\n').length;
                    const lineDiff = currLines - prevLines;
                    if (lineDiff !== 0) {
                        summaryParts.push(`${lineDiff > 0 ? '+' : ''}${lineDiff}줄`);
                    }
                } else if (ext === '.pptx' || ext === '.ppt') {
                    const prevSlides = previousVersion.content.slideCount || 0;
                    const currSlides = currentContent.slideCount || 0;
                    if (prevSlides !== currSlides) {
                        summaryParts.push(`${currSlides - prevSlides > 0 ? '+' : ''}${currSlides - prevSlides}슬라이드`);
                    }
                } else if (ext === '.xlsx' || ext === '.xls') {
                    const prevSheets = previousVersion.content.sheetNames?.length || 0;
                    const currSheets = currentContent.sheetNames?.length || 0;
                    if (prevSheets !== currSheets) {
                        summaryParts.push(`${currSheets - prevSheets > 0 ? '+' : ''}${currSheets - prevSheets}시트`);
                    }
                }

                // 의미 없는 메타데이터 텍스트 필터링 (완화된 버전)
                const isValidContent = (text, fileType) => {
                    if (!text || text.length < 1) return false;

                    const trimmed = text.trim();

                    // Office 파일 내부 메타데이터만 필터링 (최소한으로)
                    const metadataPatterns = [
                        /^root\s*entry/i,
                        /^workbook$/i,
                        /^\[content_types\]/i,
                        /^_rels$/i,
                        /^docprops$/i,
                        /^http:\/\/schemas/i,
                        /^https:\/\/schemas/i,
                        /^urn:/i,
                        /^xmlns/i,
                        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i,  // UUID
                    ];

                    for (const pattern of metadataPatterns) {
                        if (pattern.test(trimmed)) return false;
                    }

                    // xlsx/pptx/docx 파일은 숫자도 유효한 데이터로 인정
                    if (['xlsx', 'xls', 'pptx', 'ppt', 'docx', 'doc'].includes(fileType)) {
                        // 숫자, 한글, 영문 모두 유효
                        const hasNumber = /\d/.test(trimmed);
                        const hasKorean = /[\uAC00-\uD7AF]/.test(trimmed);
                        const hasEnglish = /[a-zA-Z]/.test(trimmed);
                        return hasNumber || hasKorean || hasEnglish;
                    }

                    // 텍스트 파일은 한글이나 영문 단어가 있어야 함
                    const hasKorean = /[\uAC00-\uD7AF]/.test(trimmed);
                    const hasEnglishWord = /[a-zA-Z]{2,}/.test(trimmed);
                    return hasKorean || hasEnglishWord;
                };

                // 파일 타입 결정
                const fileType = ext.replace('.', '');

                // 텍스트를 토큰으로 분리 (공백 + 구두점 + 한글 조사 분리)
                const tokenize = (text) => {
                    // 1. 먼저 공백과 구두점으로 분리
                    let tokens = text.split(/[\s,.!?;:'"()\[\]{}<>\/\\|@#$%^&*+=~`]+/);

                    // 2. 긴 토큰(10자 이상)은 추가로 분리
                    const result = [];
                    for (const token of tokens) {
                        if (token.length >= 10) {
                            // 한글의 경우 자연스러운 분리점 찾기 (조사, 어미 패턴)
                            const subTokens = token.split(/(?<=[가-힣])(?=[은는이가을를의와과에서로])/)
                                .flatMap(t => t.length > 15 ? [t.substring(0, 15), t.substring(15)] : [t]);
                            result.push(...subTokens);
                        } else {
                            result.push(token);
                        }
                    }
                    return result;
                };

                // 단어 단위로 비교하여 실제 변경된 부분만 추출 (1자 이상도 감지)
                const prevWords = tokenize(prevText).filter(w => w.length >= 1 && isValidContent(w, fileType));
                const currWords = tokenize(currText).filter(w => w.length >= 1 && isValidContent(w, fileType));

                // 단어 빈도수 계산 (Set 대신 Map 사용하여 중복 횟수도 고려)
                const countWords = (words) => {
                    const map = new Map();
                    for (const word of words) {
                        map.set(word, (map.get(word) || 0) + 1);
                    }
                    return map;
                };

                const prevWordCount = countWords(prevWords);
                const currWordCount = countWords(currWords);

                // 추가된 단어/문구 찾기 (새로 등장했거나 횟수가 증가한 것)
                for (const [word, count] of currWordCount) {
                    const prevCount = prevWordCount.get(word) || 0;
                    if (count > prevCount) {
                        // 증가한 횟수만큼 추가로 표시
                        const diff = count - prevCount;
                        const displayWord = word.length > 50 ? word.substring(0, 50) + '...' : word;
                        if (diff > 1) {
                            addedTexts.push(`${displayWord} (x${diff})`);
                        } else {
                            addedTexts.push(displayWord);
                        }
                        if (addedTexts.length >= 10) break;
                    }
                }

                // 삭제된 단어/문구 찾기 (사라졌거나 횟수가 감소한 것)
                for (const [word, count] of prevWordCount) {
                    const currCount = currWordCount.get(word) || 0;
                    if (count > currCount) {
                        const diff = count - currCount;
                        const displayWord = word.length > 50 ? word.substring(0, 50) + '...' : word;
                        if (diff > 1) {
                            removedTexts.push(`${displayWord} (x${diff})`);
                        } else {
                            removedTexts.push(displayWord);
                        }
                        if (removedTexts.length >= 10) break;
                    }
                }

                // 중복 제거
                addedTexts = [...new Set(addedTexts)];
                removedTexts = [...new Set(removedTexts)];

                // 토큰 비교로 변경을 감지하지 못한 경우, 문자 단위 diff 수행
                // charDiff === 0이어도 내용이 다를 수 있음 (대체의 경우)
                if (addedTexts.length === 0 && removedTexts.length === 0) {
                    // 간단한 문자 단위 diff: 변경된 부분 찾기
                    const findCharDiff = (prev, curr) => {
                        const changes = { added: [], removed: [] };
                        const prevChars = [...prev];
                        const currChars = [...curr];

                        // 앞에서부터 동일한 부분 찾기
                        let startSame = 0;
                        while (startSame < prevChars.length && startSame < currChars.length &&
                               prevChars[startSame] === currChars[startSame]) {
                            startSame++;
                        }

                        // 뒤에서부터 동일한 부분 찾기
                        let endSamePrev = prevChars.length - 1;
                        let endSameCurr = currChars.length - 1;
                        while (endSamePrev > startSame && endSameCurr > startSame &&
                               prevChars[endSamePrev] === currChars[endSameCurr]) {
                            endSamePrev--;
                            endSameCurr--;
                        }

                        // 삭제된 부분
                        if (endSamePrev >= startSame) {
                            const removed = prevChars.slice(startSame, endSamePrev + 1).join('');
                            if (removed.trim()) {
                                changes.removed.push(removed.length > 30 ? removed.substring(0, 30) + '...' : removed);
                            }
                        }

                        // 추가된 부분
                        if (endSameCurr >= startSame) {
                            const added = currChars.slice(startSame, endSameCurr + 1).join('');
                            if (added.trim()) {
                                changes.added.push(added.length > 30 ? added.substring(0, 30) + '...' : added);
                            }
                        }

                        return changes;
                    };

                    const charChanges = findCharDiff(prevText, currText);
                    if (charChanges.added.length > 0) {
                        addedTexts.push(...charChanges.added);
                    }
                    if (charChanges.removed.length > 0) {
                        removedTexts.push(...charChanges.removed);
                    }
                }

                // 그래도 감지 못했으면 글자수 변화만 표시
                if (addedTexts.length === 0 && removedTexts.length === 0 && charDiff !== 0) {
                    if (charDiff > 0) {
                        addedTexts.push(`(${charDiff}자 추가됨)`);
                    } else {
                        removedTexts.push(`(${Math.abs(charDiff)}자 삭제됨)`);
                    }
                }

                // 내용이 동일하면 이미 위에서 null 반환됨
                // 여기까지 왔다면 실제 변경이 있는 것이므로 알림 발생

                // 현재 버전 저장
                documentHistory[fileKey] = {
                    content: currentContent,
                    analyzedAt: new Date().toISOString(),
                    fileName: path.basename(filePath)
                };
                saveDocHistory();

                // 파일 타입별 상세 정보
                let fileTypeInfo = {};
                if (textExts.includes(ext)) {
                    const prevLines = prevText.split('\n').length;
                    const currLines = currText.split('\n').length;
                    fileTypeInfo = {
                        type: 'text',
                        prevLines,
                        currLines,
                        lineDiff: currLines - prevLines
                    };
                } else if (ext === '.pptx' || ext === '.ppt') {
                    const prevSlides = previousVersion.content.slideCount || 0;
                    const currSlides = currentContent.slideCount || 0;
                    fileTypeInfo = {
                        type: 'pptx',
                        prevSlides,
                        currSlides,
                        slideDiff: currSlides - prevSlides
                    };
                } else if (ext === '.xlsx' || ext === '.xls') {
                    const prevSheetNames = previousVersion.content.sheetNames || [];
                    const currSheetNames = currentContent.sheetNames || [];
                    fileTypeInfo = {
                        type: 'xlsx',
                        prevSheets: prevSheetNames.length,
                        currSheets: currSheetNames.length,
                        sheetDiff: currSheetNames.length - prevSheetNames.length,
                        newSheets: currSheetNames.filter(s => !prevSheetNames.includes(s)),
                        removedSheets: prevSheetNames.filter(s => !currSheetNames.includes(s))
                    };
                } else if (ext === '.docx' || ext === '.doc') {
                    fileTypeInfo = { type: 'docx' };
                }

                // 상세 변경 내용 구성
                const result = {
                    type: 'modified',
                    summary: summaryParts.length > 0 ? summaryParts.join(', ') : '내용 변경됨',
                    details: {
                        lengthDiff,
                        prevLength: prevText.length,
                        currLength: currText.length,
                        added: addedTexts.slice(0, 10),  // 최대 10개
                        removed: removedTexts.slice(0, 10),
                        addedCount: addedTexts.length,
                        removedCount: removedTexts.length,
                        fileTypeInfo
                    }
                };

                // 요약에 변경 내용 힌트 추가
                if (addedTexts.length > 0 || removedTexts.length > 0) {
                    let hints = [];
                    if (addedTexts.length > 0) hints.push(`+${addedTexts.length}항목`);
                    if (removedTexts.length > 0) hints.push(`-${removedTexts.length}항목`);
                    result.summary += ` (${hints.join(', ')})`;
                }

                return result;
            }
        }

        // 비교가 불가능한 경우에도 기본 알림 발생
        console.log(`[비교 불가] ${path.basename(filePath)} - 기본 알림 발생`);
        return { type: 'modified', summary: '파일 수정됨' };
    } catch (e) {
        console.error('빠른 변경 분석 오류:', e.message);
        // 오류 시에도 기본 알림 발생
        return { type: 'modified', summary: '파일 수정됨' };
    }
}

// 폴더 감시 중지
function stopWatching(folderPath) {
    if (watchers[folderPath]) {
        watchers[folderPath].close();
        delete watchers[folderPath];
        console.log(`감시 중지: ${folderPath}`);
    }
}

// 모든 폴더 감시 시작
function startAllWatchers() {
    watchedFolders.forEach(folder => startWatching(folder));
}

// 모든 감시 재시작 (설정 변경 시)
function restartAllWatchers() {
    Object.keys(watchers).forEach(folder => stopWatching(folder));
    startAllWatchers();
}

// CSV 생성
function generateCSV(logs) {
    const header = '시간,폴더,파일명,동작,전체경로,확장자\n';
    const rows = logs.map(log => {
        return `"${log.timestamp}","${log.folder}","${log.file}","${log.action}","${log.fullPath}","${log.extension || ''}"`;
    }).join('\n');
    return '\uFEFF' + header + rows; // BOM for Excel
}

// ========================================
// 문서 분석 및 요약 기능 (PPTX, DOCX, XLSX)
// ========================================

// 문서 변경 이력 저장소
let documentHistory = {};
const DOC_HISTORY_FILE = path.join(USER_DATA_DIR, 'docHistory.json');

// 문서 이력 로드
function loadDocHistory() {
    try {
        if (fs.existsSync(DOC_HISTORY_FILE)) {
            const data = fs.readFileSync(DOC_HISTORY_FILE, 'utf8');
            documentHistory = JSON.parse(data);
        }
    } catch (e) {
        console.error('문서 이력 로드 실패:', e.message);
        documentHistory = {};
    }
}

// 문서 이력 저장
function saveDocHistory() {
    try {
        fs.writeFileSync(DOC_HISTORY_FILE, JSON.stringify(documentHistory, null, 2));
    } catch (e) {
        console.error('문서 이력 저장 실패:', e.message);
    }
}

// DOCX/DOC 파일 내용 추출
async function extractDocxContent(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // .doc 파일 (구 형식) - 바이너리에서 텍스트 추출 시도
    if (ext === '.doc') {
        try {
            const buffer = fs.readFileSync(filePath);
            let text = '';

            // Word 바이너리에서 유니코드/ASCII 텍스트 추출
            // UTF-16LE로 한글 추출 시도
            const utf16Text = buffer.toString('utf16le');
            const koreanMatches = utf16Text.match(/[\uAC00-\uD7AF\u0020-\u007E]+/g);

            if (koreanMatches) {
                text = koreanMatches
                    .filter(m => m.trim().length > 2)
                    .join(' ');
            }

            // 텍스트가 부족하면 latin1으로도 시도
            if (text.length < 100) {
                const latinText = buffer.toString('latin1');
                const asciiMatches = latinText.match(/[\x20-\x7E]{4,}/g);
                if (asciiMatches) {
                    const additionalText = asciiMatches
                        .filter(m => !/^[0-9\s\.\-\_\{\}\[\]]+$/.test(m))
                        .join(' ');
                    text = text + ' ' + additionalText;
                }
            }

            text = text.trim();
            if (text.length > 50) {
                console.log(`[DOC 추출] ${path.basename(filePath)}: ${text.length}자 추출됨`);
                return { text, isLegacyFormat: true };
            } else {
                console.log(`[DOC 추출 제한] ${path.basename(filePath)}: 텍스트 추출 부족`);
                return {
                    text: '',
                    error: '.doc 파일(구 형식)은 제한적으로 지원됩니다.',
                    isLegacyFormat: true
                };
            }
        } catch (e) {
            console.error('DOC 추출 오류:', e.message);
            return { text: '', error: '.doc 파일 읽기 실패', isLegacyFormat: true };
        }
    }

    // .docx 파일 (새 형식)
    try {
        const result = await mammoth.extractRawText({ path: filePath });
        return {
            text: result.value,
            messages: result.messages
        };
    } catch (e) {
        console.error('DOCX 추출 오류:', e.message);
        return { text: '', error: e.message };
    }
}

// XLSX 파일 내용 추출
function extractXlsxContent(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheets = {};
        let fullText = '';

        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            sheets[sheetName] = data;

            // 텍스트 추출
            data.forEach(row => {
                if (Array.isArray(row)) {
                    fullText += row.filter(cell => cell != null).join(' ') + '\n';
                }
            });
        });

        return {
            sheets,
            sheetNames: workbook.SheetNames,
            text: fullText
        };
    } catch (e) {
        console.error('XLSX 추출 오류:', e.message);
        return { sheets: {}, sheetNames: [], text: '', error: e.message };
    }
}

// PPTX 파일 내용 추출
async function extractPptxContent(filePath) {
    try {
        // 파일이 완전히 저장될 때까지 잠시 대기
        await new Promise(r => setTimeout(r, 500));

        const slides = [];
        let fullText = '';

        const directory = await unzipper.Open.file(filePath);
        const slideFiles = directory.files.filter(f =>
            f.path.startsWith('ppt/slides/slide') && f.path.endsWith('.xml')
        );

        // 슬라이드 번호 순서대로 정렬
        slideFiles.sort((a, b) => {
            const numA = parseInt(a.path.match(/slide(\d+)/)?.[1] || 0);
            const numB = parseInt(b.path.match(/slide(\d+)/)?.[1] || 0);
            return numA - numB;
        });

        for (const file of slideFiles) {
            const content = await file.buffer();
            const xmlContent = content.toString('utf8');

            // XML에서 텍스트 추출
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(xmlContent);

            const slideText = extractTextFromPptxXml(result);
            const slideNum = parseInt(file.path.match(/slide(\d+)/)?.[1] || 0);

            slides.push({
                number: slideNum,
                text: slideText
            });

            fullText += `[슬라이드 ${slideNum}]\n${slideText}\n\n`;
        }

        return { slides, text: fullText, slideCount: slides.length };
    } catch (e) {
        console.error('PPTX 추출 오류:', e.message);
        return { slides: [], text: '', slideCount: 0, error: e.message };
    }
}

// PPTX XML에서 텍스트 추출 헬퍼 (a:t 요소만 추출)
function extractTextFromPptxXml(obj, texts) {
    if (!texts) texts = [];

    if (Array.isArray(obj)) {
        obj.forEach(item => extractTextFromPptxXml(item, texts));
    } else if (typeof obj === 'object' && obj !== null) {
        // a:t 요소에서 텍스트만 추출
        if (obj['a:t']) {
            const t = obj['a:t'];
            if (Array.isArray(t)) {
                t.forEach(item => {
                    if (typeof item === 'string' && item.trim()) {
                        texts.push(item.trim());
                    } else if (item && item._ && item._.trim()) {
                        texts.push(item._.trim());
                    }
                });
            } else if (typeof t === 'string' && t.trim()) {
                texts.push(t.trim());
            }
        }

        // 재귀적으로 하위 객체 탐색 (문자열은 제외하고 객체만)
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object') {
                extractTextFromPptxXml(obj[key], texts);
            }
        }
    }
    // 중복 제거 및 공백만 있는 항목 필터링
    const uniqueTexts = [...new Set(texts)].filter(t => t && t.trim().length > 0);
    return uniqueTexts.join(' ');
}

// 텍스트 파일 내용 추출 (.txt, .md, .markdown, 코드 파일 등)
function extractTextContent(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const ext = path.extname(filePath).toLowerCase();

        // 코드 파일인 경우 언어 정보 추가
        const codeExtensions = {
            '.js': 'JavaScript',
            '.ts': 'TypeScript',
            '.jsx': 'React JSX',
            '.tsx': 'React TSX',
            '.py': 'Python',
            '.java': 'Java',
            '.c': 'C',
            '.cpp': 'C++',
            '.h': 'C Header',
            '.css': 'CSS',
            '.scss': 'SCSS',
            '.less': 'Less',
            '.html': 'HTML',
            '.xml': 'XML',
            '.json': 'JSON',
            '.yaml': 'YAML',
            '.yml': 'YAML'
        };

        return {
            text: content,
            lineCount: content.split('\n').length,
            charCount: content.length,
            language: codeExtensions[ext] || null,
            isCode: !!codeExtensions[ext]
        };
    } catch (e) {
        console.error('텍스트 추출 오류:', e.message);
        return { text: '', error: e.message };
    }
}

// PDF 파일 내용 추출 (기본 텍스트 추출)
async function extractPdfContent(filePath) {
    try {
        // pdf-parse 동적 로딩 시도
        let pdfParse;
        try {
            pdfParse = require('pdf-parse');
        } catch (e) {
            // pdf-parse가 설치되지 않은 경우 안내 메시지 반환
            return {
                text: '',
                error: 'PDF 분석을 위해 pdf-parse 모듈이 필요합니다. npm install pdf-parse 명령으로 설치해주세요.',
                needsInstall: true
            };
        }

        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);

        return {
            text: data.text,
            pageCount: data.numpages,
            info: data.info
        };
    } catch (e) {
        console.error('PDF 추출 오류:', e.message);
        return { text: '', error: e.message };
    }
}

// 문서 분석 결과 캐시 (메모리)
const analysisCache = {};

// 문서 분석 및 요약 생성
async function analyzeDocument(filePath, forceReanalyze = false) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const fileKey = filePath.replace(/[^a-zA-Z0-9]/g, '_');

    // 파일 수정 시간 확인
    let fileStats;
    try {
        fileStats = fs.statSync(filePath);
    } catch (e) {
        return { error: '파일을 찾을 수 없습니다: ' + filePath };
    }
    const fileMtime = fileStats.mtimeMs;

    // 캐시된 분석 결과가 있고, 파일이 변경되지 않았으면 캐시 반환
    if (!forceReanalyze && analysisCache[fileKey]) {
        const cached = analysisCache[fileKey];
        if (cached.fileMtime === fileMtime) {
            console.log(`[캐시 사용] 분석 결과 캐시 반환: ${fileName}`);
            return {
                ...cached.result,
                fromCache: true,
                cachedAt: cached.cachedAt
            };
        } else {
            console.log(`[캐시 만료] 파일 수정됨, 재분석: ${fileName}`);
        }
    }

    let currentContent = null;
    let documentType = '';

    // 파일 타입별 내용 추출
    switch (ext) {
        case '.docx':
        case '.doc':
            currentContent = await extractDocxContent(filePath);
            documentType = 'Word 문서';
            break;
        case '.xlsx':
        case '.xls':
            currentContent = extractXlsxContent(filePath);
            documentType = 'Excel 스프레드시트';
            break;
        case '.pptx':
        case '.ppt':
            currentContent = await extractPptxContent(filePath);
            documentType = 'PowerPoint 프레젠테이션';
            break;
        case '.pdf':
            currentContent = await extractPdfContent(filePath);
            documentType = 'PDF 문서';
            break;
        case '.txt':
            currentContent = extractTextContent(filePath);
            documentType = '텍스트 파일';
            break;
        case '.md':
        case '.markdown':
            currentContent = extractTextContent(filePath);
            documentType = 'Markdown 문서';
            break;
        case '.rtf':
            currentContent = extractTextContent(filePath);
            documentType = 'RTF 문서';
            break;
        case '.js':
        case '.ts':
        case '.jsx':
        case '.tsx':
        case '.py':
        case '.java':
        case '.c':
        case '.cpp':
        case '.h':
        case '.css':
        case '.scss':
        case '.less':
        case '.html':
        case '.xml':
        case '.json':
        case '.yaml':
        case '.yml':
            currentContent = extractTextContent(filePath);
            documentType = currentContent.language ? `${currentContent.language} 코드` : '코드 파일';
            break;
        default:
            return { error: '지원하지 않는 파일 형식입니다.' };
    }

    if (currentContent.error) {
        return { error: currentContent.error };
    }

    // 이전 버전과 비교
    const previousVersion = documentHistory[fileKey];
    let summary = {
        fileName,
        documentType,
        filePath,
        analyzedAt: new Date().toISOString(),
        isNewDocument: !previousVersion,
        changes: []
    };

    // 문서 개요 생성
    summary.overview = generateDocumentOverview(currentContent, ext);

    // AI로 파일 전체 내용 요약 생성 (Ollama 사용)
    try {
        const ollamaStatus = await checkOllamaStatus();
        if (ollamaStatus.ready && currentContent.text) {
            const textToSummarize = currentContent.text.substring(0, 8000); // 최대 8000자
            const aiSummary = await summarizeWithOllama(textToSummarize, 'document');
            summary.aiSummary = aiSummary;
        } else if (!ollamaStatus.ready) {
            summary.aiSummary = '내장 AI가 준비되지 않았습니다.';
        }
    } catch (e) {
        console.log('AI 요약 생성 실패:', e.message);
        summary.aiSummary = 'AI 요약 생성 실패: ' + e.message;
    }

    // 현재 버전 저장
    documentHistory[fileKey] = {
        content: currentContent,
        analyzedAt: summary.analyzedAt,
        fileName
    };
    saveDocHistory();

    // 분석 결과 캐시에 저장
    analysisCache[fileKey] = {
        result: summary,
        fileMtime: fileMtime,
        cachedAt: new Date().toISOString()
    };
    console.log(`[캐시 저장] 분석 결과 캐시됨: ${fileName}`);

    return summary;
}

// 문서 개요 생성
function generateDocumentOverview(content, ext) {
    const overview = {
        contentLength: (content.text || '').length,
        wordCount: (content.text || '').split(/\s+/).filter(w => w).length
    };

    if (ext === '.pptx' || ext === '.ppt') {
        overview.slideCount = content.slideCount;
    }

    if (ext === '.xlsx' || ext === '.xls') {
        overview.sheetCount = content.sheetNames?.length || 0;
        overview.sheetNames = content.sheetNames;
    }

    // 주요 키워드 추출
    const words = (content.text || '').split(/\s+/).filter(w => w.length > 3);
    const wordCount = {};
    words.forEach(w => {
        const word = w.toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
        if (word.length > 2) {
            wordCount[word] = (wordCount[word] || 0) + 1;
        }
    });

    overview.topKeywords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

    return overview;
}

// ========================================
// AI 호출 함수 (로컬 Ollama 전용 - 폐쇄망 환경)
// ========================================

// AI 호출 함수 (로컬 Ollama만 사용)
async function callAI(prompt, systemPrompt, numPredict = 2000) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            model: CURRENT_AI_MODEL,
            prompt: prompt,
            system: systemPrompt,
            stream: false,
            context: [],  // 이전 대화 컨텍스트 초기화 (독립적인 요청 보장)
            options: {
                temperature: 0.3,
                num_predict: numPredict,
                num_ctx: 4096,
                num_thread: 4,
                num_batch: 256
            }
        });

        const options = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    resolve(result.response || '응답 생성 실패');
                } catch (e) {
                    reject(new Error('응답 파싱 오류'));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.setTimeout(600000, () => {
            req.destroy();
            reject(new Error('AI 응답 타임아웃 (10분)'));
        });

        req.write(postData);
        req.end();
    });
}

// ========================================
// Ollama (로컬 LLM) 관련 함수
// ========================================

// Ollama 상태 확인
async function checkOllamaStatus() {
    return new Promise((resolve) => {
        const req = http.get(`${OLLAMA_HOST}/api/tags`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    const hasModel = result.models?.some(m => m.name.startsWith(CURRENT_AI_MODEL));
                    resolve({ ready: true, hasModel, models: result.models || [], currentModel: CURRENT_AI_MODEL });
                } catch (e) {
                    resolve({ ready: false, error: 'JSON 파싱 오류' });
                }
            });
        });
        req.on('error', () => resolve({ ready: false, error: '내장 AI 연결 실패' }));
        req.setTimeout(3000, () => {
            req.destroy();
            resolve({ ready: false, error: '타임아웃' });
        });
    });
}

// Ollama로 텍스트 요약 (청크 분할 지원)
async function summarizeWithOllama(text, type = 'meeting') {
    const CHUNK_SIZE = 3000;  // 청크당 글자 수

    // 긴 텍스트는 청크로 분할하여 처리
    if (type === 'meeting' && text.length > CHUNK_SIZE) {
        return await summarizeLongMeeting(text, CHUNK_SIZE);
    }

    return await summarizeChunk(text, type);
}

// 긴 회의 분할 요약
async function summarizeLongMeeting(text, chunkSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }

    console.log(`긴 회의 분할 처리: ${chunks.length}개 청크`);
    updateProgress('📝 AI 요약', 55, `총 ${chunks.length}개 청크`);

    // 각 청크별 요약
    const chunkSummaries = [];
    for (let i = 0; i < chunks.length; i++) {
        const percent = 55 + Math.floor((i / chunks.length) * 35);
        updateProgress('📝 AI 요약', percent, `청크 ${i + 1}/${chunks.length} 처리 중...`);
        console.log(`청크 ${i + 1}/${chunks.length} 요약 중...`);
        const summary = await summarizeChunk(chunks[i], 'meeting_chunk', i + 1, chunks.length);
        chunkSummaries.push(summary);
    }

    // 청크가 1개면 바로 반환
    if (chunkSummaries.length === 1) {
        return chunkSummaries[0];
    }

    // 여러 청크 요약을 통합
    updateProgress('🔄 통합 요약', 92, '최종 회의록 생성 중...');
    console.log('최종 통합 요약 생성 중...');
    const combinedSummaries = chunkSummaries.join('\n\n---\n\n');
    const finalSummary = await summarizeChunk(combinedSummaries, 'meeting_final');

    updateProgress('✅ 완료', 98, '저장 중...');
    return finalSummary;
}

// 단일 청크 요약
async function summarizeChunk(text, type, chunkNum = 0, totalChunks = 0) {
    const systemPrompt = `당신은 10년 경력의 전문 회의록 작성자입니다.

[절대 규칙]
1. 반드시 한국어로만 응답
2. 오직 제공된 녹취록 내용만 사용하여 작성
3. 녹취록에 없는 내용은 절대 추가하지 않음
4. 예시나 가상의 내용을 만들어내지 않음
5. 녹취 내용이 부족하면 "녹취 내용 부족"이라고 표시
6. 숫자/금액/수량/비율/날짜는 녹취록에 있는 것만 기재`;

    const prompts = {
        meeting: `[중요] 아래 녹취록 내용만을 바탕으로 회의록을 작성하세요.
녹취록에 없는 내용은 절대 추가하지 마세요.
내용이 부족하면 해당 항목에 "내용 없음" 또는 "녹취 내용 부족"이라고 적으세요.

========================================
                 회 의 록
========================================

1. 회의 개요
   - 회의명:
   - 일시:
   - 참석자:
   - 회의 목적:

2. 안건 및 논의 내용
   [안건]
   ▶ 현황
   ▶ 논의 내용
   ▶ 제안/대안

3. 주요 수치 및 데이터

4. 결정 사항

5. 향후 계획

6. 특이사항

========================================

[녹취록 시작]
${text}
[녹취록 끝]

위 녹취록 내용만으로 회의록을 작성하세요:`,
        meeting_chunk: `[절대 규칙] 녹취록에 있는 내용만 작성하세요. 없는 내용을 만들어내지 마세요.

다음은 회의 녹취록 파트 ${chunkNum}/${totalChunks}입니다.

■ 논의 안건:
■ 논의 내용:
■ 언급된 수치:
■ 결정사항:

[녹취록 파트 ${chunkNum}/${totalChunks} 시작]
${text}
[녹취록 끝]

위 녹취록 내용만으로 정리:`,
        meeting_final: `[절대 규칙] 아래 파트별 정리 내용에 있는 것만 통합하세요. 없는 내용을 추가하지 마세요.

다음 파트별 정리 내용을 하나의 회의록으로 통합하세요.

========================================
                 회 의 록
========================================

1. 회의 개요
2. 안건 및 논의 내용
3. 주요 수치 및 데이터
4. 결정 사항
5. 향후 계획
6. 특이사항

========================================

[파트별 정리 내용 시작]
${text}
[파트별 정리 끝]

위 내용만으로 통합 회의록 작성:`,
        document: `[지시사항] 반드시 한국어로 작성하세요.

다음 문서의 핵심 내용을 정리해주세요:
- 문서의 목적
- 주요 내용 (항목별)
- 핵심 결론

${text}

[문서 정리]:`,
        document_changes: `[지시사항] 반드시 한국어로 작성하세요.

문서 변경사항을 정리해주세요:

${text}

[변경사항 정리]:`
    };

    const prompt = prompts[type] || prompts.meeting;

    // 타입별 출력 토큰 수 설정
    const tokenLimits = {
        meeting: 3000,           // 단일 회의록: 충분한 상세 내용
        meeting_chunk: 2000,     // 청크별 요약: 핵심 내용 + 수치
        meeting_final: 4000,     // 최종 통합: 모든 내용 포함
        document: 1500,
        document_changes: 1000
    };
    const numPredict = tokenLimits[type] || 2000;

    try {
        const result = await callAI(prompt, systemPrompt, numPredict);
        return result || '요약 생성 실패';
    } catch (error) {
        throw new Error(`요약 생성 오류: ${error.message}`);
    }
}

// 변경 내용 AI 분석
async function analyzeChangeWithOllama(changeContent) {
    const systemPrompt = `당신은 문서 변경 분석 전문가입니다. 변경 내용을 분석하여 핵심적인 변경 사항을 요약해주세요.

[분석 규칙]
1. 반드시 한국어로 응답 (한자/중국어 문자 절대 사용 금지)
2. 어느 부분(섹션/위치)에서 어떤 내용이 변경되었는지 명확히 설명
3. 추가된 내용과 삭제된 내용을 비교하여 의미있는 변경사항 도출
4. 숫자, 날짜, 금액 등의 변경은 구체적으로 명시 (예: "12/15 → 12/20으로 변경")
5. 간결하고 핵심만 전달 (3-5개 항목)
6. 각 항목은 "📍 위치:" 와 "→ 변경 내용:" 형식으로 작성
7. 중요: 한자(漢字)나 중국어 문자를 절대 사용하지 마세요. 모든 텍스트는 순수 한글과 영문/숫자만 사용하세요.`;

    const prompt = `다음 문서의 변경 내용을 분석하여 핵심 변경 사항을 요약해주세요.

${changeContent}

[분석 결과]
(각 변경 사항을 다음 형식으로 작성)
📍 위치: (변경이 발생한 섹션/부분)
→ 변경 내용: (구체적인 변경 설명)

분석:`;

    try {
        const result = await callAI(prompt, systemPrompt, 800);
        return result || '분석 결과를 생성할 수 없습니다.';
    } catch (error) {
        throw new Error(`분석 오류: ${error.message}`);
    }
}

// LLM 채팅 함수
// LLM 데이터 검색 함수들
function searchDocHistory(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    for (const [key, value] of Object.entries(docHistory)) {
        const fileName = value.fileName || key;
        const content = value.content?.text || JSON.stringify(value.content);
        const changes = value.changes || [];

        // 파일명 또는 내용에서 검색
        if (fileName.toLowerCase().includes(lowerQuery) ||
            content.toLowerCase().includes(lowerQuery)) {
            results.push({
                type: 'document',
                fileName: fileName,
                analyzedAt: value.analyzedAt,
                preview: content.substring(0, 200) + '...',
                changeCount: changes.length
            });
        }

        // 변경 내역에서 검색
        changes.forEach((change, idx) => {
            const changeSummary = change.aiSummary || change.summary || '';
            const changeImprovement = change.improvement || '';
            if (changeSummary.toLowerCase().includes(lowerQuery) ||
                changeImprovement.toLowerCase().includes(lowerQuery)) {
                results.push({
                    type: 'change',
                    fileName: fileName,
                    changeIndex: idx + 1,
                    timestamp: change.timestamp,
                    summary: changeSummary.substring(0, 150),
                    improvement: changeImprovement.substring(0, 150)
                });
            }
        });
    }

    return results.slice(0, 10); // 최대 10개 결과
}

function searchMeetings(query) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    meetings.forEach(meeting => {
        const title = meeting.title || '';
        const transcript = meeting.transcript || '';
        const summary = meeting.summary || '';

        if (title.toLowerCase().includes(lowerQuery) ||
            transcript.toLowerCase().includes(lowerQuery) ||
            summary.toLowerCase().includes(lowerQuery)) {
            results.push({
                id: meeting.id,
                title: meeting.title,
                createdAt: meeting.createdAt,
                duration: meeting.duration,
                hasSummary: !!meeting.summary,
                preview: (transcript || summary).substring(0, 200) + '...'
            });
        }
    });

    return results.slice(0, 10);
}

function getRecentDocuments(limit = 5) {
    const docs = Object.entries(docHistory)
        .map(([key, value]) => ({
            fileName: value.fileName || key,
            analyzedAt: value.analyzedAt,
            changeCount: (value.changes || []).length
        }))
        .sort((a, b) => new Date(b.analyzedAt) - new Date(a.analyzedAt))
        .slice(0, limit);
    return docs;
}

function getRecentMeetings(limit = 5) {
    return meetings
        .slice(0, limit)
        .map(m => ({
            id: m.id,
            title: m.title,
            createdAt: m.createdAt,
            duration: m.duration,
            hasSummary: !!m.summary
        }));
}

function getMeetingDetails(meetingId) {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) return null;
    return {
        id: meeting.id,
        title: meeting.title,
        createdAt: meeting.createdAt,
        duration: meeting.duration,
        transcript: meeting.transcript,
        summary: meeting.summary
    };
}

function getDocumentChanges(fileName) {
    for (const [key, value] of Object.entries(docHistory)) {
        if ((value.fileName || key).includes(fileName)) {
            return {
                fileName: value.fileName || key,
                changes: (value.changes || []).map((c, idx) => ({
                    index: idx + 1,
                    timestamp: c.timestamp,
                    summary: c.aiSummary || c.summary,
                    improvement: c.improvement
                }))
            };
        }
    }
    return null;
}

// LLM 명령어 파싱 및 실행
function parseLLMCommand(message) {
    const lowerMsg = message.toLowerCase();

    // 감시 중인 폴더 조회
    if ((lowerMsg.includes('감시') || lowerMsg.includes('모니터링') || lowerMsg.includes('워치')) &&
        (lowerMsg.includes('폴더') || lowerMsg.includes('경로') || lowerMsg.includes('목록') || lowerMsg.includes('뭐'))) {
        return { action: 'list_watched_folders' };
    }

    // 현재 상태 확인
    if (lowerMsg.includes('현재') && (lowerMsg.includes('상태') || lowerMsg.includes('현황'))) {
        return { action: 'get_status' };
    }

    // 검색 명령어
    if (lowerMsg.includes('검색') || lowerMsg.includes('찾아')) {
        // 문서/모니터링 검색
        if (lowerMsg.includes('문서') || lowerMsg.includes('모니터링') || lowerMsg.includes('파일')) {
            const searchTermMatch = message.match(/['""]([^'""]+)['""]/);
            if (searchTermMatch) {
                return { action: 'search_docs', query: searchTermMatch[1] };
            }
            // 따옴표 없이 검색어 추출 시도
            const words = message.replace(/문서|모니터링|파일|검색|찾아|줘|해|봐/g, '').trim();
            if (words.length > 0) {
                return { action: 'search_docs', query: words };
            }
        }
        // 회의록 검색
        if (lowerMsg.includes('회의') || lowerMsg.includes('회의록')) {
            const searchTermMatch = message.match(/['""]([^'""]+)['""]/);
            if (searchTermMatch) {
                return { action: 'search_meetings', query: searchTermMatch[1] };
            }
            const words = message.replace(/회의록|회의|검색|찾아|줘|해|봐/g, '').trim();
            if (words.length > 0) {
                return { action: 'search_meetings', query: words };
            }
        }
    }

    // 최근 항목 조회
    if (lowerMsg.includes('최근') || lowerMsg.includes('리스트') || lowerMsg.includes('목록')) {
        if (lowerMsg.includes('문서') || lowerMsg.includes('모니터링') || lowerMsg.includes('파일')) {
            return { action: 'list_recent_docs' };
        }
        if (lowerMsg.includes('회의') || lowerMsg.includes('회의록')) {
            return { action: 'list_recent_meetings' };
        }
    }

    // 회의록 상세 조회
    if (lowerMsg.includes('회의록') && (lowerMsg.includes('보여') || lowerMsg.includes('내용'))) {
        const idMatch = message.match(/meeting_\d+/);
        if (idMatch) {
            return { action: 'get_meeting', meetingId: idMatch[0] };
        }
    }

    // 문서 변경 내역 조회
    if ((lowerMsg.includes('변경') || lowerMsg.includes('수정')) &&
        (lowerMsg.includes('내역') || lowerMsg.includes('기록') || lowerMsg.includes('히스토리'))) {
        const fileMatch = message.match(/['""]([^'""]+)['""]/);
        if (fileMatch) {
            return { action: 'get_doc_changes', fileName: fileMatch[1] };
        }
    }

    // 회의 녹음 시작 명령 - 실제 API 호출 트리거
    if (lowerMsg.includes('녹음') && (lowerMsg.includes('시작') || lowerMsg.includes('해줘') || lowerMsg.includes('해 줘'))) {
        return { action: 'start_recording', triggerAction: true };
    }

    // 회의록 생성/요약 명령 - 실제 API 호출 트리거
    if (lowerMsg.includes('회의록') && (lowerMsg.includes('생성') || lowerMsg.includes('만들어') || lowerMsg.includes('작성') || lowerMsg.includes('새'))) {
        return { action: 'create_meeting', triggerAction: true };
    }

    // 요약 명령 - 실제 API 호출 트리거
    if (lowerMsg.includes('요약') && lowerMsg.includes('회의')) {
        const idMatch = message.match(/meeting_\d+/);
        if (idMatch) {
            return { action: 'summarize_meeting', meetingId: idMatch[0], triggerAction: true };
        }
        // ID 없이 최근 회의록 요약 요청
        return { action: 'summarize_latest_meeting', triggerAction: true };
    }

    // 날짜/시간별 문서 변경 검색
    if ((lowerMsg.includes('몇시') || lowerMsg.includes('몇일') || lowerMsg.includes('언제') ||
         lowerMsg.includes('오늘') || lowerMsg.includes('어제') || lowerMsg.includes('이번주')) &&
        (lowerMsg.includes('변경') || lowerMsg.includes('수정') || lowerMsg.includes('변화'))) {
        // 날짜 추출 시도
        let dateFilter = null;
        if (lowerMsg.includes('오늘')) {
            dateFilter = 'today';
        } else if (lowerMsg.includes('어제')) {
            dateFilter = 'yesterday';
        } else if (lowerMsg.includes('이번주') || lowerMsg.includes('이번 주')) {
            dateFilter = 'this_week';
        } else if (lowerMsg.includes('이번달') || lowerMsg.includes('이번 달')) {
            dateFilter = 'this_month';
        }
        return { action: 'search_changes_by_date', dateFilter };
    }

    // 파일명으로 검색 (like 검색)
    if ((lowerMsg.includes('파일') || lowerMsg.includes('문서')) &&
        (lowerMsg.includes('이름') || lowerMsg.includes('명') || lowerMsg.includes('찾아'))) {
        const searchTermMatch = message.match(/['""]([^'""]+)['""]/);
        if (searchTermMatch) {
            return { action: 'search_docs_by_filename', query: searchTermMatch[1] };
        }
        // 따옴표 없이 검색어 추출
        const words = message.replace(/파일|문서|이름|명|으로|검색|찾아|줘|해|봐/g, '').trim();
        if (words.length > 0) {
            return { action: 'search_docs_by_filename', query: words };
        }
    }

    // 회의명으로 검색 (like 검색)
    if ((lowerMsg.includes('회의') || lowerMsg.includes('회의록')) &&
        (lowerMsg.includes('이름') || lowerMsg.includes('제목') || lowerMsg.includes('명') || lowerMsg.includes('찾아'))) {
        const searchTermMatch = message.match(/['""]([^'""]+)['""]/);
        if (searchTermMatch) {
            return { action: 'search_meetings_by_title', query: searchTermMatch[1] };
        }
        // 따옴표 없이 검색어 추출
        const words = message.replace(/회의록|회의|이름|제목|명|으로|검색|찾아|줘|해|봐/g, '').trim();
        if (words.length > 0) {
            return { action: 'search_meetings_by_title', query: words };
        }
    }

    // 도움말 요청
    if (lowerMsg.includes('도움말') || lowerMsg.includes('사용법') || lowerMsg.includes('뭘 할 수 있') || lowerMsg.includes('기능')) {
        return { action: 'show_help' };
    }

    return null;
}

// 명령 실행 결과를 LLM 컨텍스트에 추가
function executeCommand(command) {
    switch (command.action) {
        case 'search_docs': {
            const results = searchDocHistory(command.query);
            if (results.length === 0) {
                return `"${command.query}"에 대한 문서 검색 결과가 없습니다.`;
            }
            let response = `"${command.query}" 검색 결과 (${results.length}건):\n\n`;
            results.forEach((r, i) => {
                if (r.type === 'document') {
                    response += `${i+1}. [문서] ${r.fileName}\n   - 분석일시: ${new Date(r.analyzedAt).toLocaleString('ko-KR')}\n   - 변경 횟수: ${r.changeCount}회\n\n`;
                } else {
                    response += `${i+1}. [변경] ${r.fileName} (${r.changeIndex}번째 변경)\n   - 요약: ${r.summary}\n\n`;
                }
            });
            return response;
        }

        case 'search_meetings': {
            const results = searchMeetings(command.query);
            if (results.length === 0) {
                return `"${command.query}"에 대한 회의록 검색 결과가 없습니다.`;
            }
            let response = `"${command.query}" 회의록 검색 결과 (${results.length}건):\n\n`;
            results.forEach((r, i) => {
                response += `${i+1}. ${r.title || '제목 없음'}\n   - ID: ${r.id}\n   - 일시: ${new Date(r.createdAt).toLocaleString('ko-KR')}\n   - 요약 여부: ${r.hasSummary ? '있음' : '없음'}\n\n`;
            });
            return response;
        }

        case 'list_recent_docs': {
            const docs = getRecentDocuments(5);
            if (docs.length === 0) {
                return '저장된 문서가 없습니다.';
            }
            let response = '최근 문서 목록:\n\n';
            docs.forEach((d, i) => {
                response += `${i+1}. ${d.fileName}\n   - 분석일시: ${new Date(d.analyzedAt).toLocaleString('ko-KR')}\n   - 변경 횟수: ${d.changeCount}회\n\n`;
            });
            return response;
        }

        case 'list_recent_meetings': {
            const mtgs = getRecentMeetings(5);
            if (mtgs.length === 0) {
                return '저장된 회의록이 없습니다.';
            }
            let response = '최근 회의록 목록:\n\n';
            mtgs.forEach((m, i) => {
                response += `${i+1}. ${m.title || '제목 없음'}\n   - ID: ${m.id}\n   - 일시: ${new Date(m.createdAt).toLocaleString('ko-KR')}\n   - 녹음 시간: ${m.duration || '알 수 없음'}\n   - 요약: ${m.hasSummary ? '있음' : '없음'}\n\n`;
            });
            return response;
        }

        case 'get_meeting': {
            const meeting = getMeetingDetails(command.meetingId);
            if (!meeting) {
                return `회의록 ${command.meetingId}를 찾을 수 없습니다.`;
            }
            let response = `회의록 상세 정보:\n\n`;
            response += `제목: ${meeting.title || '제목 없음'}\n`;
            response += `ID: ${meeting.id}\n`;
            response += `일시: ${new Date(meeting.createdAt).toLocaleString('ko-KR')}\n`;
            response += `녹음 시간: ${meeting.duration || '알 수 없음'}\n\n`;
            if (meeting.summary) {
                response += `[요약]\n${meeting.summary}\n\n`;
            }
            if (meeting.transcript) {
                response += `[녹취록]\n${meeting.transcript.substring(0, 500)}${meeting.transcript.length > 500 ? '...(생략)' : ''}\n`;
            }
            return response;
        }

        case 'get_doc_changes': {
            const doc = getDocumentChanges(command.fileName);
            if (!doc) {
                return `"${command.fileName}" 문서를 찾을 수 없습니다.`;
            }
            let response = `${doc.fileName} 변경 내역:\n\n`;
            if (doc.changes.length === 0) {
                response += '변경 내역이 없습니다.';
            } else {
                doc.changes.forEach(c => {
                    response += `[${c.index}번째 변경] ${new Date(c.timestamp).toLocaleString('ko-KR')}\n`;
                    if (c.summary) response += `요약: ${c.summary.substring(0, 200)}\n`;
                    if (c.improvement) response += `개선점: ${c.improvement.substring(0, 200)}\n`;
                    response += '\n';
                });
            }
            return response;
        }

        case 'start_recording':
            return '[명령] 회의 녹음을 시작하려면 화면 상단의 "회의록" 메뉴를 클릭하고 "새 회의 녹음" 버튼을 눌러주세요.\n\n녹음이 시작되면 실시간으로 음성이 텍스트로 변환됩니다.';

        case 'create_meeting':
            return '[명령] 새 회의록을 생성하려면 화면 상단의 "회의록" 메뉴에서 "새 회의 녹음" 버튼을 클릭해주세요.\n\n녹음 완료 후 AI가 자동으로 요약을 생성할 수 있습니다.';

        case 'summarize_meeting':
            return `[명령] 회의록 ${command.meetingId}의 요약을 요청하셨습니다.\n\n회의록 상세 화면에서 "AI 요약" 버튼을 클릭하면 AI가 회의 내용을 요약해줍니다.`;

        case 'summarize_latest_meeting': {
            const mtgs = getRecentMeetings(1);
            if (mtgs.length === 0) {
                return '저장된 회의록이 없습니다.';
            }
            const latest = mtgs[0];
            return `[최근 회의록 정보]\n제목: ${latest.title || '제목 없음'}\nID: ${latest.id}\n일시: ${new Date(latest.createdAt).toLocaleString('ko-KR')}\n\n이 회의록을 요약하려면 회의록 상세 화면에서 "AI 요약" 버튼을 클릭해주세요.`;
        }

        case 'list_watched_folders': {
            if (watchedFolders.length === 0) {
                return '현재 감시 중인 폴더가 없습니다.\n\n폴더를 추가하려면 화면 상단의 "모니터링" 메뉴에서 "폴더 추가" 버튼을 클릭해주세요.';
            }
            let response = `현재 감시 중인 폴더/파일 (${watchedFolders.length}개):\n\n`;
            watchedFolders.forEach((folder, i) => {
                const fileName = path.basename(folder);
                const isFile = folder.includes('.') && !fs.existsSync(folder) ? '파일' : (fs.statSync(folder).isFile() ? '파일' : '폴더');
                response += `${i+1}. [${isFile}] ${fileName}\n   경로: ${folder}\n\n`;
            });
            return response;
        }

        case 'get_status': {
            let response = '=== DocWatch 현재 상태 ===\n\n';
            response += `감시 중인 폴더/파일: ${watchedFolders.length}개\n`;
            response += `저장된 문서: ${Object.keys(documentHistory).length}개\n`;
            response += `저장된 회의록: ${meetings.length}개\n\n`;

            // 최근 변경사항
            const recentDocs = getRecentDocuments(3);
            if (recentDocs.length > 0) {
                response += '[최근 문서 변경]\n';
                recentDocs.forEach(d => {
                    response += `- ${d.fileName} (${new Date(d.analyzedAt).toLocaleString('ko-KR')})\n`;
                });
            }
            return response;
        }

        case 'search_changes_by_date': {
            const now = new Date();
            let startDate, endDate = now;

            switch (command.dateFilter) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'yesterday':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'this_week':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                    break;
                case 'this_month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    break;
                default:
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
            }

            const results = [];
            for (const key of Object.keys(documentHistory)) {
                const doc = documentHistory[key];
                if (doc.changes && doc.changes.length > 0) {
                    doc.changes.forEach(change => {
                        const changeDate = new Date(change.timestamp || change.analyzedAt);
                        if (changeDate >= startDate && changeDate <= endDate) {
                            results.push({
                                fileName: doc.fileName,
                                timestamp: changeDate,
                                summary: change.summary || change.aiSummary || '요약 없음'
                            });
                        }
                    });
                }
            }

            if (results.length === 0) {
                const dateLabel = command.dateFilter === 'today' ? '오늘' :
                                  command.dateFilter === 'yesterday' ? '어제' :
                                  command.dateFilter === 'this_week' ? '이번 주' : '이번 달';
                return `${dateLabel} 변경된 문서가 없습니다.`;
            }

            results.sort((a, b) => b.timestamp - a.timestamp);
            let response = `문서 변경 내역 (${results.length}건):\n\n`;
            results.slice(0, 10).forEach((r, i) => {
                response += `${i+1}. ${r.fileName}\n`;
                response += `   - 시간: ${r.timestamp.toLocaleString('ko-KR')}\n`;
                response += `   - 요약: ${r.summary.substring(0, 100)}\n\n`;
            });
            return response;
        }

        case 'search_docs_by_filename': {
            const query = command.query.toLowerCase();
            const results = [];

            for (const key of Object.keys(documentHistory)) {
                const doc = documentHistory[key];
                if (doc.fileName && doc.fileName.toLowerCase().includes(query)) {
                    results.push({
                        fileName: doc.fileName,
                        analyzedAt: doc.analyzedAt,
                        changeCount: doc.changes ? doc.changes.length : 0
                    });
                }
            }

            if (results.length === 0) {
                return `"${command.query}" 파일명을 포함하는 문서를 찾을 수 없습니다.`;
            }

            results.sort((a, b) => new Date(b.analyzedAt) - new Date(a.analyzedAt));
            let response = `"${command.query}" 파일명 검색 결과 (${results.length}건):\n\n`;
            results.forEach((r, i) => {
                response += `${i+1}. ${r.fileName}\n`;
                response += `   - 분석일시: ${new Date(r.analyzedAt).toLocaleString('ko-KR')}\n`;
                response += `   - 변경 횟수: ${r.changeCount}회\n\n`;
            });
            return response;
        }

        case 'search_meetings_by_title': {
            const query = command.query.toLowerCase();
            const results = meetings.filter(m =>
                (m.title && m.title.toLowerCase().includes(query)) ||
                (m.name && m.name.toLowerCase().includes(query))
            );

            if (results.length === 0) {
                return `"${command.query}" 제목의 회의록을 찾을 수 없습니다.`;
            }

            let response = `"${command.query}" 회의록 검색 결과 (${results.length}건):\n\n`;
            results.forEach((m, i) => {
                response += `${i+1}. ${m.title || m.name || '제목 없음'}\n`;
                response += `   - ID: ${m.id}\n`;
                response += `   - 일시: ${new Date(m.createdAt).toLocaleString('ko-KR')}\n\n`;
            });
            return response;
        }

        case 'show_help': {
            return `=== DocWatch 스마트 어시스트 사용법 ===

[문서 모니터링]
• "감시 중인 폴더 보여줘" - 현재 모니터링 중인 폴더 목록
• "현재 상태 알려줘" - DocWatch 전체 현황
• "오늘 변경된 문서 보여줘" - 날짜별 문서 변경 검색
• "'파일명' 변경 내역 보여줘" - 특정 문서 변경 이력
• "문서에서 '키워드' 검색해줘" - 문서 내용 검색

[회의록]
• "최근 회의록 보여줘" - 최근 회의록 목록
• "회의록 제목 '키워드' 검색해줘" - 회의명으로 검색
• "회의록에서 '키워드' 검색해줘" - 회의 내용 검색
• "meeting_123456 회의록 내용 보여줘" - 특정 회의록 상세

[일반]
• 자유롭게 질문하시면 제가 도와드립니다!`;
        }

        default:
            return null;
    }
}

async function chatWithOllama(message, history) {
    // 먼저 명령어 파싱 시도
    const command = parseLLMCommand(message);
    let dataContext = '';

    if (command) {
        const commandResult = executeCommand(command);
        if (commandResult) {
            dataContext = `\n\n[시스템 데이터]\n${commandResult}\n\n위 데이터를 바탕으로 사용자에게 친절하게 답변해주세요.`;
        }
    }

    // 현재 상태 컨텍스트 생성
    const currentContext = `
[현재 DocWatch 상태]
- 감시 중인 폴더/파일: ${watchedFolders.length}개
- 저장된 문서: ${Object.keys(documentHistory).length}개
- 저장된 회의록: ${meetings.length}개
${watchedFolders.length > 0 ? `- 감시 목록: ${watchedFolders.slice(0, 3).map(f => path.basename(f)).join(', ')}${watchedFolders.length > 3 ? ' 외 ' + (watchedFolders.length - 3) + '개' : ''}` : ''}`;

    const systemPrompt = `당신은 DocWatch의 스마트 어시스트입니다. DocWatch는 문서 모니터링과 회의록 관리를 도와주는 로컬 업무 자동화 도구입니다.

${currentContext}

[당신의 역할]
1. 사용자의 문서 모니터링 관련 질문에 답변
2. 회의록 검색 및 관리 도움
3. 문서 변경 내역 확인 및 요약 제공
4. 업무 효율화 조언

[사용 가능한 기능]
- 감시 폴더: "감시 중인 폴더 보여줘", "현재 상태 알려줘"
- 문서 검색: "문서에서 '키워드' 검색해줘", "파일명 'CMS' 검색해줘"
- 날짜 검색: "오늘 변경된 문서 보여줘", "이번주 수정된 파일"
- 최근 문서: "최근 문서 목록 보여줘"
- 변경 내역: "'파일명' 변경 내역 보여줘"
- 회의록 검색: "회의록에서 '키워드' 검색해줘", "회의 제목 '기획' 검색"
- 최근 회의록: "최근 회의록 보여줘"
- 회의록 상세: "meeting_123456 회의록 내용 보여줘"
- 도움말: "도움말", "사용법"

[응답 규칙]
1. 반드시 한국어로 응답하세요 (한자/중국어 문자 절대 사용 금지)
2. 간결하고 명확하게 답변하세요
3. 데이터가 제공되면 그 데이터를 기반으로 답변하세요
4. 기능 사용법을 친절하게 안내하세요
5. 모르는 내용은 솔직히 모른다고 말하세요`;

    // 대화 기록을 프롬프트로 변환
    let conversationContext = '';
    if (history && history.length > 0) {
        history.forEach(msg => {
            if (msg.role === 'user') {
                conversationContext += `사용자: ${msg.content}\n`;
            } else if (msg.role === 'assistant') {
                conversationContext += `AI: ${msg.content}\n`;
            }
        });
    }

    const prompt = conversationContext
        ? `${conversationContext}사용자: ${message}${dataContext}\n\nAI:`
        : `사용자: ${message}${dataContext}\n\nAI:`;

    try {
        const result = await callAI(prompt, systemPrompt, 2048);
        return result || '응답을 생성할 수 없습니다.';
    } catch (error) {
        throw new Error(`응답 생성 오류: ${error.message}`);
    }
}

// ========================================
// 회의록 관련 함수
// ========================================

// UUID 생성 (간단 버전)
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 회의록 목록 로드
function loadMeetings() {
    try {
        if (fs.existsSync(MEETINGS_FILE)) {
            const data = fs.readFileSync(MEETINGS_FILE, 'utf8');
            meetings = JSON.parse(data);
            console.log(`회의록 로드 완료: ${meetings.length}개`);
        }
    } catch (e) {
        console.error('회의록 로드 실패:', e.message);
        meetings = [];
    }
}

// 회의록 목록 저장
function saveMeetings() {
    try {
        fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings, null, 2));
    } catch (e) {
        console.error('회의록 저장 실패:', e.message);
    }
}

// Whisper 초기화 (실제 구현 시 whisper.cpp 바인딩)
function initWhisper() {
    console.log('음성 인식 엔진 초기화 중...');
    // TODO: whisper.cpp 바인딩 로드
    // 현재는 시뮬레이션 모드
    setTimeout(() => {
        whisperReady = true;
        console.log('음성 인식 엔진 준비 완료 (시뮬레이션 모드)');
    }, 2000);
}

// 규칙 기반 회의록 분석
function analyzeTranscript(text) {
    // 결정 사항 추출 패턴
    const decisionPatterns = [
        /(?:결정|확정|정했|하기로|진행하자|하겠습니다|로\s*가자|로\s*결론)/g
    ];

    // 이슈 추출 패턴
    const issuePatterns = [
        /(?:문제|이슈|확인\s*필요|검토\s*필요|우려|어떻게\s*할|고민)/g
    ];

    // 액션 아이템 추출 패턴
    const actionPatterns = [
        /(?:해\s*주세요|해야|까지|담당|체크|확인해|준비해|보내|공유해)/g
    ];

    const lines = text.split(/[.!?]\s+/);
    const decisions = [];
    const issues = [];
    const actions = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

        for (const pattern of decisionPatterns) {
            if (pattern.test(trimmed)) {
                decisions.push(trimmed);
                break;
            }
        }

        for (const pattern of issuePatterns) {
            if (pattern.test(trimmed)) {
                issues.push(trimmed);
                break;
            }
        }

        for (const pattern of actionPatterns) {
            if (pattern.test(trimmed)) {
                actions.push(trimmed);
                break;
            }
        }
    });

    // 키워드 추출 (빈도 기반)
    const words = text.split(/\s+/).filter(w => w.length > 1);
    const freq = {};
    words.forEach(w => {
        const clean = w.replace(/[^가-힣a-zA-Z0-9]/g, '');
        if (clean.length > 1) {
            freq[clean] = (freq[clean] || 0) + 1;
        }
    });
    const keywords = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word]) => word);

    return {
        summary: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
        keywords,
        decisions: [...new Set(decisions)].slice(0, 5),
        issues: [...new Set(issues)].slice(0, 5),
        actions: [...new Set(actions)].slice(0, 10)
    };
}

// 원본 녹취록 생성
function generateTranscriptDoc(meeting) {
    return `========================================
        회의 녹취록 (원본)
========================================

■ 기본 정보
────────────────────────────────────────
회의 제목: ${meeting.title}
회의 일시: ${new Date(meeting.createdAt).toLocaleString('ko-KR')}
녹음 파일: ${meeting.audioFile}
생성 일시: ${new Date().toLocaleString('ko-KR')}

■ 전체 녹취록
────────────────────────────────────────
${meeting.transcript}

========================================
DocWatch로 자동 생성됨
========================================
`;
}

// AI 요약본 생성
function generateSummaryDoc(meeting, aiSummary) {
    return `========================================
        회의록 요약본
========================================

■ 기본 정보
────────────────────────────────────────
회의 제목: ${meeting.title}
회의 일시: ${new Date(meeting.createdAt).toLocaleString('ko-KR')}
요약 생성: ${new Date().toLocaleString('ko-KR')}
AI 모델: TinyLlama (로컬)

■ AI 요약
────────────────────────────────────────
${aiSummary}

========================================
DocWatch AI로 자동 요약됨
본 요약은 참고용이며 검토가 필요합니다
========================================
`;
}

// Multipart 파싱 (간단 버전)
function parseMultipart(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('multipart/form-data')) {
            return reject(new Error('Invalid content type'));
        }

        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            return reject(new Error('No boundary found'));
        }

        let body = Buffer.alloc(0);
        req.on('data', chunk => {
            body = Buffer.concat([body, chunk]);
        });

        req.on('end', () => {
            try {
                // boundary를 Buffer로 찾기
                const boundaryBuffer = Buffer.from('--' + boundary);
                const bodyStr = body.toString('binary');
                const parts = bodyStr.split('--' + boundary);

                for (const part of parts) {
                    if (part.includes('filename=')) {
                        // 헤더 부분만 UTF-8로 디코딩하여 파일명 추출
                        const headerEnd = part.indexOf('\r\n\r\n');
                        if (headerEnd > 0) {
                            const headerPart = part.substring(0, headerEnd);
                            // 헤더를 바이너리에서 버퍼로 변환 후 UTF-8로 디코딩
                            const headerBuffer = Buffer.from(headerPart, 'binary');
                            const headerStr = headerBuffer.toString('utf8');

                            // filename 추출 (filename*=UTF-8'' 형식도 지원)
                            let filename = 'audio.wav';
                            const filenameStarMatch = headerStr.match(/filename\*=UTF-8''([^\r\n;]+)/i);
                            if (filenameStarMatch) {
                                filename = decodeURIComponent(filenameStarMatch[1]);
                            } else {
                                const filenameMatch = headerStr.match(/filename="([^"]+)"/);
                                if (filenameMatch) {
                                    filename = filenameMatch[1];
                                }
                            }

                            const fileContent = part.substring(headerEnd + 4);
                            // 끝의 \r\n-- 제거
                            const cleanContent = fileContent.replace(/\r\n--$/, '');
                            resolve({
                                filename,
                                content: Buffer.from(cleanContent, 'binary')
                            });
                            return;
                        }
                    }
                }
                reject(new Error('No file found in request'));
            } catch (e) {
                reject(e);
            }
        });

        req.on('error', reject);
    });
}

// 정적 파일 서빙
function serveStatic(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// Content-Type 결정
function getContentType(ext) {
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };
    return types[ext] || 'text/plain; charset=utf-8';
}

// 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// JSON 바디 파싱
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// HTTP 서버
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // CORS 헤더
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        // API: 폴더 목록
        if (pathname === '/api/folders' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ folders: watchedFolders }));
            return;
        }

        if (pathname === '/api/folders' && req.method === 'POST') {
            const { folder } = await parseBody(req);
            if (folder && !watchedFolders.includes(folder)) {
                watchedFolders.push(folder);
                saveConfig();
                startWatching(folder);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '유효하지 않거나 이미 등록된 폴더' }));
            }
            return;
        }

        if (pathname === '/api/folders' && req.method === 'DELETE') {
            const { folder } = await parseBody(req);
            const index = watchedFolders.indexOf(folder);
            if (index > -1) {
                stopWatching(folder);
                watchedFolders.splice(index, 1);
                saveConfig();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '폴더를 찾을 수 없음' }));
            }
            return;
        }

        // API: 폴더 열기 (Finder/탐색기)
        if (pathname === '/api/folder/open' && req.method === 'POST') {
            const { folder } = await parseBody(req);
            if (!folder) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '폴더 경로가 필요합니다' }));
                return;
            }

            try {
                const { exec } = require('child_process');
                const platform = process.platform;
                let command;

                if (platform === 'darwin') {
                    // macOS
                    command = `open "${folder}"`;
                } else if (platform === 'win32') {
                    // Windows
                    command = `explorer "${folder}"`;
                } else {
                    // Linux
                    command = `xdg-open "${folder}"`;
                }

                exec(command, (error) => {
                    if (error) {
                        console.error('폴더 열기 실패:', error);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: '폴더를 열 수 없습니다' }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                });
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // API: 파일 위치 열기 (Finder/탐색기에서 파일 선택)
        if (pathname === '/api/file/open' && req.method === 'POST') {
            const { file } = await parseBody(req);
            if (!file) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '파일 경로가 필요합니다' }));
                return;
            }

            try {
                const { exec } = require('child_process');
                const platform = process.platform;
                let command;

                if (platform === 'darwin') {
                    // macOS: Finder에서 파일 선택 상태로 열기
                    command = `open -R "${file}"`;
                } else if (platform === 'win32') {
                    // Windows: 탐색기에서 파일 선택 상태로 열기
                    command = `explorer /select,"${file}"`;
                } else {
                    // Linux: 파일이 있는 폴더 열기
                    const folderPath = path.dirname(file);
                    command = `xdg-open "${folderPath}"`;
                }

                exec(command, (error) => {
                    if (error) {
                        console.error('파일 열기 실패:', error);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: '파일을 열 수 없습니다' }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                });
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // API: 로그
        if (pathname === '/api/logs' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ logs: changeLog }));
            return;
        }

        if (pathname === '/api/logs' && req.method === 'DELETE') {
            changeLog = [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // API: 로그 내보내기 (CSV)
        if (pathname === '/api/logs/export' && req.method === 'GET') {
            const csv = generateCSV(changeLog);
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': 'attachment; filename="folder-watch-log.csv"'
            });
            res.end(csv);
            return;
        }

        // API: 통계
        if (pathname === '/api/stats' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(stats));
            return;
        }

        if (pathname === '/api/stats' && req.method === 'DELETE') {
            stats = {
                created: 0,
                modified: 0,
                deleted: 0,
                byExtension: {},
                byHour: Array(24).fill(0)
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // API: 문서 검색
        if (pathname === '/api/search/docs' && req.method === 'GET') {
            const query = url.searchParams.get('q') || '';
            const q = query.toLowerCase();

            // documentHistory에서 검색
            const results = [];
            for (const [key, doc] of Object.entries(documentHistory)) {
                const fileName = (doc.fileName || '').toLowerCase();
                const folder = (doc.folder || key.split('/').slice(0, -1).join('/') || '').toLowerCase();

                if (fileName.includes(q) || folder.includes(q)) {
                    results.push({
                        key,
                        fileName: doc.fileName,
                        folder: doc.folder || key.split('/').slice(0, -1).join('/'),
                        analyzedAt: doc.analyzedAt
                    });
                }
            }

            // 최근 분석순 정렬
            results.sort((a, b) => new Date(b.analyzedAt || 0) - new Date(a.analyzedAt || 0));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(results.slice(0, 10)));
            return;
        }

        // API: 회의록 검색
        if (pathname === '/api/search/meetings' && req.method === 'GET') {
            const query = url.searchParams.get('q') || '';
            const q = query.toLowerCase();

            const results = meetings.filter(meeting => {
                const title = (meeting.title || '').toLowerCase();
                const id = (meeting.id || '').toLowerCase();
                const transcript = (meeting.transcript || '').toLowerCase();
                const summary = (meeting.summary || '').toLowerCase();

                return title.includes(q) || id.includes(q) || transcript.includes(q) || summary.includes(q);
            }).map(meeting => ({
                id: meeting.id,
                title: meeting.title || meeting.id,
                date: meeting.date || meeting.createdAt,
                duration: meeting.duration
            }));

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(results.slice(0, 10)));
            return;
        }

        // API: 문서 분석 (PPTX, DOCX, XLSX)
        if (pathname === '/api/document/analyze' && req.method === 'POST') {
            const { filePath } = await parseBody(req);
            if (!filePath) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '파일 경로가 필요합니다.' }));
                return;
            }

            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다.' }));
                return;
            }

            const result = await analyzeDocument(filePath);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            return;
        }

        // API: 문서 이력 조회
        if (pathname === '/api/document/history' && req.method === 'GET') {
            const histories = Object.entries(documentHistory).map(([key, value]) => ({
                key,
                fileName: value.fileName,
                analyzedAt: value.analyzedAt
            }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ histories }));
            return;
        }

        // API: 문서 이력 삭제
        if (pathname === '/api/document/history' && req.method === 'DELETE') {
            const { key } = await parseBody(req);
            if (key && documentHistory[key]) {
                delete documentHistory[key];
                saveDocHistory();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else if (!key) {
                // 전체 삭제
                documentHistory = {};
                saveDocHistory();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '이력을 찾을 수 없습니다.' }));
            }
            return;
        }

        // API: 설정
        if (pathname === '/api/settings' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(settings));
            return;
        }

        if (pathname === '/api/settings' && req.method === 'PUT') {
            const newSettings = await parseBody(req);
            settings = { ...settings, ...newSettings };
            saveSettings();
            restartAllWatchers();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // API: 알림 설정
        if (pathname === '/api/settings/notifications' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(settings.notifications));
            return;
        }

        // API: 텔레그램 테스트
        if (pathname === '/api/telegram/test' && req.method === 'POST') {
            sendTelegramNotification('🔔 테스트 알림입니다!\nDocWatch와 연결되었습니다.');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // ========================================
        // 라이선스 API
        // ========================================

        // API: 앱 환경 확인 (Electron 앱 vs 웹 브라우저)
        if (pathname === '/api/app/environment' && req.method === 'GET') {
            // Electron에서 실행 중인지 확인
            const isElectron = process.versions && process.versions.electron;
            const userAgent = req.headers['user-agent'] || '';
            const isElectronUA = userAgent.includes('Electron');

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                isApp: isElectron || isElectronUA,
                isWeb: !isElectron && !isElectronUA,
                environment: isElectron || isElectronUA ? 'electron' : 'web',
                features: {
                    // 웹에서는 녹음, 파일 감시 등 제한
                    recording: isElectron || isElectronUA,
                    fileWatching: isElectron || isElectronUA,
                    documentAnalysis: true,  // 웹에서도 허용
                    meetingView: true        // 웹에서도 허용
                }
            }));
            return;
        }

        // API: 라이선스 상태 조회
        if (pathname === '/api/license/status' && req.method === 'GET') {
            const status = license.getLicenseStatus();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(status));
            return;
        }

        // API: 기기 ID 조회 (오프라인 활성화용)
        if (pathname === '/api/license/machine-id' && req.method === 'GET') {
            const machineId = license.generateMachineId();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ machineId }));
            return;
        }

        // API: 온라인 라이선스 활성화
        if (pathname === '/api/license/activate' && req.method === 'POST') {
            try {
                const { licenseKey } = await parseBody(req);
                if (!licenseKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '라이선스 키가 필요합니다.' }));
                    return;
                }

                const result = await license.activateOnline(licenseKey);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // API: 오프라인 라이선스 활성화
        if (pathname === '/api/license/activate-offline' && req.method === 'POST') {
            try {
                const { offlineKey } = await parseBody(req);
                if (!offlineKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '오프라인 키가 필요합니다.' }));
                    return;
                }

                const result = license.activateOffline(offlineKey);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // API: Trial 리셋 (개발용)
        if (pathname === '/api/license/reset-trial' && req.method === 'POST') {
            const result = license.resetTrial();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            return;
        }

        // API: Pro/Trial 토글 (개발용)
        // API: 개발 모드 확인
        if (pathname === '/api/dev-mode' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ devMode: DEV_MODE }));
            return;
        }

        // API: Pro 라이선스 토글 (개발 모드에서만 사용 가능)
        if (pathname === '/api/license/toggle' && req.method === 'POST') {
            if (!DEV_MODE) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: '개발 모드에서만 사용 가능합니다' }));
                return;
            }
            const result = license.toggleLicenseType();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            return;
        }

        // API: 테스트 라이선스 활성화 (개발 모드에서만 사용 가능)
        // POST /api/license/activate-test { months: 3 } 또는 { days: 1 }
        if (pathname === '/api/license/activate-test' && req.method === 'POST') {
            if (!DEV_MODE) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: '개발 모드에서만 사용 가능합니다' }));
                return;
            }
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { months, days } = JSON.parse(body || '{}');
                    // days가 있으면 일 단위, 없으면 months 사용 (기본 3개월)
                    const result = license.activateTestLicense(months || 3, days || null);

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        // API: 기능 사용 가능 여부 확인
        if (pathname.startsWith('/api/license/can-use/') && req.method === 'GET') {
            const featureName = pathname.split('/').pop();
            const canUse = license.canUseFeature(featureName);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ feature: featureName, canUse }));
            return;
        }

        // ========================================
        // 회의록 API
        // ========================================

        // API: 처리 진행 상황
        if (pathname === '/api/processing/progress' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(processingProgress));
            return;
        }

        // API: Whisper 상태
        if (pathname === '/api/whisper/status' && req.method === 'GET') {
            checkWhisperModel();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ready: whisperReady,
                status: whisperReady ? '준비됨 (로컬)' : '모델 파일 필요',
                model: 'ggml-small',
                local: true,
                modelPath: WHISPER_MODEL_PATH,
                modelExists: whisperReady
            }));
            return;
        }

        // API: Ollama (로컬 LLM) 상태
        if (pathname === '/api/ollama/status' && req.method === 'GET') {
            const status = await checkOllamaStatus();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ...status,
                model: CURRENT_AI_MODEL,
                host: OLLAMA_HOST,
                availableModels: AVAILABLE_MODELS
            }));
            return;
        }

        // API: AI 모델 변경
        if (pathname === '/api/ollama/model' && req.method === 'POST') {
            try {
                const { model } = await parseBody(req);
                if (!AVAILABLE_MODELS[model]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '지원하지 않는 모델입니다' }));
                    return;
                }

                CURRENT_AI_MODEL = model;
                // settings에도 저장하여 재시작 후에도 유지
                settings.aiModel = model;
                saveSettings();
                console.log(`AI 모델 변경 및 저장: ${model}`);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    model: CURRENT_AI_MODEL,
                    modelInfo: AVAILABLE_MODELS[model]
                }));
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }

        // API: 사용 가능한 AI 모델 목록
        if (pathname === '/api/ollama/models' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                currentModel: CURRENT_AI_MODEL,
                availableModels: AVAILABLE_MODELS
            }));
            return;
        }

        // API: 변경 내용 AI 분석
        if (pathname === '/api/analyze/change' && req.method === 'POST') {
            try {
                const { fileName, added, removed, addedCount, removedCount, fileTypeInfo } = await parseBody(req);

                // Ollama 상태 확인
                const ollamaStatus = await checkOllamaStatus();
                if (!ollamaStatus.ready) {
                    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        error: '내장 AI가 실행 중이 아닙니다.'
                    }));
                    return;
                }

                // 분석할 내용이 없으면 에러
                if ((!added || added.length === 0) && (!removed || removed.length === 0)) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        error: '분석할 변경 내용이 없습니다.'
                    }));
                    return;
                }

                // 변경 내용 구성
                let changeContent = `파일: ${fileName}\n\n`;

                if (fileTypeInfo) {
                    if (fileTypeInfo.type === 'pptx') {
                        changeContent += `파일 형식: PowerPoint (${fileTypeInfo.currSlides}장)\n`;
                    } else if (fileTypeInfo.type === 'xlsx') {
                        changeContent += `파일 형식: Excel (${fileTypeInfo.currSheets}개 시트)\n`;
                    } else if (fileTypeInfo.type === 'text') {
                        changeContent += `파일 형식: 텍스트 (${fileTypeInfo.currLines}줄)\n`;
                    }
                }

                if (added && added.length > 0) {
                    changeContent += `\n[추가된 내용 ${addedCount}개]\n`;
                    added.forEach((item, i) => {
                        changeContent += `${i + 1}. ${item}\n`;
                    });
                }

                if (removed && removed.length > 0) {
                    changeContent += `\n[삭제된 내용 ${removedCount}개]\n`;
                    removed.forEach((item, i) => {
                        changeContent += `${i + 1}. ${item}\n`;
                    });
                }

                // AI 분석 요청
                const analysis = await analyzeChangeWithOllama(changeContent);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    analysis
                }));
            } catch (error) {
                console.error('변경 분석 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    error: error.message || '분석 중 오류가 발생했습니다.'
                }));
            }
            return;
        }

        // API: 대화 목록 조회
        if (pathname === '/api/conversations' && req.method === 'GET') {
            try {
                loadConversations();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    conversations: conversations.map(c => ({
                        id: c.id,
                        title: c.title,
                        messageCount: c.messages.length,
                        createdAt: c.createdAt,
                        updatedAt: c.updatedAt
                    }))
                }));
            } catch (error) {
                console.error('대화 목록 조회 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
            return;
        }

        // API: 새 대화 생성
        if (pathname === '/api/conversations' && req.method === 'POST') {
            try {
                const { title } = await parseBody(req);
                const conversation = createConversation(title);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    conversation
                }));
            } catch (error) {
                console.error('대화 생성 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
            return;
        }

        // API: 대화 상세 조회
        if (pathname.startsWith('/api/conversations/') && req.method === 'GET') {
            try {
                const conversationId = pathname.split('/').pop();
                loadConversations();
                const conversation = conversations.find(c => c.id === conversationId);

                if (!conversation) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '대화를 찾을 수 없습니다.' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    conversation
                }));
            } catch (error) {
                console.error('대화 조회 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
            return;
        }

        // API: 대화 삭제
        if (pathname.startsWith('/api/conversations/') && req.method === 'DELETE') {
            try {
                const conversationId = pathname.split('/').pop();
                const deleted = deleteConversation(conversationId);

                if (!deleted) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '대화를 찾을 수 없습니다.' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('대화 삭제 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
            return;
        }

        // API: LLM 채팅 (대화 ID 지원)
        if (pathname === '/api/llm/chat' && req.method === 'POST') {
            try {
                const { message, history, conversationId } = await parseBody(req);

                if (!message) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '메시지가 없습니다.' }));
                    return;
                }

                // Ollama 상태 확인
                const ollamaStatus = await checkOllamaStatus();
                if (!ollamaStatus.ready) {
                    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        error: '내장 AI가 실행 중이 아닙니다.'
                    }));
                    return;
                }

                // 대화 ID가 있으면 해당 대화에 메시지 저장
                let currentConversationId = conversationId;
                if (currentConversationId) {
                    loadConversations();
                    addMessageToConversation(currentConversationId, 'user', message);
                }

                // LLM 채팅 요청
                const response = await chatWithOllama(message, history || []);

                // 응답도 대화에 저장
                if (currentConversationId) {
                    addMessageToConversation(currentConversationId, 'assistant', response);
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    response,
                    conversationId: currentConversationId
                }));
            } catch (error) {
                console.error('LLM 채팅 오류:', error);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: false,
                    error: error.message || '응답 생성 중 오류가 발생했습니다.'
                }));
            }
            return;
        }

        // API: 회의록 AI 요약
        if (pathname === '/api/meeting/summarize' && req.method === 'POST') {
            try {
                const { meetingId, text } = await parseBody(req);

                // meetingId로 회의록 찾기 또는 직접 텍스트 사용
                let transcriptText = text;
                if (meetingId && !text) {
                    const meeting = meetings.find(m => m.id === meetingId);
                    if (!meeting) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: '회의록을 찾을 수 없습니다' }));
                        return;
                    }
                    transcriptText = meeting.transcript;
                }

                if (!transcriptText) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '요약할 텍스트가 없습니다' }));
                    return;
                }

                // 텍스트가 너무 짧은 경우 (의미있는 내용이 없음)
                // 타임스탬프 제거 후 실제 내용만 검사 (예: [00:00] 제거)
                const cleanedText = transcriptText.trim()
                    .replace(/\[\d{2}:\d{2}\]/g, '')  // 타임스탬프 제거
                    .replace(/\s+/g, ' ')
                    .trim();

                console.log('요약 요청 - 원본 길이:', transcriptText.length, '정리 후:', cleanedText.length);
                console.log('요약 대상 내용:', cleanedText.substring(0, 200));

                if (cleanedText.length < 50) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        error: '녹취 내용이 너무 짧습니다. 요약할 충분한 내용이 없습니다. (최소 50자 이상 필요)',
                        transcriptLength: cleanedText.length,
                        preview: cleanedText.substring(0, 100)
                    }));
                    return;
                }

                console.log(`[요약 요청] 텍스트 길이: ${cleanedText.length}자`);

                // Ollama 상태 확인
                updateProgress('🔍 AI 준비', 10, '내장 AI 확인 중...');
                const ollamaStatus = await checkOllamaStatus();
                if (!ollamaStatus.ready) {
                    clearProgress();
                    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        error: '내장 AI가 실행 중이 아닙니다.',
                        details: ollamaStatus.error
                    }));
                    return;
                }

                console.log('AI 요약 생성 중...');
                updateProgress('📝 AI 요약', 20, '회의록 분석 중...');
                const summary = await summarizeWithOllama(transcriptText, 'meeting');
                console.log('AI 요약 완료');
                updateProgress('✅ 완료', 95, '저장 중...');

                // 회의록에 요약 저장 (히스토리 방식)
                if (meetingId) {
                    const meeting = meetings.find(m => m.id === meetingId);
                    if (meeting) {
                        // 히스토리 배열 초기화
                        if (!meeting.summaryHistory) {
                            meeting.summaryHistory = [];
                            // 기존 요약이 있으면 히스토리에 추가
                            if (meeting.aiSummary) {
                                meeting.summaryHistory.push({
                                    summary: meeting.aiSummary,
                                    createdAt: meeting.summarizedAt || new Date().toISOString()
                                });
                            }
                        }
                        // 새 요약 추가
                        meeting.summaryHistory.push({
                            summary: summary,
                            createdAt: new Date().toISOString()
                        });
                        // 현재 요약 업데이트 (최신 버전)
                        meeting.aiSummary = summary;
                        meeting.summarizedAt = new Date().toISOString();
                        meeting.currentSummaryIndex = meeting.summaryHistory.length - 1;
                        saveMeetings();
                    }
                }

                updateProgress('✅ 완료', 100, '요약 완료!');
                setTimeout(clearProgress, 2000);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    summary,
                    model: CURRENT_AI_MODEL
                }));
            } catch (e) {
                console.error('AI 요약 오류:', e);
                clearProgress();
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // API: 녹음 파일 저장 (브라우저에서 녹음한 파일 업로드)
        if (pathname === '/api/recordings' && req.method === 'POST') {
            try {
                const fileData = await parseMultipart(req);

                if (!fileData || !fileData.content) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: '파일이 없습니다' }));
                    return;
                }

                // 파일명 생성
                const originalName = fileData.filename || 'recording.wav';
                const ext = path.extname(originalName) || '.wav';
                // 파일명에 사용할 수 없는 문자만 제거 (한글, 영문, 숫자, 공백, 하이픈, 언더스코어 허용)
                const baseName = path.basename(originalName, ext)
                    .replace(/[\\/:*?"<>|]/g, '') // 파일시스템 금지 문자 제거
                    .replace(/\s+/g, ' ')          // 연속 공백 하나로
                    .trim() || '회의녹음';

                // 기본 파일명으로 먼저 시도
                let newFilename = `${baseName}${ext}`;
                let filePath = path.join(MEETINGS_DIR, newFilename);

                // 같은 이름의 파일이 존재하면 타임스탬프 추가
                if (fs.existsSync(filePath)) {
                    const date = new Date().toISOString().slice(0, 10);
                    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
                    newFilename = `${baseName}_${date}_${time}${ext}`;
                    filePath = path.join(MEETINGS_DIR, newFilename);
                }

                // 파일 저장
                fs.writeFileSync(filePath, fileData.content);
                console.log(`녹음 파일 저장: ${newFilename} (${fileData.content.length} bytes)`);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    filename: newFilename,
                    path: filePath,
                    size: fileData.content.length
                }));
            } catch (e) {
                console.error('녹음 파일 저장 오류:', e);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // API: 녹음 파일 목록
        if (pathname === '/api/recordings' && req.method === 'GET') {
            try {
                const files = fs.readdirSync(MEETINGS_DIR);
                const recordings = files
                    .filter(f => (f.endsWith('.wav') || f.endsWith('.webm')) && !f.includes('_converted'))
                    .map(f => {
                        const filePath = path.join(MEETINGS_DIR, f);
                        const stat = fs.statSync(filePath);
                        return {
                            filename: f,
                            size: stat.size,
                            sizeFormatted: formatFileSize(stat.size),
                            createdAt: stat.birthtime.toISOString(),
                            duration: null // TODO: 실제 오디오 길이 추출
                        };
                    })
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ recordings }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // API: 녹음 파일 다운로드 (Range 요청 지원 - seek 가능)
        if (pathname.startsWith('/api/recording/download/') && req.method === 'GET') {
            const filename = decodeURIComponent(pathname.split('/').pop());
            const filePath = path.join(MEETINGS_DIR, filename);

            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                const fileSize = stat.size;
                const ext = path.extname(filename).toLowerCase();
                const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/webm';

                const range = req.headers.range;

                if (range) {
                    // Range 요청 처리 (오디오 seek 지원)
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunkSize = (end - start) + 1;

                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunkSize,
                        'Content-Type': mimeType
                    });

                    fs.createReadStream(filePath, { start, end }).pipe(res);
                } else {
                    // 일반 요청 (전체 파일)
                    res.writeHead(200, {
                        'Content-Type': mimeType,
                        'Content-Length': fileSize,
                        'Accept-Ranges': 'bytes'
                    });
                    fs.createReadStream(filePath).pipe(res);
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다' }));
            }
            return;
        }

        // API: 녹음 파일 삭제
        if (pathname.startsWith('/api/recording/') && req.method === 'DELETE') {
            const filename = decodeURIComponent(pathname.split('/').pop());
            const filePath = path.join(MEETINGS_DIR, filename);

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다' }));
            }
            return;
        }

        // API: 녹음 파일에서 회의록 생성
        if (pathname === '/api/recording/transcribe' && req.method === 'POST') {
            try {
                const body = await parseBody(req);
                const { filename } = body;

                if (!filename) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '파일명이 필요합니다' }));
                    return;
                }

                const audioPath = path.join(MEETINGS_DIR, filename);

                if (!fs.existsSync(audioPath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ success: false, error: '녹음 파일을 찾을 수 없습니다' }));
                    return;
                }

                console.log('녹음 파일에서 회의록 생성:', audioPath);
                updateProgress('🎙️ 음성 인식', 15, '처리 중...');

                let transcript = '';

                // Whisper 모델이 있으면 실제 음성 인식, 없으면 시뮬레이션
                if (checkWhisperModel()) {
                    // 로컬 Whisper로 음성 인식
                    const transcribeResult = await transcribeAudio(audioPath);
                    transcript = transcribeResult.text;

                    // 임시 WAV 파일 정리 (고유 ID가 포함된 파일)
                    if (transcribeResult.wavPath && transcribeResult.wavPath !== audioPath) {
                        try {
                            fs.unlinkSync(transcribeResult.wavPath);
                            console.log('임시 변환 파일 삭제:', transcribeResult.wavPath);
                        } catch (e) {
                            console.log('임시 파일 삭제 실패 (무시):', e.message);
                        }
                    }

                    // 혹시 남아있을 수 있는 관련 JSON 파일들 정리
                    const jsonPath = transcribeResult.wavPath + '.json';
                    if (fs.existsSync(jsonPath)) {
                        try {
                            fs.unlinkSync(jsonPath);
                            console.log('남은 JSON 파일 삭제:', jsonPath);
                        } catch (e) { /* 무시 */ }
                    }
                } else {
                    // 시뮬레이션 모드: 테스트용 텍스트 생성
                    console.log('시뮬레이션 모드: 음성 인식 모델 없음, 테스트 텍스트 생성');
                    updateProgress('🎙️ 음성 인식', 30, '시뮬레이션 모드...');

                    // 파일 정보 기반으로 시뮬레이션 텍스트 생성
                    const stats = fs.statSync(audioPath);
                    const durationSec = Math.floor(stats.size / (16000 * 2)); // 대략적인 길이 추정
                    const now = new Date();

                    transcript = `[00:00] 회의를 시작하겠습니다.
[00:15] 오늘의 안건에 대해 논의하겠습니다.
[00:30] 첫 번째 주제는 프로젝트 진행 상황입니다.
[01:00] 현재 개발 진행률은 약 70% 정도입니다.
[01:30] 다음 주까지 마무리할 예정입니다.
[02:00] 두 번째 주제는 일정 조율입니다.
[02:30] 다음 회의는 다음 주 같은 시간에 진행하겠습니다.
[03:00] 오늘 회의를 마치겠습니다. 감사합니다.

※ 이 회의록은 시뮬레이션 모드로 생성되었습니다.
※ 실제 음성 인식을 위해서는 Whisper 모델(models/ggml-small.bin)이 필요합니다.
※ 파일: ${filename}
※ 생성일시: ${now.toLocaleString('ko-KR')}`;
                }

                console.log('음성 인식 완료');
                updateProgress('🎙️ 음성 인식', 45, '완료');

                // 규칙 기반 분석 (키워드 추출 등)
                const analysis = analyzeTranscript(transcript);

                // AI 요약 자동 생성
                let aiSummary = null;
                try {
                    const ollamaStatus = await checkOllamaStatus();
                    if (ollamaStatus.ready && transcript && transcript.length > 50) {
                        console.log('AI 요약 생성 시작...');
                        updateProgress('🤖 AI 분석', 50, '회의 내용 분석 중...');
                        aiSummary = await summarizeWithOllama(transcript, 'meeting');
                        console.log('AI 요약 생성 완료');
                    }
                } catch (e) {
                    console.error('AI 요약 생성 실패 (선택적 기능):', e.message);
                }

                updateProgress('📄 문서 생성', 92, '회의록 저장 중...');

                // 회의록 메타데이터 생성
                const meetingId = generateId();
                const title = filename.replace(/^audio_[^_]+_/, '').replace(/\.[^.]+$/, '') || '회의녹음';

                const meeting = {
                    id: meetingId,
                    title: title,
                    createdAt: new Date().toISOString(),
                    transcript,
                    analysis,
                    aiSummary,
                    summarizedAt: aiSummary ? new Date().toISOString() : null,
                    audioFile: filename
                };

                // 원본 녹취록 문서 생성
                const transcriptContent = generateTranscriptDoc(meeting);
                const transcriptFilename = `transcript_${meetingId}.txt`;
                const transcriptPath = path.join(MEETINGS_DIR, transcriptFilename);
                fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
                meeting.transcriptFile = transcriptFilename;

                meetings.push(meeting);
                saveMeetings();

                updateProgress('✅ 완료', 100, '회의록 생성 완료!');
                setTimeout(clearProgress, 3000);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    meetingId,
                    hasAiSummary: !!aiSummary,
                    filename: transcriptFilename
                }));
            } catch (e) {
                console.error('회의록 생성 오류:', e);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // API: 회의록 목록
        if (pathname === '/api/meetings' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ meetings }));
            return;
        }

        // API: 회의록 생성 (음성 파일 업로드)
        if (pathname === '/api/meeting/transcribe' && req.method === 'POST') {
            try {
                if (!checkWhisperModel()) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        error: '음성 인식 모델이 없습니다. models/ggml-small.bin 파일이 필요합니다.'
                    }));
                    return;
                }

                updateProgress('📤 파일 업로드', 5);
                const fileData = await parseMultipart(req);
                const audioId = generateId();
                const audioPath = path.join(MEETINGS_DIR, `audio_${audioId}_${fileData.filename}`);
                fs.writeFileSync(audioPath, fileData.content);

                console.log('음성 파일 저장됨:', audioPath);
                updateProgress('🔄 오디오 변환', 10);

                // 로컬 Whisper로 음성 인식
                updateProgress('🎙️ 음성 인식', 15, '처리 중...');
                const transcribeResult = await transcribeAudio(audioPath);
                const transcript = transcribeResult.text;

                console.log('음성 인식 완료');
                updateProgress('🎙️ 음성 인식', 45, '완료');

                // 임시 WAV 파일 정리 (고유 ID가 포함된 파일)
                if (transcribeResult.wavPath && transcribeResult.wavPath !== audioPath) {
                    try {
                        fs.unlinkSync(transcribeResult.wavPath);
                        console.log('임시 변환 파일 삭제:', transcribeResult.wavPath);
                    } catch (e) {
                        console.log('임시 파일 삭제 실패 (무시):', e.message);
                    }
                }

                // 혹시 남아있을 수 있는 관련 JSON 파일들 정리
                const jsonPath = transcribeResult.wavPath + '.json';
                if (fs.existsSync(jsonPath)) {
                    try {
                        fs.unlinkSync(jsonPath);
                        console.log('남은 JSON 파일 삭제:', jsonPath);
                    } catch (e) { /* 무시 */ }
                }

                // 규칙 기반 분석 (키워드 추출 등)
                const analysis = analyzeTranscript(transcript);

                // AI 요약 자동 생성
                let aiSummary = null;
                try {
                    const ollamaStatus = await checkOllamaStatus();
                    if (ollamaStatus.ready && transcript && transcript.length > 50) {
                        console.log('AI 요약 생성 시작...');
                        updateProgress('🤖 AI 분석', 50, '회의 내용 분석 중...');
                        aiSummary = await summarizeWithOllama(transcript, 'meeting');
                        console.log('AI 요약 생성 완료');
                    }
                } catch (e) {
                    console.error('AI 요약 생성 실패 (선택적 기능):', e.message);
                }

                updateProgress('📄 문서 생성', 92, '회의록 저장 중...');

                // 회의록 객체 생성
                const meeting = {
                    id: audioId,
                    title: `회의록_${new Date().toISOString().split('T')[0]}`,
                    audioFile: fileData.filename,
                    wavFile: transcribeResult.wavPath ? path.basename(transcribeResult.wavPath) : null,
                    transcript,
                    analysis,
                    aiSummary,
                    summarizedAt: aiSummary ? new Date().toISOString() : null,
                    createdAt: new Date().toISOString()
                };

                // 원본 녹취록 문서 생성
                const transcriptContent = generateTranscriptDoc(meeting);
                const transcriptFilename = `transcript_${meeting.id}.txt`;
                const transcriptPath = path.join(MEETINGS_DIR, transcriptFilename);
                fs.writeFileSync(transcriptPath, transcriptContent, 'utf8');
                meeting.transcriptFile = transcriptFilename;

                // 저장
                meetings.unshift(meeting);
                saveMeetings();

                updateProgress('✅ 완료', 100, '회의록 생성 완료!');
                setTimeout(clearProgress, 3000);

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    meeting,
                    hasAiSummary: !!aiSummary,
                    filename: transcriptFilename
                }));
            } catch (e) {
                console.error('회의록 생성 오류:', e);
                clearProgress();
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // API: 회의록 다운로드
        if (pathname.startsWith('/api/meeting/download/') && req.method === 'GET') {
            const id = pathname.split('/').pop();
            const meeting = meetings.find(m => m.id === id);

            if (!meeting) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '회의록을 찾을 수 없습니다' }));
                return;
            }

            // docFile이 있으면 파일에서 읽기
            if (meeting.docFile) {
                const docPath = path.join(MEETINGS_DIR, meeting.docFile);
                if (fs.existsSync(docPath)) {
                    const content = fs.readFileSync(docPath, 'utf8');
                    res.writeHead(200, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Disposition': `attachment; filename="${encodeURIComponent(meeting.title)}.txt"`
                    });
                    res.end(content);
                    return;
                }
            }

            // docFile이 없으면 transcript와 aiSummary로 생성
            let content = `# ${meeting.title}\n`;
            content += `생성일: ${new Date(meeting.createdAt).toLocaleString('ko-KR')}\n\n`;

            if (meeting.aiSummary) {
                content += `## AI 요약\n${meeting.aiSummary}\n\n`;
            }

            if (meeting.transcript) {
                content += `## 녹취록\n${meeting.transcript}\n`;
            }

            if (!meeting.transcript && !meeting.aiSummary) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '회의록 내용이 없습니다' }));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Disposition': `attachment; filename="${encodeURIComponent(meeting.title)}.txt"`
            });
            res.end(content);
            return;
        }

        // API: 회의록 삭제
        if (pathname.match(/^\/api\/meeting\/[^\/]+$/) && req.method === 'DELETE') {
            const id = pathname.split('/').pop();
            const index = meetings.findIndex(m => m.id === id);

            if (index > -1) {
                const meeting = meetings[index];

                // 파일 삭제
                if (meeting.docFile) {
                    const docPath = path.join(MEETINGS_DIR, meeting.docFile);
                    if (fs.existsSync(docPath)) fs.unlinkSync(docPath);
                }

                meetings.splice(index, 1);
                saveMeetings();

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '회의록을 찾을 수 없습니다' }));
            }
            return;
        }

        // 정적 파일 서빙
        let filePath = pathname === '/' ? '/index.html' : pathname;
        filePath = path.join(__dirname, 'public', filePath);
        const ext = path.extname(filePath);
        serveStatic(res, filePath, getContentType(ext));

    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '잘못된 요청' }));
    }
});

// 서버 시작
loadConfig();
loadSettings();
loadMeetings();
loadDocHistory();
initWhisper();
startAllWatchers();

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`포트 ${PORT}가 이미 사용 중입니다. 기존 인스턴스가 실행 중일 수 있습니다.`);
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  DocWatch 서버 실행 중`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`========================================\n`);
});
