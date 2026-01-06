const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { default: pngToIco } = require('png-to-ico');

const SVG_PATH = path.join(__dirname, '../public/assets/images/logo.svg');
const BUILD_ICONS_DIR = path.join(__dirname, '../build/icons');
const ICONSET_DIR = path.join(__dirname, '../build/icon.iconset');

// ========================================
// 아이콘 설정 (Mac/Windows 통일)
// ========================================

// 앱 아이콘 설정 - 여백 최소화
const APP_CONFIG = {
    padding: 0.03,  // 3% 여백
    sizes: [16, 32, 48, 64, 128, 256, 512, 1024],
    // Mac iconset용 (icns 생성에 필요)
    iconsetSizes: [
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
    ]
};

// 시스템 트레이 아이콘 설정 - 여백 없음 (최대한 크게)
const TRAY_CONFIG = {
    padding: 0,  // 여백 없음
    sizes: {
        windows: [16, 24, 32, 48, 64],  // Windows 작업표시줄용
        mac: [16, 18, 22, 32, 44]        // macOS 메뉴바용 (Template 이미지)
    }
};


// ========================================
// 아이콘 생성 함수들
// ========================================

/**
 * 패딩이 적용된 아이콘 생성
 * @param {Buffer} svgBuffer - SVG 버퍼
 * @param {number} size - 출력 크기
 * @param {number} paddingRatio - 패딩 비율 (0.0 ~ 0.5)
 * @returns {Promise<Buffer>} PNG 버퍼
 */
