/**
 * P2P 메신저 채팅 윈도우 - 카카오톡 스타일
 */

// 파일 타입별 아이콘 및 색상 반환
function getFileTypeInfo(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
        // 문서
        xlsx: { icon: '📊', color: '#217346', label: 'Excel' },
        xls: { icon: '📊', color: '#217346', label: 'Excel' },
        docx: { icon: '📝', color: '#2B579A', label: 'Word' },
        doc: { icon: '📝', color: '#2B579A', label: 'Word' },
        pptx: { icon: '📽️', color: '#D24726', label: 'PowerPoint' },
        ppt: { icon: '📽️', color: '#D24726', label: 'PowerPoint' },
        pdf: { icon: '📕', color: '#FF0000', label: 'PDF' },
        hwp: { icon: '📄', color: '#0078D7', label: '한글' },
        hwpx: { icon: '📄', color: '#0078D7', label: '한글' },
        txt: { icon: '📃', color: '#666', label: 'Text' },
        // 이미지
        jpg: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        jpeg: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        png: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        gif: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        bmp: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        svg: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        webp: { icon: '🖼️', color: '#4CAF50', label: 'Image' },
        // 압축
        zip: { icon: '📦', color: '#FFC107', label: 'ZIP' },
        rar: { icon: '📦', color: '#FFC107', label: 'RAR' },
        '7z': { icon: '📦', color: '#FFC107', label: '7-Zip' },
        tar: { icon: '📦', color: '#FFC107', label: 'TAR' },
        gz: { icon: '📦', color: '#FFC107', label: 'GZIP' },
        // 미디어
        mp3: { icon: '🎵', color: '#9C27B0', label: 'Audio' },
        wav: { icon: '🎵', color: '#9C27B0', label: 'Audio' },
        mp4: { icon: '🎬', color: '#E91E63', label: 'Video' },
        avi: { icon: '🎬', color: '#E91E63', label: 'Video' },
        mkv: { icon: '🎬', color: '#E91E63', label: 'Video' },
        mov: { icon: '🎬', color: '#E91E63', label: 'Video' },
        // 코드
        js: { icon: '📜', color: '#F7DF1E', label: 'JavaScript' },
        ts: { icon: '📜', color: '#3178C6', label: 'TypeScript' },
        py: { icon: '🐍', color: '#3776AB', label: 'Python' },
        java: { icon: '☕', color: '#007396', label: 'Java' },
        html: { icon: '🌐', color: '#E34F26', label: 'HTML' },
        css: { icon: '🎨', color: '#1572B6', label: 'CSS' },
        json: { icon: '📋', color: '#000', label: 'JSON' },
        xml: { icon: '📋', color: '#000', label: 'XML' },
        // 실행
        exe: { icon: '⚙️', color: '#00599C', label: 'EXE' },
        msi: { icon: '⚙️', color: '#00599C', label: 'MSI' },
        // 기본
        default: { icon: '📄', color: '#999', label: 'File' }
    };
    return types[ext] || types.default;
}

// 파일이 바로 열 수 있는 타입인지 확인
function isOpenableFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    // 문서, 이미지, 미디어 등 일반적으로 열 수 있는 파일 타입
    const openableTypes = [
        'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'hwp', 'hwpx', 'txt',
        'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp',
        'mp3', 'wav', 'mp4', 'avi', 'mkv', 'mov',
        'html', 'htm'
    ];
    return openableTypes.includes(ext);
}

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
    groups: [],      // 그룹 목록
    cloudFiles: [],  // 클라우드 파일 목록
    cloudStatus: { status: 'stopped' } // 클라우드 서버 상태
};

// DOM 요소
const elements = {
    // 상태
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),

    // 연결 상태 패널
    connectStatusPanel: document.getElementById('connectStatusPanel'),
    connectionStatusText: document.getElementById('connectionStatusText'),

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

