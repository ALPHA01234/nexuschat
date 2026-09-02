/* ============================================================
   NexusChat — local-storage accounts, P2P-ish chat via storage
   events (same browser/profile) + real WebRTC voice calls via
   an optional signaling server for cross-device calling.
   ============================================================ */

// ---------- Storage helpers ----------
const DB = {
  users: 'nexus_users',           // { username: {password, displayName, pfp, createdAt} }
  friends: 'nexus_friends',       // { username: [friendUsernames] }
  messages: 'nexus_messages',     // { "userA|userB": [ {from,to,type,content,ts} ] }
  session: 'nexus_session',       // currentUsername
  settings: 'nexus_settings',     // { signalingUrl }
};

const API = "https://nexuschat-server-o1t5.onrender.com/api/auth";

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getUsers() { return load(DB.users, {}); }
function saveUsers(u) { save(DB.users, u); }
function getFriends() { return load(DB.friends, {}); }
function saveFriends(f) { save(DB.friends, f); }
function getAllMessages() { return load(DB.messages, {}); }
function saveAllMessages(m) { save(DB.messages, m); }
function getSettings() { return load(DB.settings, { signalingUrl: '' }); }
function saveSettings(s) { save(DB.settings, s); }

function convoKey(a, b) { return [a, b].sort().join('|'); }

// ---------- App state ----------
let currentUser = null;       // username (lowercase)
let currentUserData = null;   // {password, displayName, pfp}
let activeChatWith = null;    // username
let mediaRecorder = null;
let recordedChunks = [];
let recordStartTime = null;
let recordTimerInterval = null;

const PFP_COLORS = ['#ff1f3d', '#c41230', '#7a1b9e', '#1b66c2', '#1b9e6b', '#d68a1b', '#5a5a66', '#9e1b6a'];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildSwatches('pfpSwatches');
  buildSwatches('settingsPfpSwatches');
  wireAuthScreen();
  wireAppScreen();
  wireModals();
  wireCalling();

  const session = load(DB.session, null);
  if (session && getUsers()[session]) {
    enterApp(session);
  }

  // Cross-tab sync: messages, friends list, online status
  window.addEventListener('storage', (e) => {
    if (e.key === DB.messages && activeChatWith) renderMessages(activeChatWith);
    if (e.key === DB.messages || e.key === DB.friends) renderDmList();
    if (e.key === 'nexus_presence') renderDmList();
    if (activeChatWith) updateChatHeaderStatus(activeChatWith);
  });

  window.addEventListener('beforeunload', () => setPresence(false));
});

function buildSwatches(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  PFP_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'pfp-swatch';
    sw.style.background = c;
    if (i === 0) sw.classList.add('selected');
    sw.addEventListener('click', () => {
      el.querySelectorAll('.pfp-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      const previewId = containerId === 'pfpSwatches' ? 'pfpPreview' : 'settingsPfpPreview';
      const preview = document.getElementById(previewId);
      preview.style.background = c;
      preview.innerHTML = '';
      preview.dataset.color = c;
      delete preview.dataset.image;
    });
  });
}

// ============================================================
// AUTH SCREEN
// ============================================================
function wireAuthScreen() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + 'Form').classList.add('active');
    });
  });

  document.getElementById('pfpUploadBtn').addEventListener('click', () => document.getElementById('pfpUpload').click());
  document.getElementById('pfpUpload').addEventListener('change', (e) => handlePfpUpload(e, 'pfpPreview'));

  document.getElementById('registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleRegister();
  });
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin();
  });

  document.getElementById('pfpPreview').style.background = PFP_COLORS[0];
  document.getElementById('pfpPreview').dataset.color = PFP_COLORS[0];
}

function handlePfpUpload(e, previewId) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1.5 * 1024 * 1024) {
    alert('Please choose an image smaller than 1.5MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = document.getElementById(previewId);
    preview.innerHTML = `<img src="${ev.target.result}" alt="">`;
    preview.dataset.image = ev.target.result;
    delete preview.dataset.color;
  };
  reader.readAsDataURL(file);
}

