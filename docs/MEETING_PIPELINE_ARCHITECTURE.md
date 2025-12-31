# 회의록 생성 파이프라인 아키텍처 설계

> **개발 가이드 문서**: 이 문서는 DocWatch 회의록 생성 시스템의 아키텍처를 설명합니다.
> 개발 시 지속적으로 참고하세요.

## 변경 이력
| 날짜 | 버전 | 변경 내용 |
|------|------|----------|
| 2024-12-31 | v2.1 | Gap 분석 및 고도화 로드맵 상세화 |
| 2024-12-30 | v2.0 | 화자 분리 파이프라인 추가, LLM 7B 업그레이드 |

---

## 1. 업계 표준 3단 구조 (필수 준수)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        책임 분리형 3단 구조                                  │
│                        (업계 표준 아키텍처)                                  │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌──────────────────┐
   │  VAD (전처리)     │  → "언제" 사람이 말했는지
   │  Voice Activity   │     - 음성 구간 감지
   │  Detection        │     - 무음 제거
   └────────┬─────────┘
            │
   ┌────────▼─────────┐
   │  STT (Whisper)    │  → "무슨 말"을 했는지
   │  Speech to Text   │     - 음성 → 텍스트
   │                   │     - 타임스탬프 포함
   └────────┬─────────┘
            │
   ┌────────▼─────────┐
   │  Diarization      │  → "누가" 말했는지
   │  Speaker          │     - 화자 A/B/C 구분
   │  Identification   │     - 클러스터링 기반
   └────────┬─────────┘
            │
   ┌────────▼─────────┐
   │  Merge & 구조화   │  → 최종 회의록 생성
   │  Time-aligned     │     - 시간축 정렬
   │  Integration      │     - 화자별 발언 매핑
   └──────────────────┘
```

**⚠️ 중요**: 이 세 단계는 서로 다른 역할을 가지며 **절대 하나의 모델로 통합하지 않는다**.

---

## 2. 전체 파이프라인 개요

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        회의록 생성 파이프라인 v2.0                            │
│                      (CPU-Only, GPU 불필요)                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ Audio In │ → │   VAD    │ → │   STT    │ → │ Diarize  │ → │  Merge   │
│ (Raw)    │   │ 전처리   │   │ (Whisper)│   │ (화자)   │   │ (시간축) │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
                                                                  │
                    ┌─────────────────────────────────────────────┘
                    ▼
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│ 구조화    │ → │ LLM 요약 │ → │ 액션아이템│ → │ 최종출력 │
│ (회의록)  │   │ (Qwen7B) │   │ 추출     │   │ (문서)   │
└──────────┘   └──────────┘   └──────────┘   └──────────┘
```

---

## 3. 단계별 상세 설계

### 3.1 Stage 1: Audio Input (오디오 입력)

| 항목 | 설명 |
|------|------|
| 입력 포맷 | WAV, M4A, MP3, WebM, OGG |
| 출력 포맷 | WAV (16kHz, mono, PCM 16bit) |
| 처리 도구 | FFmpeg |
| 처리 시간 | ~실시간 (1분 오디오 → ~5초) |

```javascript
// 입력
{ audioPath: "meeting.m4a", format: "m4a", duration: 3600 }

// 출력
{ wavPath: "meeting_16k.wav", sampleRate: 16000, channels: 1, bitDepth: 16 }
```

---

### 3.2 Stage 2: VAD + 전처리 (Voice Activity Detection)

| 항목 | 현재 구현 | 목표 구현 |
|------|----------|----------|
| 역할 | 언제 사람이 말했는지 감지 | 동일 |
| 도구 | 에너지 기반 VAD (자체 구현) | **Silero VAD (ONNX)** |
| CPU 성능 | ~10x 실시간 | ~50x 실시간 |
| 정확도 | 중 | 높음 |

**핵심 기능:**
1. ✅ 음성 구간 감지 (Speech Segments)
2. ✅ 무음 구간 제거
3. ✅ 노이즈 레벨 추정
4. ✅ 인접 세그먼트 병합

**VAD 설정:**
```javascript
const VAD_CONFIG = {
    threshold: 0.5,           // 음성 감지 임계값 (0-1)
    minSpeechDuration: 0.25,  // 최소 발화 길이 (초)
    minSilenceDuration: 0.1,  // 최소 무음 길이 (초)
    padding: 0.1,             // 음성 구간 앞뒤 여백 (초)
    windowSize: 512           // 분석 윈도우 크기
};
```

