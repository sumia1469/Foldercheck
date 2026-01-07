/**
 * P2P 메신저 채팅 윈도우 - 카카오톡 스타일
 */

// 상태 관리
const state = {
    mode: 'offline', // offline, host, guest
    nickname: '',
    myContactId: null, // 내 연락처 ID
    rooms: [],       // 채팅방 목록
    currentRoom: null,
    users: [],       // 사용자 목록
    messages: [],    // 현재 방 메시지
    contacts: [],    // 연락처 목록
    groups: []       // 그룹 목록
};

// DOM 요소
const elements = {
    // 상태
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),

    // 연결 폼
    hostForm: document.getElementById('hostForm'),
    guestForm: document.getElementById('guestForm'),
    hostNickname: document.getElementById('hostNickname'),
    hostPort: document.getElementById('hostPort'),
    guestNickname: document.getElementById('guestNickname'),
    hostIP: document.getElementById('hostIP'),
    guestPort: document.getElementById('guestPort'),
    startHostBtn: document.getElementById('startHostBtn'),
    connectBtn: document.getElementById('connectBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),

    // 채팅
    roomList: document.getElementById('roomList'),
    emptyState: document.getElementById('emptyState'),
    chatView: document.getElementById('chatView'),
    chatAvatar: document.getElementById('chatAvatar'),
    chatName: document.getElementById('chatName'),
    chatStatus: document.getElementById('chatStatus'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    attachBtn: document.getElementById('attachBtn'),

    // 사용자
    usersPanel: document.getElementById('usersPanel'),
    usersBtn: document.getElementById('usersBtn'),
    usersList: document.getElementById('usersList'),
    userCount: document.getElementById('userCount'),

    // 타이핑
    typingIndicator: document.getElementById('typingIndicator'),
    typingText: document.getElementById('typingText')
};

// 초기화는 파일 끝의 DOMContentLoaded에서 처리

// 내 프로필 로드
async function loadMyProfile() {
    try {
        if (window.messengerDB) {
            const myProfile = await window.messengerDB.getSetting('myProfile', null);
            if (myProfile) {
                state.myContactId = myProfile.id;
                state.nickname = myProfile.nickname;
            }
        }
    } catch (err) {
        console.error('프로필 로드 실패:', err);
    }
}

// 내 프로필 저장
async function saveMyProfile(profile) {
    try {
        if (window.messengerDB) {
            await window.messengerDB.setSetting('myProfile', profile);
            state.myContactId = profile.id;
            state.nickname = profile.nickname;
        }
    } catch (err) {
        console.error('프로필 저장 실패:', err);
    }
}

// 현재 P2P 상태 확인
async function checkP2PStatus() {
    try {
        if (window.p2pAPI) {
            const status = await window.p2pAPI.getStatus();
            if (status.mode !== 'offline') {
                state.mode = status.mode;
                state.nickname = status.nickname || state.nickname;
                updateConnectionUI(true);
                showChatView();

                // 사용자 목록 가져오기
                const users = await window.p2pAPI.getUsers();
                state.users = users;
                updateUsersList();
                updateChatStatus();
            }
        }
    } catch (err) {
        console.error('P2P 상태 확인 실패:', err);
    }
}

// 타이틀바 컨트롤
function initTitlebar() {
    document.getElementById('minimizeBtn').addEventListener('click', () => {
        window.chatAPI?.minimize();
    });

    document.getElementById('maximizeBtn').addEventListener('click', () => {
        window.chatAPI?.maximize();
    });

    document.getElementById('closeBtn').addEventListener('click', () => {
        window.chatAPI?.close();
    });
}

// 탭 전환
function initTabs() {
    document.querySelectorAll('.connect-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;

            document.querySelectorAll('.connect-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            elements.hostForm.classList.toggle('active', mode === 'host');
            elements.guestForm.classList.toggle('active', mode === 'guest');
        });
    });
}