async function handleRegister() {
  const username = document.getElementById("regUsername").value.trim().toLowerCase();
  const password = document.getElementById("regPassword").value;
  const errEl = document.getElementById("registerError");

  errEl.textContent = "";

  try {
    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message;
      return;
    }

    alert("Account created successfully! Please log in.");

    document.getElementById("registerForm").reset();

  } catch (err) {
    console.error(err);
    errEl.textContent = "Cannot connect to server.";
  }
}

async function handleLogin() {
  const username = document.getElementById("loginUsername").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");

  errEl.textContent = "";

  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    const data = await res.json();

    if (!res.ok) {
        errEl.textContent = data.message;
        return;
    }

    localStorage.setItem("token", data.token);
localStorage.setItem("username", data.username);

currentUserData = {
    username: data.username,
    displayName: data.displayName,
    avatar: "",
    bio: ""
};

enterApp(data.username);

  } catch (err) {
    console.error(err);
    errEl.textContent = "Cannot connect to server.";
  }
}

function enterApp(username) {
  currentUser = username;

  currentUserData = {
    username: username,
    displayName: username,
    avatar: "",
    bio: ""
  };

  save(DB.session, username);

  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appScreen").classList.add("active");

  renderMyProfile();
  renderDmList();

  if (typeof connectSignalingIfConfigured === "function") {
    connectSignalingIfConfigured();
  }
}

function logout() {
  setPresence(false);
  localStorage.removeItem(DB.session);
  currentUser = null;
  activeChatWith = null;
  if (signalSocket) { try { signalSocket.close(); } catch (e) {} }
  document.getElementById('appScreen').classList.remove('active');
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
}

function setPresence(online) {
  if (!currentUser) return;
  const presence = load('nexus_presence', {});
  presence[currentUser] = { online, lastSeen: Date.now() };
  save('nexus_presence', presence);
}

// ============================================================
// PROFILE RENDERING
// ============================================================
function applyPfpToEl(el, pfp, displayName) {
  if (!pfp) { el.textContent = (displayName || '?')[0].toUpperCase(); return; }
  if (pfp.type === 'image') {
    el.innerHTML = `<img src="${pfp.value}" alt="">`;
    el.style.background = 'var(--raised-2)';
  } else {
    el.innerHTML = '';
    el.textContent = (displayName || '?')[0].toUpperCase();
    el.style.background = pfp.value;
  }
}

function renderMyProfile() {
  document.getElementById('myNameSmall').textContent = currentUserData.displayName;
  applyPfpToEl(document.getElementById('myPfpSmall'), currentUserData.pfp, currentUserData.displayName);
}

// ============================================================
// DM LIST
// ============================================================
function renderDmList() {
  const friends = getFriends()[currentUser] || [];
  const listEl = document.getElementById('dmList');
  const users = getUsers();
  const presence = load('nexus_presence', {});
  const allMsgs = getAllMessages();

  if (friends.length === 0) {
    listEl.innerHTML = `<div class="dm-empty">No friends yet.<br>Click the + above to add one by username.</div>`;
    return;
  }

  const search = (document.getElementById('dmSearch').value || '').toLowerCase();

  listEl.innerHTML = '';
  friends
    .filter(f => f.toLowerCase().includes(search))
    .sort((a, b) => {
      const ta = lastMsgTime(allMsgs, a), tb = lastMsgTime(allMsgs, b);
      return tb - ta;
    })
    .forEach(friendUsername => {
      const fdata = users[friendUsername];
      if (!fdata) return;
      const isOnline = presence[friendUsername]?.online;
      const convo = allMsgs[convoKey(currentUser, friendUsername)] || [];
      const lastMsg = convo[convo.length - 1];

      const item = document.createElement('div');
      item.className = 'dm-item' + (activeChatWith === friendUsername ? ' active' : '');
      item.innerHTML = `
        <div class="dm-pfp-wrap">
          <div class="dm-pfp"></div>
          <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
        </div>
        <div class="dm-info">
          <div class="dm-name">${escapeHtml(fdata.displayName)}</div>
          <div class="dm-preview">${lastMsg ? previewText(lastMsg) : 'Say hello!'}</div>
        </div>
      `;
      applyPfpToEl(item.querySelector('.dm-pfp'), fdata.pfp, fdata.displayName);
      item.addEventListener('click', () => openChat(friendUsername));
      listEl.appendChild(item);
    });
}

