const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { default: pngToIco } = require('png-to-ico');

const SVG_PATH = path.join(__dirname, '../public/assets/images/logo.svg');
const BUILD_ICONS_DIR = path.join(__dirname, '../build/icons');
const ICONSET_DIR = path.join(__dirname, '../build/icon.iconset');

// Mac 앱 아이콘에 필요한 크기들
const ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

// Windows ICO에 필요한 크기들
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

// iconset에 필요한 크기들 (Mac)
const ICONSET_SIZES = [
    { size: 16, suffix: '16x16' },
    { size: 32, suffix: '16x16@2x' },
    { size: 32, suffix: '32x32' },
    { size: 64, suffix: '32x32@2x' },
    { size: 128, suffix: '128x128' },
    { size: 256, suffix: '128x128@2x' },
    { size: 256, suffix: '256x256' },
    { size: 512, suffix: '256x256@2x' },
    { size: 512, suffix: '512x512' },
    { size: 1024, suffix: '512x512@2x' }
];

async function generateIcons() {
    console.log('아이콘 생성 시작...');

    // 디렉토리 생성
    if (!fs.existsSync(BUILD_ICONS_DIR)) {
        fs.mkdirSync(BUILD_ICONS_DIR, { recursive: true });
    }
    if (!fs.existsSync(ICONSET_DIR)) {
        fs.mkdirSync(ICONSET_DIR, { recursive: true });
    }

    // SVG 파일 읽기
    const svgBuffer = fs.readFileSync(SVG_PATH);

    // 일반 아이콘 생성
    console.log('PNG 아이콘 생성 중...');
    for (const size of ICON_SIZES) {
        const outputPath = path.join(BUILD_ICONS_DIR, `icon-${size}.png`);
        await sharp(svgBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputPath);
        console.log(`  생성됨: icon-${size}.png`);
    }

    // 기본 icon.png (256x256)
    await sharp(svgBuffer)
        .resize(256, 256, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(path.join(BUILD_ICONS_DIR, 'icon.png'));
    console.log('  생성됨: icon.png');

    // Mac iconset 생성
    console.log('Mac iconset 생성 중...');
    for (const { size, suffix } of ICONSET_SIZES) {
        const outputPath = path.join(ICONSET_DIR, `icon_${suffix}.png`);
        await sharp(svgBuffer)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputPath);
        console.log(`  생성됨: icon_${suffix}.png`);
    }

    // iconutil로 icns 파일 생성 (Mac에서만 가능)
    if (process.platform === 'darwin') {
        console.log('icns 파일 생성 중...');
        try {
            const icnsPath = path.join(BUILD_ICONS_DIR, 'icon.icns');
            execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${icnsPath}"`);
            console.log('  생성됨: icon.icns');

            // iconset 디렉토리 정리
            fs.rmSync(ICONSET_DIR, { recursive: true });
            console.log('  iconset 디렉토리 정리됨');
        } catch (err) {
            console.error('icns 생성 실패:', err.message);
        }
    } else {
        console.log('Mac이 아니므로 icns 파일 생성 건너뜀');
    }

    // Windows ICO 파일 생성
    console.log('Windows ICO 파일 생성 중...');
    try {
        const icoPngPaths = ICO_SIZES.map(size =>
            path.join(BUILD_ICONS_DIR, `icon-${size}.png`)
        );
        const icoBuffer = await pngToIco(icoPngPaths);
        fs.writeFileSync(path.join(BUILD_ICONS_DIR, 'icon.ico'), icoBuffer);
        console.log('  생성됨: icon.ico');
    } catch (err) {
        console.error('ICO 생성 실패:', err.message);
    }

    console.log('아이콘 생성 완료!');
}

generateIcons().catch(console.error);
