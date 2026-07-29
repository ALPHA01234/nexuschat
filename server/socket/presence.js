/* ============================================================
   presence.js — tracks which users currently have a live socket
   connection (possibly multiple, for multiple tabs/devices), and
   exposes emitToUser() used everywhere (REST routes included) to
   push real-time events to a specific user.
   ============================================================ */

const User = require('../models/User');

let io = null;
const onlineSockets = new Map(); // userId (string) -> Set<socketId>

function setIO(ioInstance) {
  io = ioInstance;
}

function addSocket(userId, socketId) {
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socketId);
}

function removeSocket(userId, socketId) {
  const set = onlineSockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineSockets.delete(userId);
}

function isUserOnline(userId) {
  return onlineSockets.has(String(userId));
}

function socketIdsFor(userId) {
  return onlineSockets.get(String(userId)) || new Set();
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  socketIdsFor(userId).forEach(socketId => io.to(socketId).emit(event, payload));
}

function broadcastPresence(userId, username, online) {
  if (!io) return;
  io.emit('presence', { userId: String(userId), username, online, lastSeen: Date.now() });
}

async function markOnline(userId, username) {
  await User.findByIdAndUpdate(userId, { online: true, lastSeen: new Date() });
  broadcastPresence(userId, username, true);
}

async function markOfflineIfNoSockets(userId, username) {
  if (isUserOnline(userId)) return; // still has other active sockets/tabs
  await User.findByIdAndUpdate(userId, { online: false, lastSeen: new Date() });
  broadcastPresence(userId, username, false);
}

module.exports = {
  setIO,
  addSocket,
  removeSocket,
  isUserOnline,
  emitToUser,
  broadcastPresence,
  markOnline,
  markOfflineIfNoSockets,
};