// 현재 P2P 상태 확인 및 UI 동기화
async function checkP2PStatus() {
    try {
        if (window.p2pAPI) {
            const status = await window.p2pAPI.getStatus();
            state.mode = status.mode || 'offline';
            state.nickname = status.nickname || '';

            updateConnectionUI(state.mode !== 'offline');

            if (state.mode !== 'offline') {
                // 사용자 목록 가져오기
                const users = await window.p2pAPI.getUsers();
                state.users = users || [];
                updateUsersList();
                updateChatStatus();
            }
        }
    } catch (err) {
        console.error('P2P 상태 확인 실패:', err);
        state.mode = 'offline';
        updateConnectionUI(false);
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

// P2P 상태 확인 및 동기화 (메인 패널에서 연결 관리)
async function syncP2PStatus() {
    try {
        const status = await window.p2pAPI.getStatus();
        if (status) {
            state.mode = status.mode || 'offline';
            state.nickname = status.nickname || '';

            // 프로필 로드 또는 저장
            if (state.mode !== 'offline' && state.nickname) {
                const myId = `${state.mode}_${Date.now()}`;
                state.myContactId = myId;
                await saveMyProfile({ id: myId, nickname: state.nickname });
            }

            updateConnectionUI(state.mode !== 'offline');
        }
    } catch (err) {
        console.error('P2P 상태 동기화 실패:', err);
    }
}

// 연결 UI 업데이트
function updateConnectionUI(connected) {
    // 상태 도트 업데이트
    if (elements.statusDot) {
        elements.statusDot.classList.remove('connected', 'host');
        if (connected) {
            elements.statusDot.classList.add('connected');
        }
    }

    // 상태 텍스트 업데이트
    if (elements.statusText) {
        if (connected) {
            elements.statusText.textContent = '연결됨';
        } else {
            elements.statusText.textContent = '연결 안됨';
        }
    }

    // 연결 상태 패널 업데이트
    if (elements.connectStatusPanel) {
        elements.connectStatusPanel.classList.remove('connected', 'host');
        if (connected) {
            elements.connectStatusPanel.classList.add('connected');
        }
    }

    if (elements.connectionStatusText) {
        if (connected) {
            elements.connectionStatusText.textContent = `연결됨 (${state.nickname})`;
        } else {
            elements.connectionStatusText.textContent = '메인 패널에서 연결하세요';
        }
    }
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
            // 게스트 모드일 때 내 메시지를 바로 화면에 표시
            // (호스트는 emit으로 처리되므로 게스트만 직접 표시)
            if (state.mode === 'guest') {
                const messageData = {
                    id: Date.now(),
                    type: 'chat',
                    nickname: state.nickname || '나',
                    content: content,
                    timestamp: Date.now()
                };
                addMessage(messageData);
            }
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
        // 에러 발생 시에도 로컬에 저장 (게스트 모드가 아닐 때만)
        if (state.mode !== 'guest') {
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
    }
}

// 파일 첨부 (클라우드 업로드 + P2P 전송)
async function attachFile() {
    if (state.mode === 'offline') {
        alert('먼저 연결하세요.');
        return;
    }

    try {
        const result = await window.p2pAPI.selectFile();
        if (result.success && result.filePath) {
            // 호스트 모드인 경우 클라우드에 업로드
            if (state.mode === 'host') {
                try {
                    const cloudResult = await window.p2pAPI.uploadToCloud(result.filePath);
                    console.log('클라우드 업로드 완료:', cloudResult);

                    // P2P로 파일 정보 전송 (클라우드 URL 포함)
                    await window.p2pAPI.sendFile(result.filePath, {
                        cloudFileId: cloudResult.fileId,
                        cloudUrl: cloudResult.downloadUrl
                    });
                } catch (cloudErr) {
                    console.error('클라우드 업로드 실패, P2P로만 전송:', cloudErr);
                    await window.p2pAPI.sendFile(result.filePath);
                }
            } else {
                // 게스트 모드: P2P로만 전송
                await window.p2pAPI.sendFile(result.filePath);
            }
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
        state.mode = data.mode || 'offline';
        state.nickname = data.nickname || state.nickname;
        updateConnectionUI(state.mode !== 'offline');
    });

    // 메시지 수신
    window.p2pAPI.onMessage((data) => {
        console.log('메시지 수신:', data);
        // 게스트 모드에서 자신의 메시지는 이미 sendMessage에서 추가했으므로 무시
        if (state.mode === 'guest' && data.nickname === state.nickname) {
            console.log('게스트 모드: 자신의 메시지 에코 무시');
            return;
        }
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

    // 파일 전송 완료
    window.p2pAPI.onFileSent((data) => {
        console.log('파일 전송 완료:', data);
        // 내가 보낸 파일을 채팅방에 표시
        addFileMessage({
            filename: data.filename,
            size: data.size,
            from: state.nickname, // 내 닉네임
            savedPath: null, // 로컬 파일 경로 없음 (전송한 파일)
            cloudFileId: data.cloudFileId || '',
            cloudUrl: data.cloudUrl || ''
        });
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

    // 메시지 입력 활성화
    elements.messageInput.disabled = false;
    elements.messageInput.placeholder = '메시지를 입력하세요...';
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
    elements.chatView.classList.add('active');
}

// 채팅 뷰 숨김
function hideChatView() {
    elements.emptyState.style.display = 'flex';
    elements.chatView.classList.remove('active');
}

// 채팅방 없음 안내 표시 (연결은 되어 있지만 채팅방이 없는 상태)
function showEmptyRoomMessage() {
    elements.emptyState.style.display = 'none';
    elements.chatView.classList.add('active');

    // 메시지 영역에 안내 메시지 표시
    elements.messageList.innerHTML = `
        <div class="empty-room-notice" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #666;
            text-align: center;
            padding: 40px;
        ">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.5;">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">채팅방이 없습니다</h3>
            <p style="margin: 0; font-size: 13px; opacity: 0.8;">
                좌측 패널에서 새 채팅방을 만들거나<br>
                사용자 목록에서 1:1 채팅을 시작하세요.
            </p>
        </div>
    `;

    // 메시지 입력 비활성화
    elements.messageInput.disabled = true;
    elements.sendBtn.disabled = true;
    elements.messageInput.placeholder = '채팅방을 선택하세요';
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
                senderId: isOwn ? (state.myContactId || 'self') : `remote_${data.nickname}`,
                senderNickname: data.nickname || state.nickname,
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
    // from 또는 nickname 필드 사용 (main.js에서는 from으로 전송)
    const sender = data.from || data.nickname || '알 수 없음';
    const isOwn = sender === state.nickname;

    // 중복 메시지 방지: 같은 파일이 이미 최근에 추가되었는지 확인
    const now = Date.now();
    const duplicateThreshold = 2000; // 2초 이내 같은 파일 = 중복
    const isDuplicate = state.messages.some(msg =>
        msg.type === 'file' &&
        msg.filename === data.filename &&
        msg.sender === sender &&
        (now - msg.timestamp) < duplicateThreshold
    );

    if (isDuplicate) {
        console.log('중복 파일 메시지 무시:', data.filename);
        return;
    }

    const message = {
        id: data.transferId || Date.now(),
        type: 'file',
        sender: sender,
        filename: data.filename,
        fileSize: data.size,
        filePath: data.savedPath,
        cloudFileId: data.cloudFileId || '',
        cloudUrl: data.cloudUrl || '',
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
                senderId: isOwn ? (state.myContactId || 'self') : `remote_${sender}`,
                senderNickname: sender,
                type: 'file',
                content: data.filename,
                fileName: data.filename,
                fileSize: data.size,
                filePath: data.savedPath,
                cloudFileId: data.cloudFileId || '',
                cloudUrl: data.cloudUrl || ''
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
        // 파일 타입 정보 가져오기
        const fileTypeInfo = getFileTypeInfo(msg.filename);
        const canOpenDirectly = isOpenableFileType(msg.filename);

        // 이미지 파일 여부 확인
        const ext = msg.filename.split('.').pop().toLowerCase();
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
        const isImage = imageExtensions.includes(ext);

        // 파일 데이터 준비 (JSON으로 인코딩하여 onclick에서 사용)
        const fileData = JSON.stringify({
            filePath: msg.filePath || '',
            cloudFileId: msg.cloudFileId || '',
            cloudUrl: msg.cloudUrl || '',
            filename: msg.filename
        }).replace(/'/g, "\\'").replace(/"/g, '&quot;');

        // 로컬 파일이 있으면 바로 열기, 없으면 클라우드에서 다운로드 후 열기
        const hasLocalFile = msg.filePath && msg.filePath.length > 0;
        const hasCloudFile = msg.cloudUrl || msg.cloudFileId;

        // 이미지 미리보기 URL 결정
        let imagePreviewUrl = '';
        if (isImage) {
            if (hasLocalFile) {
                imagePreviewUrl = `file://${msg.filePath.replace(/\\/g, '/')}`;
            } else if (msg.cloudUrl) {
                imagePreviewUrl = msg.cloudUrl;
            } else if (hasCloudFile) {
                // 클라우드 파일 ID로 URL 구성 (동적으로 결정)
                imagePreviewUrl = `cloud://${msg.cloudFileId}/${encodeURIComponent(msg.filename)}`;
            }
        }

        // 이미지인 경우 미리보기로 렌더링
        if (isImage && (hasLocalFile || hasCloudFile)) {
            el.innerHTML = `
                <div class="message-avatar">${initial}</div>
                <div class="message-content">
                    <div class="message-sender">${escapeHtml(msg.sender)}</div>
                    <div class="message-image-container" data-file='${fileData}'>
                        <div class="image-preview-wrapper" onclick="openImageViewer('${escapeHtml(imagePreviewUrl)}', '${escapeHtml(msg.filename)}')">
                            <img class="message-image-preview"
                                 src="${hasLocalFile ? imagePreviewUrl : ''}"
                                 data-cloud-id="${msg.cloudFileId || ''}"
                                 data-filename="${escapeHtml(msg.filename)}"
                                 alt="${escapeHtml(msg.filename)}"
                                 onerror="this.parentElement.parentElement.classList.add('image-error'); this.style.display='none';"
                                 onload="this.parentElement.parentElement.classList.add('image-loaded');" />
                            <div class="image-loading-placeholder">
                                <div class="loading-spinner"></div>
                            </div>
                            <div class="image-error-placeholder">
                                <span>이미지를 불러올 수 없습니다</span>
                            </div>
                            <div class="image-overlay">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                                    <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
                                </svg>
                            </div>
                        </div>
                        <div class="image-info">
                            <span class="image-filename" title="${escapeHtml(msg.filename)}">${escapeHtml(msg.filename)}</span>
                            <span class="image-size">${formatFileSize(msg.fileSize)}</span>
                        </div>
                        <div class="file-actions">
                            ${hasLocalFile ? `<button class="file-action-btn open-btn" onclick="event.stopPropagation(); openLocalFile('${escapeHtml(msg.filePath).replace(/\\/g, '\\\\')}')" title="바로 열기">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                                </svg>
                            </button>` : ''}
                            ${hasCloudFile && !hasLocalFile ? `<button class="file-action-btn download-open-btn" onclick="event.stopPropagation(); downloadAndOpenFile('${escapeHtml(msg.cloudFileId || '')}', '${escapeHtml(msg.filename)}')" title="다운로드 후 열기">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                                </svg>
                            </button>` : ''}
                            ${hasCloudFile ? `<button class="file-action-btn download-btn" onclick="event.stopPropagation(); downloadCloudFile('${escapeHtml(msg.cloudFileId || '')}', '${escapeHtml(msg.filename)}')" title="다운로드">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                                </svg>
                            </button>` : ''}
                            ${hasLocalFile ? `<button class="file-action-btn folder-btn" onclick="event.stopPropagation(); openFileFolder('${escapeHtml(msg.filePath).replace(/\\/g, '\\\\')}')" title="폴더 열기">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                                </svg>
                            </button>` : ''}
                        </div>
                    </div>
                    <div class="message-meta">
                        <span class="message-time">${time}</span>
                    </div>
                </div>
            `;

            // 클라우드 이미지인 경우 URL을 동적으로 로드
            if (!hasLocalFile && hasCloudFile) {
                loadCloudImagePreview(el.querySelector('.message-image-preview'), msg.cloudFileId, msg.filename);
            }
        } else {
            // 일반 파일 렌더링
            // 바로 열기 버튼 (로컬 파일 있을 때)
            const openLocalBtn = hasLocalFile && canOpenDirectly ? `
                <button class="file-action-btn open-btn" onclick="openLocalFile('${escapeHtml(msg.filePath).replace(/\\/g, '\\\\')}')" title="바로 열기">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                    </svg>
                </button>` : '';

            // 다운로드 후 열기 버튼 (클라우드 파일이고 로컬 없을 때)
            const downloadAndOpenBtn = hasCloudFile && !hasLocalFile && canOpenDirectly ? `
                <button class="file-action-btn download-open-btn" onclick="downloadAndOpenFile('${escapeHtml(msg.cloudFileId || '')}', '${escapeHtml(msg.filename)}')" title="다운로드 후 열기">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                    </svg>
                </button>` : '';

            // 다운로드 버튼 (클라우드 파일 있을 때)
            const downloadBtn = hasCloudFile ? `
                <button class="file-action-btn download-btn" onclick="downloadCloudFile('${escapeHtml(msg.cloudFileId || '')}', '${escapeHtml(msg.filename)}')" title="다운로드">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </button>` : '';

            // 폴더 열기 버튼 (로컬 파일 있을 때)
            const openFolderBtn = hasLocalFile ? `
                <button class="file-action-btn folder-btn" onclick="openFileFolder('${escapeHtml(msg.filePath).replace(/\\/g, '\\\\')}')" title="폴더 열기">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
                    </svg>
                </button>` : '';

            el.innerHTML = `
                <div class="message-avatar">${initial}</div>
                <div class="message-content">
                    <div class="message-sender">${escapeHtml(msg.sender)}</div>
                    <div class="message-file" data-file='${fileData}' style="border-left: 3px solid ${fileTypeInfo.color};">
                        <div class="file-icon" style="background: ${fileTypeInfo.color};">
                            <span style="font-size: 18px;">${fileTypeInfo.icon}</span>
                        </div>
                        <div class="file-info">
                            <div class="file-name">${escapeHtml(msg.filename)}</div>
                            <div class="file-meta">
                                <span class="file-type-label" style="color: ${fileTypeInfo.color};">${fileTypeInfo.label}</span>
                                <span class="file-size">${formatFileSize(msg.fileSize)}</span>
                            </div>
                        </div>
                        <div class="file-actions">
                            ${openLocalBtn}
                            ${downloadAndOpenBtn}
                            ${downloadBtn}
                            ${openFolderBtn}
                        </div>
                    </div>
                    <div class="message-meta">
                        <span class="message-time">${time}</span>
                    </div>
                </div>
            `;
        }
    } else {
        // 카카오톡 스타일 읽음 표시: 안 읽은 사람 수 (숫자로 표시, 모두 읽으면 숫자 사라짐)
        // msg.unreadCount: 안 읽은 사람 수 (undefined면 기본값 사용)
        const unreadCount = msg.unreadCount !== undefined ? msg.unreadCount : (msg.isOwn ? getUnreadCountForMessage(msg) : 0);
        const unreadBadge = msg.isOwn && unreadCount > 0 ? `
            <span class="message-unread-count" title="${unreadCount}명이 안 읽음">${unreadCount}</span>
        ` : '';

        el.innerHTML = `
            <div class="message-avatar">${initial}</div>
            <div class="message-content">
                <div class="message-sender">${escapeHtml(msg.sender)}</div>
                <div class="message-bubble">${escapeHtml(msg.content)}</div>
                <div class="message-meta">
                    ${unreadBadge}
                    <span class="message-time">${time}</span>
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

// 파일 열기 (기존 호환성 유지)
function openFile(filePath) {
    if (filePath && window.chatAPI?.openFile) {
        window.chatAPI.openFile(filePath);
    }
}

// 클라우드 이미지 미리보기 로드
async function loadCloudImagePreview(imgElement, cloudFileId, filename) {
    if (!imgElement || !cloudFileId) return;

    try {
        const status = await window.p2pAPI.getStatus();
        let imageUrl;

        if (status.mode === 'host') {
            const cloudStatus = await window.p2pAPI.getCloudStatus();
            if (cloudStatus.status === 'running') {
                imageUrl = `http://localhost:${cloudStatus.port}/files/${cloudFileId}/${encodeURIComponent(filename)}`;
            }
        } else if (status.mode === 'guest' && status.host) {
            const cloudPort = status.cloudPort || (parseInt(status.port) + 1);
            imageUrl = `http://${status.host}:${cloudPort}/files/${cloudFileId}/${encodeURIComponent(filename)}`;
        }

        if (imageUrl) {
            imgElement.src = imageUrl;
        }
    } catch (err) {
        console.error('클라우드 이미지 로드 실패:', err);
    }
}

// 이미지 뷰어 열기
function openImageViewer(imageUrl, filename) {
    // 모달 생성
    const modal = document.createElement('div');
    modal.className = 'image-viewer-modal';
    modal.innerHTML = `
        <div class="image-viewer-backdrop" onclick="closeImageViewer()"></div>
        <div class="image-viewer-content">
            <div class="image-viewer-header">
                <span class="image-viewer-title">${escapeHtml(filename)}</span>
                <button class="image-viewer-close" onclick="closeImageViewer()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
            </div>
            <div class="image-viewer-body">
                <img src="${imageUrl.startsWith('cloud://') ? '' : imageUrl}" alt="${escapeHtml(filename)}"
                     data-cloud-url="${imageUrl}" />
            </div>
            <div class="image-viewer-footer">
                <button class="image-viewer-btn" onclick="downloadImageFromViewer('${escapeHtml(imageUrl)}', '${escapeHtml(filename)}')">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    다운로드
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 클라우드 URL인 경우 실제 URL로 변환
    if (imageUrl.startsWith('cloud://')) {
        const img = modal.querySelector('.image-viewer-body img');
        const parts = imageUrl.replace('cloud://', '').split('/');
        const cloudFileId = parts[0];
        const fname = decodeURIComponent(parts.slice(1).join('/'));
        loadCloudImagePreview(img, cloudFileId, fname);
    }

    // ESC 키로 닫기
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeImageViewer();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // 애니메이션
    setTimeout(() => modal.classList.add('visible'), 10);
}

// 이미지 뷰어 닫기
function closeImageViewer() {
    const modal = document.querySelector('.image-viewer-modal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 200);
    }
}

// 이미지 뷰어에서 다운로드
async function downloadImageFromViewer(imageUrl, filename) {
    if (imageUrl.startsWith('cloud://')) {
        const parts = imageUrl.replace('cloud://', '').split('/');
        const cloudFileId = parts[0];
        await downloadCloudFile(cloudFileId, filename);
    } else if (imageUrl.startsWith('file://')) {
        openLocalFile(imageUrl.replace('file://', '').replace(/\//g, '\\'));
    } else {
        // HTTP URL 직접 다운로드
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = filename;
        a.click();
    }
}

// 로컬 파일 열기
function openLocalFile(filePath) {
    if (!filePath) {
        showToast('파일 경로가 없습니다.', 'error');
        return;
    }
    if (window.chatAPI?.openFile) {
        window.chatAPI.openFile(filePath);
    } else {
        showToast('파일을 열 수 없습니다.', 'error');
    }
}

// 파일이 있는 폴더 열기
function openFileFolder(filePath) {
    if (!filePath) {
        showToast('파일 경로가 없습니다.', 'error');
        return;
    }
    if (window.chatAPI?.openFileFolder) {
        window.chatAPI.openFileFolder(filePath);
    } else if (window.chatAPI?.openFile) {
        // openFileFolder가 없으면 파일의 상위 디렉토리 경로로 시도
        const folderPath = filePath.replace(/[/\\][^/\\]+$/, '');
        window.chatAPI.openFile(folderPath);
    } else {
        showToast('폴더를 열 수 없습니다.', 'error');
    }
}

// 클라우드 파일 다운로드 후 바로 열기
async function downloadAndOpenFile(fileId, filename) {
    if (!fileId) {
        showToast('클라우드 파일 ID가 없습니다.', 'error');
        return;
    }

    try {
        showToast('파일 다운로드 중...', 'info');

        // P2P 상태 확인
        const status = await window.p2pAPI.getStatus();
        let downloadUrl;

        if (status.mode === 'host') {
            const cloudStatus = await window.p2pAPI.getCloudStatus();
            if (cloudStatus.status !== 'running') {
                showToast('클라우드 서버가 실행 중이 아닙니다.', 'error');
                return;
            }
            downloadUrl = `http://localhost:${cloudStatus.port}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else if (status.mode === 'guest' && status.host && status.cloudPort) {
            downloadUrl = `http://${status.host}:${status.cloudPort}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else if (status.mode === 'guest' && status.host) {
            const cloudPort = parseInt(status.port) + 1;
            downloadUrl = `http://${status.host}:${cloudPort}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else {
            showToast('연결 상태를 확인할 수 없습니다.', 'error');
            return;
        }

        // IPC를 통해 다운로드 및 열기 요청
        if (window.chatAPI?.downloadAndOpenFile) {
            const result = await window.chatAPI.downloadAndOpenFile(downloadUrl, filename);
            if (result.success) {
                showToast('파일을 열었습니다.', 'success');
            } else {
                showToast('파일 열기 실패: ' + (result.error || '알 수 없는 오류'), 'error');
            }
        } else {
            // fallback: 브라우저 다운로드 후 안내
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            showToast('다운로드가 시작됩니다. 다운로드 폴더에서 파일을 열어주세요.', 'info');
        }
    } catch (err) {
        console.error('다운로드 및 열기 실패:', err);
        showToast('다운로드 실패: ' + err.message, 'error');
    }
}

// 클라우드 파일 다운로드
async function downloadCloudFile(fileId, filename) {
    if (!fileId) {
        alert('클라우드 파일 ID가 없습니다.');
        return;
    }

    try {
        // P2P 상태 확인
        const status = await window.p2pAPI.getStatus();
        let downloadUrl;

        if (status.mode === 'host') {
            // 호스트인 경우 클라우드 서버 상태 확인
            const cloudStatus = await window.p2pAPI.getCloudStatus();
            if (cloudStatus.status !== 'running') {
                alert('클라우드 서버가 실행 중이 아닙니다.');
                return;
            }
            downloadUrl = `http://localhost:${cloudStatus.port}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else if (status.mode === 'guest' && status.host && status.cloudPort) {
            // 게스트인 경우 호스트 IP와 cloudPort 사용
            downloadUrl = `http://${status.host}:${status.cloudPort}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else if (status.mode === 'guest' && status.host) {
            // cloudPort가 없는 경우 기본값 사용 (port + 1)
            const cloudPort = parseInt(status.port) + 1;
            downloadUrl = `http://${status.host}:${cloudPort}/files/${fileId}/${encodeURIComponent(filename)}`;
        } else {
            alert('연결 상태를 확인할 수 없습니다. P2P 연결을 확인하세요.');
            return;
        }

        // 브라우저에서 다운로드 트리거
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log('다운로드 시작:', downloadUrl);
    } catch (err) {
        console.error('다운로드 실패:', err);
        alert('다운로드 실패: ' + err.message);
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
                senderId: message.senderId || state.myContactId || 'self',
                senderNickname: message.senderNickname || message.nickname || state.nickname,
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

// 채팅방 삭제
async function deleteRoom(roomId) {
    try {
        if (window.messengerDB) {
            await window.messengerDB.deleteRoom(roomId);
            await loadRooms();

            if (state.currentRoom === roomId) {
                state.currentRoom = null;
                if (state.rooms.length === 0) {
                    showEmptyRoomMessage();
                } else {
                    hideChatView();
                }
            }
        }
    } catch (err) {
        console.error('채팅방 삭제 실패:', err);
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

// 카카오톡 스타일: 안 읽은 사람 수 계산
// P2P 그룹 채팅: 나를 제외한 접속자 수가 안 읽은 사람 수
// 1:1 채팅: 상대방이 읽지 않으면 1, 읽으면 0
function getUnreadCountForMessage(msg) {
    // 현재 방의 타입 확인
    const room = state.rooms.find(r => r.id === state.currentRoom);

    if (room && room.type === 'direct') {
        // 1:1 채팅: 상대방 1명
        // 실제 읽음 상태 추적이 없으므로 일단 0 반환 (읽음으로 표시)
        return 0;
    } else {
        // 그룹 채팅: 나를 제외한 접속자 수
        // 실제 읽음 상태 추적이 없으므로 접속자 수 - 1 반환
        const otherUsers = state.users.filter(u => u.nickname !== state.nickname);
        return otherUsers.length;
    }
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

// 현재 채팅방 나가기 (삭제)
async function leaveCurrentRoom() {
    if (!state.currentRoom) return;

    if (!confirm('이 채팅방을 삭제하시겠습니까?')) return;

    try {
        await deleteRoom(state.currentRoom);
        state.currentRoom = null;
        elements.messagesContainer.innerHTML = '';

        // 채팅방이 없으면 안내 메시지 표시
        if (state.rooms.length === 0) {
            showEmptyRoomMessage();
        } else {
            hideChatView();
        }
    } catch (err) {
        console.error('채팅방 삭제 실패:', err);
        alert('채팅방 삭제 실패: ' + err.message);
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
    initSidebarTabs();
    initChat();
    initP2PListeners();
    initChatAPIListeners(); // 메인 윈도우에서 보내는 이벤트 리스너
    initSettingsBtn(); // 설정 버튼 이벤트 리스너
    initUsersPanelClose(); // 참여자 패널 닫기 버튼
    initUsersPanelResize(); // 참여자 패널 리사이즈
    initSidebarToggle(); // 좌측 사이드바 토글
    initSidebarResize(); // 좌측 사이드바 리사이즈
    initEmojiPicker(); // 이모지 피커
    initCloudTabButtons(); // 클라우드 탭 버튼 이벤트
    initCloudEventListeners(); // 클라우드 이벤트 리스너
    addToastStyles(); // 토스트 스타일 추가

    // 데이터 로드
    await loadMyProfile();
    await loadContacts();
    await loadGroups();
    await loadRooms();

    // UI 렌더링
    renderContactList();
    renderGroupList();
    renderRoomList();

    // 현재 P2P 상태 확인 및 동기화
    await checkP2PStatus();

    // 클라우드 데이터 로드
    await loadCloudData();
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

    // 메신저 데이터 변경 이벤트 리스너 설정
    if (window.messengerDB) {
        // 채팅방 변경 이벤트 (다른 윈도우에서 변경 시)
        if (window.messengerDB.onRoomChanged) {
            window.messengerDB.onRoomChanged(async (data) => {
                console.log('채팅방 변경 이벤트 (채팅윈도우):', data);
                // 채팅방 목록 새로고침
                await loadRooms();
                renderRoomList();
            });
        }

        // 그룹 변경 이벤트 (다른 윈도우에서 변경 시)
        if (window.messengerDB.onGroupChanged) {
            window.messengerDB.onGroupChanged(async (data) => {
                console.log('그룹 변경 이벤트 (채팅윈도우):', data);
                // 그룹 목록 새로고침
                await loadGroups();
                renderGroupList();
            });
        }

        // 연락처 변경 이벤트 (다른 윈도우에서 변경 시)
        if (window.messengerDB.onContactChanged) {
            window.messengerDB.onContactChanged(async (data) => {
                console.log('연락처 변경 이벤트 (채팅윈도우):', data);
                // 연락처 목록 새로고침
                await loadContacts();
                renderContactList();
            });
        }
    }
}

// ============================================
// 설정 기능
// ============================================

// 설정 모달 열기
function openSettingsModal() {
    if (!state.currentRoom) {
        alert('먼저 채팅방을 선택하세요.');
        return;
    }

    const room = state.rooms.find(r => r.id === state.currentRoom);
    if (room) {
        document.getElementById('settingsRoomName').value = room.name || '';
        document.getElementById('settingsNotification').value = room.notification || 'all';
        document.getElementById('settingsPin').checked = room.pinned || false;
    }

    openModal('settingsModal');
}

// 설정 저장
async function saveSettings() {
    if (!state.currentRoom) return;

    const name = document.getElementById('settingsRoomName').value.trim();
    const notification = document.getElementById('settingsNotification').value;
    const pinned = document.getElementById('settingsPin').checked;

    try {
        if (window.messengerDB) {
            await window.messengerDB.updateRoom(state.currentRoom, {
                name: name,
                notification: notification,
                pinned: pinned
            });

            // 로컬 상태 업데이트
            const room = state.rooms.find(r => r.id === state.currentRoom);
            if (room) {
                room.name = name;
                room.notification = notification;
                room.pinned = pinned;
            }

            renderRoomList();
            updateChatHeader(room);
        }

        closeModal('settingsModal');
    } catch (err) {
        console.error('설정 저장 실패:', err);
        alert('설정 저장 실패: ' + err.message);
    }
}

// ============================================
// 사용자 초대 기능
// ============================================

// 초대 모달 열기
function openInviteModal() {
    const inviteList = document.getElementById('inviteUserList');

    // 현재 온라인 사용자 중 본인 제외
    const availableUsers = state.users.filter(u => u.nickname !== state.nickname);

    if (availableUsers.length === 0) {
        inviteList.innerHTML = `
            <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 16px;">
                초대 가능한 온라인 사용자가 없습니다
            </div>
        `;
    } else {
        inviteList.innerHTML = availableUsers.map(user => `
            <label class="user-item" style="cursor: pointer;">
                <input type="checkbox" value="${escapeHtml(user.nickname)}" style="width: auto; margin-right: 8px;">
                <div class="user-avatar">${user.nickname.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <div class="user-name">${escapeHtml(user.nickname)}</div>
                    <div class="user-status" style="color: var(--success);">온라인</div>
                </div>
            </label>
        `).join('');
    }

    openModal('inviteModal');
}

// 선택된 사용자 초대
async function inviteSelectedUsers() {
    const checkboxes = document.querySelectorAll('#inviteUserList input[type="checkbox"]:checked');
    const selectedUsers = Array.from(checkboxes).map(cb => cb.value);

    if (selectedUsers.length === 0) {
        alert('초대할 사용자를 선택하세요.');
        return;
    }

    // 현재 채팅방에 참가자 추가
    if (state.currentRoom && window.messengerDB) {
        try {
            for (const nickname of selectedUsers) {
                await window.messengerDB.addRoomParticipant(state.currentRoom, `user_${nickname}`, nickname);
            }

            // 시스템 메시지 추가
            addSystemMessage(`${selectedUsers.join(', ')}님을 초대했습니다.`);

            closeModal('inviteModal');
        } catch (err) {
            console.error('사용자 초대 실패:', err);
            alert('사용자 초대 실패: ' + err.message);
        }
    } else {
        closeModal('inviteModal');
    }
}

// ============================================
// 참여자 패널 닫기 및 리사이즈
// ============================================

// 참여자 패널 닫기
function closeUsersPanel() {
    elements.usersPanel.classList.remove('visible');
}

// 패널 리사이즈 초기화
function initUsersPanelResize() {
    const panel = document.getElementById('usersPanel');
    const resizeHandle = document.getElementById('usersPanelResize');

    if (!resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = startX - e.clientX;
        const newWidth = Math.min(Math.max(startWidth + diff, 180), 350);
        panel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// 설정 버튼 이벤트 리스너 초기화
function initSettingsBtn() {
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettingsModal);
    }
}

// 참여자 패널 닫기 버튼 이벤트 리스너 초기화
function initUsersPanelClose() {
    const closeBtn = document.getElementById('usersPanelClose');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeUsersPanel);
    }
}

// 사이드바 토글 기능 초기화
function initSidebarToggle() {
    const titlebarToggleBtn = document.getElementById('titlebarPanelToggle');
    const sidebar = document.getElementById('sidebar');

    if (!sidebar) return;

    // 사이드바 숨기기/보이기 함수
    const toggleSidebar = () => {
        const isCollapsed = sidebar.classList.contains('collapsed');

        if (isCollapsed) {
            sidebar.classList.remove('collapsed');
        } else {
            sidebar.classList.add('collapsed');
        }
    };

    // 타이틀바 토글 버튼 클릭 이벤트
    if (titlebarToggleBtn) {
        titlebarToggleBtn.addEventListener('click', toggleSidebar);
    }
}

// 사이드바 리사이즈 기능 초기화
function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.getElementById('sidebarResize');

    if (!resizeHandle || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        if (sidebar.classList.contains('collapsed')) return;

        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        resizeHandle.classList.add('resizing');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const diff = e.clientX - startX;
        const newWidth = Math.min(Math.max(startWidth + diff, 200), 400);
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizeHandle.classList.remove('resizing');
        }
    });
}

// ============================================
// 이모지 피커 기능
// ============================================

// 이모지 데이터
const emojiData = {
    smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐'],
    gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄'],
    hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💌', '💋', '😻', '😽', '🥰', '😍', '🤩', '😘', '💑', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩'],
    animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊'],
    food: ['🍔', '🍕', '🌭', '🍟', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍳', '🍲', '🥘', '🍜', '🍝', '🍛', '🍣', '🍱', '🍤', '🍙', '🍚', '🍘', '🥟', '🥠', '🥡', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '🍮', '🍯', '🍼', '☕', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧊', '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝'],
    activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🏋️', '🤸', '🤺', '🤾', '🏌️', '🏇', '⛹️', '🏊', '🚴', '🚵', '🧗', '🤼', '🎮', '🎲', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻'],
    objects: ['💡', '🔦', '🏮', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎬', '📺', '📻', '🎙️', '🎚️', '🎛️', '⏰', '⏱️', '⏲️', '🕰️', '📡', '🔋', '🔌', '💰', '💵', '💴', '💶', '💷', '💳', '💎', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🔩', '⚙️', '🔗', '📎', '🖇️', '📌', '📍', '✂️', '📝', '✏️', '🖊️', '🖋️', '📚', '📖', '📰', '📃', '📜', '📄', '📑', '🔖', '🏷️'],
    symbols: ['✅', '❌', '⭕', '❓', '❗', '‼️', '⁉️', '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '⬛', '⬜', '◼️', '◻️', '◾', '◽', '▪️', '▫️', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '⏸️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '🔀', '🔁', '🔂', '▶️', '⏯️']
};

// 이모지 피커 초기화
function initEmojiPicker() {
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const emojiContent = document.getElementById('emojiContent');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    if (!emojiBtn || !emojiPicker || !emojiContent) return;

    // 이모지 버튼 클릭 시 피커 토글
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('visible');
        if (emojiPicker.classList.contains('visible')) {
            // 기본 카테고리(smileys) 로드
            loadEmojiCategory('smileys');
        }
    });

    // 피커 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.remove('visible');
        }
    });

    // 카테고리 버튼 클릭
    document.querySelectorAll('.emoji-category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const category = btn.dataset.category;

            // 활성 버튼 변경
            document.querySelectorAll('.emoji-category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 해당 카테고리 이모지 로드
            loadEmojiCategory(category);
        });
    });

    // 이모지 카테고리 로드
    function loadEmojiCategory(category) {
        const emojis = emojiData[category] || [];
        const categoryNames = {
            smileys: '표정',
            gestures: '제스처',
            hearts: '하트',
            animals: '동물',
            food: '음식',
            activities: '활동',
            objects: '사물',
            symbols: '기호'
        };

        emojiContent.innerHTML = `
            <div class="emoji-category-title">${categoryNames[category] || category}</div>
            <div class="emoji-grid">
                ${emojis.map(emoji => `
                    <button class="emoji-item" data-emoji="${emoji}">${emoji}</button>
                `).join('')}
            </div>
        `;

        // 이모지 클릭 이벤트
        emojiContent.querySelectorAll('.emoji-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const emoji = item.dataset.emoji;
                insertEmoji(emoji);
            });
        });
    }

    // 이모지 삽입
    function insertEmoji(emoji) {
        const cursorPos = messageInput.selectionStart;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);

        messageInput.value = textBefore + emoji + textAfter;
        messageInput.focus();

        // 커서 위치 업데이트
        const newCursorPos = cursorPos + emoji.length;
        messageInput.setSelectionRange(newCursorPos, newCursorPos);

        // 전송 버튼 활성화
        sendBtn.disabled = !messageInput.value.trim();
    }
}

