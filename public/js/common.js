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
            <div class="folder-actions">
                <button class="btn btn-icon" onclick="openFolder('${escapeHtml(folder.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')" title="폴더 열기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </button>
                <button class="btn btn-danger" onclick="removeFolder('${escapeHtml(folder.replace(/\\/g, '\\\\'))}')">삭제</button>
            </div>
        </li>
    `).join('');
}

// 폴더 열기 (Finder/탐색기)
async function openFolder(folderPath) {
    try {
        const res = await fetch('/api/folder/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: folderPath })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.error || '폴더를 열 수 없습니다.');
        }
    } catch (e) {
        console.error('폴더 열기 실패:', e);
        alert('폴더를 열 수 없습니다.');
    }
}

// 파일 위치 열기 (Finder/탐색기에서 파일 선택)
async function openFile(filePath) {
    try {
        const res = await fetch('/api/file/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: filePath })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.error || '파일을 열 수 없습니다.');
        }
    } catch (e) {
        console.error('파일 열기 실패:', e);
        alert('파일을 열 수 없습니다.');
    }
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

    logContainer.innerHTML = logs.map((log, index) => {
        const time = new Date(log.timestamp).toLocaleString('ko-KR');
        const actionClass = getActionClass(log.action);
        const isDocumentFile = isAnalyzableDocument(log.extension);
        const escapedFullPath = escapeHtml(log.fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
        const escapedFolder = escapeHtml(log.folder.replace(/\\/g, '\\\\').replace(/'/g, "\\'"));

        const analyzeBtn = isDocumentFile ? `
            <button class="btn btn-analyze" onclick="analyzeDocument('${escapedFullPath}')" title="AI 요약">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                </svg>
                요약
            </button>
        ` : '';

        // 변경 요약 아이콘 (클릭 시 팝업)
        let changeSummaryBtn = '';
        if (log.changeSummary && log.changeSummary.summary) {
            const summaryClass = log.changeSummary.type === 'new' ? 'summary-new' :
                                log.changeSummary.type === 'deleted' ? 'summary-deleted' : 'summary-modified';
            const summaryData = encodeURIComponent(JSON.stringify(log.changeSummary));
            changeSummaryBtn = `
                <button class="btn btn-icon btn-change-info ${summaryClass}"
                        onclick="showChangeSummary(event, '${escapeHtml(log.file)}', '${summaryData}')"
                        title="변경 내역 보기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                </button>
            `;
        }

        return `
            <div class="log-entry">
                <span class="log-time">${time}</span>
                <span class="log-action ${actionClass}">${log.action}</span>
                <div class="log-file">
                    <div class="log-file-name">${escapeHtml(log.file)}</div>
                    <div class="log-folder">${escapeHtml(log.folder)}</div>
                </div>
                <div class="log-actions">
                    ${changeSummaryBtn}
                    <button class="btn btn-icon" onclick="openFile('${escapedFullPath}')" title="파일 위치 열기">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <path d="M14 2v6h6"/>
                        </svg>
                    </button>
                    <button class="btn btn-icon" onclick="openFolder('${escapedFolder}')" title="폴더 열기">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                        </svg>
                    </button>
                    ${analyzeBtn}
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
        // 변경 요약이 있으면 알림에 포함
        let body = log.file;
        if (log.changeSummary && log.changeSummary.summary) {
            body += `\n📊 ${log.changeSummary.summary}`;
        }
        body += `\n📂 ${log.folder}`;

        new Notification(`파일 ${log.action}`, {
            body: body,
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

// 변경 요약 팝업 표시
function showChangeSummary(event, fileName, summaryData) {
    event.stopPropagation();

    // 기존 팝업 제거
    const existingPopup = document.getElementById('changeSummaryPopup');
    if (existingPopup) existingPopup.remove();

    const summary = JSON.parse(decodeURIComponent(summaryData));

    // 타입별 아이콘과 색상
    let typeIcon = '📝';
    let typeText = '수정됨';
    let typeClass = 'modified';

    if (summary.type === 'new') {
        typeIcon = '✨';
        typeText = '새 파일';
        typeClass = 'new';
    } else if (summary.type === 'deleted') {
        typeIcon = '🗑️';
        typeText = '삭제됨';
        typeClass = 'deleted';
    }

    // 상세 정보 구성
    let statsHtml = '';
    let fileInfoHtml = '';
    let changesHtml = '';

    if (summary.details) {
        const details = summary.details;

        // 기본 통계
        let statsItems = [];
        if (details.lengthDiff !== undefined && details.lengthDiff !== 0) {
            const sign = details.lengthDiff > 0 ? '+' : '';
            statsItems.push(`<span class="stat-item ${details.lengthDiff > 0 ? 'added' : 'removed'}">${sign}${details.lengthDiff}자</span>`);
        }
        if (details.addedCount > 0) {
            statsItems.push(`<span class="stat-item added">+${details.addedCount}항목</span>`);
        }
        if (details.removedCount > 0) {
            statsItems.push(`<span class="stat-item removed">-${details.removedCount}항목</span>`);
        }
        if (statsItems.length > 0) {
            statsHtml = `<div class="popup-stats">${statsItems.join(' ')}</div>`;
        }

        // 파일 타입별 상세 정보
        if (details.fileTypeInfo) {
            const info = details.fileTypeInfo;
            if (info.type === 'text' && info.lineDiff !== 0) {
                const sign = info.lineDiff > 0 ? '+' : '';
                fileInfoHtml += `<div class="file-info-item">📄 줄 수: ${info.prevLines} → ${info.currLines} (${sign}${info.lineDiff}줄)</div>`;
            } else if (info.type === 'pptx') {
                if (info.slideDiff !== 0) {
                    const sign = info.slideDiff > 0 ? '+' : '';
                    fileInfoHtml += `<div class="file-info-item">📊 슬라이드: ${info.prevSlides} → ${info.currSlides} (${sign}${info.slideDiff}장)</div>`;
                } else {
                    fileInfoHtml += `<div class="file-info-item">📊 슬라이드: ${info.currSlides}장</div>`;
                }
            } else if (info.type === 'xlsx') {
                if (info.sheetDiff !== 0) {
                    const sign = info.sheetDiff > 0 ? '+' : '';
                    fileInfoHtml += `<div class="file-info-item">📋 시트: ${info.prevSheets} → ${info.currSheets} (${sign}${info.sheetDiff}개)</div>`;
                }
                if (info.newSheets && info.newSheets.length > 0) {
                    fileInfoHtml += `<div class="file-info-item new-sheets">➕ 새 시트: ${info.newSheets.join(', ')}</div>`;
                }
                if (info.removedSheets && info.removedSheets.length > 0) {
                    fileInfoHtml += `<div class="file-info-item removed-sheets">➖ 삭제된 시트: ${info.removedSheets.join(', ')}</div>`;
                }
            }
        }

        // 추가된 내용 표시
        if (details.added && details.added.length > 0) {
            const moreCount = details.addedCount > details.added.length ? ` 외 ${details.addedCount - details.added.length}개` : '';
            changesHtml += `<div class="changes-section added">
                <div class="changes-title">➕ 추가된 내용${moreCount}</div>
                ${details.added.map(text => `<div class="change-item">${escapeHtml(text)}</div>`).join('')}
            </div>`;
        }

        // 삭제된 내용 표시
        if (details.removed && details.removed.length > 0) {
            const moreCount = details.removedCount > details.removed.length ? ` 외 ${details.removedCount - details.removed.length}개` : '';
            changesHtml += `<div class="changes-section removed">
                <div class="changes-title">➖ 삭제된 내용${moreCount}</div>
                ${details.removed.map(text => `<div class="change-item">${escapeHtml(text)}</div>`).join('')}
            </div>`;
        }
    }

    // 팝업 생성
    const popup = document.createElement('div');
    popup.id = 'changeSummaryPopup';
    popup.className = 'change-summary-popup';
    popup.innerHTML = `
        <div class="popup-header">
            <span class="popup-icon">${typeIcon}</span>
            <span class="popup-title">변경 내역</span>
            <button class="popup-close" onclick="closeChangeSummaryPopup()">×</button>
        </div>
        <div class="popup-content">
            <div class="popup-filename">${escapeHtml(fileName)}</div>
            <div class="popup-type ${typeClass}">${typeText}</div>
            ${statsHtml}
            ${fileInfoHtml ? `<div class="popup-file-info">${fileInfoHtml}</div>` : ''}
            ${changesHtml ? `<div class="popup-changes">${changesHtml}</div>` : ''}
        </div>
    `;

    document.body.appendChild(popup);

    // 위치 조정
    const rect = event.target.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 10}px`;
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 280)}px`;

    // 외부 클릭 시 닫기
    setTimeout(() => {
        document.addEventListener('click', closeChangeSummaryOnOutsideClick);
    }, 100);
}

function closeChangeSummaryPopup() {
    const popup = document.getElementById('changeSummaryPopup');
    if (popup) popup.remove();
    document.removeEventListener('click', closeChangeSummaryOnOutsideClick);
}

function closeChangeSummaryOnOutsideClick(event) {
    const popup = document.getElementById('changeSummaryPopup');
    if (popup && !popup.contains(event.target)) {
        closeChangeSummaryPopup();
    }
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

        // Whisper 상태 확인
        loadWhisperStatus();

        // AI 모델 상태 확인
        loadAiModelStatus();
    } catch (e) {
        console.error('설정 로드 실패:', e);
    }
}

