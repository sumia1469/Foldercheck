const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4400;
const CONFIG_FILE = 'folderList.json';

let watchedFolders = [];
let changeLog = [];
let watchers = {};

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
                fullPath
            };

            changeLog.unshift(logEntry);
            if (changeLog.length > 100) changeLog.pop();

            console.log(`[${action}] ${fullPath}`);
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
        '.json': 'application/json; charset=utf-8'
    };
    return types[ext] || 'text/plain; charset=utf-8';
}

// HTTP 서버
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // API 라우팅
    if (pathname === '/api/folders' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ folders: watchedFolders }));
        return;
    }

    if (pathname === '/api/folders' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { folder } = JSON.parse(body);
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
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '잘못된 요청' }));
            }
        });
        return;
    }

    if (pathname === '/api/folders' && req.method === 'DELETE') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { folder } = JSON.parse(body);
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
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '잘못된 요청' }));
            }
        });
        return;
    }

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

    // 정적 파일 서빙
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, 'public', filePath);
    const ext = path.extname(filePath);
    serveStatic(res, filePath, getContentType(ext));
});

// 서버 시작
loadConfig();
startAllWatchers();

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  폴더 감시 서버 실행 중`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`========================================\n`);
});
