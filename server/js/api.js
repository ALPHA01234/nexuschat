/* ============================================================
   api.js — backend config, JWT storage, and the fetch wrapper
   every other module uses to talk to MongoDB via the REST API.

   The ONLY things ever kept in localStorage are the JWT token
   and the username — everything else (friends, messages, profile,
   requests) always comes from the API / Socket.IO.
   ============================================================ */

const SERVER_URL = window.location.origin;
const API_BASE = `${SERVER_URL}/api`;

const AUTH_KEYS = {
  token: 'nexus_token',
  username: 'nexus_username',
};

// ---------- Global in-memory app state (never persisted except the JWT) ----------
const state = {
  token: null,
  me: null,                 // { username, displayName, avatar, banner, bio, status, pronouns, themeColor, ... }
  friends: [],               // [{ username, displayName, avatar, online, lastSeen }]
  requests: { incoming: [], outgoing: [] },
  blocked: [],                // [{ username, displayName, avatar }]
  presence: {},              // username -> { online, lastSeen }
  activeChatWith: null,
  conversations: {},         // username -> { conversationId, messages: [], hasMore, replyingTo }
  socket: null,
  typingFrom: null,
  typingTimeout: null,
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function getToken() { return localStorage.getItem(AUTH_KEYS.token); }
function getStoredUsername() { return localStorage.getItem(AUTH_KEYS.username); }

function setSession(token, username) {
  localStorage.setItem(AUTH_KEYS.token, token);
  localStorage.setItem(AUTH_KEYS.username, username);
  state.token = token;
}

function clearSession() {
  localStorage.removeItem(AUTH_KEYS.token);
  localStorage.removeItem(AUTH_KEYS.username);
  state.token = null;
}

// Central fetch wrapper: attaches the JWT, parses JSON, throws with the
// server's message on failure so callers can show it directly.
async function apiFetch(path, options = {}) {
  const token = state.token || getToken();
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {}
  );
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (err) {
    throw new Error('Cannot connect to server.');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const err = new Error((data && data.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

// Multipart upload for file/image/video attachments (no JSON content-type header).
async function apiUpload(file) {
  const token = state.token || getToken();
  const form = new FormData();
  form.append('file', file);

  let res;
  try {
    res = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch (err) {
    throw new Error('Cannot connect to server.');
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const err = new Error((data && data.message) || `Upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