// 연결 관리
function initConnection() {
    // 호스트 시작
    elements.startHostBtn.addEventListener('click', async () => {
        const nickname = elements.hostNickname.value.trim() || 'Host';
        const port = parseInt(elements.hostPort.value) || 9900;

        try {
            elements.startHostBtn.disabled = true;
            elements.startHostBtn.textContent = '시작 중...';

            await window.p2pAPI.startHost(port, nickname);

            state.mode = 'host';
            state.nickname = nickname;

            // 프로필 저장
            const myId = `host_${Date.now()}`;
            state.myContactId = myId;
            await saveMyProfile({ id: myId, nickname: nickname });

            updateConnectionUI(true);
            showChatView();

            // 기본 채팅방 생성 (DB에도 저장)
            const roomId = 'main_' + Date.now();
            if (window.messengerDB) {
                await window.messengerDB.createRoom({
                    id: roomId,
                    type: 'group',
                    name: 'P2P 채팅방'
                });
                await window.messengerDB.addRoomParticipant(roomId, myId, nickname);
            }

            addRoom({
                id: roomId,
                name: 'P2P 채팅방',
                type: 'group',
                unread: 0
            });

        } catch (err) {
            alert('호스트 시작 실패: ' + err.message);
        } finally {
            elements.startHostBtn.disabled = false;
            elements.startHostBtn.textContent = '호스트 시작';
        }
    });

    // 게스트 연결
    elements.connectBtn.addEventListener('click', async () => {
        const nickname = elements.guestNickname.value.trim() || 'Guest';
        const host = elements.hostIP.value.trim();
        const port = parseInt(elements.guestPort.value) || 9900;

        if (!host) {
            alert('호스트 IP를 입력하세요.');
            return;
        }

        try {
            elements.connectBtn.disabled = true;
            elements.connectBtn.textContent = '연결 중...';

            await window.p2pAPI.connect(host, port, nickname);

            state.mode = 'guest';
            state.nickname = nickname;

            // 프로필 저장
            const myId = `guest_${Date.now()}`;
            state.myContactId = myId;
            await saveMyProfile({ id: myId, nickname: nickname });

            updateConnectionUI(true);
            showChatView();

            // 채팅방 추가 (DB에도 저장)
            const roomId = 'room_' + host.replace(/\./g, '_') + '_' + port;
            if (window.messengerDB) {
                await window.messengerDB.createRoom({
                    id: roomId,
                    type: 'group',
                    name: `${host}:${port}`
                });
                await window.messengerDB.addRoomParticipant(roomId, myId, nickname);
            }

            addRoom({
                id: roomId,
                name: `${host}:${port}`,
                type: 'group',
                unread: 0
            });

        } catch (err) {
            alert('연결 실패: ' + err.message);
        } finally {
            elements.connectBtn.disabled = false;
            elements.connectBtn.textContent = '연결';
        }
    });

    // 연결 해제
    elements.disconnectBtn.addEventListener('click', async () => {
        try {
            if (state.mode === 'host') {
                await window.p2pAPI.stopHost();
            } else {
                await window.p2pAPI.disconnect();
            }

            state.mode = 'offline';
            state.nickname = '';
            state.rooms = [];
            state.messages = [];

            updateConnectionUI(false);
            hideChatView();
            elements.roomList.innerHTML = '';

        } catch (err) {
            console.error('연결 해제 실패:', err);
        }
    });
}

// 연결 UI 업데이트
function updateConnectionUI(connected) {
    elements.statusDot.classList.toggle('connected', connected);
    elements.statusText.textContent = connected ?
        (state.mode === 'host' ? '호스트 중' : '연결됨') : '연결 안됨';

    // 폼/버튼 표시 전환
    elements.hostForm.style.display = connected ? 'none' : '';
    elements.guestForm.style.display = connected ? 'none' : '';
    document.querySelector('.connect-tabs').style.display = connected ? 'none' : '';
    elements.disconnectBtn.style.display = connected ? 'block' : 'none';
}

// 채팅 초기화
function initChat() {
    // 메시지 입력
    elements.messageInput.addEventListener('input', () => {
        elements.sendBtn.disabled = !elements.messageInput.value.trim();
        autoResize(elements.messageInput);
    });

    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 전송 버튼
    elements.sendBtn.addEventListener('click', sendMessage);

    // 파일 첨부
    elements.attachBtn.addEventListener('click', attachFile);

    // 사용자 패널 토글
    elements.usersBtn.addEventListener('click', () => {
        elements.usersPanel.classList.toggle('visible');
    });
}

// 메시지 전송
async function sendMessage() {
    const content = elements.messageInput.value.trim();
    if (!content) return;

    // 현재 선택된 채팅방이 없으면 리턴
    if (!state.currentRoom) {
        console.warn('선택된 채팅방이 없습니다.');
        return;
    }

    const room = state.rooms.find(r => r.id === state.currentRoom);
    const isDirectChat = room && room.type === 'direct';

    try {
        // P2P 연결 상태에서 그룹 채팅인 경우 P2P로 전송
        if (state.mode !== 'offline' && !isDirectChat) {
            await window.p2pAPI.sendMessage(content);
        } else {
            // 오프라인이거나 1:1 채팅인 경우 로컬에만 저장하고 화면에 표시
            const messageData = {
                id: Date.now(),
                nickname: state.nickname || '나',
                content: content,
                timestamp: Date.now()
            };
            addMessage(messageData);
        }

        elements.messageInput.value = '';
        elements.sendBtn.disabled = true;
        autoResize(elements.messageInput);
    } catch (err) {
        console.error('메시지 전송 실패:', err);
        // 에러 발생 시에도 로컬에 저장
        const messageData = {
            id: Date.now(),
            nickname: state.nickname || '나',
            content: content,
            timestamp: Date.now()
        };
        addMessage(messageData);
        elements.messageInput.value = '';
        elements.sendBtn.disabled = true;
    }
}