// 음성 인식 상태 로드
async function loadWhisperStatus() {
    try {
        const res = await fetch('/api/whisper/status');
        const status = await res.json();

        const whisperStateSettings = document.getElementById('whisperStateSettings');

        if (whisperStateSettings) {
            if (status.ready) {
                whisperStateSettings.textContent = '정상 동작 중 ✓';
                whisperStateSettings.className = 'status-value ready';
            } else {
                whisperStateSettings.textContent = '준비 필요';
                whisperStateSettings.className = 'status-value error';
            }
        }
    } catch (e) {
        console.error('음성 인식 상태 확인 실패:', e);
        const whisperStateSettings = document.getElementById('whisperStateSettings');
        if (whisperStateSettings) {
            whisperStateSettings.textContent = '확인 실패';
            whisperStateSettings.className = 'status-value error';
        }
    }
}

// AI 상태 로드
async function loadAiModelStatus() {
    try {
        const res = await fetch('/api/ollama/status');
        const status = await res.json();

        const ollamaStatus = document.getElementById('ollamaStatus');

        if (ollamaStatus) {
            if (status.ready) {
                ollamaStatus.textContent = '정상 동작 중 ✓';
                ollamaStatus.style.color = 'var(--success)';
            } else {
                ollamaStatus.textContent = status.error || '연결 실패';
                ollamaStatus.style.color = 'var(--danger)';
            }
        }
    } catch (e) {
        console.error('AI 상태 확인 실패:', e);
        const ollamaStatus = document.getElementById('ollamaStatus');
        if (ollamaStatus) {
            ollamaStatus.textContent = '확인 실패';
            ollamaStatus.style.color = 'var(--danger)';
        }
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

// ========================================
// 문서 분석 기능 (PPTX, DOCX, XLSX)
// ========================================

// 분석 가능한 문서 확장자 체크
function isAnalyzableDocument(extension) {
    const analyzable = [
        // Office 문서
        '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
        // 텍스트 파일
        '.txt', '.md', '.markdown', '.rtf',
        // PDF
        '.pdf',
        // 코드 파일
        '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
        '.css', '.scss', '.less', '.html', '.xml', '.json', '.yaml', '.yml'
    ];
    return analyzable.includes(extension?.toLowerCase());
}

// 문서 분석 실행
async function analyzeDocument(filePath) {
    try {
        // 분석 중 표시
        const modal = showAnalysisModal('analyzing');

        const res = await fetch('/api/document/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
        });

        const result = await res.json();

        if (result.error) {
            showAnalysisModal('error', result.error);
        } else {
            showAnalysisModal('result', result);
        }
    } catch (e) {
        console.error('문서 분석 오류:', e);
        showAnalysisModal('error', '문서 분석 중 오류가 발생했습니다.');
    }
}

// 분석 결과 모달 표시
function showAnalysisModal(state, data) {
    // 기존 모달 제거
    const existingModal = document.getElementById('analysisModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'analysisModal';
    modal.className = 'analysis-modal-overlay';

    let content = '';

    if (state === 'analyzing') {
        content = `
            <div class="analysis-modal">
                <div class="analysis-header">
                    <h3>문서 분석 중...</h3>
                </div>
                <div class="analysis-body">
                    <div class="analysis-loading">
                        <div class="spinner"></div>
                        <p>문서를 분석하고 있습니다. 잠시 기다려주세요.</p>
                    </div>
                </div>
            </div>
        `;
    } else if (state === 'error') {
        content = `
            <div class="analysis-modal">
                <div class="analysis-header">
                    <h3>분석 오류</h3>
                    <button class="close-btn" onclick="closeAnalysisModal()">&times;</button>
                </div>
                <div class="analysis-body">
                    <div class="analysis-error">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p>${escapeHtml(data)}</p>
                    </div>
                </div>
                <div class="analysis-footer">
                    <button class="btn btn-secondary" onclick="closeAnalysisModal()">닫기</button>
                </div>
            </div>
        `;
    } else if (state === 'result') {
        const result = data;
        let changesHtml = '';

        // AI 요약 섹션
        const aiSummaryHtml = result.aiSummary ? `
            <div class="analysis-section ai-summary-section">
                <h4>✨ AI 요약</h4>
                <div class="ai-summary-content">
                    <pre class="ai-summary-text">${escapeHtml(result.aiSummary)}</pre>
                </div>
            </div>
        ` : '';

        if (result.isNewDocument) {
            // 새 문서 개요
            const overview = result.overview || {};
            changesHtml = `
                ${aiSummaryHtml}
                <div class="analysis-section">
                    <h4>📄 새 문서 분석</h4>
                    <ul class="analysis-list">
                        <li><strong>문서 유형:</strong> ${result.documentType}</li>
                        <li><strong>글자 수:</strong> ${overview.contentLength?.toLocaleString() || 0}자</li>
                        <li><strong>단어 수:</strong> ${overview.wordCount?.toLocaleString() || 0}개</li>
                        ${overview.slideCount ? `<li><strong>슬라이드:</strong> ${overview.slideCount}장</li>` : ''}
                        ${overview.sheetCount ? `<li><strong>시트:</strong> ${overview.sheetCount}개 (${overview.sheetNames?.join(', ') || ''})</li>` : ''}
                    </ul>
                </div>
                ${overview.topKeywords?.length > 0 ? `
                    <div class="analysis-section">
                        <h4>🔑 주요 키워드</h4>
                        <div class="keyword-tags">
                            ${overview.topKeywords.map(k => `<span class="keyword-tag">${escapeHtml(k.word)} (${k.count})</span>`).join('')}
                        </div>
                    </div>
                ` : ''}
            `;
        } else {
            // 변경 사항
            changesHtml = `
                ${aiSummaryHtml}
                <div class="analysis-section">
                    <h4>📝 변경 사항 요약</h4>
                    <p class="analysis-meta">이전 분석: ${new Date(result.previousAnalyzedAt).toLocaleString('ko-KR')}</p>
                    <ul class="changes-list">
                        ${result.changes.map(change => {
                            let changeContent = `<strong>${change.type}</strong>`;
                            if (change.description) {
                                changeContent += `: ${escapeHtml(change.description)}`;
                            }
                            if (change.keywords) {
                                changeContent += `<br><span class="change-keywords">${change.keywords.slice(0, 5).map(k => escapeHtml(k)).join(', ')}${change.keywords.length > 5 ? '...' : ''}</span>`;
                            }
                            if (change.sheets) {
                                changeContent += `: ${change.sheets.join(', ')}`;
                            }
                            return `<li>${changeContent}</li>`;
                        }).join('')}
                    </ul>
                </div>
            `;
        }

        content = `
            <div class="analysis-modal">
                <div class="analysis-header">
                    <h3>📊 문서 변경 요약</h3>
                    <button class="close-btn" onclick="closeAnalysisModal()">&times;</button>
                </div>
                <div class="analysis-body">
                    <div class="analysis-info">
                        <div class="file-info">
                            <span class="file-name">${escapeHtml(result.fileName)}</span>
                            <span class="file-type">${result.documentType}</span>
                        </div>
                        <p class="analysis-time">분석 시간: ${new Date(result.analyzedAt).toLocaleString('ko-KR')}</p>
                    </div>
                    ${changesHtml}
                </div>
                <div class="analysis-footer">
                    <button class="btn btn-secondary" onclick="closeAnalysisModal()">닫기</button>
                </div>
            </div>
        `;
    }

    modal.innerHTML = content;
    document.body.appendChild(modal);

    // 모달 바깥 클릭시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAnalysisModal();
    });

    return modal;
}

