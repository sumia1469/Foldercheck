# DocWatch - 문서 모니터링 및 회의록 자동화 도구

> 로컬 환경에서 동작하는 문서 변경 감시 및 회의 녹음/전사 자동화 솔루션

## 개요

DocWatch는 Electron 기반의 데스크톱 애플리케이션으로, 문서 파일의 변경사항을 실시간으로 모니터링하고 회의 녹음을 자동으로 텍스트로 변환하는 기능을 제공합니다. 모든 AI 처리가 로컬에서 이루어져 데이터 보안과 프라이버시를 보장합니다.

## 주요 기능

### 1. 문서 모니터링 (Pro)
- **실시간 파일 감시**: chokidar를 이용한 폴더 모니터링
- **다양한 포맷 지원**: DOCX, XLSX, PPTX, PDF, TXT 등
- **변경사항 분석**: 파일 해시 비교를 통한 변경 감지
- **AI 변경 요약**: Ollama/TinyLlama를 통한 자동 요약

### 2. 회의 녹음 및 전사 (Pro)
- **브라우저 기반 녹음**: MediaRecorder API 활용
- **로컬 음성 인식**: Whisper (whisper-cli) 기반 STT
- **회의록 자동 생성**: 원본 전사 + AI 요약 분리 제공
- **녹음 파일 관리**: 다운로드, 삭제, 재전사 기능

### 3. AI 요약 기능 (Pro)
- **완전 로컬 처리**: Ollama + TinyLlama (~637MB)
- **다양한 요약 유형**: 회의록, 문서 변경사항
- **CPU 호환**: GPU 없이도 동작 가능

### 4. 기본 기능 (Trial/Free)
- 폴더 감시 설정
- 파일 변경 로그 확인
- 시스템 트레이 지원

## 라이선스 모델

### Trial (14일 무료 체험)
- 설치 후 14일간 모든 Pro 기능 사용 가능
- 체험 기간 종료 후 기본 기능만 사용 가능

### Pro (구독)
- 모든 기능 무제한 사용
- AI 문서 요약
- 회의 녹음 및 전사
- 우선 기술 지원

### 활성화 방식
- **온라인 환경**: 라이선스 서버를 통한 자동 활성화
- **폐쇄망 환경**: 오프라인 라이선스 키 입력

## 기술 스택

### Frontend
- **HTML/CSS/JavaScript**: 순수 웹 기술
- **Web Audio API**: 음성 녹음
- **Fetch API**: 서버 통신

### Backend
- **Node.js**: 서버 런타임
- **Electron**: 데스크톱 앱 프레임워크
- **Express-style routing**: HTTP 서버

### AI/ML
- **Whisper (whisper-cpp)**: 로컬 음성 인식
  - 모델: ggml-small.bin
  - 한국어 지원 (-l ko)
- **Ollama + TinyLlama**: 로컬 LLM
  - 텍스트 요약
  - 변경사항 분석

### 문서 처리
- **mammoth**: DOCX 파싱
- **xlsx**: Excel 파일 처리
- **pptx-parser**: PowerPoint 분석
- **pdf-parse**: PDF 텍스트 추출

### 유틸리티
- **chokidar**: 파일 시스템 감시
- **fluent-ffmpeg**: 오디오 변환
- **crypto**: 파일 해시 계산

## 프로젝트 구조

```
docwatch/
├── main.js              # Electron 메인 프로세스
├── preload.js           # 프리로드 스크립트
├── server.js            # HTTP 서버 (API + 정적 파일)
├── package.json         # 프로젝트 설정
├── public/              # 프론트엔드 파일
│   ├── index.html       # 메인 UI
│   ├── css/
│   │   └── style.css    # 스타일시트
│   └── js/
│       └── common.js    # 클라이언트 로직
├── models/              # AI 모델 파일
│   └── ggml-small.bin   # Whisper 모델
├── meetings/            # 회의 녹음/전사 저장
├── data/                # 설정 및 데이터
│   ├── settings.json    # 사용자 설정
│   ├── meetings.json    # 회의록 데이터
│   └── license.json     # 라이선스 정보
└── dist/                # 빌드 출력
```

## API 엔드포인트

### 설정 관리
| 엔드포인트 | 메소드 | 설명 |
|-----------|--------|------|
| `/api/settings` | GET | 설정 조회 |
| `/api/settings` | POST | 설정 저장 |
| `/api/folders` | POST | 감시 폴더 추가 |
| `/api/folders` | DELETE | 감시 폴더 삭제 |

### 문서 분석 (Pro)
| 엔드포인트 | 메소드 | 설명 |
|-----------|--------|------|
| `/api/analyze` | POST | 문서 분석 (AI 요약 포함) |
| `/api/changes` | GET | 변경 이력 조회 |