// 파일 첨부
async function attachFile() {
    if (state.mode === 'offline') {
        alert('먼저 연결하세요.');
        return;
    }

    try {
        const result = await window.p2pAPI.selectFile();
        if (result.success && result.filePath) {
            await window.p2pAPI.sendFile(result.filePath);
        }
    } catch (err) {
        console.error('파일 첨부 실패:', err);
        alert('파일 전송 실패: ' + err.message);
    }
}

// P2P 이벤트 리스너
function initP2PListeners() {
    if (!window.p2pAPI) {
        console.warn('p2pAPI를 사용할 수 없습니다.');
        return;
    }

    // 상태 변경
    window.p2pAPI.onStatus((data) => {
        console.log('P2P 상태:', data);
        if (data.mode === 'offline') {
            state.mode = 'offline';
            updateConnectionUI(false);
        }
    });

    // 메시지 수신
    window.p2pAPI.onMessage((data) => {
        console.log('메시지 수신:', data);
        addMessage(data);
    });

    // 사용자 목록 업데이트
    window.p2pAPI.onUserList((users) => {
        console.log('사용자 목록:', users);
        state.users = users;
        updateUsersList();
        updateChatStatus();
        updateOnlineUsersInContacts(users);
    });

    // 사용자 입장
    window.p2pAPI.onUserJoined((data) => {
        console.log('사용자 입장:', data);
        addSystemMessage(`${data.nickname}님이 입장했습니다.`);
        // 새 사용자를 자동으로 연락처에 추가 (옵션)
        autoAddUserToContacts(data);
    });

    // 사용자 퇴장
    window.p2pAPI.onUserLeft((data) => {
        console.log('사용자 퇴장:', data);
        addSystemMessage(`${data.nickname}님이 퇴장했습니다.`);
    });

    // 파일 수신
    window.p2pAPI.onFileReceived((data) => {
        console.log('파일 수신:', data);
        addFileMessage(data);
    });

    // 연결 끊김
    window.p2pAPI.onDisconnected((data) => {
        console.log('연결 끊김:', data);
        state.mode = 'offline';
        updateConnectionUI(false);
        addSystemMessage('연결이 끊어졌습니다.');
    });
}

// P2P 연결된 사용자들의 온라인 상태 업데이트
async function updateOnlineUsersInContacts(users) {
    // 모든 연락처를 오프라인으로 초기화
    for (const contact of state.contacts) {
        contact.status = 'offline';
    }

    // P2P 연결된 사용자들을 온라인으로 표시
    for (const user of users) {
        const contact = state.contacts.find(c =>
            c.nickname.toLowerCase() === user.nickname.toLowerCase()
        );
        if (contact) {
            contact.status = 'online';
            // DB에도 상태 업데이트
            if (window.messengerDB) {
                await window.messengerDB.updateContactStatus(contact.id, 'online');
            }
        }
    }

    renderContactList();
}

// 새 사용자 자동 연락처 추가
async function autoAddUserToContacts(userData) {
    // 이미 연락처에 있는지 확인
    const existing = state.contacts.find(c =>
        c.nickname.toLowerCase() === userData.nickname.toLowerCase()
    );

    if (!existing && userData.nickname !== state.nickname) {
        try {
            if (window.messengerDB) {
                await window.messengerDB.addContact({
                    nickname: userData.nickname,
                    status: 'online'
                });
                await loadContacts();
                renderContactList();
            }
        } catch (err) {
            console.error('자동 연락처 추가 실패:', err);
        }
    }
}

// 채팅방 추가
function addRoom(room) {
    if (state.rooms.find(r => r.id === room.id)) return;

    state.rooms.push(room);
    state.currentRoom = room.id;
    renderRoomList();
}

