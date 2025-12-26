// DOM 요소
const folderInput = document.getElementById('folderInput');
const addBtn = document.getElementById('addBtn');
const folderList = document.getElementById('folderList');
const logContainer = document.getElementById('logContainer');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const exportBtn = document.getElementById('exportBtn');
const logFilter = document.getElementById('logFilter');
const logSearch = document.getElementById('logSearch');

// 설정 요소
const filterInput = document.getElementById('filterInput');
const addFilterBtn = document.getElementById('addFilterBtn');
const filterList = document.getElementById('filterList');
const excludeInput = document.getElementById('excludeInput');
const addExcludeBtn = document.getElementById('addExcludeBtn');
const excludeList = document.getElementById('excludeList');
const notifyDesktop = document.getElementById('notifyDesktop');
const notifySound = document.getElementById('notifySound');
const telegramEnabled = document.getElementById('telegramEnabled');
const telegramToken = document.getElementById('telegramToken');
const telegramChatId = document.getElementById('telegramChatId');
const saveTelegramBtn = document.getElementById('saveTelegramBtn');
const testTelegramBtn = document.getElementById('testTelegramBtn');
const clearStatsBtn = document.getElementById('clearStatsBtn');

let settings = {};
let allLogs = [];
let hourlyChart = null;
let extensionChart = null;
let lastLogCount = 0;
let watchedFolders = [];

// 네비게이션 처리
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        if (section) {
            navigateTo(section);
        }
    });
});

// 섹션 링크 처리
document.querySelectorAll('[data-section]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        if (section) {
            navigateTo(section);
        }
    });
});

// 퀵 액션 처리
document.querySelectorAll('.action-card').forEach(card => {
    card.addEventListener('click', () => {
        const action = card.dataset.action;
        switch(action) {
            case 'folders':
                navigateTo('folders');
                break;
            case 'export':
                exportCSV();
                break;
            case 'stats':
                navigateTo('stats');
                break;
            case 'clear':
                clearLogs();
                break;
        }
    });
});

function navigateTo(section) {
    // 메뉴 활성화
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.section === section) {
            item.classList.add('active');
        }
    });

    // 섹션 표시
    document.querySelectorAll('.content-section').forEach(sec => {
        sec.classList.remove('active');
    });
    const targetSection = document.getElementById(section);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // 통계 탭이면 차트 로드
    if (section === 'stats') {
        loadStats();
    }
}

// 폴더 목록 로드
async function loadFolders() {
    try {
        const res = await fetch('/api/folders');
        const data = await res.json();
        watchedFolders = data.folders;
        renderFolders(data.folders);
        updateFolderCount();
    } catch (e) {
        console.error('폴더 목록 로드 실패:', e);
    }
}

// 폴더 수 업데이트
function updateFolderCount() {
    const statFolders = document.getElementById('statFolders');
    if (statFolders) {
        statFolders.textContent = watchedFolders.length;
    }
}

