const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
    const { electronPlatformName, appOutDir } = context;

    if (electronPlatformName !== 'darwin') {
        return;
    }

    const appName = context.packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    console.log(`공증 시작: ${appPath}`);

    try {
        await notarize({
            appPath: appPath,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_PASSWORD,
            teamId: 'UF9B4Q43XH'
        });
        console.log('공증 완료!');
    } catch (error) {
        console.error('공증 실패:', error);
        throw error;
    }
};