// ============================================
// 클라우드 파일 서버 기능
// ============================================

// 클라우드 상태 및 파일 목록 로드
async function loadCloudData() {
    try {
        if (!window.p2pAPI) return;

        // 클라우드 상태 조회
        const status = await window.p2pAPI.getCloudStatus();
        state.cloudStatus = status;
        updateCloudStatusUI();

        // 파일 목록 조회
        if (status.status === 'running') {
            const files = await window.p2pAPI.getCloudFiles();
            state.cloudFiles = files || [];
            renderCloudFileList();
        }
    } catch (err) {
        console.error('클라우드 데이터 로드 실패:', err);
    }
}

// 클라우드 상태 UI 업데이트
function updateCloudStatusUI() {
    const statusDot = document.getElementById('cloudStatusDot');
    const statusText = document.getElementById('cloudStatusText');
    const storageInfo = document.getElementById('cloudStorageInfo');
    const uploadBtn = document.getElementById('uploadToCloudBtn');

    if (!statusDot || !statusText) return;

    const isRunning = state.cloudStatus.status === 'running';

    statusDot.className = 'status-dot ' + (isRunning ? 'online' : 'offline');
    statusText.textContent = isRunning
        ? `클라우드 서버 활성 (포트: ${state.cloudStatus.port})`
        : '클라우드 서버 비활성';

    if (storageInfo) {
        storageInfo.textContent = isRunning
            ? `${state.cloudStatus.fileCount || 0}개 파일 / ${state.cloudStatus.totalSizeFormatted || '0 B'}`
            : '0개 파일 / 0 B';
    }

    if (uploadBtn) {
        uploadBtn.disabled = !isRunning;
        uploadBtn.style.opacity = isRunning ? '1' : '0.5';
    }
}

