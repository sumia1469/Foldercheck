/**
 * DocWatch License Module
 *
 * 라이선스 관리 모듈 - Trial 14일, 온라인/오프라인 활성화 지원
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const http = require('http');
const https = require('https');
const dgram = require('dgram');

// 설정
const LICENSE_FILE = path.join(__dirname, 'data', 'license.json');
const TRIAL_DAYS = 14;
const LICENSE_SERVER = 'https://license.docwatch.io'; // 실제 라이선스 서버 URL로 변경 필요

// NTP 서버 목록 (시간 검증용)
const NTP_SERVERS = [
    'time.google.com',
    'time.windows.com',
    'pool.ntp.org',
    'time.apple.com'
];

// 마지막으로 검증된 시간 (오프라인 시 사용)
let lastVerifiedTime = null;
let lastVerifiedAt = null;

// 공개키 (오프라인 검증용) - 실제 배포 시 서버에서 생성한 공개키로 교체
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWy
Sample_Public_Key_Replace_With_Real_One_Before_Production
GwIDAQAB
-----END PUBLIC KEY-----`;

// 기본 라이선스 구조
const DEFAULT_LICENSE = {
    type: 'trial',
    machineId: null,
    activatedAt: null,
    expiresAt: null,
    licenseKey: null,
    features: {
        documentMonitoring: true,
        meetingTranscription: true,
        aiSummary: true
    },
    signature: null
};

/**
 * NTP 서버에서 현재 시간 가져오기
 * 로컬 시계 조작 방지를 위해 네트워크 시간 사용
 */
async function getNTPTime(server = 'time.google.com', timeout = 3000) {
    return new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        const ntpData = Buffer.alloc(48);
        ntpData[0] = 0x1B; // NTP request header

        const timer = setTimeout(() => {
            client.close();
            reject(new Error('NTP timeout'));
        }, timeout);

        client.on('error', (err) => {
            clearTimeout(timer);
            client.close();
            reject(err);
        });

        client.on('message', (msg) => {
            clearTimeout(timer);
            client.close();

            // NTP 응답에서 시간 추출
            const intPart = msg.readUInt32BE(40);
            const fracPart = msg.readUInt32BE(44);
            // NTP epoch (1900-01-01)에서 Unix epoch (1970-01-01)로 변환
            const ntpTime = new Date((intPart - 2208988800) * 1000 + (fracPart / 4294967296) * 1000);
            resolve(ntpTime);
        });

        client.send(ntpData, 0, ntpData.length, 123, server, (err) => {
            if (err) {
                clearTimeout(timer);
                client.close();
                reject(err);
            }
        });
    });
}

/**
 * 신뢰할 수 있는 현재 시간 가져오기
 * NTP 서버 실패 시 로컬 시간 + 마지막 검증 시간으로 보정
 */
async function getTrustedTime() {
    // NTP 서버들에서 시간 가져오기 시도
    for (const server of NTP_SERVERS) {
        try {
            const ntpTime = await getNTPTime(server, 3000);
            lastVerifiedTime = ntpTime;
            lastVerifiedAt = Date.now();
            return ntpTime;
        } catch (e) {
            // 다음 서버 시도
            continue;
        }
    }

    // 모든 NTP 서버 실패 시
    if (lastVerifiedTime && lastVerifiedAt) {
        // 마지막 검증된 시간 + 경과 시간으로 추정
        const elapsed = Date.now() - lastVerifiedAt;
        const estimatedTime = new Date(lastVerifiedTime.getTime() + elapsed);

        // 로컬 시간과 추정 시간 비교 (1시간 이상 차이나면 조작 의심)
        const localTime = new Date();
        const diff = Math.abs(localTime - estimatedTime);
        if (diff > 60 * 60 * 1000) {
            console.warn('[License] 시간 조작 의심: 로컬 시간과 추정 시간 차이가 큼');
            return estimatedTime; // 추정 시간 사용
        }
    }

    // 폴백: 로컬 시간 사용 (오프라인 + 첫 실행)
    return new Date();
}

/**
 * 시간 조작 감지
 * 라이선스 저장 시 마지막 확인 시간 기록하여 역행 감지
 */
function detectTimeManipulation(license) {
    if (!license || !license.lastCheckedAt) return false;

    const lastChecked = new Date(license.lastCheckedAt);
    const now = new Date();

    // 현재 시간이 마지막 확인 시간보다 이전이면 조작 의심
    if (now < lastChecked) {
        console.warn('[License] 시간 역행 감지: 시스템 시간이 과거로 변경됨');
        return true;
    }

    return false;
}

