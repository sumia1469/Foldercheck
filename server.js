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

// FFmpeg 경로 설정
ffmpeg.setFfmpegPath(ffmpegPath);

// Whisper 설정
const WHISPER_MODEL_PATH = path.join(__dirname, 'models', 'ggml-small.bin');
const WHISPER_CLI_PATH = '/opt/homebrew/bin/whisper-cli';

// Ollama 설정 (로컬 LLM)
const OLLAMA_HOST = 'http://localhost:11434';
const OLLAMA_MODEL = 'tinyllama';

const PORT = 4400;
const CONFIG_FILE = 'folderList.json';
const SETTINGS_FILE = 'settings.json';
const MEETINGS_FILE = 'meetings.json';
const MEETINGS_DIR = path.join(__dirname, 'meetings');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// 디렉토리 초기화
if (!fs.existsSync(MEETINGS_DIR)) {
    fs.mkdirSync(MEETINGS_DIR, { recursive: true });
}
if (!fs.existsSync(TEMPLATES_DIR)) {
    fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

// 회의록 저장소
let meetings = [];

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
        throw new Error('Whisper 모델이 없습니다. models/ggml-small.bin 파일이 필요합니다.');
    }

    // WAV로 변환
    const wavPath = audioPath.replace(/\.[^.]+$/, '.wav');
    await convertToWav(audioPath, wavPath);

    console.log('로컬 Whisper 음성 인식 시작...');
    console.log('WAV 파일:', wavPath);

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
            console.log('Whisper:', data.toString().trim());
        });

        whisperProcess.on('close', (code) => {
            if (code !== 0) {
                console.error('Whisper 오류:', stderr);
                reject(new Error(`Whisper 처리 실패: ${stderr}`));
                return;
            }

            try {
                // JSON 출력 파싱
                const jsonPath = wavPath + '.json';
                let result = '';

                if (fs.existsSync(jsonPath)) {
                    const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    if (jsonData.transcription) {
                        for (const seg of jsonData.transcription) {
                            const start = seg.offsets?.from || 0;
                            const startSec = Math.floor(start / 1000);
                            const minutes = Math.floor(startSec / 60);
                            const seconds = startSec % 60;
                            const timestamp = `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}]`;
                            result += `${timestamp} ${seg.text.trim()}\n`;
                        }
                    }
                    // JSON 파일 정리
                    fs.unlinkSync(jsonPath);
                } else {
                    // stdout에서 텍스트 추출
                    result = stdout.trim();
                }

                console.log('음성 인식 완료');
                resolve({ text: result.trim() || '(인식된 텍스트 없음)', wavPath });
            } catch (e) {
                console.error('결과 파싱 오류:', e);
                reject(e);
            }
        });

        whisperProcess.on('error', (err) => {
            console.error('Whisper 실행 오류:', err);
            reject(err);
        });
    });
}