// 클라우드 파일 목록 렌더링
function renderCloudFileList() {
    const fileList = document.getElementById('cloudFileList');
    const fileCount = document.getElementById('cloudFileCount');

    if (!fileList) return;

    if (fileCount) {
        fileCount.textContent = state.cloudFiles.length;
    }

    if (state.cloudFiles.length === 0) {
        fileList.innerHTML = `
            <div class="cloud-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.3">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                </svg>
                <div>공유된 파일이 없습니다</div>
                <div style="font-size: 11px; margin-top: 4px;">호스트 모드에서 파일을 업로드하세요</div>
            </div>
        `;
        return;
    }

    fileList.innerHTML = state.cloudFiles.map(file => `
        <div class="cloud-file-item" data-file-id="${file.id}">
            <div class="cloud-file-icon">
                ${getFileIcon(file.originalName)}
            </div>
            <div class="cloud-file-info">
                <div class="cloud-file-name" title="${file.originalName}">${file.originalName}</div>
                <div class="cloud-file-meta">
                    ${formatFileSize(file.size)} · ${file.uploadedBy} · 다운로드 ${file.downloadCount || 0}회
                </div>
            </div>
            <div class="cloud-file-actions">
                <button class="cloud-file-action-btn" onclick="downloadCloudFile('${file.id}')" title="다운로드">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </button>
                <button class="cloud-file-action-btn delete" onclick="deleteCloudFile('${file.id}')" title="삭제">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// 파일 아이콘 반환
function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();

    // 이미지
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
    }
    // 문서
    if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    }
    // PDF
    if (ext === 'pdf') {
        return '<svg viewBox="0 0 24 24" fill="#e74c3c"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/></svg>';
    }
    // 엑셀
    if (['xls', 'xlsx', 'csv'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="#27ae60"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    }
    // 압축
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="#f39c12"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z"/></svg>';
    }
    // 비디오
    if (['mp4', 'avi', 'mov', 'mkv', 'wmv', 'webm'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="#9b59b6"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>';
    }
    // 오디오
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) {
        return '<svg viewBox="0 0 24 24" fill="#3498db"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>';
    }
    // 기본
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>';
}

// 파일 크기 포맷
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// 클라우드에 파일 업로드
async function uploadToCloud() {
    try {
        if (!window.p2pAPI) return;

        const result = await window.p2pAPI.selectAndUploadToCloud();
        if (result.success) {
            showToast(`파일 업로드 완료: ${result.filename}`);
            await loadCloudData();
        }
    } catch (err) {
        console.error('파일 업로드 실패:', err);
        showToast('파일 업로드에 실패했습니다', 'error');
    }
}

// 클라우드 파일 다운로드
async function downloadCloudFile(fileId) {
    try {
        const file = state.cloudFiles.find(f => f.id === fileId);
        if (!file) return;

        // 클라우드 서버 URL 구성
        const status = await window.p2pAPI.getCloudStatus();
        if (status.status !== 'running') {
            showToast('클라우드 서버가 실행 중이 아닙니다', 'error');
            return;
        }

        // 다운로드 URL 열기
        const downloadUrl = `http://localhost:${status.port}/files/${fileId}/${encodeURIComponent(file.originalName)}`;
        window.open(downloadUrl, '_blank');

        showToast(`다운로드 시작: ${file.originalName}`);

        // 잠시 후 목록 새로고침 (다운로드 카운트 업데이트)
        setTimeout(() => loadCloudData(), 1000);
    } catch (err) {
        console.error('파일 다운로드 실패:', err);
        showToast('파일 다운로드에 실패했습니다', 'error');
    }
}