// 분석 모달 닫기
function closeAnalysisModal() {
    const modal = document.getElementById('analysisModal');
    if (modal) modal.remove();
}

// ========================================
// 폴더/파일 선택 기능 (Electron API 사용)
// ========================================

const selectFolderBtn = document.getElementById('selectFolderBtn');
const selectFileBtn = document.getElementById('selectFileBtn');
const selectMultipleFoldersBtn = document.getElementById('selectMultipleFoldersBtn');
const selectMultipleFilesBtn = document.getElementById('selectMultipleFilesBtn');

// Electron 환경 체크
function isElectron() {
    return window.electronAPI && window.electronAPI.isElectron;
}

// 폴더 선택
async function selectFolder() {
    if (!isElectron()) {
        alert('이 기능은 데스크톱 앱에서만 사용할 수 있습니다.\n경로를 직접 입력해주세요.');
        return;
    }

    try {
        const folderPath = await window.electronAPI.selectFolder();
        if (folderPath) {
            await addFolderByPath(folderPath);
        }
    } catch (e) {
        console.error('폴더 선택 오류:', e);
        alert('폴더 선택 중 오류가 발생했습니다.');
    }
}

// 파일 선택
async function selectFile() {
    if (!isElectron()) {
        alert('이 기능은 데스크톱 앱에서만 사용할 수 있습니다.\n경로를 직접 입력해주세요.');
        return;
    }

    try {
        const filePath = await window.electronAPI.selectFile();
        if (filePath) {
            await addFolderByPath(filePath);
        }
    } catch (e) {
        console.error('파일 선택 오류:', e);
        alert('파일 선택 중 오류가 발생했습니다.');
    }
}

// 여러 폴더 선택
async function selectMultipleFolders() {
    if (!isElectron()) {
        alert('이 기능은 데스크톱 앱에서만 사용할 수 있습니다.\n경로를 직접 입력해주세요.');
        return;
    }

    try {
        const folderPaths = await window.electronAPI.selectMultiple('folder');
        if (folderPaths && folderPaths.length > 0) {
            for (const path of folderPaths) {
                await addFolderByPath(path);
            }
        }
    } catch (e) {
        console.error('폴더 선택 오류:', e);
        alert('폴더 선택 중 오류가 발생했습니다.');
    }
}

// 여러 파일 선택
async function selectMultipleFiles() {
    if (!isElectron()) {
        alert('이 기능은 데스크톱 앱에서만 사용할 수 있습니다.\n경로를 직접 입력해주세요.');
        return;
    }

    try {
        const filePaths = await window.electronAPI.selectMultiple('file');
        if (filePaths && filePaths.length > 0) {
            for (const path of filePaths) {
                await addFolderByPath(path);
            }
        }
    } catch (e) {
        console.error('파일 선택 오류:', e);
        alert('파일 선택 중 오류가 발생했습니다.');
    }
}

// 경로로 폴더/파일 추가
async function addFolderByPath(path) {
    try {
        const res = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: path })
        });

        const data = await res.json();
        if (data.success) {
            loadFolders();
        } else {
            alert(data.error || '추가 실패: ' + path);
        }
    } catch (e) {
        console.error('추가 오류:', e);
    }
}

// 선택 버튼 이벤트 리스너
if (selectFolderBtn) selectFolderBtn.addEventListener('click', selectFolder);
if (selectFileBtn) selectFileBtn.addEventListener('click', selectFile);
if (selectMultipleFoldersBtn) selectMultipleFoldersBtn.addEventListener('click', selectMultipleFolders);
if (selectMultipleFilesBtn) selectMultipleFilesBtn.addEventListener('click', selectMultipleFiles);

// ========================================
// 회의 녹음 기능
// ========================================

