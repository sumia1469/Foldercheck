/**
 * Cloudflare R2에 확장 파일 업로드
 *
 * 사용법:
 *   node scripts/upload-to-r2.js
 *
 * 환경 변수 필요:
 *   R2_ACCOUNT_ID - Cloudflare 계정 ID
 *   R2_ACCESS_KEY_ID - R2 API 액세스 키
 *   R2_SECRET_ACCESS_KEY - R2 API 시크릿 키
 *   R2_BUCKET_NAME - R2 버킷 이름 (기본: docwatch)
 *   R2_PUBLIC_URL - R2 공개 URL (예: https://pub-xxx.r2.dev)
 *
 * 또는 wrangler CLI 사용:
 *   npx wrangler r2 object put docwatch/extensions/index.json --file=dist-extensions/index.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_EXTENSIONS_DIR = path.join(ROOT_DIR, 'dist-extensions');

// R2 설정 (환경 변수에서 로드)
const config = {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'docwatch',
    publicUrl: process.env.R2_PUBLIC_URL || 'https://pub-xxxxxxxx.r2.dev',
    prefix: 'extensions/' // R2 내 경로 접두사
};

/**
 * AWS Signature V4 서명 생성
 */
function signV4(method, url, headers, body, credentials) {
    const parsedUrl = new URL(url);
    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = datetime.slice(0, 8);
    const region = 'auto'; // R2는 auto 사용
    const service = 's3';

    // 표준 요청 생성
    const canonicalHeaders = Object.entries(headers)
        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(([k, v]) => `${k.toLowerCase()}:${v}`)
        .join('\n');
    const signedHeaders = Object.keys(headers)
        .map(k => k.toLowerCase())
        .sort()
        .join(';');

    const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
    const canonicalRequest = [
        method,
        parsedUrl.pathname,
        parsedUrl.search.slice(1),
        canonicalHeaders + '\n',
        signedHeaders,
        bodyHash
    ].join('\n');

    // 서명 문자열
    const scope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        datetime,
        scope,
        crypto.createHash('sha256').update(canonicalRequest).digest('hex')
    ].join('\n');

    // 서명 키 생성
    const kDate = crypto.createHmac('sha256', `AWS4${credentials.secretAccessKey}`).update(date).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    // 최종 서명
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // Authorization 헤더
    const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
        authorization,
        datetime,
        bodyHash
    };
}

/**
 * R2에 파일 업로드
 */
async function uploadToR2(filePath, key) {
    const fileContent = fs.readFileSync(filePath);
    const contentType = key.endsWith('.json') ? 'application/json' : 'application/zip';

    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    const url = `${endpoint}/${config.bucketName}/${config.prefix}${key}`;

    const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const bodyHash = crypto.createHash('sha256').update(fileContent).digest('hex');

    const headers = {
        'Host': `${config.accountId}.r2.cloudflarestorage.com`,
        'Content-Type': contentType,
        'Content-Length': fileContent.length.toString(),
        'x-amz-content-sha256': bodyHash,
        'x-amz-date': datetime
    };

    const { authorization } = signV4('PUT', url, headers, fileContent, {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
    });

    headers['Authorization'] = authorization;

    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname,
            method: 'PUT',
            headers
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ success: true, key });
                } else {
                    reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(fileContent);
        req.end();
    });
}

/**
 * wrangler CLI로 업로드 (더 간단한 방법)
 */
async function uploadWithWrangler(filePath, key) {
    const { execSync } = require('child_process');
    const objectPath = `${config.bucketName}/${config.prefix}${key}`;

    try {
        execSync(`npx wrangler r2 object put "${objectPath}" --file="${filePath}"`, {
            cwd: ROOT_DIR,
            stdio: 'inherit'
        });
        return { success: true, key };
    } catch (err) {
        throw new Error(`Wrangler upload failed: ${err.message}`);
    }
}

/**
 * 메인 실행
 */
async function main() {
    console.log('\n📦 Cloudflare R2에 확장 업로드\n');

    // dist-extensions 디렉토리 확인
    if (!fs.existsSync(DIST_EXTENSIONS_DIR)) {
        console.error('❌ dist-extensions 디렉토리가 없습니다.');
        console.log('   먼저 npm run build:extensions를 실행하세요.');
        process.exit(1);
    }

    // index.json 확인
    const indexPath = path.join(DIST_EXTENSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
        console.error('❌ index.json을 찾을 수 없습니다.');
        process.exit(1);
    }

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    console.log(`📋 ${index.extensions.length}개 확장 발견\n`);

    // 업로드할 파일 목록
    const filesToUpload = [
        { path: indexPath, key: 'index.json' }
    ];

    // 확장 ZIP 파일 추가
    for (const ext of index.extensions) {
        const zipPath = path.join(DIST_EXTENSIONS_DIR, ext.filename);
        if (fs.existsSync(zipPath)) {
            filesToUpload.push({ path: zipPath, key: ext.filename });
        } else {
            console.warn(`⚠️ 파일 없음: ${ext.filename}`);
        }
    }

    // 업로드 방식 선택
    const useWrangler = process.argv.includes('--wrangler');
    const useApi = config.accessKeyId && config.secretAccessKey && config.accountId;

    if (!useWrangler && !useApi) {
        console.log('📝 업로드 방법을 선택하세요:\n');
        console.log('1. Wrangler CLI 사용 (권장):');
        console.log('   node scripts/upload-to-r2.js --wrangler\n');
        console.log('2. API 직접 호출:');
        console.log('   환경 변수 설정 후 실행');
        console.log('   R2_ACCOUNT_ID=xxx R2_ACCESS_KEY_ID=xxx R2_SECRET_ACCESS_KEY=xxx node scripts/upload-to-r2.js\n');

        console.log('📋 업로드할 파일 목록:');
        filesToUpload.forEach(f => {
            const size = fs.statSync(f.path).size;
            console.log(`   - ${f.key} (${formatSize(size)})`);
        });

        console.log('\n💡 R2 공개 URL 설정 후 앱에서 사용:');
        console.log(`   extensionManager.setMarketplaceUrl('${config.publicUrl}/extensions');\n`);
        return;
    }

    // 업로드 실행
    console.log(`🚀 업로드 시작 (${useWrangler ? 'Wrangler' : 'API'} 사용)\n`);

    for (const file of filesToUpload) {
        try {
            console.log(`📤 업로드 중: ${file.key}`);
            if (useWrangler) {
                await uploadWithWrangler(file.path, file.key);
            } else {
                await uploadToR2(file.path, file.key);
            }
            console.log(`   ✅ 완료`);
        } catch (err) {
            console.error(`   ❌ 실패: ${err.message}`);
        }
    }

    console.log('\n✨ 업로드 완료!');
    console.log(`\n📋 마켓플레이스 URL: ${config.publicUrl}/extensions/index.json`);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

main().catch(err => {
    console.error('\n❌ 오류:', err.message);
    process.exit(1);
});