// 채팅방 목록 렌더링
function renderRoomList() {
    if (state.rooms.length === 0) {
        elements.roomList.innerHTML = `
            <div class="empty-list" style="padding: 16px;">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.3;">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                </svg>
                <div style="margin-top: 8px; font-size: 12px;">채팅방이 없습니다</div>
                <div style="margin-top: 4px; font-size: 11px; color: var(--text-muted);">연결 후 사용자를 클릭하여 채팅을 시작하세요</div>
            </div>
        `;
        return;
    }

    elements.roomList.innerHTML = state.rooms.map(room => {
        const isGroup = room.type === 'group';
        const avatarBg = isGroup ? 'var(--warning)' : 'var(--accent)';
        const icon = isGroup ?
            `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>` :
            room.name.charAt(0).toUpperCase();

        return `
            <div class="room-item ${room.id === state.currentRoom ? 'active' : ''}"
                 data-room-id="${room.id}" onclick="selectRoom('${room.id}')">
                <div class="room-avatar" style="background: ${avatarBg}; display: flex; align-items: center; justify-content: center;">
                    ${isGroup ? icon : `<span>${icon}</span>`}
                </div>
                <div class="room-info">
                    <div class="room-name">${escapeHtml(room.name)}</div>
                    <div class="room-preview">${escapeHtml(room.lastMessage || (isGroup ? '그룹 채팅' : '1:1 채팅'))}</div>
                </div>
                <div class="room-meta">
                    <div class="room-time">${room.lastTime || ''}</div>
                    ${room.unread > 0 ? `<div class="room-unread">${room.unread}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// 채팅방 선택
function selectRoom(roomId) {
    state.currentRoom = roomId;

    // 선택된 방 정보로 헤더 업데이트
    const room = state.rooms.find(r => r.id === roomId);
    if (room) {
        updateChatHeader(room);
    }

    renderRoomList();
    loadRoomMessages(roomId);
    showChatView();
}

// 채팅 헤더 업데이트
function updateChatHeader(room) {
    if (!room) return;

    const isGroup = room.type === 'group';

    // 아바타 업데이트
    elements.chatAvatar.style.background = isGroup ? 'var(--warning)' : 'var(--accent)';
    if (isGroup) {
        elements.chatAvatar.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`;
    } else {
        elements.chatAvatar.textContent = room.name.charAt(0).toUpperCase();
    }

    // 이름 업데이트
    elements.chatName.textContent = room.name;

    // 상태 업데이트
    if (isGroup) {
        elements.chatStatus.textContent = `${state.users.length}명 참여중`;
    } else {
        // 1:1 채팅인 경우 상대방 온라인 상태 표시
        const otherUser = state.users.find(u => u.nickname === room.name);
        elements.chatStatus.textContent = otherUser ? '온라인' : '오프라인';
    }
}

// 채팅 뷰 표시
function showChatView() {
    elements.emptyState.style.display = 'none';
    elements.chatView.style.display = 'flex';
}

// 채팅 뷰 숨김
function hideChatView() {
    elements.emptyState.style.display = 'flex';
    elements.chatView.style.display = 'none';
}

// 메시지 추가
async function addMessage(data) {
    const isOwn = data.nickname === state.nickname;
    const message = {
        id: data.id || Date.now(),
        type: 'text',
        sender: data.nickname,
        content: data.content,
        timestamp: data.timestamp || Date.now(),
        isOwn
    };

    state.messages.push(message);
    renderMessage(message);
    scrollToBottom();

    // DB에 메시지 저장
    if (state.currentRoom && window.messengerDB) {
        try {
            await window.messengerDB.saveMessage({
                roomId: state.currentRoom,
                senderId: isOwn ? state.myContactId : `remote_${data.nickname}`,
                type: 'text',
                content: data.content
            });
        } catch (err) {
            console.error('메시지 저장 실패:', err);
        }
    }

    // 알림 (자신의 메시지가 아닌 경우)
    if (!isOwn && document.hidden) {
        showNotification(data.nickname, data.content);
    }
}

// 시스템 메시지 추가
function addSystemMessage(text) {
    const el = document.createElement('div');
    el.className = 'system-message';
    el.textContent = text;
    elements.messagesContainer.appendChild(el);
    scrollToBottom();
}

// 파일 메시지 추가
async function addFileMessage(data) {
    const isOwn = data.nickname === state.nickname;
    const message = {
        id: data.transferId || Date.now(),
        type: 'file',
        sender: data.nickname,
        filename: data.filename,
        fileSize: data.size,
        filePath: data.savedPath,
        timestamp: data.timestamp || Date.now(),
        isOwn
    };

    state.messages.push(message);
    renderMessage(message);
    scrollToBottom();

    // DB에 파일 메시지 저장
    if (state.currentRoom && window.messengerDB) {
        try {
            await window.messengerDB.saveMessage({
                roomId: state.currentRoom,
                senderId: isOwn ? state.myContactId : `remote_${data.nickname}`,
                type: 'file',
                content: data.filename,
                fileName: data.filename,
                fileSize: data.size,
                filePath: data.savedPath
            });
        } catch (err) {
            console.error('파일 메시지 저장 실패:', err);
        }
    }
}

// 메시지 렌더링
function renderMessage(msg) {
    const el = document.createElement('div');
    el.className = `message ${msg.isOwn ? 'own' : ''}`;

    const time = new Date(msg.timestamp).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const initial = msg.sender ? msg.sender.charAt(0).toUpperCase() : '?';

    if (msg.type === 'file') {
        el.innerHTML = `
            <div class="message-avatar">${initial}</div>
            <div class="message-content">
                <div class="message-sender">${escapeHtml(msg.sender)}</div>
                <div class="message-file" onclick="openFile('${escapeHtml(msg.filePath || '')}')">
                    <div class="file-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                        </svg>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(msg.filename)}</div>
                        <div class="file-size">${formatFileSize(msg.fileSize)}</div>
                    </div>
                </div>
                <div class="message-meta">
                    <span class="message-time">${time}</span>
                </div>
            </div>
        `;
    } else {
        el.innerHTML = `
            <div class="message-avatar">${initial}</div>
            <div class="message-content">
                <div class="message-sender">${escapeHtml(msg.sender)}</div>
                <div class="message-bubble">${escapeHtml(msg.content)}</div>
                <div class="message-meta">
                    <span class="message-time">${time}</span>
                    ${msg.isOwn ? '<span class="message-read">읽음</span>' : ''}
                </div>
            </div>
        `;
    }

    elements.messagesContainer.appendChild(el);
}

// 사용자 목록 업데이트
function updateUsersList() {
    elements.userCount.textContent = state.users.length;
    elements.usersList.innerHTML = state.users.map(user => `
        <div class="user-item" onclick="startDirectChat('${escapeHtml(user.nickname)}')" style="cursor: pointer;">
            <div class="user-avatar" style="background: ${user.isHost ? 'var(--warning)' : 'var(--accent)'}">
                ${user.nickname.charAt(0).toUpperCase()}
            </div>
            <div style="flex: 1;">
                <div class="user-name">${escapeHtml(user.nickname)}${user.nickname === state.nickname ? ' (나)' : ''}</div>
                ${user.isHost ? '<div class="user-host">호스트</div>' : ''}
            </div>
            ${user.nickname !== state.nickname ? `
                <button class="action-btn" onclick="event.stopPropagation(); startDirectChat('${escapeHtml(user.nickname)}')" title="1:1 채팅">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                </button>
            ` : ''}
        </div>
    `).join('');
}

// P2P 접속 사용자와 1:1 채팅 시작
async function startDirectChat(nickname) {
    if (nickname === state.nickname) return; // 자신과는 채팅 불가

    const roomId = `direct_${nickname.replace(/\s+/g, '_')}_${Date.now()}`;

    // 채팅방 생성
    if (window.messengerDB) {
        await window.messengerDB.createRoom({
            id: roomId,
            type: 'direct',
            name: nickname
        });

        if (state.myContactId) {
            await window.messengerDB.addRoomParticipant(roomId, state.myContactId, state.nickname);
        }
    }

    // 채팅방 목록에 추가
    addRoom({
        id: roomId,
        name: nickname,
        type: 'direct',
        unread: 0
    });

    // 채팅 탭으로 이동 및 선택
    document.querySelector('[data-tab="chats"]')?.click();
    selectRoom(roomId);
    elements.usersPanel.classList.remove('visible');
}

// 채팅 상태 업데이트
function updateChatStatus() {
    elements.chatStatus.textContent = `${state.users.length}명 참여중`;

    // 온라인 사용자 섹션 업데이트 (채팅 탭의 상단)
    updateOnlineUsersSection();
}

// 온라인 사용자 섹션 업데이트 (채팅 탭 상단)
function updateOnlineUsersSection() {
    const section = document.getElementById('onlineUsersSection');
    const countEl = document.getElementById('onlineCount');
    const listEl = document.getElementById('onlineUsersList');

    if (!section || !listEl) return;

    // 자신을 제외한 온라인 사용자들
    const otherUsers = state.users.filter(u => u.nickname !== state.nickname);

    if (otherUsers.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    countEl.textContent = otherUsers.length;

    listEl.innerHTML = otherUsers.map(user => `
        <div class="contact-item" onclick="startDirectChat('${escapeHtml(user.nickname)}')" style="cursor: pointer;">
            <div class="contact-avatar" style="background: ${user.isHost ? 'var(--warning)' : 'var(--success)'}; width: 32px; height: 32px; font-size: 12px;">
                ${user.nickname.charAt(0).toUpperCase()}
            </div>
            <div class="contact-info">
                <div class="contact-name" style="font-size: 12px;">${escapeHtml(user.nickname)}</div>
                <div class="contact-status online" style="font-size: 10px;">${user.isHost ? '호스트' : '온라인'}</div>
            </div>
            <div class="contact-actions" style="opacity: 1;">
                <button class="action-btn" onclick="event.stopPropagation(); startDirectChat('${escapeHtml(user.nickname)}')" title="1:1 채팅" style="width: 24px; height: 24px;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// 스크롤 하단으로
function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

// 텍스트영역 자동 크기 조절
function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

// 파일 열기
function openFile(filePath) {
    if (filePath && window.chatAPI?.openFile) {
        window.chatAPI.openFile(filePath);
    }
}

// 연락처 로드
async function loadContacts() {
    try {
        if (window.messengerDB) {
            state.contacts = await window.messengerDB.getContacts();
            console.log('연락처 로드 완료:', state.contacts.length);
        }
    } catch (err) {
        console.error('연락처 로드 실패:', err);
        state.contacts = [];
    }
}

// 그룹 로드
async function loadGroups() {
    try {
        if (window.messengerDB) {
            state.groups = await window.messengerDB.getGroups();
            console.log('그룹 로드 완료:', state.groups.length);
        }
    } catch (err) {
        console.error('그룹 로드 실패:', err);
        state.groups = [];
    }
}

// 채팅방 목록 로드
async function loadRooms() {
    try {
        if (window.messengerDB) {
            const rooms = await window.messengerDB.getRooms();
            state.rooms = rooms.map(r => ({
                id: r.id,
                name: r.name || '채팅방',
                type: r.type,
                lastMessage: r.last_message,
                lastTime: r.last_message_at ? formatTime(new Date(r.last_message_at)) : '',
                unread: r.unread_count || 0,
                pinned: r.pinned === 1,
                muted: r.muted === 1
            }));
            renderRoomList();
        }
    } catch (err) {
        console.error('채팅방 로드 실패:', err);
    }
}

// 방 메시지 로드
async function loadRoomMessages(roomId) {
    try {
        elements.messagesContainer.innerHTML = '';

        if (window.messengerDB) {
            const messages = await window.messengerDB.getRoomMessages(roomId, 50, 0);
            state.messages = [];

            messages.forEach(msg => {
                const isOwn = msg.sender_id === state.myContactId;
                const message = {
                    id: msg.id,
                    type: msg.type || 'text',
                    sender: msg.sender_name || msg.sender_id,
                    content: msg.content,
                    filename: msg.file_name,
                    fileSize: msg.file_size,
                    filePath: msg.file_path,
                    timestamp: new Date(msg.created_at).getTime(),
                    isOwn
                };

                state.messages.push(message);
                renderMessage(message);
            });

            scrollToBottom();

            // 읽음 처리
            if (state.myContactId) {
                await window.messengerDB.markAsRead(roomId, state.myContactId);
            }
        }
    } catch (err) {
        console.error('메시지 로드 실패:', err);
    }
}

// 메시지 저장 (DB)
async function saveMessageToDB(roomId, message) {
    try {
        if (window.messengerDB) {
            await window.messengerDB.saveMessage({
                roomId: roomId,
                senderId: message.senderId || state.myContactId,
                type: message.type || 'text',
                content: message.content,
                fileName: message.fileName,
                fileSize: message.fileSize,
                filePath: message.filePath
            });
        }
    } catch (err) {
        console.error('메시지 저장 실패:', err);
    }
}

// 연락처 추가
async function addContact(contact) {
    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.addContact(contact);
            await loadContacts();
            return result;
        }
    } catch (err) {
        console.error('연락처 추가 실패:', err);
        throw err;
    }
}

// 그룹 생성
async function createGroup(group) {
    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.createGroup(group);
            await loadGroups();
            return result;
        }
    } catch (err) {
        console.error('그룹 생성 실패:', err);
        throw err;
    }
}

// 채팅방 생성
async function createRoom(room) {
    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.createRoom(room);
            await loadRooms();
            return result;
        }
    } catch (err) {
        console.error('채팅방 생성 실패:', err);
        throw err;
    }
}