**VAD 출력 JSON:**
```javascript
{
  "segments": [
    { "start": 0.0, "end": 5.2, "confidence": 0.95 },
    { "start": 6.1, "end": 12.8, "confidence": 0.92 }
  ],
  "totalSpeechDuration": 23.4,
  "totalSilenceRemoved": 36.6,
  "noiseLevel": "low"  // low | medium | high
}
```

---

### 3.3 Stage 3: STT (Speech-to-Text)

| 항목 | 설명 |
|------|------|
| 역할 | 무슨 말을 했는지 변환 |
| 도구 | Whisper.cpp (small 모델) |
| CPU 성능 | ~1-2x 실시간 (1분 오디오 → 30초~2분) |
| 메모리 | ~1.5GB (small 모델) |

**Whisper 최적화 옵션 (현재 적용됨):**
```javascript
const WHISPER_CONFIG = {
    model: 'ggml-small.bin',    // small 모델 (466MB)
    language: 'ko',              // 한국어 고정
    beamSize: 5,                 // CPU 최적 빔 크기
    wordTimestamps: true,        // 단어별 타임스탬프
    vadFilter: true,             // 내장 VAD 활성화
    entropyThreshold: 2.4,       // 품질 임계값
    noSpeechThreshold: 0.6,      // 무음 임계값
    temperature: 0               // 결정적 출력
};
```

**STT 출력 JSON:**
```javascript
{
  "transcription": [
    {
      "id": 0,
      "start": 0,
      "end": 5,
      "text": "오늘 회의는 프로젝트 진행 상황을 점검하겠습니다",
      "confidence": 0.9
    }
  ],
  "language": "ko",
  "duration": 3600.0
}
```

---

### 3.4 Stage 4: Speaker Diarization (화자 분리)

| 항목 | 현재 구현 | 목표 구현 |
|------|----------|----------|
| 역할 | 누가 말했는지 구분 | 동일 |
| 임베딩 | 간단한 음성 특징 (에너지, ZCR, 스펙트럼 중심) | **ECAPA-TDNN (ONNX)** |
| 클러스터링 | ✅ Agglomerative Clustering | 동일 |
| 정확도 | 중 (동일 인물도 분리될 수 있음) | 높음 |

**화자 분리 프로세스:**
```
┌─────────────────────────────────────────────────────────┐
│ 1. 음성 임베딩 추출 (Speaker Embedding)                  │
│    - 현재: 간단한 음성 특징 (에너지, ZCR 등)             │
│    - 목표: ECAPA-TDNN 192차원 벡터                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 2. Agglomerative Clustering (✅ 구현됨)                 │
│    - 유사한 음성 벡터 그룹화                             │
│    - 자동 화자 수 추정 (2-10명)                          │
│    - clusteringThreshold: 0.7                           │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 3. 화자 레이블 할당 (✅ 구현됨)                          │
│    - 발화량 기준 정렬 (가장 많이 말한 사람 = SPEAKER_A)  │
└─────────────────────────────────────────────────────────┘
```

**화자 분리 설정:**
```javascript
const DIARIZATION_CONFIG = {
    minSpeakers: 2,
    maxSpeakers: 10,
    clusteringThreshold: 0.7,
    minSegmentDuration: 0.5,
    embeddingModel: 'ecapa-tdnn'  // 목표
};
```

**화자 분리 출력 JSON:**
```javascript
{
  "speakers": [
    { "id": "SPEAKER_A", "totalDuration": 1200.5, "segmentsCount": 45 },
    { "id": "SPEAKER_B", "totalDuration": 890.2, "segmentsCount": 38 }
  ],
  "segments": [
    { "start": 0.0, "end": 5.2, "speaker": "SPEAKER_A", "confidence": 0.89 },
    { "start": 6.1, "end": 12.8, "speaker": "SPEAKER_B", "confidence": 0.92 }
  ],
  "overlaps": [
    { "start": 17.8, "end": 18.5, "speakers": ["SPEAKER_A", "SPEAKER_C"], "duration": 0.7 }
  ],
  "numSpeakers": 3
}
```

---

### 3.5 Stage 5: Merge (시간축 기반 병합)

| 항목 | 설명 |
|------|------|
| 역할 | STT + Diarization 결과 통합 |
| 처리 방식 | 시간축 정렬 + IOU 기반 화자 할당 |
| 처리 시간 | ~즉시 (CPU 연산만) |

