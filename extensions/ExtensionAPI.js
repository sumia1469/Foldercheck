/**
 * ExtensionAPI - 확장에 노출되는 API 정의
 *
 * 네임스페이스:
 * - docwatch.files: 파일 감시 관련
 * - docwatch.meetings: 회의록 관련
 * - docwatch.ui: UI 확장
 * - docwatch.commands: 명령어 시스템
 * - docwatch.llm: AI/LLM 인터페이스
 * - docwatch.storage: 확장별 저장소
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class ExtensionAPI extends EventEmitter {
    constructor(options = {}) {
        super();

        this.mainWindow = options.mainWindow;
        this.server = options.server;
        this.extensionsDir = options.extensionsDir;

        // 등록된 명령어
        this.commands = new Map();

        // 등록된 뷰
        this.views = new Map();

        // 파일 감시 훅
        this.fileHooks = [];

        // 회의록 후처리 훅
        this.meetingPostProcessors = [];

        // 상태바 아이템
        this.statusBarItems = new Map();

        // 확장별 저장소 캐시
        this.storageCache = new Map();
    }

    /**
     * API 호출 라우팅
     */
    async call(extensionId, namespace, method, args) {
        const handlerKey = `${namespace}.${method}`;
        const handler = this.getHandler(handlerKey);

        if (!handler) {
            throw new Error(`Unknown API: ${handlerKey}`);
        }

        // 호출 실행
        return handler.call(this, extensionId, ...args);
    }

    /**
     * 핸들러 조회
     */
    getHandler(key) {
        const handlers = {
            // ===== files 네임스페이스 =====
            'files.onDidChange': this.filesOnDidChange,
            'files.onDidCreate': this.filesOnDidCreate,
            'files.onDidDelete': this.filesOnDidDelete,
            'files.getWatchedFolders': this.filesGetWatchedFolders,
            'files.readFile': this.filesReadFile,
            'files.getLogs': this.filesGetLogs,

            // ===== meetings 네임스페이스 =====
            'meetings.getAll': this.meetingsGetAll,
            'meetings.getById': this.meetingsGetById,
            'meetings.onCreated': this.meetingsOnCreated,
            'meetings.addPostProcessor': this.meetingsAddPostProcessor,
            'meetings.updateContent': this.meetingsUpdateContent,

            // ===== ui 네임스페이스 =====
            'ui.registerView': this.uiRegisterView,
            'ui.showNotification': this.uiShowNotification,
            'ui.showQuickPick': this.uiShowQuickPick,
            'ui.showInputBox': this.uiShowInputBox,
            'ui.registerStatusBarItem': this.uiRegisterStatusBarItem,
            'ui.updateStatusBarItem': this.uiUpdateStatusBarItem,
            'ui.removeStatusBarItem': this.uiRemoveStatusBarItem,

            // ===== commands 네임스페이스 =====
            'commands.register': this.commandsRegister,
            'commands.execute': this.commandsExecute,
            'commands.getAll': this.commandsGetAll,

            // ===== llm 네임스페이스 =====
            'llm.chat': this.llmChat,
            'llm.getModels': this.llmGetModels,
            'llm.getCurrentModel': this.llmGetCurrentModel,

            // ===== storage 네임스페이스 =====
            'storage.get': this.storageGet,
            'storage.set': this.storageSet,
            'storage.delete': this.storageDelete,
            'storage.getAll': this.storageGetAll
        };

        return handlers[key];
    }

    // ===== Files API =====

    filesOnDidChange(extensionId, pattern) {
        const hookId = `${extensionId}:change:${Date.now()}`;
        const hook = { id: hookId, extensionId, pattern, type: 'change' };
        this.fileHooks.push(hook);
        console.log(`[ExtensionAPI] 파일 변경 훅 등록: ${extensionId} (${pattern})`);
        return { hookId };
    }

    filesOnDidCreate(extensionId, pattern) {
        const hookId = `${extensionId}:create:${Date.now()}`;
        const hook = { id: hookId, extensionId, pattern, type: 'create' };
        this.fileHooks.push(hook);
        console.log(`[ExtensionAPI] 파일 생성 훅 등록: ${extensionId} (${pattern})`);
        return { hookId };
    }

    filesOnDidDelete(extensionId, pattern) {
        const hookId = `${extensionId}:delete:${Date.now()}`;
        const hook = { id: hookId, extensionId, pattern, type: 'delete' };
        this.fileHooks.push(hook);
        console.log(`[ExtensionAPI] 파일 삭제 훅 등록: ${extensionId} (${pattern})`);
        return { hookId };
    }

    async filesGetWatchedFolders(extensionId) {
        if (this.server && this.server.getWatchedFolders) {
            return this.server.getWatchedFolders();
        }
        return [];
    }

    async filesReadFile(extensionId, filePath) {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            throw new Error(`파일 읽기 실패: ${err.message}`);
        }
    }

    async filesGetLogs(extensionId, options = {}) {
        if (this.server && this.server.getLogs) {
            return this.server.getLogs(options);
        }
        return [];
    }

    // ===== Meetings API =====

    async meetingsGetAll(extensionId) {
        if (this.server && this.server.getMeetings) {
            return this.server.getMeetings();
        }
        return [];
    }

    async meetingsGetById(extensionId, meetingId) {
        if (this.server && this.server.getMeetingById) {
            return this.server.getMeetingById(meetingId);
        }
        return null;
    }

    meetingsOnCreated(extensionId) {
        const hookId = `${extensionId}:meeting:${Date.now()}`;
        console.log(`[ExtensionAPI] 회의록 생성 훅 등록: ${extensionId}`);
        return { hookId };
    }

    meetingsAddPostProcessor(extensionId, processorId) {
        const hook = { extensionId, processorId, id: `${extensionId}:post:${Date.now()}` };
        this.meetingPostProcessors.push(hook);
        console.log(`[ExtensionAPI] 회의록 후처리기 등록: ${extensionId}`);
        return { hookId: hook.id };
    }

    async meetingsUpdateContent(extensionId, meetingId, content) {
        if (this.server && this.server.updateMeetingContent) {
            return this.server.updateMeetingContent(meetingId, content);
        }
        throw new Error('회의록 업데이트 API를 사용할 수 없습니다');
    }

    // ===== UI API =====

    uiRegisterView(extensionId, viewId, options = {}) {
        const fullId = `${extensionId}.${viewId}`;
        this.views.set(fullId, {
            extensionId,
            id: viewId,
            ...options
        });

        // 렌더러에 알림
        this.notifyRenderer('extension:view-registered', { id: fullId, options });
        console.log(`[ExtensionAPI] 뷰 등록: ${fullId}`);

        return { viewId: fullId };
    }

    uiShowNotification(extensionId, message, options = {}) {
        this.notifyRenderer('extension:notification', {
            extensionId,
            message,
            type: options.type || 'info',
            duration: options.duration || 5000
        });
        return { success: true };
    }

    async uiShowQuickPick(extensionId, items, options = {}) {
        return new Promise((resolve) => {
            const id = `quickpick:${Date.now()}`;

            const handler = (result) => {
                if (result.id === id) {
                    this.removeListener('quickpick:result', handler);
                    resolve(result.selected);
                }
            };

            this.on('quickpick:result', handler);
            this.notifyRenderer('extension:quickpick', { id, items, options });

            // 타임아웃
            setTimeout(() => {
                this.removeListener('quickpick:result', handler);
                resolve(null);
            }, 60000);
        });
    }

    async uiShowInputBox(extensionId, options = {}) {
        return new Promise((resolve) => {
            const id = `inputbox:${Date.now()}`;

            const handler = (result) => {
                if (result.id === id) {
                    this.removeListener('inputbox:result', handler);
                    resolve(result.value);
                }
            };

            this.on('inputbox:result', handler);
            this.notifyRenderer('extension:inputbox', { id, options });

            // 타임아웃
            setTimeout(() => {
                this.removeListener('inputbox:result', handler);
                resolve(null);
            }, 60000);
        });
    }

    uiRegisterStatusBarItem(extensionId, options = {}) {
        const id = `${extensionId}.statusbar.${Date.now()}`;
        this.statusBarItems.set(id, { extensionId, ...options });
        this.notifyRenderer('extension:statusbar-add', { id, ...options });
        console.log(`[ExtensionAPI] 상태바 아이템 등록: ${id}`);
        return { itemId: id };
    }

    uiUpdateStatusBarItem(extensionId, itemId, options = {}) {
        if (this.statusBarItems.has(itemId)) {
            const item = this.statusBarItems.get(itemId);
            Object.assign(item, options);
            this.notifyRenderer('extension:statusbar-update', { id: itemId, ...options });
        }
        return { success: true };
    }

    uiRemoveStatusBarItem(extensionId, itemId) {
        this.statusBarItems.delete(itemId);
        this.notifyRenderer('extension:statusbar-remove', { id: itemId });
        return { success: true };
    }

    // ===== Commands API =====

    commandsRegister(extensionId, commandId, options = {}) {
        const fullId = `${extensionId}.${commandId}`;
        this.commands.set(fullId, {
            extensionId,
            id: commandId,
            title: options.title || commandId,
            category: options.category || extensionId
        });

        // 렌더러에 알림 (명령 팔레트용)
        this.notifyRenderer('extension:command-registered', {
            id: fullId,
            title: options.title,
            category: options.category
        });

        console.log(`[ExtensionAPI] 명령어 등록: ${fullId}`);
        return { commandId: fullId };
    }

    async commandsExecute(extensionId, commandId, ...args) {
        // 명령어 실행 이벤트 발생
        this.emit('command:execute', { commandId, args, requestedBy: extensionId });
        return { success: true };
    }

    commandsGetAll(extensionId) {
        return Array.from(this.commands.entries()).map(([id, cmd]) => ({
            id,
            title: cmd.title,
            category: cmd.category,
            extensionId: cmd.extensionId
        }));
    }

    // ===== LLM API =====

    async llmChat(extensionId, messages, options = {}) {
        if (this.server && this.server.chatWithLLM) {
            return this.server.chatWithLLM(messages, options);
        }

        // 서버 API가 없으면 직접 호출
        try {
            const response = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: options.model || 'qwen2.5:3b',
                    messages,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`LLM 요청 실패: ${response.status}`);
            }

            const data = await response.json();
            return { message: data.message?.content || '' };
        } catch (err) {
            throw new Error(`LLM 채팅 실패: ${err.message}`);
        }
    }

    async llmGetModels(extensionId) {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (!response.ok) {
                return [];
            }
            const data = await response.json();
            return data.models || [];
        } catch {
            return [];
        }
    }

    async llmGetCurrentModel(extensionId) {
        if (this.server && this.server.getCurrentModel) {
            return this.server.getCurrentModel();
        }
        return 'qwen2.5:3b';
    }

    // ===== Storage API =====

    storageGet(extensionId, key, defaultValue = null) {
        const data = this.loadExtensionStorage(extensionId);
        return data[key] !== undefined ? data[key] : defaultValue;
    }

    storageSet(extensionId, key, value) {
        const data = this.loadExtensionStorage(extensionId);
        data[key] = value;
        this.saveExtensionStorage(extensionId, data);
        return { success: true };
    }

    storageDelete(extensionId, key) {
        const data = this.loadExtensionStorage(extensionId);
        delete data[key];
        this.saveExtensionStorage(extensionId, data);
        return { success: true };
    }

    storageGetAll(extensionId) {
        return this.loadExtensionStorage(extensionId);
    }

    loadExtensionStorage(extensionId) {
        if (this.storageCache.has(extensionId)) {
            return this.storageCache.get(extensionId);
        }

        const storagePath = path.join(this.extensionsDir, extensionId, '.storage', 'data.json');
        let data = {};

        try {
            if (fs.existsSync(storagePath)) {
                data = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
            }
        } catch (err) {
            console.error(`[ExtensionAPI] 스토리지 로드 실패 (${extensionId}):`, err);
        }

        this.storageCache.set(extensionId, data);
        return data;
    }

    saveExtensionStorage(extensionId, data) {
        const storageDir = path.join(this.extensionsDir, extensionId, '.storage');
        const storagePath = path.join(storageDir, 'data.json');

        try {
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }
            fs.writeFileSync(storagePath, JSON.stringify(data, null, 2));
            this.storageCache.set(extensionId, data);
        } catch (err) {
            console.error(`[ExtensionAPI] 스토리지 저장 실패 (${extensionId}):`, err);
        }
    }

    // ===== 헬퍼 메서드 =====

    notifyRenderer(event, data) {
        if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send('extension-api', { event, data });
        }
    }

    // ===== 파일 이벤트 트리거 =====

    triggerFileEvent(type, filePath, eventData = {}) {
        const matchingHooks = this.fileHooks.filter(hook => {
            if (hook.type !== type) return false;
            return this.matchPattern(hook.pattern, filePath);
        });

        for (const hook of matchingHooks) {
            this.emit('file-hook-triggered', {
                extensionId: hook.extensionId,
                type,
                filePath,
                ...eventData
            });
        }

        return matchingHooks.length;
    }

    // ===== 회의록 이벤트 =====

    async triggerMeetingCreated(meeting) {
        this.emit('meeting:created', meeting);

        // 후처리기 실행
        let result = meeting;
        for (const processor of this.meetingPostProcessors) {
            this.emit('meeting-postprocess', {
                extensionId: processor.extensionId,
                meeting: result
            });
        }

        return result;
    }

    // ===== 패턴 매칭 =====

    matchPattern(pattern, filePath) {
        if (pattern === '*') return true;

        // 확장자 패턴 (*.docx)
        if (pattern.startsWith('*.')) {
            const ext = pattern.slice(1);
            return filePath.toLowerCase().endsWith(ext.toLowerCase());
        }

        // 전체 경로 패턴
        const regex = new RegExp(
            '^' + pattern
                .replace(/\\/g, '/')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.')
            + '$',
            'i'
        );

        return regex.test(filePath.replace(/\\/g, '/'));
    }

    // ===== 확장 정리 =====

    cleanupExtension(extensionId) {
        // 파일 훅 제거
        this.fileHooks = this.fileHooks.filter(h => h.extensionId !== extensionId);

        // 회의록 후처리기 제거
        this.meetingPostProcessors = this.meetingPostProcessors.filter(h => h.extensionId !== extensionId);

        // 명령어 제거
        for (const [id, cmd] of this.commands) {
            if (cmd.extensionId === extensionId) {
                this.commands.delete(id);
                this.notifyRenderer('extension:command-unregistered', { id });
            }
        }

        // 뷰 제거
        for (const [id, view] of this.views) {
            if (view.extensionId === extensionId) {
                this.views.delete(id);
                this.notifyRenderer('extension:view-unregistered', { id });
            }
        }

        // 상태바 아이템 제거
        for (const [id, item] of this.statusBarItems) {
            if (item.extensionId === extensionId) {
                this.statusBarItems.delete(id);
                this.notifyRenderer('extension:statusbar-remove', { id });
            }
        }

        // 스토리지 캐시 제거
        this.storageCache.delete(extensionId);

        console.log(`[ExtensionAPI] 확장 정리 완료: ${extensionId}`);
    }
}

module.exports = ExtensionAPI;
