# DocWatch 에이전트 가이드라인

## 실행 명령어

### 개발 모드
- `npm run start` - 앱 실행 (macOS)
- `npm run start:win` - 앱 실행 (Windows, UTF-8)
- `npm run start:alt` - 대체 실행 명령
- `npm run start:mac` - 앱 실행 (macOS 대체)

### 빌드
- `npm run build` - 현재 플랫폼 빌드
- `npm run build:win` - Windows 인스톨러 빌드
- `npm run build:mac` - macOS DMG/ZIP 빌드
- `npm run build:all` - 전체 플랫폼 빌드
- `npm run build:portable` - Windows 포터블 빌드

### 테스트
- `node test-simple.js` - 기본 Electron 런타임 테스트
- `node test-electron.js` - Electron 모듈 로딩 테스트
- `node test-electron-check.js` - Electron 환경 검증

## 프로젝트 구조

DocWatch는 로컬 업무 자동화를 위한 Electron 기반 데스크톱 앱입니다.

### 주요 기능
- 파일 감시 및 문서 처리
- 회의 녹취 및 요약
- 확장 시스템 (VSCode 스타일)
- P2P 메시징
- 로컬 AI 연동 (Whisper + Ollama)

### 핵심 디렉토리
- `main.js` - Electron 메인 프로세스
- `server.js` - 로컬 HTTP 서버
- `extensions/` - 확장 시스템 구현
- `bundled-extensions/` - 내장 확장
- `public/` - 프론트엔드 HTML/CSS/JS
- `docs/` - 문서 및 가이드
- `bin/` - Whisper CLI 바이너리
- `models/` - AI 모델 파일

## 코드 스타일 가이드

### JavaScript/Node.js 규칙
- ES6+ 문법 사용 (async/await, 구조분해, 화살표 함수)
- `const` 우선, `let` 차선, `var` 금지
- 세미콜론 일관성 유지
- 들여쓰기: 스페이스 2칸 (탭 금지)
- 최대 줄 길이: 120자

### import 순서
```javascript
// Node.js 코어 모듈
const fs = require('fs');
const path = require('path');

// Electron 모듈
const { app, BrowserWindow } = require('electron');

// 서드파티 의존성
const express = require('express');

// 로컬 모듈
const ExtensionManager = require('./extensions/ExtensionManager');
```

### 에러 처리
- 동기 작업: try-catch 블록 사용
- 비동기 작업: .catch() 또는 async/await + try-catch
- 에러 로그에 컨텍스트 정보 포함
- 에러 메시지는 한국어 우선, 영어 차선

### 네이밍 규칙
- **파일**: kebab-case (예: `extension-manager.js`)
- **변수**: camelCase (예: `extensionManager`)
- **클래스**: PascalCase (예: `ExtensionManager`)
- **상수**: UPPER_SNAKE_CASE (예: `DEFAULT_PORT`)
- **함수**: camelCase, 동사형 (예: `loadExtension`)

### 주석 스타일
- JSDoc 스타일 주석 사용
- 한국어 우선, 영어 차선
- 파라미터 타입 및 반환값 명시
- 복잡한 함수는 사용 예시 포함

```javascript
/**
 * 확장을 로드하고 활성화합니다
 * @param {string} extensionPath - 확장 경로
 * @param {Object} options - 로드 옵션
 * @returns {Promise<Extension>} 로드된 확장 인스턴스
 */
async function loadExtension(extensionPath, options = {}) {
    // 구현
}
```

## 확장 개발

### 확장 구조
VSCode 스타일 패턴을 따릅니다:
- `package.json` - 확장 매니페스트
- `src/extension.js` - 메인 진입점
- 매니페스트에 활성화 이벤트 정의
- 명령어, UI 요소에 대한 기여점 정의

### 확장 API
- `ExtensionAPI` 클래스로 안전한 작업 수행
- 확장 간 통신은 이벤트 발행 사용
- 라이프사이클 적절히 처리 (activate/deactivate)
- 권한 시스템을 통한 접근 제어

## 플랫폼별 고려사항

### Windows
- UTF-8 인코딩 설정: `chcp 65001`
- 경로 구분자 올바르게 처리
- 사용자 데이터: `process.env.LOCALAPPDATA`

### macOS
- 배포 시 코드 서명 사용
- 샌드박스 권한 처리
- 사용자 데이터: `process.env.HOME`

### 크로스 플랫폼
- 파일 경로: `path.join()` 사용
- 플랫폼별 코드: `process.platform` 확인
- 모든 대상 플랫폼에서 테스트

## 보안 모범 사례

- 시크릿이나 API 키 커밋 금지
- 설정은 환경 변수 사용
- 모든 사용자 입력 검증
- 디렉토리 탐색 방지를 위한 파일 경로 살균
- 프로세스 간 안전한 IPC 통신 사용

## 성능 가이드라인

- 가능하면 모듈 지연 로딩
- 대용량 파일 작업은 스트리밍 사용
- 이벤트 핸들러에서 적절한 정리 구현
- 장시간 실행 프로세스의 메모리 사용량 모니터링
- AI 모델 로딩 및 추론 최적화

## 테스트 전략

- 메인 앱 로직 전에 Electron 런타임 환경 테스트
- 확장 로딩/언로딩 검증
- 파일 감시 기능 테스트
- 크로스 플랫폼 호환성 확인
- AI 모델 연동 별도 테스트

## 공통 패턴

### 이벤트 발행
```javascript
class MyClass extends EventEmitter {
    doSomething() {
        // 상태 변경 시 이벤트 발행
        this.emit('statusChanged', { status: 'processing' });
    }
}
```

### 비동기 작업
```javascript
async function processFile(filePath) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return await processContent(content);
    } catch (error) {
        console.error(`파일 처리 실패 ${filePath}:`, error);
        throw error;
    }
}
```

### IPC 통신
```javascript
// 메인 프로세스
ipcMain.handle('get-data', async (event, arg) => {
    return await fetchData(arg);
});

// 렌더러 프로세스
const data = await ipcRenderer.invoke('get-data', param);
```

## 린팅 및 포맷팅

현재 프로젝트에는 공식 린팅 설정이 없습니다. 린팅 추가 시:
- ESLint with Electron 프리셋 고려
- Prettier로 일관된 포맷팅
- 코드 품질을 위한 pre-commit 훅 추가

## 의존성 관리

- 패키지 관리: `npm` 사용
- 성능을 위해 의존성 최소화
- 가능하면 Electron 전용 패키지 우선
- 보안을 위해 정기적으로 의존성 업데이트

## 문서화

- 한국어 문서를 기본으로 유지
- 폭넓은 채택을 위해 영어 번역 제공
- 사용자 대상 변경 시 README.md 업데이트
- 확장 API 변경 사항 철저히 문서화