**병합 알고리즘 (✅ 구현됨):**
```
┌─────────────────────────────────────────────────────────┐
│ 1. 시간축 정렬                                          │
│    - STT 세그먼트와 화자 세그먼트를 시간순 정렬          │
│    - 겹치는 구간 계산 (IOU: Intersection over Union)    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 2. 화자 할당 규칙                                       │
│    - IOU > 0.5: 해당 화자 할당                          │
│    - IOU < 0.5: 가장 가까운 화자 세그먼트 사용          │
│    - 겹침 발화: overlap: true 표시                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ 3. 문장 병합/분리                                       │
│    - 같은 화자의 연속 발화: 하나로 병합                  │
│    - 화자 전환: 새 문장으로 분리                         │
│    - 3초 이상 간격: 별도 발화로 처리                     │
└─────────────────────────────────────────────────────────┘
```

**Merge 설정:**
```javascript
const MERGE_CONFIG = {
    iouThreshold: 0.5,          // 화자 할당 IOU 임계값
    sameSpeekerMergeGap: 3.0,   // 같은 화자 병합 허용 간격 (초)
    overlapHandling: 'mark'     // 'mark', 'primary', 'both'
};
```

**Merge 출력 JSON:**
```javascript
{
  "mergedTranscript": [
    {
      "id": 0,
      "speaker": "SPEAKER_A",
      "start": 0.0,
      "end": 5.2,
      "text": "오늘 회의는 프로젝트 진행 상황을 점검하겠습니다",
      "timestamp": "[00:00]",
      "confidence": 0.9,
      "overlap": false
    }
  ],
  "statistics": {
    "totalUtterances": 45,
    "speakerDistribution": { "SPEAKER_A": 0.45, "SPEAKER_B": 0.35, "SPEAKER_C": 0.20 },
    "overlapCount": 3,
    "averageUtteranceLength": 4.2
  }
}
```

---

### 3.6 Stage 6: 회의록 구조화

**구조화된 회의록 출력 (✅ 구현됨):**
```
========================================
              회 의 록
========================================

▣ 참석자 (발언량 기준)
   - SPEAKER_A: 45.0%
   - SPEAKER_B: 35.0%
   - SPEAKER_C: 20.0%

▣ 회의 내용
----------------------------------------

[00:00] SPEAKER_A:
오늘 회의는 프로젝트 진행 상황을 점검하겠습니다.

[00:06] SPEAKER_B:
네, 현재 개발 진행률은 약 70% 정도입니다.

[00:17] SPEAKER_C:
(겹침) 테스트 관련해서 말씀드릴게요...

========================================
```

---

### 3.7 Stage 7: LLM 요약 및 액션 아이템 추출

**LLM 모델 (✅ 변경됨):**

| 항목 | 기존 (qwen2.5:3b) | 변경 (qwen2.5:7b-instruct-q4_K_M) |
|------|------------------|----------------------------------|
| 파라미터 | 3B | 7B |
| 양자화 | FP16 | Q4_K_M |
| 크기 | 1.9GB | ~4.5GB |
| RAM 요구 | 4GB | 8GB |
| 품질 | 기본 | 고품질 (한국어 최적화) |

**LLM 프롬프트 (✅ 화자 구분 포함):**
```javascript
const LLM_PROMPT = `[절대 규칙]
- 반드시 한국어로만 작성
- 제공된 녹취록 내용만 사용
- 녹취록에 없는 내용 추가 금지
- 화자별 발언 구분 유지 (SPEAKER_A, SPEAKER_B 등)

[회의록 형식]
1. 회의 개요
   - 회의명:
   - 일시:
   - 참석자: (화자별 역할 추정)
   - 회의 목적:

2. 안건 및 논의 내용
   ▶ 현황
   ▶ 논의 내용 (화자별 발언 정리)
   ▶ 제안/대안

3. 주요 수치 및 데이터

4. 결정 사항

5. 액션 아이템 (담당자, 할일, 기한)
   - [담당자] 할일 - 기한

6. 향후 계획

7. 특이사항`;
```

---

## 4. 구현 현황 vs 목표 (Gap 분석)

### 4.1 구현 완료 항목 ✅

