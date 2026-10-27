/*
 * NexChat — Professional Real-Time Chat Application
 * Stack: Node.js + Express + ws + JWT-style token flow
 * Author: Dhruv
 */

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { hashPassword, verifyPassword, createToken, getUserIdFromToken } = require("./auth");
const { createUser, getUserByEmail, getUserById, saveMessage, getMessagesForRoom, clearOldMessages } = require("./database");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { index: false }));

const rooms = {
  general: { name: "# general", users: new Map(), messages: [] },
  tech: { name: "# tech", users: new Map(), messages: [] },
  random: { name: "# random", users: new Map(), messages: [] },
  gaming: { name: "# gaming", users: new Map(), messages: [] },
};

const MAX_ROOM_HISTORY = 50;

function loadRoomHistory() {
  Object.keys(rooms).forEach((roomId) => {
    const storedMessages = getMessagesForRoom(roomId, MAX_ROOM_HISTORY);
    rooms[roomId].messages = storedMessages.map((message) => ({
      id: message.id,
      type: "MESSAGE",
      roomId: message.room_id,
      userId: message.user_id,
      username: message.username,
      avatar: message.avatar,
      content: message.content,
      timestamp: message.timestamp,
    }));
  });
}

loadRoomHistory();

function broadcast(roomId, message, excludeWs = null) {
  const room = rooms[roomId];
  if (!room) return;
  room.users.forEach((user, ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

function getRoomUserList(roomId) {
  const room = rooms[roomId];
  if (!room) return [];
  return Array.from(room.users.values()).map((u) => ({
    id: u.id,
    username: u.username,
    avatar: u.avatar,
  }));
}

function sendTo(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function generateAvatar(username) {
  const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#82E0AA"];
  let hash = 0;
  for (const c of username) hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
  return colors[Math.abs(hash)];
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index-new.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

app.get("/api/rooms", (req, res) => {
  const roomList = Object.entries(rooms).map(([id, room]) => ({
    id,
    name: room.name,
    onlineCount: room.users.size,
  }));
  res.json(roomList);
});

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || name.trim().length < 2) {
    return res.status(400).json({ error: "Please enter a valid full name." });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  const existingUser = getUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const newUser = {
    id: uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password: hashPassword(password),
    avatar: generateAvatar(name.trim()),
  };

  createUser(newUser);

  res.status(201).json({
    token: createToken(newUser.id),
    user: { id: newUser.id, name: newUser.name, email: newUser.email, avatar: newUser.avatar },
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Please provide both email and password." });
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({
    token: createToken(user.id),
    user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar },
  });
});

wss.on("connection", (ws) => {
  ws.userId = uuidv4();
  ws.username = null;
  ws.currentRoom = null;
  ws.avatar = null;

  ws.on("message", (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (data.type) {
      case "JOIN": {
        const { username, roomId, avatar, token } = data;
        const userId = getUserIdFromToken(token);
        const authenticatedUser = getUserById(userId);

        if (!authenticatedUser) {
          return sendTo(ws, { type: "ERROR", message: "Please sign up or log in before joining the chat." });
        }

        const displayName = (username || authenticatedUser.name).trim();
        if (displayName.length < 2) {
          return sendTo(ws, { type: "ERROR", message: "Username must be at least 2 characters." });
        }
        if (!rooms[roomId]) {
          return sendTo(ws, { type: "ERROR", message: "Room not found." });
        }

        if (ws.currentRoom && ws.currentRoom !== roomId) {
          const oldRoom = rooms[ws.currentRoom];
          oldRoom.users.delete(ws);
          broadcast(ws.currentRoom, {
            type: "USER_LEFT",
            userId: ws.userId,
            username: ws.username,
            users: getRoomUserList(ws.currentRoom),
            roomId: ws.currentRoom,
          });
        }

        ws.username = displayName.slice(0, 20);
        ws.currentRoom = roomId;
        ws.avatar = avatar || authenticatedUser.avatar || generateAvatar(displayName);

        rooms[roomId].users.set(ws, {
          id: ws.userId,
          username: ws.username,
          avatar: ws.avatar,
          joinedAt: Date.now(),
        });

        sendTo(ws, {
          type: "ROOM_JOINED",
          roomId,
          history: rooms[roomId].messages,
          users: getRoomUserList(roomId),
          userId: ws.userId,
        });

        broadcast(roomId, {
          type: "USER_JOINED",
          userId: ws.userId,
          username: ws.username,
          avatar: ws.avatar,
          users: getRoomUserList(roomId),
          roomId,
          timestamp: Date.now(),
        }, ws);
        break;
      }

      case "SEND_MESSAGE": {
        if (!ws.username || !ws.currentRoom) {
          return sendTo(ws, { type: "ERROR", message: "Not in a room." });
        }

        const content = (data.content || "").trim().slice(0, 500);
        if (!content) return;

        const message = {
          id: uuidv4(),
          type: "MESSAGE",
          roomId: ws.currentRoom,
          userId: ws.userId,
          username: ws.username,
          avatar: ws.avatar,
          content,
          timestamp: Date.now(),
        };

        const room = rooms[ws.currentRoom];
        room.messages.push(message);
        if (room.messages.length > MAX_ROOM_HISTORY) {
          room.messages.shift();
        }

        saveMessage({
          id: message.id,
          roomId: message.roomId,
          userId: message.userId,
          username: message.username,
          avatar: message.avatar,
          content: message.content,
          timestamp: message.timestamp,
        });
        clearOldMessages(message.roomId, MAX_ROOM_HISTORY);
        broadcast(ws.currentRoom, message);
        break;
      }

      case "TYPING": {
        if (!ws.username || !ws.currentRoom) return;
        broadcast(ws.currentRoom, {
          type: "TYPING",
          userId: ws.userId,
          username: ws.username,
          isTyping: data.isTyping,
          roomId: ws.currentRoom,
        }, ws);
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    if (ws.currentRoom && ws.username) {
      const room = rooms[ws.currentRoom];
      if (room) {
        room.users.delete(ws);
        broadcast(ws.currentRoom, {
          type: "USER_LEFT",
          userId: ws.userId,
          username: ws.username,
          users: getRoomUserList(ws.currentRoom),
          roomId: ws.currentRoom,
          timestamp: Date.now(),
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 NexChat server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready on ws://localhost:${PORT}`);
  console.log(`📁 Channels: ${Object.keys(rooms).join(", ")}\n`);
});
