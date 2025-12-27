# DocWatch MVP 개발 가이드 (핵심 요약)

## 제품 정체성
- **DocWatch**: 기획자·PM·업무 담당자를 위한 로컬 기반 업무 자동화 도구
- **유료 B2B 소프트웨어** (무료 유틸리티 ❌)
- **폐쇄망 지원**: 공공기관 / 금융 / 망분리 환경

## CORE 필수 기능 (7개)
1. 폴더 감시 (파일 생성·수정·삭제 감지, ON/OFF)
2. 알림 시스템 (데스크톱 알림 + 조건 설정)
3. 알림 클릭 시 파일/폴더 열기
4. 외부 알림 (텔레그램 1종)
5. 문서 변경 요약 (PPTX)
6. 회의록 초안 생성 (로컬 STT → 규칙 기반 요약 → DOCX)
7. 로컬 우선 처리 (인터넷 없이 동작)

## 기술 스택
- Desktop: Electron 28+
- 파일 감시: chokidar (fs.watch에서 전환 필요)
- 로컬 DB: SQLite (JSON에서 전환 필요)
- STT: whisper.cpp (MIT 라이선스)
- 문서 생성: docxtemplater

## 금지 표현
- ❌ "AI 기반", "AI 요약", "AI 회의록"
- ❌ "무료", "Free" (Trial만 허용)
- ✅ "자동 회의록 초안 생성"
- ✅ "로컬 음성 인식"

## 라이선스 고지 (필수)
```
본 제품은 MIT 라이선스 기반 오픈소스 Whisper 엔진을
로컬 환경에서 실행하며 음성 데이터는 외부로 전송되지 않습니다.
```

## 절대 만들지 말 것
- 다크/캐릭터/동물 모드
- SNS / 커뮤니티
- 투두·캘린더 풀세트
- 모바일 앱
- 피그마 연동
- 대규모 AI 기능

## 현재 구현 상태
- [x] 폴더 감시 기본 기능
- [x] 데스크톱 알림
- [x] 텔레그램 알림
- [x] 회의록 UI 및 API 구조
- [x] 규칙 기반 분석 로직
- [ ] whisper.cpp 실제 바인딩
- [ ] PPTX 변경 요약
- [ ] DOCX 템플릿 (docxtemplater)
- [ ] 알림 클릭 시 파일 열기
- [ ] SQLite 전환

## 주요 파일 위치
- 메인 프로세스: main.js
- 서버: server.js
- UI: public/index.html, public/js/common.js
- 스타일: public/css/style.css
- 가이드: DOCWATCH_MVP_GUIDE.md