// 채팅방 나가기
async function leaveRoom(roomId) {
    try {
        if (window.messengerDB && state.myContactId) {
            await window.messengerDB.leaveRoom(roomId, state.myContactId);
            await loadRooms();

            if (state.currentRoom === roomId) {
                state.currentRoom = null;
                hideChatView();
            }
        }
    } catch (err) {
        console.error('채팅방 나가기 실패:', err);
        throw err;
    }
}

// 메시지 검색
async function searchMessages(query, roomId = null) {
    try {
        if (window.messengerDB) {
            return await window.messengerDB.searchMessages(query, roomId);
        }
        return [];
    } catch (err) {
        console.error('메시지 검색 실패:', err);
        return [];
    }
}

// 시간 포맷
function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
        return '어제';
    } else if (days < 7) {
        const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
        return weekdays[date.getDay()] + '요일';
    } else {
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }
}

// 알림 표시
function showNotification(title, body) {
    if (window.chatAPI?.showNotification) {
        window.chatAPI.showNotification(title, body);
    }
}

// 유틸리티
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ============================================
// 사이드바 탭 관리
// ============================================

function initSidebarTabs() {
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            // 탭 버튼 활성화
            document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 탭 컨텐츠 활성화
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(tabName + 'Tab').classList.add('active');
        });
    });

    // 연락처 추가 버튼
    document.getElementById('addContactBtn')?.addEventListener('click', () => {
        openModal('contactModal');
    });

    // 그룹 생성 버튼
    document.getElementById('createGroupBtn')?.addEventListener('click', () => {
        openModal('groupModal');
    });
}

