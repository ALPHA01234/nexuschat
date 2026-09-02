/* ============================================================
   settings.js — Discord-style multi-page settings modal:
   My Account, Profile, Privacy, Notifications, Appearance,
   Voice & Video, Chat, Accessibility, Advanced.
   Everything (except device picks / mic test, which are live
   browser state) saves to MongoDB via PUT /api/users/me.
   ============================================================ */

function wireSettingsUI() {
  document.getElementById('settingsRailBtn').addEventListener('click', openSettingsModal);

  document.querySelectorAll('.settings-nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsPage(btn.dataset.page));
  });
  document.getElementById('settingsLogoutNavBtn').addEventListener('click', () => {
    closeModal('settingsModal');
    logout();
  });

  // Account page
  document.getElementById('settingsPfpUploadBtn').addEventListener('click', () => document.getElementById('settingsPfpUpload').click());
  document.getElementById('settingsPfpUpload').addEventListener('change', (e) => handlePfpUpload(e, 'settingsPfpPreview'));
  document.getElementById('settingsBannerUploadBtn').addEventListener('click', () => document.getElementById('settingsBannerUpload').click());
  document.getElementById('settingsBannerUpload').addEventListener('change', (e) => handleBannerUpload(e));
  document.getElementById('saveAccountBtn').addEventListener('click', saveAccountPage);
  document.getElementById('changePasswordBtn').addEventListener('click', changePassword);
  document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);

  // Profile page
  document.getElementById('saveProfileBtn').addEventListener('click', saveProfilePage);
  ['profileBio', 'settingsStatus', 'profilePronouns', 'profileThemeColor'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateProfilePreview);
  });

  // Privacy page
  document.getElementById('savePrivacyBtn').addEventListener('click', savePrivacyPage);

  // Notifications page
  document.getElementById('saveNotificationsBtn').addEventListener('click', saveNotificationsPage);

  // Appearance page
  document.getElementById('appearanceThemeSegmented').addEventListener('click', (e) => segmentedClick(e, 'appearanceThemeSegmented'));
  document.getElementById('appearanceFontSegmented').addEventListener('click', (e) => segmentedClick(e, 'appearanceFontSegmented'));
  document.getElementById('saveAppearanceBtn').addEventListener('click', saveAppearancePage);

  // Voice & video page
  populateDeviceLists();
  document.getElementById('voiceMicTestBtn').addEventListener('click', toggleMicTest);
  document.getElementById('voiceCameraPreviewBtn').addEventListener('click', toggleCameraPreview);

  // Chat page
  document.getElementById('saveChatBtn').addEventListener('click', saveChatPage);

  // Accessibility page
  document.getElementById('saveAccessibilityBtn').addEventListener('click', saveAccessibilityPage);

  // Advanced page
  document.getElementById('clearCacheBtn').addEventListener('click', clearLocalCache);
}

function segmentedClick(e, containerId) {
  const btn = e.target.closest('.segmented-btn');
  if (!btn) return;
  document.getElementById(containerId).querySelectorAll('.segmented-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function getSegmentedValue(containerId) {
  const active = document.getElementById(containerId).querySelector('.segmented-btn.active');
  return active ? active.dataset.value : null;
}

function setSegmentedValue(containerId, value) {
  document.getElementById(containerId).querySelectorAll('.segmented-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === value);
  });
}

