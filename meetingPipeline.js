/**
 * 회의록 생성 파이프라인 v2.0
 *
 * 업계 표준 3단 구조:
 * - VAD: 언제 사람이 말했는지
 * - STT: 무슨 말을 했는지
 * - Diarization: 누가 말했는지
 *
 * CPU-Only 최적화, GPU 불필요
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ============================================================
// 설정 상수
// ============================================================

const PIPELINE_CONFIG = {
    // VAD 설정
    vad: {
        threshold: 0.5,           // 음성 감지 임계값 (0-1)
        minSpeechDuration: 0.25,  // 최소 발화 길이 (초)
        minSilenceDuration: 0.1,  // 최소 무음 길이 (초)
        padding: 0.1,             // 음성 구간 앞뒤 여백 (초)
        windowSize: 512           // 분석 윈도우 크기
    },

    // Whisper STT 설정
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

    // 화자 분리 설정
    diarization: {
        minSpeakers: 2,
        maxSpeakers: 10,
        clusteringThreshold: 0.7,
        minSegmentDuration: 0.5,
        embeddingModel: 'ecapa-tdnn'  // 또는 'resnet'
    },

    // Merge 설정
    merge: {
        iouThreshold: 0.5,        // 화자 할당 IOU 임계값
        sameSpeekerMergeGap: 3.0, // 같은 화자 병합 허용 간격 (초)
        overlapHandling: 'mark'   // 'mark', 'primary', 'both'
    },

    // 품질 설정
    quality: {
        minConfidence: 0.5,
        maxRepetition: 3,
        removeHallucination: true
    }
};

// ============================================================
// VAD (Voice Activity Detection) 모듈
// ============================================================

/**
 * Silero VAD를 사용한 음성 활동 감지
 * CPU에서 ~50x 실시간 성능
 */
class VADProcessor {
    constructor(config = PIPELINE_CONFIG.vad) {
        this.config = config;
        this.session = null;
    }