// ============================================
// 모달 관리
// ============================================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('visible');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('visible');

    // 입력 필드 초기화
    modal.querySelectorAll('input').forEach(input => {
        if (input.type === 'number' && input.id === 'contactPort') {
            input.value = '9900';
        } else {
            input.value = '';
        }
    });
}

// ============================================
// 연락처 관리 UI
// ============================================

async function saveContact() {
    const nickname = document.getElementById('contactNickname').value.trim();
    const ip = document.getElementById('contactIP').value.trim();
    const port = parseInt(document.getElementById('contactPort').value) || 9900;

    if (!nickname) {
        alert('닉네임을 입력하세요.');
        return;
    }

    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.addContact({
                nickname: nickname,
                ip: ip,
                port: port,
                status: 'offline'
            });

            if (result.success) {
                closeModal('contactModal');
                await loadContacts();
                renderContactList();
            } else {
                alert('연락처 추가 실패: ' + (result.error || '알 수 없는 오류'));
            }
        }
    } catch (err) {
        console.error('연락처 추가 실패:', err);
        alert('연락처 추가 실패: ' + err.message);
    }
}

async function deleteContactById(id) {
    if (!confirm('이 연락처를 삭제하시겠습니까?')) return;

    try {
        if (window.messengerDB) {
            await window.messengerDB.deleteContact(id);
            await loadContacts();
            renderContactList();
        }
    } catch (err) {
        console.error('연락처 삭제 실패:', err);
        alert('연락처 삭제 실패: ' + err.message);
    }
}

