/* ============================================================
   socket.js — single authenticated Socket.IO connection used for:
   real-time messaging, typing indicators, online/offline presence,
   read receipts, delivery status, friend-request events, message
   edit/delete/pin sync, and WebRTC call signaling. Reconnects
   automatically (Socket.IO default behavior).
   ============================================================ */

function connectSocket() {
  if (state.socket) {
    try { state.socket.disconnect(); } catch (e) {}
  }

  const socket = io(SERVER_URL, {
    auth: { token: state.token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  state.socket = socket;

  socket.on('connect', () => updateSignalStatusUI(true, 'Connected'));
  socket.on('disconnect', () => updateSignalStatusUI(false, 'Reconnecting...'));
  socket.on('connect_error', () => updateSignalStatusUI(false, 'Connection error'));

  // ---------------- Messaging ----------------
  socket.on('message:new', (msg) => onIncomingMessage(msg));
  socket.on('message:edited', (msg) => onMessageEdited(msg));
  socket.on('message:deleted', (data) => onMessageDeleted(data));
  socket.on('message:pinned', (msg) => onMessagePinned(msg));
  socket.on('message:unpinned', (msg) => onMessageUnpinned(msg));
  socket.on('message:read', (data) => onMessageRead(data));

  // ---------------- Typing ----------------
  socket.on('typing', ({ from, isTyping }) => onTyping(from, isTyping));

  // ---------------- Presence ----------------
  socket.on('presence', ({ username, online, lastSeen }) => onPresenceUpdate(username, online, lastSeen));

  // ---------------- Friends ----------------
  socket.on('friend:request', (data) => onFriendRequestReceived(data));
  socket.on('friend:accepted', (data) => onFriendAccepted(data));
  socket.on('friend:rejected', (data) => onFriendRejected(data));
  socket.on('friend:removed', (data) => onFriendRemoved(data));

  // ---------------- Call signaling (WebRTC over Socket.IO) ----------------
  socket.on('call:incoming', (data) => onCallIncoming(data));
  socket.on('call:answer', (data) => onCallAnswer(data));
  socket.on('call:ice', (data) => onCallIce(data));
  socket.on('call:declined', (data) => onCallDeclined(data));
  socket.on('call:cancelled', (data) => onCallCancelled(data));
  socket.on('call:ended', (data) => onCallEnded(data));
  socket.on('call:timeout', (data) => onCallTimeout(data));
  socket.on('call:error', (data) => onCallError(data));
  socket.on('call:mute', (data) => onPeerMute(data));
  socket.on('call:video-toggle', (data) => onPeerVideoToggle(data));
  socket.on('call:screen-share', (data) => onPeerScreenShare(data));

  fetchIceConfig();
  return socket;
}

async function fetchIceConfig() {
  try {
    const res = await fetch(`${SERVER_URL}/api/ice-config`);
    const data = await res.json();
    if (data.iceServers) state.iceServers = data.iceServers;
  } catch (e) { /* keep default STUN-only config */ }
}

function disconnectSocket() {
  if (state.socket) {
    try { state.socket.disconnect(); } catch (e) {}
    state.socket = null;
  }
}

function updateSignalStatusUI(connected, label) {
  const html = `<span class="status-dot ${connected ? 'online' : 'offline'}"></span> ${label || (connected ? 'Connected' : 'Not connected')}`;
  ['signalStatus', 'advancedConnectionStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}
