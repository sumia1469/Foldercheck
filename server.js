const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = 4400;
const CONFIG_FILE = 'folderList.json';
const SETTINGS_FILE = 'settings.json';

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

// 폴더 감시 시작
function startWatching(folderPath) {
    if (watchers[folderPath]) return;

    if (!fs.existsSync(folderPath)) {
        console.error(`폴더가 존재하지 않음: ${folderPath}`);
        return;
    }

    try {
        watchers[folderPath] = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
            if (!filename) return;

            // 제외 패턴 체크
            if (isExcluded(filename)) return;

            // 확장자 필터 체크
            if (!passesFilter(filename)) return;

            const fullPath = path.join(folderPath, filename);
            const timestamp = new Date().toISOString();
            let action = '';

            if (eventType === 'rename') {
                action = fs.existsSync(fullPath) ? '생성' : '삭제';
            } else if (eventType === 'change') {
                action = '수정';
            }

            const logEntry = {
                timestamp,
                folder: folderPath,
                file: filename,
                action,
                fullPath,
                extension: path.extname(filename).toLowerCase()
            };

            changeLog.unshift(logEntry);
            if (changeLog.length > 500) changeLog.pop();

            // 통계 업데이트
            updateStats(action, filename);

            console.log(`[${action}] ${fullPath}`);

            // 텔레그램 알림
            if (settings.telegram.enabled) {
                const msg = `📁 <b>파일 ${action}</b>\n📄 ${filename}\n📂 ${folderPath}\n🕐 ${new Date().toLocaleString('ko-KR')}`;
                sendTelegramNotification(msg);
            }
        });

        console.log(`감시 시작: ${folderPath}`);
    } catch (e) {
        console.error(`감시 실패: ${folderPath} - ${e.message}`);
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
            sendTelegramNotification('🔔 테스트 알림입니다!\n폴더 감시 프로그램과 연결되었습니다.');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
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
startAllWatchers();

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`포트 ${PORT}가 이미 사용 중입니다. 기존 인스턴스가 실행 중일 수 있습니다.`);
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  폴더 감시 서버 실행 중`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`========================================\n`);
});
