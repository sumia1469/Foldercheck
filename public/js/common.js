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
    // 전체선택 체크박스 초기화
    const selectAllFolders = document.getElementById('selectAllFolders');
    const deleteSelectedFoldersBtn = document.getElementById('deleteSelectedFoldersBtn');
    if (selectAllFolders) selectAllFolders.checked = false;
    if (deleteSelectedFoldersBtn) {
        deleteSelectedFoldersBtn.disabled = true;
        deleteSelectedFoldersBtn.style.opacity = '0.5';
    }

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
            <label class="folder-checkbox-wrapper" style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" class="folder-checkbox" data-folder="${escapeHtml(folder)}" onchange="updateFolderSelectionState()" style="cursor: pointer;">
                <span class="folder-path">${escapeHtml(folder)}</span>
            </label>
            <div class="folder-actions">
                <button class="btn btn-icon" onclick="openFolder('${escapeHtml(folder.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}')" title="폴더 열기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </button>
                <button class="btn btn-danger btn-sm" onclick="removeFolder('${escapeHtml(folder.replace(/\\/g, '\\\\'))}')">삭제</button>
            </div>
        </li>
    `).join('');
}

// 폴더 전체선택 토글
function toggleSelectAllFolders() {
    const selectAllFolders = document.getElementById('selectAllFolders');
    const checkboxes = document.querySelectorAll('.folder-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllFolders.checked);
    updateFolderSelectionState();
}

// 폴더 선택 상태 업데이트
function updateFolderSelectionState() {
    const checkboxes = document.querySelectorAll('.folder-checkbox');
    const checkedBoxes = document.querySelectorAll('.folder-checkbox:checked');
    const selectAllFolders = document.getElementById('selectAllFolders');
    const deleteSelectedFoldersBtn = document.getElementById('deleteSelectedFoldersBtn');

    // 전체선택 체크박스 상태 업데이트
    if (selectAllFolders) {
        selectAllFolders.checked = checkboxes.length > 0 && checkboxes.length === checkedBoxes.length;
    }

    // 삭제 버튼 활성화/비활성화
    if (deleteSelectedFoldersBtn) {
        if (checkedBoxes.length > 0) {
            deleteSelectedFoldersBtn.disabled = false;
            deleteSelectedFoldersBtn.style.opacity = '1';
        } else {
            deleteSelectedFoldersBtn.disabled = true;
            deleteSelectedFoldersBtn.style.opacity = '0.5';
        }
    }
}

// 선택한 폴더들 일괄 삭제
async function deleteSelectedFolders() {
    const checkedBoxes = document.querySelectorAll('.folder-checkbox:checked');
    if (checkedBoxes.length === 0) {
        alert('삭제할 폴더를 선택해주세요.');
        return;
    }

    const count = checkedBoxes.length;
    if (!confirm(`선택한 ${count}개의 폴더 감시를 중지하시겠습니까?`)) {
        return;
    }

    const folders = Array.from(checkedBoxes).map(cb => cb.dataset.folder);

    try {
        // 순차적으로 삭제
        for (const folder of folders) {
            await fetch('/api/folders', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder })
            });
        }

        // 목록 새로고침
        loadFolders();

        // 전체선택 체크박스 해제
        const selectAllFolders = document.getElementById('selectAllFolders');
        if (selectAllFolders) selectAllFolders.checked = false;

    } catch (e) {
        console.error('폴더 삭제 실패:', e);
        alert('일부 폴더 삭제에 실패했습니다.');
        loadFolders();
    }
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

        // Free 버전 여부 확인
        const isFreeVersion = currentLicenseStatus && currentLicenseStatus.type === 'free';

        // 변경 요약 아이콘 (클릭 시 팝업) - Free 버전에서는 숨김
        let changeSummaryBtn = '';
        if (!isFreeVersion && log.changeSummary && log.changeSummary.summary) {
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

        // 폴더/파일 열기 버튼 - Free 버전에서는 숨김
        let fileOpenBtn = '';
        let folderOpenBtn = '';
        if (!isFreeVersion) {
            fileOpenBtn = `
                <button class="btn btn-icon" onclick="openFile('${escapedFullPath}')" title="파일 위치 열기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                    </svg>
                </button>
            `;
            folderOpenBtn = `
                <button class="btn btn-icon" onclick="openFolder('${escapedFolder}')" title="폴더 열기">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                </button>
            `;
        }

        // Free 버전에서는 요약 버튼도 숨김
        const analyzeBtnFinal = isFreeVersion ? '' : analyzeBtn;

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
                    ${fileOpenBtn}
                    ${folderOpenBtn}
                    ${analyzeBtnFinal}
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
        // Free 버전 여부 확인
        const isFreeVersion = currentLicenseStatus && currentLicenseStatus.type === 'free';

        // 변경 요약이 있으면 알림에 포함 (Free 버전에서는 제외)
        let body = log.file;
        if (!isFreeVersion && log.changeSummary && log.changeSummary.summary) {
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

// 변경 요약을 하단 패널에 표시 (diff 뷰)
function showChangeSummary(event, fileName, summaryData) {
    event.stopPropagation();

    const summary = JSON.parse(decodeURIComponent(summaryData));

    // 하단 패널 열기
    const bottomPanel = document.getElementById('bottomPanel');
    const bottomChanges = document.getElementById('bottomChanges');
    const bottomPanelFileInfo = document.getElementById('bottomPanelFileInfo');
    const mainContent = document.querySelector('.main-content');

    if (!bottomPanel || !bottomChanges) return;

    bottomPanel.classList.add('open');
    if (mainContent) mainContent.classList.add('with-bottom-panel');

    // 타입별 아이콘과 색상
    let typeIcon, typeText, typeClass;
    if (summary.type === 'new') {
        typeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;
        typeText = '새 파일';
        typeClass = 'added';
    } else if (summary.type === 'deleted') {
        typeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>`;
        typeText = '삭제됨';
        typeClass = 'removed';
    } else {
        typeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        typeText = '수정됨';
        typeClass = 'modified';
    }

    // 파일명 정보 표시
    if (bottomPanelFileInfo) {
        bottomPanelFileInfo.innerHTML = `
            <span class="file-name">${escapeHtml(fileName)}</span>
            <span class="changes-meta">
                <span class="meta-item ${typeClass}">${typeText}</span>
            </span>
        `;
    }

    // 변경 내용 구성
    let addedItems = [];
    let removedItems = [];
    let statsHtml = '';
    let fileTypeHtml = '';

    if (summary.details) {
        const details = summary.details;

        // 통계 바 생성
        const addedCount = details.addedCount || 0;
        const removedCount = details.removedCount || 0;
        const totalChanges = addedCount + removedCount;

        if (totalChanges > 0) {
            const addedPercent = Math.round((addedCount / totalChanges) * 100);
            const removedPercent = 100 - addedPercent;

            statsHtml = `
                <div class="changes-stats">
                    <div class="stats-bar">
                        <div class="stats-bar-added" style="width: ${addedPercent}%"></div>
                        <div class="stats-bar-removed" style="width: ${removedPercent}%"></div>
                    </div>
                    <div class="stats-labels">
                        <span class="stats-added">+${addedCount} 추가</span>
                        <span class="stats-removed">-${removedCount} 삭제</span>
                        ${details.lengthDiff !== undefined && details.lengthDiff !== 0 ?
                            `<span class="stats-size">${details.lengthDiff > 0 ? '+' : ''}${details.lengthDiff}자</span>` : ''}
                    </div>
                </div>
            `;
        }

        // 파일 타입별 추가 정보
        if (details.fileTypeInfo) {
            const fti = details.fileTypeInfo;
            if (fti.type === 'text' && fti.lineDiff !== undefined && fti.lineDiff !== 0) {
                fileTypeHtml = `<div class="file-type-info"><span class="info-badge">${fti.lineDiff > 0 ? '+' : ''}${fti.lineDiff}줄</span></div>`;
            } else if (fti.type === 'pptx' && fti.slideDiff !== undefined && fti.slideDiff !== 0) {
                fileTypeHtml = `<div class="file-type-info"><span class="info-badge">${fti.slideDiff > 0 ? '+' : ''}${fti.slideDiff}슬라이드</span></div>`;
            } else if (fti.type === 'xlsx') {
                let xlsxInfo = [];
                if (fti.sheetDiff !== undefined && fti.sheetDiff !== 0) {
                    xlsxInfo.push(`${fti.sheetDiff > 0 ? '+' : ''}${fti.sheetDiff}시트`);
                }
                if (fti.newSheets && fti.newSheets.length > 0) {
                    xlsxInfo.push(`새 시트: ${fti.newSheets.join(', ')}`);
                }
                if (xlsxInfo.length > 0) {
                    fileTypeHtml = `<div class="file-type-info"><span class="info-badge">${xlsxInfo.join(' | ')}</span></div>`;
                }
            }
        }

        // 추가된 항목
        if (details.added && details.added.length > 0) {
            addedItems = details.added;
        }

        // 삭제된 항목
        if (details.removed && details.removed.length > 0) {
            removedItems = details.removed;
        }
    }

    // 인라인 diff 라인 생성 (GitHub 스타일)
    let diffLinesHtml = '';

    // 삭제된 항목 먼저
    removedItems.forEach(text => {
        diffLinesHtml += `<div class="diff-line removed"><span class="diff-marker">-</span><span class="diff-text">${escapeHtml(text)}</span></div>`;
    });

    // 추가된 항목
    addedItems.forEach(text => {
        diffLinesHtml += `<div class="diff-line added"><span class="diff-marker">+</span><span class="diff-text">${escapeHtml(text)}</span></div>`;
    });

    // AI 요약 버튼 HTML (공통)
    const encodedFileName = encodeURIComponent(fileName);
    const aiSummaryBtn = `
        <button class="btn btn-primary btn-ai-analyze"
                onclick="analyzeChangeWithAI('${encodedFileName}', '${summaryData}')">
            <span class="ai-icon">🤖</span>
            <span class="ai-text">AI 요약</span>
        </button>
    `;

    // 하단 패널에 통합 뷰 표시
    if (diffLinesHtml) {
        bottomChanges.innerHTML = `
            <div class="changes-container">
                <div class="changes-header">
                    <div class="changes-header-left">
                        <div class="changes-file-icon ${typeClass}">
                            ${typeIcon}
                        </div>
                        <div class="changes-file-info">
                            <h4>${escapeHtml(fileName)}</h4>
                            <span>${typeText} · ${summary.summary || ''}</span>
                        </div>
                    </div>
                    <div class="changes-header-right">
                        ${fileTypeHtml}
                        ${aiSummaryBtn}
                    </div>
                </div>
                ${statsHtml}
                <div class="changes-inline-diff">
                    ${diffLinesHtml}
                </div>
            </div>
        `;
    } else {
        // 변경 내용이 없는 경우 - 파일 크기/메타 정보는 표시
        let detailsHtml = '';

        if (summary.details) {
            const details = summary.details;
            let infoItems = [];

            // 파일 크기 변화
            if (details.lengthDiff !== undefined && details.lengthDiff !== 0) {
                const sign = details.lengthDiff > 0 ? '+' : '';
                infoItems.push(`
                    <div class="info-row">
                        <span class="info-label">크기 변화</span>
                        <span class="info-value ${details.lengthDiff > 0 ? 'added' : 'removed'}">${sign}${details.lengthDiff}자</span>
                    </div>
                `);
            }

            // 이전/현재 크기
            if (details.prevLength && details.currLength) {
                infoItems.push(`
                    <div class="info-row">
                        <span class="info-label">이전 크기</span>
                        <span class="info-value">${details.prevLength.toLocaleString()}자</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">현재 크기</span>
                        <span class="info-value">${details.currLength.toLocaleString()}자</span>
                    </div>
                `);
            }

            // 파일 타입별 정보
            if (details.fileTypeInfo) {
                const fti = details.fileTypeInfo;
                if (fti.type === 'xlsx') {
                    infoItems.push(`
                        <div class="info-row">
                            <span class="info-label">시트 수</span>
                            <span class="info-value">${fti.currSheets}개</span>
                        </div>
                    `);
                } else if (fti.type === 'pptx') {
                    infoItems.push(`
                        <div class="info-row">
                            <span class="info-label">슬라이드 수</span>
                            <span class="info-value">${fti.currSlides}개</span>
                        </div>
                    `);
                } else if (fti.type === 'text') {
                    infoItems.push(`
                        <div class="info-row">
                            <span class="info-label">줄 수</span>
                            <span class="info-value">${fti.currLines}줄</span>
                        </div>
                    `);
                }
            }

            if (infoItems.length > 0) {
                detailsHtml = `
                    <div class="changes-details-grid">
                        ${infoItems.join('')}
                    </div>
                `;
            }
        }

        bottomChanges.innerHTML = `
            <div class="changes-container">
                <div class="changes-header">
                    <div class="changes-header-left">
                        <div class="changes-file-icon ${typeClass}">
                            ${typeIcon}
                        </div>
                        <div class="changes-file-info">
                            <h4>${escapeHtml(fileName)}</h4>
                            <span>${typeText} · ${summary.summary || ''}</span>
                        </div>
                    </div>
                    <div class="changes-header-right">
                        ${fileTypeHtml}
                        ${aiSummaryBtn}
                    </div>
                </div>
                ${detailsHtml}
                <div class="changes-notice">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 16v-4M12 8h.01"/>
                    </svg>
                    <div>
                        <p>단어 단위의 상세 변경 내용은 감지되지 않았습니다</p>
                        <span>셀 내용 수정, 서식 변경, 메타데이터 변경 등이 포함될 수 있습니다</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// AI로 변경 내용 분석
async function analyzeChangeWithAI(encodedFileName, summaryData) {
    const fileName = decodeURIComponent(encodedFileName);
    const summary = JSON.parse(decodeURIComponent(summaryData));
    const btn = document.querySelector('.btn-ai-analyze');

    if (!btn) return;

    // 버튼 비활성화 및 로딩 표시
    btn.disabled = true;
    btn.innerHTML = `
        <span class="ai-icon spinning">⏳</span>
        <span class="ai-text">분석 중...</span>
    `;

    // 우측 패널 열기 및 로딩 표시
    const rightPanel = document.getElementById('rightPanel');
    const panelAiInfo = document.getElementById('panelAiInfo');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (rightPanel && panelAiInfo) {
        rightPanel.classList.add('open');
        if (toggleBtn) toggleBtn.classList.add('active');

        // AI 정보 탭 활성화
        panelTabs.forEach(t => {
            t.classList.toggle('active', t.dataset.panelTab === 'ai-info');
        });
        panelAiInfo.style.display = 'flex';
        document.getElementById('panelLlmChat').style.display = 'none';

        // 로딩 표시
        panelAiInfo.innerHTML = `
            <div class="panel-ai-result" style="width: 100%;">
                <div class="panel-ai-header">
                    <span class="ai-icon">⏳</span>
                    <h4>AI 분석 중...</h4>
                </div>
                <div class="panel-file-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                    </svg>
                    <span>${fileName}</span>
                </div>
                <div style="text-align: center; padding: 40px;">
                    <div class="ai-loading-spinner"></div>
                    <p style="margin-top: 16px; color: var(--text-muted);">AI가 변경 내용을 분석하고 있습니다...</p>
                </div>
            </div>
        `;
    }

    try {
        const res = await fetch('/api/analyze/change', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName,
                added: summary.details?.added || [],
                removed: summary.details?.removed || [],
                addedCount: summary.details?.addedCount || 0,
                removedCount: summary.details?.removedCount || 0,
                fileTypeInfo: summary.details?.fileTypeInfo || null
            })
        });

        const result = await res.json();

        if (result.success && result.analysis) {
            // 우측 패널에 분석 결과 표시
            showAIResultInPanel(encodedFileName, result.analysis);

            // 버튼 완료 상태로 변경
            btn.innerHTML = `
                <span class="ai-icon">✅</span>
                <span class="ai-text">분석 완료 (우측 패널에서 확인)</span>
            `;
            btn.style.opacity = '0.7';
        } else {
            throw new Error(result.error || '분석에 실패했습니다.');
        }
    } catch (e) {
        console.error('AI 분석 실패:', e);

        // 패널에 오류 표시
        if (panelAiInfo) {
            panelAiInfo.innerHTML = `
                <div class="panel-empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--danger);">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    <p style="color: var(--danger);">분석 실패</p>
                    <span class="panel-hint">${e.message}</span>
                </div>
            `;
        }

        // 버튼 복원
        btn.disabled = false;
        btn.innerHTML = `
            <span class="ai-icon">✨</span>
            <span class="ai-text">AI로 변경 내용 분석하기</span>
        `;
    }
}

// AI 분석 결과 포맷팅
function formatAIAnalysis(analysis) {
    // 분석 결과를 HTML로 변환
    const lines = analysis.split('\n').filter(line => line.trim());
    let html = '';

    for (const line of lines) {
        const trimmed = line.trim();

        // 위치/섹션 표시 (📍로 시작하거나 "위치:", "섹션:" 포함)
        if (trimmed.startsWith('📍') || trimmed.includes('위치:') || trimmed.includes('섹션:')) {
            html += `<div class="ai-location">${escapeHtml(trimmed)}</div>`;
        }
        // 변경 내용 표시 (→, ▶, • 로 시작)
        else if (trimmed.startsWith('→') || trimmed.startsWith('▶') || trimmed.startsWith('•') || trimmed.startsWith('-')) {
            html += `<div class="ai-change-item">${escapeHtml(trimmed)}</div>`;
        }
        // 숫자로 시작하는 항목
        else if (/^\d+[.)]/.test(trimmed)) {
            html += `<div class="ai-numbered-item">${escapeHtml(trimmed)}</div>`;
        }
        // 일반 텍스트
        else if (trimmed.length > 0) {
            html += `<div class="ai-text-line">${escapeHtml(trimmed)}</div>`;
        }
    }

    return html || '<div class="ai-text-line">분석 결과가 없습니다.</div>';
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
        // 로컬 AI와 외부 API 상태 모두 가져오기
        const [statusRes, externalRes] = await Promise.all([
            fetch('/api/ollama/status'),
            fetch('/api/ai/external-settings')
        ]);
        const status = await statusRes.json();
        const externalSettings = await externalRes.json();

        const ollamaStatus = document.getElementById('ollamaStatus');
        const aiModelSelect = document.getElementById('aiModelSelect');
        const aiModelDescription = document.getElementById('aiModelDescription');

        // 로컬 Ollama 상태와 외부 API 상태 표시
        if (ollamaStatus) {
            const hasExternalApi = externalSettings.openai.hasKey || externalSettings.gemini.hasKey;
            if (status.ready) {
                ollamaStatus.textContent = hasExternalApi ? '로컬 + 온라인 ✓' : '로컬 AI 동작 중 ✓';
                ollamaStatus.style.color = 'var(--success)';
            } else if (hasExternalApi) {
                ollamaStatus.textContent = '온라인 AI 사용 가능 ✓';
                ollamaStatus.style.color = 'var(--success)';
            } else {
                ollamaStatus.textContent = status.error || '연결 실패';
                ollamaStatus.style.color = 'var(--danger)';
            }
        }

        // 모델 선택 드롭다운 업데이트
        if (aiModelSelect && status.availableModels) {
            aiModelSelect.innerHTML = '';

            // 로컬 모델 그룹
            const localGroup = document.createElement('optgroup');
            localGroup.label = '📦 로컬 모델 (Ollama)';

            // 온라인 모델 그룹
            const onlineGroup = document.createElement('optgroup');
            onlineGroup.label = '🌐 온라인 모델';

            for (const [modelId, modelInfo] of Object.entries(status.availableModels)) {
                const modelType = modelInfo.type || 'local';

                // 외부 API 모델은 해당 API 키가 설정된 경우에만 표시
                if (modelType === 'openai' && !externalSettings.openai.hasKey) continue;
                if (modelType === 'gemini' && !externalSettings.gemini.hasKey) continue;

                const option = document.createElement('option');
                option.value = modelId;
                option.textContent = modelInfo.name + ' (' + modelInfo.size + ')';
                if (modelId === status.model) {
                    option.selected = true;
                }

                if (modelType === 'local') {
                    localGroup.appendChild(option);
                } else {
                    onlineGroup.appendChild(option);
                }
            }

            // 로컬 모델이 있으면 추가
            if (localGroup.children.length > 0) {
                aiModelSelect.appendChild(localGroup);
            }

            // 온라인 모델이 있으면 추가
            if (onlineGroup.children.length > 0) {
                aiModelSelect.appendChild(onlineGroup);
            }

            // 현재 모델 설명 업데이트
            if (aiModelDescription && status.model && status.availableModels[status.model]) {
                aiModelDescription.textContent = status.availableModels[status.model].description;
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

// AI 모델 변경
async function changeAIModel(modelId) {
    if (!modelId) return;

    try {
        const res = await fetch('/api/ollama/model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelId })
        });

        const result = await res.json();

        if (result.success) {
            // 모델 설명 업데이트
            const aiModelDescription = document.getElementById('aiModelDescription');
            if (aiModelDescription && result.modelInfo) {
                aiModelDescription.textContent = result.modelInfo.description;
            }

            // 성공 메시지
            showToast(`AI 모델이 ${result.modelInfo?.name || modelId}(으)로 변경되었습니다.`, 'success');
        } else {
            showToast(result.error || '모델 변경에 실패했습니다.', 'error');
        }
    } catch (e) {
        console.error('AI 모델 변경 실패:', e);
        showToast('AI 모델 변경에 실패했습니다.', 'error');
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

// 문서 분석 실행 (우측 패널에 표시)
async function analyzeDocument(filePath) {
    // 우측 패널 열기
    const rightPanel = document.getElementById('rightPanel');
    const panelAiInfo = document.getElementById('panelAiInfo');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (!rightPanel || !panelAiInfo) return;

    rightPanel.classList.add('open');
    if (toggleBtn) toggleBtn.classList.add('active');

    // AI 정보 탭 활성화
    panelTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.panelTab === 'ai-info');
    });
    panelAiInfo.style.display = 'flex';
    document.getElementById('panelLlmChat').style.display = 'none';

    // 파일명 추출
    const fileName = filePath.split('/').pop().split('\\').pop();

    // 로딩 표시
    panelAiInfo.innerHTML = `
        <div class="panel-document-analysis">
            <div class="panel-analysis-header">
                <span class="panel-analysis-icon">📊</span>
                <h4>문서 분석 중...</h4>
            </div>
            <div class="panel-analysis-file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6"/>
                </svg>
                <span>${escapeHtml(fileName)}</span>
            </div>
            <div class="panel-analysis-loading">
                <div class="ai-loading-spinner"></div>
                <p>문서를 분석하고 있습니다...</p>
            </div>
        </div>
    `;

    try {
        const res = await fetch('/api/document/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath })
        });

        const result = await res.json();

        if (result.error) {
            showDocumentAnalysisInPanel('error', result.error, fileName);
        } else {
            showDocumentAnalysisInPanel('result', result, fileName);
        }
    } catch (e) {
        console.error('문서 분석 오류:', e);
        showDocumentAnalysisInPanel('error', '문서 분석 중 오류가 발생했습니다.', fileName);
    }
}

// 문서 분석 결과를 우측 패널에 표시
function showDocumentAnalysisInPanel(state, data, fileName) {
    const panelAiInfo = document.getElementById('panelAiInfo');
    if (!panelAiInfo) return;

    if (state === 'error') {
        panelAiInfo.innerHTML = `
            <div class="panel-document-analysis">
                <div class="panel-analysis-header error">
                    <span class="panel-analysis-icon">⚠️</span>
                    <h4>분석 오류</h4>
                </div>
                <div class="panel-analysis-file">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                        <path d="M14 2v6h6"/>
                    </svg>
                    <span>${escapeHtml(fileName)}</span>
                </div>
                <div class="panel-analysis-error">
                    <p>${escapeHtml(data)}</p>
                </div>
            </div>
        `;
        return;
    }

    const result = data;
    let contentHtml = '';

    // AI 요약 섹션
    if (result.aiSummary) {
        contentHtml += `
            <div class="panel-analysis-section ai-summary">
                <h5>✨ AI 요약</h5>
                <div class="panel-ai-summary-content">
                    <pre>${escapeHtml(result.aiSummary)}</pre>
                </div>
            </div>
        `;
    }

    if (result.isNewDocument) {
        // 새 문서 개요
        const overview = result.overview || {};
        contentHtml += `
            <div class="panel-analysis-section">
                <h5>📄 새 문서 분석</h5>
                <ul class="panel-analysis-list">
                    <li><strong>문서 유형:</strong> ${result.documentType}</li>
                    <li><strong>글자 수:</strong> ${overview.contentLength?.toLocaleString() || 0}자</li>
                    <li><strong>단어 수:</strong> ${overview.wordCount?.toLocaleString() || 0}개</li>
                    ${overview.slideCount ? `<li><strong>슬라이드:</strong> ${overview.slideCount}장</li>` : ''}
                    ${overview.sheetCount ? `<li><strong>시트:</strong> ${overview.sheetCount}개 (${overview.sheetNames?.join(', ') || ''})</li>` : ''}
                </ul>
            </div>
        `;

        if (overview.topKeywords?.length > 0) {
            contentHtml += `
                <div class="panel-analysis-section">
                    <h5>🔑 주요 키워드</h5>
                    <div class="panel-keyword-tags">
                        ${overview.topKeywords.map(k => `<span class="panel-keyword-tag">${escapeHtml(k.word)} (${k.count})</span>`).join('')}
                    </div>
                </div>
            `;
        }
    } else {
        // 변경 사항
        contentHtml += `
            <div class="panel-analysis-section">
                <h5>📝 변경 사항 요약</h5>
                <p class="panel-analysis-meta">이전 분석: ${new Date(result.previousAnalyzedAt).toLocaleString('ko-KR')}</p>
                <ul class="panel-changes-list-detail">
                    ${result.changes.map(change => {
                        let changeContent = `<strong>${change.type}</strong>`;
                        if (change.description) {
                            changeContent += `: ${escapeHtml(change.description)}`;
                        }
                        if (change.keywords) {
                            changeContent += `<br><span class="panel-change-keywords">${change.keywords.slice(0, 5).map(k => escapeHtml(k)).join(', ')}${change.keywords.length > 5 ? '...' : ''}</span>`;
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

    // 캐시에서 로드된 경우 표시
    const cacheInfo = result.fromCache
        ? `<div class="panel-cache-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <polyline points="20,6 9,17 4,12"/>
            </svg>
            캐시됨 (${new Date(result.cachedAt).toLocaleString('ko-KR')})
           </div>`
        : '';

    panelAiInfo.innerHTML = `
        <div class="panel-document-analysis">
            <div class="panel-analysis-header">
                <span class="panel-analysis-icon">📊</span>
                <h4>문서 변경 요약</h4>
                ${cacheInfo}
            </div>
            <div class="panel-analysis-file">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6"/>
                </svg>
                <span>${escapeHtml(result.fileName)}</span>
                <span class="panel-file-type">${result.documentType}</span>
            </div>
            <p class="panel-analysis-time">분석 시간: ${new Date(result.analyzedAt).toLocaleString('ko-KR')}</p>
            ${contentHtml}
        </div>
    `;
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
        // 제목이 비어있으면 자동 생성
        if (meetingTitleInput && !meetingTitleInput.value.trim()) {
            const now = new Date();
            const dateStr = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
            const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
            meetingTitleInput.value = `${dateStr} ${timeStr} 회의`;
        }

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

        mediaRecorder.onstop = async () => {
            const webmBlob = new Blob(audioChunks, { type: 'audio/webm' });

            // WebM을 WAV로 변환하여 저장
            try {
                const title = meetingTitleInput?.value || '회의녹음';
                console.log('WAV 변환 시작...');
                recordedBlob = await convertToWav(webmBlob);
                console.log('WAV 변환 완료');

                const saved = await saveRecordingToServer(recordedBlob, title);
                if (saved) {
                    console.log('녹음 파일 서버 저장 완료:', saved.filename);
                    loadRecordings();
                }
            } catch (e) {
                console.error('WAV 변환/저장 실패:', e);
                // 변환 실패 시 원본 webm으로 저장 시도
                recordedBlob = webmBlob;
                try {
                    const title = meetingTitleInput?.value || '회의녹음';
                    await saveRecordingToServer(recordedBlob, title, true);
                    loadRecordings();
                } catch (e2) {
                    console.error('원본 저장도 실패:', e2);
                }
            }

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

// 녹음 파일을 서버에 저장
async function saveRecordingToServer(blob, title, isWebm = false) {
    try {
        const formData = new FormData();
        const ext = isWebm ? 'webm' : 'wav';
        // 제목 정리: 파일시스템 금지 문자만 제거, 한글/공백 등은 유지
        const cleanTitle = (title || '').trim()
            .replace(/[\\/:*?"<>|]/g, '')  // 파일시스템 금지 문자 제거
            .replace(/\s+/g, ' ')           // 연속 공백 하나로
            .trim() || '회의녹음';
        const filename = `${cleanTitle}.${ext}`;
        formData.append('file', blob, filename);

        const res = await fetch('/api/recordings', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error('서버 저장 실패');
        }

        return await res.json();
    } catch (e) {
        console.error('녹음 파일 서버 저장 오류:', e);
        return null;
    }
}

// 녹음 파일 다운로드 (WAV)
async function downloadRecording() {
    if (!recordedBlob) return;

    const title = meetingTitleInput?.value || '회의녹음';
    const date = new Date().toISOString().slice(0, 10);
    const isWav = recordedBlob.type === 'audio/wav' || recordedBlob.type === 'audio/wave';

    // 이미 WAV인 경우 바로 다운로드
    if (isWav) {
        const filename = `${title}_${date}.wav`;
        const url = URL.createObjectURL(recordedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
    }

    // WebM인 경우 WAV로 변환 시도
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
        console.error('WAV 변환 실패:', error);
        alert('WAV 변환에 실패했습니다.');
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

// convertToWav 별칭 (convertWebmToWav와 동일)
const convertToWav = convertWebmToWav;

// 녹음 파일로 회의록 생성
async function generateMinutesFromRecording() {
    if (!recordedBlob) return;

    const title = meetingTitleInput?.value || '회의녹음';
    // recordedBlob은 이미 WAV로 변환된 상태
    const isWav = recordedBlob.type === 'audio/wav' || recordedBlob.type === 'audio/wave';
    const ext = isWav ? 'wav' : 'webm';
    const mimeType = isWav ? 'audio/wav' : 'audio/webm';
    const file = new File([recordedBlob], `${title}.${ext}`, { type: mimeType });

    // 모달 팝업으로 회의록 생성 처리
    await handleAudioFileWithModal(file);

    // 녹음 초기화
    resetRecording();
}

// 모달 팝업을 사용한 오디오 파일 처리 (녹음 완료 후 사용)
async function handleAudioFileWithModal(file) {
    console.log('오디오 파일 처리 (모달):', file.name);

    // 로딩 오버레이 표시 (화면 전체를 덮어서 다른 조작 차단)
    showSummarizingOverlay('🎙️ 회의록 생성 중...', '녹음 파일을 분석하고 있습니다');
    updateSummarizingOverlay('파일 업로드 중...', 5);

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
                updateSummarizingOverlay(text, progress.percent);
            }
        } catch (e) {
            // 폴링 실패는 무시
        }
    }, 500);

    try {
        updateSummarizingOverlay('📤 서버로 전송 중...', 10);

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
            updateSummarizingOverlay('✅ 회의록 생성 완료!', 100);
            setTimeout(() => {
                hideSummarizingOverlay();
                loadMeetings();
                showToast('회의록이 생성되었습니다!', 'success');
            }, 1500);
        } else {
            throw new Error(result.error || '알 수 없는 오류');
        }
    } catch (e) {
        clearInterval(progressInterval);
        console.error('회의록 생성 실패:', e);
        hideSummarizingOverlay();
        showToast('회의록 생성에 실패했습니다: ' + e.message, 'error');
    }
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
        return `
        <div class="meeting-item" id="meeting-${meeting.id}" onclick="selectMeeting('${meeting.id}')">
            <div class="meeting-item-header">
                <label class="meeting-checkbox" onclick="event.stopPropagation()">
                    <input type="checkbox" class="meeting-select-checkbox" data-meeting-id="${meeting.id}" onchange="updateMeetingSelectionState()">
                </label>
                <div class="meeting-info">
                    <div class="meeting-title">${escapeHtml(meeting.title)}</div>
                    <div class="meeting-date">${new Date(meeting.createdAt).toLocaleString('ko-KR')}</div>
                    ${meeting.aiSummary ? `<div class="meeting-summary-badge">✨ AI 요약 완료</div>` : ''}
                </div>
            </div>
            <div class="meeting-actions" onclick="event.stopPropagation()">
                <button class="btn btn-primary" onclick="summarizeMeeting('${meeting.id}')" ${meeting.aiSummary ? 'title="다시 요약"' : ''}>
                    ${meeting.aiSummary ? '🔄 재요약' : '✨ AI 요약'}
                </button>
                <button class="btn btn-secondary" onclick="downloadMeeting('${meeting.id}')">다운로드</button>
                <button class="btn btn-danger" onclick="deleteMeeting('${meeting.id}')">삭제</button>
            </div>
        </div>
    `}).join('');
}

// 회의록 선택 및 우측 패널에 표시
let selectedMeetingId = null;

function selectMeeting(meetingId) {
    // 이전 선택 해제
    document.querySelectorAll('.meeting-item.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // 현재 선택
    const meetingEl = document.getElementById(`meeting-${meetingId}`);
    if (meetingEl) {
        meetingEl.classList.add('selected');
    }

    selectedMeetingId = meetingId;

    // 회의록 데이터 찾기
    const meeting = meetingsData.find(m => m.id === meetingId);
    if (!meeting) return;

    // 우측 패널에 회의록 상세 정보 표시
    showMeetingDetailInPanel(meeting);
}

// 회의록 상세 정보를 우측 패널에 표시
function showMeetingDetailInPanel(meeting) {
    const rightPanel = document.getElementById('rightPanel');
    const panelAiInfo = document.getElementById('panelAiInfo');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (!rightPanel || !panelAiInfo) return;

    // 패널 열기
    rightPanel.classList.add('open');
    if (toggleBtn) toggleBtn.classList.add('active');

    // AI 정보 탭 활성화
    panelTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.panelTab === 'ai-info');
    });
    document.getElementById('panelAiInfo').style.display = 'flex';
    document.getElementById('panelLlmChat').style.display = 'none';

    const historyLen = meeting.summaryHistory?.length || (meeting.aiSummary ? 1 : 0);
    const currentIdx = meeting.currentSummaryIndex ?? (historyLen - 1);

    if (meeting.aiSummary) {
        // AI 요약이 있는 경우
        const formattedSummary = meeting.aiSummary
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        panelAiInfo.innerHTML = `
            <div class="panel-ai-result" style="width: 100%;">
                <div class="panel-ai-header">
                    <span class="ai-icon">✨</span>
                    <h4>회의록 AI 요약</h4>
                </div>
                <div class="panel-meeting-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                    <span>${escapeHtml(meeting.title)}</span>
                </div>
                <div class="panel-analysis-meta">
                    <span class="meta-date">${new Date(meeting.createdAt).toLocaleString('ko-KR')}</span>
                    ${meeting.summarizedAt ? `<span class="meta-summary-date">요약: ${new Date(meeting.summarizedAt).toLocaleString('ko-KR')}</span>` : ''}
                </div>
                ${historyLen > 1 ? `
                    <div class="panel-summary-nav">
                        <button class="nav-btn" onclick="navigateMeetingSummary('${meeting.id}', -1)" ${currentIdx <= 0 ? 'disabled' : ''}>◀ 이전</button>
                        <span class="nav-indicator">${currentIdx + 1} / ${historyLen}</span>
                        <button class="nav-btn" onclick="navigateMeetingSummary('${meeting.id}', 1)" ${currentIdx >= historyLen - 1 ? 'disabled' : ''}>다음 ▶</button>
                    </div>
                ` : ''}
                <div class="panel-analysis-section ai-summary">
                    <div class="panel-ai-summary-content">
                        <pre>${escapeHtml(meeting.aiSummary)}</pre>
                    </div>
                </div>
                <div class="panel-actions">
                    <button class="btn btn-sm btn-secondary" onclick="copyMeetingSummary('${meeting.id}')">
                        📋 복사
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="summarizeMeeting('${meeting.id}')">
                        🔄 재요약
                    </button>
                </div>
            </div>
        `;
    } else {
        // AI 요약이 없는 경우
        panelAiInfo.innerHTML = `
            <div class="panel-ai-result" style="width: 100%;">
                <div class="panel-ai-header">
                    <span class="ai-icon">📝</span>
                    <h4>회의록 상세</h4>
                </div>
                <div class="panel-meeting-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                    <span>${escapeHtml(meeting.title)}</span>
                </div>
                <div class="panel-analysis-meta">
                    <span class="meta-date">${new Date(meeting.createdAt).toLocaleString('ko-KR')}</span>
                </div>
                <div class="panel-empty-summary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <p>아직 AI 요약이 생성되지 않았습니다</p>
                </div>
                <div class="panel-actions">
                    <button class="btn btn-sm btn-primary" onclick="summarizeMeeting('${meeting.id}')">
                        ✨ AI 요약 생성
                    </button>
                </div>
            </div>
        `;
    }
}

// 패널에서 요약 버전 네비게이션
function navigateMeetingSummary(meetingId, direction) {
    const meeting = meetingsData.find(m => m.id === meetingId);
    if (!meeting || !meeting.summaryHistory || meeting.summaryHistory.length <= 1) return;

    const currentIdx = meeting.currentSummaryIndex ?? (meeting.summaryHistory.length - 1);
    const newIdx = currentIdx + direction;

    if (newIdx < 0 || newIdx >= meeting.summaryHistory.length) return;

    // 로컬 상태 업데이트
    meeting.currentSummaryIndex = newIdx;
    meeting.aiSummary = meeting.summaryHistory[newIdx].summary;
    meeting.summarizedAt = meeting.summaryHistory[newIdx].createdAt;

    // 패널 다시 렌더링
    showMeetingDetailInPanel(meeting);
}

// 요약 접기/펼치기 토글
function toggleSummary(meetingId) {
    const container = document.querySelector(`[data-meeting-id="${meetingId}"]`);
    const toggleIcon = document.getElementById(`toggleIcon-${meetingId}`);
    const summaryBody = document.getElementById(`summaryBody-${meetingId}`);

    if (!container || !summaryBody) return;

    const isCollapsed = container.classList.contains('collapsed');

    if (isCollapsed) {
        container.classList.remove('collapsed');
        container.classList.add('expanded');
        if (toggleIcon) toggleIcon.textContent = '▼';
        summaryBody.style.maxHeight = summaryBody.scrollHeight + 'px';
    } else {
        container.classList.remove('expanded');
        container.classList.add('collapsed');
        if (toggleIcon) toggleIcon.textContent = '▶';
        summaryBody.style.maxHeight = '0';
    }
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
function showSummarizingOverlay(title = '✨ AI 요약 생성 중...', detail = '회의 내용을 분석하고 있습니다') {
    // 기존 오버레이 제거
    hideSummarizingOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'summarizing-overlay';
    overlay.id = 'summarizingOverlay';
    overlay.innerHTML = `
        <div class="summarizing-spinner"></div>
        <div class="summarizing-text">${title}</div>
        <div class="summarizing-detail" id="summarizingDetail">${detail}</div>
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

    // 우측 패널에 로딩 상태 표시
    showMeetingSummaryInPanel(meetingId, null, true);

    // 진행 상황 폴링
    let progressInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/processing/progress');
            const progress = await res.json();
            if (progress.active) {
                const text = progress.detail
                    ? `${progress.stage} - ${progress.detail}`
                    : progress.stage;
                updatePanelProgress(text, progress.percent);
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

        // 선택 상태 유지 및 패널 업데이트
        const updatedMeeting = meetingsData.find(m => m.id === meetingId);
        if (updatedMeeting) {
            // 선택 상태 유지
            const updatedEl = document.getElementById(`meeting-${meetingId}`);
            if (updatedEl) {
                updatedEl.classList.add('selected');
                updatedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                updatedEl.classList.add('highlight');
                setTimeout(() => updatedEl.classList.remove('highlight'), 2000);
            }

            // 우측 패널에 업데이트된 회의록 정보 표시
            showMeetingDetailInPanel(updatedMeeting);
        }

    } catch (e) {
        console.error('요약 오류:', e);
        showMeetingSummaryError(e.message);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✨ AI 요약';
        }
    } finally {
        clearInterval(progressInterval);
    }
}

// 회의록 요약을 우측 패널에 표시
function showMeetingSummaryInPanel(meetingId, summary, isLoading) {
    const rightPanel = document.getElementById('rightPanel');
    const panelAiInfo = document.getElementById('panelAiInfo');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (!rightPanel || !panelAiInfo) return;

    // 패널 열기
    rightPanel.classList.add('open');
    if (toggleBtn) toggleBtn.classList.add('active');

    // AI 정보 탭 활성화
    panelTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.panelTab === 'ai-info');
    });
    document.getElementById('panelAiInfo').style.display = 'flex';
    document.getElementById('panelLlmChat').style.display = 'none';

    if (isLoading) {
        // 로딩 상태
        panelAiInfo.innerHTML = `
            <div class="panel-ai-result" style="width: 100%;">
                <div class="panel-ai-header">
                    <span class="ai-icon">⏳</span>
                    <h4>AI 요약 생성 중...</h4>
                </div>
                <div class="panel-meeting-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                    <span>${meetingId}</span>
                </div>
                <div class="panel-progress" id="panelProgress">
                    <div class="progress-bar">
                        <div class="progress-fill" id="panelProgressFill" style="width: 0%"></div>
                    </div>
                    <span class="progress-text" id="panelProgressText">분석 준비 중...</span>
                </div>
            </div>
        `;
    } else if (summary) {
        // 요약 결과
        const formattedSummary = summary
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        panelAiInfo.innerHTML = `
            <div class="panel-ai-result" style="width: 100%;">
                <div class="panel-ai-header">
                    <span class="ai-icon">✨</span>
                    <h4>회의록 AI 요약</h4>
                </div>
                <div class="panel-meeting-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    </svg>
                    <span>${meetingId}</span>
                </div>
                <div class="panel-ai-content">
                    ${formattedSummary}
                </div>
                <div class="panel-actions">
                    <button class="btn btn-sm btn-secondary" onclick="copyMeetingSummary('${meetingId}')">
                        📋 복사
                    </button>
                </div>
            </div>
        `;
    }
}

// 패널 진행 상태 업데이트
function updatePanelProgress(text, percent) {
    const progressFill = document.getElementById('panelProgressFill');
    const progressText = document.getElementById('panelProgressText');

    if (progressFill && percent !== undefined) {
        progressFill.style.width = `${percent}%`;
    }
    if (progressText && text) {
        progressText.textContent = text;
    }
}

// 회의록 요약 오류 표시
function showMeetingSummaryError(message) {
    const panelAiInfo = document.getElementById('panelAiInfo');
    if (panelAiInfo) {
        panelAiInfo.innerHTML = `
            <div class="panel-empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--danger);">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <p style="color: var(--danger);">요약 생성 실패</p>
                <span class="panel-hint">${message}</span>
            </div>
        `;
    }
}

// 회의록 요약 복사
function copyMeetingSummary(meetingId) {
    const content = document.querySelector('.panel-ai-content');
    if (content) {
        const text = content.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.querySelector('.panel-actions .btn');
            if (btn) {
                btn.innerHTML = '✅ 복사됨';
                setTimeout(() => {
                    btn.innerHTML = '📋 복사';
                }, 2000);
            }
        });
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

    // 삭제 버튼 표시/숨김
    const deleteSelectedBtn = document.getElementById('deleteSelectedRecordingsBtn');

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
        if (deleteSelectedBtn) deleteSelectedBtn.style.display = 'none';
        return;
    }

    if (deleteSelectedBtn) deleteSelectedBtn.style.display = '';

    recordingList.innerHTML = recordings.map(recording => {
        const ext = recording.filename.split('.').pop().toUpperCase();
        const sizeStr = formatFileSize(recording.size);
        const dateStr = new Date(recording.createdAt).toLocaleString('ko-KR');

        const safeFilename = escapeHtml(recording.filename);
        const seekBarId = `seekbar-${safeFilename.replace(/[^a-zA-Z0-9]/g, '_')}`;

        return `
            <div class="recording-item" data-filename="${safeFilename}">
                <label class="recording-checkbox">
                    <input type="checkbox" class="recording-select" data-filename="${safeFilename}" onchange="updateDeleteButtonState()">
                    <span class="checkmark"></span>
                </label>
                <div class="recording-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>
                <div class="recording-info">
                    <div class="recording-name">${safeFilename}</div>
                    <div class="recording-meta">
                        <span class="recording-format">${ext}</span>
                        <span class="recording-size">${sizeStr}</span>
                        <span class="recording-date">${dateStr}</span>
                    </div>
                    <div class="audio-player-controls" id="${seekBarId}" style="display: none;">
                        <div class="audio-time-display">
                            <span class="current-time">0:00</span>
                            <span class="time-separator">/</span>
                            <span class="total-time">0:00</span>
                        </div>
                        <div class="audio-seek-container">
                            <input type="range" class="audio-seek-bar" min="0" max="100" value="0"
                                   onmousedown="isSeekingAudio=true"
                                   ontouchstart="isSeekingAudio=true"
                                   onmouseup="isSeekingAudio=false; seekAudio(this, '${safeFilename}')"
                                   ontouchend="isSeekingAudio=false; seekAudio(this, '${safeFilename}')"
                                   oninput="updateSeekPreview(this, '${safeFilename}')">
                            <div class="audio-progress-bar"></div>
                        </div>
                    </div>
                </div>
                <div class="recording-actions">
                    <button class="btn btn-sm btn-play" onclick="togglePlayRecording('${safeFilename}', this)" title="재생" data-playing="false">
                        <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width: 14px; height: 14px;">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="width: 14px; height: 14px; display: none;">
                            <rect x="6" y="4" width="4" height="16"/>
                            <rect x="14" y="4" width="4" height="16"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="transcribeRecording('${safeFilename}')" title="회의록 생성">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
                        </svg>
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="downloadRecordingFile('${safeFilename}')" title="다운로드">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    updateDeleteButtonState();
}

// 선택된 항목에 따라 삭제 버튼 상태 업데이트
function updateDeleteButtonState() {
    const deleteBtn = document.getElementById('deleteSelectedRecordingsBtn');
    const checkboxes = document.querySelectorAll('.recording-select:checked');
    const allCheckboxes = document.querySelectorAll('.recording-select');
    const selectAllCheckbox = document.getElementById('selectAllRecordings');

    if (deleteBtn) {
        const hasSelection = checkboxes.length > 0;
        deleteBtn.disabled = !hasSelection;
        deleteBtn.style.opacity = hasSelection ? '1' : '0.5';
    }

    // 전체선택 체크박스 상태 동기화
    if (selectAllCheckbox && allCheckboxes.length > 0) {
        selectAllCheckbox.checked = checkboxes.length === allCheckboxes.length;
        selectAllCheckbox.indeterminate = checkboxes.length > 0 && checkboxes.length < allCheckboxes.length;
    }
}

// 전체 선택/해제
function toggleSelectAllRecordings() {
    const selectAllCheckbox = document.getElementById('selectAllRecordings');
    const checkboxes = document.querySelectorAll('.recording-select');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateDeleteButtonState();
}

// 선택된 녹음 파일 삭제
async function deleteSelectedRecordings() {
    const checkboxes = document.querySelectorAll('.recording-select:checked');
    if (checkboxes.length === 0) {
        alert('삭제할 파일을 선택해주세요.');
        return;
    }

    if (!confirm(`선택한 ${checkboxes.length}개의 녹음 파일을 삭제하시겠습니까?`)) {
        return;
    }

    const filenames = Array.from(checkboxes).map(cb => cb.dataset.filename);
    let successCount = 0;
    let failCount = 0;

    for (const filename of filenames) {
        try {
            const res = await fetch(`/api/recording/${encodeURIComponent(filename)}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (e) {
            failCount++;
        }
    }

    if (failCount > 0) {
        alert(`${successCount}개 삭제 완료, ${failCount}개 삭제 실패`);
    }

    loadRecordings();
}

// ===== 회의록 선택 관련 함수들 =====

// 회의록 전체 선택/해제
function toggleSelectAllMeetings() {
    const selectAllCheckbox = document.getElementById('selectAllMeetings');
    const checkboxes = document.querySelectorAll('.meeting-select-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
    updateMeetingSelectionState();
}

// 회의록 선택 상태 업데이트
function updateMeetingSelectionState() {
    const checkboxes = document.querySelectorAll('.meeting-select-checkbox');
    const checkedBoxes = document.querySelectorAll('.meeting-select-checkbox:checked');
    const deleteBtn = document.getElementById('deleteSelectedMeetingsBtn');
    const selectAllCheckbox = document.getElementById('selectAllMeetings');

    if (deleteBtn) {
        if (checkedBoxes.length > 0) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
        } else {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = '0.5';
        }
    }

    // 전체선택 체크박스 상태 동기화
    if (selectAllCheckbox && checkboxes.length > 0) {
        selectAllCheckbox.checked = checkboxes.length === checkedBoxes.length;
        selectAllCheckbox.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < checkboxes.length;
    }
}

// 선택된 회의록 삭제
async function deleteSelectedMeetings() {
    const checkboxes = document.querySelectorAll('.meeting-select-checkbox:checked');
    if (checkboxes.length === 0) {
        alert('삭제할 회의록을 선택해주세요.');
        return;
    }

    if (!confirm(`선택한 ${checkboxes.length}개의 회의록을 삭제하시겠습니까?`)) {
        return;
    }

    const meetingIds = Array.from(checkboxes).map(cb => cb.dataset.meetingId);
    let successCount = 0;
    let failCount = 0;

    for (const meetingId of meetingIds) {
        try {
            const res = await fetch(`/api/meeting/${meetingId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (e) {
            failCount++;
        }
    }

    if (failCount > 0) {
        alert(`${successCount}개 삭제 완료, ${failCount}개 삭제 실패`);
    }

    // 전체선택 체크박스 초기화
    const selectAllCheckbox = document.getElementById('selectAllMeetings');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;

    loadMeetings();
}

// 현재 재생 중인 오디오 관리
let currentPlayingAudio = null;
let currentPlayingButton = null;
let currentPlayingFilename = null;
let audioTimeUpdateInterval = null;
let isSeekingAudio = false;

// 시간 포맷 함수 (초 -> M:SS 또는 H:MM:SS)
function formatAudioTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 오디오 시간 업데이트
function updateAudioTimeDisplay() {
    if (!currentPlayingAudio || !currentPlayingFilename) return;
    // 드래그 중에는 업데이트 하지 않음
    if (isSeekingAudio) return;

    const seekBarId = `seekbar-${currentPlayingFilename.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const controls = document.getElementById(seekBarId);
    if (!controls) return;

    const currentTimeEl = controls.querySelector('.current-time');
    const totalTimeEl = controls.querySelector('.total-time');
    const seekBar = controls.querySelector('.audio-seek-bar');
    const progressBar = controls.querySelector('.audio-progress-bar');

    if (currentTimeEl) {
        currentTimeEl.textContent = formatAudioTime(currentPlayingAudio.currentTime);
    }

    if (totalTimeEl && currentPlayingAudio.duration) {
        totalTimeEl.textContent = formatAudioTime(currentPlayingAudio.duration);
    }

    if (seekBar && currentPlayingAudio.duration) {
        const progress = (currentPlayingAudio.currentTime / currentPlayingAudio.duration) * 100;
        seekBar.value = progress;
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
    }
}

// 시크바 드래그 중 미리보기 업데이트 (실제 재생 위치는 변경하지 않음)
function updateSeekPreview(seekBar, filename) {
    if (!currentPlayingAudio || currentPlayingFilename !== filename) return;

    const controls = seekBar.closest('.audio-player-controls');
    if (!controls) return;

    // 프로그레스 바 미리보기 업데이트
    const progressBar = controls.querySelector('.audio-progress-bar');
    if (progressBar) {
        progressBar.style.width = `${seekBar.value}%`;
    }

    // 시간 표시 미리보기 업데이트
    const currentTimeEl = controls.querySelector('.current-time');
    if (currentTimeEl && currentPlayingAudio.duration) {
        const previewTime = (seekBar.value / 100) * currentPlayingAudio.duration;
        currentTimeEl.textContent = formatAudioTime(previewTime);
    }
}

// 오디오 위치 변경 (seek) - 드래그 완료 시 호출
function seekAudio(seekBar, filename) {
    if (!currentPlayingAudio || currentPlayingFilename !== filename) return;

    const seekTo = (seekBar.value / 100) * currentPlayingAudio.duration;
    if (!isNaN(seekTo) && isFinite(seekTo)) {
        currentPlayingAudio.currentTime = seekTo;

        // 프로그레스 바 업데이트
        const controls = seekBar.closest('.audio-player-controls');
        if (controls) {
            const progressBar = controls.querySelector('.audio-progress-bar');
            if (progressBar) {
                progressBar.style.width = `${seekBar.value}%`;
            }
        }
    }
}

// 녹음 파일 재생/일시정지 토글
function togglePlayRecording(filename, button) {
    const playIcon = button.querySelector('.play-icon');
    const pauseIcon = button.querySelector('.pause-icon');
    const isPlaying = button.dataset.playing === 'true';

    // 다른 파일이 재생 중이면 먼저 중지
    if (currentPlayingAudio && currentPlayingButton !== button) {
        stopCurrentPlayback();
    }

    if (isPlaying) {
        // 일시정지
        if (currentPlayingAudio) {
            currentPlayingAudio.pause();
        }
        button.dataset.playing = 'false';
        playIcon.style.display = '';
        pauseIcon.style.display = 'none';
        button.classList.remove('playing');

        // 녹음 아이템 강조 제거
        const recordingItem = button.closest('.recording-item');
        if (recordingItem) recordingItem.classList.remove('playing');
    } else {
        // 재생 시작
        if (currentPlayingAudio && currentPlayingButton === button) {
            // 같은 파일 이어서 재생
            currentPlayingAudio.play();
        } else {
            // 새 파일 재생
            currentPlayingAudio = new Audio(`/api/recording/download/${encodeURIComponent(filename)}`);
            currentPlayingButton = button;
            currentPlayingFilename = filename;

            // 오디오 시간 컨트롤 표시
            const seekBarId = `seekbar-${filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const controls = document.getElementById(seekBarId);
            if (controls) {
                controls.style.display = 'flex';
            }

            // 메타데이터 로드 시 총 재생 시간 업데이트
            currentPlayingAudio.onloadedmetadata = () => {
                updateAudioTimeDisplay();
            };

            // 시간 업데이트 인터벌 시작
            if (audioTimeUpdateInterval) {
                clearInterval(audioTimeUpdateInterval);
            }
            audioTimeUpdateInterval = setInterval(updateAudioTimeDisplay, 100);

            currentPlayingAudio.onended = () => {
                stopCurrentPlayback();
            };

            currentPlayingAudio.onerror = () => {
                alert('재생할 수 없는 파일입니다.');
                stopCurrentPlayback();
            };

            currentPlayingAudio.play().catch(e => {
                console.error('재생 오류:', e);
                alert('재생 중 오류가 발생했습니다.');
                stopCurrentPlayback();
            });
        }

        button.dataset.playing = 'true';
        playIcon.style.display = 'none';
        pauseIcon.style.display = '';
        button.classList.add('playing');

        // 녹음 아이템 강조
        const recordingItem = button.closest('.recording-item');
        if (recordingItem) recordingItem.classList.add('playing');
    }
}

// 현재 재생 중지
function stopCurrentPlayback() {
    // 시간 업데이트 인터벌 정리
    if (audioTimeUpdateInterval) {
        clearInterval(audioTimeUpdateInterval);
        audioTimeUpdateInterval = null;
    }

    // seek bar 숨기기 및 리셋
    if (currentPlayingFilename) {
        const seekBarId = `seekbar-${currentPlayingFilename.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const controls = document.getElementById(seekBarId);
        if (controls) {
            controls.style.display = 'none';
            const seekBar = controls.querySelector('.audio-seek-bar');
            const progressBar = controls.querySelector('.audio-progress-bar');
            const currentTimeEl = controls.querySelector('.current-time');
            const totalTimeEl = controls.querySelector('.total-time');

            if (seekBar) seekBar.value = 0;
            if (progressBar) progressBar.style.width = '0%';
            if (currentTimeEl) currentTimeEl.textContent = '0:00';
            if (totalTimeEl) totalTimeEl.textContent = '0:00';
        }
    }

    if (currentPlayingAudio) {
        currentPlayingAudio.pause();
        currentPlayingAudio.currentTime = 0;
        currentPlayingAudio = null;
    }

    if (currentPlayingButton) {
        const playIcon = currentPlayingButton.querySelector('.play-icon');
        const pauseIcon = currentPlayingButton.querySelector('.pause-icon');
        currentPlayingButton.dataset.playing = 'false';
        if (playIcon) playIcon.style.display = '';
        if (pauseIcon) pauseIcon.style.display = 'none';
        currentPlayingButton.classList.remove('playing');

        // 녹음 아이템 강조 제거
        const recordingItem = currentPlayingButton.closest('.recording-item');
        if (recordingItem) recordingItem.classList.remove('playing');

        currentPlayingButton = null;
    }

    currentPlayingFilename = null;
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

    // 로딩 오버레이 표시 (화면 전체를 덮어서 다른 조작 차단)
    showSummarizingOverlay('🎙️ 회의록 생성 중...', '녹음 파일을 분석하고 있습니다');
    updateSummarizingOverlay('녹음 파일 로딩 중...', 5);

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
    }, 500);

    try {
        const res = await fetch('/api/recording/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        const result = await res.json();

        clearInterval(progressInterval);

        if (result.success) {
            updateSummarizingOverlay('완료!', 100);
            setTimeout(() => {
                hideSummarizingOverlay();
                loadMeetings();
                loadRecordings();
            }, 1000);
        } else {
            throw new Error(result.error || '회의록 생성 실패');
        }
    } catch (e) {
        clearInterval(progressInterval);
        console.error('회의록 생성 실패:', e);
        hideSummarizingOverlay();
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
    } else if (status.type === 'free') {
        // Free 버전
        licenseType.textContent = 'Free (제한 버전)';
        licenseType.style.color = 'var(--text-muted)';
        if (proStatus) proStatus.style.display = 'none';
        if (activationUI) activationUI.style.display = 'block';
    }

    // 만료일 표시
    if (status.expiresAt) {
        licenseExpiry.textContent = new Date(status.expiresAt).toLocaleDateString('ko-KR');
    } else if (status.type === 'free') {
        licenseExpiry.textContent = '만료 없음';
    } else {
        licenseExpiry.textContent = '-';
    }

    // 남은 일수
    if (status.daysRemaining > 0 && !status.isPro && status.type !== 'free') {
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
    const meetingNavItem = document.querySelector('.nav-item[data-section="meeting"]');
    const meetingSection = document.getElementById('meeting');
    const whisperSettingsCard = document.getElementById('whisperStatusSettings')?.closest('.settings-card');
    const aiModelSettingsCard = document.getElementById('aiModelStatusSettings')?.closest('.settings-card');

    if (!status.features.meetingTranscription) {
        // 회의 녹음 기능 제한 - 메뉴 숨김
        if (meetingNavItem) {
            meetingNavItem.style.display = 'none';
        }
        if (meetingSection) {
            meetingSection.style.display = 'none';
        }
        if (recordingCard) {
            recordingCard.classList.add('feature-locked');
        }
        // 음성 인식 설정 숨김
        if (whisperSettingsCard) {
            whisperSettingsCard.style.display = 'none';
        }
    } else {
        // 기능 활성화 - 메뉴 표시
        if (meetingNavItem) {
            meetingNavItem.style.display = '';
        }
        if (meetingSection) {
            meetingSection.style.display = '';
        }
        if (recordingCard) {
            recordingCard.classList.remove('feature-locked');
        }
        if (whisperSettingsCard) {
            whisperSettingsCard.style.display = '';
        }
    }

    if (!status.features.aiSummary) {
        // AI 요약 기능 제한 - 설정 숨김
        if (aiModelSettingsCard) {
            aiModelSettingsCard.style.display = 'none';
        }
    } else {
        if (aiModelSettingsCard) {
            aiModelSettingsCard.style.display = '';
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
checkDevMode();  // 개발 모드 확인

// 개발 모드 확인 및 UI 표시
async function checkDevMode() {
    try {
        const res = await fetch('/api/dev-mode');
        const data = await res.json();

        if (data.devMode) {
            const devControls = document.getElementById('devModeControls');
            if (devControls) {
                devControls.style.display = 'block';
            }

            // Pro 토글 버튼 이벤트
            const toggleProBtn = document.getElementById('toggleProBtn');
            if (toggleProBtn) {
                toggleProBtn.addEventListener('click', async () => {
                    try {
                        const res = await fetch('/api/license/toggle', { method: 'POST' });
                        const result = await res.json();

                        if (result.success) {
                            alert(`라이선스가 ${result.newType}으로 변경되었습니다.`);
                            loadLicenseStatus();  // 라이선스 상태 새로고침
                            location.reload();  // 페이지 새로고침하여 UI 갱신
                        } else {
                            alert('라이선스 변경 실패: ' + (result.error || '알 수 없는 오류'));
                        }
                    } catch (e) {
                        alert('라이선스 변경 실패: ' + e.message);
                    }
                });
            }
        }
    } catch (e) {
        console.log('개발 모드 확인 실패:', e.message);
    }
}

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

// ========================================
// 사이드바 접기/펼치기 기능
// ========================================
function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');

    if (!sidebar || !toggleBtn) return;

    // 로컬 스토리지에서 상태 복원
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        toggleBtn.classList.add('active');
    }

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        toggleBtn.classList.toggle('active', sidebar.classList.contains('collapsed'));
        localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
}

initSidebarToggle();

// ========================================
// 우측 패널 기능
// ========================================
function initRightPanel() {
    const rightPanel = document.getElementById('rightPanel');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const closeBtn = document.getElementById('closeRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (!rightPanel) return;

    // 패널 토글
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            rightPanel.classList.toggle('open');
            toggleBtn.classList.toggle('active', rightPanel.classList.contains('open'));
        });
    }

    // 패널 닫기
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            rightPanel.classList.remove('open');
            if (toggleBtn) toggleBtn.classList.remove('active');
        });
    }

    // 탭 전환
    panelTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.panelTab;

            // 탭 활성화
            panelTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 콘텐츠 전환
            document.getElementById('panelAiInfo').style.display = tabName === 'ai-info' ? 'flex' : 'none';
            document.getElementById('panelLlmChat').style.display = tabName === 'llm-chat' ? 'flex' : 'none';
        });
    });

    // LLM 섹션에서 "패널에서 열기" 버튼
    const openInPanelBtn = document.getElementById('openInPanelBtn');
    if (openInPanelBtn) {
        openInPanelBtn.addEventListener('click', () => {
            rightPanel.classList.add('open');
            if (toggleBtn) toggleBtn.classList.add('active');

            // LLM 탭 활성화
            panelTabs.forEach(t => {
                t.classList.toggle('active', t.dataset.panelTab === 'llm-chat');
            });
            document.getElementById('panelAiInfo').style.display = 'none';
            document.getElementById('panelLlmChat').style.display = 'flex';
        });
    }
}

initRightPanel();

// ========================================
// 우측 패널 리사이즈 기능
// ========================================
function initRightPanelResize() {
    const rightPanel = document.getElementById('rightPanel');
    const resizeHandle = document.getElementById('rightPanelResizeHandle');
    const mainContent = document.querySelector('.main-content');

    if (!rightPanel || !resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const MIN_WIDTH = 150;
    const MAX_WIDTH = window.innerWidth * 0.9; // 화면의 90%까지
    const DEFAULT_WIDTH = 380;

    // 핸들 위치 업데이트
    function updateHandlePosition() {
        if (rightPanel.classList.contains('open')) {
            const panelWidth = rightPanel.offsetWidth;
            resizeHandle.style.right = `${panelWidth - 2}px`;
            resizeHandle.classList.add('visible');
        } else {
            resizeHandle.classList.remove('visible');
        }
    }

    // 패널 크기 설정
    function setPanelWidth(width) {
        const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
        document.documentElement.style.setProperty('--right-panel-width', `${clampedWidth}px`);
        updateHandlePosition();
    }

    // 마우스 다운 - 리사이즈 시작
    resizeHandle.addEventListener('mousedown', (e) => {
        if (!rightPanel.classList.contains('open')) return;

        isResizing = true;
        startX = e.clientX;
        startWidth = rightPanel.offsetWidth;

        rightPanel.classList.add('resizing');
        resizeHandle.classList.add('dragging');
        document.body.classList.add('resizing-right-panel');

        e.preventDefault();
    });

    // 마우스 이동 - 리사이즈 중
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = startX - e.clientX;
        const newWidth = startWidth + deltaX;
        setPanelWidth(newWidth);
    });

    // 마우스 업 - 리사이즈 종료
    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        rightPanel.classList.remove('resizing');
        resizeHandle.classList.remove('dragging');
        document.body.classList.remove('resizing-right-panel');

        // 저장된 크기를 localStorage에 저장
        const currentWidth = rightPanel.offsetWidth;
        localStorage.setItem('rightPanelWidth', currentWidth);
    });

    // 패널 열림/닫힘 감지
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                setTimeout(updateHandlePosition, 350); // transition 완료 후
            }
        });
    });

    observer.observe(rightPanel, { attributes: true });

    // 저장된 크기 복원
    const savedWidth = localStorage.getItem('rightPanelWidth');
    if (savedWidth) {
        setPanelWidth(parseInt(savedWidth, 10));
    }

    // 초기 위치 설정
    setTimeout(updateHandlePosition, 100);

    // 윈도우 리사이즈 시 핸들 위치 업데이트
    window.addEventListener('resize', updateHandlePosition);
}

initRightPanelResize();

// ========================================
// 하단 패널 기능 (변경 내역 전용)
// ========================================
function initBottomPanel() {
    const bottomPanel = document.getElementById('bottomPanel');
    const closeBtn = document.getElementById('closeBottomPanelBtn');
    const mainContent = document.querySelector('.main-content');

    if (!bottomPanel) return;

    // 패널 닫기
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            bottomPanel.classList.remove('open');
            if (mainContent) {
                mainContent.classList.remove('with-bottom-panel');
            }
            // 하단 패널 내용 초기화
            const bottomChanges = document.getElementById('bottomChanges');
            const bottomPanelFileInfo = document.getElementById('bottomPanelFileInfo');
            if (bottomChanges) {
                bottomChanges.innerHTML = `
                    <div class="changes-empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <path d="M14 2v6h6"/>
                            <path d="M9 15h6M12 12v6"/>
                        </svg>
                        <p>변경 내역이 여기에 표시됩니다</p>
                        <span class="changes-hint">모니터링에서 "변경내역 보기" 버튼을 클릭하세요</span>
                    </div>
                `;
            }
            if (bottomPanelFileInfo) {
                bottomPanelFileInfo.innerHTML = '';
            }
        });
    }
}

initBottomPanel();

// ========================================
// 하단 패널 리사이즈 기능
// ========================================
function initBottomPanelResize() {
    const resizeHandle = document.getElementById('bottomPanelResizeHandle');
    const bottomPanel = document.getElementById('bottomPanel');
    const mainContent = document.querySelector('.main-content');

    if (!resizeHandle || !bottomPanel) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const MIN_HEIGHT = 80;
    const MAX_HEIGHT = window.innerHeight * 0.95; // 화면의 95%까지

    // 저장된 높이 불러오기
    const savedHeight = localStorage.getItem('bottomPanelHeight');
    if (savedHeight) {
        const height = parseInt(savedHeight, 10);
        if (height >= MIN_HEIGHT && height <= MAX_HEIGHT) {
            document.documentElement.style.setProperty('--bottom-panel-height', `${height}px`);
        }
    }

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = bottomPanel.offsetHeight;

        resizeHandle.classList.add('resizing');
        document.body.classList.add('resizing-bottom-panel');

        // transition 비활성화
        bottomPanel.style.transition = 'none';

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaY = startY - e.clientY;
        let newHeight = startHeight + deltaY;

        // 범위 제한
        newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));

        // CSS 변수로 높이 설정
        document.documentElement.style.setProperty('--bottom-panel-height', `${newHeight}px`);
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;

        isResizing = false;
        resizeHandle.classList.remove('resizing');
        document.body.classList.remove('resizing-bottom-panel');

        // transition 다시 활성화
        bottomPanel.style.transition = '';

        // 높이 저장
        const currentHeight = bottomPanel.offsetHeight;
        localStorage.setItem('bottomPanelHeight', currentHeight.toString());
    });

    // 패널이 열릴 때 리사이즈 핸들 표시
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                if (bottomPanel.classList.contains('open')) {
                    resizeHandle.classList.add('visible');
                } else {
                    resizeHandle.classList.remove('visible');
                }
            }
        });
    });

    observer.observe(bottomPanel, { attributes: true });
}

initBottomPanelResize();

// 터미널에 메시지 추가 함수
function addTerminalLine(text, type = 'info') {
    const terminalOutput = document.getElementById('terminalOutput');
    if (!terminalOutput) return;

    const line = document.createElement('div');
    line.className = 'terminal-line';

    const prompt = type === 'error' ? '!' : '$';
    const color = type === 'error' ? 'var(--error)' : 'var(--accent-primary)';

    line.innerHTML = `
        <span class="terminal-prompt" style="color: ${color}">${prompt}</span>
        <span class="terminal-text">${text}</span>
    `;

    terminalOutput.appendChild(line);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// ========================================
// 우측 패널에 AI 분석 결과 표시
// ========================================
function showAIResultInPanel(fileName, analysis) {
    const rightPanel = document.getElementById('rightPanel');
    const panelAiInfo = document.getElementById('panelAiInfo');
    const toggleBtn = document.getElementById('toggleRightPanelBtn');
    const panelTabs = document.querySelectorAll('.panel-tab');

    if (!rightPanel || !panelAiInfo) return;

    // 패널 열기
    rightPanel.classList.add('open');
    if (toggleBtn) toggleBtn.classList.add('active');

    // AI 정보 탭 활성화
    panelTabs.forEach(t => {
        t.classList.toggle('active', t.dataset.panelTab === 'ai-info');
    });
    document.getElementById('panelAiInfo').style.display = 'flex';
    document.getElementById('panelLlmChat').style.display = 'none';

    // 분석 결과 포맷팅
    const formattedAnalysis = formatAIAnalysis(analysis);

    // 콘텐츠 업데이트
    panelAiInfo.innerHTML = `
        <div class="panel-ai-result">
            <div class="panel-ai-header">
                <span class="ai-icon">✨</span>
                <h4>AI 변경 분석</h4>
            </div>
            <div class="panel-file-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6"/>
                </svg>
                <span>${decodeURIComponent(fileName)}</span>
            </div>
            <div class="panel-ai-content">
                ${formattedAnalysis}
            </div>
        </div>
    `;
}

// ========================================
// LLM 대화 기능
// ========================================
let llmConversationHistory = [];

function initLLMChat() {
    // 메인 LLM 섹션
    const llmInput = document.getElementById('llmInput');
    const llmSendBtn = document.getElementById('llmSendBtn');
    const llmMessages = document.getElementById('llmMessages');

    // 패널 LLM
    const panelLlmInput = document.getElementById('panelLlmInput');
    const panelLlmSendBtn = document.getElementById('panelLlmSendBtn');
    const panelLlmMessages = document.getElementById('panelLlmMessages');

    // 모델 정보 업데이트
    updateLLMModelInfo();

    // 메인 LLM 전송
    if (llmSendBtn && llmInput) {
        llmSendBtn.addEventListener('click', () => sendLLMMessage(llmInput, llmMessages, false));
        llmInput.addEventListener('keydown', (e) => {
            // 한글 IME 조합 중일 때는 무시 (중복 전송 방지)
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendLLMMessage(llmInput, llmMessages, false);
            }
        });
    }

    // 패널 LLM 전송
    if (panelLlmSendBtn && panelLlmInput) {
        panelLlmSendBtn.addEventListener('click', () => sendLLMMessage(panelLlmInput, panelLlmMessages, true));
        panelLlmInput.addEventListener('keydown', (e) => {
            // 한글 IME 조합 중일 때는 무시 (중복 전송 방지)
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendLLMMessage(panelLlmInput, panelLlmMessages, true);
            }
        });
    }
}

async function updateLLMModelInfo() {
    const llmModelInfo = document.getElementById('llmModelInfo');
    if (!llmModelInfo) return;

    try {
        const response = await fetch('/api/ollama/status');
        const data = await response.json();

        // model 필드가 현재 선택된 모델
        const currentModel = data.model || data.currentModel;

        if (data.ready && currentModel) {
            // availableModels에서 친화적 이름 가져오기
            const modelInfo = data.availableModels?.[currentModel];
            const displayName = modelInfo ? modelInfo.name : currentModel;
            llmModelInfo.textContent = `모델: ${displayName}`;
            llmModelInfo.style.color = '';
        } else {
            llmModelInfo.textContent = '모델: 연결 안됨';
            llmModelInfo.style.color = 'var(--danger)';
        }
    } catch (error) {
        llmModelInfo.textContent = '모델: 오류';
        llmModelInfo.style.color = 'var(--danger)';
    }
}

async function sendLLMMessage(inputEl, messagesEl, isPanel) {
    const message = inputEl.value.trim();
    if (!message) return;

    // 웰컴 메시지 제거
    const welcomeEl = messagesEl.querySelector('.llm-welcome');
    if (welcomeEl) welcomeEl.remove();

    // 사용자 메시지 추가
    addLLMMessage(messagesEl, message, 'user', isPanel);
    inputEl.value = '';

    // 대화 기록에 추가
    llmConversationHistory.push({ role: 'user', content: message });

    // 로딩 표시
    const loadingEl = document.createElement('div');
    loadingEl.className = 'llm-message assistant';
    loadingEl.innerHTML = `
        <div class="llm-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73A2 2 0 0110 4a2 2 0 012-2z"/>
            </svg>
        </div>
        <div class="llm-bubble">
            <div class="llm-typing">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    messagesEl.appendChild(loadingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
        const response = await fetch('/api/llm/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                history: llmConversationHistory.slice(-10) // 최근 10개 대화만 전송
            })
        });

        const data = await response.json();

        // 로딩 제거
        loadingEl.remove();

        if (data.success) {
            addLLMMessage(messagesEl, data.response, 'assistant', isPanel);
            llmConversationHistory.push({ role: 'assistant', content: data.response });

            // 양쪽 채팅 동기화
            syncLLMMessages(messagesEl === document.getElementById('llmMessages') ? 'main' : 'panel');
        } else {
            addLLMMessage(messagesEl, '죄송합니다. 응답을 생성하는 중 오류가 발생했습니다: ' + (data.error || '알 수 없는 오류'), 'assistant', isPanel);
        }
    } catch (error) {
        loadingEl.remove();
        addLLMMessage(messagesEl, '서버 연결 오류: ' + error.message, 'assistant', isPanel);
    }
}

function addLLMMessage(container, content, role, isPanel) {
    const messageEl = document.createElement('div');
    messageEl.className = `llm-message ${role}`;

    const avatarIcon = role === 'user'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73A2 2 0 0110 4a2 2 0 012-2z"/></svg>';

    // 마크다운 간단 처리
    const formattedContent = content
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    // 액션 버튼 생성 (assistant 응답에만)
    let actionButtons = '';
    if (role === 'assistant') {
        actionButtons = getLLMActionButtons(content);
    }

    messageEl.innerHTML = `
        <div class="llm-avatar">${avatarIcon}</div>
        <div class="llm-bubble">
            ${formattedContent}
            ${actionButtons}
        </div>
    `;

    // 액션 버튼 이벤트 바인딩
    if (role === 'assistant') {
        bindLLMActionEvents(messageEl);
    }

    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

// LLM 응답 내용에 따라 액션 버튼 생성
function getLLMActionButtons(content) {
    const buttons = [];
    const lowerContent = content.toLowerCase();

    // 녹음 관련 명령
    if (lowerContent.includes('녹음') && (lowerContent.includes('시작') || lowerContent.includes('새 회의'))) {
        buttons.push({
            action: 'start-recording',
            label: '🎙️ 녹음 시작',
            class: 'primary'
        });
    }

    // 회의록 메뉴 이동
    if (lowerContent.includes('회의록') && (lowerContent.includes('메뉴') || lowerContent.includes('클릭'))) {
        buttons.push({
            action: 'goto-meeting',
            label: '📝 회의록 메뉴로 이동',
            class: 'secondary'
        });
    }

    // 모니터링 메뉴 이동
    if (lowerContent.includes('모니터링') || (lowerContent.includes('문서') && lowerContent.includes('목록'))) {
        buttons.push({
            action: 'goto-monitoring',
            label: '📂 모니터링으로 이동',
            class: 'secondary'
        });
    }

    // meeting_ID가 있는 경우 해당 회의록 보기 버튼
    const meetingIdMatch = content.match(/meeting_\d+/g);
    if (meetingIdMatch && meetingIdMatch.length > 0) {
        // 중복 제거
        const uniqueIds = [...new Set(meetingIdMatch)];
        uniqueIds.slice(0, 3).forEach(id => {
            buttons.push({
                action: 'view-meeting',
                data: id,
                label: `📋 ${id} 보기`,
                class: 'secondary'
            });
        });
    }

    if (buttons.length === 0) return '';

    let html = '<div class="llm-action-buttons">';
    buttons.forEach(btn => {
        html += `<button class="llm-action-btn ${btn.class}" data-action="${btn.action}" ${btn.data ? `data-id="${btn.data}"` : ''}>${btn.label}</button>`;
    });
    html += '</div>';
    return html;
}

// LLM 액션 버튼 이벤트 바인딩
function bindLLMActionEvents(messageEl) {
    const actionBtns = messageEl.querySelectorAll('.llm-action-btn');
    actionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            switch (action) {
                case 'start-recording':
                    // 회의록 메뉴로 이동 후 녹음 시작
                    showSection('meeting');
                    // 약간의 딜레이 후 녹음 팝업 열기
                    setTimeout(() => {
                        const recordBtn = document.querySelector('.meeting-record-btn, [onclick*="openRecordingModal"]');
                        if (recordBtn) {
                            recordBtn.click();
                        } else if (typeof openRecordingModal === 'function') {
                            openRecordingModal();
                        }
                    }, 300);
                    break;

                case 'goto-meeting':
                    showSection('meeting');
                    break;

                case 'goto-monitoring':
                    showSection('monitoring');
                    break;

                case 'view-meeting':
                    if (id) {
                        showSection('meeting');
                        setTimeout(() => {
                            // 회의록 상세 보기 시도
                            const meetingCard = document.querySelector(`[data-meeting-id="${id}"]`);
                            if (meetingCard) {
                                meetingCard.click();
                            } else if (typeof viewMeetingDetail === 'function') {
                                viewMeetingDetail(id);
                            }
                        }, 300);
                    }
                    break;
            }
        });
    });
}

