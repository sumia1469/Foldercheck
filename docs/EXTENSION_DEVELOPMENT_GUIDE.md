# DocWatch 확장 개발 가이드

## 개요

DocWatch 확장 시스템은 VSCode와 유사한 구조로 설계되어 있습니다. 확장을 통해 DocWatch의 기능을 안전하게 확장할 수 있습니다.

## 확장 구조

### 디렉토리 구조

```
my-extension/
├── package.json        # 확장 매니페스트 (필수)
├── src/
│   └── extension.js    # 메인 진입점 (필수)
├── node_modules/       # 의존성 (선택)
└── README.md          # 문서 (선택)
```

### package.json 매니페스트

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "확장 설명",
  "version": "1.0.0",
  "publisher": "author-name",
  "main": "src/extension.js",
  "engines": {
    "docwatch": "^1.0.0"
  },
  "activationEvents": [
    "onStartupFinished",
    "onCommand:myExtension.myCommand",
    "onFileChange:*.md"
  ],
  "contributes": {
    "commands": [
      {
        "command": "myExtension.myCommand",
        "title": "My Command"
      }
    ],
    "statusBar": [
      {
        "id": "myExtension.status",
        "text": "My Status",
        "tooltip": "Status tooltip"
      }
    ]
  },
  "permissions": [
    "files:read",
    "ui:notifications",
    "commands"
  ],
  "categories": ["Productivity"]
}
```

## 활성화 이벤트 (activationEvents)

| 이벤트 | 설명 | 예시 |
|--------|------|------|
| `onStartupFinished` | 앱 시작 완료 시 | `"onStartupFinished"` |
| `onCommand:*` | 특정 명령어 실행 시 | `"onCommand:myExt.run"` |
| `onFileChange:*` | 파일 변경 시 (glob 패턴) | `"onFileChange:*.md"` |
| `onMeeting:*` | 회의 이벤트 시 | `"onMeeting:created"` |
| `*` | 항상 활성화 | `"*"` |

## 권한 (permissions)

| 권한 | 설명 |
|------|------|
| `files:read` | 파일 읽기 |
| `files:write` | 파일 쓰기 |
| `fs:read` | 파일 시스템 읽기 (Node.js fs) |
| `fs:write` | 파일 시스템 쓰기 |
| `network` | HTTP/HTTPS 요청 |
| `crypto` | 암호화 모듈 |
| `ui:notifications` | 알림 표시 |
| `ui:quickPick` | 선택 다이얼로그 |
| `ui:inputBox` | 입력 다이얼로그 |
| `commands` | 명령어 등록/실행 |
| `meetings` | 회의 데이터 접근 |
| `llm` | LLM API 호출 |
| `storage` | 확장 저장소 |

## 확장 진입점 (extension.js)

```javascript
/**
 * 확장 활성화 시 호출
 * @param {Object} docwatch - DocWatch API 객체
 */
async function activate(docwatch) {
    console.log('My extension is now active!');

    // 명령어 등록
    docwatch.commands.register('myExtension.myCommand', async () => {
        docwatch.ui.showNotification('Hello from my extension!', 'info');
    });

    // 파일 변경 후크 등록
    docwatch.files.onPostChange('*.md', async (file) => {
        console.log('Markdown file changed:', file.path);
    });

    // 반환값은 다른 확장에서 접근 가능한 API
    return {
        myApi: () => 'Hello!'
    };
}

/**
 * 확장 비활성화 시 호출 (선택)
 */
function deactivate() {
    console.log('My extension is deactivated');
}

module.exports = { activate, deactivate };
```

## DocWatch API

### docwatch.files

```javascript
// 파일 목록 조회
const files = await docwatch.files.list('/path/to/dir', {
    pattern: '*.md',
    recursive: true
});

// 파일 읽기
const content = await docwatch.files.read('/path/to/file.md');

// 파일 쓰기
await docwatch.files.write('/path/to/file.md', 'content');

// 파일 변경 전 후크 (반환값으로 변경 가능)
docwatch.files.onPreChange('*.md', async (file) => {
    return { content: file.content.toUpperCase() };
});

// 파일 변경 후 후크
docwatch.files.onPostChange('*', async (file) => {
    console.log('File changed:', file.path);
});
```

### docwatch.meetings

```javascript
// 회의록 목록 조회
const meetings = await docwatch.meetings.list({ limit: 10 });

// 회의록 상세 조회
const meeting = await docwatch.meetings.get('meeting-id');

// 회의 후처리 등록
docwatch.meetings.registerPostProcessor(async (meeting) => {
    // 회의록 처리 후 추가 작업
    return {
        ...meeting,
        customField: 'added by extension'
    };
});
```

### docwatch.ui

```javascript
// 알림 표시
docwatch.ui.showNotification('message', 'info'); // info, success, warning, error

// 선택 다이얼로그
const selected = await docwatch.ui.showQuickPick([
    { label: 'Option 1', value: 'opt1' },
    { label: 'Option 2', value: 'opt2' }
], {
    placeholder: 'Select an option'
});

// 입력 다이얼로그
const input = await docwatch.ui.showInputBox({
    placeholder: 'Enter value',
    value: 'default'
});