let watchedFolders = [];
let changeLog = [];
let watchers = {};
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
    }
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
    for (const pattern of settings.excludePatterns) {
        if (filePath.includes(pattern)) return true;
    }
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

            watchers[targetPath] = fs.watch(parentDir, (eventType, filename) => {
                if (!filename || filename !== targetFilename) return;

                const timestamp = new Date().toISOString();
                let action = '';

                if (eventType === 'rename') {
                    action = fs.existsSync(targetPath) ? '생성' : '삭제';
                } else if (eventType === 'change') {
                    action = '수정';
                }

                const logEntry = {
                    timestamp,
                    folder: parentDir,
                    file: targetFilename,
                    action,
                    fullPath: targetPath,
                    extension: path.extname(targetFilename).toLowerCase(),
                    isFile: true
                };

                changeLog.unshift(logEntry);
                if (changeLog.length > 500) changeLog.pop();

                updateStats(action, targetFilename);
                console.log(`[${action}] ${targetPath}`);

                if (settings.telegram.enabled) {
                    const msg = `📄 <b>[DocWatch] 파일 ${action}</b>\n📄 ${targetFilename}\n📂 ${parentDir}\n🕐 ${new Date().toLocaleString('ko-KR')}`;
                    sendTelegramNotification(msg);
                }
            });

            console.log(`파일 감시 시작: ${targetPath}`);
        } else {
            // 폴더 감시 (기존 로직)
            watchers[targetPath] = fs.watch(targetPath, { recursive: true }, (eventType, filename) => {
                if (!filename) return;

                // 제외 패턴 체크
                if (isExcluded(filename)) return;

                // 확장자 필터 체크
                if (!passesFilter(filename)) return;

                const fullPath = path.join(targetPath, filename);
                const timestamp = new Date().toISOString();
                let action = '';

                if (eventType === 'rename') {
                    action = fs.existsSync(fullPath) ? '생성' : '삭제';
                } else if (eventType === 'change') {
                    action = '수정';
                }

                const logEntry = {
                    timestamp,
                    folder: targetPath,
                    file: filename,
                    action,
                    fullPath,
                    extension: path.extname(filename).toLowerCase(),
                    isFile: false
                };

                changeLog.unshift(logEntry);
                if (changeLog.length > 500) changeLog.pop();

                updateStats(action, filename);
                console.log(`[${action}] ${fullPath}`);

                if (settings.telegram.enabled) {
                    const msg = `📁 <b>[DocWatch] 파일 ${action}</b>\n📄 ${filename}\n📂 ${targetPath}\n🕐 ${new Date().toLocaleString('ko-KR')}`;
                    sendTelegramNotification(msg);
                }
            });

            console.log(`폴더 감시 시작: ${targetPath}`);
        }
    } catch (e) {
        console.error(`감시 실패: ${targetPath} - ${e.message}`);
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
const DOC_HISTORY_FILE = 'docHistory.json';

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

// DOCX 파일 내용 추출
async function extractDocxContent(filePath) {
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

// PPTX XML에서 텍스트 추출 헬퍼
function extractTextFromPptxXml(obj, texts = []) {
    if (typeof obj === 'string') {
        texts.push(obj);
    } else if (Array.isArray(obj)) {
        obj.forEach(item => extractTextFromPptxXml(item, texts));
    } else if (typeof obj === 'object' && obj !== null) {
        // a:t 요소에서 텍스트 추출
        if (obj['a:t']) {
            const t = obj['a:t'];
            if (Array.isArray(t)) {
                t.forEach(item => {
                    if (typeof item === 'string') texts.push(item);
                    else if (item._) texts.push(item._);
                });
            } else if (typeof t === 'string') {
                texts.push(t);
            }
        }

        Object.values(obj).forEach(value => extractTextFromPptxXml(value, texts));
    }
    return texts.join(' ').trim();
}

// 문서 분석 및 요약 생성
async function analyzeDocument(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const fileKey = filePath.replace(/[^a-zA-Z0-9]/g, '_');

    let currentContent = null;
    let documentType = '';

    // 파일 타입별 내용 추출
    switch (ext) {
        case '.docx':
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

    if (previousVersion) {
        // 변경 사항 분석
        summary.changes = compareDocuments(previousVersion, currentContent, ext);
        summary.previousAnalyzedAt = previousVersion.analyzedAt;

        // AI로 변경사항 요약 생성 (Ollama 사용)
        try {
            const ollamaStatus = await checkOllamaStatus();
            if (ollamaStatus.ready && summary.changes.length > 0) {
                const changesText = summary.changes.map(c => {
                    let text = c.type;
                    if (c.description) text += `: ${c.description}`;
                    if (c.keywords) text += ` - ${c.keywords.join(', ')}`;
                    return text;
                }).join('\n');

                const aiSummary = await summarizeWithOllama(
                    `문서: ${fileName}\n변경사항:\n${changesText}`,
                    'document_changes'
                );
                summary.aiSummary = aiSummary;
            }
        } catch (e) {
            console.log('AI 요약 생성 실패 (선택적 기능):', e.message);
        }
    } else {
        // 새 문서 요약
        summary.overview = generateDocumentOverview(currentContent, ext);

        // AI로 새 문서 요약 생성 (Ollama 사용)
        try {
            const ollamaStatus = await checkOllamaStatus();
            if (ollamaStatus.ready && currentContent.text) {
                const aiSummary = await summarizeWithOllama(currentContent.text, 'document');
                summary.aiSummary = aiSummary;
            }
        } catch (e) {
            console.log('AI 요약 생성 실패 (선택적 기능):', e.message);
        }
    }

    // 현재 버전 저장
    documentHistory[fileKey] = {
        content: currentContent,
        analyzedAt: summary.analyzedAt,
        fileName
    };
    saveDocHistory();

    return summary;
}

// 문서 비교
function compareDocuments(previous, current, ext) {
    const changes = [];
    const prevText = previous.content.text || '';
    const currText = current.text || '';

    // 텍스트 길이 변화
    const lengthDiff = currText.length - prevText.length;
    if (Math.abs(lengthDiff) > 50) {
        changes.push({
            type: lengthDiff > 0 ? '내용 추가' : '내용 삭제',
            description: `약 ${Math.abs(lengthDiff)}자 ${lengthDiff > 0 ? '증가' : '감소'}`
        });
    }

    // 단어 단위 비교
    const prevWords = new Set(prevText.split(/\s+/).filter(w => w.length > 2));
    const currWords = new Set(currText.split(/\s+/).filter(w => w.length > 2));

    const newWords = [...currWords].filter(w => !prevWords.has(w));
    const removedWords = [...prevWords].filter(w => !currWords.has(w));

    if (newWords.length > 0) {
        changes.push({
            type: '새로 추가된 키워드',
            keywords: newWords.slice(0, 10)
        });
    }

    if (removedWords.length > 0) {
        changes.push({
            type: '삭제된 키워드',
            keywords: removedWords.slice(0, 10)
        });
    }

    // PPTX 슬라이드 수 변화
    if (ext === '.pptx' || ext === '.ppt') {
        const prevSlides = previous.content.slideCount || 0;
        const currSlides = current.slideCount || 0;
        if (prevSlides !== currSlides) {
            changes.push({
                type: '슬라이드 수 변경',
                description: `${prevSlides}장 → ${currSlides}장 (${currSlides - prevSlides > 0 ? '+' : ''}${currSlides - prevSlides}장)`
            });
        }
    }

    // XLSX 시트 변화
    if (ext === '.xlsx' || ext === '.xls') {
        const prevSheets = previous.content.sheetNames || [];
        const currSheets = current.sheetNames || [];

        const newSheets = currSheets.filter(s => !prevSheets.includes(s));
        const removedSheets = prevSheets.filter(s => !currSheets.includes(s));

        if (newSheets.length > 0) {
            changes.push({
                type: '새 시트 추가',
                sheets: newSheets
            });
        }
        if (removedSheets.length > 0) {
            changes.push({
                type: '시트 삭제',
                sheets: removedSheets
            });
        }
    }

    if (changes.length === 0) {
        changes.push({
            type: '미세한 변경',
            description: '내용에 작은 수정이 있었습니다.'
        });
    }

    return changes;
}

// 문서 개요 생성 (새 문서일 때)
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
                    const hasModel = result.models?.some(m => m.name.startsWith(OLLAMA_MODEL));
                    resolve({ ready: true, hasModel, models: result.models || [] });
                } catch (e) {
                    resolve({ ready: false, error: 'JSON 파싱 오류' });
                }
            });
        });
        req.on('error', () => resolve({ ready: false, error: 'Ollama 서버 연결 실패' }));
        req.setTimeout(3000, () => {
            req.destroy();
            resolve({ ready: false, error: '타임아웃' });
        });
    });
}

