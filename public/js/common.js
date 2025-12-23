const folderInput = document.getElementById('folderInput');
const addBtn = document.getElementById('addBtn');
const folderList = document.getElementById('folderList');
const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogsBtn');

let pollInterval;

// 폴더 목록 로드
async function loadFolders() {
    try {
        const res = await fetch('/api/folders');
        const data = await res.json();
        renderFolders(data.folders);
    } catch (e) {
        console.error('폴더 목록 로드 실패:', e);
    }
}

// 폴더 목록 렌더링
function renderFolders(folders) {
    if (folders.length === 0) {
        folderList.innerHTML = '<li class="empty">감시 중인 폴더가 없습니다.</li>';
        return;
    }

    folderList.innerHTML = folders.map(folder => `
        <li>
            <span class="path">${escapeHtml(folder)}</span>
            <button onclick="removeFolder('${escapeHtml(folder.replace(/\\/g, '\\\\'))}')">삭제</button>
        </li>
    `).join('');
}

// 폴더 추가
async function addFolder() {
    const folder = folderInput.value.trim();
    if (!folder) {
        alert('폴더 경로를 입력하세요.');
        return;
    }

    try {
        const res = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder })
        });

        const data = await res.json();
        if (data.success) {
            folderInput.value = '';
            loadFolders();
        } else {
            alert(data.error || '폴더 추가 실패');
        }
    } catch (e) {
        alert('서버 오류');
    }
}

// 폴더 삭제
async function removeFolder(folder) {
    if (!confirm('이 폴더의 감시를 중지하시겠습니까?')) return;

    try {
        const res = await fetch('/api/folders', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder })
        });

        const data = await res.json();
        if (data.success) {
            loadFolders();
        } else {
            alert(data.error || '폴더 삭제 실패');
        }
    } catch (e) {
        alert('서버 오류');
    }
}

// 로그 로드
async function loadLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        renderLogs(data.logs);
    } catch (e) {
        console.error('로그 로드 실패:', e);
    }
}

// 로그 렌더링
function renderLogs(logs) {
    if (logs.length === 0) {
        logContainer.innerHTML = '<div class="log-empty">변경 기록이 없습니다.</div>';
        return;
    }

    logContainer.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleString('ko-KR');
        const actionClass = getActionClass(log.action);
        return `
            <div class="log-entry">
                <span class="time">${time}</span>
                <span class="action ${actionClass}">${log.action}</span>
                <span class="file">${escapeHtml(log.file)}</span>
                <div style="color:#666;font-size:11px;margin-top:3px;">${escapeHtml(log.folder)}</div>
            </div>
        `;
    }).join('');
}

// 액션 클래스
function getActionClass(action) {
    if (action === '생성') return 'create';
    if (action === '수정') return 'modify';
    if (action === '삭제') return 'delete';
    return '';
}

// 로그 지우기
async function clearLogs() {
    if (!confirm('모든 로그를 지우시겠습니까?')) return;

    try {
        await fetch('/api/logs', { method: 'DELETE' });
        loadLogs();
    } catch (e) {
        alert('로그 삭제 실패');
    }
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 이벤트 리스너
addBtn.addEventListener('click', addFolder);
folderInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addFolder();
});
clearLogsBtn.addEventListener('click', clearLogs);

// 초기화
loadFolders();
loadLogs();

// 2초마다 로그 갱신
pollInterval = setInterval(loadLogs, 2000);
