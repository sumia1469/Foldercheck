/**
 * P2P 메신저 - 폐쇄망용 호스트/게스트 방식 메신저
 *
 * 호스트: TCP 서버를 열어 게스트들의 연결을 받음
 * 게스트: 호스트의 IP:PORT로 연결
 */

const net = require('net');
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

            this.server.listen(port, '0.0.0.0', () => {
                this.mode = 'host';
                console.log(`[P2P] 호스트 시작: 포트 ${port}`);
                this.emit('status', { mode: 'host', port });
                resolve({ port });
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
                console.log(`[P2P] 서버 연결됨: ${host}:${port}`);

                // 서버에 입장 알림
                this._sendToServer({
                    type: 'join',
                    nickname: this.nickname
                });

                this.emit('status', { mode: 'guest', host, port });
                resolve({ host, port });
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

            this.mode = 'offline';
            console.log('[P2P] 연결 해제됨');
            this.emit('status', { mode: 'offline' });
            resolve();
        });
    }

    /**
     * 메시지 전송
     */
    sendMessage(content) {
        const message = {
            type: 'chat',
            id: crypto.randomUUID(),
            nickname: this.nickname,
            content,
            timestamp: Date.now()
        };

        if (this.mode === 'host') {
            // 호스트: 자신의 메시지를 모든 클라이언트에게 브로드캐스트
            this._broadcast(message);
            this.messageHistory.push(message);
            this.emit('message', message);
        } else if (this.mode === 'guest') {
            // 게스트: 서버에 메시지 전송
            this._sendToServer(message);
        }

        return message;
    }

    /**
     * 파일 전송 시작
     */
    async sendFile(filePath) {
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
            timestamp: Date.now()
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
            nickname: this.nickname
        };

        if (this.mode === 'host') {
            this._broadcast(completeMsg);
            this.emit('file_sent', { filename, size: stats.size });
        } else {
            this._sendToServer(completeMsg);
        }

        return { transferId, filename, size: stats.size };
    }

    /**
     * 현재 상태 조회
     */
    getStatus() {
        return {
            mode: this.mode,
            nickname: this.nickname,
            port: this.hostPort,
            connectedUsers: this.mode === 'host' ?
                Array.from(this.users.values()) :
                [],
            userCount: this.users.size
        };
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

                // 사용자 목록 전송
                this._sendToClient(clientId, {
                    type: 'user_list',
                    users: Array.from(this.users.values()).map(u => ({
                        nickname: u.nickname
                    })),
                    hostNickname: this.nickname
                });
                break;

            case 'leave':
                // leave는 close 이벤트에서 처리
                break;

            case 'chat':
                msg.nickname = this.users.get(clientId)?.nickname || msg.nickname;
                this._broadcast(msg);
                this.messageHistory.push(msg);
                this.emit('message', msg);
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
                // 호스트 추가
                this.users.set('host', { nickname: msg.hostNickname });
                // 다른 사용자들 추가
                msg.users.forEach((u, i) => {
                    this.users.set(`user_${i}`, u);
                });
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
            totalChunks: Math.ceil(msg.size / (64 * 1024))
        });

        this.emit('file_start', {
            transferId: msg.transferId,
            filename: msg.filename,
            size: msg.size,
            from: msg.nickname
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
            from: transfer.nickname
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
}

module.exports = P2PMessenger;