// 상태바 아이템 업데이트
docwatch.ui.updateStatusBar('myExt.status', {
    text: 'New Status',
    tooltip: 'Updated tooltip'
});
```

### docwatch.commands

```javascript
// 명령어 등록
docwatch.commands.register('myExt.command', async (arg1, arg2) => {
    return 'result';
});

// 명령어 실행
const result = await docwatch.commands.execute('other.command', arg1, arg2);
```

### docwatch.llm

```javascript
// LLM 채팅 요청
const response = await docwatch.llm.chat([
    { role: 'user', content: 'Hello!' }
]);

// 스트리밍 응답
for await (const chunk of docwatch.llm.stream([
    { role: 'user', content: 'Tell me a story' }
])) {
    console.log(chunk);
}
```

### docwatch.storage

```javascript
// 값 저장
await docwatch.storage.set('myKey', { data: 'value' });

// 값 조회
const value = await docwatch.storage.get('myKey');

// 값 삭제
await docwatch.storage.delete('myKey');

// 모든 키 조회
const keys = await docwatch.storage.keys();
```

### docwatch.context

```javascript
// 확장 경로
console.log(docwatch.context.extensionPath);

// 확장 ID
console.log(docwatch.context.extensionId);

// 저장소 경로
console.log(docwatch.context.storagePath);
```

### docwatch.emit

```javascript
// 커스텀 이벤트 발생
docwatch.emit('myExtension:customEvent', { data: 'value' });
```

## 샌드박스 제한

확장은 Worker Thread 내에서 실행되며 다음과 같은 제한이 있습니다:

### 허용된 내장 모듈

기본 허용:
- `path`, `url`, `querystring`, `util`, `events`, `stream`, `string_decoder`

권한에 따라 추가:
- `fs:read` 또는 `fs:write` → `fs`
- `network` → `http`, `https`
- `crypto` → `crypto`

### 허용된 npm 패키지

확장 내 `node_modules`의 패키지와 다음 유틸리티 패키지:
- `lodash`, `dayjs`, `moment`, `uuid`

### 차단되는 작업

- 확장 디렉토리 외부 모듈 접근
- 프로세스 생성 (`child_process`)
- 네이티브 모듈 (`ffi`, `node-gyp` 등)

## 확장 설치 위치

### 내장 확장
```
docwatch/builtin-extensions/
└── extension-name/
```

### 사용자 확장
```
Windows: %LOCALAPPDATA%/docwatch/extensions/
macOS: ~/Library/Application Support/docwatch/extensions/
Linux: ~/.config/docwatch/extensions/
```

## 개발 팁

### 1. 로깅

```javascript
console.log('Info message');
console.warn('Warning message');
console.error('Error message');
```
→ 모든 로그는 `[Extension:확장ID]` 접두사와 함께 메인 프로세스에 전달됩니다.

### 2. 에러 처리

```javascript
try {
    await riskyOperation();
} catch (err) {
    docwatch.ui.showNotification(`Error: ${err.message}`, 'error');
}
```

### 3. 비동기 작업

```javascript
// 긴 작업은 진행 상태 표시
docwatch.ui.updateStatusBar('myExt.status', { text: '처리 중...' });
try {
    await longOperation();
} finally {
    docwatch.ui.updateStatusBar('myExt.status', { text: '완료' });
}
```

### 4. 설정 저장

```javascript
// 확장 설정 저장
await docwatch.storage.set('config', {
    option1: true,
    option2: 'value'
});

// 설정 불러오기
const config = await docwatch.storage.get('config') || {
    option1: false,
    option2: 'default'
};
```

## 예제 확장

### 회의록 요약 확장

```javascript
async function activate(docwatch) {
    docwatch.commands.register('meetingSummarizer.summarize', async () => {
        const meetings = await docwatch.meetings.list({ limit: 1 });
        if (meetings.length === 0) {
            docwatch.ui.showNotification('회의록이 없습니다', 'warning');
            return;
        }

        const meeting = await docwatch.meetings.get(meetings[0].id);
        const response = await docwatch.llm.chat([
            { role: 'user', content: `다음 회의록을 요약해주세요:\n\n${meeting.transcript}` }
        ]);

        docwatch.ui.showNotification('요약 완료!', 'success');
        return response;
    });
}

module.exports = { activate };
```

### 파일 변경 알림 확장

```javascript
async function activate(docwatch) {
    docwatch.files.onPostChange('*', async (file) => {
        docwatch.ui.showNotification(
            `파일 변경: ${file.filename}`,
            'info'
        );
    });
}

module.exports = { activate };
```

## 디버깅

1. DevTools 콘솔에서 `[Extension:확장ID]` 로그 확인
2. 메인 프로세스 로그 파일 확인 (`%APPDATA%/docwatch/logs/`)
3. 확장 활성화 실패 시 에러 메시지 확인

## 배포

1. `package.json`의 버전 업데이트
2. 불필요한 파일 제거 (`.git`, `node_modules` 등)
3. ZIP으로 압축
4. 사용자 확장 디렉토리에 압축 해제

---

## API 레퍼런스

전체 API 문서는 TypeScript 정의 파일을 참조하세요:
- `extensions/types/docwatch.d.ts` (예정)
