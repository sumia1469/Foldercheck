# DocWatch 프로젝트 개발 지침

## 빌드 가이드

### Windows 빌드
```bash
npm run build:win
```

### Mac 빌드
```bash
npm run build:mac
```

## 중요 빌드 설정

### NSIS mmap 에러 해결

**문제**: `failed creating mmap of "docwatch-1.0.0-x64.nsis.7z"` 에러 발생

**원인**:
- 빌드 결과물(win-unpacked)이 2GB 이상일 때 NSIS mmap 에러 발생
- 주로 대용량 extraResources(예: ollama 5.1GB)가 포함될 때 발생

**해결 방법**:
1. `package.json`의 `extraResources`에서 대용량 폴더 제외
2. 런타임에 필요한 리소스는 별도 다운로드 로직으로 처리

**현재 설정** (`package.json`):
```json
"extraResources": [
  { "from": "bin", "to": "bin", "filter": ["**/*"] },
  { "from": "models", "to": "models", "filter": ["**/*"] }
]
```

- `resources/ollama` 폴더(5.1GB)는 extraResources에서 제외됨
- ollama는 사용자가 별도로 설치하거나 앱에서 자동 다운로드

### 빌드 전 체크리스트

1. **ollama 프로세스 종료**: 빌드 시 DLL 파일 잠금 오류 발생 가능
   ```bash
   taskkill //F //IM "ollama app.exe"
   taskkill //F //IM "ollama.exe"
   ```

2. **dist 폴더 정리**:
   ```bash
   rm -rf dist
   ```

3. **빌드 캐시 정리** (필요시):
   ```bash
   rm -rf node_modules/.cache
   rm -rf %LOCALAPPDATA%\electron-builder\Cache\nsis
   ```

## 프로젝트 구조

### 주요 파일
- `main.js` - Electron 메인 프로세스
- `preload.js` / `preload-chat.js` - 프리로드 스크립트
- `p2p-messenger.js` - P2P 메신저 및 클라우드 파일 서버
- `public/` - 렌더러 프로세스 파일들
- `public/js/chat-window.js` - 채팅 윈도우 로직

### 클라우드 파일 서버
- P2P 호스트 서버 실행 시 HTTP 파일 서버도 자동 시작
- 포트: P2P 포트 + 1 (기본 9901)
- REST API: 업로드, 다운로드, 삭제, 목록 조회

## 의존성 관리

### 개발 의존성
- electron: ^33.4.11
- electron-builder: ^24.9.1 (실제 사용 버전: 24.13.3)

### 런타임 의존성 (대용량)
- `ffmpeg-static` - asar에서 unpack 필요
- `onnxruntime-node` - AI 모델 실행

## 트러블슈팅

### DLL 파일 잠금 오류
```
remove ggml-cuda.dll: The process cannot access the file
```
- 원인: ollama 또는 관련 프로세스가 DLL 파일 사용 중
- 해결: 모든 ollama 프로세스 강제 종료 후 빌드

### electron-builder 캐시 문제
- 캐시 위치: `%LOCALAPPDATA%\electron-builder\Cache\`
- NSIS 문제 시 `nsis` 폴더 삭제 후 재빌드