function lastMsgTime(allMsgs, friendUsername) {
  const convo = allMsgs[convoKey(currentUser, friendUsername)] || [];
  return convo.length ? convo[convo.length - 1].ts : 0;
}
function previewText(msg) {
  if (msg.type === 'voice') return '🎤 Voice note';
  return escapeHtml(msg.content).slice(0, 40);
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'dmSearch') renderDmList();
});

// ============================================================
// CHAT VIEW
// ============================================================
function openChat(friendUsername) {
  activeChatWith = friendUsername;
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('chatView').classList.add('active');

  const fdata = getUsers()[friendUsername];
  document.getElementById('chatUsername').textContent = fdata.displayName;
  applyPfpToEl(document.getElementById('chatPfp'), fdata.pfp, fdata.displayName);
  updateChatHeaderStatus(friendUsername);

  renderMessages(friendUsername);
  renderDmList();
  document.getElementById('messageInput').focus();
}

function updateChatHeaderStatus(friendUsername) {
  if (activeChatWith !== friendUsername) return;
  const presence = load('nexus_presence', {});
  const isOnline = presence[friendUsername]?.online;
  document.getElementById('chatUserStatus').textContent = isOnline ? 'Online' : 'Offline';
}

function renderMessages(friendUsername) {
  const allMsgs = getAllMessages();
  const convo = allMsgs[convoKey(currentUser, friendUsername)] || [];
  const area = document.getElementById('messagesArea');
  const users = getUsers();
  area.innerHTML = '';

  convo.forEach(msg => {
    const isOwn = msg.from === currentUser;
    const senderData = users[msg.from];
    const row = document.createElement('div');
    row.className = 'msg-row' + (isOwn ? ' own' : '');

    const pfpEl = document.createElement('div');
    pfpEl.className = 'msg-pfp';
    applyPfpToEl(pfpEl, senderData?.pfp, senderData?.displayName);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = formatTime(msg.ts);

    let contentEl;
    if (msg.type === 'voice') {
      contentEl = buildVoiceNoteBubble(msg.content, msg.duration || 0);
    } else {
      contentEl = document.createElement('div');
      contentEl.className = 'msg-content';
      contentEl.textContent = msg.content;
    }

    bubble.appendChild(meta);
    bubble.appendChild(contentEl);
    row.appendChild(pfpEl);
    row.appendChild(bubble);
    area.appendChild(row);
  });

  area.scrollTop = area.scrollHeight;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function buildVoiceNoteBubble(dataUrl, duration) {
  const wrap = document.createElement('div');
  wrap.className = 'voice-note-bubble';

  const btn = document.createElement('button');
  btn.className = 'vn-play-btn';
  btn.innerHTML = playIcon();

  const wave = document.createElement('div');
  wave.className = 'vn-waveform';
  for (let i = 0; i < 28; i++) {
    const bar = document.createElement('span');
    const h = 4 + Math.round(Math.random() * 16);
    bar.style.height = h + 'px';
    wave.appendChild(bar);
  }

  const dur = document.createElement('div');
  dur.className = 'vn-duration';
  dur.textContent = formatDuration(duration);

  const audio = new Audio(dataUrl);
  let playing = false;
  btn.addEventListener('click', () => {
    if (playing) {
      audio.pause();
    } else {
      audio.currentTime = 0;
      audio.play();
    }
  });
  audio.addEventListener('play', () => { playing = true; btn.innerHTML = pauseIcon(); });
  audio.addEventListener('pause', () => { playing = false; btn.innerHTML = playIcon(); });
  audio.addEventListener('ended', () => { playing = false; btn.innerHTML = playIcon(); });

  wrap.appendChild(btn);
  wrap.appendChild(wave);
  wrap.appendChild(dur);
  return wrap;
}

function playIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}
function pauseIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
}
function formatDuration(sec) {
  const s = Math.round(sec);
  return `0:${String(s).padStart(2, '0')}`;
}

function sendMessage(type, content, extra = {}) {
  if (!activeChatWith) return;
  const allMsgs = getAllMessages();
  const key = convoKey(currentUser, activeChatWith);
  allMsgs[key] = allMsgs[key] || [];
  allMsgs[key].push({
    from: currentUser,
    to: activeChatWith,
    type,
    content,
    ts: Date.now(),
    ...extra,
  });
  saveAllMessages(allMsgs);
  renderMessages(activeChatWith);
  renderDmList();
}

