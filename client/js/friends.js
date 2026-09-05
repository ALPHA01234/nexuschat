/* ============================================================
   friends.js — friend list, cross-device friend requests, user
   search, blocking, mutual friends, presence, DM list rendering.
   ============================================================ */

// ---------------- Loading from the API ----------------
async function loadFriends() {
  const data = await apiFetch('/friends');
  state.friends = data.friends;
  state.friends.forEach(f => {
    state.presence[f.username] = { online: f.online, lastSeen: f.lastSeen };
  });
}

async function loadFriendRequests() {
  const data = await apiFetch('/friends/requests');
  state.requests = data;
  updateFriendRequestBadge();
}

async function loadBlockedUsers() {
  const data = await apiFetch('/friends/blocked');
  state.blocked = data.blocked;
}

function updateFriendRequestBadge() {
  const badge = document.getElementById('friendRequestBadge');
  const count = state.requests.incoming.length;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function findFriend(username) {
  return state.friends.find(f => f.username === username);
}

function isBlocked(username) {
  return state.blocked.some(u => u.username === username);
}

// ---------------- DM list ----------------
function renderDmList() {
  const listEl = document.getElementById('dmList');
  const search = (document.getElementById('dmSearch').value || '').toLowerCase();

  if (state.friends.length === 0) {
    listEl.innerHTML = `<div class="dm-empty">No friends yet.<br>Click the + above to add one by username.</div>`;
    return;
  }

  const friendsFiltered = state.friends
    .filter(f => f.username.toLowerCase().includes(search) || (f.displayName || '').toLowerCase().includes(search))
    .sort((a, b) => lastMsgTime(b.username) - lastMsgTime(a.username));

  if (friendsFiltered.length === 0) {
    listEl.innerHTML = `<div class="dm-empty">No conversations match your search.</div>`;
    return;
  }

  listEl.innerHTML = '';
  friendsFiltered.forEach(fdata => {
    const presence = state.presence[fdata.username] || {};
    const convo = state.conversations[fdata.username];
    const lastMsg = convo && convo.messages.length ? convo.messages[convo.messages.length - 1] : null;

    const item = document.createElement('div');
    item.className = 'dm-item' + (state.activeChatWith === fdata.username ? ' active' : '');
    item.innerHTML = `
      <div class="dm-pfp-wrap">
        <div class="dm-pfp"></div>
        <span class="status-dot ${presence.online ? 'online' : 'offline'}"></span>
      </div>
      <div class="dm-info">
        <div class="dm-name">${escapeHtml(fdata.displayName)} <span class="dm-tag">@${escapeHtml(fdata.username)}</span></div>
        <div class="dm-preview">${lastMsg ? previewText(lastMsg) : 'Say hello!'}</div>
      </div>
    `;
    applyPfpToEl(item.querySelector('.dm-pfp'), fdata.avatar, fdata.displayName);
    item.addEventListener('click', () => openChat(fdata.username));
    listEl.appendChild(item);
  });
}

function lastMsgTime(username) {
  const convo = state.conversations[username];
  if (!convo || convo.messages.length === 0) return 0;
  return convo.messages[convo.messages.length - 1].ts;
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'dmSearch') renderDmList();
});

// ---------------- Add friend modal (search-based) ----------------
function openAddFriendModal() {
  document.getElementById('addFriendInput').value = '';
  document.getElementById('addFriendError').textContent = '';
  document.getElementById('addFriendResults').innerHTML = '';
  openModal('addFriendModal');
  setTimeout(() => document.getElementById('addFriendInput').focus(), 50);
}

const runUserSearch = debounce(async (query) => {
  const resultsEl = document.getElementById('addFriendResults');
  if (!query) { resultsEl.innerHTML = ''; return; }

  try {
    const data = await apiFetch(`/users/search?q=${encodeURIComponent(query)}`);
    if (data.users.length === 0) {
      resultsEl.innerHTML = `<div class="search-results-empty">No users found.</div>`;
      return;
    }
    resultsEl.innerHTML = '';
    data.users.forEach(u => {
      const alreadyFriend = !!findFriend(u.username);
      const alreadyRequested = state.requests.outgoing.some(r => r.username === u.username);

      const row = document.createElement('div');
      row.className = 'search-result-item';
      row.innerHTML = `
        <div class="search-result-pfp"></div>
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(u.displayName)}</div>
          <div class="search-result-sub">@${escapeHtml(u.username)} · ${u.online ? 'Online' : 'Offline'}</div>
        </div>
      `;
      applyPfpToEl(row.querySelector('.search-result-pfp'), u.avatar, u.displayName);

      const btn = document.createElement('button');
      btn.className = 'btn-ghost small';
      if (alreadyFriend) {
        btn.textContent = 'Friends';
        btn.disabled = true;
      } else if (alreadyRequested) {
        btn.textContent = 'Requested';
        btn.disabled = true;
      } else {
        btn.textContent = 'Add';
        btn.addEventListener('click', () => sendFriendRequest(u.username, btn));
      }
      row.appendChild(btn);
      resultsEl.appendChild(row);
    });
  } catch (err) {
    resultsEl.innerHTML = `<div class="search-results-empty">${escapeHtml(err.message)}</div>`;
  }
}, 300);