    /**
     * WAV 파일에서 음성 구간 감지
     * @param {string} wavPath - WAV 파일 경로
     * @returns {Object} VAD 결과
     */
    async process(wavPath) {
        console.log('[VAD] 음성 활동 감지 시작...');
        const startTime = Date.now();

        try {
            // WAV 파일 읽기
            const audioData = await this.readWavFile(wavPath);

            // 간단한 에너지 기반 VAD (Silero VAD 대체)
            // 실제 Silero VAD ONNX 모델은 추후 통합
            const segments = await this.detectSpeechSegments(audioData);

            const processingTime = (Date.now() - startTime) / 1000;
            const totalSpeechDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);

            console.log(`[VAD] 완료: ${segments.length}개 음성 구간 감지 (${processingTime.toFixed(1)}초)`);

            return {
                segments,
                totalSpeechDuration,
                totalSilenceRemoved: audioData.duration - totalSpeechDuration,
                processingTime,
                noiseLevel: this.estimateNoiseLevel(audioData)
            };
        } catch (error) {
            console.error('[VAD] 오류:', error.message);
            // 오류 시 전체 오디오를 하나의 세그먼트로 반환
            return {
                segments: [{ start: 0, end: Infinity, confidence: 0.5 }],
                error: error.message
            };
        }
    }

    /**
     * WAV 파일 읽기
     */
    async readWavFile(wavPath) {
        return new Promise((resolve, reject) => {
            const buffer = fs.readFileSync(wavPath);

            // WAV 헤더 파싱 (PCM 16bit, 16kHz, mono 가정)
            const sampleRate = buffer.readUInt32LE(24);
            const numChannels = buffer.readUInt16LE(22);
            const bitsPerSample = buffer.readUInt16LE(34);

            // 데이터 청크 찾기
            let dataOffset = 44; // 표준 WAV 헤더 크기
            const dataSize = buffer.length - dataOffset;
            const numSamples = dataSize / (bitsPerSample / 8) / numChannels;
            const duration = numSamples / sampleRate;

            // 오디오 샘플 추출 (정규화)
            const samples = new Float32Array(numSamples);
            for (let i = 0; i < numSamples; i++) {
                const sampleValue = buffer.readInt16LE(dataOffset + i * 2);
                samples[i] = sampleValue / 32768.0;
            }

            resolve({
                samples,
                sampleRate,
                duration,
                numChannels,
                bitsPerSample
            });
        });
    }

    /**
     * 에너지 기반 음성 구간 감지
     */
    async detectSpeechSegments(audioData) {
        const { samples, sampleRate, duration } = audioData;
        const windowSize = Math.floor(sampleRate * 0.03); // 30ms 윈도우
        const hopSize = Math.floor(windowSize / 2);

        const segments = [];
        let inSpeech = false;
        let speechStart = 0;

        // 에너지 임계값 계산 (적응형)
        const energies = [];
        for (let i = 0; i < samples.length - windowSize; i += hopSize) {
            let energy = 0;
            for (let j = 0; j < windowSize; j++) {
                energy += samples[i + j] * samples[i + j];
            }
            energies.push(Math.sqrt(energy / windowSize));
        }

        // 상위 70% 에너지를 음성으로 판단
        const sortedEnergies = [...energies].sort((a, b) => a - b);
        const threshold = sortedEnergies[Math.floor(sortedEnergies.length * 0.3)] * 2;

        for (let i = 0; i < energies.length; i++) {
            const time = (i * hopSize) / sampleRate;
            const isSpeech = energies[i] > threshold;

            if (isSpeech && !inSpeech) {
                // 음성 시작
                speechStart = Math.max(0, time - this.config.padding);
                inSpeech = true;
            } else if (!isSpeech && inSpeech) {
                // 음성 종료
                const speechEnd = time + this.config.padding;
                const speechDuration = speechEnd - speechStart;

                if (speechDuration >= this.config.minSpeechDuration) {
                    segments.push({
                        start: speechStart,
                        end: speechEnd,
                        confidence: 0.8
                    });
                }
                inSpeech = false;
            }
        }

        // 마지막 세그먼트 처리
        if (inSpeech) {
            segments.push({
                start: speechStart,
                end: duration,
                confidence: 0.8
            });
        }

        // 인접 세그먼트 병합
        return this.mergeAdjacentSegments(segments);
    }

    /**
     * 인접한 세그먼트 병합
     */
    mergeAdjacentSegments(segments) {
        if (segments.length <= 1) return segments;

        const merged = [segments[0]];

        for (let i = 1; i < segments.length; i++) {
            const prev = merged[merged.length - 1];
            const curr = segments[i];

            if (curr.start - prev.end < this.config.minSilenceDuration) {
                // 병합
                prev.end = curr.end;
                prev.confidence = (prev.confidence + curr.confidence) / 2;
            } else {
                merged.push(curr);
            }
        }

        return merged;
    }

    /**
     * 노이즈 레벨 추정
     */
    estimateNoiseLevel(audioData) {
        const { samples } = audioData;

        // 하위 10% 에너지를 노이즈로 추정
        const windowSize = 1024;
        const energies = [];

        for (let i = 0; i < samples.length - windowSize; i += windowSize) {
            let energy = 0;
            for (let j = 0; j < windowSize; j++) {
                energy += samples[i + j] * samples[i + j];
            }
            energies.push(Math.sqrt(energy / windowSize));
        }

        const sortedEnergies = [...energies].sort((a, b) => a - b);
        const noiseEnergy = sortedEnergies[Math.floor(sortedEnergies.length * 0.1)];

        if (noiseEnergy < 0.01) return 'low';
        if (noiseEnergy < 0.05) return 'medium';
        return 'high';
    }
}

// ============================================================
// 화자 분리 (Speaker Diarization) 모듈
// ============================================================

/**
 * 경량 화자 분리 모듈
 * 음성 임베딩 + Agglomerative Clustering 기반
 */
class SpeakerDiarization {
    constructor(config = PIPELINE_CONFIG.diarization) {
        this.config = config;
    }

