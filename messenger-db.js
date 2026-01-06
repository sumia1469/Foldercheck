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
                const SQL = await initSqlJs();

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
                sender_id TEXT NOT NULL,
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

        if (this.isSqlJs) {
            this.db.run(sql, [id, contact.nickname, contact.ip, contact.port || 9900, contact.avatar, contact.status || 'offline']);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, contact.nickname, contact.ip, contact.port || 9900, contact.avatar, contact.status || 'offline');
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

        if (this.isSqlJs) {
            this.db.run(sql, [id, group.name, group.description, group.avatar]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, group.name, group.description, group.avatar);
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
        const sql = 'INSERT INTO rooms (id, type, name, avatar) VALUES (?, ?, ?, ?)';

        if (this.isSqlJs) {
            this.db.run(sql, [id, room.type || 'direct', room.name, room.avatar]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(id, room.type || 'direct', room.name, room.avatar);
        }

        return id;
    }

    /**
     * 채팅방에 참가자 추가
     */
    addRoomParticipant(roomId, contactId, nickname) {
        const sql = 'INSERT OR REPLACE INTO room_participants (room_id, contact_id, nickname) VALUES (?, ?, ?)';

        if (this.isSqlJs) {
            this.db.run(sql, [roomId, contactId, nickname]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(roomId, contactId, nickname);
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
            INSERT INTO messages (id, room_id, sender_id, type, content, file_name, file_size, file_path, reply_to)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        if (this.isSqlJs) {
            this.db.run(sql, [
                id, message.roomId, message.senderId, message.type || 'text',
                message.content, message.fileName, message.fileSize, message.filePath, message.replyTo
            ]);
            this.saveToFile();
        } else {
            this.db.prepare(sql).run(
                id, message.roomId, message.senderId, message.type || 'text',
                message.content, message.fileName, message.fileSize, message.filePath, message.replyTo
            );
        }

        // 채팅방 업데이트
        this.updateRoom(message.roomId, {
            lastMessage: message.content || message.fileName,
            lastMessageAt: new Date().toISOString()
        });

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
