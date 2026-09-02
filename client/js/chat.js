/* ============================================================
   chat.js — conversation view: history from MongoDB (paginated),
   real-time send/receive via Socket.IO (REST fallback), voice
   notes, file attachments, reply/edit/delete/pin, search,
   typing indicator, delivery/read receipts.
   ============================================================ */

let mediaRecorder = null;
let recordedChunks = [];
let recordStartTime = null;
let recordTimerInterval = null;
let isLoadingOlderMessages = false;

function otherUsernameOf(msg) {
  return msg.fromUsername === state.me.username ? msg.toUsername : msg.fromUsername;
}

function senderProfile(fromUsername) {
  if (fromUsername === state.me.username) return state.me;
  return findFriend(fromUsername) || { displayName: fromUsername, avatar: null };
}

function appendMessageToState(msg) {
  const other = otherUsernameOf(msg);
  if (!state.conversations[other]) {
    state.conversations[other] = { conversationId: msg.conversationId, messages: [], hasMore: false };
  }
  const convo = state.conversations[other];
  const existing = convo.messages.find(m => m.id === msg.id);
  if (existing) {
    Object.assign(existing, msg);
    return false;
  }
  convo.messages.push(msg);
  convo.messages.sort((a, b) => a.ts - b.ts);
  return true;
}

// ---------------- Opening a conversation ----------------
async function openChat(username) {
  state.activeChatWith = username;
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('chatView').classList.add('active');
  cancelReply();

  const fdata = findFriend(username);
  document.getElementById('chatUsername').textContent = fdata ? fdata.displayName : username;
  applyPfpToEl(document.getElementById('chatPfp'), fdata ? fdata.avatar : null, fdata ? fdata.displayName : username);
  updateChatHeaderStatus(username);

  if (!state.conversations[username]) {
    try {
      const data = await apiFetch(`/messages/with/${username}`);
      state.conversations[username] = { conversationId: data.conversationId, messages: data.messages, hasMore: data.hasMore };
    } catch (err) {
      alert(err.message);
      state.conversations[username] = { conversationId: null, messages: [], hasMore: false };
    }
  }

  renderMessages(username);
  renderDmList();
  markConversationRead(username);
  document.getElementById('messageInput').focus();
}

function updateChatHeaderStatus(username) {
  if (state.activeChatWith !== username) return;
  const statusEl = document.getElementById('chatUserStatus');
  if (state.typingFrom === username) {
    statusEl.innerHTML = '<span class="typing-indicator">Typing...</span>';
    return;
  }
  const presence = state.presence[username] || {};
  statusEl.textContent = presence.online ? 'Online' : 'Offline';
}

function statusLabel(status) {
  if (status === 'read') return 'Read';
  if (status === 'delivered') return 'Delivered';
  return 'Sent';
}