function syncLLMMessages(source) {
    // 양쪽 채팅창 동기화 (선택적 기능)
    const mainMessages = document.getElementById('llmMessages');
    const panelMessages = document.getElementById('panelLlmMessages');

    if (!mainMessages || !panelMessages) return;

    // 현재는 개별 관리, 필요시 동기화 로직 추가 가능
}

initLLMChat();

// ========================================
// 상단 검색 기능 (Command Palette)
// ========================================
function initGlobalSearch() {
    const searchInput = document.getElementById('globalSearchInput');
    const searchResults = document.getElementById('searchResults');
    const searchDocsItems = document.getElementById('searchDocsItems');
    const searchMeetingsItems = document.getElementById('searchMeetingsItems');
    const searchCommandsItems = document.getElementById('searchCommandsItems');
    const searchCategoryDocs = document.getElementById('searchCategoryDocs');
    const searchCategoryMeetings = document.getElementById('searchCategoryMeetings');
    const searchCategoryCommands = document.getElementById('searchCategoryCommands');
    const searchNoResults = document.getElementById('searchNoResults');

    if (!searchInput || !searchResults) return;

    let selectedIndex = -1;
    let allResults = [];

    // 명령어 목록
    const commands = [
        { id: 'cmd-monitoring', title: '폴더 모니터링', subtitle: '문서 변경 추적', action: () => showSection('monitoring'), shortcut: '' },
        { id: 'cmd-meeting', title: '회의록', subtitle: '회의 녹음 및 관리', action: () => showSection('meeting'), shortcut: '' },
        { id: 'cmd-llm', title: '스마트 어시스트', subtitle: 'AI 대화', action: () => showSection('llm'), shortcut: '' },
        { id: 'cmd-settings', title: '설정', subtitle: '앱 설정', action: () => showSection('settings'), shortcut: '' },
        { id: 'cmd-record', title: '녹음 시작', subtitle: '새 회의 녹음', action: () => { showSection('meeting'); setTimeout(() => { if(typeof openRecordingModal === 'function') openRecordingModal(); }, 300); }, shortcut: '' },
        { id: 'cmd-add-folder', title: '폴더 추가', subtitle: '감시 폴더 추가', action: () => { showSection('monitoring'); setTimeout(() => { const btn = document.querySelector('.add-folder-btn, [onclick*="addFolder"]'); if(btn) btn.click(); }, 300); }, shortcut: '' },
        { id: 'cmd-refresh', title: '새로고침', subtitle: '데이터 새로고침', action: () => location.reload(), shortcut: '⌘R' },
    ];

    // 검색 실행
    async function performSearch(query) {
        if (!query || query.trim().length === 0) {
            closeSearchResults();
            return;
        }

        const q = query.toLowerCase().trim();
        allResults = [];
        let docsHtml = '';
        let meetingsHtml = '';
        let commandsHtml = '';

        // 1. 문서 검색 (서버에서)
        try {
            const docsResponse = await fetch(`/api/search/docs?q=${encodeURIComponent(q)}`);
            if (docsResponse.ok) {
                const docs = await docsResponse.json();
                docs.slice(0, 5).forEach((doc, i) => {
                    allResults.push({ type: 'doc', data: doc, index: allResults.length });
                    docsHtml += createDocResultItem(doc, q, allResults.length - 1);
                });
            }
        } catch (e) {
            console.log('문서 검색 오류:', e);
        }

        // 2. 회의록 검색 (서버에서)
        try {
            const meetingsResponse = await fetch(`/api/search/meetings?q=${encodeURIComponent(q)}`);
            if (meetingsResponse.ok) {
                const meetings = await meetingsResponse.json();
                meetings.slice(0, 5).forEach((meeting, i) => {
                    allResults.push({ type: 'meeting', data: meeting, index: allResults.length });
                    meetingsHtml += createMeetingResultItem(meeting, q, allResults.length - 1);
                });
            }
        } catch (e) {
            console.log('회의록 검색 오류:', e);
        }

        // 3. 명령어 검색
        commands.filter(cmd =>
            cmd.title.toLowerCase().includes(q) ||
            cmd.subtitle.toLowerCase().includes(q)
        ).slice(0, 5).forEach(cmd => {
            allResults.push({ type: 'command', data: cmd, index: allResults.length });
            commandsHtml += createCommandResultItem(cmd, q, allResults.length - 1);
        });

        // 결과 표시
        searchDocsItems.innerHTML = docsHtml;
        searchMeetingsItems.innerHTML = meetingsHtml;
        searchCommandsItems.innerHTML = commandsHtml;

        searchCategoryDocs.classList.toggle('has-results', docsHtml.length > 0);
        searchCategoryMeetings.classList.toggle('has-results', meetingsHtml.length > 0);
        searchCategoryCommands.classList.toggle('has-results', commandsHtml.length > 0);

        const hasResults = allResults.length > 0;
        searchNoResults.classList.toggle('visible', !hasResults);

        searchResults.classList.add('open');
        selectedIndex = -1;
        bindResultEvents();
    }

    // 문서 결과 아이템 생성
    function createDocResultItem(doc, query, index) {
        const title = highlightText(doc.fileName || doc.name || '문서', query);
        const subtitle = doc.folder || doc.path || '';
        return `
            <div class="search-result-item" data-type="doc" data-index="${index}">
                <svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                </svg>
                <div class="item-content">
                    <div class="item-title">${title}</div>
                    <div class="item-subtitle">${subtitle}</div>
                </div>
            </div>
        `;
    }

    // 회의록 결과 아이템 생성
    function createMeetingResultItem(meeting, query, index) {
        const title = highlightText(meeting.title || meeting.id || '회의록', query);
        const subtitle = meeting.date || meeting.createdAt || '';
        return `
            <div class="search-result-item" data-type="meeting" data-index="${index}">
                <svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                </svg>
                <div class="item-content">
                    <div class="item-title">${title}</div>
                    <div class="item-subtitle">${subtitle}</div>
                </div>
            </div>
        `;
    }

    // 명령어 결과 아이템 생성
    function createCommandResultItem(cmd, query, index) {
        const title = highlightText(cmd.title, query);
        return `
            <div class="search-result-item" data-type="command" data-index="${index}">
                <svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="4,17 10,11 4,5"/>
                    <line x1="12" y1="19" x2="20" y2="19"/>
                </svg>
                <div class="item-content">
                    <div class="item-title">${title}</div>
                    <div class="item-subtitle">${cmd.subtitle}</div>
                </div>
                ${cmd.shortcut ? `<span class="item-shortcut">${cmd.shortcut}</span>` : ''}
            </div>
        `;
    }

    // 텍스트 하이라이트
    function highlightText(text, query) {
        if (!query) return text;
        const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 결과 아이템 이벤트 바인딩
    function bindResultEvents() {
        const items = searchResults.querySelectorAll('.search-result-item');
        items.forEach((item, i) => {
            item.addEventListener('click', () => selectResult(i));
            item.addEventListener('mouseenter', () => {
                items.forEach(it => it.classList.remove('selected'));
                item.classList.add('selected');
                selectedIndex = i;
            });
        });
    }

    // 결과 선택
    function selectResult(index) {
        if (index < 0 || index >= allResults.length) return;

        const result = allResults[index];
        closeSearchResults();
        searchInput.value = '';

        switch (result.type) {
            case 'doc':
                showSection('monitoring');
                // 문서 상세 표시 로직 (필요시)
                break;
            case 'meeting':
                showSection('meeting');
                const meetingId = result.data.id;
                if (meetingId && typeof viewMeetingDetail === 'function') {
                    setTimeout(() => viewMeetingDetail(meetingId), 300);
                }
                break;
            case 'command':
                result.data.action();
                break;
        }
    }

    // 결과 닫기
    function closeSearchResults() {
        searchResults.classList.remove('open');
        selectedIndex = -1;
        allResults = [];
    }

    // 키보드 내비게이션
    searchInput.addEventListener('keydown', (e) => {
        const items = searchResults.querySelectorAll('.search-result-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < items.length - 1) {
                selectedIndex++;
                updateSelection(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex--;
                updateSelection(items);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0) {
                selectResult(selectedIndex);
            }
        } else if (e.key === 'Escape') {
            closeSearchResults();
            searchInput.blur();
        }
    });

    function updateSelection(items) {
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === selectedIndex);
        });
        if (items[selectedIndex]) {
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // 입력 이벤트 (디바운스)
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            performSearch(e.target.value);
        }, 200);
    });

    // 포커스 시 결과 표시
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim().length > 0) {
            performSearch(searchInput.value);
        }
    });

    // 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.titlebar-search')) {
            closeSearchResults();
        }
    });

    // 단축키 (Cmd+K / Ctrl+K)
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
    });

    // 플레이스홀더 업데이트 (Mac/Windows)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    searchInput.placeholder = isMac ? '검색 (⌘K)' : '검색 (Ctrl+K)';
    const shortcutEl = document.querySelector('.search-shortcut');
    if (shortcutEl) {
        shortcutEl.textContent = isMac ? '⌘K' : 'Ctrl+K';
    }
}