// ============================================================
// APP SCREEN WIRING (sidebar, composer)
// ============================================================
function wireAppScreen() {
  document.getElementById('logoutBtn').addEventListener('click', logout);

  document.getElementById('sendBtn').addEventListener('click', sendTextMessage);
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  document.getElementById('removeFriendBtn').addEventListener('click', removeFriend);

  // voice note recording
  document.getElementById('voiceNoteBtn').addEventListener('click', startRecording);
  document.getElementById('cancelRecBtn').addEventListener('click', () => stopRecording(false));
  document.getElementById('stopRecBtn').addEventListener('click', () => stopRecording(true));
}

function sendTextMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  sendMessage('text', text);
  input.value = '';
}

function removeFriend() {
  if (!activeChatWith) return;
  if (!confirm(`Remove ${getUsers()[activeChatWith]?.displayName || activeChatWith} from your friends?`)) return;
  const friends = getFriends();
  friends[currentUser] = (friends[currentUser] || []).filter(f => f !== activeChatWith);
  saveFriends(friends);
  activeChatWith = null;
  document.getElementById('chatView').classList.remove('active');
  document.getElementById('emptyState').style.display = 'flex';
  renderDmList();
}

// ============================================================
// VOICE NOTES (MediaRecorder -> base64 data URL stored in message)
// ============================================================
async function startRecording() {
  if (!activeChatWith) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();
    recordStartTime = Date.now();

    document.getElementById('recordingBar').classList.add('active');
    recordTimerInterval = setInterval(() => {
      const elapsed = (Date.now() - recordStartTime) / 1000;
      document.getElementById('recTime').textContent = formatDuration(elapsed).padStart(4, '0:');
    }, 200);

    mediaRecorder._stream = stream;
  } catch (err) {
    alert('Microphone access is required to record a voice note. Please allow microphone permission and try again.');
  }
}

function stopRecording(send) {
  if (!mediaRecorder) return;
  const duration = (Date.now() - recordStartTime) / 1000;

  mediaRecorder.onstop = () => {
    mediaRecorder._stream.getTracks().forEach(t => t.stop());
    document.getElementById('recordingBar').classList.remove('active');
    clearInterval(recordTimerInterval);

    if (send && recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        sendMessage('voice', reader.result, { duration });
      };
      reader.readAsDataURL(blob);
    }
    mediaRecorder = null;
  };
  mediaRecorder.stop();
}

// ============================================================
// MODALS: Add Friend, Settings
// ============================================================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function wireModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });

  // Add friend
  document.getElementById('addFriendBtn').addEventListener('click', () => openAddFriendModal());
  document.getElementById('emptyAddFriendBtn').addEventListener('click', () => openAddFriendModal());
  document.getElementById('addFriendSubmit').addEventListener('click', handleAddFriend);
  document.getElementById('addFriendInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddFriend();
  });

  // Settings
  document.getElementById('settingsRailBtn').addEventListener('click', openSettingsModal);
  document.getElementById('settingsPfpUploadBtn').addEventListener('click', () => document.getElementById('settingsPfpUpload').click());
  document.getElementById('settingsPfpUpload').addEventListener('change', (e) => handlePfpUpload(e, 'settingsPfpPreview'));
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsModal);
  document.getElementById('connectSignalBtn').addEventListener('click', () => {
    const url = document.getElementById('signalingUrl').value.trim();
    if (url) connectSignaling(url);
  });
}

function openAddFriendModal() {
  document.getElementById('addFriendInput').value = '';
  document.getElementById('addFriendError').textContent = '';
  openModal('addFriendModal');
  setTimeout(() => document.getElementById('addFriendInput').focus(), 50);
}