// 녹음 관련 DOM 요소
const startRecordingBtn = document.getElementById('startRecordingBtn');
const pauseRecordingBtn = document.getElementById('pauseRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const recordingTimer = document.getElementById('recordingTimer');
const visualizerCanvas = document.getElementById('visualizerCanvas');
const meetingTitleInput = document.getElementById('meetingTitle');
const audioQualitySelect = document.getElementById('audioQuality');
const recordingControls = document.querySelector('.recording-controls');
const recordingComplete = document.getElementById('recordingComplete');
const recordingInfo = document.getElementById('recordingInfo');
const generateMinutesBtn = document.getElementById('generateMinutesBtn');
const downloadRecordingBtn = document.getElementById('downloadRecordingBtn');
const discardRecordingBtn = document.getElementById('discardRecordingBtn');
const recordingCard = document.querySelector('.recording-card');

// 녹음 상태 변수
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let audioContext = null;
let analyser = null;
let recordingStartTime = null;
let timerInterval = null;
let isPaused = false;
let recordedBlob = null;
let animationId = null;

// 음질 설정
const qualitySettings = {
    low: { audioBitsPerSecond: 64000 },
    medium: { audioBitsPerSecond: 128000 },
    high: { audioBitsPerSecond: 256000 }
};

// 녹음 시작
async function startRecording() {
    try {
        // 마이크 권한 요청
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });

        // 오디오 컨텍스트 및 분석기 설정
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        analyser.fftSize = 256;

        // MediaRecorder 설정
        const quality = audioQualitySelect ? audioQualitySelect.value : 'medium';
        const options = {
            mimeType: 'audio/webm;codecs=opus',
            ...qualitySettings[quality]
        };

        mediaRecorder = new MediaRecorder(audioStream, options);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
            showRecordingComplete();
        };

        // 녹음 시작
        mediaRecorder.start(1000); // 1초마다 데이터 수집
        recordingStartTime = Date.now();
        isPaused = false;

        // UI 업데이트
        updateRecordingUI('recording');
        startTimer();
        startVisualizer();

        console.log('녹음 시작');
    } catch (error) {
        console.error('녹음 시작 실패:', error);
        if (error.name === 'NotAllowedError') {
            alert('마이크 사용 권한이 필요합니다.\n브라우저 설정에서 마이크 권한을 허용해주세요.');
        } else {
            alert('녹음을 시작할 수 없습니다: ' + error.message);
        }
    }
}

// 녹음 일시정지/재개
function togglePauseRecording() {
    if (!mediaRecorder) return;

    if (isPaused) {
        mediaRecorder.resume();
        isPaused = false;
        updateRecordingUI('recording');
        if (pauseRecordingBtn) {
            pauseRecordingBtn.textContent = '일시정지';
            pauseRecordingBtn.classList.remove('active');
        }
    } else {
        mediaRecorder.pause();
        isPaused = true;
        updateRecordingUI('paused');
        if (pauseRecordingBtn) {
            pauseRecordingBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                재개
            `;
            pauseRecordingBtn.classList.add('active');
        }
    }
}

// 녹음 중지
function stopRecording() {
    if (!mediaRecorder) return;

    mediaRecorder.stop();
    clearInterval(timerInterval);
    cancelAnimationFrame(animationId);

    // 스트림 정리
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    if (audioContext) {
        audioContext.close();
    }

    console.log('녹음 중지');
}

// UI 상태 업데이트
function updateRecordingUI(state) {
    if (!statusIndicator || !statusText) return;

    statusIndicator.className = 'status-indicator ' + state;

    switch (state) {
        case 'recording':
            statusText.textContent = '녹음 중';
            if (startRecordingBtn) startRecordingBtn.disabled = true;
            if (pauseRecordingBtn) pauseRecordingBtn.disabled = false;
            if (stopRecordingBtn) stopRecordingBtn.disabled = false;
            if (recordingCard) recordingCard.classList.add('is-recording');
            break;
        case 'paused':
            statusText.textContent = '일시정지';
            break;
        case 'ready':
            statusText.textContent = '대기 중';
            if (startRecordingBtn) startRecordingBtn.disabled = false;
            if (pauseRecordingBtn) pauseRecordingBtn.disabled = true;
            if (stopRecordingBtn) stopRecordingBtn.disabled = true;
            if (recordingCard) recordingCard.classList.remove('is-recording');
            break;
    }
}

// 타이머 시작
function startTimer() {
    timerInterval = setInterval(() => {
        if (!isPaused && recordingStartTime) {
            const elapsed = Date.now() - recordingStartTime;
            if (recordingTimer) {
                recordingTimer.textContent = formatTime(elapsed);
            }
        }
    }, 1000);
}

// 시간 포맷
function formatTime(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// 오디오 시각화
function startVisualizer() {
    if (!visualizerCanvas || !analyser) return;

    const canvasCtx = visualizerCanvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        animationId = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        canvasCtx.fillStyle = '#21262d';
        canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

        const barWidth = (visualizerCanvas.width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * visualizerCanvas.height;

            // 그라데이션 색상
            const gradient = canvasCtx.createLinearGradient(0, visualizerCanvas.height, 0, 0);
            gradient.addColorStop(0, '#f85149');
            gradient.addColorStop(1, '#00d4aa');

            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    draw();
}

// 녹음 완료 화면 표시
function showRecordingComplete() {
    if (recordingControls) recordingControls.style.display = 'none';
    if (recordingComplete) recordingComplete.style.display = 'block';

    const elapsed = Date.now() - recordingStartTime;
    if (recordingInfo) {
        recordingInfo.textContent = `녹음 시간: ${formatTime(elapsed)}`;
    }

    updateRecordingUI('ready');
}

// 녹음 초기화
function resetRecording() {
    recordedBlob = null;
    audioChunks = [];
    recordingStartTime = null;

    if (recordingTimer) recordingTimer.textContent = '00:00:00';
    if (recordingControls) recordingControls.style.display = 'flex';
    if (recordingComplete) recordingComplete.style.display = 'none';
    if (pauseRecordingBtn) {
        pauseRecordingBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
            </svg>
            일시정지
        `;
        pauseRecordingBtn.classList.remove('active');
    }

    updateRecordingUI('ready');
}

// 녹음 파일 다운로드 (WAV로 변환)
async function downloadRecording() {
    if (!recordedBlob) return;

    const title = meetingTitleInput?.value || '회의녹음';
    const date = new Date().toISOString().slice(0, 10);

    // WebM을 WAV로 변환
    try {
        const wavBlob = await convertWebmToWav(recordedBlob);
        const filename = `${title}_${date}.wav`;
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('WAV 변환 실패, WebM으로 다운로드:', error);
        // 변환 실패 시 원본 WebM 다운로드
        const filename = `${title}_${date}.webm`;
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// WebM을 WAV로 변환 (브라우저에서)
async function convertWebmToWav(webmBlob) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // WAV 파일 생성
    const numberOfChannels = 1; // 모노
    const sampleRate = 16000; // 16kHz (Whisper 권장)
    const length = audioBuffer.duration * sampleRate;
    const offlineContext = new OfflineAudioContext(numberOfChannels, length, sampleRate);

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();
    const wavBlob = audioBufferToWav(renderedBuffer);

    await audioContext.close();
    return wavBlob;
}

// AudioBuffer를 WAV Blob으로 변환
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    // WAV 헤더 작성
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // 오디오 데이터 작성
    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// 녹음 파일로 회의록 생성
async function generateMinutesFromRecording() {
    if (!recordedBlob) return;

    const title = meetingTitleInput?.value || '회의녹음';
    const file = new File([recordedBlob], `${title}.webm`, { type: 'audio/webm' });

    // 기존 handleAudioFile 함수 호출
    handleAudioFile(file);

    // 녹음 초기화
    resetRecording();
}

// 이벤트 리스너 등록
if (startRecordingBtn) startRecordingBtn.addEventListener('click', startRecording);
if (pauseRecordingBtn) pauseRecordingBtn.addEventListener('click', togglePauseRecording);
if (stopRecordingBtn) stopRecordingBtn.addEventListener('click', stopRecording);
if (generateMinutesBtn) generateMinutesBtn.addEventListener('click', generateMinutesFromRecording);
if (downloadRecordingBtn) downloadRecordingBtn.addEventListener('click', downloadRecording);
if (discardRecordingBtn) discardRecordingBtn.addEventListener('click', resetRecording);

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

// ========================================
// 회의록 기능
// ========================================

const uploadArea = document.getElementById('uploadArea');
const audioFileInput = document.getElementById('audioFileInput');
const processingCard = document.getElementById('processingCard');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const processingStatus = document.getElementById('processingStatus');
const meetingList = document.getElementById('meetingList');
const whisperStatus = document.getElementById('whisperStatus');

// 처리 중 상태 관리
let isProcessingAudio = false;

function setProcessingState(processing) {
    isProcessingAudio = processing;
    if (uploadArea) {
        if (processing) {
            uploadArea.classList.add('disabled');
            uploadArea.style.pointerEvents = 'none';
            uploadArea.style.opacity = '0.5';
        } else {
            uploadArea.classList.remove('disabled');
            uploadArea.style.pointerEvents = '';
            uploadArea.style.opacity = '';
        }
    }
    if (audioFileInput) {
        audioFileInput.disabled = processing;
    }
}

// 업로드 영역 이벤트
if (uploadArea) {
    uploadArea.addEventListener('click', () => {
        if (isProcessingAudio) {
            alert('현재 파일을 처리 중입니다. 완료될 때까지 기다려주세요.');
            return;
        }
        audioFileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (isProcessingAudio) {
            alert('현재 파일을 처리 중입니다. 완료될 때까지 기다려주세요.');
            return;
        }
        const file = e.dataTransfer.files[0];
        if (file && isAudioFile(file)) {
            handleAudioFile(file);
        } else {
            alert('지원되지 않는 파일 형식입니다.');
        }
    });
}

if (audioFileInput) {
    audioFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (isProcessingAudio) {
                alert('현재 파일을 처리 중입니다. 완료될 때까지 기다려주세요.');
                e.target.value = '';
                return;
            }
            handleAudioFile(file);
        }
    });
}