/**
 * 기기 고유 ID 생성
 * 하드웨어 정보 조합으로 고유 식별자 생성
 */
function generateMachineId() {
    const components = [
        os.hostname(),
        os.platform(),
        os.arch(),
        os.cpus()[0]?.model || 'unknown',
        os.totalmem().toString()
    ].filter(Boolean).join('|');

    return crypto.createHash('sha256')
        .update(components)
        .digest('hex')
        .substring(0, 32)
        .toUpperCase();
}

/**
 * 라이선스 파일 로드
 */
function loadLicense() {
    try {
        // data 디렉토리 확인
        const dataDir = path.dirname(LICENSE_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(LICENSE_FILE)) {
            const data = fs.readFileSync(LICENSE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('라이선스 파일 로드 실패:', e.message);
    }
    return null;
}

/**
 * 라이선스 파일 저장
 */
function saveLicense(license) {
    try {
        const dataDir = path.dirname(LICENSE_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('라이선스 파일 저장 실패:', e.message);
        return false;
    }
}

/**
 * Trial 라이선스 초기화
 */
function initializeTrial() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const license = {
        ...DEFAULT_LICENSE,
        type: 'trial',
        machineId: generateMachineId(),
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        features: {
            documentMonitoring: true,
            meetingTranscription: true,
            aiSummary: true
        }
    };

    saveLicense(license);
    return license;
}

/**
 * 라이선스 상태 확인 (동기 버전 - 로컬 시간 사용)
 */
function getLicenseStatus() {
    let license = loadLicense();

    // 라이선스가 없으면 Trial 초기화
    if (!license) {
        license = initializeTrial();
    }

    // 시간 역행 감지 (로컬 시계가 과거로 변경된 경우)
    const timeManipulated = detectTimeManipulation(license);

    const now = new Date();
    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : null;
    let isExpired = expiresAt ? now > expiresAt : false;

    // 시간 조작 감지 시 만료 처리
    if (timeManipulated) {
        isExpired = true;
    }

    // 마지막 확인 시간 업데이트
    license.lastCheckedAt = now.toISOString();
    saveLicense(license);

    // Trial 만료 시 기능 제한
    let features = { ...license.features };
    if ((license.type === 'trial' && isExpired) || timeManipulated) {
        features = {
            documentMonitoring: false,
            meetingTranscription: false,
            aiSummary: false
        };
    }

    // 남은 일수 계산
    let daysRemaining = 0;
    if (expiresAt && !isExpired) {
        daysRemaining = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
    }

    return {
        type: license.type,
        machineId: license.machineId || generateMachineId(),
        isValid: !isExpired && !timeManipulated,
        isExpired,
        isTrial: license.type === 'trial',
        isPro: license.type === 'pro',
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt,
        daysRemaining,
        features,
        timeManipulated
    };
}

/**
 * 라이선스 상태 확인 (비동기 버전 - NTP 시간 검증)
 * 정확한 시간 검증이 필요한 경우 사용
 */
async function getLicenseStatusAsync() {
    let license = loadLicense();

    // 라이선스가 없으면 Trial 초기화
    if (!license) {
        license = initializeTrial();
    }

    // NTP 서버에서 신뢰할 수 있는 시간 가져오기
    let now;
    let ntpVerified = false;
    try {
        now = await getTrustedTime();
        ntpVerified = true;
    } catch (e) {
        now = new Date();
    }

    // 시간 역행 감지
    const timeManipulated = detectTimeManipulation(license);

    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : null;
    let isExpired = expiresAt ? now > expiresAt : false;

    // 시간 조작 감지 시 만료 처리
    if (timeManipulated) {
        isExpired = true;
    }

    // 마지막 확인 시간 업데이트
    license.lastCheckedAt = now.toISOString();
    if (ntpVerified) {
        license.lastNtpVerifiedAt = now.toISOString();
    }
    saveLicense(license);

    // Trial/Free 만료 시 기능 제한
    let features = { ...license.features };
    if ((license.type === 'trial' && isExpired) || timeManipulated) {
        features = {
            documentMonitoring: false,
            meetingTranscription: false,
            aiSummary: false
        };
    }

    // 남은 일수 계산
    let daysRemaining = 0;
    if (expiresAt && !isExpired) {
        daysRemaining = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
    }

    return {
        type: license.type,
        machineId: license.machineId || generateMachineId(),
        isValid: !isExpired && !timeManipulated,
        isExpired,
        isTrial: license.type === 'trial',
        isPro: license.type === 'pro',
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt,
        daysRemaining,
        features,
        timeManipulated,
        ntpVerified
    };
}

/**
 * Pro 기능 사용 가능 여부 확인
 */
function canUseFeature(featureName) {
    const status = getLicenseStatus();
    return status.features[featureName] === true;
}

/**
 * 온라인 라이선스 활성화
 */
async function activateOnline(licenseKey) {
    return new Promise((resolve, reject) => {
        const machineId = generateMachineId();

        const postData = JSON.stringify({
            licenseKey,
            machineId,
            product: 'docwatch',
            version: '1.0.0'
        });

        // URL 파싱
        const url = new URL(`${LICENSE_SERVER}/api/activate`);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 10000
        };

        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);

                    if (result.success && result.license) {
                        // 서버에서 받은 라이선스 저장
                        const license = {
                            type: 'pro',
                            machineId,
                            licenseKey,
                            activatedAt: new Date().toISOString(),
                            expiresAt: result.license.expiresAt,
                            features: result.license.features || {
                                documentMonitoring: true,
                                meetingTranscription: true,
                                aiSummary: true
                            },
                            signature: result.license.signature
                        };

                        saveLicense(license);
                        resolve({ success: true, license: getLicenseStatus() });
                    } else {
                        reject(new Error(result.error || '라이선스 활성화 실패'));
                    }
                } catch (e) {
                    reject(new Error('서버 응답 파싱 오류'));
                }
            });
        });

        req.on('error', (e) => {
            // 네트워크 오류 - 오프라인 활성화 안내
            reject(new Error(`서버 연결 실패: ${e.message}. 오프라인 활성화를 시도해주세요.`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('서버 연결 시간 초과. 오프라인 활성화를 시도해주세요.'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * 오프라인 라이선스 키 검증 및 활성화
 *
 * 오프라인 키 형식: BASE64({
 *   machineId: string,
 *   licenseType: 'pro',
 *   expiresAt: ISO date string,
 *   features: object,
 *   signature: string (HMAC-SHA256)
 * })
 */
function activateOffline(offlineKey) {
    try {
        // Base64 디코딩
        const decoded = JSON.parse(Buffer.from(offlineKey, 'base64').toString('utf8'));

        const currentMachineId = generateMachineId();

        // 1. 기기 ID 확인
        if (decoded.machineId !== currentMachineId) {
            return {
                success: false,
                error: '이 라이선스 키는 다른 기기용입니다.',
                expectedMachineId: decoded.machineId,
                currentMachineId
            };
        }

        // 2. 만료일 확인
        const expiresAt = new Date(decoded.expiresAt);
        if (expiresAt < new Date()) {
            return {
                success: false,
                error: '라이선스가 만료되었습니다.',
                expiresAt: decoded.expiresAt
            };
        }

        // 3. 서명 검증 (실제 구현 시 RSA/ECDSA 검증)
        // 참고: 실제 배포 시에는 crypto.verify()로 서명 검증 필요
        if (!decoded.signature) {
            return {
                success: false,
                error: '유효하지 않은 라이선스 키입니다.'
            };
        }

        // 4. 라이선스 저장
        const license = {
            type: 'pro',
            machineId: currentMachineId,
            licenseKey: offlineKey.substring(0, 20) + '...', // 일부만 저장
            activatedAt: new Date().toISOString(),
            expiresAt: decoded.expiresAt,
            features: decoded.features || {
                documentMonitoring: true,
                meetingTranscription: true,
                aiSummary: true
            },
            signature: decoded.signature,
            offlineActivated: true
        };

        saveLicense(license);

        return {
            success: true,
            license: getLicenseStatus()
        };

    } catch (e) {
        return {
            success: false,
            error: '라이선스 키 형식이 올바르지 않습니다: ' + e.message
        };
    }
}

/**
 * 라이선스 비활성화 (개발/테스트용)
 */
function deactivateLicense() {
    try {
        if (fs.existsSync(LICENSE_FILE)) {
            fs.unlinkSync(LICENSE_FILE);
        }
        return { success: true, message: '라이선스가 비활성화되었습니다.' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Trial 리셋 (개발/테스트용)
 */
function resetTrial() {
    const license = initializeTrial();
    return {
        success: true,
        message: 'Trial이 리셋되었습니다.',
        license: getLicenseStatus()
    };
}

/**
 * Pro/Trial 토글 (개발/테스트용)
 * 현재 라이선스 타입을 반대로 전환
 */
function toggleLicenseType() {
    let license = loadLicense();

    if (!license) {
        license = initializeTrial();
    }

    const now = new Date();

    if (license.type === 'pro') {
        // Pro → Trial로 전환
        const expiresAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        license.type = 'trial';
        license.expiresAt = expiresAt.toISOString();
        license.licenseKey = null;
        license.signature = null;
        license.testLicense = false;
        saveLicense(license);

        return {
            success: true,
            newType: 'Trial',
            message: 'Trial 모드로 전환되었습니다.',
            license: getLicenseStatus()
        };
    } else if (license.type === 'trial') {
        // Trial → Free로 전환 (제한 버전)
        license.type = 'free';
        license.expiresAt = null;  // 만료 없음 (제한된 기능)
        license.licenseKey = null;
        license.signature = null;
        license.testLicense = false;
        license.features = {
            documentMonitoring: true,  // 기본 모니터링만 가능
            meetingTranscription: false,  // 회의록 변환 불가
            aiSummary: false  // AI 요약 불가
        };
        saveLicense(license);

        return {
            success: true,
            newType: 'Free',
            message: 'Free 모드로 전환되었습니다. (제한된 기능)',
            license: getLicenseStatus()
        };
    } else {
        // Free → Pro로 전환 (3개월 테스트)
        const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        license.type = 'pro';
        license.expiresAt = expiresAt.toISOString();
        license.licenseKey = 'ADMIN-TOGGLE-' + Date.now();
        license.signature = 'admin-signature';
        license.testLicense = true;
        license.features = {
            documentMonitoring: true,
            meetingTranscription: true,
            aiSummary: true
        };
        saveLicense(license);

        return {
            success: true,
            newType: 'Pro',
            message: 'Pro 모드로 전환되었습니다.',
            license: getLicenseStatus()
        };
    }
}

/**
 * 테스트 라이선스 활성화 (개발/테스트용)
 * 지정된 개월 수 또는 일수만큼 Pro 라이선스 활성화
 * @param {number} months - 개월 수 (기본 3개월)
 * @param {number} days - 일수 (지정 시 months 무시)
 */
function activateTestLicense(months = 3, days = null) {
    const now = new Date();
    let expiresAt;
    let durationDesc;

    if (days !== null && days > 0) {
        // 일 단위 라이선스
        expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        durationDesc = `${days}일`;
    } else {
        // 월 단위 라이선스
        expiresAt = new Date(now.getTime() + months * 30 * 24 * 60 * 60 * 1000);
        durationDesc = `${months}개월`;
    }

    const license = {
        type: 'pro',
        machineId: generateMachineId(),
        licenseKey: 'TEST-LICENSE-' + Date.now(),
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        features: {
            documentMonitoring: true,
            meetingTranscription: true,
            aiSummary: true
        },
        signature: 'test-signature',
        testLicense: true,
        testDuration: durationDesc
    };

    saveLicense(license);

    return {
        success: true,
        message: `${durationDesc} 테스트 라이선스가 활성화되었습니다.`,
        license: getLicenseStatus()
    };
}

/**
 * 오프라인 라이선스 키 생성 (관리자용)
 * 실제 운영에서는 서버에서만 생성해야 함
 */
function generateOfflineKey(machineId, expiresAt, secretKey) {
    const data = {
        machineId,
        licenseType: 'pro',
        expiresAt: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
        features: {
            documentMonitoring: true,
            meetingTranscription: true,
            aiSummary: true
        },
        issuedAt: new Date().toISOString()
    };

    // HMAC-SHA256 서명 생성
    const dataString = JSON.stringify(data);
    const signature = crypto.createHmac('sha256', secretKey)
        .update(dataString)
        .digest('hex');

    data.signature = signature;

    // Base64 인코딩
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

// 모듈 내보내기
module.exports = {
    generateMachineId,
    getLicenseStatus,
    getLicenseStatusAsync,
    getTrustedTime,
    canUseFeature,
    activateOnline,
    activateOffline,
    deactivateLicense,
    resetTrial,
    toggleLicenseType,
    activateTestLicense,
    generateOfflineKey,
    TRIAL_DAYS
};