function wireFriendsUI() {
  document.getElementById('addFriendBtn').addEventListener('click', openAddFriendModal);
  document.getElementById('emptyAddFriendBtn').addEventListener('click', openAddFriendModal);

  document.getElementById('addFriendInput').addEventListener('input', (e) => {
    runUserSearch(e.target.value.trim());
  });
  document.getElementById('addFriendSubmit').addEventListener('click', handleAddFriendSubmit);
  document.getElementById('addFriendInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddFriendSubmit();
  });

  document.getElementById('friendRequestsBtn').addEventListener('click', openFriendRequestsModal);
  document.getElementById('removeFriendBtn').addEventListener('click', removeFriend);
  document.getElementById('blockFriendBtn').addEventListener('click', () => {
    if (state.activeChatWith) blockUser(state.activeChatWith);
  });
}

async function handleAddFriendSubmit() {
  const input = document.getElementById('addFriendInput');
  const target = input.value.trim().toLowerCase();
  const errEl = document.getElementById('addFriendError');
  errEl.textContent = '';

  if (!target) { errEl.textContent = 'Enter a username.'; return; }
  if (target === state.me.username) { errEl.textContent = "You can't add yourself."; return; }

  try {
    await sendFriendRequestRaw(target);
    closeModal('addFriendModal');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function sendFriendRequestRaw(username) {
  const data = await apiFetch('/friends/request', { method: 'POST', body: JSON.stringify({ username }) });
  if (data.status === 'accepted') {
    await loadFriends();
    renderDmList();
  } else {
    await loadFriendRequests();
  }
  return data;
}

async function sendFriendRequest(username, btnEl) {
  try {
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending...'; }
    await sendFriendRequestRaw(username);
    if (btnEl) btnEl.textContent = 'Requested';
  } catch (err) {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Add'; }
    alert(err.message);
  }
}

// ---------------- Friend requests modal ----------------
function openFriendRequestsModal() {
  renderFriendRequestsModal();
  openModal('friendRequestsModal');
}

function renderFriendRequestsModal() {
  const incomingEl = document.getElementById('incomingRequestsList');
  const outgoingEl = document.getElementById('outgoingRequestsList');

  incomingEl.innerHTML = state.requests.incoming.length === 0 ? `<div class="search-results-empty">No incoming requests.</div>` : '';
  state.requests.incoming.forEach(r => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      <div class="search-result-pfp"></div>
      <div class="search-result-info">
        <div class="search-result-name">${escapeHtml(r.displayName)}</div>
        <div class="search-result-sub">@${escapeHtml(r.username)}</div>
      </div>
    `;
    applyPfpToEl(row.querySelector('.search-result-pfp'), r.avatar, r.displayName);

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn-primary small';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', () => respondToRequest(r.id, true));

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn-ghost small';
    rejectBtn.textContent = 'Reject';
    rejectBtn.style.marginLeft = '6px';
    rejectBtn.addEventListener('click', () => respondToRequest(r.id, false));

    row.appendChild(acceptBtn);
    row.appendChild(rejectBtn);
    incomingEl.appendChild(row);
  });

  outgoingEl.innerHTML = state.requests.outgoing.length === 0 ? `<div class="search-results-empty">No pending sent requests.</div>` : '';
  state.requests.outgoing.forEach(r => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      <div class="search-result-pfp"></div>
      <div class="search-result-info">
        <div class="search-result-name">${escapeHtml(r.displayName)}</div>
        <div class="search-result-sub">@${escapeHtml(r.username)} · pending</div>
      </div>
    `;
    applyPfpToEl(row.querySelector('.search-result-pfp'), r.avatar, r.displayName);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-ghost small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelRequest(r.id));
    row.appendChild(cancelBtn);
    outgoingEl.appendChild(row);
  });
}

