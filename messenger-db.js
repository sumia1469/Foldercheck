/**
 * P2P 메신저 데이터베이스 관리
 * 사용자, 그룹, 채팅방, 메시지 저장을 위한 SQLite 데이터베이스
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// better-sqlite3 사용 (동기식, 빠름)
let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.log('[MessengerDB] better-sqlite3를 찾을 수 없습니다. sql.js로 대체합니다.');
    Database = null;
}

// 사용자 데이터 디렉토리
function getUserDataDir() {
    const appName = 'docwatch';
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', appName);
    } else if (process.platform === 'win32') {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), appName);
    } else {
        return path.join(os.homedir(), '.config', appName);
    }
}

class MessengerDB {
    constructor() {
        this.db = null;
        this.dbPath = path.join(getUserDataDir(), 'messenger.db');
    }

    /**
     * 데이터베이스 초기화
     */
    async initialize() {
        try {
            // 디렉토리 생성
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (Database) {
                this.db = new Database(this.dbPath);
                this.db.pragma('journal_mode = WAL');
            } else {
                // sql.js 폴백 (더 느리지만 네이티브 빌드 필요 없음)
                const initSqlJs = require('sql.js');

                // WASM 파일 경로 설정
                let wasmPath;
                try {
                    // node_modules에서 sql.js wasm 파일 찾기
                    const sqlJsPath = require.resolve('sql.js');
                    const sqlJsDir = path.dirname(sqlJsPath);

                    // 여러 가능한 경로 확인
                    const possiblePaths = [
                        path.join(sqlJsDir, 'dist', 'sql-wasm.wasm'),
                        path.join(sqlJsDir, 'sql-wasm.wasm'),
                        path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
                    ];

                    for (const p of possiblePaths) {
                        if (fs.existsSync(p)) {
                            wasmPath = p;
                            break;
                        }
                    }

                    console.log('[MessengerDB] WASM 파일 경로:', wasmPath);
                } catch (e) {
                    console.error('[MessengerDB] WASM 경로 찾기 실패:', e);
                }

                // sql.js 초기화 옵션
                const initOptions = {};
                if (wasmPath && fs.existsSync(wasmPath)) {
                    initOptions.locateFile = (file) => {
                        if (file.endsWith('.wasm')) {
                            return wasmPath;
                        }
                        return file;
                    };
                }

                const SQL = await initSqlJs(initOptions);

                if (fs.existsSync(this.dbPath)) {
                    const buffer = fs.readFileSync(this.dbPath);
                    this.db = new SQL.Database(buffer);
                } else {
                    this.db = new SQL.Database();
                }
                this.isSqlJs = true;
            }

            this.createTables();
            console.log('[MessengerDB] 데이터베이스 초기화 완료:', this.dbPath);
            return true;
        } catch (err) {
            console.error('[MessengerDB] 초기화 실패:', err);
            return false;
        }
    }

    /**
     * 테이블 생성
     */
    createTables() {
        const tables = `
            -- 연락처 (사용자)
            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                nickname TEXT NOT NULL,
                ip_address TEXT,
                port INTEGER DEFAULT 9900,
                avatar TEXT,
                status TEXT DEFAULT 'offline',
                last_seen DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 그룹
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                avatar TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 그룹 멤버
            CREATE TABLE IF NOT EXISTS group_members (
                group_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, contact_id),
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
            );

            -- 채팅방
            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'direct', -- direct, group
                name TEXT,
                avatar TEXT,
                last_message TEXT,
                last_message_at DATETIME,
                unread_count INTEGER DEFAULT 0,
                pinned INTEGER DEFAULT 0,
                muted INTEGER DEFAULT 0,
                notification TEXT DEFAULT 'all', -- all, mention, none
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            -- 채팅방 참가자
            CREATE TABLE IF NOT EXISTS room_participants (
                room_id TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                nickname TEXT,
                joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_read_at DATETIME,
                PRIMARY KEY (room_id, contact_id),
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
                FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
            );

            -- 메시지
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                room_id TEXT NOT NULL,
                sender_id TEXT DEFAULT 'unknown', -- nullable for P2P chat
                sender_nickname TEXT, -- 발신자 닉네임 (P2P용)
                type TEXT DEFAULT 'text', -- text, file, image, system
                content TEXT,
                file_name TEXT,
                file_size INTEGER,
                file_path TEXT,
                reply_to TEXT,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
            );

            -- 설정
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            -- 인덱스 생성
            CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
            CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(updated_at);
        `;

        if (this.isSqlJs) {
            this.db.run(tables);
            this.saveToFile();
        } else {
            this.db.exec(tables);
        }

        // 마이그레이션: notification 컬럼 추가 (기존 DB 호환)
        this._migrateAddNotificationColumn();
        // 마이그레이션: messages 테이블 sender_nickname 컬럼 및 sender_id 기본값 수정
        this._migrateMessagesTable();
    }

    /**
     * 마이그레이션: rooms 테이블에 notification 컬럼 추가
     */
    _migrateAddNotificationColumn() {
        try {
            const checkSql = "SELECT notification FROM rooms LIMIT 1";
            if (this.isSqlJs) {
                this.db.exec(checkSql);
            } else {
                this.db.prepare(checkSql).get();
            }
        } catch (e) {
            // 컬럼이 없으면 추가
            console.log('[MessengerDB] notification 컬럼 추가 마이그레이션 실행');
            const alterSql = "ALTER TABLE rooms ADD COLUMN notification TEXT DEFAULT 'all'";
            try {
                if (this.isSqlJs) {
                    this.db.run(alterSql);
                    this.saveToFile();
                } else {
                    this.db.exec(alterSql);
                }
                console.log('[MessengerDB] notification 컬럼 추가 완료');
            } catch (alterErr) {
                console.error('[MessengerDB] notification 컬럼 추가 실패:', alterErr.message);
            }
        }
    }

    /**
     * 마이그레이션: messages 테이블에 sender_nickname 컬럼 추가 및 sender_id NOT NULL 해제
     */
    _migrateMessagesTable() {
        // 먼저 테이블이 존재하는지 확인
        let tableExists = false;
        try {
            const checkTableSql = "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'";
            if (this.isSqlJs) {
                const result = this.db.exec(checkTableSql);
                tableExists = result && result.length > 0 && result[0].values && result[0].values.length > 0;
            } else {
                const row = this.db.prepare(checkTableSql).get();
                tableExists = !!row;
            }
        } catch (e) {
            console.log('[MessengerDB] messages 테이블 확인 실패:', e.message);
        }

        if (!tableExists) {
            console.log('[MessengerDB] messages 테이블이 아직 없음 - 마이그레이션 건너뜀');
            return;
        }

        // sender_nickname 컬럼 존재 여부 확인
        let hasNicknameColumn = false;
        try {
            const checkColSql = "PRAGMA table_info(messages)";
            if (this.isSqlJs) {
                const result = this.db.exec(checkColSql);
                if (result && result.length > 0 && result[0].values) {
                    hasNicknameColumn = result[0].values.some(row => row[1] === 'sender_nickname');
                }
            } else {
                const columns = this.db.prepare(checkColSql).all();
                hasNicknameColumn = columns.some(col => col.name === 'sender_nickname');
            }
        } catch (e) {
            console.log('[MessengerDB] 컬럼 정보 확인 실패:', e.message);
        }

        // sender_nickname 컬럼 추가
        if (!hasNicknameColumn) {
            console.log('[MessengerDB] sender_nickname 컬럼 추가 마이그레이션 실행');
            const alterSql = "ALTER TABLE messages ADD COLUMN sender_nickname TEXT";
            try {
                if (this.isSqlJs) {
                    this.db.run(alterSql);
                    this.saveToFile();
                } else {
                    this.db.exec(alterSql);
                }
                console.log('[MessengerDB] sender_nickname 컬럼 추가 완료');
            } catch (alterErr) {
                console.error('[MessengerDB] sender_nickname 컬럼 추가 실패:', alterErr.message);
            }
        } else {
            console.log('[MessengerDB] sender_nickname 컬럼이 이미 존재함');
        }

        // sender_id가 NULL인 기존 레코드에 기본값 설정
        try {
            const updateSql = "UPDATE messages SET sender_id = 'unknown' WHERE sender_id IS NULL";
            if (this.isSqlJs) {
                this.db.run(updateSql);
                this.saveToFile();
            } else {
                this.db.exec(updateSql);
            }
        } catch (e) {
            // 업데이트 실패해도 무시 (테이블이 없거나 이미 처리됨)
        }
    }

    /**
     * sql.js 사용 시 파일에 저장
     */
    saveToFile() {
        if (this.isSqlJs && this.db) {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
        }
    }

    // ============================================
    // 연락처 관리
    // ============================================

    /**
     * 연락처 추가
     */
    addContact(contact) {
        const id = contact.id || `contact_${Date.now()}`;
        const sql = `
            INSERT OR REPLACE INTO contacts (id, nickname, ip_address, port, avatar, status)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const nickname = contact.nickname || null;
        const ip = contact.ip || null;
        const port = contact.port || 9900;
        const avatar = contact.avatar || null;
        const status = contact.status || 'offline';

        if (this.isSqlJs) {
            this.db.run(sql, [id, nickname, ip, port, avatar, status]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, nickname, ip, port, avatar, status);
        }

        return id;
    }

    /**
     * 연락처 조회
     */
    getContact(id) {
        const sql = 'SELECT * FROM contacts WHERE id = ?';

        if (this.isSqlJs) {
            const stmt = this.db.prepare(sql);
            stmt.bind([id]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return null;
        } else {
            return this.db.prepare(sql).get(id);
        }
    }

    /**
     * 모든 연락처 조회
     */
    getAllContacts() {
        const sql = 'SELECT * FROM contacts ORDER BY nickname';

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all();
        }
    }

    /**
     * 연락처 삭제
     */
    deleteContact(id) {
        const sql = 'DELETE FROM contacts WHERE id = ?';

        if (this.isSqlJs) {
            this.db.run(sql, [id]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id);
        }
    }

    /**
     * 연락처 상태 업데이트
     */
    updateContactStatus(id, status) {
        const sql = 'UPDATE contacts SET status = ?, last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?';

        if (this.isSqlJs) {
            this.db.run(sql, [status, id]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(status, id);
        }
    }

    // ============================================
    // 그룹 관리
    // ============================================

    /**
     * 그룹 생성
     */
    createGroup(group) {
        const id = group.id || `group_${Date.now()}`;
        const sql = 'INSERT INTO groups (id, name, description, avatar) VALUES (?, ?, ?, ?)';
        const name = group.name || null;
        const description = group.description || null;
        const avatar = group.avatar || null;

        if (this.isSqlJs) {
            this.db.run(sql, [id, name, description, avatar]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, name, description, avatar);
        }

        return id;
    }

    /**
     * 그룹에 멤버 추가
     */
    addGroupMember(groupId, contactId, role = 'member') {
        const sql = 'INSERT OR REPLACE INTO group_members (group_id, contact_id, role) VALUES (?, ?, ?)';

        if (this.isSqlJs) {
            this.db.run(sql, [groupId, contactId, role]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(groupId, contactId, role);
        }
    }

    /**
     * 그룹 조회
     */
    getGroup(id) {
        const sql = 'SELECT * FROM groups WHERE id = ?';

        if (this.isSqlJs) {
            const stmt = this.db.prepare(sql);
            stmt.bind([id]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return null;
        } else {
            return this.db.prepare(sql).get(id);
        }
    }

    /**
     * 모든 그룹 조회
     */
    getAllGroups() {
        const sql = `
            SELECT g.*, COUNT(gm.contact_id) as member_count
            FROM groups g
            LEFT JOIN group_members gm ON g.id = gm.group_id
            GROUP BY g.id
            ORDER BY g.name
        `;

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all();
        }
    }

    /**
     * 그룹 멤버 조회
     */
    getGroupMembers(groupId) {
        const sql = `
            SELECT c.*, gm.role, gm.joined_at
            FROM group_members gm
            JOIN contacts c ON gm.contact_id = c.id
            WHERE gm.group_id = ?
            ORDER BY gm.role, c.nickname
        `;

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            stmt.bind([groupId]);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all(groupId);
        }
    }

    /**
     * 그룹 삭제
     */
    deleteGroup(id) {
        const sql = 'DELETE FROM groups WHERE id = ?';

        if (this.isSqlJs) {
            this.db.run(sql, [id]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id);
        }
    }

    // ============================================
    // 채팅방 관리
    // ============================================

    /**
     * 채팅방 생성
     */
    createRoom(room) {
        const id = room.id || `room_${Date.now()}`;
        const sql = 'INSERT OR REPLACE INTO rooms (id, type, name, avatar) VALUES (?, ?, ?, ?)';
        const type = room.type || 'direct';
        const name = room.name || null;
        const avatar = room.avatar || null;

        if (this.isSqlJs) {
            this.db.run(sql, [id, type, name, avatar]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, type, name, avatar);
        }

        return id;
    }

    /**
     * 채팅방에 참가자 추가
     */
    addRoomParticipant(roomId, contactId, nickname) {
        const sql = 'INSERT OR REPLACE INTO room_participants (room_id, contact_id, nickname) VALUES (?, ?, ?)';
        const nick = nickname || null;

        if (this.isSqlJs) {
            this.db.run(sql, [roomId, contactId, nick]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(roomId, contactId, nick);
        }
    }

    /**
     * 채팅방 조회
     */
    getRoom(id) {
        const sql = 'SELECT * FROM rooms WHERE id = ?';

        if (this.isSqlJs) {
            const stmt = this.db.prepare(sql);
            stmt.bind([id]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return null;
        } else {
            return this.db.prepare(sql).get(id);
        }
    }

    /**
     * 모든 채팅방 조회
     */
    getAllRooms() {
        const sql = `
            SELECT r.*,
                   (SELECT COUNT(*) FROM room_participants WHERE room_id = r.id) as participant_count
            FROM rooms r
            ORDER BY r.pinned DESC, r.last_message_at DESC
        `;

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all();
        }
    }

    /**
     * 채팅방 참가자 조회
     */
    getRoomParticipants(roomId) {
        const sql = `
            SELECT c.*, rp.nickname as room_nickname, rp.joined_at, rp.last_read_at
            FROM room_participants rp
            JOIN contacts c ON rp.contact_id = c.id
            WHERE rp.room_id = ?
        `;

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            stmt.bind([roomId]);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all(roomId);
        }
    }

    /**
     * 채팅방 나가기 (참가자 제거)
     */
    leaveRoom(roomId, contactId) {
        const sql = 'DELETE FROM room_participants WHERE room_id = ? AND contact_id = ?';

        if (this.isSqlJs) {
            this.db.run(sql, [roomId, contactId]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(roomId, contactId);
        }

        // 참가자가 없으면 방 삭제
        const countSql = 'SELECT COUNT(*) as count FROM room_participants WHERE room_id = ?';
        let count = 0;

        if (this.isSqlJs) {
            const stmt = this.db.prepare(countSql);
            stmt.bind([roomId]);
            if (stmt.step()) {
                count = stmt.getAsObject().count;
            }
            stmt.free();
        } else {
            count = this.db.prepare(countSql).get(roomId).count;
        }

        if (count === 0) {
            this.deleteRoom(roomId);
        }
    }

    /**
     * 채팅방 삭제
     */
    deleteRoom(id) {
        const sql = 'DELETE FROM rooms WHERE id = ?';

        if (this.isSqlJs) {
            this.db.run(sql, [id]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id);
        }
    }

    /**
     * 채팅방 업데이트 (마지막 메시지 등)
     */
    updateRoom(id, updates) {
        const fields = [];
        const values = [];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.notification !== undefined) {
            fields.push('notification = ?');
            values.push(updates.notification);
        }
        if (updates.lastMessage !== undefined) {
            fields.push('last_message = ?');
            values.push(updates.lastMessage);
        }
        if (updates.lastMessageAt !== undefined) {
            fields.push('last_message_at = ?');
            values.push(updates.lastMessageAt);
        }
        if (updates.unreadCount !== undefined) {
            fields.push('unread_count = ?');
            values.push(updates.unreadCount);
        }
        if (updates.pinned !== undefined) {
            fields.push('pinned = ?');
            values.push(updates.pinned ? 1 : 0);
        }
        if (updates.muted !== undefined) {
            fields.push('muted = ?');
            values.push(updates.muted ? 1 : 0);
        }

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        const sql = `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`;

        if (this.isSqlJs) {
            this.db.run(sql, values);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(...values);
        }
    }

    // ============================================
    // 메시지 관리
    // ============================================

    /**
     * 메시지 저장
     */
    saveMessage(message) {
        const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sql = `
            INSERT INTO messages (id, room_id, sender_id, sender_nickname, type, content, file_name, file_size, file_path, reply_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const roomId = message.roomId || null;
        const senderId = message.senderId || 'unknown'; // 기본값 설정
        const senderNickname = message.senderNickname || null; // P2P용 닉네임
        const type = message.type || 'text';
        const content = message.content || null;
        const fileName = message.fileName || null;
        const fileSize = message.fileSize || null;
        const filePath = message.filePath || null;
        const replyTo = message.replyTo || null;

        if (this.isSqlJs) {
            this.db.run(sql, [id, roomId, senderId, senderNickname, type, content, fileName, fileSize, filePath, replyTo]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, roomId, senderId, senderNickname, type, content, fileName, fileSize, filePath, replyTo);
        }

        // 채팅방 업데이트
        if (roomId) {
            this.updateRoom(roomId, {
                lastMessage: content || fileName,
                lastMessageAt: new Date().toISOString()
            });
        }

        return id;
    }

    /**
     * 채팅방 메시지 조회
     */
    getRoomMessages(roomId, limit = 50, offset = 0) {
        const sql = `
            SELECT m.*, c.nickname as sender_name, c.avatar as sender_avatar
            FROM messages m
            LEFT JOIN contacts c ON m.sender_id = c.id
            WHERE m.room_id = ?
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?
        `;

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            stmt.bind([roomId, limit, offset]);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results.reverse(); // 시간순으로 정렬
        } else {
            return this.db.prepare(sql).all(roomId, limit, offset).reverse();
        }
    }

    /**
     * 메시지 읽음 처리
     */
    markMessagesAsRead(roomId, contactId) {
        const sql = 'UPDATE messages SET is_read = 1 WHERE room_id = ? AND sender_id != ?';

        if (this.isSqlJs) {
            this.db.run(sql, [roomId, contactId]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(roomId, contactId);
        }

        // 읽지 않은 메시지 수 초기화
        this.updateRoom(roomId, { unreadCount: 0 });

        // 마지막 읽은 시간 업데이트
        const updateSql = 'UPDATE room_participants SET last_read_at = CURRENT_TIMESTAMP WHERE room_id = ? AND contact_id = ?';

        if (this.isSqlJs) {
            this.db.run(updateSql, [roomId, contactId]);
            this.saveToFile();
        } else {
            this.db.prepare(updateSql).run(roomId, contactId);
        }
    }

    /**
     * 메시지 검색
     */
    searchMessages(query, roomId = null) {
        let sql = `
            SELECT m.*, r.name as room_name, c.nickname as sender_name
            FROM messages m
            JOIN rooms r ON m.room_id = r.id
            LEFT JOIN contacts c ON m.sender_id = c.id
            WHERE m.content LIKE ?
        `;
        const params = [`%${query}%`];

        if (roomId) {
            sql += ' AND m.room_id = ?';
            params.push(roomId);
        }

        sql += ' ORDER BY m.created_at DESC LIMIT 100';

        if (this.isSqlJs) {
            const results = [];
            const stmt = this.db.prepare(sql);
            stmt.bind(params);
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } else {
            return this.db.prepare(sql).all(...params);
        }
    }

    // ============================================
    // 설정 관리
    // ============================================

    /**
     * 설정 저장
     */
    setSetting(key, value) {
        const sql = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

        if (this.isSqlJs) {
            this.db.run(sql, [key, valueStr]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(key, valueStr);
        }
    }

    /**
     * 설정 조회
     */
    getSetting(key, defaultValue = null) {
        const sql = 'SELECT value FROM settings WHERE key = ?';

        if (this.isSqlJs) {
            const stmt = this.db.prepare(sql);
            stmt.bind([key]);
            if (stmt.step()) {
                const value = stmt.getAsObject().value;
                stmt.free();
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            stmt.free();
            return defaultValue;
        } else {
            const row = this.db.prepare(sql).get(key);
            if (row) {
                try {
                    return JSON.parse(row.value);
                } catch {
                    return row.value;
                }
            }
            return defaultValue;
        }
    }

    /**
     * 데이터베이스 닫기
     */
    close() {
        if (this.isSqlJs) {
            this.saveToFile();
        }
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = MessengerDB;
