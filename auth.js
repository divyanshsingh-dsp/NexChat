const crypto = require("crypto");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hashed = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hashed}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;

  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;

  const derivedHash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(derivedHash, "hex")
  );
}

function createToken(userId) {
  return `nexchat-${userId}`;
}

function getUserIdFromToken(token) {
  if (typeof token !== "string") return null;
  if (!token.startsWith("nexchat-")) return null;
  return token.slice("nexchat-".length);
}

module.exports = { hashPassword, verifyPassword, createToken, getUserIdFromToken };
