/**
 * 파일 변경 알림 확장
 *
 * 기능:
 * - 파일 변경/생성/삭제 알림
 * - 변경 내역 추적
 * - 특정 파일 유형 필터링
 */

let docwatch = null;
let changeHistory = [];
const MAX_HISTORY = 100;

/**
 * 확장 활성화
 */
async function activate(api) {
    docwatch = api;
    console.log('파일 알림 확장 활성화됨');

    // 저장된 히스토리 로드
    const savedHistory = await docwatch.storage.get('changeHistory', []);
    changeHistory = Array.isArray(savedHistory) ? savedHistory : [];

    // 1. 문서 파일 변경 감시
    await docwatch.files.onDidChange('*.docx');
    await docwatch.files.onDidChange('*.xlsx');
    await docwatch.files.onDidChange('*.pptx');
    await docwatch.files.onDidChange('*.pdf');

    // 2. 파일 생성 감시
    await docwatch.files.onDidCreate('*');

    // 3. 파일 삭제 감시
    await docwatch.files.onDidDelete('*');

    // 4. 명령어 등록
    await docwatch.commands.register('showHistory', {
        title: '변경 내역 보기',
        category: '파일'
    });

    await docwatch.commands.register('clearHistory', {
        title: '변경 내역 지우기',
        category: '파일'
    });

    // 5. 상태바 아이템
    await docwatch.ui.registerStatusBarItem({
        text: `📁 변경: ${changeHistory.length}`,
        tooltip: '최근 파일 변경 내역',
        position: 'left'
    });

    // 6. 알림
    await docwatch.ui.showNotification('파일 알림 확장이 활성화되었습니다', {
        type: 'info',
        duration: 3000
    });

    return {
        getHistory: () => changeHistory,
        clearHistory: clearHistory
    };
}

/**
 * 파일 변경 기록
 */
function recordChange(type, filePath) {
    const filename = filePath.split(/[/\\]/).pop();
    const record = {
        type,
        filename,
        path: filePath,
        timestamp: new Date().toISOString()
    };

    changeHistory.unshift(record);

    // 최대 개수 제한
    if (changeHistory.length > MAX_HISTORY) {
        changeHistory = changeHistory.slice(0, MAX_HISTORY);
    }

    // 저장
    docwatch.storage.set('changeHistory', changeHistory);

    return record;
}

/**
 * 변경 내역 조회
 */
async function showHistory() {
    if (changeHistory.length === 0) {
        await docwatch.ui.showNotification('변경 내역이 없습니다', { type: 'info' });
        return;
    }

    const items = changeHistory.slice(0, 20).map(record => {
        const icon = record.type === 'create' ? '➕' :
                     record.type === 'change' ? '✏️' : '🗑️';
        return {
            label: `${icon} ${record.filename}`,
            description: new Date(record.timestamp).toLocaleString('ko-KR'),
            value: record
        };
    });

    const selected = await docwatch.ui.showQuickPick(items, {
        placeholder: '최근 변경 내역 (최대 20개)'
    });

    if (selected) {
        await docwatch.ui.showNotification(
            `${selected.value.type}: ${selected.value.path}`,
            { type: 'info', duration: 5000 }
        );
    }
}

/**
 * 변경 내역 지우기
 */
async function clearHistory() {
    changeHistory = [];
    await docwatch.storage.set('changeHistory', []);
    await docwatch.ui.showNotification('변경 내역이 지워졌습니다', { type: 'success' });
}

/**
 * 확장 비활성화
 */
function deactivate() {
    console.log('파일 알림 확장 비활성화됨');
    // 히스토리 저장
    if (docwatch) {
        docwatch.storage.set('changeHistory', changeHistory);
    }
    docwatch = null;
}

/**
 * 이벤트 핸들러
 */
function onEvent(event, data) {
    if (!docwatch) return;

    // 파일 이벤트 처리
    if (event.startsWith('file:')) {
        const type = event.split(':')[1];
        const filename = data.path?.split(/[/\\]/).pop() || '알 수 없는 파일';

        // 기록
        recordChange(type, data.path);

        // 알림 표시
        const icon = type === 'create' ? '➕' : type === 'change' ? '✏️' : '🗑️';
        const action = type === 'create' ? '생성됨' :
                      type === 'change' ? '수정됨' : '삭제됨';

        docwatch.ui.showNotification(
            `${icon} ${filename} - ${action}`,
            { type: 'info', duration: 3000 }
        );
    }
}

module.exports = { activate, deactivate, onEvent };