function renderContactList() {
    const container = document.getElementById('contactList');
    if (!container) return;

    if (state.contacts.length === 0) {
        container.innerHTML = `
            <div class="empty-list">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                <div>연락처가 없습니다</div>
                <div style="margin-top: 4px; font-size: 11px;">위의 버튼을 눌러 연락처를 추가하세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = state.contacts.map(contact => `
        <div class="contact-item" data-id="${contact.id}">
            <div class="contact-avatar">${(contact.nickname || '?').charAt(0).toUpperCase()}</div>
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(contact.nickname)}</div>
                <div class="contact-status ${contact.status === 'online' ? 'online' : ''}">${contact.status === 'online' ? '온라인' : '오프라인'}</div>
            </div>
            <div class="contact-actions">
                <button class="action-btn" onclick="startChatWith('${contact.id}')" title="채팅 시작">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                </button>
                <button class="action-btn danger" onclick="deleteContactById('${contact.id}')" title="삭제">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// 연락처와 채팅 시작
async function startChatWith(contactId) {
    const contact = state.contacts.find(c => c.id === contactId);
    if (!contact) return;

    // 해당 연락처와의 1:1 채팅방이 있는지 확인
    if (window.messengerDB) {
        const roomId = `dm_${contactId}`;

        // 채팅방 생성 또는 조회
        await window.messengerDB.createRoom({
            id: roomId,
            type: 'direct',
            name: contact.nickname
        });

        // 참가자 추가
        if (state.myContactId) {
            await window.messengerDB.addRoomParticipant(roomId, state.myContactId, state.nickname);
        }
        await window.messengerDB.addRoomParticipant(roomId, contactId, contact.nickname);

        // 채팅 탭으로 이동
        document.querySelector('[data-tab="chats"]').click();
        await loadRooms();
        selectRoom(roomId);
    }
}

// ============================================
// 그룹 관리 UI
// ============================================

async function saveGroup() {
    const name = document.getElementById('groupName').value.trim();
    const description = document.getElementById('groupDescription').value.trim();

    if (!name) {
        alert('그룹 이름을 입력하세요.');
        return;
    }

    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.createGroup({
                name: name,
                description: description
            });

            if (result.success) {
                closeModal('groupModal');
                await loadGroups();
                renderGroupList();
            } else {
                alert('그룹 생성 실패: ' + (result.error || '알 수 없는 오류'));
            }
        }
    } catch (err) {
        console.error('그룹 생성 실패:', err);
        alert('그룹 생성 실패: ' + err.message);
    }
}

async function deleteGroupById(id) {
    if (!confirm('이 그룹을 삭제하시겠습니까?')) return;

    try {
        if (window.messengerDB) {
            await window.messengerDB.deleteGroup(id);
            await loadGroups();
            renderGroupList();
        }
    } catch (err) {
        console.error('그룹 삭제 실패:', err);
        alert('그룹 삭제 실패: ' + err.message);
    }
}