initGlobalSearch();

// ========================================
// 외부 AI API 설정 관련 함수
// ========================================

// 외부 API 설정 로드
async function loadExternalApiSettings() {
    try {
        const response = await fetch('/api/ai/external-settings');
        const data = await response.json();

        // OpenAI 상태 업데이트
        const openaiStatus = document.getElementById('openaiStatus');
        if (openaiStatus) {
            if (data.openai.hasKey) {
                openaiStatus.textContent = '연결됨';
                openaiStatus.className = 'provider-status connected';
            } else {
                openaiStatus.textContent = '미설정';
                openaiStatus.className = 'provider-status';
            }
        }

        // Gemini 상태 업데이트
        const geminiStatus = document.getElementById('geminiStatus');
        if (geminiStatus) {
            if (data.gemini.hasKey) {
                geminiStatus.textContent = '연결됨';
                geminiStatus.className = 'provider-status connected';
            } else {
                geminiStatus.textContent = '미설정';
                geminiStatus.className = 'provider-status';
            }
        }
    } catch (error) {
        console.error('외부 API 설정 로드 실패:', error);
    }
}

// API 키 표시/숨기기 토글
function toggleApiKeyVisibility(provider) {
    const input = document.getElementById(provider + 'ApiKey');
    const eyeIcon = document.getElementById(provider + 'EyeIcon');

    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
        input.type = 'password';
        eyeIcon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
}