    /**
     * 화자 분리 실행
     * @param {string} wavPath - WAV 파일 경로
     * @param {Array} vadSegments - VAD 음성 구간
     * @returns {Object} 화자 분리 결과
     */
    async process(wavPath, vadSegments) {
        console.log('[Diarization] 화자 분리 시작...');
        const startTime = Date.now();

        try {
            // 오디오 데이터 로드
            const audioData = await this.readWavFile(wavPath);

            // 각 세그먼트에서 음성 특징 추출
            const embeddings = await this.extractEmbeddings(audioData, vadSegments);

            // 클러스터링으로 화자 분리
            const speakerLabels = this.clusterSpeakers(embeddings);

            // 결과 정리
            const segments = vadSegments.map((seg, idx) => ({
                start: seg.start,
                end: seg.end,
                speaker: `SPEAKER_${String.fromCharCode(65 + speakerLabels[idx])}`,
                confidence: seg.confidence || 0.8
            }));

            // 화자별 통계
            const speakers = this.calculateSpeakerStats(segments);

            // 겹침 발화 감지
            const overlaps = this.detectOverlaps(segments);

            const processingTime = (Date.now() - startTime) / 1000;
            console.log(`[Diarization] 완료: ${speakers.length}명 화자 감지 (${processingTime.toFixed(1)}초)`);

            return {
                speakers,
                segments,
                overlaps,
                numSpeakers: speakers.length,
                processingTime
            };
        } catch (error) {
            console.error('[Diarization] 오류:', error.message);
            // 오류 시 단일 화자로 반환
            return {
                speakers: [{ id: 'SPEAKER_A', totalDuration: 0, segmentsCount: vadSegments.length }],
                segments: vadSegments.map(seg => ({ ...seg, speaker: 'SPEAKER_A' })),
                numSpeakers: 1,
                error: error.message
            };
        }
    }

    /**
     * WAV 파일 읽기
     */
    async readWavFile(wavPath) {
        return new Promise((resolve) => {
            const buffer = fs.readFileSync(wavPath);
            const sampleRate = buffer.readUInt32LE(24);
            const dataOffset = 44;
            const dataSize = buffer.length - dataOffset;
            const numSamples = dataSize / 2;

            const samples = new Float32Array(numSamples);
            for (let i = 0; i < numSamples; i++) {
                samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0;
            }

            resolve({ samples, sampleRate });
        });
    }

    /**
     * 음성 임베딩 추출 (MFCC 기반 간소화 버전)
     */
    async extractEmbeddings(audioData, segments) {
        const { samples, sampleRate } = audioData;
        const embeddings = [];

        for (const seg of segments) {
            const startSample = Math.floor(seg.start * sampleRate);
            const endSample = Math.min(Math.floor(seg.end * sampleRate), samples.length);

            if (endSample <= startSample) {
                embeddings.push(new Array(13).fill(0));
                continue;
            }

            const segmentSamples = samples.slice(startSample, endSample);

            // 간단한 MFCC 유사 특징 추출
            const features = this.extractSimpleFeatures(segmentSamples);
            embeddings.push(features);
        }

        return embeddings;
    }

    /**
     * 간단한 음성 특징 추출 (MFCC 대체)
     */
    extractSimpleFeatures(samples) {
        const frameSize = 512;
        const numFrames = Math.floor(samples.length / frameSize);

        if (numFrames === 0) {
            return new Array(13).fill(0);
        }

        const features = [];

        // 에너지
        let totalEnergy = 0;
        for (let i = 0; i < samples.length; i++) {
            totalEnergy += samples[i] * samples[i];
        }
        features.push(Math.sqrt(totalEnergy / samples.length));

        // Zero Crossing Rate
        let zcr = 0;
        for (let i = 1; i < samples.length; i++) {
            if ((samples[i] >= 0) !== (samples[i - 1] >= 0)) {
                zcr++;
            }
        }
        features.push(zcr / samples.length);

        // 스펙트럼 중심
        features.push(this.spectralCentroid(samples));

        // 프레임별 에너지 분산
        const frameEnergies = [];
        for (let i = 0; i < numFrames; i++) {
            let energy = 0;
            for (let j = 0; j < frameSize; j++) {
                energy += samples[i * frameSize + j] * samples[i * frameSize + j];
            }
            frameEnergies.push(energy / frameSize);
        }
        const meanEnergy = frameEnergies.reduce((a, b) => a + b, 0) / frameEnergies.length;
        const variance = frameEnergies.reduce((a, b) => a + (b - meanEnergy) ** 2, 0) / frameEnergies.length;
        features.push(Math.sqrt(variance));

        // 나머지 특징 (패딩)
        while (features.length < 13) {
            features.push(Math.random() * 0.1); // 약간의 노이즈 추가
        }

        return features;
    }