function formatMsgTime(ts) {
  const use24h = state.me?.appearance?.timestamp24h;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], use24h ? { hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function findMessageById(username, id) {
  const convo = state.conversations[username];
  if (!convo) return null;
  return convo.messages.find(m => String(m.id) === String(id));
}

function buildAttachmentEl(attachment) {
  const url = SERVER_URL + attachment.url;
  if (attachment.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-attachment-image';
    img.src = url;
    img.addEventListener('click', () => window.open(url, '_blank'));
    return img;
  }
  if (attachment.kind === 'video') {
    const video = document.createElement('video');
    video.className = 'msg-attachment-video';
    video.src = url;
    video.controls = true;
    return video;
  }
  const link = document.createElement('a');
  link.className = 'msg-attachment-file';
  link.href = url;
  link.target = '_blank';
  link.textContent = `📎 ${attachment.filename || 'Download file'}`;
  return link;
}

function renderMessages(username) {
  const convo = state.conversations[username];
  const area = document.getElementById('messagesArea');
  area.innerHTML = '';
  if (!convo) return;

  convo.messages.forEach(msg => {
    const isOwn = msg.fromUsername === state.me.username;
    const senderData = senderProfile(msg.fromUsername);

    const row = document.createElement('div');
    row.className = 'msg-row' + (isOwn ? ' own' : '');
    row.dataset.msgId = msg.id;

    const pfpEl = document.createElement('div');
    pfpEl.className = 'msg-pfp';
    applyPfpToEl(pfpEl, senderData ? senderData.avatar : null, senderData ? senderData.displayName : msg.fromUsername);

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    if (msg.replyTo) {
      const original = findMessageById(username, msg.replyTo);
      const ctx = document.createElement('div');
      ctx.className = 'msg-reply-context';
      ctx.textContent = original ? `↩ ${original.deleted ? 'Original message deleted' : previewText(original)}` : '↩ Original message';
      ctx.addEventListener('click', () => {
        const el = area.querySelector(`[data-msg-id="${msg.replyTo}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      bubble.appendChild(ctx);
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.innerHTML =
      (msg.pinned ? '<span class="msg-pin-badge">📌</span>' : '') +
      `<span>${formatMsgTime(msg.ts)}</span>` +
      (msg.edited && !msg.deleted ? '<span class="msg-edited-tag">(edited)</span>' : '') +
      (isOwn ? `<span class="msg-status">${statusLabel(msg.status)}</span>` : '');

    let contentEl;
    if (msg.deleted) {
      contentEl = document.createElement('div');
      contentEl.className = 'msg-content msg-deleted-text';
      contentEl.textContent = 'Message deleted';
    } else if (msg.type === 'voice') {
      contentEl = buildVoiceNoteBubble(msg.content, msg.duration || 0);
    } else if (msg.type === 'attachment' && msg.attachment) {
      contentEl = buildAttachmentEl(msg.attachment);
    } else {
      contentEl = document.createElement('div');
      contentEl.className = 'msg-content';
      contentEl.textContent = msg.content;
    }

    bubble.appendChild(meta);
    bubble.appendChild(contentEl);

    if (!msg.deleted) {
      bubble.appendChild(buildMessageToolbar(msg, isOwn, username));
    }

    row.appendChild(pfpEl);
    row.appendChild(bubble);
    area.appendChild(row);
  });

  area.scrollTop = area.scrollHeight;
}

function buildMessageToolbar(msg, isOwn, username) {
  const toolbar = document.createElement('div');
  toolbar.className = 'msg-actions-toolbar';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'msg-action-btn';
  replyBtn.title = 'Reply';
  replyBtn.textContent = '↩';
  replyBtn.addEventListener('click', () => startReply(msg));
  toolbar.appendChild(replyBtn);

  if (msg.type === 'text') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.title = 'Copy';
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(msg.content).catch(() => {}));
    toolbar.appendChild(copyBtn);
  }

  const pinBtn = document.createElement('button');
  pinBtn.className = 'msg-action-btn';
  pinBtn.title = msg.pinned ? 'Unpin' : 'Pin';
  pinBtn.textContent = '📌';
  pinBtn.addEventListener('click', () => togglePin(msg, username));
  toolbar.appendChild(pinBtn);

  if (isOwn && msg.type === 'text') {
    const editBtn = document.createElement('button');
    editBtn.className = 'msg-action-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => startEdit(msg, username));
    toolbar.appendChild(editBtn);
  }

  if (isOwn) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-action-btn';
    delBtn.title = 'Delete';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => deleteMessage(msg, username));
    toolbar.appendChild(delBtn);
  }

  return toolbar;
}

// ---------------- Sending ----------------
async function sendMessage(type, content, extra = {}) {
  if (!state.activeChatWith) return;
  const payload = { to: state.activeChatWith, type, content, duration: extra.duration || 0, attachment: extra.attachment || null, replyTo: extra.replyTo || null };

  if (state.socket && state.socket.connected) {
    state.socket.emit('message:send', payload, (res) => {
      if (!res || !res.ok) alert((res && res.message) || 'Failed to send message.');
    });
  } else {
    try {
      const data = await apiFetch('/messages/send', { method: 'POST', body: JSON.stringify(payload) });
      appendMessageToState(data.message);
      if (state.activeChatWith === otherUsernameOf(data.message)) renderMessages(state.activeChatWith);
      renderDmList();
    } catch (err) {
      alert(err.message);
    }
  }
}

async function markConversationRead(username) {
  const convo = state.conversations[username];
  if (!convo || !convo.conversationId || !state.socket || !state.socket.connected) return;
  state.socket.emit('message:read', { conversationId: convo.conversationId });
}

function sendTextMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text) return;
  sendMessage('text', text, { replyTo: state.replyingTo ? state.replyingTo.id : null });
  input.value = '';
  cancelReply();
  stopTypingSignal();
}

// ---------------- Reply ----------------
function startReply(msg) {
  state.replyingTo = msg;
  const bar = document.getElementById('replyPreviewBar');
  const sender = senderProfile(msg.fromUsername);
  document.getElementById('replyPreviewName').textContent = sender ? (sender.displayName || msg.fromUsername) : msg.fromUsername;
  document.getElementById('replyPreviewText').textContent = previewText(msg);
  bar.classList.add('active');
  document.getElementById('messageInput').focus();
}

function cancelReply() {
  state.replyingTo = null;
  document.getElementById('replyPreviewBar').classList.remove('active');
}

// ---------------- Edit ----------------
function startEdit(msg, username) {
  const input = document.getElementById('messageInput');
  input.value = msg.content;
  input.focus();
  state.editingMessage = { id: msg.id, username };

  const bar = document.getElementById('replyPreviewBar');
  document.getElementById('replyPreviewName').textContent = 'Editing message';
  document.getElementById('replyPreviewText').textContent = 'Press Enter to save, Esc to cancel';
  bar.classList.add('active');
}

function cancelEdit() {
  state.editingMessage = null;
  document.getElementById('messageInput').value = '';
  cancelReply();
}

async function saveEdit() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  const editing = state.editingMessage;
  if (!editing || !content) return;

  try {
    const data = await apiFetch(`/messages/${editing.id}`, { method: 'PUT', body: JSON.stringify({ content }) });
    appendMessageToState(data.message);
    if (state.activeChatWith === editing.username) renderMessages(editing.username);
  } catch (err) {
    alert(err.message);
  }
  state.editingMessage = null;
  input.value = '';
  cancelReply();
}

// ---------------- Delete / Pin ----------------
async function deleteMessage(msg, username) {
  if (!confirm('Delete this message?')) return;
  try {
    await apiFetch(`/messages/${msg.id}`, { method: 'DELETE' });
    const m = findMessageById(username, msg.id);
    if (m) { m.deleted = true; m.content = ''; m.attachment = null; }
    if (state.activeChatWith === username) renderMessages(username);
  } catch (err) {
    alert(err.message);
  }
}

async function togglePin(msg, username) {
  try {
    const data = await apiFetch(`/messages/${msg.id}/pin`, { method: msg.pinned ? 'DELETE' : 'POST' });
    appendMessageToState(data.message);
    if (state.activeChatWith === username) renderMessages(username);
  } catch (err) {
    alert(err.message);
  }
}

async function openPinnedMessages() {
  if (!state.activeChatWith) return;
  const convo = state.conversations[state.activeChatWith];
  if (!convo || !convo.conversationId) return;

  try {
    const data = await apiFetch(`/messages/${convo.conversationId}/pinned`);
    const listEl = document.getElementById('pinnedMessagesList');
    listEl.innerHTML = data.pinned.length === 0 ? `<div class="search-results-empty">No pinned messages yet.</div>` : '';
    data.pinned.forEach(m => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `<div class="search-result-info"><div class="search-result-name">${escapeHtml(previewText(m))}</div><div class="search-result-sub">${formatMsgTime(m.ts)}</div></div>`;
      row.addEventListener('click', () => {
        closeModal('pinnedMessagesModal');
        const el = document.getElementById('messagesArea').querySelector(`[data-msg-id="${m.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      listEl.appendChild(row);
    });
    openModal('pinnedMessagesModal');
  } catch (err) {
    alert(err.message);
  }
}

// ---------------- Search ----------------
const runMessageSearch = debounce(async (query) => {
  const resultsEl = document.getElementById('messageSearchResults');
  if (!query || !state.activeChatWith) { resultsEl.innerHTML = ''; return; }
  try {
    const data = await apiFetch(`/messages/search?withUsername=${encodeURIComponent(state.activeChatWith)}&q=${encodeURIComponent(query)}`);
    resultsEl.innerHTML = data.results.length === 0 ? `<div class="search-results-empty">No matches found.</div>` : '';
    data.results.forEach(m => {
      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `<div class="search-result-info"><div class="search-result-name">${escapeHtml(previewText(m))}</div><div class="search-result-sub">${formatMsgTime(m.ts)}</div></div>`;
      row.addEventListener('click', () => {
        closeModal('messageSearchModal');
        const el = document.getElementById('messagesArea').querySelector(`[data-msg-id="${m.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      resultsEl.appendChild(row);
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="search-results-empty">${escapeHtml(err.message)}</div>`;
  }
}, 300);

// ---------------- Infinite scroll (load older messages) ----------------
async function maybeLoadOlderMessages() {
  const username = state.activeChatWith;
  if (!username) return;
  const convo = state.conversations[username];
  if (!convo || !convo.hasMore || isLoadingOlderMessages || convo.messages.length === 0) return;

  isLoadingOlderMessages = true;
  const area = document.getElementById('messagesArea');
  const prevHeight = area.scrollHeight;
  try {
    const oldest = convo.messages[0];
    const data = await apiFetch(`/messages/with/${username}?before=${oldest.ts}`);
    convo.messages = [...data.messages, ...convo.messages];
    convo.hasMore = data.hasMore;
    renderMessages(username);
    area.scrollTop = area.scrollHeight - prevHeight;
  } catch (err) {
    // silent — infinite scroll failures shouldn't interrupt reading
  }
  isLoadingOlderMessages = false;
}

// ---------------- Real-time events (dispatched from socket.js) ----------------
function onIncomingMessage(msg) {
  const isNew = appendMessageToState(msg);
  const other = otherUsernameOf(msg);

  if (state.activeChatWith === other) {
    renderMessages(other);
    if (msg.toUsername === state.me.username) markConversationRead(other);
  } else if (isNew && msg.toUsername === state.me.username) {
    const sender = findFriend(msg.fromUsername);
    notifyUser(sender ? sender.displayName : msg.fromUsername, previewText(msg), 'desktop');
  }
  if (isNew && msg.toUsername === state.me.username) playMessageSound();
  renderDmList();
}

function onMessageEdited(msg) {
  appendMessageToState(msg);
  const other = otherUsernameOf(msg);
  if (state.activeChatWith === other) renderMessages(other);
}

function onMessageDeleted({ id, conversationId }) {
  Object.keys(state.conversations).forEach(username => {
    const convo = state.conversations[username];
    if (!convo || String(convo.conversationId) !== String(conversationId)) return;
    const m = convo.messages.find(m => String(m.id) === String(id));
    if (m) { m.deleted = true; m.content = ''; m.attachment = null; }
    if (state.activeChatWith === username) renderMessages(username);
  });
}

function onMessagePinned(msg) { appendMessageToState(msg); if (state.activeChatWith === otherUsernameOf(msg)) renderMessages(state.activeChatWith); }
function onMessageUnpinned(msg) { appendMessageToState(msg); if (state.activeChatWith === otherUsernameOf(msg)) renderMessages(state.activeChatWith); }

function onMessageRead({ conversationId, messageIds }) {
  const idSet = new Set((messageIds || []).map(String));
  Object.keys(state.conversations).forEach(username => {
    const convo = state.conversations[username];
    if (!convo || String(convo.conversationId) !== String(conversationId)) return;
    let changed = false;
    convo.messages.forEach(m => { if (idSet.has(String(m.id))) { m.status = 'read'; changed = true; } });
    if (changed && state.activeChatWith === username) renderMessages(username);
  });
}

// ---------------- Typing indicator ----------------
let typingActive = false;
function stopTypingSignal() {
  if (typingActive && state.socket && state.activeChatWith) {
    state.socket.emit('typing', { to: state.activeChatWith, isTyping: false });
  }
  typingActive = false;
  clearTimeout(state.typingTimeout);
}

function wireTypingIndicator() {
  const input = document.getElementById('messageInput');
  input.addEventListener('input', () => {
    if (!state.activeChatWith || !state.socket || !state.socket.connected) return;
    if (!typingActive) {
      typingActive = true;
      state.socket.emit('typing', { to: state.activeChatWith, isTyping: true });
    }
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(stopTypingSignal, 1500);
  });
}

function onTyping(from, isTyping) {
  if (state.activeChatWith !== from) return;
  state.typingFrom = isTyping ? from : null;
  updateChatHeaderStatus(from);
}

// ---------------- App-screen wiring (composer + toolbar) ----------------
function wireChatUI() {
  document.getElementById('sendBtn').addEventListener('click', () => {
    if (state.editingMessage) saveEdit(); else sendTextMessage();
  });
  document.getElementById('messageInput').addEventListener('keydown', (e) => {
    const enterToSend = state.me?.appearance?.enterToSend !== false;
    if (e.key === 'Escape' && state.editingMessage) { e.preventDefault(); cancelEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
      e.preventDefault();
      if (state.editingMessage) saveEdit(); else sendTextMessage();
    }
  });
  document.getElementById('cancelReplyBtn').addEventListener('click', () => {
    if (state.editingMessage) cancelEdit(); else cancelReply();
  });
  wireTypingIndicator();

  document.getElementById('voiceNoteBtn').addEventListener('click', startRecording);
  document.getElementById('cancelRecBtn').addEventListener('click', () => stopRecording(false));
  document.getElementById('stopRecBtn').addEventListener('click', () => stopRecording(true));

  document.getElementById('pinnedMessagesBtn').addEventListener('click', openPinnedMessages);
  document.getElementById('messageSearchBtn').addEventListener('click', () => {
    document.getElementById('messageSearchInput').value = '';
    document.getElementById('messageSearchResults').innerHTML = '';
    openModal('messageSearchModal');
    setTimeout(() => document.getElementById('messageSearchInput').focus(), 50);
  });
  document.getElementById('messageSearchInput').addEventListener('input', (e) => runMessageSearch(e.target.value.trim()));

  document.getElementById('messagesArea').addEventListener('scroll', (e) => {
    if (e.target.scrollTop < 80) maybeLoadOlderMessages();
  });

  wireFileUpload();
}

// ---------------- Voice notes (MediaRecorder -> base64 data URL) ----------------
async function startRecording() {
  if (!state.activeChatWith) return;
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
      reader.onload = () => sendMessage('voice', reader.result, { duration });
      reader.readAsDataURL(blob);
    }
    mediaRecorder = null;
  };
  mediaRecorder.stop();
}

// ---------------- File attachments (picker, drag & drop, paste) ----------------
function wireFileUpload() {
  document.getElementById('attachBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) uploadAndSendFile(file);
    e.target.value = '';
  });

  const chatView = document.getElementById('chatView');
  const overlay = document.getElementById('dropzoneOverlay');
  let dragCounter = 0;

  chatView.addEventListener('dragenter', (e) => {
    if (!state.activeChatWith) return;
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('active');
  });
  chatView.addEventListener('dragover', (e) => e.preventDefault());
  chatView.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) overlay.classList.remove('active');
  });
  chatView.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('active');
    if (!state.activeChatWith) return;
    const file = e.dataTransfer.files[0];
    if (file) uploadAndSendFile(file);
  });

  document.getElementById('messageInput').addEventListener('paste', (e) => {
    if (!state.activeChatWith) return;
    const items = Array.from(e.clipboardData?.items || []);
    const fileItem = items.find(i => i.kind === 'file');
    if (fileItem) {
      e.preventDefault();
      uploadAndSendFile(fileItem.getAsFile());
    }
  });
}

async function uploadAndSendFile(file) {
  if (!state.activeChatWith) return;
  if (file.size > 25 * 1024 * 1024) { alert('Files must be under 25MB.'); return; }

  const bar = document.getElementById('uploadProgressBar');
  const fill = document.getElementById('uploadProgressFill');
  const label = document.getElementById('uploadProgressLabel');
  bar.style.display = 'block';
  fill.style.width = '30%';
  label.textContent = `Uploading ${file.name}...`;

  try {
    const data = await apiUpload(file);
    fill.style.width = '100%';
    await sendMessage('attachment', '', { attachment: data.attachment, replyTo: state.replyingTo ? state.replyingTo.id : null });
    cancelReply();
  } catch (err) {
    alert(err.message);
  } finally {
    setTimeout(() => { bar.style.display = 'none'; fill.style.width = '0%'; }, 400);
  }
}
