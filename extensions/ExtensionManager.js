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
const EventEmitter = require('events');

class ExtensionManager extends EventEmitter {
    constructor(options = {}) {
        super();

        // 확장 저장 경로
        this.extensionsDir = options.extensionsDir ||
            path.join(process.env.LOCALAPPDATA || process.env.HOME, 'docwatch', 'extensions');

        // 내장 확장 디렉토리
        this.builtinDir = options.builtinDir ||
            path.join(__dirname, '..', 'builtin-extensions');

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
    }

    /**
     * 초기화 - 확장 디렉토리 생성 및 기존 확장 로드
     */
    async initialize() {
        // 확장 디렉토리 생성
        if (!fs.existsSync(this.extensionsDir)) {
            fs.mkdirSync(this.extensionsDir, { recursive: true });
        }

        // 설정 로드
        this.loadConfig();

        // 확장 스캔 및 로드
        await this.scanExtensions();

        console.log(`[ExtensionManager] ${this.registry.size}개 확장 발견`);

        return this;
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
     * 확장 디렉토리 스캔
     */
    async scanExtensions() {
        const dirs = [this.builtinDir, this.extensionsDir];

        for (const baseDir of dirs) {
            if (!fs.existsSync(baseDir)) continue;

            const entries = fs.readdirSync(baseDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                if (entry.name.startsWith('.')) continue; // 숨김 폴더 무시

                const extPath = path.join(baseDir, entry.name);
                const manifestPath = path.join(extPath, 'package.json');

                if (fs.existsSync(manifestPath)) {
                    try {
                        const manifest = JSON.parse(
                            fs.readFileSync(manifestPath, 'utf8')
                        );
                        await this.registerExtension(extPath, manifest, baseDir === this.builtinDir);
                    } catch (err) {
                        console.error(`[ExtensionManager] 확장 로드 실패: ${entry.name}`, err.message);
                    }
                }
            }
        }
    }

    /**
     * 확장 등록
     */
    async registerExtension(extensionPath, manifest, isBuiltin = false) {
        const id = manifest.name;

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
        const required = ['name', 'version', 'main'];
        const missing = required.filter(field => !manifest[field]);

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

        extension.state = 'activating';
        extension.error = null;
        this.emit('extension:activating', extension);

        try {
            // Extension Host에서 실행
            if (!this.extensionHost) {
                throw new Error('Extension Host가 초기화되지 않았습니다');
            }

            const result = await this.extensionHost.loadExtension(extension);

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
            await this.extensionHost.unloadExtension(extension);

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
        return Array.from(this.registry.values()).map(ext => ({
            id: ext.id,
            name: ext.manifest.displayName || ext.id,
            version: ext.manifest.version,
            description: ext.manifest.description || '',
            state: ext.state,
            author: ext.manifest.author || '',
            categories: ext.manifest.categories || [],
            isBuiltin: ext.isBuiltin,
            enabled: !this.config.disabled.includes(ext.id),
            error: ext.error,
            permissions: ext.manifest.permissions || []
        }));
    }

    /**
     * 확장 정보 조회
     */
    getExtension(id) {
        const ext = this.registry.get(id);
        if (!ext) return null;

        return {
            id: ext.id,
            name: ext.manifest.displayName || ext.id,
            version: ext.manifest.version,
            description: ext.manifest.description || '',
            state: ext.state,
            author: ext.manifest.author || '',
            categories: ext.manifest.categories || [],
            isBuiltin: ext.isBuiltin,
            enabled: !this.config.disabled.includes(ext.id),
            error: ext.error,
            permissions: ext.manifest.permissions || [],
            contributes: ext.manifest.contributes || {}
        };
    }

    /**
     * 확장 설치 (로컬 경로 또는 압축 파일)
     */
    async installExtension(source) {
        // source가 디렉토리 경로인 경우
        if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
            const manifestPath = path.join(source, 'package.json');
            if (!fs.existsSync(manifestPath)) {
                throw new Error('package.json을 찾을 수 없습니다');
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const targetDir = path.join(this.extensionsDir, manifest.name);

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