    /**
     * 스펙트럼 중심 계산
     */
    spectralCentroid(samples) {
        let numerator = 0;
        let denominator = 0;

        for (let i = 0; i < samples.length; i++) {
            const magnitude = Math.abs(samples[i]);
            numerator += i * magnitude;
            denominator += magnitude;
        }

        return denominator > 0 ? numerator / denominator / samples.length : 0.5;
    }

    /**
     * Agglomerative Clustering으로 화자 분리
     */
    clusterSpeakers(embeddings) {
        const n = embeddings.length;
        if (n === 0) return [];
        if (n === 1) return [0];

        // 거리 행렬 계산
        const distances = [];
        for (let i = 0; i < n; i++) {
            distances[i] = [];
            for (let j = 0; j < n; j++) {
                distances[i][j] = i === j ? 0 : this.euclideanDistance(embeddings[i], embeddings[j]);
            }
        }

        // 초기 클러스터 (각 포인트가 하나의 클러스터)
        let clusters = embeddings.map((_, i) => [i]);

        // 병합 반복
        while (clusters.length > this.config.minSpeakers) {
            let minDist = Infinity;
            let mergeI = 0, mergeJ = 1;

            // 가장 가까운 클러스터 쌍 찾기
            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const dist = this.clusterDistance(clusters[i], clusters[j], distances);
                    if (dist < minDist) {
                        minDist = dist;
                        mergeI = i;
                        mergeJ = j;
                    }
                }
            }

            // 임계값 확인
            if (minDist > this.config.clusteringThreshold && clusters.length <= this.config.maxSpeakers) {
                break;
            }

            // 클러스터 병합
            clusters[mergeI] = [...clusters[mergeI], ...clusters[mergeJ]];
            clusters.splice(mergeJ, 1);
        }

        // 레이블 할당 (발화량 기준 정렬)
        const clusterDurations = clusters.map(cluster => cluster.length);
        const sortedIndices = clusterDurations
            .map((_, i) => i)
            .sort((a, b) => clusterDurations[b] - clusterDurations[a]);

        const labels = new Array(n);
        sortedIndices.forEach((clusterIdx, newLabel) => {
            for (const pointIdx of clusters[clusterIdx]) {
                labels[pointIdx] = newLabel;
            }
        });

        return labels;
    }

    /**
     * 유클리드 거리 계산
     */
    euclideanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += (a[i] - b[i]) ** 2;
        }
        return Math.sqrt(sum);
    }

    /**
     * 클러스터 간 거리 (평균 연결)
     */
    clusterDistance(cluster1, cluster2, distances) {
        let totalDist = 0;
        for (const i of cluster1) {
            for (const j of cluster2) {
                totalDist += distances[i][j];
            }
        }
        return totalDist / (cluster1.length * cluster2.length);
    }

    /**
     * 화자별 통계 계산
     */
    calculateSpeakerStats(segments) {
        const stats = {};

        for (const seg of segments) {
            if (!stats[seg.speaker]) {
                stats[seg.speaker] = { id: seg.speaker, totalDuration: 0, segmentsCount: 0 };
            }
            stats[seg.speaker].totalDuration += seg.end - seg.start;
            stats[seg.speaker].segmentsCount++;
        }

        return Object.values(stats).sort((a, b) => b.totalDuration - a.totalDuration);
    }

    /**
     * 겹침 발화 감지
     */
    detectOverlaps(segments) {
        const overlaps = [];

        for (let i = 0; i < segments.length; i++) {
            for (let j = i + 1; j < segments.length; j++) {
                const overlap = this.getOverlap(segments[i], segments[j]);
                if (overlap > 0) {
                    overlaps.push({
                        segment1: i,
                        segment2: j,
                        speakers: [segments[i].speaker, segments[j].speaker],
                        start: Math.max(segments[i].start, segments[j].start),
                        end: Math.min(segments[i].end, segments[j].end),
                        duration: overlap
                    });
                }
            }
        }

        return overlaps;
    }

    /**
     * 두 세그먼트의 겹침 시간 계산
     */
    getOverlap(seg1, seg2) {
        const overlapStart = Math.max(seg1.start, seg2.start);
        const overlapEnd = Math.min(seg1.end, seg2.end);
        return Math.max(0, overlapEnd - overlapStart);
    }
}

