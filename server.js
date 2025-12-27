const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

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

// Whisper 상태 (실제 구현 시 whisper.cpp 연동)
let whisperReady = false;

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

// 회의록 DOCX 생성 (간단 텍스트 버전 - 실제는 docxtemplater 사용)
function generateMeetingDoc(meeting, analysis) {
    const docContent = `
========================================
            회의록
========================================

■ 기본 정보
────────────────────────────────────────
회의 일시: ${new Date(meeting.createdAt).toLocaleString('ko-KR')}
녹음 파일: ${meeting.audioFile}
생성 일시: ${new Date().toLocaleString('ko-KR')}

■ 회의 내용 요약
────────────────────────────────────────
${analysis.summary}

주요 키워드: ${analysis.keywords.join(', ')}

■ 결정 사항
────────────────────────────────────────
${analysis.decisions.length > 0 ? analysis.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(추출된 결정 사항 없음)'}

■ 이슈 / 논의 필요
────────────────────────────────────────
${analysis.issues.length > 0 ? analysis.issues.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(추출된 이슈 없음)'}

■ 액션 아이템
────────────────────────────────────────
${analysis.actions.length > 0 ? analysis.actions.map((d, i) => `${i + 1}. ${d}`).join('\n') : '(추출된 액션 아이템 없음)'}

■ 전체 녹취록
────────────────────────────────────────
${meeting.transcript}

========================================
DocWatch로 자동 생성됨
본 회의록은 초안이며 검토가 필요합니다
========================================
`;
    return docContent;
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
        // 회의록 API
        // ========================================

        // API: Whisper 상태
        if (pathname === '/api/whisper/status' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ready: whisperReady,
                status: whisperReady ? '준비됨' : '준비 중',
                model: 'small',
                local: true
            }));
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
                const fileData = await parseMultipart(req);
                const audioPath = path.join(MEETINGS_DIR, `audio_${generateId()}_${fileData.filename}`);
                fs.writeFileSync(audioPath, fileData.content);

                // TODO: 실제 whisper.cpp 호출
                // 현재는 시뮬레이션 - 데모용 텍스트 생성
                const simulatedTranscript = `
[00:00] 안녕하세요, 오늘 회의를 시작하겠습니다.
[00:15] 이번 프로젝트 일정에 대해 논의하겠습니다.
[00:32] 우선 마감일까지 남은 시간이 2주입니다.
[00:45] 디자인 작업은 다음 주 수요일까지 완료하기로 결정했습니다.
[01:02] 개발팀은 목요일부터 구현을 시작합니다.
[01:18] QA 일정은 확인이 필요합니다. 이 부분은 이슈입니다.
[01:35] 김팀장님이 테스트 계획서를 금요일까지 준비해 주세요.
[01:50] 다음 회의는 월요일 오전 10시로 하겠습니다.
[02:05] 회의를 마치겠습니다. 감사합니다.
                `.trim();

                // 규칙 기반 분석
                const analysis = analyzeTranscript(simulatedTranscript);

                // 회의록 객체 생성
                const meeting = {
                    id: generateId(),
                    title: `회의록_${new Date().toISOString().split('T')[0]}`,
                    audioFile: fileData.filename,
                    transcript: simulatedTranscript,
                    analysis,
                    createdAt: new Date().toISOString()
                };

                // 회의록 문서 생성
                const docContent = generateMeetingDoc(meeting, analysis);
                const docFilename = `meeting_${meeting.id}.txt`;
                const docPath = path.join(MEETINGS_DIR, docFilename);
                fs.writeFileSync(docPath, docContent, 'utf8');
                meeting.docFile = docFilename;

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