function switchSettingsPage(page) {
  document.querySelectorAll('.settings-nav-item[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.settings-page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
  if (page === 'privacy') renderBlockedUsersList();
}

function openSettingsModal() {
  const me = state.me;

  // Account
  document.getElementById('accountUsername').value = me.username;
  document.getElementById('settingsDisplay').value = me.displayName || '';
  document.getElementById('accountEmail').value = me.email || '';
  const badge = document.getElementById('accountEmailBadge');
  badge.textContent = me.emailVerified ? 'Verified' : 'Unverified';
  badge.className = 'verify-badge ' + (me.emailVerified ? 'verified' : 'unverified');

  const pfpPreview = document.getElementById('settingsPfpPreview');
  applyPfpToEl(pfpPreview, me.avatar, me.displayName);
  if (me.avatar && me.avatar.type === 'image') pfpPreview.dataset.image = me.avatar.value;
  else pfpPreview.dataset.color = (me.avatar && me.avatar.value) || PFP_COLORS[0];

  const bannerPreview = document.getElementById('settingsBannerPreview');
  applyBannerToEl(bannerPreview, me.banner);
  if (me.banner && me.banner.type === 'image') bannerPreview.dataset.image = me.banner.value;
  else bannerPreview.dataset.color = (me.banner && me.banner.value) || '#5865f2';

  document.getElementById('currentPasswordInput').value = '';
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('confirmPasswordInput').value = '';
  document.getElementById('passwordChangeError').textContent = '';
  document.getElementById('deleteAccountPassword').value = '';
  document.getElementById('deleteAccountError').textContent = '';

  // Profile
  document.getElementById('profileBio').value = me.bio || '';
  document.getElementById('settingsStatus').value = me.status || '';
  document.getElementById('profilePronouns').value = me.pronouns || '';
  document.getElementById('profileThemeColor').value = me.themeColor || '#ff1f3d';
  updateProfilePreview();

  // Privacy
  document.getElementById('privacyFriendRequests').value = me.privacy?.friendRequests || 'everyone';
  document.getElementById('privacyReadReceipts').checked = me.privacy?.readReceipts !== false;
  document.getElementById('privacyTypingIndicator').checked = me.privacy?.typingIndicator !== false;
  document.getElementById('privacyOnlineVisibility').checked = me.privacy?.onlineVisibility !== false;

  // Notifications
  document.getElementById('notifDesktop').checked = me.notifications?.desktop !== false;
  document.getElementById('notifMentions').checked = me.notifications?.mentions !== false;
  document.getElementById('notifSounds').checked = me.notifications?.sounds !== false;
  document.getElementById('notifFriendRequestAlerts').checked = me.notifications?.friendRequestAlerts !== false;

  // Appearance
  setSegmentedValue('appearanceThemeSegmented', me.appearance?.theme || 'dark');
  setSegmentedValue('appearanceFontSegmented', me.appearance?.fontSize || 'medium');
  document.getElementById('appearanceCompact').checked = !!me.appearance?.compactMode;
  document.getElementById('appearanceAnimations').checked = me.appearance?.animations !== false;

  // Chat
  document.getElementById('chatEnterToSend').checked = me.appearance?.enterToSend !== false;
  document.getElementById('chatTimestamp24h').checked = !!me.appearance?.timestamp24h;

  // Accessibility
  document.getElementById('a11yReduceMotion').checked = !!me.appearance?.reduceMotion;
  document.getElementById('a11yHighContrast').checked = !!me.appearance?.highContrast;

  // Advanced
  document.getElementById('advancedServerUrl').value = SERVER_URL;
  updateSignalStatusUI(!!(state.socket && state.socket.connected));

  switchSettingsPage('account');
  openModal('settingsModal');
}

function applyBannerToEl(el, banner) {
  if (!banner || !banner.value) { el.style.background = '#5865f2'; el.style.backgroundImage = ''; return; }
  if (banner.type === 'image') {
    el.style.backgroundImage = `url(${banner.value})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  } else {
    el.style.background = banner.value;
    el.style.backgroundImage = '';
  }
}

function handleBannerUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { alert('Please choose an image smaller than 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const preview = document.getElementById('settingsBannerPreview');
    applyBannerToEl(preview, { type: 'image', value: ev.target.result });
    preview.dataset.image = ev.target.result;
    delete preview.dataset.color;
  };
  reader.readAsDataURL(file);
}

// ---------------- Save handlers (one per page, each PUTs only what changed conceptually) ----------------
async function persistUser(patch) {
  const data = await apiFetch('/users/me', { method: 'PUT', body: JSON.stringify(patch) });
  state.me = data.user;
  renderMyProfile();
  renderDmList();
  applyAppearanceSettings();
  return data.user;
}

async function saveAccountPage() {
  const pfpPreview = document.getElementById('settingsPfpPreview');
  const avatar = pfpPreview.dataset.image ? { type: 'image', value: pfpPreview.dataset.image } : { type: 'color', value: pfpPreview.dataset.color || PFP_COLORS[0] };
  const bannerPreview = document.getElementById('settingsBannerPreview');
  const banner = bannerPreview.dataset.image ? { type: 'image', value: bannerPreview.dataset.image } : { type: 'color', value: bannerPreview.dataset.color || '#5865f2' };
  const displayName = document.getElementById('settingsDisplay').value.trim();

  try {
    await persistUser({ displayName, avatar, banner });
    if (state.activeChatWith) openChat(state.activeChatWith);
  } catch (err) {
    alert(err.message);
  }
}

async function changePassword() {
  const currentPassword = document.getElementById('currentPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;
  const confirm = document.getElementById('confirmPasswordInput').value;
  const errEl = document.getElementById('passwordChangeError');
  errEl.textContent = '';

  if (newPassword !== confirm) { errEl.textContent = 'New passwords do not match.'; return; }

  try {
    await apiFetch('/users/me/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
    document.getElementById('currentPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('confirmPasswordInput').value = '';
    alert('Password updated.');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function deleteAccount() {
  const password = document.getElementById('deleteAccountPassword').value;
  const errEl = document.getElementById('deleteAccountError');
  errEl.textContent = '';
  if (!password) { errEl.textContent = 'Enter your password to confirm.'; return; }
  if (!confirm('This will permanently delete your account. This cannot be undone. Continue?')) return;

  try {
    await apiFetch('/users/me', { method: 'DELETE', body: JSON.stringify({ password }) });
    closeModal('settingsModal');
    logout();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function updateProfilePreview() {
  const card = document.getElementById('profilePreviewCard');
  const displayName = document.getElementById('settingsDisplay').value.trim() || state.me.username;
  const bio = document.getElementById('profileBio').value.trim();
  const status = document.getElementById('settingsStatus').value.trim();
  const pronouns = document.getElementById('profilePronouns').value.trim();
  const color = document.getElementById('profileThemeColor').value;

  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div class="dm-pfp" id="previewPfp" style="width:44px;height:44px;"></div>
      <div>
        <div style="font-weight:700;color:${color};">${escapeHtml(displayName)}</div>
        <div style="font-size:12px;color:var(--text-dim);">@${escapeHtml(state.me.username)}${pronouns ? ' · ' + escapeHtml(pronouns) : ''}</div>
      </div>
    </div>
    ${status ? `<div style="font-size:12.5px;color:var(--text-dim);margin-bottom:6px;">${escapeHtml(status)}</div>` : ''}
    ${bio ? `<div style="font-size:12.5px;color:var(--text);">${escapeHtml(bio)}</div>` : '<div style="font-size:12px;color:var(--text-faint);">No bio yet.</div>'}
  `;
  applyPfpToEl(document.getElementById('previewPfp'), state.me.avatar, displayName);
}

async function saveProfilePage() {
  try {
    await persistUser({
      bio: document.getElementById('profileBio').value.trim(),
      status: document.getElementById('settingsStatus').value.trim(),
      pronouns: document.getElementById('profilePronouns').value.trim(),
      themeColor: document.getElementById('profileThemeColor').value,
    });
  } catch (err) {
    alert(err.message);
  }
}

async function savePrivacyPage() {
  try {
    await persistUser({
      privacy: {
        friendRequests: document.getElementById('privacyFriendRequests').value,
        readReceipts: document.getElementById('privacyReadReceipts').checked,
        typingIndicator: document.getElementById('privacyTypingIndicator').checked,
        onlineVisibility: document.getElementById('privacyOnlineVisibility').checked,
      },
    });
  } catch (err) {
    alert(err.message);
  }
}

function renderBlockedUsersList() {
  const listEl = document.getElementById('blockedUsersList');
  if (state.blocked.length === 0) {
    listEl.innerHTML = `<div class="search-results-empty">No blocked users.</div>`;
    return;
  }
  listEl.innerHTML = '';
  state.blocked.forEach(u => {
    const row = document.createElement('div');
    row.className = 'search-result-item';
    row.innerHTML = `
      <div class="search-result-pfp"></div>
      <div class="search-result-info">
        <div class="search-result-name">${escapeHtml(u.displayName)}</div>
        <div class="search-result-sub">@${escapeHtml(u.username)}</div>
      </div>
    `;
    applyPfpToEl(row.querySelector('.search-result-pfp'), u.avatar, u.displayName);
    const btn = document.createElement('button');
    btn.className = 'btn-ghost small';
    btn.textContent = 'Unblock';
    btn.addEventListener('click', () => unblockUser(u.username));
    row.appendChild(btn);
    listEl.appendChild(row);
  });
}

async function saveNotificationsPage() {
  const desktop = document.getElementById('notifDesktop').checked;
  if (desktop && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  try {
    await persistUser({
      notifications: {
        desktop,
        mentions: document.getElementById('notifMentions').checked,
        sounds: document.getElementById('notifSounds').checked,
        friendRequestAlerts: document.getElementById('notifFriendRequestAlerts').checked,
      },
    });
  } catch (err) {
    alert(err.message);
  }
}

async function saveAppearancePage() {
  try {
    await persistUser({
      appearance: {
        ...( state.me.appearance || {} ),
        theme: getSegmentedValue('appearanceThemeSegmented'),
        fontSize: getSegmentedValue('appearanceFontSegmented'),
        compactMode: document.getElementById('appearanceCompact').checked,
        animations: document.getElementById('appearanceAnimations').checked,
      },
    });
  } catch (err) {
    alert(err.message);
  }
}

async function saveChatPage() {
  try {
    await persistUser({
      appearance: {
        ...( state.me.appearance || {} ),
        enterToSend: document.getElementById('chatEnterToSend').checked,
        timestamp24h: document.getElementById('chatTimestamp24h').checked,
      },
    });
  } catch (err) {
    alert(err.message);
  }
}

async function saveAccessibilityPage() {
  try {
    await persistUser({
      appearance: {
        ...( state.me.appearance || {} ),
        reduceMotion: document.getElementById('a11yReduceMotion').checked,
        highContrast: document.getElementById('a11yHighContrast').checked,
      },
    });
  } catch (err) {
    alert(err.message);
  }
}

function clearLocalCache() {
  if (!confirm('Clear locally cached messages? They will reload from the server next time you open each conversation.')) return;
  state.conversations = {};
  if (state.activeChatWith) openChat(state.activeChatWith);
  alert('Local cache cleared.');
}

// ---------------- Appearance side-effects (theme/font/compact/animations/reduce-motion/contrast) ----------------
function applyAppearanceSettings() {
  const a = (state.me && state.me.appearance) || {};
  document.body.dataset.theme = a.theme || 'dark';
  document.body.dataset.fontSize = a.fontSize || 'medium';
  document.body.classList.toggle('compact-mode', !!a.compactMode);
  document.body.classList.toggle('no-animations', a.animations === false || !!a.reduceMotion);
  document.body.classList.toggle('high-contrast', !!a.highContrast);
}

// ---------------- Voice & Video device + test utilities ----------------
async function populateDeviceLists() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputSel = document.getElementById('voiceInputDevice');
    const outputSel = document.getElementById('voiceOutputDevice');
    inputSel.innerHTML = '';
    outputSel.innerHTML = '';

    const mics = devices.filter(d => d.kind === 'audioinput');
    const speakers = devices.filter(d => d.kind === 'audiooutput');

    if (mics.length === 0) inputSel.innerHTML = '<option>Default microphone</option>';
    mics.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone ${i + 1}`;
      inputSel.appendChild(opt);
    });

    if (speakers.length === 0) outputSel.innerHTML = '<option>Default speaker</option>';
    speakers.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Speaker ${i + 1}`;
      outputSel.appendChild(opt);
    });
  } catch (e) { /* device enumeration may be blocked before mic permission is granted */ }
}

let micTestStream = null;
let micTestRafId = null;
async function toggleMicTest() {
  const btn = document.getElementById('voiceMicTestBtn');
  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
    cancelAnimationFrame(micTestRafId);
    document.getElementById('voiceMicLevel').style.width = '0%';
    btn.textContent = 'Start Test';
    return;
  }
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    btn.textContent = 'Stop Test';
    populateDeviceLists();

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(micTestStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      document.getElementById('voiceMicLevel').style.width = Math.min(100, (avg / 128) * 100) + '%';
      micTestRafId = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {
    alert('Could not access your microphone.');
  }
}

let cameraPreviewStream = null;
async function toggleCameraPreview() {
  const btn = document.getElementById('voiceCameraPreviewBtn');
  const video = document.getElementById('voiceCameraPreview');
  if (cameraPreviewStream) {
    cameraPreviewStream.getTracks().forEach(t => t.stop());
    cameraPreviewStream = null;
    video.srcObject = null;
    btn.textContent = 'Start Preview';
    return;
  }
  try {
    cameraPreviewStream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = cameraPreviewStream;
    btn.textContent = 'Stop Preview';
    populateDeviceLists();
  } catch (e) {
    alert('Could not access your camera.');
  }
}
