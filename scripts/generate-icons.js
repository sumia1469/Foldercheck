/**
 * SVG를 PNG 및 ICO 아이콘으로 변환하는 스크립트
 *
 * 사용법: node scripts/generate-icons.js
 * 필요 패키지: npm install sharp png-to-ico
 */

const fs = require('fs');
const path = require('path');

async function generateIcons() {
    try {
        // sharp 모듈 동적 로드
        let sharp;
        try {
            sharp = require('sharp');
        } catch (e) {
            console.log('sharp 패키지가 설치되어 있지 않습니다.');
            console.log('설치 명령: npm install sharp png-to-ico');
            process.exit(1);
        }

        const inputSvg = path.join(__dirname, '../public/assets/images/logo.svg');
        const outputDir = path.join(__dirname, '..');

        // SVG 파일 읽기 및 색상 변경 (검정 → 초록색 톤앤매너)
        let svgContent = fs.readFileSync(inputSvg, 'utf8');
        // #000000 (검정색)을 #10b981 (앱 강조 색상)으로 변경
        svgContent = svgContent.replace(/fill:#000000/g, 'fill:#10b981');
        svgContent = svgContent.replace(/fill="#000000"/g, 'fill="#10b981"');
        // viewBox 조정하여 아이콘이 더 크게 보이도록 (여백 줄임)
        // 원본: 0.00 0.00 736.00 520.00 → 조정: 80 60 576 400 (여백 약 10% 정도만 남김)
        svgContent = svgContent.replace(
            /viewBox="0\.00 0\.00 736\.00 520\.00"/,
            'viewBox="80 60 576 400"'
        );
        const svgBuffer = Buffer.from(svgContent);

        // 다양한 크기의 PNG 생성
        const sizes = [16, 32, 48, 64, 128, 256, 512];
        const pngFiles = [];

        console.log('PNG 아이콘 생성 중...');

        for (const size of sizes) {
            const outputPath = path.join(outputDir, `icon-${size}.png`);
            await sharp(svgBuffer)
                .resize(size, size)
                .png()
                .toFile(outputPath);
            console.log(`  ✓ icon-${size}.png 생성됨`);
            pngFiles.push(outputPath);
        }

        // 메인 아이콘 (256x256)
        const mainIconPath = path.join(outputDir, 'icon.png');
        await sharp(svgBuffer)
            .resize(256, 256)
            .png()
            .toFile(mainIconPath);
        console.log('  ✓ icon.png (256x256) 생성됨');

        // ICO 파일 생성 (Windows용)
        try {
            const pngToIcoModule = require('png-to-ico');
            // png-to-ico v3.x는 default export 사용
            const pngToIco = pngToIcoModule.default || pngToIcoModule;
            const pngFilePaths = [
                path.join(outputDir, 'icon-16.png'),
                path.join(outputDir, 'icon-32.png'),
                path.join(outputDir, 'icon-48.png'),
                path.join(outputDir, 'icon-256.png')
            ];
            const icoBuffer = await pngToIco(pngFilePaths);
            fs.writeFileSync(path.join(outputDir, 'icon.ico'), icoBuffer);
            console.log('  ✓ icon.ico 생성됨');
        } catch (e) {
            console.log('  ⚠ ICO 생성 실패:', e.message);
        }

        // 임시 PNG 파일들 삭제 (선택적)
        // sizes.forEach(size => {
        //     fs.unlinkSync(path.join(outputDir, `icon-${size}.png`));
        // });

        // macOS용 icns 파일 생성 안내
        console.log('\n아이콘 생성 완료!');
        console.log('생성된 파일:');
        console.log('  - icon.png (메인 PNG 아이콘)');
        console.log('  - icon.ico (Windows 아이콘)');
        console.log('  - icon-*.png (다양한 크기)');
        console.log('\nmacOS용 icns 파일 생성 (macOS에서만 가능):');
        console.log('  1. iconutil 사용: mkdir icon.iconset && cp icon-*.png icon.iconset/ && iconutil -c icns icon.iconset');

    } catch (error) {
        console.error('아이콘 생성 실패:', error);
        process.exit(1);
    }
}

generateIcons();