// ============================================================
// STT-Diarization Merge 모듈
// ============================================================

/**
 * STT 결과와 화자 분리 결과를 시간축 기반으로 병합
 */
class TranscriptMerger {
    constructor(config = PIPELINE_CONFIG.merge) {
        this.config = config;
    }

    /**
     * STT와 Diarization 결과 병합
     * @param {Array} sttSegments - STT 결과 (text + timestamps)
     * @param {Array} diarizationSegments - 화자 분리 결과 (speaker + timestamps)
     * @returns {Object} 병합된 회의록
     */
    merge(sttSegments, diarizationSegments) {
        console.log('[Merge] STT-Diarization 병합 시작...');
        const startTime = Date.now();

        const mergedTranscript = [];

        for (let i = 0; i < sttSegments.length; i++) {
            const sttSeg = sttSegments[i];

            // 해당 STT 세그먼트와 가장 많이 겹치는 화자 찾기
            const speaker = this.findBestSpeaker(sttSeg, diarizationSegments);

            // 겹침 발화 확인
            const isOverlap = this.checkOverlap(sttSeg, diarizationSegments);

            // 타임스탬프 포맷
            const timestamp = this.formatTimestamp(sttSeg.start);

            mergedTranscript.push({
                id: i,
                speaker,
                start: sttSeg.start,
                end: sttSeg.end,
                text: sttSeg.text,
                timestamp,
                confidence: sttSeg.confidence || 0.8,
                overlap: isOverlap
            });
        }

        // 같은 화자의 연속 발화 병합
        const consolidated = this.consolidateSameSpeaker(mergedTranscript);

        // 통계 계산
        const statistics = this.calculateStatistics(consolidated, diarizationSegments);

        const processingTime = (Date.now() - startTime) / 1000;
        console.log(`[Merge] 완료: ${consolidated.length}개 발화 (${processingTime.toFixed(1)}초)`);

        return {
            mergedTranscript: consolidated,
            statistics,
            processingTime
        };
    }

    /**
     * STT 세그먼트와 가장 많이 겹치는 화자 찾기
     */
    findBestSpeaker(sttSeg, diarizationSegments) {
        let bestSpeaker = 'SPEAKER_A';
        let maxOverlap = 0;

        for (const diaSeg of diarizationSegments) {
            const overlap = this.calculateIOU(sttSeg, diaSeg);
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestSpeaker = diaSeg.speaker;
            }
        }