// 클라우드 파일 삭제
async function deleteCloudFile(fileId) {
    try {
        const file = state.cloudFiles.find(f => f.id === fileId);
        if (!file) return;

        if (!confirm(`"${file.originalName}" 파일을 삭제하시겠습니까?`)) return;

        await window.p2pAPI.deleteFromCloud(fileId);
        showToast(`파일 삭제됨: ${file.originalName}`);
        await loadCloudData();
    } catch (err) {
        console.error('파일 삭제 실패:', err);
        showToast('파일 삭제에 실패했습니다', 'error');
    }
}

// 클라우드 스토리지 폴더 열기
function openCloudStorage() {
    if (window.p2pAPI) {
        window.p2pAPI.openCloudStorage();
    }
}

// 토스트 메시지 표시
function showToast(message, type = 'success') {
    const existingToast = document.querySelector('.toast-message');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'error' ? '#e74c3c' : '#27ae60'};
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: toastFadeIn 0.3s ease;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// 클라우드 이벤트 리스너 초기화
function initCloudEventListeners() {
    if (!window.p2pAPI) return;

    // 파일 업로드 완료 이벤트
    window.p2pAPI.onCloudFileUploaded((data) => {
        console.log('클라우드 파일 업로드됨:', data);
        loadCloudData();
    });

    // 파일 삭제 이벤트
    window.p2pAPI.onCloudFileDeleted((data) => {
        console.log('클라우드 파일 삭제됨:', data);
        loadCloudData();
    });

    // P2P 상태 변경 시 클라우드 상태도 업데이트
    window.p2pAPI.onStatus((status) => {
        if (status.mode === 'host') {
            // 호스트 모드 시작 시 클라우드 데이터 로드
            setTimeout(() => loadCloudData(), 500);
        } else if (status.mode === 'offline') {
            // 오프라인 시 클라우드 상태 초기화
            state.cloudStatus = { status: 'stopped' };
            state.cloudFiles = [];
            updateCloudStatusUI();
            renderCloudFileList();
        }
    });
}

