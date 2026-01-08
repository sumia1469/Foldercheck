/**
 * 확장 빌드 스크립트
 * extensions-src 폴더의 확장들을 zip으로 패키징
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const EXTENSIONS_SRC = path.join(ROOT_DIR, 'extensions-src');
const DIST_EXTENSIONS = path.join(ROOT_DIR, 'dist-extensions');

// 출력 폴더 생성
if (!fs.existsSync(DIST_EXTENSIONS)) {
    fs.mkdirSync(DIST_EXTENSIONS, { recursive: true });
}

// 확장 목록 가져오기
const extensions = fs.readdirSync(EXTENSIONS_SRC).filter(name => {
    const extPath = path.join(EXTENSIONS_SRC, name);
    return fs.statSync(extPath).isDirectory() &&
           fs.existsSync(path.join(extPath, 'manifest.json'));
});

console.log(`\n📦 확장 빌드 시작...\n`);
console.log(`발견된 확장: ${extensions.length}개\n`);

for (const extName of extensions) {
    const extPath = path.join(EXTENSIONS_SRC, extName);
    const manifestPath = path.join(extPath, 'manifest.json');

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const version = manifest.version || '1.0.0';
        const zipName = `${extName}-v${version}.zip`;
        const zipPath = path.join(DIST_EXTENSIONS, zipName);

        console.log(`📄 ${manifest.name} (${extName})`);
        console.log(`   버전: ${version}`);

        // 기존 zip 삭제
        if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }

        // zip 생성 (PowerShell 사용)
        const psCommand = `Compress-Archive -Path "${extPath}\\*" -DestinationPath "${zipPath}" -Force`;
        execSync(`powershell -Command "${psCommand}"`, { stdio: 'pipe' });

        // 파일 크기 확인
        const stats = fs.statSync(zipPath);
        const sizeKB = (stats.size / 1024).toFixed(1);

        console.log(`   ✅ 생성됨: ${zipName} (${sizeKB} KB)\n`);

        // 해시 생성 (무결성 검증용)
        const crypto = require('crypto');
        const fileBuffer = fs.readFileSync(zipPath);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        // 메타데이터 파일 생성
        const metaPath = path.join(DIST_EXTENSIONS, `${extName}-v${version}.json`);
        const metadata = {
            id: extName,
            name: manifest.name,
            version: version,
            filename: zipName,
            size: stats.size,
            sha256: hash,
            buildDate: new Date().toISOString()
        };
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

    } catch (err) {
        console.error(`   ❌ 실패: ${err.message}\n`);
    }
}

// 전체 확장 목록 인덱스 생성
const indexPath = path.join(DIST_EXTENSIONS, 'index.json');
const indexData = {
    extensions: [],
    lastUpdated: new Date().toISOString()
};

for (const extName of extensions) {
    const extPath = path.join(EXTENSIONS_SRC, extName);
    const manifestPath = path.join(extPath, 'manifest.json');

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const version = manifest.version || '1.0.0';
        const zipName = `${extName}-v${version}.zip`;
        const zipPath = path.join(DIST_EXTENSIONS, zipName);

        if (fs.existsSync(zipPath)) {
            const stats = fs.statSync(zipPath);
            const crypto = require('crypto');
            const fileBuffer = fs.readFileSync(zipPath);
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

            indexData.extensions.push({
                id: extName,
                name: manifest.name,
                version: version,
                description: manifest.description || '',
                filename: zipName,
                size: stats.size,
                sha256: hash,
                minAppVersion: manifest.minAppVersion || '1.0.0'
            });
        }
    } catch (err) {
        // 스킵
    }
}

fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
console.log(`📋 인덱스 생성됨: index.json`);
console.log(`\n✅ 확장 빌드 완료!\n`);