function isAudioFile(file) {
    const validTypes = ['audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/m4a', 'audio/x-m4a'];
    const validExts = ['.wav', '.mp3', '.m4a'];
    return validTypes.includes(file.type) || validExts.some(ext => file.name.toLowerCase().endsWith(ext));
}

async function handleAudioFile(file) {
    console.log('오디오 파일 처리:', file.name);

    // 처리 상태 설정 - 업로드 비활성화
    setProcessingState(true);

    // 프로그래스 UI 표시
    if (processingCard) processingCard.style.display = 'block';
    updateProgressUI(0, '파일 업로드 중...');

    // FormData로 파일 전송
    const formData = new FormData();
    formData.append('audio', file);

    // 서버 진행 상황 폴링
    let progressInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/processing/progress');
            const progress = await res.json();
            if (progress.active) {
                const text = progress.detail
                    ? `${progress.stage} - ${progress.detail}`
                    : progress.stage;
                updateProgressUI(progress.percent, text);
            }
        } catch (e) {
            // 폴링 실패는 무시
        }
    }, 1000);

    try {
        updateProgressUI(5, '📤 서버로 전송 중...');

        const response = await fetch('/api/meeting/transcribe', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);

        if (!response.ok) {
            throw new Error('처리 실패');
        }

        const result = await response.json();

        if (result.success) {
            updateProgressUI(100, '✅ 완료!');
            setTimeout(() => {
                if (processingCard) processingCard.style.display = 'none';
                setProcessingState(false);
                loadMeetings();
                alert('회의록이 생성되었습니다!');
            }, 1500);
        } else {
            throw new Error(result.error || '알 수 없는 오류');
        }
    } catch (e) {
        clearInterval(progressInterval);
        console.error('회의록 생성 실패:', e);
        updateProgressUI(0, '❌ 오류 발생');
        if (processingStatus) processingStatus.textContent = e.message;
        setProcessingState(false);
        setTimeout(() => {
            if (processingCard) processingCard.style.display = 'none';
        }, 3000);
        alert('회의록 생성에 실패했습니다: ' + e.message);
    }
}

function updateProgressUI(percent, text) {
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressText) progressText.textContent = text;
}

// 전역 회의록 데이터 저장
let meetingsData = [];

async function loadMeetings() {
    try {
        const res = await fetch('/api/meetings');
        const data = await res.json();
        meetingsData = data.meetings || [];
        renderMeetings(meetingsData);
    } catch (e) {
        console.error('회의록 목록 로드 실패:', e);
    }
}