async function respondToRequest(requestId, accept) {
  try {
    await apiFetch(`/friends/${accept ? 'accept' : 'reject'}/${requestId}`, { method: 'POST' });
    state.requests.incoming = state.requests.incoming.filter(r => r.id !== requestId);
    updateFriendRequestBadge();
    if (accept) {
      await loadFriends();
      renderDmList();
    }
    renderFriendRequestsModal();
  } catch (err) {
    alert(err.message);
  }
}

async function cancelRequest(requestId) {
  try {
    await apiFetch(`/friends/cancel/${requestId}`, { method: 'POST' });
    state.requests.outgoing = state.requests.outgoing.filter(r => r.id !== requestId);
    renderFriendRequestsModal();
  } catch (err) {
    alert(err.message);
  }
}

async function removeFriend() {
  if (!state.activeChatWith) return;
  const fdata = findFriend(state.activeChatWith);
  if (!confirm(`Remove ${fdata?.displayName || state.activeChatWith} from your friends?`)) return;

  try {
    await apiFetch(`/friends/${state.activeChatWith}`, { method: 'DELETE' });
    state.friends = state.friends.filter(f => f.username !== state.activeChatWith);
    closeActiveChat();
    renderDmList();
  } catch (err) {
    alert(err.message);
  }
}

function closeActiveChat() {
  state.activeChatWith = null;
  document.getElementById('chatView').classList.remove('active');
  document.getElementById('emptyState').style.display = 'none';
  showHomeView?.();
}

// ---------------- Block / unblock ----------------
async function blockUser(username) {
  const fdata = findFriend(username);
  if (!confirm(`Block ${fdata?.displayName || username}? This will remove them as a friend and they won't be able to message you.`)) return;

  try {
    await apiFetch(`/friends/block/${username}`, { method: 'POST' });
    state.friends = state.friends.filter(f => f.username !== username);
    if (!isBlocked(username)) state.blocked.push(fdata ? { username, displayName: fdata.displayName, avatar: fdata.avatar } : { username, displayName: username, avatar: null });
    if (state.activeChatWith === username) closeActiveChat();
    renderDmList();
  } catch (err) {
    alert(err.message);
  }
}

async function unblockUser(username) {
  try {
    await apiFetch(`/friends/unblock/${username}`, { method: 'POST' });
    state.blocked = state.blocked.filter(u => u.username !== username);
    renderBlockedUsersList();
  } catch (err) {
    alert(err.message);
  }
}

async function fetchMutualFriends(username) {
  try {
    return await apiFetch(`/friends/mutual/${username}`);
  } catch (err) {
    return { count: 0, users: [] };
  }
}

// ---------------- Real-time events (dispatched from socket.js) ----------------
function onFriendRequestReceived(data) {
  state.requests.incoming.push(data);
  updateFriendRequestBadge();
  if (document.getElementById('friendRequestsModal').classList.contains('active')) renderFriendRequestsModal();
  notifyUser('Friend Request', `${data.displayName} sent you a friend request.`, 'friendRequestAlerts');
}

async function onFriendAccepted(data) {
  if (!findFriend(data.username)) {
    state.friends.push(data);
    state.presence[data.username] = { online: data.online, lastSeen: Date.now() };
  }
  state.requests.outgoing = state.requests.outgoing.filter(r => r.username !== data.username);
  renderDmList();
  if (document.getElementById('friendRequestsModal').classList.contains('active')) renderFriendRequestsModal();
  notifyUser('Friend Request Accepted', `${data.displayName} accepted your friend request.`, 'friendRequestAlerts');
}

function onFriendRejected(data) {
  state.requests.outgoing = state.requests.outgoing.filter(r => r.username !== data.username);
  if (document.getElementById('friendRequestsModal').classList.contains('active')) renderFriendRequestsModal();
}

function onFriendRemoved(data) {
  state.friends = state.friends.filter(f => f.username !== data.username);
  if (state.activeChatWith === data.username) closeActiveChat();
  renderDmList();
}

function onPresenceUpdate(username, online, lastSeen) {
  state.presence[username] = { online, lastSeen };
  if (findFriend(username)) renderDmList();
  if (state.activeChatWith === username) updateChatHeaderStatus(username);
}
