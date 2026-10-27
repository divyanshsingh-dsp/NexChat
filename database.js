const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Use /data (Render persistent disk) in production, local ./data in dev
const dataDir = process.env.NODE_ENV === "production" && fs.existsSync("/data")
  ? "/data"
  : path.join(__dirname, "data");

// Ensure the data directory exists
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
}

function createUser({ id, name, email, password, avatar }) {
  db.prepare(
    "INSERT INTO users (id, name, email, password, avatar) VALUES (?, ?, ?, ?, ?)"
  ).run(id, name, email.toLowerCase(), password, avatar);
  return getUserByEmail(email);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function saveMessage({ id, roomId, userId, username, avatar, content, timestamp }) {
  db.prepare(
    "INSERT INTO messages (id, room_id, user_id, username, avatar, content, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, roomId, userId, username, avatar, content, timestamp);
}

function getMessagesForRoom(roomId, limit = 50) {
  return db
    .prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC LIMIT ?")
    .all(roomId, limit);
}

function clearOldMessages(roomId, limit = 50) {
  const rows = db.prepare("SELECT id FROM messages WHERE room_id = ? ORDER BY timestamp ASC").all(roomId);
  const excess = rows.slice(0, rows.length - limit);
  if (excess.length) {
    const ids = excess.map((row) => row.id);
    db.prepare(`DELETE FROM messages WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  }
}

module.exports = {
  db,
  getUserByEmail,
  createUser,
  getUserById,
  saveMessage,
  getMessagesForRoom,
  clearOldMessages,
};
