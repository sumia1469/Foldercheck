# DocWatch 트러블슈팅 가이드

## 목차
1. [Electron 앱 실행 오류](#1-electron-앱-실행-오류)
2. [Node.js 버전 관련 문제](#2-nodejs-버전-관련-문제)
3. [일반적인 해결 방법](#3-일반적인-해결-방법)

---

## 1. Electron 앱 실행 오류

### 증상
```
TypeError: Cannot read properties of undefined (reading 'requestSingleInstanceLock')
    at Object.<anonymous> (/path/to/main.js:121:24)
```

또는 `require('electron')`이 모듈 객체 대신 문자열 경로를 반환하는 경우.

### 원인
시스템에 설치된 Node.js 버전(예: v24)이 Electron의 내부 Node.js 버전(v20)과 충돌하여 모듈 해석이 잘못됨.

### 진단 방법

#### 1) Node.js 버전 확인
```bash
node --version
```
v24 이상이면 충돌 가능성이 높음.

#### 2) Electron 모듈 테스트
```bash
# 프로젝트 디렉토리에서 실행
cat > test-electron.js << 'EOF'
const electron = require('electron');
console.log('electron type:', typeof electron);
console.log('app exists:', !!electron.app);
EOF

./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron test-electron.js
```

**정상**: `electron type: object`, `app exists: true`
**비정상**: `electron type: string` (경로 문자열 반환)

#### 3) process.type 확인
```bash
cat > test-process.js << 'EOF'
console.log('process.type:', process.type);
EOF

./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

**정상**: `process.type: browser`
**비정상**: `process.type: undefined`

### 해결 방법

#### 방법 1: 깨끗한 환경으로 실행 (권장)

`start-app.sh` 스크립트 생성:
```bash
#!/bin/bash
cd "$(dirname "$0")"
exec env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

`package.json` 수정:
```json
{
  "scripts": {
    "start": "./start-app.sh"
  }
}
```

#### 방법 2: fnm으로 Node.js 버전 관리

```bash
# fnm 설치 (macOS)
brew install fnm

# Node.js 20 설치
fnm install 20
fnm use 20

# 확인
node --version  # v20.x.x

# node_modules 재설치
rm -rf node_modules package-lock.json
npm install
```

#### 방법 3: nvm 사용

```bash
# nvm 설치
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Node.js 20 설치 및 사용
nvm install 20
nvm use 20

# 프로젝트에 고정
echo "20" > .nvmrc
```

---

## 2. Node.js 버전 관련 문제

### Electron과 Node.js 호환성

| Electron 버전 | 내장 Node.js | 권장 시스템 Node.js |
|--------------|-------------|-------------------|
| 33.x         | v20.18.3    | v20.x             |
| 32.x         | v20.x       | v20.x             |
| 31.x         | v20.x       | v20.x             |
| 28-30.x      | v18.x       | v18.x - v20.x     |

### 현재 설치된 Electron 버전 확인
```bash
cat node_modules/electron/package.json | grep '"version"'
```

### 현재 Electron의 Node.js 버전 확인
```bash
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e "console.log(process.versions.node)"
```

---

## 3. 일반적인 해결 방법

### node_modules 완전 재설치
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

### Electron만 재설치
```bash
rm -rf node_modules/electron ~/.electron ~/.cache/electron
npm install electron@33.4.11 --save-dev
```

### macOS Quarantine 속성 제거
```bash
xattr -cr node_modules/electron/dist/Electron.app
```

### 직접 Electron 바이너리로 실행
```bash
# npm start 대신 직접 실행
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

### 환경 변수 초기화 실행
```bash
env -i HOME="$HOME" USER="$USER" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

---

## 빠른 체크리스트

문제 발생 시 순서대로 확인:

- [ ] `node --version` → v20.x 권장
- [ ] `npm ls electron` → 버전 확인
- [ ] `rm -rf node_modules && npm install` → 재설치
- [ ] `xattr -cr node_modules/electron/dist/Electron.app` → 권한 해제
- [ ] `./start-app.sh` 또는 `env -i` 사용 → 깨끗한 환경 실행

---

## 참고 사항

### 왜 이 문제가 발생하나요?

1. **모듈 해석 충돌**: `node_modules/electron/index.js`는 Electron CLI용으로, 실행 파일 경로를 반환합니다. Electron 내부에서 실행될 때는 이 파일이 아닌 Electron의 내장 모듈이 로드되어야 합니다.

2. **환경 변수 상속**: npm 스크립트는 시스템의 PATH를 상속받습니다. 시스템 Node.js가 Electron의 모듈 해석보다 먼저 개입하면 문제가 발생합니다.

3. **Node.js v24+**: 최신 Node.js 버전은 모듈 로딩 방식이 변경되어 Electron과 호환성 문제가 발생할 수 있습니다.

### 관련 파일

- `main.js` - Electron 메인 프로세스 진입점
- `package.json` - `main` 필드가 `main.js`를 가리켜야 함
- `start-app.sh` - 깨끗한 환경에서 Electron 실행
- `node_modules/electron/` - Electron 패키지

---

*마지막 업데이트: 2024년 12월*
