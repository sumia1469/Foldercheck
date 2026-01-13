/**
 * P2P 메신저 - 폐쇄망용 호스트/게스트 방식 메신저
 *
 * 호스트: TCP 서버를 열어 게스트들의 연결을 받음
 * 게스트: 호스트의 IP:PORT로 연결
 */

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class P2PMessenger extends EventEmitter {
    constructor() {
        super();
        this.server = null;
        this.clients = new Map(); // clientId -> socket
        this.clientSocket = null; // 게스트 모드일 때 서버 연결
        this.mode = 'offline'; // 'offline' | 'host' | 'guest'
        this.nickname = 'User';
        this.hostPort = 9900;
        this.users = new Map(); // clientId -> { nickname, ip }
        this.messageHistory = [];
        this.fileTransfers = new Map(); // transferId -> { filename, chunks, received }
        this.pendingFiles = new Map(); // transferId -> { filename, data, totalSize }

        // 클라우드 파일 서버
        this.httpServer = null;
        this.cloudPort = 9901; // HTTP 파일 서버 포트
        this.cloudFiles = new Map(); // fileId -> { filename, originalName, size, uploadedBy, uploadedAt, downloadCount }
        this.cloudStoragePath = null; // 파일 저장 경로

        // 게스트 모드용 호스트 정보
        this.hostIP = null;
        this.hostPort = null;
        this.hostCloudPort = null;
    }

    /**
     * 호스트 모드 시작
     */
    startHost(port = 9900, nickname = 'Host') {
        return new Promise((resolve, reject) => {
            if (this.mode !== 'offline') {
                reject(new Error('이미 연결 중입니다. 먼저 연결을 해제하세요.'));
                return;
            }

            this.nickname = nickname;
            this.hostPort = port;

            this.server = net.createServer((socket) => {
                this._handleNewClient(socket);
            });

            this.server.on('error', (err) => {
                console.error('[P2P] 서버 에러:', err.message);
                this.emit('error', { type: 'server', message: err.message });
                reject(err);
            });

            this.server.listen(port, '0.0.0.0', async () => {
                this.mode = 'host';
                // 호스트 자신을 사용자 목록에 추가
                this.users.set('host', { nickname: this.nickname, isHost: true });
                console.log(`[P2P] 호스트 시작: 포트 ${port}`);

                // 클라우드 파일 서버 시작
                try {
                    await this._startCloudServer(port + 1);
                    console.log(`[P2P] 클라우드 파일 서버 시작: 포트 ${this.cloudPort}`);
                } catch (cloudErr) {
                    console.error('[P2P] 클라우드 서버 시작 실패:', cloudErr.message);
                }

                this.emit('status', { mode: 'host', port, cloudPort: this.cloudPort });
                this.emit('user_list', this.getUsers());
                resolve({ success: true, port, cloudPort: this.cloudPort });
            });
        });
    }

    /**
     * 호스트 중지
     */
    stopHost() {
        return new Promise((resolve) => {
            if (this.mode !== 'host') {
                resolve();
                return;
            }

            // 모든 클라이언트에게 서버 종료 알림
            this._broadcast({
                type: 'server_shutdown',
                message: '호스트가 서버를 종료했습니다.'
            });

            // 모든 클라이언트 연결 종료
            for (const [clientId, socket] of this.clients) {
                socket.destroy();
            }
            this.clients.clear();
            this.users.clear();

            // 클라우드 서버 종료
            if (this.httpServer) {
                this.httpServer.close();
                this.httpServer = null;
                console.log('[P2P] 클라우드 파일 서버 중지됨');
            }

            // 서버 종료
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    this.mode = 'offline';
                    console.log('[P2P] 호스트 중지됨');
                    this.emit('status', { mode: 'offline' });
                    resolve();
                });
            } else {
                this.mode = 'offline';
                resolve();
            }
        });
    }

    /**
     * 게스트 모드: 호스트에 연결
     */
    connect(host, port, nickname = 'Guest') {
        return new Promise((resolve, reject) => {
            if (this.mode !== 'offline') {
                reject(new Error('이미 연결 중입니다. 먼저 연결을 해제하세요.'));
                return;
            }

            this.nickname = nickname;

            this.clientSocket = net.createConnection({ host, port }, () => {
                this.mode = 'guest';
                // 호스트 정보 저장 (다운로드용)
                this.hostIP = host;
                this.hostPort = port;
                console.log(`[P2P] 서버 연결됨: ${host}:${port}`);

                // 서버에 입장 알림
                this._sendToServer({
                    type: 'join',
                    nickname: this.nickname
                });

                this.emit('status', { mode: 'guest', host, port });
                resolve({ success: true, host, port });
            });

            this.clientSocket.on('data', (data) => {
                this._handleServerData(data);
            });

            this.clientSocket.on('error', (err) => {
                console.error('[P2P] 연결 에러:', err.message);
                this.emit('error', { type: 'connection', message: err.message });
                reject(err);
            });

            this.clientSocket.on('close', () => {
                if (this.mode === 'guest') {
                    this.mode = 'offline';
                    this.clientSocket = null;
                    console.log('[P2P] 서버 연결 종료');
                    this.emit('status', { mode: 'offline' });
                    this.emit('disconnected', { reason: 'connection_closed' });
                }
            });

            // 연결 타임아웃
            setTimeout(() => {
                if (this.mode === 'offline' && this.clientSocket) {
                    this.clientSocket.destroy();
                    reject(new Error('연결 시간 초과'));
                }
            }, 10000);
        });
    }

    /**
     * 게스트 모드: 연결 해제
     */
    disconnect() {
        return new Promise((resolve) => {
            if (this.mode !== 'guest') {
                resolve();
                return;
            }

            // 서버에 퇴장 알림
            this._sendToServer({
                type: 'leave',
                nickname: this.nickname
            });

            if (this.clientSocket) {
                this.clientSocket.destroy();
                this.clientSocket = null;
            }

            // 호스트 정보 초기화
            this.hostIP = null;
            this.hostPort = null;
            this.hostCloudPort = null;

            this.mode = 'offline';
            console.log('[P2P] 연결 해제됨');
            this.emit('status', { mode: 'offline' });
            resolve();
        });
    }

    /**
     * 메시지 전송
     * @param {string} content - 메시지 내용
     * @param {Object} options - 옵션
     * @param {string} options.targetNickname - 1:1 채팅 대상 닉네임 (지정 시 해당 사용자에게만 전송)
     * @param {string} options.roomId - 채팅방 ID
     */
    sendMessage(content, options = {}) {
        console.log('[P2P] sendMessage 호출 - mode:', this.mode, 'targetNickname:', options.targetNickname);

        const message = {
            type: 'chat',
            id: crypto.randomUUID(),
            nickname: this.nickname,
            content,
            timestamp: Date.now(),
            targetNickname: options.targetNickname || null, // 1:1 채팅 대상
            roomId: options.roomId || null // 채팅방 ID
        };

        if (this.mode === 'host') {
            if (options.targetNickname) {
                // 1:1 채팅: 특정 사용자에게만 전송
                console.log('[P2P Host] 1:1 메시지 전송 to:', options.targetNickname);
                this._sendToUser(options.targetNickname, message);
                // 호스트 자신에게도 메시지 표시 (이미 화면에 표시됨)
            } else {
                // 그룹 채팅: 모든 클라이언트에게 브로드캐스트
                console.log('[P2P Host] 그룹 메시지 브로드캐스트');
                this._broadcast(message);
            }
            this.messageHistory.push(message);
            this.emit('message', message);
        } else if (this.mode === 'guest') {
            // 게스트: 서버에 메시지 전송
            console.log('[P2P Guest] 서버로 메시지 전송');
            this._sendToServer(message);
        }

        return message;
    }

    /**
     * 특정 닉네임의 사용자에게 메시지 전송 (호스트용)
     */
    _sendToUser(targetNickname, msg) {
        console.log('[P2P] _sendToUser 호출 - targetNickname:', targetNickname, '현재 users:', Array.from(this.users.entries()));
        for (const [clientId, user] of this.users) {
            if (user.nickname === targetNickname) {
                console.log('[P2P] 대상 찾음 - clientId:', clientId, 'nickname:', user.nickname);
                this._sendToClient(clientId, msg);
                return;
            }
        }
        console.warn(`[P2P] 대상 사용자를 찾을 수 없음: ${targetNickname}`);
    }

    /**
     * 파일 전송 시작
     * @param {string} filePath - 파일 경로
     * @param {Object} cloudInfo - 클라우드 업로드 정보 (선택)
     * @param {string} cloudInfo.cloudFileId - 클라우드 파일 ID
     * @param {string} cloudInfo.cloudUrl - 클라우드 다운로드 URL
     */
    async sendFile(filePath, cloudInfo = null) {
        if (this.mode === 'offline') {
            throw new Error('연결되지 않았습니다.');
        }

        const stats = fs.statSync(filePath);
        const filename = path.basename(filePath);
        const fileData = fs.readFileSync(filePath);
        const transferId = crypto.randomUUID();

        const fileInfo = {
            type: 'file_start',
            transferId,
            filename,
            size: stats.size,
            nickname: this.nickname,
            timestamp: Date.now(),
            // 클라우드 정보 추가
            cloudFileId: cloudInfo?.cloudFileId || '',
            cloudUrl: cloudInfo?.cloudUrl || ''
        };

        // 파일 정보 전송
        if (this.mode === 'host') {
            this._broadcast(fileInfo);
        } else {
            this._sendToServer(fileInfo);
        }

        // 파일 데이터를 청크로 분할하여 전송
        const CHUNK_SIZE = 64 * 1024; // 64KB
        const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, fileData.length);
            const chunk = fileData.slice(start, end);

            const chunkData = {
                type: 'file_chunk',
                transferId,
                chunkIndex: i,
                totalChunks,
                data: chunk.toString('base64')
            };

            if (this.mode === 'host') {
                this._broadcast(chunkData);
            } else {
                this._sendToServer(chunkData);
            }

            // 너무 빠른 전송 방지
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // 전송 완료 알림
        const completeMsg = {
            type: 'file_complete',
            transferId,
            filename,
            nickname: this.nickname,
            cloudFileId: cloudInfo?.cloudFileId || '',
            cloudUrl: cloudInfo?.cloudUrl || ''
        };

        if (this.mode === 'host') {
            this._broadcast(completeMsg);
        } else {
            this._sendToServer(completeMsg);
        }

        // 호스트/게스트 모두 파일 전송 완료 이벤트 발생
        this.emit('file_sent', {
            filename,
            size: stats.size,
            cloudFileId: cloudInfo?.cloudFileId || '',
            cloudUrl: cloudInfo?.cloudUrl || ''
        });

        return {
            transferId,
            filename,
            size: stats.size,
            cloudFileId: cloudInfo?.cloudFileId || '',
            cloudUrl: cloudInfo?.cloudUrl || ''
        };
    }

    /**
     * 현재 상태 조회
     */
    getStatus() {
        const status = {
            mode: this.mode,
            nickname: this.nickname,
            port: this.hostPort,
            connectedUsers: this.mode === 'host' ?
                Array.from(this.users.values()) :
                [],
            userCount: this.users.size
        };

        // 호스트 모드인 경우 클라우드 포트 추가
        if (this.mode === 'host') {
            status.cloudPort = this.cloudPort;
        }
        // 게스트 모드인 경우 호스트 정보 추가 (파일 다운로드용)
        else if (this.mode === 'guest') {
            status.host = this.hostIP;
            status.port = this.hostPort;
            status.cloudPort = this.hostCloudPort;
        }

        return status;
    }

    /**
     * 사용자 목록 조회
     */
    getUsers() {
        return Array.from(this.users.values());
    }

    /**
     * 메시지 히스토리 조회
     */
    getHistory() {
        return this.messageHistory.slice(-100); // 최근 100개
    }

    // ========== Private Methods ==========

    /**
     * 새 클라이언트 연결 처리 (호스트 모드)
     */
    _handleNewClient(socket) {
        const clientId = crypto.randomUUID();
        const clientInfo = {
            id: clientId,
            ip: socket.remoteAddress,
            nickname: 'Unknown'
        };

        this.clients.set(clientId, socket);
        console.log(`[P2P] 새 클라이언트 연결: ${socket.remoteAddress}`);

        let buffer = '';

        socket.on('data', (data) => {
            buffer += data.toString();

            // 줄바꿈으로 메시지 구분
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 마지막 불완전한 줄은 버퍼에 유지

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const msg = JSON.parse(line);
                        this._handleClientMessage(clientId, clientInfo, msg);
                    } catch (e) {
                        console.error('[P2P] 메시지 파싱 에러:', e.message);
                    }
                }
            }
        });

        socket.on('close', () => {
            this.clients.delete(clientId);
            const user = this.users.get(clientId);
            this.users.delete(clientId);

            if (user) {
                const leaveMsg = {
                    type: 'system',
                    content: `${user.nickname}님이 퇴장했습니다.`,
                    timestamp: Date.now()
                };
                this._broadcast(leaveMsg);
                this.emit('user_left', { nickname: user.nickname });

                // 호스트에게 업데이트된 사용자 목록 알림
                const userList = Array.from(this.users.values()).map(u => ({
                    nickname: u.nickname,
                    isHost: u.isHost || false
                }));
                this.emit('user_list', userList);
            }

            console.log(`[P2P] 클라이언트 연결 종료: ${clientId}`);
        });

        socket.on('error', (err) => {
            console.error(`[P2P] 클라이언트 에러 (${clientId}):`, err.message);
        });
    }

    /**
     * 클라이언트 메시지 처리 (호스트 모드)
     */
    _handleClientMessage(clientId, clientInfo, msg) {
        switch (msg.type) {
            case 'join':
                clientInfo.nickname = msg.nickname;
                this.users.set(clientId, {
                    id: clientId,
                    nickname: msg.nickname,
                    ip: clientInfo.ip
                });

                // 입장 알림 브로드캐스트
                const joinMsg = {
                    type: 'system',
                    content: `${msg.nickname}님이 입장했습니다.`,
                    timestamp: Date.now()
                };
                this._broadcast(joinMsg);
                this.messageHistory.push(joinMsg);
                this.emit('message', joinMsg);
                this.emit('user_joined', { nickname: msg.nickname });

                // 사용자 목록 전송 (호스트 포함, cloudPort 포함)
                const userList = Array.from(this.users.values()).map(u => ({
                    nickname: u.nickname,
                    isHost: u.isHost || false
                }));
                this._sendToClient(clientId, {
                    type: 'user_list',
                    users: userList,
                    hostNickname: this.nickname,
                    cloudPort: this.cloudPort  // 클라우드 서버 포트 정보 추가
                });

                // 호스트에게도 업데이트된 사용자 목록 알림
                this.emit('user_list', userList);
                break;

            case 'leave':
                // leave는 close 이벤트에서 처리
                break;

            case 'chat':
                msg.nickname = this.users.get(clientId)?.nickname || msg.nickname;
                console.log('[P2P Host] 채팅 메시지 수신 - from:', msg.nickname, 'targetNickname:', msg.targetNickname, 'content:', msg.content?.substring(0, 20));

                if (msg.targetNickname) {
                    // 1:1 채팅: 대상 사용자에게만 전달
                    if (msg.targetNickname === this.nickname) {
                        // 호스트에게 보낸 메시지
                        console.log('[P2P Host] 호스트에게 보낸 1:1 메시지 - emit');
                        this.emit('message', msg);
                    } else {
                        // 다른 사용자에게 보낸 메시지 - 해당 사용자에게만 전달
                        console.log('[P2P Host] 다른 게스트에게 전달:', msg.targetNickname);
                        this._sendToUser(msg.targetNickname, msg);
                    }
                    // 발신자에게도 메시지 전달 (확인용) - 발신자 제외
                } else {
                    // 그룹 채팅: 보낸 클라이언트 제외하고 브로드캐스트
                    console.log('[P2P Host] 그룹 채팅 브로드캐스트');
                    this._broadcastExcept(clientId, msg);
                    this.emit('message', msg);
                }
                this.messageHistory.push(msg);
                break;

            case 'file_start':
            case 'file_chunk':
            case 'file_complete':
                // 파일 전송 메시지는 다른 클라이언트들에게 브로드캐스트
                this._broadcastExcept(clientId, msg);
                if (msg.type === 'file_start') {
                    this._handleFileStart(msg);
                } else if (msg.type === 'file_chunk') {
                    this._handleFileChunk(msg);
                } else if (msg.type === 'file_complete') {
                    this._handleFileComplete(msg);
                }
                break;
        }
    }

    /**
     * 서버 데이터 처리 (게스트 모드)
     */
    _handleServerData(data) {
        const lines = data.toString().split('\n');

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const msg = JSON.parse(line);
                    this._handleServerMessage(msg);
                } catch (e) {
                    console.error('[P2P] 서버 메시지 파싱 에러:', e.message);
                }
            }
        }
    }

    /**
     * 서버 메시지 처리 (게스트 모드)
     */
    _handleServerMessage(msg) {
        switch (msg.type) {
            case 'system':
            case 'chat':
                this.messageHistory.push(msg);
                this.emit('message', msg);
                break;

            case 'user_list':
                this.users.clear();
                // 사용자들 추가 (호스트는 msg.users에 isHost: true로 이미 포함되어 있음)
                msg.users.forEach((u, i) => {
                    this.users.set(`user_${i}`, u);
                });
                // 호스트의 클라우드 포트 저장 (게스트가 다운로드할 때 필요)
                if (msg.cloudPort) {
                    this.hostCloudPort = msg.cloudPort;
                    console.log(`[P2P] 호스트 클라우드 포트 저장: ${this.hostCloudPort}`);
                }
                this.emit('user_list', msg.users);
                break;

            case 'server_shutdown':
                this.emit('disconnected', { reason: 'server_shutdown', message: msg.message });
                this.mode = 'offline';
                if (this.clientSocket) {
                    this.clientSocket.destroy();
                    this.clientSocket = null;
                }
                break;

            case 'file_start':
                this._handleFileStart(msg);
                break;

            case 'file_chunk':
                this._handleFileChunk(msg);
                break;

            case 'file_complete':
                this._handleFileComplete(msg);
                break;
        }
    }

    /**
     * 파일 전송 시작 처리
     */
    _handleFileStart(msg) {
        this.fileTransfers.set(msg.transferId, {
            filename: msg.filename,
            size: msg.size,
            nickname: msg.nickname,
            chunks: [],
            totalChunks: Math.ceil(msg.size / (64 * 1024)),
            // 클라우드 정보 저장
            cloudFileId: msg.cloudFileId || '',
            cloudUrl: msg.cloudUrl || ''
        });

        this.emit('file_start', {
            transferId: msg.transferId,
            filename: msg.filename,
            size: msg.size,
            from: msg.nickname,
            cloudFileId: msg.cloudFileId || '',
            cloudUrl: msg.cloudUrl || ''
        });
    }

    /**
     * 파일 청크 처리
     */
    _handleFileChunk(msg) {
        const transfer = this.fileTransfers.get(msg.transferId);
        if (!transfer) return;

        transfer.chunks[msg.chunkIndex] = Buffer.from(msg.data, 'base64');

        // 진행률 이벤트
        const progress = Math.round((msg.chunkIndex + 1) / msg.totalChunks * 100);
        this.emit('file_progress', {
            transferId: msg.transferId,
            filename: transfer.filename,
            progress
        });
    }

    /**
     * 파일 전송 완료 처리
     */
    _handleFileComplete(msg) {
        const transfer = this.fileTransfers.get(msg.transferId);
        if (!transfer) return;

        // 청크 합치기
        const fileData = Buffer.concat(transfer.chunks);

        this.emit('file_received', {
            transferId: msg.transferId,
            filename: transfer.filename,
            size: fileData.length,
            data: fileData,
            from: transfer.nickname,
            // 클라우드 정보 전달
            cloudFileId: transfer.cloudFileId || msg.cloudFileId || '',
            cloudUrl: transfer.cloudUrl || msg.cloudUrl || ''
        });

        this.fileTransfers.delete(msg.transferId);
    }

    /**
     * 모든 클라이언트에게 브로드캐스트 (호스트 모드)
     */
    _broadcast(msg) {
        const data = JSON.stringify(msg) + '\n';
        for (const [clientId, socket] of this.clients) {
            try {
                socket.write(data);
            } catch (e) {
                console.error(`[P2P] 브로드캐스트 에러 (${clientId}):`, e.message);
            }
        }
    }

    /**
     * 특정 클라이언트 제외하고 브로드캐스트
     */
    _broadcastExcept(excludeClientId, msg) {
        const data = JSON.stringify(msg) + '\n';
        for (const [clientId, socket] of this.clients) {
            if (clientId !== excludeClientId) {
                try {
                    socket.write(data);
                } catch (e) {
                    console.error(`[P2P] 브로드캐스트 에러 (${clientId}):`, e.message);
                }
            }
        }
    }

    /**
     * 특정 클라이언트에게 전송
     */
    _sendToClient(clientId, msg) {
        const socket = this.clients.get(clientId);
        if (socket) {
            socket.write(JSON.stringify(msg) + '\n');
        }
    }

    /**
     * 서버에 전송 (게스트 모드)
     */
    _sendToServer(msg) {
        if (this.clientSocket) {
            this.clientSocket.write(JSON.stringify(msg) + '\n');
        }
    }

    // ========== 클라우드 파일 서버 ==========

    /**
     * 클라우드 파일 서버 시작
     */
    _startCloudServer(port) {
        return new Promise((resolve, reject) => {
            this.cloudPort = port;

            // 저장 경로 설정
            const { app } = require('electron');
            this.cloudStoragePath = path.join(app.getPath('userData'), 'cloud-files');

            // 저장 폴더 생성
            if (!fs.existsSync(this.cloudStoragePath)) {
                fs.mkdirSync(this.cloudStoragePath, { recursive: true });
            }

            // 메타데이터 파일 로드
            this._loadCloudMetadata();

            this.httpServer = http.createServer((req, res) => {
                this._handleCloudRequest(req, res);
            });

            this.httpServer.on('error', (err) => {
                console.error('[Cloud] HTTP 서버 에러:', err.message);
                reject(err);
            });

            this.httpServer.listen(port, '0.0.0.0', () => {
                resolve({ port });
            });
        });
    }

    /**
     * 클라우드 메타데이터 로드
     */
    _loadCloudMetadata() {
        const metaPath = path.join(this.cloudStoragePath, 'metadata.json');
        if (fs.existsSync(metaPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                this.cloudFiles = new Map(Object.entries(data));
                console.log(`[Cloud] ${this.cloudFiles.size}개 파일 메타데이터 로드됨`);
            } catch (e) {
                console.error('[Cloud] 메타데이터 로드 실패:', e.message);
            }
        }
    }

    /**
     * 클라우드 메타데이터 저장
     */
    _saveCloudMetadata() {
        const metaPath = path.join(this.cloudStoragePath, 'metadata.json');
        const data = Object.fromEntries(this.cloudFiles);
        fs.writeFileSync(metaPath, JSON.stringify(data, null, 2));
    }

    /**
     * HTTP 요청 처리
     */
    _handleCloudRequest(req, res) {
        // CORS 헤더
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        // 라우팅
        if (req.method === 'GET' && pathname === '/files') {
            this._handleListFiles(req, res);
        } else if (req.method === 'GET' && pathname.startsWith('/files/')) {
            this._handleDownloadFile(req, res, pathname);
        } else if (req.method === 'POST' && pathname === '/upload') {
            this._handleUploadFile(req, res);
        } else if (req.method === 'DELETE' && pathname.startsWith('/files/')) {
            this._handleDeleteFile(req, res, pathname);
        } else if (req.method === 'GET' && pathname === '/status') {
            this._handleServerStatus(req, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    /**
     * 파일 목록 조회
     */
    _handleListFiles(req, res) {
        const files = Array.from(this.cloudFiles.entries()).map(([id, file]) => ({
            id,
            ...file,
            downloadUrl: `/files/${id}/${encodeURIComponent(file.originalName)}`
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files, total: files.length }));
    }

    /**
     * 파일 다운로드
     */
    _handleDownloadFile(req, res, pathname) {
        // /files/{fileId}/{filename} 형식
        const parts = pathname.split('/');
        const fileId = parts[2];
        const fileInfo = this.cloudFiles.get(fileId);

        if (!fileInfo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        const filePath = path.join(this.cloudStoragePath, fileInfo.filename);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found on disk' }));
            return;
        }

        // 다운로드 카운트 증가
        fileInfo.downloadCount = (fileInfo.downloadCount || 0) + 1;
        this._saveCloudMetadata();

        // 파일 스트리밍
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileInfo.originalName)}`,
            'Content-Length': stat.size
        });

        fs.createReadStream(filePath).pipe(res);
    }

    /**
     * 파일 업로드
     */
    _handleUploadFile(req, res) {
        const contentType = req.headers['content-type'] || '';

        // multipart/form-data 처리
        if (contentType.includes('multipart/form-data')) {
            this._handleMultipartUpload(req, res, contentType);
        } else {
            // 단순 바이너리 업로드
            this._handleBinaryUpload(req, res);
        }
    }

    /**
     * Multipart 파일 업로드 처리
     */
    _handleMultipartUpload(req, res, contentType) {
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid multipart request' }));
            return;
        }

        let body = Buffer.alloc(0);

        req.on('data', (chunk) => {
            body = Buffer.concat([body, chunk]);
        });

        req.on('end', () => {
            try {
                const result = this._parseMultipart(body, boundary);
                if (!result || !result.file) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No file found in request' }));
                    return;
                }

                const fileId = crypto.randomUUID();
                const ext = path.extname(result.filename);
                const storedFilename = `${fileId}${ext}`;
                const filePath = path.join(this.cloudStoragePath, storedFilename);

                fs.writeFileSync(filePath, result.file);

                const fileInfo = {
                    filename: storedFilename,
                    originalName: result.filename,
                    size: result.file.length,
                    uploadedBy: result.uploadedBy || this.nickname,
                    uploadedAt: new Date().toISOString(),
                    downloadCount: 0
                };

                this.cloudFiles.set(fileId, fileInfo);
                this._saveCloudMetadata();

                console.log(`[Cloud] 파일 업로드: ${result.filename} (${this._formatSize(result.file.length)})`);

                this.emit('cloud_file_uploaded', {
                    fileId,
                    ...fileInfo
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    fileId,
                    filename: result.filename,
                    size: result.file.length,
                    downloadUrl: `/files/${fileId}/${encodeURIComponent(result.filename)}`
                }));
            } catch (e) {
                console.error('[Cloud] 업로드 처리 에러:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    }

    /**
     * 바이너리 파일 업로드 처리
     */
    _handleBinaryUpload(req, res) {
        const filename = req.headers['x-filename'] || 'uploaded_file';
        const uploadedBy = req.headers['x-uploaded-by'] || this.nickname;

        let body = Buffer.alloc(0);

        req.on('data', (chunk) => {
            body = Buffer.concat([body, chunk]);
        });

        req.on('end', () => {
            try {
                const fileId = crypto.randomUUID();
                const ext = path.extname(filename);
                const storedFilename = `${fileId}${ext}`;
                const filePath = path.join(this.cloudStoragePath, storedFilename);

                fs.writeFileSync(filePath, body);

                const fileInfo = {
                    filename: storedFilename,
                    originalName: filename,
                    size: body.length,
                    uploadedBy,
                    uploadedAt: new Date().toISOString(),
                    downloadCount: 0
                };

                this.cloudFiles.set(fileId, fileInfo);
                this._saveCloudMetadata();

                console.log(`[Cloud] 파일 업로드: ${filename} (${this._formatSize(body.length)})`);

                this.emit('cloud_file_uploaded', {
                    fileId,
                    ...fileInfo
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    fileId,
                    filename,
                    size: body.length,
                    downloadUrl: `/files/${fileId}/${encodeURIComponent(filename)}`
                }));
            } catch (e) {
                console.error('[Cloud] 업로드 처리 에러:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    }

    /**
     * Multipart 데이터 파싱
     */
    _parseMultipart(body, boundary) {
        const boundaryBuffer = Buffer.from(`--${boundary}`);
        const parts = [];
        let start = 0;

        while (true) {
            const idx = body.indexOf(boundaryBuffer, start);
            if (idx === -1) break;

            if (start > 0) {
                parts.push(body.slice(start, idx - 2)); // -2 for \r\n
            }
            start = idx + boundaryBuffer.length + 2; // +2 for \r\n
        }

        for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;

            const header = part.slice(0, headerEnd).toString();
            const content = part.slice(headerEnd + 4);

            const filenameMatch = header.match(/filename="([^"]+)"/);
            const nameMatch = header.match(/name="([^"]+)"/);

            if (filenameMatch) {
                const uploadedByMatch = header.match(/x-uploaded-by:\s*([^\r\n]+)/i);
                return {
                    filename: filenameMatch[1],
                    file: content,
                    uploadedBy: uploadedByMatch ? uploadedByMatch[1] : null
                };
            }
        }

        return null;
    }

    /**
     * 파일 삭제
     */
    _handleDeleteFile(req, res, pathname) {
        const parts = pathname.split('/');
        const fileId = parts[2];
        const fileInfo = this.cloudFiles.get(fileId);

        if (!fileInfo) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        // 파일 삭제
        const filePath = path.join(this.cloudStoragePath, fileInfo.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        this.cloudFiles.delete(fileId);
        this._saveCloudMetadata();

        console.log(`[Cloud] 파일 삭제: ${fileInfo.originalName}`);

        this.emit('cloud_file_deleted', { fileId, filename: fileInfo.originalName });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    /**
     * 서버 상태 조회
     */
    _handleServerStatus(req, res) {
        const totalSize = Array.from(this.cloudFiles.values())
            .reduce((sum, f) => sum + f.size, 0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            port: this.cloudPort,
            fileCount: this.cloudFiles.size,
            totalSize,
            totalSizeFormatted: this._formatSize(totalSize)
        }));
    }

    /**
     * 파일 크기 포맷
     */
    _formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    // ========== 클라우드 공개 API ==========

    /**
     * 클라우드 파일 목록 조회
     */
    getCloudFiles() {
        return Array.from(this.cloudFiles.entries()).map(([id, file]) => ({
            id,
            ...file,
            downloadUrl: `/files/${id}/${encodeURIComponent(file.originalName)}`
        }));
    }

    /**
     * 클라우드 서버 상태 조회
     */
    getCloudStatus() {
        if (!this.httpServer) {
            return { status: 'stopped' };
        }

        const totalSize = Array.from(this.cloudFiles.values())
            .reduce((sum, f) => sum + f.size, 0);

        return {
            status: 'running',
            port: this.cloudPort,
            fileCount: this.cloudFiles.size,
            totalSize,
            totalSizeFormatted: this._formatSize(totalSize)
        };
    }

    /**
     * 파일을 클라우드에 업로드 (로컬 파일 경로 기반)
     */
    async uploadToCloud(filePath) {
        if (!this.httpServer && this.mode !== 'host') {
            throw new Error('클라우드 서버가 실행 중이 아닙니다.');
        }

        const stats = fs.statSync(filePath);
        const originalName = path.basename(filePath);
        const fileData = fs.readFileSync(filePath);

        const fileId = crypto.randomUUID();
        const ext = path.extname(originalName);
        const storedFilename = `${fileId}${ext}`;
        const storagePath = path.join(this.cloudStoragePath, storedFilename);

        fs.writeFileSync(storagePath, fileData);

        const fileInfo = {
            filename: storedFilename,
            originalName,
            size: stats.size,
            uploadedBy: this.nickname,
            uploadedAt: new Date().toISOString(),
            downloadCount: 0
        };

        this.cloudFiles.set(fileId, fileInfo);
        this._saveCloudMetadata();

        console.log(`[Cloud] 파일 업로드: ${originalName} (${this._formatSize(stats.size)})`);

        this.emit('cloud_file_uploaded', {
            fileId,
            ...fileInfo
        });

        return {
            fileId,
            filename: originalName,
            size: stats.size,
            downloadUrl: `/files/${fileId}/${encodeURIComponent(originalName)}`
        };
    }

    /**
     * 클라우드에서 파일 삭제
     */
    deleteFromCloud(fileId) {
        const fileInfo = this.cloudFiles.get(fileId);
        if (!fileInfo) {
            throw new Error('파일을 찾을 수 없습니다.');
        }

        const filePath = path.join(this.cloudStoragePath, fileInfo.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        this.cloudFiles.delete(fileId);
        this._saveCloudMetadata();

        this.emit('cloud_file_deleted', { fileId, filename: fileInfo.originalName });

        return { success: true };
    }
}

module.exports = P2PMessenger;