function renderGroupList() {
    const container = document.getElementById('groupList');
    if (!container) return;

    if (state.groups.length === 0) {
        container.innerHTML = `
            <div class="empty-list">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
                <div>그룹이 없습니다</div>
                <div style="margin-top: 4px; font-size: 11px;">위의 버튼을 눌러 그룹을 만드세요</div>
            </div>
        `;
        return;
    }

    container.innerHTML = state.groups.map(group => `
        <div class="group-item" data-id="${group.id}">
            <div class="group-avatar">${(group.name || '?').charAt(0).toUpperCase()}</div>
            <div class="group-info">
                <div class="group-name">${escapeHtml(group.name)}</div>
                <div class="group-members">${group.member_count || 0}명</div>
            </div>
            <div class="group-actions">
                <button class="action-btn" onclick="startGroupChat('${group.id}')" title="그룹 채팅">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                    </svg>
                </button>
                <button class="action-btn danger" onclick="deleteGroupById('${group.id}')" title="삭제">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// 그룹 채팅 시작
async function startGroupChat(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (!group) return;

    // 그룹 채팅방 생성
    if (window.messengerDB) {
        const roomId = `group_${groupId}`;

        await window.messengerDB.createRoom({
            id: roomId,
            type: 'group',
            name: group.name
        });

        // 내 참가자 추가
        if (state.myContactId) {
            await window.messengerDB.addRoomParticipant(roomId, state.myContactId, state.nickname);
        }

        // 채팅 탭으로 이동
        document.querySelector('[data-tab="chats"]').click();
        await loadRooms();
        selectRoom(roomId);
    }
}

// ============================================
// 채팅방 관리 UI
// ============================================

// 새 채팅방 만들기 (모달 열기)
function createNewRoom() {
    openModal('roomModal');
}

// 현재 채팅방 나가기
async function leaveCurrentRoom() {
    if (!state.currentRoom) return;

    if (!confirm('이 채팅방을 나가시겠습니까?')) return;

    try {
        await leaveRoom(state.currentRoom);
        state.currentRoom = null;
        hideChatView();
        elements.messagesContainer.innerHTML = '';
    } catch (err) {
        console.error('채팅방 나가기 실패:', err);
        alert('채팅방 나가기 실패: ' + err.message);
    }
}

async function saveRoom() {
    const name = document.getElementById('roomName').value.trim();
    const type = document.getElementById('roomType').value;

    if (!name) {
        alert('채팅방 이름을 입력하세요.');
        return;
    }

    try {
        if (window.messengerDB) {
            const result = await window.messengerDB.createRoom({
                name: name,
                type: type
            });

            if (result.success) {
                // 내 참가자 추가
                if (state.myContactId) {
                    await window.messengerDB.addRoomParticipant(result.id, state.myContactId, state.nickname);
                }

                closeModal('roomModal');
                await loadRooms();
            } else {
                alert('채팅방 생성 실패: ' + (result.error || '알 수 없는 오류'));
            }
        }
    } catch (err) {
        console.error('채팅방 생성 실패:', err);
        alert('채팅방 생성 실패: ' + err.message);
    }
}

// ============================================
// 초기화 업데이트
// ============================================

// DOMContentLoaded 이벤트에 사이드바 탭 초기화 추가
const originalDOMContentLoaded = document.addEventListener;
document.addEventListener('DOMContentLoaded', async () => {
    initTitlebar();
    initTabs();
    initSidebarTabs(); // 새로 추가
    initConnection();
    initChat();
    initP2PListeners();
    initChatAPIListeners(); // 메인 윈도우에서 보내는 이벤트 리스너

    // 데이터 로드
    await loadMyProfile();
    await loadContacts();
    await loadGroups();
    await loadRooms();

    // UI 렌더링
    renderContactList();
    renderGroupList();

    // 현재 P2P 상태 확인
    await checkP2PStatus();
});

// 메인 윈도우 API 이벤트 리스너
function initChatAPIListeners() {
    if (window.chatAPI) {
        // 1:1 채팅 시작 이벤트
        if (window.chatAPI.onStartDirectChat) {
            window.chatAPI.onStartDirectChat((nickname) => {
                console.log('1:1 채팅 요청 수신:', nickname);
                startDirectChat(nickname);
            });
        }

        // 채팅방 선택 이벤트
        if (window.chatAPI.onSelectRoom) {
            window.chatAPI.onSelectRoom(async (roomId) => {
                console.log('채팅방 선택 요청 수신:', roomId);
                // 채팅방 목록 새로고침
                await loadRooms();
                // 해당 채팅방 선택
                if (state.rooms.find(r => r.id === roomId)) {
                    selectRoom(roomId);
                } else {
                    // 채팅방이 목록에 없으면 채팅 탭으로만 이동
                    document.querySelector('[data-tab="chats"]')?.click();
                }
            });
        }
    }
}

// 전역 함수 노출
window.selectRoom = selectRoom;
window.openFile = openFile;
window.openModal = openModal;
window.closeModal = closeModal;
window.saveContact = saveContact;
window.deleteContactById = deleteContactById;
window.startChatWith = startChatWith;
window.saveGroup = saveGroup;
window.deleteGroupById = deleteGroupById;
window.startGroupChat = startGroupChat;
window.saveRoom = saveRoom;
window.startDirectChat = startDirectChat;
window.leaveCurrentRoom = leaveCurrentRoom;
window.createNewRoom = createNewRoom;