// Ollama로 텍스트 요약
async function summarizeWithOllama(text, type = 'meeting') {
    const prompts = {
        meeting: `다음은 회의 녹취록입니다. 한국어로 요약해주세요.

요약 형식:
1. 회의 주제 (1줄)
2. 주요 논의 사항 (3-5개 bullet point)
3. 결정 사항 (있다면)
4. 액션 아이템 (담당자/기한이 있다면 포함)

녹취록:
${text.substring(0, 3000)}

요약:`,
        document: `다음 문서 내용을 한국어로 간단히 요약해주세요 (3-5문장):

${text.substring(0, 3000)}

요약:`,
        document_changes: `다음은 문서의 변경사항 정보입니다. 한국어로 변경사항을 간결하게 요약해주세요 (2-3문장):

${text.substring(0, 2000)}

변경사항 요약:`
    };

    const prompt = prompts[type] || prompts.meeting;

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 500
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
                    resolve(result.response || '요약 생성 실패');
                } catch (e) {
                    reject(new Error('응답 파싱 오류'));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('요약 생성 타임아웃 (60초)'));
        });

        req.write(postData);
        req.end();
    });
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
    console.log('Whisper 엔진 초기화 중...');
    // TODO: whisper.cpp 바인딩 로드
    // 현재는 시뮬레이션 모드
    setTimeout(() => {
        whisperReady = true;
        console.log('Whisper 엔진 준비 완료 (시뮬레이션 모드)');
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
                const parts = body.toString('binary').split('--' + boundary);
                for (const part of parts) {
                    if (part.includes('filename=')) {
                        const filenameMatch = part.match(/filename="([^"]+)"/);
                        const filename = filenameMatch ? filenameMatch[1] : 'audio.wav';

                        // 헤더와 본문 분리
                        const headerEnd = part.indexOf('\r\n\r\n');
                        if (headerEnd > 0) {
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
        if (pathname === '/api/license/toggle' && req.method === 'POST') {
            const result = license.toggleLicenseType();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(result));
            return;
        }

        // API: 테스트 라이선스 활성화 (개발용)
        // POST /api/license/activate-test { months: 3 } 또는 { days: 1 }
        if (pathname === '/api/license/activate-test' && req.method === 'POST') {
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

        // API: Whisper 상태
        if (pathname === '/api/whisper/status' && req.method === 'GET') {
            checkWhisperModel();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ready: whisperReady,
                status: whisperReady ? '준비됨 (로컬 Whisper)' : '모델 파일 필요',
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
                model: OLLAMA_MODEL,
                host: OLLAMA_HOST
            }));
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

                // Ollama 상태 확인
                const ollamaStatus = await checkOllamaStatus();
                if (!ollamaStatus.ready) {
                    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        error: 'Ollama 서버가 실행 중이 아닙니다. brew services start ollama를 실행해주세요.',
                        details: ollamaStatus.error
                    }));
                    return;
                }

                console.log('AI 요약 생성 중...');
                const summary = await summarizeWithOllama(transcriptText, 'meeting');
                console.log('AI 요약 완료');

                // 회의록에 요약 저장
                if (meetingId) {
                    const meeting = meetings.find(m => m.id === meetingId);
                    if (meeting) {
                        meeting.aiSummary = summary;
                        meeting.summarizedAt = new Date().toISOString();
                        saveMeetings();
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    summary,
                    model: OLLAMA_MODEL
                }));
            } catch (e) {
                console.error('AI 요약 오류:', e);
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
                    .filter(f => f.endsWith('.wav') || f.endsWith('.webm'))
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

        // API: 녹음 파일 다운로드
        if (pathname.startsWith('/api/recording/download/') && req.method === 'GET') {
            const filename = decodeURIComponent(pathname.split('/').pop());
            const filePath = path.join(MEETINGS_DIR, filename);

            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                const ext = path.extname(filename).toLowerCase();
                const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/webm';

                res.writeHead(200, {
                    'Content-Type': mimeType,
                    'Content-Length': stat.size,
                    'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`
                });
                fs.createReadStream(filePath).pipe(res);
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
                const { filename } = JSON.parse(body);

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

                if (!checkWhisperModel()) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({
                        success: false,
                        error: 'Whisper 모델이 없습니다. models/ggml-small.bin 파일이 필요합니다.'
                    }));
                    return;
                }

                console.log('녹음 파일에서 회의록 생성:', audioPath);

                // 로컬 Whisper로 음성 인식
                const transcribeResult = await transcribeAudio(audioPath);
                const transcript = transcribeResult.text;

                console.log('음성 인식 완료');

                // 규칙 기반 분석
                const analysis = analyzeTranscript(transcript);

                // 회의록 메타데이터 생성
                const meetingId = generateId();
                const title = filename.replace(/^audio_[^_]+_/, '').replace(/\.[^.]+$/, '') || '회의녹음';

                const meeting = {
                    id: meetingId,
                    title: title,
                    createdAt: new Date().toISOString(),
                    transcript,
                    analysis,
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

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    meetingId,
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
                        error: 'Whisper 모델이 없습니다. models/ggml-small.bin 파일이 필요합니다.'
                    }));
                    return;
                }

                const fileData = await parseMultipart(req);
                const audioId = generateId();
                const audioPath = path.join(MEETINGS_DIR, `audio_${audioId}_${fileData.filename}`);
                fs.writeFileSync(audioPath, fileData.content);

                console.log('음성 파일 저장됨:', audioPath);
                console.log('로컬 Whisper 처리 중...');

                // 로컬 Whisper로 음성 인식
                const transcribeResult = await transcribeAudio(audioPath);
                const transcript = transcribeResult.text;

                console.log('음성 인식 완료');

                // 규칙 기반 분석
                const analysis = analyzeTranscript(transcript);

                // 회의록 객체 생성
                const meeting = {
                    id: audioId,
                    title: `회의록_${new Date().toISOString().split('T')[0]}`,
                    audioFile: fileData.filename,
                    wavFile: transcribeResult.wavPath ? path.basename(transcribeResult.wavPath) : null,
                    transcript,
                    analysis,
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

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    success: true,
                    meeting,
                    filename: docFilename
                }));
            } catch (e) {
                console.error('회의록 생성 오류:', e);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
            return;
        }

        // API: 회의록 다운로드
        if (pathname.startsWith('/api/meeting/download/') && req.method === 'GET') {
            const id = pathname.split('/').pop();
            const meeting = meetings.find(m => m.id === id);

            if (meeting && meeting.docFile) {
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

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '회의록을 찾을 수 없습니다' }));
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