// 클라우드 탭 버튼 이벤트 초기화
function initCloudTabButtons() {
    const uploadBtn = document.getElementById('uploadToCloudBtn');
    const openStorageBtn = document.getElementById('openCloudStorageBtn');

    if (uploadBtn) {
        uploadBtn.addEventListener('click', uploadToCloud);
    }

    if (openStorageBtn) {
        openStorageBtn.addEventListener('click', openCloudStorage);
    }
}

// 토스트 애니메이션 스타일 추가
function addToastStyles() {
    if (document.getElementById('toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
        @keyframes toastFadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes toastFadeOut {
            from { opacity: 1; transform: translateX(-50%) translateY(0); }
            to { opacity: 0; transform: translateX(-50%) translateY(20px); }
        }
    `;
    document.head.appendChild(style);
}

// 전역 함수 노출
window.selectRoom = selectRoom;
window.openFile = openFile;
window.openLocalFile = openLocalFile;
window.openFileFolder = openFileFolder;
window.downloadAndOpenFile = downloadAndOpenFile;
window.downloadCloudFile = downloadCloudFile;
window.loadCloudImagePreview = loadCloudImagePreview;
window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
window.downloadImageFromViewer = downloadImageFromViewer;
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
window.deleteRoom = deleteRoom;
window.openSettingsModal = openSettingsModal;
window.saveSettings = saveSettings;
window.openInviteModal = openInviteModal;
window.inviteSelectedUsers = inviteSelectedUsers;
window.closeUsersPanel = closeUsersPanel;
window.uploadToCloud = uploadToCloud;
window.downloadCloudFile = downloadCloudFile;
window.deleteCloudFile = deleteCloudFile;
window.openCloudStorage = openCloudStorage;