| 구성요소 | 파일 | 상태 | 설명 |
|----------|------|------|------|
| VAD 모듈 | meetingPipeline.js | ✅ | 에너지 기반 음성 구간 감지 |
| 화자 분리 | meetingPipeline.js | ✅ | 클러스터링 기반 화자 구분 |
| STT-Diarization Merge | meetingPipeline.js | ✅ | 시간축 기반 병합 (IOU) |
| 회의록 구조화 | meetingPipeline.js | ✅ | 화자별 발언 포맷팅 |
| LLM 7B | server.js | ✅ | qwen2.5:7b-instruct-q4_K_M |
| 액션 아이템 | server.js | ✅ | LLM 프롬프트에 포함 |
| server.js 통합 | server.js | ✅ | transcribeAudio()에서 파이프라인 호출 |

### 4.2 개선 필요 항목 (Gap)

| 항목 | 현재 | 목표 | 우선순위 | 난이도 |
|------|------|------|----------|--------|
| VAD 모델 | 에너지 기반 (자체) | Silero VAD (ONNX) | 높음 | 중 |
| 화자 임베딩 | 간단한 특징 (4개) | ECAPA-TDNN (192차원) | 높음 | 높음 |
| 노이즈 제거 | 없음 | RNNoise | 중 | 중 |
| 병렬 처리 | 순차 처리 | 청크 병렬화 | 중 | 중 |
| 품질 검증 | 기본 | 환각 감지/반복 제거 | 중 | 낮음 |

---

## 5. CPU 환경 최적화 전략

### 5.1 처리 시간 트레이드오프

| 단계 | 빠름 (품질↓) | 균형 (현재) | 정확 (품질↑) |
|------|-------------|------------|-------------|
| VAD | threshold=0.3 | **threshold=0.5** | threshold=0.7 |
| Whisper | tiny 모델 | **small 모델** | medium 모델 |
| Diarization | 고정 화자 수 | **자동 (2-10명)** | pyannote |
| LLM | qwen2.5:3b | **qwen2.5:7b-q4** | qwen2.5:7b-q8 |

### 5.2 예상 처리 시간 (1시간 회의 기준)

| 단계 | CPU (i5-10세대) | CPU (i7-12세대) |
|------|-----------------|-----------------|
| 오디오 변환 | 10초 | 5초 |
| VAD 전처리 | 30초 | 15초 |
| Whisper STT | 30분 | 15분 |
| 화자 분리 | 5분 | 2분 |
| Merge | 1초 | 1초 |
| LLM 요약 | 5분 | 2분 |
| **총합** | **~40분** | **~20분** |

### 5.3 병렬 처리 전략 (향후 구현)

```
┌─────────────────────────────────────────────────────────┐
│ 오디오를 10분 단위 청크로 분할                           │
└─────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
    ┌────────┐    ┌────────┐    ┌────────┐
    │ 청크 1  │    │ 청크 2  │    │ 청크 3  │
    │ (VAD)  │    │ (VAD)  │    │ (VAD)  │
    └────────┘    └────────┘    └────────┘
         │              │              │
         ▼              ▼              ▼
    ┌────────┐    ┌────────┐    ┌────────┐
    │ 청크 1  │    │ 청크 2  │    │ 청크 3  │
    │ (STT)  │    │ (STT)  │    │ (STT)  │
    └────────┘    └────────┘    └────────┘
         │              │              │
         └──────────────┼──────────────┘
                        ▼
              ┌────────────────┐
              │ 화자 분리 (전체) │  ← 전체 오디오 필요
              └────────────────┘
                        │
                        ▼
              ┌────────────────┐
              │ Merge & 구조화  │
              └────────────────┘
```

---

## 6. 에러/예외 처리 전략

### 6.1 잡음이 심한 회의

```javascript
const NOISE_HANDLING = {
    // VAD 민감도 조정
    highNoiseVadThreshold: 0.7,

    // Whisper 옵션 조정
    whisperOptions: {
        no_speech_threshold: 0.8,
        compression_ratio_threshold: 2.0
    },

    // 후처리
    postProcess: {
        removeShortUtterances: true,  // 0.5초 미만 제거
        minConfidence: 0.6
    }
};
```

### 6.2 화자 수 증가 (5명 이상)

```javascript
const MANY_SPEAKERS_HANDLING = {
    clustering: {
        min_clusters: 2,
        max_clusters: 10,
        threshold: 0.7  // 더 엄격한 분리
    },
    prioritize: {
        byDuration: true,
        topSpeakers: 5  // 상위 5명만 구분
    }
};
```