### 회의 관리 (Pro)
| 엔드포인트 | 메소드 | 설명 |
|-----------|--------|------|
| `/api/meetings` | GET | 회의록 목록 |
| `/api/meetings` | POST | 회의 저장 |
| `/api/meetings/:id` | DELETE | 회의 삭제 |
| `/api/recordings` | GET | 녹음 파일 목록 |
| `/api/recording/transcribe` | POST | 녹음 파일 전사 |
| `/api/recording/:filename` | DELETE | 녹음 파일 삭제 |

### 녹음/전사 (Pro)
| 엔드포인트 | 메소드 | 설명 |
|-----------|--------|------|
| `/api/upload-audio` | POST | 오디오 업로드 |
| `/api/transcribe` | POST | 음성 전사 (Whisper) |
| `/api/summarize` | POST | AI 요약 생성 |

### 시스템
| 엔드포인트 | 메소드 | 설명 |
|-----------|--------|------|
| `/api/whisper-status` | GET | Whisper 상태 확인 |
| `/api/ollama-status` | GET | Ollama 상태 확인 |
| `/api/license` | GET | 라이선스 상태 확인 |
| `/api/license/activate` | POST | 라이선스 활성화 |

## 설치 및 실행

### 사전 요구사항

#### macOS
```bash
# Homebrew를 통한 whisper-cpp 설치
brew install whisper-cpp

# Ollama 설치
brew install ollama
ollama pull tinyllama

# FFmpeg 설치
brew install ffmpeg
```

#### Windows
```bash
# Chocolatey를 통한 설치
choco install ffmpeg

# Whisper 및 Ollama는 별도 설치 필요
```

### 프로젝트 설치
```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm start

# 프로덕션 빌드
npm run build:mac    # macOS
npm run build        # Windows
```

### Whisper 모델 설정
```bash
# 모델 디렉토리 생성
mkdir -p models

# Small 모델 다운로드 (권장)
curl -L -o models/ggml-small.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

## 설정 파일 구조

### settings.json
```json
{
  "folders": [
    {
      "id": "unique-id",
      "path": "/path/to/watch",
      "enabled": true,
      "name": "폴더명"
    }
  ],
  "whisperModel": "small",
  "language": "ko"
}
```

### meetings.json
```json
{
  "meetings": [
    {
      "id": "meeting-id",
      "title": "회의 제목",
      "date": "2025-12-28",
      "duration": 180,
      "originalTranscript": "원본 전사 텍스트",
      "aiSummary": "AI 요약 내용",
      "audioFile": "audio_xxx.webm"
    }
  ]
}
```

### license.json
```json
{
  "type": "trial",
  "activatedAt": "2025-12-28T00:00:00Z",
  "expiresAt": "2025-01-11T00:00:00Z",
  "licenseKey": null,
  "features": {
    "documentMonitoring": true,
    "meetingTranscription": true,
    "aiSummary": true
  }
}
```

## SaaS 전환 로드맵

### Phase 1: 라이선스 시스템 구현
- Trial 14일 자동 만료
- 온라인/오프라인 라이선스 활성화
- 기능별 접근 제어

### Phase 2: 아키텍처 변경
1. **서버 분리**: Electron → 웹 서버 + 클라이언트
2. **인증 시스템**: JWT/OAuth 기반 사용자 인증
3. **데이터베이스**: JSON → PostgreSQL/MongoDB
4. **파일 스토리지**: 로컬 → S3/GCS

### Phase 3: AI 처리 옵션
1. **클라우드 API**: OpenAI Whisper API, GPT-4
2. **하이브리드**: 로컬 처리 + 클라우드 폴백
3. **전용 서버**: GPU 서버에서 Whisper/LLM 호스팅

### Phase 4: 확장 기능
- 팀 협업 기능
- 실시간 동기화
- 버전 관리 시스템
- 알림 시스템 (이메일, Slack)
- 대시보드 및 분석

### 보안 강화
- E2E 암호화
- 접근 제어 (RBAC)
- 감사 로그
- 데이터 백업/복구

## 주의사항

- 네트워크 드라이브 감시는 지원되지 않을 수 있습니다
- 대용량 폴더 감시 시 시스템 리소스 사용량이 증가할 수 있습니다
- 포트 4400을 사용합니다 (충돌 시 자동으로 기존 프로세스 종료)
- Pro 기능은 유효한 라이선스가 필요합니다

## 라이선스

상용 소프트웨어 - All Rights Reserved

## 기여 및 지원

기술 지원 및 문의: [지원 이메일]