function handleAddFriend() {
  const input = document.getElementById('addFriendInput');
  const target = input.value.trim().toLowerCase();
  const errEl = document.getElementById('addFriendError');
  errEl.textContent = '';

  if (!target) { errEl.textContent = 'Enter a username.'; return; }
  if (target === currentUser) { errEl.textContent = "You can't add yourself."; return; }

  const users = getUsers();
  if (!users[target]) {
    errEl.textContent = `No account found with username "${target}" on this device/network.`;
    return;
  }

  const friends = getFriends();
  friends[currentUser] = friends[currentUser] || [];
  if (friends[currentUser].includes(target)) {
    errEl.textContent = 'Already friends with this user.';
    return;
  }
  friends[currentUser].push(target);
  // mutual add so both sides see the DM (simulating accepted request)
  friends[target] = friends[target] || [];
  if (!friends[target].includes(currentUser)) friends[target].push(currentUser);
  saveFriends(friends);

  closeModal('addFriendModal');
  renderDmList();
  openChat(target);
}

function openSettingsModal() {
  document.getElementById('settingsDisplay').value = currentUserData.displayName;
  const preview = document.getElementById('settingsPfpPreview');
  applyPfpToEl(preview, currentUserData.pfp, currentUserData.displayName);
  if (currentUserData.pfp.type === 'image') preview.dataset.image = currentUserData.pfp.value;
  else preview.dataset.color = currentUserData.pfp.value;

  const settings = getSettings();
  document.getElementById('signalingUrl').value = settings.signalingUrl || '';
  updateSignalStatusUI();

  openModal('settingsModal');
}

function saveSettingsModal() {
  const newDisplay = document.getElementById('settingsDisplay').value.trim() || currentUser;
  const preview = document.getElementById('settingsPfpPreview');
  const newPfp = preview.dataset.image
    ? { type: 'image', value: preview.dataset.image }
    : { type: 'color', value: preview.dataset.color || PFP_COLORS[0] };

  const users = getUsers();
  users[currentUser].displayName = newDisplay;
  users[currentUser].pfp = newPfp;
  saveUsers(users);
  currentUserData = users[currentUser];

  const url = document.getElementById('signalingUrl').value.trim();
  saveSettings({ signalingUrl: url });

  renderMyProfile();
  renderDmList();
  if (activeChatWith) openChat(activeChatWith);
  closeModal('settingsModal');
}

// ============================================================
// WEBRTC VOICE CALLING
// ============================================================
let signalSocket = null;
let peerConnection = null;
let localStream = null;
let callPartner = null;       // username we're in a call with
let callTimerInterval = null;
let callSeconds = 0;
let isMuted = false;
let pendingOfferFrom = null;
let pendingOfferData = null;

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function connectSignalingIfConfigured() {
  const settings = getSettings();
  if (settings.signalingUrl) connectSignaling(settings.signalingUrl);
}

function connectSignaling(url) {
  if (signalSocket) {
    try { signalSocket.close(); } catch (e) {}
  }
  try {
    signalSocket = new WebSocket(url);
  } catch (e) {
    updateSignalStatusUI(false, 'Invalid URL');
    return;
  }

  updateSignalStatusUI(false, 'Connecting...');

  signalSocket.addEventListener('open', () => {
    signalSocket.send(JSON.stringify({ type: 'register', username: currentUser }));
  });

  signalSocket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    handleSignalingMessage(msg);
  });

  signalSocket.addEventListener('close', () => updateSignalStatusUI(false, 'Disconnected'));
  signalSocket.addEventListener('error', () => updateSignalStatusUI(false, 'Connection error'));
}

function updateSignalStatusUI(connected, label) {
  const el = document.getElementById('signalStatus');
  if (!el) return;
  if (connected === undefined) connected = signalSocket && signalSocket.readyState === WebSocket.OPEN;
  el.innerHTML = `<span class="status-dot ${connected ? 'online' : 'offline'}"></span> ${label || (connected ? 'Connected' : 'Not connected')}`;
}

function handleSignalingMessage(msg) {
  switch (msg.type) {
    case 'registered':
      updateSignalStatusUI(true, 'Connected as ' + msg.username);
      break;
    case 'call-offer':
      pendingOfferFrom = msg.from;
      pendingOfferData = msg.offer;
      showIncomingCall(msg.from);
      break;
    case 'call-answer':
      if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
        setCallStatus('CONNECTED');
        startCallTimer();
      }
      break;
    case 'ice':
      if (peerConnection && msg.candidate) {
        peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
      }
      break;
    case 'call-end':
      endCallCleanup();
      break;
    case 'call-busy':
      alert(`${msg.from} declined the call.`);
      endCallCleanup();
      break;
    case 'call-error':
      if (msg.reason === 'offline') {
        alert(`${msg.to} is not connected to the signaling server right now.`);
        endCallCleanup();
      }
      break;
  }
}