### 6.3 STT 오류 누적 방지

```javascript
const STT_ERROR_PREVENTION = {
    chunkProcessing: {
        size: 600,    // 10분 청크
        overlap: 30   // 30초 오버랩
    },
    qualityCheck: {
        minConfidence: 0.5,
        maxRepetition: 3,
        removeHallucination: true
    }
};
```

---

## 7. MVP → 고도화 로드맵

### Phase 1: 기본 회의록 ✅ 완료
- [x] Whisper STT (타임스탬프)
- [x] 기본 AI 요약
- [x] VAD 전처리 추가

### Phase 2: 화자 중심 회의록 ✅ 완료 (v2.0)
- [x] 화자 분리 (Speaker Diarization)
- [x] STT-Diarization Merge
- [x] 화자별 발언 구조화
- [x] LLM 7B 업그레이드

### Phase 3: 화자 분리 고도화 🔄 진행 예정
- [ ] **Silero VAD ONNX 통합** (정확도 향상)
- [ ] **ECAPA-TDNN 화자 임베딩** (화자 구분 정확도)
- [ ] **RNNoise 노이즈 제거** (전처리 품질)
- [ ] 청크 병렬 처리

### Phase 4: 고급 분석 ⏳ 예정
- [ ] 결정 사항 하이라이트
- [ ] 회의 키워드 분석
- [ ] 발언 하이라이트 (타임스탬프 클릭 → 재생)
- [ ] 회의 통계 대시보드

---

## 8. 구현 파일 구조

```
docwatch/
├── server.js                    # 메인 서버 (API 엔드포인트)
│   ├── transcribeAudio()        # Whisper STT + 화자분리 통합
│   ├── summarizeWithOllama()    # LLM 요약 (Qwen 2.5 7B Q4)
│   └── summarizeChunk()         # 청크별 요약 + 액션아이템
│
├── meetingPipeline.js           # 회의록 파이프라인 모듈 (v2.0)
│   ├── MeetingPipeline          # 메인 파이프라인 클래스
│   ├── VADProcessor             # 음성 활동 감지
│   ├── SpeakerDiarization       # 화자 분리
│   ├── TranscriptMerger         # STT-Diarization 병합
│   └── TranscriptStructurer     # 회의록 구조화
│
├── package.json                 # 의존성 (onnxruntime-node, wav-decoder)
│
└── docs/
    └── MEETING_PIPELINE_ARCHITECTURE.md  # 이 문서
```

---

## 9. 빌드 및 테스트

### 의존성 설치
```bash
npm install
```

### Ollama 모델 설치 (최초 1회)
```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
```

### 개발 실행
```bash
npm start
```

### 프로덕션 빌드
```bash
npm run build:win
```

---

## 10. 핵심 설정 참조

### PIPELINE_CONFIG (meetingPipeline.js)
```javascript
const PIPELINE_CONFIG = {
    vad: {
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.1,
        padding: 0.1,
        windowSize: 512
    },
    stt: {
        model: 'ggml-small.bin',
        language: 'ko',
        beamSize: 5,
        wordTimestamps: true,
        vadFilter: true,
        entropyThreshold: 2.4,
        noSpeechThreshold: 0.6,
        temperature: 0
    },
    diarization: {
        minSpeakers: 2,
        maxSpeakers: 10,
        clusteringThreshold: 0.7,
        minSegmentDuration: 0.5,
        embeddingModel: 'ecapa-tdnn'
    },
    merge: {
        iouThreshold: 0.5,
        sameSpeekerMergeGap: 3.0,
        overlapHandling: 'mark'
    },
    quality: {
        minConfidence: 0.5,
        maxRepetition: 3,
        removeHallucination: true
    }
};
```

### AVAILABLE_MODELS (server.js)
```javascript
const AVAILABLE_MODELS = {
    'qwen2.5:7b-instruct-q4_K_M': {
        name: 'Qwen 2.5 (7B Q4)',
        description: '고품질 AI 모델 - 한국어 최적화 (4.5GB, 8GB RAM 이상 권장)',
        size: '4.5GB',
        type: 'local',
        recommended: true
    },
    'qwen2.5:3b': {
        name: 'Qwen 2.5 (3B)',
        description: '경량 AI 모델 - 저사양 PC 호환 (1.9GB, 4GB RAM 이상)',
        size: '1.9GB',
        type: 'local'
    }
};
```