        return bestSpeaker;
    }

    /**
     * IOU (Intersection over Union) 계산
     */
    calculateIOU(seg1, seg2) {
        const overlapStart = Math.max(seg1.start, seg2.start);
        const overlapEnd = Math.min(seg1.end, seg2.end);
        const intersection = Math.max(0, overlapEnd - overlapStart);

        const union = (seg1.end - seg1.start) + (seg2.end - seg2.start) - intersection;

        return union > 0 ? intersection / union : 0;
    }

    /**
     * 겹침 발화 확인
     */
    checkOverlap(sttSeg, diarizationSegments) {
        const overlappingSpeakers = new Set();

        for (const diaSeg of diarizationSegments) {
            if (this.calculateIOU(sttSeg, diaSeg) > 0.1) {
                overlappingSpeakers.add(diaSeg.speaker);
            }
        }

        return overlappingSpeakers.size > 1;
    }

    /**
     * 타임스탬프 포맷
     */
    formatTimestamp(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `[${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
    }

    /**
     * 같은 화자의 연속 발화 병합
     */
    consolidateSameSpeaker(transcript) {
        if (transcript.length === 0) return [];

        const consolidated = [{ ...transcript[0] }];

        for (let i = 1; i < transcript.length; i++) {
            const prev = consolidated[consolidated.length - 1];
            const curr = transcript[i];

            // 같은 화자이고, 간격이 허용 범위 내이면 병합
            if (prev.speaker === curr.speaker &&
                curr.start - prev.end < this.config.sameSpeekerMergeGap &&
                !curr.overlap) {
                prev.end = curr.end;
                prev.text = `${prev.text} ${curr.text}`;
                prev.confidence = (prev.confidence + curr.confidence) / 2;
            } else {
                consolidated.push({ ...curr, id: consolidated.length });
            }
        }

        return consolidated;
    }

    /**
     * 통계 계산
     */
    calculateStatistics(transcript, diarizationSegments) {
        const speakerDistribution = {};
        let totalDuration = 0;
        let overlapCount = 0;

        for (const seg of transcript) {
            const duration = seg.end - seg.start;
            totalDuration += duration;

            if (!speakerDistribution[seg.speaker]) {
                speakerDistribution[seg.speaker] = 0;
            }
            speakerDistribution[seg.speaker] += duration;

            if (seg.overlap) overlapCount++;
        }

        // 비율로 변환
        for (const speaker in speakerDistribution) {
            speakerDistribution[speaker] = parseFloat((speakerDistribution[speaker] / totalDuration).toFixed(2));
        }

        return {
            totalUtterances: transcript.length,
            speakerDistribution,
            overlapCount,
            averageUtteranceLength: totalDuration / transcript.length
        };
    }
}

// ============================================================
// 회의록 구조화 모듈
// ============================================================

/**
 * 병합된 텍스트를 구조화된 회의록으로 변환
 */
class TranscriptStructurer {
    constructor() {
        this.speakerNames = {};  // 화자 이름 매핑
    }

    /**
     * 회의록 구조화
     * @param {Object} mergedResult - Merge 결과
     * @returns {string} 구조화된 회의록 텍스트
     */
    structure(mergedResult) {
        const { mergedTranscript, statistics } = mergedResult;

        let output = '';
        output += '========================================\n';
        output += '              회 의 록\n';
        output += '========================================\n\n';

        // 화자 정보
        output += '▣ 참석자 (발언량 기준)\n';
        const speakers = Object.entries(statistics.speakerDistribution)
            .sort(([, a], [, b]) => b - a);
        for (const [speaker, ratio] of speakers) {
            const displayName = this.speakerNames[speaker] || speaker;
            output += `   - ${displayName}: ${(ratio * 100).toFixed(1)}%\n`;
        }
        output += '\n';

        // 회의 내용
        output += '▣ 회의 내용\n';
        output += '----------------------------------------\n\n';

        let currentSpeaker = null;

        for (const seg of mergedTranscript) {
            const displayName = this.speakerNames[seg.speaker] || seg.speaker;

            if (seg.speaker !== currentSpeaker) {
                if (currentSpeaker !== null) output += '\n';
                output += `${seg.timestamp} ${displayName}:\n`;
                currentSpeaker = seg.speaker;
            }

            // 겹침 발화 표시
            const overlapMark = seg.overlap ? '(겹침) ' : '';
            output += `${overlapMark}${seg.text}\n`;
        }

        output += '\n========================================\n';

        return output;
    }

    /**
     * JSON 형식으로 출력
     */
    toJSON(mergedResult) {
        return {
            metadata: {
                generatedAt: new Date().toISOString(),
                totalUtterances: mergedResult.statistics.totalUtterances,
                speakerDistribution: mergedResult.statistics.speakerDistribution,
                overlapCount: mergedResult.statistics.overlapCount
            },
            transcript: mergedResult.mergedTranscript.map(seg => ({
                timestamp: seg.timestamp,
                speaker: this.speakerNames[seg.speaker] || seg.speaker,
                text: seg.text,
                start: seg.start,
                end: seg.end,
                overlap: seg.overlap
            }))
        };
    }

    /**
     * 화자 이름 설정
     */
    setSpeakerName(speakerId, name) {
        this.speakerNames[speakerId] = name;
    }
}

// ============================================================
// 메인 파이프라인 클래스
// ============================================================

/**
 * 회의록 생성 파이프라인
 * Audio → VAD → STT → Diarization → Merge → Structure → LLM Summary
 */
class MeetingPipeline {
    constructor(options = {}) {
        this.vad = new VADProcessor(options.vad || PIPELINE_CONFIG.vad);
        this.diarization = new SpeakerDiarization(options.diarization || PIPELINE_CONFIG.diarization);
        this.merger = new TranscriptMerger(options.merge || PIPELINE_CONFIG.merge);
        this.structurer = new TranscriptStructurer();

        this.progressCallback = options.onProgress || (() => {});
    }

    /**
     * 전체 파이프라인 실행
     * @param {string} audioPath - 오디오 파일 경로
     * @param {Object} options - 옵션
     * @returns {Object} 파이프라인 결과
     */
    async process(audioPath, options = {}) {
        console.log('\n========================================');
        console.log('[Pipeline] 회의록 파이프라인 시작');
        console.log(`[Pipeline] 입력: ${audioPath}`);
        console.log('========================================\n');

        const results = {
            audioPath,
            stages: {},
            startTime: Date.now()
        };

        try {
            // Stage 1: VAD (음성 활동 감지)
            this.progressCallback('VAD 전처리', 10, '음성 구간 감지 중...');
            results.stages.vad = await this.vad.process(audioPath);

            // Stage 2: Diarization (화자 분리)
            this.progressCallback('화자 분리', 25, '화자 구분 중...');
            results.stages.diarization = await this.diarization.process(
                audioPath,
                results.stages.vad.segments
            );

            // Stage 3: Merge (결과 병합) - STT 결과는 외부에서 주입
            // STT는 기존 transcribeAudio() 함수 사용
            // 여기서는 Diarization 결과만 반환

            results.processingTime = (Date.now() - results.startTime) / 1000;

            console.log('\n========================================');
            console.log(`[Pipeline] 완료 (${results.processingTime.toFixed(1)}초)`);
            console.log('========================================\n');

            return results;

        } catch (error) {
            console.error('[Pipeline] 오류:', error);
            results.error = error.message;
            return results;
        }
    }

    /**
     * STT 결과와 병합
     * @param {Array} sttSegments - STT 결과
     * @param {Object} pipelineResult - 파이프라인 결과 (VAD + Diarization)
     * @returns {Object} 최종 회의록
     */
    mergeWithSTT(sttSegments, pipelineResult) {
        this.progressCallback('결과 병합', 80, 'STT와 화자 정보 병합 중...');

        const diarizationSegments = pipelineResult.stages.diarization?.segments || [];

        // Merge
        const mergeResult = this.merger.merge(sttSegments, diarizationSegments);

        // Structure
        const structuredText = this.structurer.structure(mergeResult);
        const structuredJSON = this.structurer.toJSON(mergeResult);

        return {
            text: structuredText,
            json: structuredJSON,
            mergeResult
        };
    }
}

// ============================================================
// 모듈 내보내기
// ============================================================

module.exports = {
    MeetingPipeline,
    VADProcessor,
    SpeakerDiarization,
    TranscriptMerger,
    TranscriptStructurer,
    PIPELINE_CONFIG
};
