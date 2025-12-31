/**
 * 회의록 자동 요약 확장
 *
 * 기능:
 * - 회의록 자동 요약
 * - 액션 아이템 추출
 * - 키워드 추출
 */

let docwatch = null;

/**
 * 확장 활성화
 */
async function activate(api) {
    docwatch = api;
    console.log('회의록 요약 확장 활성화됨');

    // 1. 요약 명령어 등록
    await docwatch.commands.register('summarize', {
        title: '회의록 요약',
        category: '회의록'
    });

    // 2. 액션 아이템 추출 명령어 등록
    await docwatch.commands.register('extractActions', {
        title: '액션 아이템 추출',
        category: '회의록'
    });

    // 3. 상태바 아이템 등록
    await docwatch.ui.registerStatusBarItem({
        text: '📝 회의록 요약',
        tooltip: '클릭하여 회의록 요약',
        position: 'right'
    });

    // 4. 알림 표시
    await docwatch.ui.showNotification('회의록 요약 확장이 활성화되었습니다', {
        type: 'info',
        duration: 3000
    });

    // 내보내기 함수들
    return {
        summarize: summarizeMeeting,
        extractActions: extractActionItems
    };
}

/**
 * 회의록 요약 실행
 */
async function summarizeMeeting(meetingId) {
    if (!docwatch) {
        console.error('확장이 초기화되지 않았습니다');
        return null;
    }

    try {
        // 회의록 조회
        const meeting = meetingId
            ? await docwatch.meetings.getById(meetingId)
            : await selectMeeting();

        if (!meeting) {
            await docwatch.ui.showNotification('회의록을 찾을 수 없습니다', { type: 'warning' });
            return null;
        }

        await docwatch.ui.showNotification('회의록 요약 중...', { type: 'info' });

        // 설정에서 최대 길이 가져오기
        const maxLength = await docwatch.storage.get('maxLength', 500);

        // LLM으로 요약
        const response = await docwatch.llm.chat([
            {
                role: 'system',
                content: `당신은 회의록 요약 전문가입니다.
주어진 회의록을 ${maxLength}자 이내로 요약해주세요.

다음 형식으로 작성해주세요:
## 요약
[핵심 내용 요약]

## 주요 논의 사항
- [논의 사항 1]
- [논의 사항 2]

## 결정 사항
- [결정 사항 1]

## 다음 단계
- [다음 단계 1]`
            },
            {
                role: 'user',
                content: meeting.content || meeting.transcript || '내용 없음'
            }
        ]);

        const summary = response.message;

        // 요약 저장
        await docwatch.storage.set(`summary:${meeting.id}`, {
            summary,
            createdAt: new Date().toISOString()
        });

        await docwatch.ui.showNotification('회의록 요약이 완료되었습니다!', { type: 'success' });

        return summary;

    } catch (err) {
        console.error('회의록 요약 실패:', err);
        await docwatch.ui.showNotification(`요약 실패: ${err.message}`, { type: 'error' });
        return null;
    }
}

/**
 * 회의록 선택 (QuickPick)
 */
async function selectMeeting() {
    const meetings = await docwatch.meetings.getAll();

    if (!meetings || meetings.length === 0) {
        await docwatch.ui.showNotification('회의록이 없습니다', { type: 'warning' });
        return null;
    }

    const items = meetings.map(m => ({
        label: m.title || '제목 없음',
        description: new Date(m.createdAt).toLocaleDateString('ko-KR'),
        value: m.id
    }));

    const selected = await docwatch.ui.showQuickPick(items, {
        placeholder: '요약할 회의록을 선택하세요'
    });

    if (selected) {
        return await docwatch.meetings.getById(selected.value);
    }

    return null;
}

/**
 * 액션 아이템 추출
 */
async function extractActionItems(meetingId) {
    if (!docwatch) {
        console.error('확장이 초기화되지 않았습니다');
        return [];
    }

    try {
        const meeting = meetingId
            ? await docwatch.meetings.getById(meetingId)
            : await selectMeeting();

        if (!meeting) {
            return [];
        }

        await docwatch.ui.showNotification('액션 아이템 추출 중...', { type: 'info' });

        const response = await docwatch.llm.chat([
            {
                role: 'system',
                content: `회의록에서 액션 아이템(할 일)을 추출해주세요.
JSON 배열 형식으로만 반환해주세요. 다른 설명 없이 JSON만 출력하세요.

형식:
[
    {"task": "할 일 내용", "assignee": "담당자", "dueDate": "마감일 또는 null"},
    ...
]

담당자나 마감일이 명시되지 않은 경우 null로 표시하세요.`
            },
            {
                role: 'user',
                content: meeting.content || meeting.transcript || '내용 없음'
            }
        ]);

        let actionItems = [];
        try {
            // JSON 파싱 시도
            const jsonMatch = response.message.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                actionItems = JSON.parse(jsonMatch[0]);
            }
        } catch (parseErr) {
            console.error('액션 아이템 파싱 실패:', parseErr);
        }

        // 저장
        await docwatch.storage.set(`actions:${meeting.id}`, {
            items: actionItems,
            createdAt: new Date().toISOString()
        });

        await docwatch.ui.showNotification(
            `${actionItems.length}개의 액션 아이템을 추출했습니다`,
            { type: 'success' }
        );

        return actionItems;

    } catch (err) {
        console.error('액션 아이템 추출 실패:', err);
        await docwatch.ui.showNotification(`추출 실패: ${err.message}`, { type: 'error' });
        return [];
    }
}

/**
 * 확장 비활성화
 */
function deactivate() {
    console.log('회의록 요약 확장 비활성화됨');
    docwatch = null;
}

/**
 * 이벤트 핸들러
 */
function onEvent(event, data) {
    if (event === 'meeting:created') {
        console.log('새 회의록 생성됨:', data);
        // 자동 요약 기능은 설정에 따라 활성화
    }
}

module.exports = { activate, deactivate, onEvent };