async function createIconWithPadding(svgBuffer, size, paddingRatio = 0) {
    const padding = Math.round(size * paddingRatio);
    const innerSize = size - (padding * 2);

    // SVG를 내부 크기로 렌더링
    const innerIcon = await sharp(svgBuffer)
        .resize(innerSize, innerSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

    // 패딩이 없으면 그대로 반환
    if (padding === 0) {
        return innerIcon;
    }

    // 패딩을 포함한 최종 이미지 생성
    return await sharp({
        create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([{
        input: innerIcon,
        left: padding,
        top: padding
    }])
    .png()
    .toBuffer();
}

/**
 * 앱 아이콘 생성 (Mac/Windows 통일)
 */
async function generateAppIcons(svgBuffer) {
    console.log('\n[앱 아이콘] 생성 중...');

    const icoPaths = [];

    // PNG 아이콘 생성
    for (const size of APP_CONFIG.sizes) {
        const outputPath = path.join(BUILD_ICONS_DIR, `icon-${size}.png`);
        const buffer = await createIconWithPadding(svgBuffer, size, APP_CONFIG.padding);
        fs.writeFileSync(outputPath, buffer);
        icoPaths.push(outputPath);
        console.log(`  생성됨: icon-${size}.png`);
    }

    // 기본 icon.png (256x256)
    const defaultBuffer = await createIconWithPadding(svgBuffer, 256, APP_CONFIG.padding);
    fs.writeFileSync(path.join(BUILD_ICONS_DIR, 'icon.png'), defaultBuffer);
    console.log('  생성됨: icon.png');

    // Windows ICO 파일 생성
    try {
        const icoSizes = [16, 32, 48, 64, 128, 256];
        const icoPngPaths = icoSizes.map(size => path.join(BUILD_ICONS_DIR, `icon-${size}.png`));
        const icoBuffer = await pngToIco(icoPngPaths);
        fs.writeFileSync(path.join(BUILD_ICONS_DIR, 'icon.ico'), icoBuffer);
        console.log('  생성됨: icon.ico');
    } catch (err) {
        console.error('  ICO 생성 실패:', err.message);
    }

    // Mac iconset 생성
    if (!fs.existsSync(ICONSET_DIR)) {
        fs.mkdirSync(ICONSET_DIR, { recursive: true });
    }

    console.log('  iconset 생성 중...');
    for (const { size, suffix } of APP_CONFIG.iconsetSizes) {
        const outputPath = path.join(ICONSET_DIR, `icon_${suffix}.png`);
        const buffer = await createIconWithPadding(svgBuffer, size, APP_CONFIG.padding);
        fs.writeFileSync(outputPath, buffer);
    }

    // Mac에서만 icns 생성
    if (process.platform === 'darwin') {
        try {
            const icnsPath = path.join(BUILD_ICONS_DIR, 'icon.icns');
            execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${icnsPath}"`);
            console.log('  생성됨: icon.icns');
            fs.rmSync(ICONSET_DIR, { recursive: true });
        } catch (err) {
            console.error('  icns 생성 실패:', err.message);
        }
    } else {
        console.log('  Mac이 아니므로 icns 파일은 건너뜀');
    }
}

/**
 * 시스템 트레이 아이콘 생성 (여백 없이 최대한 크게)
 */
async function generateTrayIcons(svgBuffer) {
    console.log('\n[트레이] 시스템 트레이 아이콘 생성 중...');

    const trayDir = path.join(BUILD_ICONS_DIR, 'tray');
    if (!fs.existsSync(trayDir)) {
        fs.mkdirSync(trayDir, { recursive: true });
    }

    // Windows 트레이 아이콘 (컬러)
    console.log('  Windows 트레이 아이콘...');
    for (const size of TRAY_CONFIG.sizes.windows) {
        const outputPath = path.join(trayDir, `tray-${size}.png`);
        const buffer = await createIconWithPadding(svgBuffer, size, TRAY_CONFIG.padding);
        fs.writeFileSync(outputPath, buffer);
        console.log(`    생성됨: tray/tray-${size}.png`);
    }

    // Windows용 트레이 ICO 생성 (여러 크기 포함)
    try {
        const trayIcoPaths = TRAY_CONFIG.sizes.windows.map(size =>
            path.join(trayDir, `tray-${size}.png`)
        );
        const icoBuffer = await pngToIco(trayIcoPaths);
        fs.writeFileSync(path.join(trayDir, 'tray.ico'), icoBuffer);
        console.log('    생성됨: tray/tray.ico');
    } catch (err) {
        console.error('    트레이 ICO 생성 실패:', err.message);
    }

    // Mac 트레이 아이콘 (Template 이미지용 - 단색)
    console.log('  Mac 트레이 아이콘...');
    for (const size of TRAY_CONFIG.sizes.mac) {
        const outputPath = path.join(trayDir, `trayTemplate-${size}.png`);
        const buffer = await createIconWithPadding(svgBuffer, size, TRAY_CONFIG.padding);
        fs.writeFileSync(outputPath, buffer);
        console.log(`    생성됨: tray/trayTemplate-${size}.png`);
    }

    // @2x 버전 생성 (Mac Retina용)
    for (const size of TRAY_CONFIG.sizes.mac) {
        const outputPath = path.join(trayDir, `trayTemplate-${size}@2x.png`);
        const buffer = await createIconWithPadding(svgBuffer, size * 2, TRAY_CONFIG.padding);
        fs.writeFileSync(outputPath, buffer);
        console.log(`    생성됨: tray/trayTemplate-${size}@2x.png`);
    }
}

/**
 * 메인 함수
 */
async function generateIcons() {
    console.log('========================================');
    console.log('DocWatch 아이콘 생성 시작');
    console.log('========================================');
    console.log(`플랫폼: ${process.platform}`);
    console.log(`앱 아이콘 패딩: ${APP_CONFIG.padding * 100}%`);
    console.log(`트레이 아이콘 패딩: ${TRAY_CONFIG.padding * 100}%`);

    // 디렉토리 생성
    if (!fs.existsSync(BUILD_ICONS_DIR)) {
        fs.mkdirSync(BUILD_ICONS_DIR, { recursive: true });
    }

    // SVG 파일 읽기
    const svgBuffer = fs.readFileSync(SVG_PATH);
    console.log(`\nSVG 로드됨: ${SVG_PATH}`);

    // 앱 아이콘 생성 (Mac/Windows 통일)
    await generateAppIcons(svgBuffer);

    // 트레이 아이콘 생성
    await generateTrayIcons(svgBuffer);

    console.log('\n========================================');
    console.log('아이콘 생성 완료!');
    console.log('========================================');
    console.log('\n생성된 파일 구조:');
    console.log('  build/icons/');
    console.log('    ├── icon.png (기본 256x256)');
    console.log('    ├── icon.ico (Windows 앱)');
    console.log('    ├── icon.icns (Mac 앱, Mac에서만 생성)');
    console.log('    ├── icon-*.png (크기별: 16~1024)');
    console.log('    └── tray/ (시스템 트레이 전용)');
    console.log('        ├── tray.ico (Windows 트레이)');
    console.log('        ├── tray-*.png (Windows 크기별)');
    console.log('        └── trayTemplate-*.png (Mac 메뉴바)');
}

generateIcons().catch(console.error);
