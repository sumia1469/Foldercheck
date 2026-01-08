/**
 * 빌드된 exe 파일에 아이콘 적용
 * electron-builder의 signAndEditExecutable이 Windows에서 심볼릭 링크 문제로 실패할 때 사용
 */

const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');
const EXE_PATH = path.join(ROOT_DIR, 'dist', 'win-unpacked', 'DocWatch.exe');
const ICO_PATH = path.join(ROOT_DIR, 'build', 'icons', 'icon.ico');

// 인스톨러도 다시 빌드할지 여부
const REBUILD_INSTALLER = process.argv.includes('--rebuild-installer');

// rcedit.exe 경로 찾기
function findRcedit() {
    const possiblePaths = [
        path.join(ROOT_DIR, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe'),
        path.join(ROOT_DIR, 'node_modules', 'rcedit', 'bin', 'rcedit.exe'),
        path.join(ROOT_DIR, 'node_modules', '@electron', 'rcedit', 'bin', 'rcedit-x64.exe'),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function applyIcon() {
    console.log('\n🎨 아이콘 적용 시작...\n');

    // exe 파일 확인
    if (!fs.existsSync(EXE_PATH)) {
        console.error(`❌ exe 파일을 찾을 수 없습니다: ${EXE_PATH}`);
        console.log('먼저 npm run build:win을 실행하세요.');
        process.exit(1);
    }

    // ico 파일 확인
    if (!fs.existsSync(ICO_PATH)) {
        console.error(`❌ 아이콘 파일을 찾을 수 없습니다: ${ICO_PATH}`);
        process.exit(1);
    }

    const rceditPath = findRcedit();
    if (!rceditPath) {
        console.error('❌ rcedit.exe를 찾을 수 없습니다.');
        process.exit(1);
    }

    console.log(`📁 exe 파일: ${EXE_PATH}`);
    console.log(`📁 ico 파일: ${ICO_PATH}`);
    console.log(`📁 rcedit: ${rceditPath}`);

    // rcedit 명령 실행
    const cmd = `"${rceditPath}" "${EXE_PATH}" --set-icon "${ICO_PATH}"`;

    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error('\n❌ 아이콘 적용 실패:', error.message);
                if (stderr) console.error(stderr);
                process.exit(1);
            }
            console.log('\n✅ 아이콘 적용 완료!');
            console.log('   exe 파일의 아이콘이 변경되었습니다.\n');

            // 인스톨러 재빌드
            if (REBUILD_INSTALLER) {
                console.log('📦 인스톨러 재빌드 중...\n');
                try {
                    // 기존 인스톨러 삭제
                    const installerPath = path.join(ROOT_DIR, 'dist', 'DocWatch Setup 1.0.0.exe');
                    if (fs.existsSync(installerPath)) {
                        fs.unlinkSync(installerPath);
                    }
                    // NSIS 빌드만 실행 (패키징 스킵)
                    execSync('npx electron-builder --win nsis --prepackaged dist/win-unpacked', {
                        cwd: ROOT_DIR,
                        stdio: 'inherit'
                    });
                    console.log('\n✅ 인스톨러 재빌드 완료!\n');
                } catch (err) {
                    console.error('\n⚠️ 인스톨러 재빌드 실패:', err.message);
                }
            }

            resolve();
        });
    });
}

applyIcon();