function renderMeetings(meetings) {
    if (!meetingList) return;

    if (meetings.length === 0) {
        meetingList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                </svg>
                <p>아직 생성된 회의록이 없습니다</p>
            </div>
        `;
        return;
    }

    meetingList.innerHTML = meetings.map(meeting => {
        const historyLen = meeting.summaryHistory?.length || (meeting.aiSummary ? 1 : 0);
        const currentIdx = meeting.currentSummaryIndex ?? (historyLen - 1);

        return `
        <div class="meeting-item" id="meeting-${meeting.id}">
            <div class="meeting-info">
                <div class="meeting-title">${escapeHtml(meeting.title)}</div>
                <div class="meeting-date">${new Date(meeting.createdAt).toLocaleString('ko-KR')}</div>
                ${meeting.aiSummary ? `<div class="meeting-summary-badge">✨ AI 요약 완료</div>` : ''}
            </div>
            <div class="meeting-actions">
                <button class="btn btn-primary" onclick="summarizeMeeting('${meeting.id}')" ${meeting.aiSummary ? 'title="다시 요약"' : ''}>
                    ${meeting.aiSummary ? '🔄 재요약' : '✨ AI 요약'}
                </button>
                <button class="btn btn-secondary" onclick="downloadMeeting('${meeting.id}')">다운로드</button>
                <button class="btn btn-danger" onclick="deleteMeeting('${meeting.id}')">삭제</button>
            </div>
            ${meeting.aiSummary ? `
                <div class="meeting-summary-content" data-meeting-id="${meeting.id}">
                    <div class="summary-header">
                        <div class="summary-header-left">
                            <strong>📝 AI 요약</strong>
                            <span class="summary-date" id="summaryDate-${meeting.id}">${meeting.summarizedAt ? new Date(meeting.summarizedAt).toLocaleString('ko-KR') : ''}</span>
                        </div>
                        <div class="summary-header-right">
                            ${historyLen > 1 ? `
                                <div class="summary-nav">
                                    <button class="nav-btn" onclick="navigateSummary('${meeting.id}', -1)" ${currentIdx <= 0 ? 'disabled' : ''}>‹</button>
                                    <span class="nav-indicator" id="navIndicator-${meeting.id}">${currentIdx + 1}/${historyLen}</span>
                                    <button class="nav-btn" onclick="navigateSummary('${meeting.id}', 1)" ${currentIdx >= historyLen - 1 ? 'disabled' : ''}>›</button>
                                </div>
                            ` : ''}
                            <button class="copy-btn" onclick="copySummary('${meeting.id}')" title="복사">
                                <span class="copy-icon">📋</span>
                            </button>
                        </div>
                    </div>
                    <pre class="summary-text" id="summaryText-${meeting.id}">${escapeHtml(meeting.aiSummary)}</pre>
                </div>
            ` : ''}
        </div>
    `}).join('');
}

// 요약 복사 함수
async function copySummary(meetingId) {
    const summaryText = document.getElementById(`summaryText-${meetingId}`);
    if (!summaryText) return;

    try {
        await navigator.clipboard.writeText(summaryText.textContent);

        // 복사 완료 피드백
        const copyBtn = document.querySelector(`[data-meeting-id="${meetingId}"] .copy-btn`);
        if (copyBtn) {
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '<span class="copy-icon">✓</span>';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = originalIcon;
                copyBtn.classList.remove('copied');
            }, 2000);
        }
    } catch (e) {
        console.error('복사 실패:', e);
        alert('복사에 실패했습니다.');
    }
}

// 요약 버전 네비게이션
async function navigateSummary(meetingId, direction) {
    const meeting = meetingsData.find(m => m.id === meetingId);
    if (!meeting || !meeting.summaryHistory || meeting.summaryHistory.length <= 1) return;

    const currentIdx = meeting.currentSummaryIndex ?? (meeting.summaryHistory.length - 1);
    const newIdx = currentIdx + direction;

    if (newIdx < 0 || newIdx >= meeting.summaryHistory.length) return;

    // 로컬 상태 업데이트
    meeting.currentSummaryIndex = newIdx;
    const selectedSummary = meeting.summaryHistory[newIdx];

    // UI 업데이트
    const summaryText = document.getElementById(`summaryText-${meetingId}`);
    const summaryDate = document.getElementById(`summaryDate-${meetingId}`);
    const navIndicator = document.getElementById(`navIndicator-${meetingId}`);

    if (summaryText) {
        summaryText.textContent = selectedSummary.summary;
    }
    if (summaryDate) {
        summaryDate.textContent = new Date(selectedSummary.createdAt).toLocaleString('ko-KR');
    }
    if (navIndicator) {
        navIndicator.textContent = `${newIdx + 1}/${meeting.summaryHistory.length}`;
    }

    // 버튼 상태 업데이트
    const container = document.querySelector(`[data-meeting-id="${meetingId}"]`);
    if (container) {
        const prevBtn = container.querySelector('.summary-nav .nav-btn:first-child');
        const nextBtn = container.querySelector('.summary-nav .nav-btn:last-child');
        if (prevBtn) prevBtn.disabled = newIdx <= 0;
        if (nextBtn) nextBtn.disabled = newIdx >= meeting.summaryHistory.length - 1;
    }
}

async function downloadMeeting(id) {
    try {
        const res = await fetch(`/api/meeting/download/${id}`);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: '다운로드 실패' }));
            alert(`다운로드 실패: ${errorData.error || '회의록을 찾을 수 없습니다'}`);
            return;
        }

        // 파일명 추출
        const contentDisposition = res.headers.get('Content-Disposition');
        let filename = '회의록.txt';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match && match[1]) {
                filename = decodeURIComponent(match[1].replace(/['"]/g, ''));
            }
        }

        // Blob으로 다운로드
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('다운로드 오류:', e);
        alert('다운로드 중 오류가 발생했습니다.');
    }
}

async function deleteMeeting(id) {
    if (!confirm('이 회의록을 삭제하시겠습니까?')) return;

    try {
        await fetch(`/api/meeting/${id}`, { method: 'DELETE' });
        loadMeetings();
    } catch (e) {
        alert('삭제 실패');
    }
}

// 요약 중 로딩 오버레이 표시
function showSummarizingOverlay() {
    // 기존 오버레이 제거
    hideSummarizingOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'summarizing-overlay';
    overlay.id = 'summarizingOverlay';
    overlay.innerHTML = `
        <div class="summarizing-spinner"></div>
        <div class="summarizing-text">✨ AI 요약 생성 중...</div>
        <div class="summarizing-detail" id="summarizingDetail">회의 내용을 분석하고 있습니다</div>
        <div class="summarizing-percent" id="summarizingPercent">0%</div>
        <div class="summarizing-progress">
            <div class="summarizing-progress-bar" id="summarizingProgressBar"></div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function updateSummarizingOverlay(text, percent) {
    const detail = document.getElementById('summarizingDetail');
    const progressBar = document.getElementById('summarizingProgressBar');
    const percentText = document.getElementById('summarizingPercent');
    if (detail) detail.textContent = text;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${Math.round(percent)}%`;
}

function hideSummarizingOverlay() {
    const overlay = document.getElementById('summarizingOverlay');
    if (overlay) overlay.remove();
}

// AI 요약 생성
async function summarizeMeeting(meetingId) {
    const meetingEl = document.getElementById(`meeting-${meetingId}`);
    const btn = meetingEl?.querySelector('.btn-primary');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 요약 중...';
    }

    // 로딩 오버레이 표시
    showSummarizingOverlay();

    // 진행 상황 폴링
    let progressInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/processing/progress');
            const progress = await res.json();
            if (progress.active) {
                const text = progress.detail
                    ? `${progress.stage} - ${progress.detail}`
                    : progress.stage;
                updateSummarizingOverlay(text, progress.percent);
            }
        } catch (e) {
            // 폴링 실패는 무시
        }
    }, 1000);

    try {
        const res = await fetch('/api/meeting/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meetingId })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || '요약 생성 실패');
        }

        // 성공 시 목록 새로고침
        await loadMeetings();

        // 요약된 회의록으로 스크롤
        const updatedEl = document.getElementById(`meeting-${meetingId}`);
        if (updatedEl) {
            updatedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            updatedEl.classList.add('highlight');
            setTimeout(() => updatedEl.classList.remove('highlight'), 2000);
        }

    } catch (e) {
        console.error('요약 오류:', e);
        alert(`요약 생성 실패: ${e.message}`);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✨ AI 요약';
        }
    } finally {
        clearInterval(progressInterval);
        hideSummarizingOverlay();
    }
}

// Ollama 상태 확인
async function checkOllamaStatus() {
    try {
        const res = await fetch('/api/ollama/status');
        const data = await res.json();
        return data;
    } catch (e) {
        return { ready: false, error: e.message };
    }
}

// Whisper 상태 체크
async function checkWhisperStatus() {
    try {
        const res = await fetch('/api/whisper/status');
        const data = await res.json();
        if (whisperStatus) {
            if (data.ready) {
                whisperStatus.textContent = '준비됨';
                whisperStatus.style.color = 'var(--success)';
            } else {
                whisperStatus.textContent = data.status || '준비 중';
                whisperStatus.style.color = 'var(--warning)';
            }
        }
    } catch (e) {
        if (whisperStatus) {
            whisperStatus.textContent = '연결 오류';
            whisperStatus.style.color = 'var(--danger)';
        }
    }
}

// ========================================
// 녹음 파일 목록 기능
// ========================================

const recordingList = document.getElementById('recordingList');

// 녹음 파일 목록 로드
async function loadRecordings() {
    try {
        const res = await fetch('/api/recordings');
        const data = await res.json();
        renderRecordings(data.recordings || []);
    } catch (e) {
        console.error('녹음 파일 목록 로드 실패:', e);
    }
}

// 녹음 파일 목록 렌더링
function renderRecordings(recordings) {
    if (!recordingList) return;

    if (recordings.length === 0) {
        recordingList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9 18V5l12-2v13"/>
                    <circle cx="6" cy="18" r="3"/>
                    <circle cx="18" cy="16" r="3"/>
                </svg>
                <p>저장된 녹음 파일이 없습니다</p>
            </div>
        `;
        return;
    }

    recordingList.innerHTML = recordings.map(recording => {
        const ext = recording.filename.split('.').pop().toUpperCase();
        const sizeStr = formatFileSize(recording.size);
        const dateStr = new Date(recording.createdAt).toLocaleString('ko-KR');

        return `
            <div class="recording-item">
                <div class="recording-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>
                <div class="recording-info">
                    <div class="recording-name">${escapeHtml(recording.filename)}</div>
                    <div class="recording-meta">
                        <span class="recording-format">${ext}</span>
                        <span class="recording-size">${sizeStr}</span>
                        <span class="recording-date">${dateStr}</span>
                    </div>
                </div>
                <div class="recording-actions">
                    <button class="btn btn-sm btn-primary" onclick="transcribeRecording('${escapeHtml(recording.filename)}')" title="회의록 생성">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="downloadRecordingFile('${escapeHtml(recording.filename)}')" title="다운로드">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteRecordingFile('${escapeHtml(recording.filename)}')" title="삭제">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 녹음 파일 다운로드
async function downloadRecordingFile(filename) {
    try {
        const res = await fetch(`/api/recording/download/${encodeURIComponent(filename)}`);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({ error: '다운로드 실패' }));
            alert(`다운로드 실패: ${errorData.error || '녹음 파일을 찾을 수 없습니다'}`);
            return;
        }

        // Blob으로 다운로드
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('다운로드 오류:', e);
        alert('다운로드 중 오류가 발생했습니다.');
    }
}

// 녹음 파일 삭제
async function deleteRecordingFile(filename) {
    if (!confirm(`녹음 파일을 삭제하시겠습니까?\n${filename}`)) return;

    try {
        const res = await fetch(`/api/recording/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (data.success) {
            loadRecordings();
        } else {
            alert(data.error || '삭제 실패');
        }
    } catch (e) {
        console.error('녹음 파일 삭제 실패:', e);
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// 녹음 파일에서 회의록 생성
async function transcribeRecording(filename) {
    if (!confirm(`이 녹음 파일로 회의록을 생성하시겠습니까?\n${filename}`)) return;

    // 프로그래스 UI 표시
    if (processingCard) processingCard.style.display = 'block';
    updateProgress(10, '녹음 파일 처리 중...');

    try {
        const res = await fetch('/api/recording/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        const result = await res.json();

        if (result.success) {
            updateProgress(100, '완료!');
            setTimeout(() => {
                if (processingCard) processingCard.style.display = 'none';
                loadMeetings();
                alert('회의록이 생성되었습니다!');
            }, 1000);
        } else {
            throw new Error(result.error || '회의록 생성 실패');
        }
    } catch (e) {
        console.error('회의록 생성 실패:', e);
        updateProgress(0, '오류 발생');
        if (processingStatus) processingStatus.textContent = e.message;
        alert('회의록 생성 실패: ' + e.message);
    }
}

// ========================================
// 라이선스 관리 기능
// ========================================

let currentLicenseStatus = null;
let appEnvironment = null;

// 앱 환경 확인 (Electron 앱 vs 웹 브라우저)
async function checkAppEnvironment() {
    try {
        const res = await fetch('/api/app/environment');
        appEnvironment = await res.json();

        // 웹 브라우저에서 실행 중이면 기능 제한 UI 표시
        if (appEnvironment.isWeb) {
            showWebRestrictionWarning();
            applyWebRestrictions();
        }

        return appEnvironment;
    } catch (e) {
        console.error('앱 환경 확인 실패:', e);
        // 에러 시 웹으로 간주
        appEnvironment = { isWeb: true, isApp: false, environment: 'web' };
        showWebRestrictionWarning();
        applyWebRestrictions();
    }
}

// 웹 브라우저 제한 경고 표시
function showWebRestrictionWarning() {
    const warningDiv = document.createElement('div');
    warningDiv.id = 'webWarning';
    warningDiv.className = 'web-warning';
    warningDiv.innerHTML = `
        <div class="web-warning-content">
            <span class="web-warning-icon">⚠️</span>
            <span class="web-warning-text">웹 브라우저에서 실행 중입니다. 일부 기능(녹음, 폴더 감시)이 제한됩니다. 전체 기능을 사용하려면 앱을 설치하세요.</span>
            <button class="web-warning-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;

    // 이미 경고가 있으면 추가하지 않음
    if (!document.getElementById('webWarning')) {
        document.body.insertBefore(warningDiv, document.body.firstChild);
    }
}

// 웹 브라우저 기능 제한 적용
function applyWebRestrictions() {
    // 녹음 버튼 비활성화
    const startRecordBtn = document.getElementById('startRecordBtn');
    const stopRecordBtn = document.getElementById('stopRecordBtn');

    if (startRecordBtn) {
        startRecordBtn.disabled = true;
        startRecordBtn.title = '앱에서만 사용 가능합니다';
        startRecordBtn.innerHTML = '🔒 녹음 (앱 전용)';
    }
    if (stopRecordBtn) {
        stopRecordBtn.disabled = true;
    }

    // 폴더 추가 버튼 비활성화
    const addBtn = document.getElementById('addBtn');
    if (addBtn) {
        addBtn.disabled = true;
        addBtn.title = '앱에서만 사용 가능합니다';
        addBtn.textContent = '🔒 폴더 추가 (앱 전용)';
    }

    // 폴더 감시 섹션에 경고 추가
    const foldersSection = document.getElementById('folders');
    if (foldersSection) {
        const existingWarning = foldersSection.querySelector('.feature-locked-warning');
        if (!existingWarning) {
            const warning = document.createElement('div');
            warning.className = 'feature-locked-warning';
            warning.innerHTML = '🔒 폴더 감시 기능은 앱에서만 사용할 수 있습니다.';
            foldersSection.insertBefore(warning, foldersSection.firstChild);
        }
    }

    // 회의 녹음 섹션에 경고 추가
    const meetingRecordSection = document.querySelector('.meeting-record');
    if (meetingRecordSection) {
        const existingWarning = meetingRecordSection.querySelector('.feature-locked-warning');
        if (!existingWarning) {
            const warning = document.createElement('div');
            warning.className = 'feature-locked-warning';
            warning.innerHTML = '🔒 회의 녹음 기능은 앱에서만 사용할 수 있습니다.';
            meetingRecordSection.insertBefore(warning, meetingRecordSection.firstChild);
        }
    }
}

// 앱 환경에서만 기능 실행
function requireAppEnvironment(callback, featureName = '이 기능') {
    if (!appEnvironment || appEnvironment.isWeb) {
        alert(`${featureName}은 앱에서만 사용 가능합니다.\n\n전체 기능을 사용하려면 DocWatch 앱을 설치해 주세요.`);
        return false;
    }
    if (callback) callback();
    return true;
}

// 라이선스 상태 로드
async function loadLicenseStatus() {
    try {
        const res = await fetch('/api/license/status');
        const status = await res.json();
        currentLicenseStatus = status;
        updateLicenseUI(status);
        applyFeatureRestrictions(status);
        return status;
    } catch (e) {
        console.error('라이선스 상태 로드 실패:', e);
    }
}

// 라이선스 UI 업데이트
function updateLicenseUI(status) {
    const licenseType = document.getElementById('licenseType');
    const licenseExpiry = document.getElementById('licenseExpiry');
    const licenseDays = document.getElementById('licenseDays');
    const licenseDaysRow = document.getElementById('licenseDaysRow');
    const activationUI = document.getElementById('licenseActivationUI');
    const proStatus = document.getElementById('licenseProStatus');

    if (!licenseType) return;

    // 상태 표시
    if (status.isPro) {
        licenseType.textContent = 'Pro (정품)';
        licenseType.style.color = 'var(--accent-primary)';
        if (proStatus) proStatus.style.display = 'block';
        if (activationUI) activationUI.style.display = 'none';
    } else if (status.isTrial) {
        if (status.isExpired) {
            licenseType.textContent = 'Trial (만료됨)';
            licenseType.style.color = 'var(--danger)';
        } else {
            licenseType.textContent = `Trial (${status.daysRemaining}일 남음)`;
            licenseType.style.color = '#fdcb6e';
        }
        if (proStatus) proStatus.style.display = 'none';
        if (activationUI) activationUI.style.display = 'block';
    }

    // 만료일 표시
    if (status.expiresAt) {
        licenseExpiry.textContent = new Date(status.expiresAt).toLocaleDateString('ko-KR');
    }

    // 남은 일수
    if (status.daysRemaining > 0 && !status.isPro) {
        licenseDaysRow.style.display = 'flex';
        licenseDays.textContent = `${status.daysRemaining}일`;
        if (status.daysRemaining <= 3) {
            licenseDays.style.color = 'var(--danger)';
        } else if (status.daysRemaining <= 7) {
            licenseDays.style.color = '#fdcb6e';
        }
    } else {
        licenseDaysRow.style.display = 'none';
    }
}

// Pro 기능 제한 적용
function applyFeatureRestrictions(status) {
    const recordingCard = document.querySelector('.recording-card');
    const recordingList = document.getElementById('recordingList')?.closest('.settings-card');

    if (!status.features.meetingTranscription) {
        // 회의 녹음 기능 제한
        if (recordingCard) {
            recordingCard.classList.add('feature-locked');
        }
    } else {
        if (recordingCard) {
            recordingCard.classList.remove('feature-locked');
        }
    }
}

// 기기 ID 로드
async function loadMachineId() {
    try {
        const res = await fetch('/api/license/machine-id');
        const data = await res.json();
        const machineIdDisplay = document.getElementById('machineIdDisplay');
        if (machineIdDisplay) {
            machineIdDisplay.textContent = data.machineId;
        }
    } catch (e) {
        console.error('기기 ID 로드 실패:', e);
    }
}

// 온라인 활성화
async function activateOnline() {
    const keyInput = document.getElementById('licenseKeyInput');
    const key = keyInput?.value.trim();

    if (!key) {
        alert('라이선스 키를 입력해주세요.');
        return;
    }

    try {
        const res = await fetch('/api/license/activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: key })
        });

        const result = await res.json();

        if (result.success) {
            alert('라이선스가 활성화되었습니다!');
            loadLicenseStatus();
        } else {
            alert('활성화 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('활성화 실패: ' + e.message);
    }
}

// 오프라인 활성화
async function activateOffline() {
    const keyInput = document.getElementById('offlineKeyInput');
    const key = keyInput?.value.trim();

    if (!key) {
        alert('오프라인 라이선스 키를 입력해주세요.');
        return;
    }

    try {
        const res = await fetch('/api/license/activate-offline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offlineKey: key })
        });

        const result = await res.json();

        if (result.success) {
            alert('오프라인 라이선스가 활성화되었습니다!');
            loadLicenseStatus();
        } else {
            alert('활성화 실패: ' + (result.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('활성화 실패: ' + e.message);
    }
}

// 기기 ID 복사
function copyMachineId() {
    const machineIdDisplay = document.getElementById('machineIdDisplay');
    if (machineIdDisplay) {
        navigator.clipboard.writeText(machineIdDisplay.textContent).then(() => {
            alert('기기 ID가 클립보드에 복사되었습니다.');
        });
    }
}

// 라이선스 탭 전환
function initLicenseTabs() {
    const tabs = document.querySelectorAll('.license-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 탭 활성화
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 컨텐츠 전환
            const targetTab = tab.dataset.tab;
            const onlineContent = document.getElementById('onlineActivation');
            const offlineContent = document.getElementById('offlineActivation');

            if (targetTab === 'online') {
                onlineContent.style.display = 'block';
                offlineContent.style.display = 'none';
            } else {
                onlineContent.style.display = 'none';
                offlineContent.style.display = 'block';
                loadMachineId();
            }
        });
    });
}

// 라이선스 버튼 이벤트
function initLicenseButtons() {
    const activateOnlineBtn = document.getElementById('activateOnlineBtn');
    const activateOfflineBtn = document.getElementById('activateOfflineBtn');
    const copyMachineIdBtn = document.getElementById('copyMachineIdBtn');

    if (activateOnlineBtn) {
        activateOnlineBtn.addEventListener('click', activateOnline);
    }
    if (activateOfflineBtn) {
        activateOfflineBtn.addEventListener('click', activateOffline);
    }
    if (copyMachineIdBtn) {
        copyMachineIdBtn.addEventListener('click', copyMachineId);
    }
}

// Pro 기능 사용 가능 여부 확인
function canUseProFeature(featureName) {
    if (!currentLicenseStatus) return false;
    return currentLicenseStatus.features[featureName] === true;
}

// Pro 기능 체크 래퍼
function requireProFeature(featureName, callback) {
    if (canUseProFeature(featureName)) {
        callback();
    } else {
        alert('이 기능은 Pro 라이선스가 필요합니다.\n설정 > 라이선스에서 활성화해주세요.');
        // 알림 탭의 라이선스 섹션으로 이동
        showSection('notifications');
        document.getElementById('licenseCard')?.scrollIntoView({ behavior: 'smooth' });
    }
}

// 초기 로드
loadMeetings();
loadRecordings();
checkWhisperStatus();
checkAppEnvironment();  // 앱 환경 확인 (웹 vs Electron)
loadLicenseStatus();
initLicenseTabs();
initLicenseButtons();

// 커스텀 타이틀바 버튼 이벤트 (Electron 환경에서만 동작)
function initTitlebarControls() {
    // 플랫폼 감지 및 클래스 추가
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (isMac) {
        document.body.classList.add('is-mac');
    }

    if (typeof window.electronAPI === 'undefined') return;

    const minimizeBtn = document.getElementById('minimizeBtn');
    const maximizeBtn = document.getElementById('maximizeBtn');
    const closeBtn = document.getElementById('closeBtn');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            window.electronAPI.minimizeWindow();
        });
    }

    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', () => {
            window.electronAPI.maximizeWindow();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.electronAPI.closeWindow();
        });
    }
}

initTitlebarControls();