// API 키 저장
async function saveExternalApiKey(provider) {
    const input = document.getElementById(provider + 'ApiKey');
    const apiKey = input.value.trim();

    if (!apiKey) {
        showToast('API 키를 입력해주세요.', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/ai/external-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider,
                apiKey,
                enabled: true
            })
        });

        const result = await response.json();

        if (result.success) {
            const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini';
            showToast(providerName + ' API 키가 저장되었습니다.', 'success');
            input.value = '';
            loadExternalApiSettings();
            // 모델 목록 갱신
            checkOllamaStatus();
        } else {
            showToast(result.error || 'API 키 저장 실패', 'error');
        }
    } catch (error) {
        showToast('API 키 저장 중 오류가 발생했습니다.', 'error');
    }
}

// API 연결 테스트
async function testExternalApiConnection(provider) {
    const statusEl = document.getElementById(provider + 'Status');
    const originalText = statusEl.textContent;
    statusEl.textContent = '테스트 중...';
    statusEl.className = 'provider-status';

    try {
        const response = await fetch('/api/ai/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider })
        });

        const result = await response.json();
        const providerName = provider === 'openai' ? 'OpenAI' : 'Gemini';

        if (result.success) {
            showToast(providerName + ' 연결 성공!', 'success');
            statusEl.textContent = '연결됨';
            statusEl.className = 'provider-status connected';
        } else {
            showToast(result.error || '연결 테스트 실패', 'error');
            statusEl.textContent = '연결 실패';
            statusEl.className = 'provider-status error';
        }
    } catch (error) {
        showToast('연결 테스트 중 오류가 발생했습니다.', 'error');
        statusEl.textContent = originalText;
    }
}

// 페이지 로드 시 외부 API 설정 로드
document.addEventListener('DOMContentLoaded', function() {
    loadExternalApiSettings();
});
