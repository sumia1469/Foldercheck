/**
 * ExtensionManager - 확장 생명주기 및 레지스트리 관리
 *
 * 책임:
 * - 확장 검색, 로드, 활성화/비활성화
 * - 확장 레지스트리 관리
 * - 의존성 해결
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const EventEmitter = require('events');
const crypto = require('crypto');

class ExtensionManager extends EventEmitter {
    constructor(options = {}) {
        super();

        // 확장 저장 경로 (사용자 확장)
        this.extensionsDir = options.extensionsDir ||
            path.join(process.env.LOCALAPPDATA || process.env.HOME, 'docwatch', 'extensions');

        // 번들 확장 디렉토리 (앱에 포함된 기본 확장, 첫 실행 시 사용자 디렉토리로 복사됨)
        this.bundledDir = options.bundledDir ||
            path.join(__dirname, '..', 'bundled-extensions');

        // 확장 레지스트리
        this.registry = new Map();

        // 활성화된 확장
        this.activeExtensions = new Map();

        // Extension Host 참조
        this.extensionHost = null;

        // API 제공자
        this.apiProvider = null;

        // 설정 저장 경로
        this.configPath = options.configPath ||
            path.join(this.extensionsDir, 'extensions-config.json');

        // 현재 라이선스 타입 (free, trial, pro)
        this.currentLicenseType = 'free';

        // R2 마켓플레이스 설정
        this.marketplaceBaseUrl = options.marketplaceBaseUrl ||
            'https://file.docwatch.app/extensions'; // Cloudflare R2 공개 URL

        // 마켓플레이스 캐시
        this.marketplaceCache = null;
        this.marketplaceCacheTime = 0;
        this.marketplaceCacheDuration = 5 * 60 * 1000; // 5분 캐시

        // 메인 프로세스 모듈 인스턴스 (mainEntry 지원)
        this.mainModules = new Map();

        // ipcMain 참조 (동적 IPC 핸들러 등록용)
        this.ipcMain = options.ipcMain || null;

        // mainWindow 참조 (이벤트 전송용)
        this.mainWindow = options.mainWindow || null;

        // 앱 경로 (getUserDataDir 대체)
        this.userDataDir = options.userDataDir ||
            path.join(process.env.LOCALAPPDATA || process.env.HOME, 'docwatch');
    }

    /**
     * 라이선스 타입 설정
     * @param {string} licenseType - 'free', 'trial', 'pro'
     */
    setLicenseType(licenseType) {
        this.currentLicenseType = licenseType;
        console.log(`[ExtensionManager] 라이선스 타입 설정: ${licenseType}`);

        // 라이선스 변경 시 Pro 확장 상태 업데이트
        this.updateExtensionsForLicense();
    }

    /**
     * 라이선스 변경에 따라 확장 상태 업데이트
     */
    async updateExtensionsForLicense() {
        const deactivatedExtensions = [];

        for (const [id, extension] of this.registry) {
            const requiredLicense = extension.manifest.license || 'free';

            if (requiredLicense === 'pro' && this.currentLicenseType === 'free') {
                // Pro 확장이 활성화되어 있으면 비활성화
                if (extension.state === 'active' || extension.enabled) {
                    console.log(`[ExtensionManager] 라이선스 제한으로 확장 비활성화: ${id}`);
                    try {
                        // 실행 중이면 비활성화
                        if (extension.state === 'active') {
                            await this.deactivateExtension(id);
                        }
                        // enabled 상태도 false로 변경
                        extension.enabled = false;
                        // 비활성화 목록에 추가
                        if (!this.config.disabled.includes(id)) {
                            this.config.disabled.push(id);
                        }
                        deactivatedExtensions.push(id);
                    } catch (err) {
                        console.error(`[ExtensionManager] 확장 비활성화 실패: ${id}`, err.message);
                    }
                }
            }
        }

        // 설정 저장
        if (deactivatedExtensions.length > 0) {
            this.saveConfig();
            console.log(`[ExtensionManager] 라이선스 변경으로 ${deactivatedExtensions.length}개 확장 비활성화됨: ${deactivatedExtensions.join(', ')}`);
        }

        this.emit('license:changed', { licenseType: this.currentLicenseType, deactivatedExtensions });
    }

    /**
     * 확장의 라이선스 요구사항 확인
     * @param {string} id - 확장 ID
     * @returns {boolean} - 현재 라이선스로 사용 가능 여부
     */
    canUseExtension(id) {
        const extension = this.registry.get(id);
        if (!extension) return false;

        const requiredLicense = extension.manifest.license || 'free';

        // free 확장은 모든 라이선스에서 사용 가능
        if (requiredLicense === 'free') return true;

        // pro 확장은 pro 또는 trial 라이선스에서만 사용 가능
        if (requiredLicense === 'pro') {
            return this.currentLicenseType === 'pro' || this.currentLicenseType === 'trial';
        }

        return true;
    }

    /**
     * 초기화 - 확장 디렉토리 생성 및 기존 확장 로드
     */
    async initialize() {
        console.log('[ExtensionManager] 초기화 시작');
        console.log('[ExtensionManager] 사용자 확장 디렉토리:', this.extensionsDir);
        console.log('[ExtensionManager] 번들 확장 디렉토리:', this.bundledDir);

        // 확장 디렉토리 생성
        if (!fs.existsSync(this.extensionsDir)) {
            console.log('[ExtensionManager] 사용자 확장 디렉토리 생성');
            fs.mkdirSync(this.extensionsDir, { recursive: true });
        }

        // 설정 로드
        this.loadConfig();

        // 번들 확장을 사용자 디렉토리에 복사 (없거나 버전이 낮은 경우)
        await this.installBundledExtensions();

        // 확장 스캔 및 로드 (사용자 디렉토리만)
        await this.scanExtensions();

        console.log(`[ExtensionManager] ${this.registry.size}개 확장 발견`);
        console.log('[ExtensionManager] 등록된 확장:', Array.from(this.registry.keys()));

        return this;
    }

    /**
     * 번들 확장을 사용자 디렉토리에 설치
     */
    async installBundledExtensions() {
        console.log('[ExtensionManager] 번들 확장 설치 확인 중...');
        console.log('[ExtensionManager] 번들 디렉토리 존재 여부:', fs.existsSync(this.bundledDir));

        if (!fs.existsSync(this.bundledDir)) {
            console.log('[ExtensionManager] 번들 확장 디렉토리 없음:', this.bundledDir);
            return;
        }

        const entries = fs.readdirSync(this.bundledDir, { withFileTypes: true });
        console.log('[ExtensionManager] 번들 디렉토리 내용:', entries.map(e => e.name));

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('.')) continue;

            const bundledPath = path.join(this.bundledDir, entry.name);
            // manifest.json 또는 package.json 지원
            let bundledManifestPath = path.join(bundledPath, 'manifest.json');
            if (!fs.existsSync(bundledManifestPath)) {
                bundledManifestPath = path.join(bundledPath, 'package.json');
            }

            if (!fs.existsSync(bundledManifestPath)) continue;

            try {
                const bundledManifest = JSON.parse(fs.readFileSync(bundledManifestPath, 'utf8'));
                const targetPath = path.join(this.extensionsDir, entry.name);
                // 대상 경로에서도 manifest.json 또는 package.json 확인
                let targetManifestPath = path.join(targetPath, 'manifest.json');
                if (!fs.existsSync(targetManifestPath)) {
                    targetManifestPath = path.join(targetPath, 'package.json');
                }

                let shouldInstall = false;

                if (!fs.existsSync(targetPath)) {
                    // 확장 폴더가 없으면 설치
                    shouldInstall = true;
                    console.log(`[ExtensionManager] 번들 확장 설치 (새로 설치): ${entry.name}`);
                } else if (!fs.existsSync(path.join(targetPath, 'manifest.json')) && !fs.existsSync(path.join(targetPath, 'package.json'))) {
                    // 폴더는 있지만 manifest 파일이 없으면 재설치
                    shouldInstall = true;
                    console.log(`[ExtensionManager] 번들 확장 재설치 (manifest 없음): ${entry.name}`);
                } else {
                    // 버전 비교
                    const targetManifest = JSON.parse(fs.readFileSync(targetManifestPath, 'utf8'));
                    if (this.compareVersions(bundledManifest.version, targetManifest.version) > 0) {
                        shouldInstall = true;
                        console.log(`[ExtensionManager] 번들 확장 업데이트: ${entry.name} (${targetManifest.version} → ${bundledManifest.version})`);
                    } else {
                        console.log(`[ExtensionManager] 번들 확장 최신 상태: ${entry.name} (v${targetManifest.version})`);
                    }
                }

                if (shouldInstall) {
                    // 기존 폴더 삭제 후 복사
                    if (fs.existsSync(targetPath)) {
                        fs.rmSync(targetPath, { recursive: true });
                    }
                    this.copyDirectory(bundledPath, targetPath);
                    console.log(`[ExtensionManager] 번들 확장 복사 완료: ${entry.name}`);
                }
            } catch (err) {
                console.error(`[ExtensionManager] 번들 확장 설치 실패: ${entry.name}`, err.message);
            }
        }
    }

    /**
     * 버전 비교 (semver 간단 비교)
     * @returns 양수: v1 > v2, 0: v1 == v2, 음수: v1 < v2
     */
    compareVersions(v1, v2) {
        const parts1 = (v1 || '0.0.0').split('.').map(Number);
        const parts2 = (v2 || '0.0.0').split('.').map(Number);

        for (let i = 0; i < 3; i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 !== p2) return p1 - p2;
        }
        return 0;
    }

    /**
     * 디렉토리 복사 (재귀)
     */
    copyDirectory(src, dest) {
        fs.mkdirSync(dest, { recursive: true });

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDirectory(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 설정 로드
     */
    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } else {
                this.config = { disabled: [], settings: {} };
            }
        } catch (err) {
            console.error('[ExtensionManager] 설정 로드 실패:', err);
            this.config = { disabled: [], settings: {} };
        }
    }

    /**
     * 설정 저장
     */
    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (err) {
            console.error('[ExtensionManager] 설정 저장 실패:', err);
        }
    }

    /**
     * 확장 디렉토리 스캔 (사용자 디렉토리만)
     */
    async scanExtensions() {
        // 사용자 확장 디렉토리만 스캔 (번들 확장은 이미 복사됨)
        if (!fs.existsSync(this.extensionsDir)) return;

        const entries = fs.readdirSync(this.extensionsDir, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('.')) continue; // 숨김 폴더 무시

            const extPath = path.join(this.extensionsDir, entry.name);
            // manifest.json 또는 package.json 지원
            let manifestPath = path.join(extPath, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
                manifestPath = path.join(extPath, 'package.json');
            }

            if (fs.existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(
                        fs.readFileSync(manifestPath, 'utf8')
                    );
                    // 모든 확장은 사용자 확장 (isBuiltin = false)
                    await this.registerExtension(extPath, manifest, false);
                } catch (err) {
                    console.error(`[ExtensionManager] 확장 로드 실패: ${entry.name}`, err.message);
                }
            }
        }
    }

    /**
     * 확장 등록
     */
    async registerExtension(extensionPath, manifest, isBuiltin = false) {
        // manifest.json의 경우 'id' 필드 사용, package.json의 경우 'name' 필드 사용
        const id = manifest.id || manifest.name;

        // 매니페스트 검증
        if (!this.validateManifest(manifest)) {
            throw new Error(`유효하지 않은 매니페스트: ${id}`);
        }

        const extension = {
            id,
            path: extensionPath,
            manifest,
            isBuiltin,
            state: 'inactive', // inactive | activating | active | deactivating | error
            instance: null,
            exports: null,
            error: null
        };

        this.registry.set(id, extension);
        this.emit('extension:registered', extension);

        console.log(`[ExtensionManager] 확장 등록됨: ${id} (${isBuiltin ? '내장' : '사용자'})`);

        return extension;
    }

    /**
     * 매니페스트 검증
     */
    validateManifest(manifest) {
        // manifest.json의 경우 'id' 필드 사용, package.json의 경우 'name' 필드 사용
        const hasId = manifest.id || manifest.name;
        const required = ['version', 'main'];
        const missing = required.filter(field => !manifest[field]);

        if (!hasId) {
            missing.push('id 또는 name');
        }

        if (missing.length > 0) {
            console.warn(`[ExtensionManager] 매니페스트 필수 필드 누락: ${missing.join(', ')}`);
            return false;
        }

        return true;
    }

    /**
     * 확장 활성화
     */
    async activateExtension(id) {
        const extension = this.registry.get(id);
        if (!extension) {
            throw new Error(`확장을 찾을 수 없음: ${id}`);
        }

        // 이미 활성화됨
        if (extension.state === 'active') {
            return extension.exports;
        }

        // 비활성화된 확장인지 확인
        if (this.config.disabled.includes(id)) {
            console.log(`[ExtensionManager] 확장이 비활성화 상태: ${id}`);
            return null;
        }

        // 라이선스 검증
        if (!this.canUseExtension(id)) {
            const requiredLicense = extension.manifest.license || 'free';
            console.log(`[ExtensionManager] 라이선스 제한: ${id} (필요: ${requiredLicense}, 현재: ${this.currentLicenseType})`);
            throw new Error(`이 확장은 ${requiredLicense === 'pro' ? 'Pro' : requiredLicense} 라이선스가 필요합니다`);
        }

        extension.state = 'activating';
        extension.error = null;
        this.emit('extension:activating', extension);

        try {
            // 1. 메인 프로세스 모듈 로드 (mainEntry가 있는 경우)
            if (extension.manifest.mainEntry) {
                await this.loadMainModule(extension);
            }

            // 2. Extension Host에서 렌더러 모듈 실행 (main이 있는 경우)
            let result = null;
            if (extension.manifest.main && this.extensionHost) {
                result = await this.extensionHost.loadExtension(extension);
            }

            extension.state = 'active';
            extension.exports = result;
            this.activeExtensions.set(id, extension);

            this.emit('extension:activated', extension);
            console.log(`[ExtensionManager] 확장 활성화됨: ${id}`);

            return result;
        } catch (err) {
            extension.state = 'error';
            extension.error = err.message;
            this.emit('extension:error', { extension, error: err });
            console.error(`[ExtensionManager] 확장 활성화 실패: ${id}`, err.message);
            throw err;
        }
    }

    /**
     * 확장 비활성화
     */
    async deactivateExtension(id) {
        const extension = this.activeExtensions.get(id);
        if (!extension) {
            console.log(`[ExtensionManager] 활성화되지 않은 확장: ${id}`);
            return;
        }

        extension.state = 'deactivating';
        this.emit('extension:deactivating', extension);

        try {
            // 1. 메인 프로세스 모듈 언로드
            if (this.mainModules.has(id)) {
                await this.unloadMainModule(id);
            }

            // 2. Extension Host 언로드
            if (this.extensionHost) {
                await this.extensionHost.unloadExtension(extension);
            }

            extension.state = 'inactive';
            extension.exports = null;
            this.activeExtensions.delete(id);

            this.emit('extension:deactivated', extension);
            console.log(`[ExtensionManager] 확장 비활성화됨: ${id}`);
        } catch (err) {
            extension.state = 'error';
            extension.error = err.message;
            this.emit('extension:error', { extension, error: err });
            throw err;
        }
    }

    /**
     * 메인 프로세스 모듈 로드
     * 확장의 mainEntry 필드에 지정된 모듈을 메인 프로세스에서 직접 실행
     */
    async loadMainModule(extension) {
        const id = extension.id || extension.manifest.id || extension.manifest.name;
        const mainEntryPath = path.join(extension.path, extension.manifest.mainEntry);

        if (!fs.existsSync(mainEntryPath)) {
            console.warn(`[ExtensionManager] mainEntry 파일 없음: ${mainEntryPath}`);
            return null;
        }

        try {
            // 캐시 제거 후 로드
            delete require.cache[require.resolve(mainEntryPath)];
            const mainModule = require(mainEntryPath);

            // 모듈 컨텍스트 생성
            const context = {
                extensionId: id,
                extensionPath: extension.path,
                ipcMain: this.ipcMain,
                mainWindow: this.mainWindow,
                userDataDir: this.userDataDir,
                emit: (event, data) => this.emit(`extension:${id}:${event}`, data),
                getMainWindow: () => this.mainWindow,
                // Electron 모듈 제공 (확장에서 윈도우 생성 등에 사용)
                electron: require('electron')
            };

            // 모듈 활성화
            let instance = null;
            if (typeof mainModule.activate === 'function') {
                instance = await mainModule.activate(context);
            } else if (typeof mainModule === 'function') {
                instance = await mainModule(context);
            }

            this.mainModules.set(id, {
                module: mainModule,
                instance,
                context
            });

            console.log(`[ExtensionManager] 메인 모듈 로드됨: ${id}`);
            return instance;
        } catch (err) {
            console.error(`[ExtensionManager] 메인 모듈 로드 실패: ${id}`, err);
            throw err;
        }
    }

    /**
     * 메인 프로세스 모듈 언로드
     */
    async unloadMainModule(id) {
        const moduleInfo = this.mainModules.get(id);
        if (!moduleInfo) return;

        try {
            // 모듈 비활성화
            if (moduleInfo.module && typeof moduleInfo.module.deactivate === 'function') {
                await moduleInfo.module.deactivate(moduleInfo.context);
            }

            // 인스턴스 정리
            if (moduleInfo.instance && typeof moduleInfo.instance.dispose === 'function') {
                await moduleInfo.instance.dispose();
            }

            this.mainModules.delete(id);
            console.log(`[ExtensionManager] 메인 모듈 언로드됨: ${id}`);
        } catch (err) {
            console.error(`[ExtensionManager] 메인 모듈 언로드 실패: ${id}`, err);
        }
    }

    /**
     * 메인 모듈 인스턴스 가져오기
     */
    getMainModuleInstance(id) {
        const moduleInfo = this.mainModules.get(id);
        return moduleInfo ? moduleInfo.instance : null;
    }

    /**
     * 확장 활성화/비활성화 토글
     */
    async toggleExtension(id, enabled) {
        if (enabled) {
            // 비활성화 목록에서 제거
            this.config.disabled = this.config.disabled.filter(d => d !== id);
            this.saveConfig();
            await this.activateExtension(id);
        } else {
            // 비활성화 목록에 추가
            if (!this.config.disabled.includes(id)) {
                this.config.disabled.push(id);
                this.saveConfig();
            }
            await this.deactivateExtension(id);
        }
    }

    /**
     * 활성화 이벤트 기반 자동 활성화
     */
    async activateByEvent(event) {
        const toActivate = [];

        for (const [id, extension] of this.registry) {
            if (extension.state !== 'inactive') continue;
            if (this.config.disabled.includes(id)) continue;

            const activationEvents = extension.manifest.activationEvents || ['*'];

            if (activationEvents.some(ae => this.matchesActivationEvent(ae, event))) {
                toActivate.push(id);
            }
        }

        const results = [];
        for (const id of toActivate) {
            try {
                await this.activateExtension(id);
                results.push({ id, success: true });
            } catch (err) {
                results.push({ id, success: false, error: err.message });
                console.error(`[ExtensionManager] 자동 활성화 실패: ${id}`, err.message);
            }
        }

        return results;
    }

    /**
     * 활성화 이벤트 매칭
     */
    matchesActivationEvent(pattern, event) {
        // 패턴 예시: 'onFileChange:*.docx', 'onCommand:myext.hello', '*'
        if (pattern === '*') return true;
        if (!event) return pattern === '*';

        const [type, value] = pattern.split(':');
        const [eventType, eventValue] = event.split(':');

        if (type !== eventType) return false;
        if (!value) return true;

        // 와일드카드 매칭
        if (value.includes('*')) {
            const regex = new RegExp('^' + value.replace(/\*/g, '.*') + '$');
            return regex.test(eventValue || '');
        }

        return value === eventValue;
    }

    /**
     * 모든 확장 정보 반환
     */
    getExtensions() {
        return Array.from(this.registry.values()).map(ext => {
            const requiredLicense = ext.manifest.license || 'free';
            const canUse = this.canUseExtension(ext.id);
            const isDisabled = this.config.disabled.includes(ext.id);

            // 라이선스 잠금 시 enabled는 항상 false
            const enabled = canUse ? !isDisabled : false;

            return {
                id: ext.id,
                name: ext.manifest.displayName || ext.id,
                version: ext.manifest.version,
                description: ext.manifest.description || '',
                state: ext.state,
                author: ext.manifest.author || '',
                categories: ext.manifest.categories || [],
                isBuiltin: ext.isBuiltin,
                enabled: enabled,
                error: ext.error,
                permissions: ext.manifest.permissions || [],
                // 라이선스 관련 정보
                requiredLicense: requiredLicense,
                canUse: canUse,
                licenseLocked: !canUse,
                // 프론트엔드에서 manifest 접근이 필요하므로 포함
                manifest: {
                    name: ext.manifest.name,
                    displayName: ext.manifest.displayName,
                    version: ext.manifest.version,
                    description: ext.manifest.description || '',
                    publisher: ext.manifest.publisher || ext.manifest.author || 'Unknown',
                    icon: ext.manifest.icon || '',
                    categories: ext.manifest.categories || [],
                    contributes: ext.manifest.contributes || {},
                    license: requiredLicense
                }
            };
        });
    }

    /**
     * 확장 정보 조회
     */
    getExtension(id) {
        const ext = this.registry.get(id);
        if (!ext) return null;

        const requiredLicense = ext.manifest.license || 'free';
        const canUse = this.canUseExtension(id);
        const isDisabled = this.config.disabled.includes(id);

        // 라이선스 잠금 시 enabled는 항상 false
        const enabled = canUse ? !isDisabled : false;

        return {
            id: ext.id,
            name: ext.manifest.displayName || ext.id,
            version: ext.manifest.version,
            description: ext.manifest.description || '',
            state: ext.state,
            author: ext.manifest.author || '',
            categories: ext.manifest.categories || [],
            isBuiltin: ext.isBuiltin,
            enabled: enabled,
            error: ext.error,
            permissions: ext.manifest.permissions || [],
            contributes: ext.manifest.contributes || {},
            // 라이선스 관련 정보
            requiredLicense: requiredLicense,
            canUse: canUse,
            licenseLocked: !canUse
        };
    }

    /**
     * 확장 설치 (로컬 경로 또는 압축 파일)
     */
    async installExtension(source) {
        // source가 디렉토리 경로인 경우
        if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
            // manifest.json 또는 package.json 지원
            let manifestPath = path.join(source, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
                manifestPath = path.join(source, 'package.json');
            }
            if (!fs.existsSync(manifestPath)) {
                throw new Error('manifest.json 또는 package.json을 찾을 수 없습니다');
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const id = manifest.id || manifest.name;
            const targetDir = path.join(this.extensionsDir, id);

            // 복사
            this.copyDir(source, targetDir);

            // 레지스트리에 등록
            await this.registerExtension(targetDir, manifest, false);

            this.emit('extension:installed', { id: manifest.name });

            return manifest.name;
        }

        // TODO: ZIP 파일 지원
        throw new Error('지원하지 않는 설치 소스입니다');
    }

    /**
     * 디렉토리 복사
     */
    copyDir(src, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                this.copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    /**
     * 확장 제거
     */
    async uninstallExtension(id) {
        const extension = this.registry.get(id);
        if (!extension) {
            throw new Error(`확장을 찾을 수 없음: ${id}`);
        }

        // 내장 확장은 제거 불가
        if (extension.isBuiltin) {
            throw new Error('내장 확장은 제거할 수 없습니다');
        }

        // 활성화되어 있으면 먼저 비활성화
        if (extension.state === 'active') {
            await this.deactivateExtension(id);
        }

        // 레지스트리에서 제거
        this.registry.delete(id);

        // 파일 시스템에서 삭제
        try {
            fs.rmSync(extension.path, { recursive: true, force: true });
        } catch (err) {
            console.error(`[ExtensionManager] 파일 삭제 실패: ${extension.path}`, err);
        }

        this.emit('extension:uninstalled', { id });
        console.log(`[ExtensionManager] 확장 제거됨: ${id}`);
    }

    /**
     * 확장 설정 조회
     */
    getExtensionSettings(id) {
        return this.config.settings[id] || {};
    }

    /**
     * 확장 설정 저장
     */
    setExtensionSettings(id, settings) {
        this.config.settings[id] = settings;
        this.saveConfig();
        this.emit('extension:settings-changed', { id, settings });
    }

    // ========== R2 마켓플레이스 기능 ==========

    /**
     * 마켓플레이스 기본 URL 설정
     * @param {string} url - R2 공개 URL (예: https://pub-xxx.r2.dev/extensions)
     */
    setMarketplaceUrl(url) {
        this.marketplaceBaseUrl = url;
        this.marketplaceCache = null; // 캐시 초기화
        console.log(`[ExtensionManager] 마켓플레이스 URL 설정: ${url}`);
    }

    /**
     * HTTP/HTTPS 요청 유틸리티
     */
    _fetch(url) {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;

            const request = protocol.get(url, (response) => {
                // 리다이렉트 처리
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    this._fetch(response.headers.location).then(resolve).catch(reject);
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${url}`));
                    return;
                }

                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            });

            request.on('error', reject);
            request.setTimeout(30000, () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * 마켓플레이스에서 확장 목록 조회
     * @returns {Promise<Array>} - 사용 가능한 확장 목록
     */
    async fetchMarketplaceExtensions() {
        // 캐시 확인
        const now = Date.now();
        if (this.marketplaceCache && (now - this.marketplaceCacheTime) < this.marketplaceCacheDuration) {
            console.log('[ExtensionManager] 마켓플레이스 캐시 사용');
            return this.marketplaceCache;
        }

        console.log('[ExtensionManager] 마켓플레이스 목록 조회 중...');

        try {
            const indexUrl = `${this.marketplaceBaseUrl}/index.json`;
            const data = await this._fetch(indexUrl);
            const index = JSON.parse(data.toString());

            // 설치 상태 추가
            const extensions = (index.extensions || []).map(ext => {
                const installed = this.registry.has(ext.id);
                const installedExt = installed ? this.registry.get(ext.id) : null;
                const installedVersion = installedExt ? installedExt.manifest.version : null;
                const hasUpdate = installed && installedVersion &&
                    this.compareVersions(ext.version, installedVersion) > 0;

                return {
                    ...ext,
                    installed,
                    installedVersion,
                    hasUpdate,
                    downloadUrl: `${this.marketplaceBaseUrl}/${ext.filename}`
                };
            });

            // 캐시 저장
            this.marketplaceCache = extensions;
            this.marketplaceCacheTime = now;

            console.log(`[ExtensionManager] 마켓플레이스: ${extensions.length}개 확장 발견`);
            return extensions;
        } catch (err) {
            console.error('[ExtensionManager] 마켓플레이스 조회 실패:', err.message);
            throw new Error(`마켓플레이스 조회 실패: ${err.message}`);
        }
    }

    /**
     * 마켓플레이스에서 확장 다운로드 및 설치
     * @param {string} extensionId - 확장 ID
     * @returns {Promise<Object>} - 설치 결과
     */
    async installFromMarketplace(extensionId) {
        console.log(`[ExtensionManager] 마켓플레이스에서 설치 시작: ${extensionId}`);

        // 마켓플레이스 목록 조회
        const extensions = await this.fetchMarketplaceExtensions();
        const extInfo = extensions.find(e => e.id === extensionId);

        if (!extInfo) {
            throw new Error(`마켓플레이스에서 확장을 찾을 수 없음: ${extensionId}`);
        }

        // 앱 버전 체크 (minAppVersion)
        if (extInfo.minAppVersion) {
            // TODO: 실제 앱 버전과 비교
            console.log(`[ExtensionManager] 최소 앱 버전 요구: ${extInfo.minAppVersion}`);
        }

        this.emit('extension:download-start', { id: extensionId, ...extInfo });

        try {
            // ZIP 파일 다운로드
            console.log(`[ExtensionManager] 다운로드 중: ${extInfo.downloadUrl}`);
            const zipData = await this._fetch(extInfo.downloadUrl);

            // SHA256 검증
            if (extInfo.sha256) {
                const hash = crypto.createHash('sha256').update(zipData).digest('hex');
                if (hash !== extInfo.sha256) {
                    throw new Error('SHA256 해시 불일치 - 파일이 손상되었을 수 있습니다');
                }
                console.log(`[ExtensionManager] SHA256 검증 성공`);
            }

            this.emit('extension:download-complete', { id: extensionId, size: zipData.length });

            // 임시 파일로 저장
            const tempDir = path.join(this.extensionsDir, '.temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempZipPath = path.join(tempDir, `${extensionId}.zip`);
            fs.writeFileSync(tempZipPath, zipData);

            // ZIP 압축 해제
            const targetDir = path.join(this.extensionsDir, extensionId);

            // 기존 확장 제거 (업데이트 시)
            if (fs.existsSync(targetDir)) {
                // 활성화되어 있으면 먼저 비활성화
                if (this.activeExtensions.has(extensionId)) {
                    await this.deactivateExtension(extensionId);
                }
                fs.rmSync(targetDir, { recursive: true });
            }

            // ZIP 압축 해제 (unzipper 사용)
            await this._unzip(tempZipPath, targetDir);

            // 임시 파일 삭제
            fs.unlinkSync(tempZipPath);

            // 확장 등록 - manifest.json 또는 package.json 지원
            let manifestPath = path.join(targetDir, 'manifest.json');
            if (!fs.existsSync(manifestPath)) {
                manifestPath = path.join(targetDir, 'package.json');
            }
            if (!fs.existsSync(manifestPath)) {
                throw new Error('manifest.json 또는 package.json을 찾을 수 없습니다');
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            await this.registerExtension(targetDir, manifest, false);

            // 캐시 무효화
            this.marketplaceCache = null;

            this.emit('extension:installed', { id: extensionId, version: manifest.version });
            console.log(`[ExtensionManager] 마켓플레이스 설치 완료: ${extensionId} v${manifest.version}`);

            return {
                success: true,
                id: extensionId,
                version: manifest.version,
                name: manifest.displayName || extensionId
            };
        } catch (err) {
            this.emit('extension:install-error', { id: extensionId, error: err.message });
            console.error(`[ExtensionManager] 마켓플레이스 설치 실패: ${extensionId}`, err.message);
            throw err;
        }
    }

    /**
     * ZIP 압축 해제
     */
    async _unzip(zipPath, targetDir) {
        // unzipper 모듈 사용 (dependencies에 있음)
        try {
            const unzipper = require('unzipper');

            await new Promise((resolve, reject) => {
                fs.createReadStream(zipPath)
                    .pipe(unzipper.Extract({ path: targetDir }))
                    .on('close', resolve)
                    .on('error', reject);
            });

            console.log(`[ExtensionManager] ZIP 압축 해제 완료: ${targetDir}`);
        } catch (err) {
            // unzipper가 없으면 기본 방식으로 시도
            console.error('[ExtensionManager] unzipper 모듈 사용 불가, 수동 압축 해제 필요');
            throw new Error('ZIP 압축 해제 실패: unzipper 모듈이 필요합니다');
        }
    }

    /**
     * 마켓플레이스에서 확장 업데이트 확인
     * @returns {Promise<Array>} - 업데이트 가능한 확장 목록
     */
    async checkForUpdates() {
        console.log('[ExtensionManager] 업데이트 확인 중...');

        try {
            const extensions = await this.fetchMarketplaceExtensions();
            const updates = extensions.filter(ext => ext.hasUpdate);

            console.log(`[ExtensionManager] ${updates.length}개 업데이트 발견`);

            return updates.map(ext => ({
                id: ext.id,
                name: ext.name,
                currentVersion: ext.installedVersion,
                newVersion: ext.version,
                description: ext.description
            }));
        } catch (err) {
            console.error('[ExtensionManager] 업데이트 확인 실패:', err.message);
            return [];
        }
    }

    /**
     * 모든 확장 업데이트
     * @returns {Promise<Array>} - 업데이트 결과
     */
    async updateAllExtensions() {
        const updates = await this.checkForUpdates();
        const results = [];

        for (const update of updates) {
            try {
                await this.installFromMarketplace(update.id);
                results.push({ id: update.id, success: true });
            } catch (err) {
                results.push({ id: update.id, success: false, error: err.message });
            }
        }

        return results;
    }

    /**
     * 종료 처리
     */
    async shutdown() {
        console.log('[ExtensionManager] 종료 중...');

        // 모든 활성 확장 비활성화
        for (const [id] of this.activeExtensions) {
            try {
                await this.deactivateExtension(id);
            } catch (err) {
                console.error(`[ExtensionManager] 확장 비활성화 실패: ${id}`, err);
            }
        }

        console.log('[ExtensionManager] 종료 완료');
    }
}

module.exports = ExtensionManager;