// 폴더 목록 렌더링
function renderFolders(folders) {
    if (folders.length === 0) {
        folderList.innerHTML = `
            <li class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p>감시 중인 폴더가 없습니다</p>
            </li>
        `;
        return;
    }

    folderList.innerHTML = folders.map(folder => `
        <li>
            <span class="folder-path">${escapeHtml(folder)}</span>
            <button class="btn btn-danger" onclick="removeFolder('${escapeHtml(folder.replace(/\\/g, '\\\\'))}')">삭제</button>
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
        allLogs = data.logs;

        // 새 로그 알림
        if (allLogs.length > lastLogCount && lastLogCount > 0) {
            const newLog = allLogs[0];
            showNotification(newLog);
        }
        lastLogCount = allLogs.length;

        renderLogs();
        updateHeaderStats();
        updateLastUpdate();
        renderRecentActivity();
    } catch (e) {
        console.error('로그 로드 실패:', e);
    }
}

// 마지막 업데이트 시간
function updateLastUpdate() {
    const lastUpdate = document.getElementById('lastUpdate');
    const lastCheck = document.getElementById('lastCheck');
    const now = new Date().toLocaleString('ko-KR');
    if (lastUpdate) lastUpdate.textContent = now;
    if (lastCheck) lastCheck.textContent = now;
}

// 최근 활동 렌더링
function renderRecentActivity() {
    const recentActivity = document.getElementById('recentActivity');
    if (!recentActivity) return;

    const recentLogs = allLogs.slice(0, 5);

    if (recentLogs.length === 0) {
        recentActivity.innerHTML = `
            <div class="empty-state">
                <p>아직 변경 기록이 없습니다</p>
            </div>
        `;
        return;
    }

    recentActivity.innerHTML = recentLogs.map(log => {
        const time = new Date(log.timestamp).toLocaleString('ko-KR');
        const actionClass = getActionClass(log.action);
        return `
            <div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-action ${actionClass}">${log.action}</span>
                <div class="log-file">
                    ${escapeHtml(log.file)}
                    <div class="log-folder">${escapeHtml(log.folder)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// 로그 렌더링 (필터 적용)
function renderLogs() {
    let logs = allLogs;

    // 액션 필터
    const filterValue = logFilter.value;
    if (filterValue !== 'all') {
        logs = logs.filter(log => log.action === filterValue);
    }

    // 검색 필터
    const searchValue = logSearch.value.toLowerCase();
    if (searchValue) {
        logs = logs.filter(log => log.file.toLowerCase().includes(searchValue));
    }

    if (logs.length === 0) {
        logContainer.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                </svg>
                <p>변경 기록이 없습니다</p>
            </div>
        `;
        return;
    }

    logContainer.innerHTML = logs.map(log => {
        const time = new Date(log.timestamp).toLocaleString('ko-KR');
        const actionClass = getActionClass(log.action);
        return `
            <div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-action ${actionClass}">${log.action}</span>
                <div class="log-file">
                    ${escapeHtml(log.file)}
                    <div class="log-folder">${escapeHtml(log.folder)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// 헤더 통계 업데이트
function updateHeaderStats() {
    const create = allLogs.filter(l => l.action === '생성').length;
    const modify = allLogs.filter(l => l.action === '수정').length;
    const del = allLogs.filter(l => l.action === '삭제').length;

    const statCreate = document.getElementById('statCreate');
    const statModify = document.getElementById('statModify');
    const statDelete = document.getElementById('statDelete');

    if (statCreate) statCreate.textContent = create;
    if (statModify) statModify.textContent = modify;
    if (statDelete) statDelete.textContent = del;
}

// 알림 표시
function showNotification(log) {
    if (settings.notifications?.desktop && Notification.permission === 'granted') {
        new Notification(`파일 ${log.action}`, {
            body: log.file,
            icon: '/icon.png'
        });
    }

    if (settings.notifications?.sound) {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.play().catch(() => {});
        }
    }
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
        allLogs = [];
        lastLogCount = 0;
        renderLogs();
        updateHeaderStats();
        renderRecentActivity();
    } catch (e) {
        alert('로그 삭제 실패');
    }
}

// CSV 내보내기
function exportCSV() {
    window.location.href = '/api/logs/export';
}

// 통계 로드
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const stats = await res.json();

        const totalCreate = document.getElementById('totalCreate');
        const totalModify = document.getElementById('totalModify');
        const totalDelete = document.getElementById('totalDelete');

        if (totalCreate) totalCreate.textContent = stats.created;
        if (totalModify) totalModify.textContent = stats.modified;
        if (totalDelete) totalDelete.textContent = stats.deleted;

        renderHourlyChart(stats.byHour);
        renderExtensionChart(stats.byExtension);
    } catch (e) {
        console.error('통계 로드 실패:', e);
    }
}

// 시간대별 차트
function renderHourlyChart(data) {
    const canvas = document.getElementById('hourlyChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (hourlyChart) {
        hourlyChart.destroy();
    }

    hourlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}시`),
            datasets: [{
                label: '변경 횟수',
                data: data,
                backgroundColor: 'rgba(0, 212, 170, 0.6)',
                borderColor: '#00d4aa',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#8b949e' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    ticks: { color: '#8b949e' },
                    grid: { display: false }
                }
            }
        }
    });
}

// 확장자별 차트
function renderExtensionChart(data) {
    const canvas = document.getElementById('extensionChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (extensionChart) {
        extensionChart.destroy();
    }

    const labels = Object.keys(data).slice(0, 10);
    const values = labels.map(k => data[k]);
    const colors = [
        '#00d4aa', '#3fb950', '#d29922', '#f85149', '#a371f7',
        '#58a6ff', '#f778ba', '#79c0ff', '#7ee787', '#ffa657'
    ];

    extensionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#8b949e',
                        padding: 15,
                        usePointStyle: true
                    }
                }
            }
        }
    });
}

// 통계 초기화
async function clearStats() {
    if (!confirm('통계를 초기화하시겠습니까?')) return;

    try {
        await fetch('/api/stats', { method: 'DELETE' });
        loadStats();
    } catch (e) {
        alert('통계 초기화 실패');
    }
}

// 설정 로드
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        settings = await res.json();

        renderFilters();
        renderExcludes();

        if (notifyDesktop) notifyDesktop.checked = settings.notifications?.desktop ?? true;
        if (notifySound) notifySound.checked = settings.notifications?.sound ?? true;
        if (telegramEnabled) telegramEnabled.checked = settings.telegram?.enabled ?? false;
        if (telegramToken) telegramToken.value = settings.telegram?.botToken ?? '';
        if (telegramChatId) telegramChatId.value = settings.telegram?.chatId ?? '';
    } catch (e) {
        console.error('설정 로드 실패:', e);
    }
}

// 설정 저장
async function saveSettings() {
    settings.notifications = {
        desktop: notifyDesktop?.checked ?? true,
        sound: notifySound?.checked ?? true
    };

    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
    } catch (e) {
        console.error('설정 저장 실패:', e);
    }
}

// 필터 렌더링
function renderFilters() {
    if (!filterList) return;
    filterList.innerHTML = (settings.filters || []).map(f => `
        <span class="tag">${f}<span class="remove" onclick="removeFilter('${f}')">&times;</span></span>
    `).join('');
}

// 필터 추가
async function addFilter() {
    let filter = filterInput.value.trim().toLowerCase();
    if (!filter) return;
    if (!filter.startsWith('.')) filter = '.' + filter;

    if (!settings.filters) settings.filters = [];
    if (!settings.filters.includes(filter)) {
        settings.filters.push(filter);
        await saveSettings();
        renderFilters();
    }
    filterInput.value = '';
}

// 필터 삭제
async function removeFilter(filter) {
    settings.filters = settings.filters.filter(f => f !== filter);
    await saveSettings();
    renderFilters();
}

// 제외 패턴 렌더링
function renderExcludes() {
    if (!excludeList) return;
    excludeList.innerHTML = (settings.excludePatterns || []).map(p => `
        <span class="tag">${p}<span class="remove" onclick="removeExclude('${escapeHtml(p)}')">&times;</span></span>
    `).join('');
}

// 제외 패턴 추가
async function addExclude() {
    const pattern = excludeInput.value.trim();
    if (!pattern) return;

    if (!settings.excludePatterns) settings.excludePatterns = [];
    if (!settings.excludePatterns.includes(pattern)) {
        settings.excludePatterns.push(pattern);
        await saveSettings();
        renderExcludes();
    }
    excludeInput.value = '';
}

// 제외 패턴 삭제
async function removeExclude(pattern) {
    settings.excludePatterns = settings.excludePatterns.filter(p => p !== pattern);
    await saveSettings();
    renderExcludes();
}

// 텔레그램 설정 저장
async function saveTelegram() {
    settings.telegram = {
        enabled: telegramEnabled?.checked ?? false,
        botToken: telegramToken?.value.trim() ?? '',
        chatId: telegramChatId?.value.trim() ?? ''
    };

    try {
        await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        alert('텔레그램 설정이 저장되었습니다.');
    } catch (e) {
        alert('저장 실패');
    }
}

// 텔레그램 테스트
async function testTelegram() {
    try {
        await fetch('/api/telegram/test', { method: 'POST' });
        alert('테스트 메시지를 전송했습니다.');
    } catch (e) {
        alert('전송 실패');
    }
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 이벤트 리스너
if (addBtn) addBtn.addEventListener('click', addFolder);
if (folderInput) folderInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addFolder();
});
if (clearLogsBtn) clearLogsBtn.addEventListener('click', clearLogs);
if (exportBtn) exportBtn.addEventListener('click', exportCSV);
if (logFilter) logFilter.addEventListener('change', renderLogs);
if (logSearch) logSearch.addEventListener('input', renderLogs);

if (addFilterBtn) addFilterBtn.addEventListener('click', addFilter);
if (filterInput) filterInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addFilter();
});
if (addExcludeBtn) addExcludeBtn.addEventListener('click', addExclude);
if (excludeInput) excludeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addExclude();
});

if (notifyDesktop) notifyDesktop.addEventListener('change', saveSettings);
if (notifySound) notifySound.addEventListener('change', saveSettings);
if (saveTelegramBtn) saveTelegramBtn.addEventListener('click', saveTelegram);
if (testTelegramBtn) testTelegramBtn.addEventListener('click', testTelegram);
if (clearStatsBtn) clearStatsBtn.addEventListener('click', clearStats);

// 알림 권한 요청
if (Notification.permission === 'default') {
    Notification.requestPermission();
}

// 초기화
loadFolders();
loadLogs();
loadSettings();

// 2초마다 로그 갱신
setInterval(loadLogs, 2000);