function wireCalling() {
  document.getElementById('voiceCallBtn').addEventListener('click', initiateCall);
  document.getElementById('acceptCallBtn').addEventListener('click', acceptIncomingCall);
  document.getElementById('declineCallBtn').addEventListener('click', declineIncomingCall);
  document.getElementById('endCallBtn').addEventListener('click', endCall);
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
}

function requireSignalingConnected() {
  if (!signalSocket || signalSocket.readyState !== WebSocket.OPEN) {
    alert('Not connected to a signaling server. Open Settings and connect to one first (needed for calls — see server/README.md for setup).');
    return false;
  }
  return true;
}

async function initiateCall() {
  if (!activeChatWith) return;
  if (!requireSignalingConnected()) return;

  callPartner = activeChatWith;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert('Microphone access is required to make a call.');
    return;
  }

  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      signalSocket.send(JSON.stringify({ type: 'ice', to: callPartner, from: currentUser, candidate: e.candidate }));
    }
  };
  peerConnection.ontrack = (e) => {
    document.getElementById('remoteAudio').srcObject = e.streams[0];
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  signalSocket.send(JSON.stringify({ type: 'call-offer', to: callPartner, from: currentUser, offer }));

  showCallHud(callPartner, 'CALLING');
}

function showIncomingCall(fromUsername) {
  const fdata = getUsers()[fromUsername];
  document.getElementById('incomingCallName').textContent = fdata?.displayName || fromUsername;
  applyPfpToEl(document.getElementById('incomingCallPfp'), fdata?.pfp, fdata?.displayName);
  openModal('incomingCallModal');
}

async function acceptIncomingCall() {
  closeModal('incomingCallModal');
  callPartner = pendingOfferFrom;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert('Microphone access is required to accept a call.');
    signalSocket.send(JSON.stringify({ type: 'call-busy', to: callPartner, from: currentUser }));
    return;
  }

  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      signalSocket.send(JSON.stringify({ type: 'ice', to: callPartner, from: currentUser, candidate: e.candidate }));
    }
  };
  peerConnection.ontrack = (e) => {
    document.getElementById('remoteAudio').srcObject = e.streams[0];
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOfferData));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  signalSocket.send(JSON.stringify({ type: 'call-answer', to: callPartner, from: currentUser, answer }));

  showCallHud(callPartner, 'CONNECTED');
  startCallTimer();
}

function declineIncomingCall() {
  closeModal('incomingCallModal');
  if (pendingOfferFrom) {
    signalSocket.send(JSON.stringify({ type: 'call-busy', to: pendingOfferFrom, from: currentUser }));
  }
  pendingOfferFrom = null;
  pendingOfferData = null;
}

function endCall() {
  if (callPartner && signalSocket && signalSocket.readyState === WebSocket.OPEN) {
    signalSocket.send(JSON.stringify({ type: 'call-end', to: callPartner, from: currentUser }));
  }
  endCallCleanup();
}

function endCallCleanup() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  document.getElementById('remoteAudio').srcObject = null;
  clearInterval(callTimerInterval);
  callSeconds = 0;
  isMuted = false;
  callPartner = null;
  pendingOfferFrom = null;
  pendingOfferData = null;
  document.getElementById('callHud').classList.remove('active');
  document.getElementById('muteBtn').classList.remove('muted');
}

function showCallHud(withUsername, status) {
  const fdata = getUsers()[withUsername];
  document.getElementById('callHudName').textContent = fdata?.displayName || withUsername;
  applyPfpToEl(document.getElementById('callHudPfp'), fdata?.pfp, fdata?.displayName);
  setCallStatus(status);
  document.getElementById('callHudTimer').textContent = '00:00';
  document.getElementById('callHud').classList.add('active');
}

function setCallStatus(status) {
  document.getElementById('callHudStatus').textContent = status;
}

function startCallTimer() {
  callSeconds = 0;
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    document.getElementById('callHudTimer').textContent = `${m}:${s}`;
  }, 1000);
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('muteBtn').classList.toggle('muted', isMuted);
}
