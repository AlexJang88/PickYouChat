const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
app.use(cors());

// 정적 파일 경로 설정
app.use(express.static(path.join(__dirname, 'src', 'public')));

let activeRooms = {};
let unreadMessages = {};

// 이전 채팅 기록을 저장할 파일 경로
const chatHistoryFilePath = path.join(__dirname, 'src', 'chatHistory.json');

// 파일에서 이전 채팅 기록 로드 (서버 시작 시 호출)
function loadChatHistory() {
    if (fs.existsSync(chatHistoryFilePath)) {
        const data = fs.readFileSync(chatHistoryFilePath, 'utf8');
        if (data) {
            const chatHistory = JSON.parse(data);
            activeRooms = chatHistory.activeRooms || {};
            unreadMessages = chatHistory.unreadMessages || {};
        }
    }
}

// 서버 시작 시 이전 채팅 기록 로드
loadChatHistory();

// 서버 종료 시 이전 채팅 기록 저장
function saveChatHistory() {
    const chatHistory = { activeRooms, unreadMessages };
    fs.writeFileSync(chatHistoryFilePath, JSON.stringify(chatHistory), 'utf8');
}

// 채팅 HTML 파일을 서빙하는 라우트
app.get('/chat/:sender/:receiver', (req, res) => {
   res.sendFile(path.join(__dirname, 'src', 'public', 'chat.html'));
});

// 채팅 방 목록 페이지를 서빙하는 라우트
app.get('/rooms/:user', (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'rooms.html'));
});

// 채팅 방 목록 API 엔드포인트
app.get('/api/rooms/:user', (req, res) => {
    const user = req.params.user;
    const userRooms = Object.keys(activeRooms).filter(roomId => roomId.includes(user));
    const roomsWithUnreadCounts = userRooms.map(roomId => ({
        roomId,
        unreadCount: unreadMessages[roomId][user]
    }));
    res.json({ rooms: roomsWithUnreadCounts });
});

// 읽지 않은 메시지 수 API 엔드포인트
app.get('/api/unread/:user', (req, res) => {
    const user = req.params.user;
    const userRooms = Object.keys(activeRooms).filter(roomId => roomId.includes(user));
    let totalUnread = 0;
    userRooms.forEach(roomId => {
        if (unreadMessages[roomId] && unreadMessages[roomId][user]) {
            totalUnread += unreadMessages[roomId][user];
        }
    });
    res.json({ unreadCount: totalUnread });
});

// Socket.IO 연결 관리
io.on('connection', (socket) => {

    // 방에 조인하는 이벤트
    socket.on('joinRoom', ({ sender, receiver }) => {
        const roomId = [sender, receiver].sort().join('-');
        socket.join(roomId);
        socket.roomId = roomId;
        if (!activeRooms[roomId]) {
            activeRooms[roomId] = {};
            unreadMessages[roomId] = {};
        }
        // 사용자가 방에 들어오면 해당 방의 안 읽은 메시지 수를 0으로 초기화
        unreadMessages[roomId][sender] = 0;

        // 이전 채팅 기록 확인 및 전송
        if (activeRooms[roomId].history) {
            activeRooms[roomId].history.forEach(message => {
                socket.emit('SEND', message);
            });
        }
    });

    // 메시지를 전송하는 이벤트
    socket.on('SEND', (msg) => {
        const roomId = socket.roomId;
        const sender = msg.sender;
        const receiver = roomId.split('-').find(user => user !== sender);

        // 상대방에게 보낸 메시지 수를 증가시킴

            unreadMessages[roomId][receiver] += 1;


        // 메시지 기록 추가
        if (!activeRooms[roomId].history) {
            activeRooms[roomId].history = [];
        }
        activeRooms[roomId].history.push(msg);

        // 실제 메시지 전송
        io.to(roomId).emit('SEND', msg);
    });

    // 채팅방을 나가는 이벤트
    socket.on('leaveRoom', () => {
        if (socket.roomId) {

            const roomId = socket.roomId;
            const sender = Object.keys(activeRooms[roomId]).find(user => user !== 'history');
            // 채팅방을 나갈 때, 채팅 기록 저장
            saveChatHistory();
            unreadMessages[roomId][sender] = 0;
            // 상대방이 보낸 메시지 수를 사용자에게 안 읽은 메시지로 추가
            // 방 데이터 초기화

        }
    });
});

// 서버 리스닝
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
app.get('/shutdown', (req, res) => {
    res.send('Server is shutting down...');
    saveChatHistory();  // 서버 종료 시 채팅 기록 저장
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
