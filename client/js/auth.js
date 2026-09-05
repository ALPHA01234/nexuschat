/* ============================================================
   auth.js — register / verify email / login / forgot password /
   session restore / logout. Only the JWT + username ever touch
   localStorage; everything else always comes from the API.
   ============================================================ */

const AUTH_FORMS = ['loginForm', 'registerForm', 'verifyForm', 'forgotStep1Form', 'forgotStep2Form', 'forgotStep3Form'];
let pendingResetToken = null; // set once forgot-password OTP is verified

function showAuthForm(id) {
  AUTH_FORMS.forEach(f => document.getElementById(f).classList.toggle('active', f === id));
  document.querySelector('.auth-tabs').style.display = (id === 'loginForm' || id === 'registerForm') ? 'flex' : 'none';
  document.getElementById('authFootnote').style.display = (id === 'loginForm' || id === 'registerForm') ? 'block' : 'none';
}

function wireAuthScreen() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showAuthForm(tab.dataset.tab + 'Form');
    });
  });

  document.getElementById('pfpUploadBtn').addEventListener('click', () => document.getElementById('pfpUpload').click());
  document.getElementById('pfpUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { alert('Please choose a profile image smaller than 1.5MB.'); e.target.value=''; return; }
    openImageCropper(file, 'avatar', (dataUrl) => {
      const preview = document.getElementById('pfpPreview');
      preview.innerHTML = `<img src="${dataUrl}" alt="">`;
      preview.dataset.image = dataUrl;
      delete preview.dataset.color;
    }, { allowGif: false });
  });

  document.getElementById('registerForm').addEventListener('submit', (e) => { e.preventDefault(); handleRegister(); });
  document.getElementById('loginForm').addEventListener('submit', (e) => { e.preventDefault(); handleLogin(); });
  document.getElementById('verifyForm').addEventListener('submit', (e) => { e.preventDefault(); handleVerifyEmail(); });
  document.getElementById('forgotStep1Form').addEventListener('submit', (e) => { e.preventDefault(); handleForgotStep1(); });
  document.getElementById('forgotStep2Form').addEventListener('submit', (e) => { e.preventDefault(); handleForgotStep2(); });
  document.getElementById('forgotStep3Form').addEventListener('submit', (e) => { e.preventDefault(); handleForgotStep3(); });

  document.getElementById('resendVerifyBtn').addEventListener('click', handleResendVerification);
  document.getElementById('backToLoginFromVerify').addEventListener('click', () => showAuthForm('loginForm'));
  document.getElementById('forgotPasswordLink').addEventListener('click', () => {
    document.getElementById('forgotStep1Error').textContent = '';
    showAuthForm('forgotStep1Form');
  });
  document.getElementById('backToLoginFromForgot1').addEventListener('click', () => showAuthForm('loginForm'));
  document.getElementById('resendForgotBtn').addEventListener('click', handleForgotStep1Resend);

  document.getElementById('pfpPreview').style.background = PFP_COLORS[0];
  document.getElementById('pfpPreview').dataset.color = PFP_COLORS[0];
}

function currentRegisterPfp() {
  const preview = document.getElementById('pfpPreview');
  if (preview.dataset.image) return { type: 'image', value: preview.dataset.image };
  return { type: 'color', value: preview.dataset.color || PFP_COLORS[0] };
}

let pendingVerifyEmail = null;

function goToVerifyScreen(email) {
  pendingVerifyEmail = email;
  document.getElementById('verifyEmailLabel').textContent = email;
  document.getElementById('verifyOtp').value = '';
  document.getElementById('verifyError').textContent = '';
  document.getElementById('verifyInfo').textContent = '';
  showAuthForm('verifyForm');
  setTimeout(() => document.getElementById('verifyOtp').focus(), 50);
}

async function handleRegister() {
  const username = document.getElementById('regUsername').value.trim().toLowerCase();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const displayName = document.getElementById('regDisplay').value.trim();
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  const acceptPolicies = document.getElementById('regPolicyConsent').checked;
  if (!acceptPolicies) { errEl.textContent = 'Please agree to the Terms, Privacy Policy, and Community Guidelines.'; return; }

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, displayName, avatar: currentRegisterPfp(), acceptPolicies }),
    });
    goToVerifyScreen(data.email || email);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleVerifyEmail() {
  const otp = document.getElementById('verifyOtp').value.trim();
  const errEl = document.getElementById('verifyError');
  errEl.textContent = '';

  try {
    const data = await apiFetch('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email: pendingVerifyEmail, otp }),
    });
    setSession(data.token, data.user.username);
    state.me = data.user;
    await enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleResendVerification() {
  const infoEl = document.getElementById('verifyInfo');
  const errEl = document.getElementById('verifyError');
  infoEl.textContent = '';
  errEl.textContent = '';
  try {
    await apiFetch('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: pendingVerifyEmail }) });
    infoEl.textContent = 'A new code has been sent.';
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleLogin() {
  const login = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
    setSession(data.token, data.user.username);
    state.me = data.user;
    await enterApp();
  } catch (err) {
    if (err.status === 403 && err.data && err.data.requiresVerification) {
      goToVerifyScreen(err.data.email || login);
      return;
    }
    errEl.textContent = err.message;
  }
}

// ---------------- Forgot password (3-step OTP flow) ----------------
let pendingResetEmail = null;

async function handleForgotStep1() {
  const email = document.getElementById('forgotEmail').value.trim().toLowerCase();
  const errEl = document.getElementById('forgotStep1Error');
  errEl.textContent = '';
  try {
    await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    pendingResetEmail = email;
    document.getElementById('forgotEmailLabel').textContent = email;
    document.getElementById('forgotOtp').value = '';
    document.getElementById('forgotStep2Error').textContent = '';
    showAuthForm('forgotStep2Form');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleForgotStep1Resend() {
  if (!pendingResetEmail) return;
  const errEl = document.getElementById('forgotStep2Error');
  try {
    await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: pendingResetEmail }) });
    errEl.textContent = '';
    errEl.classList.remove('form-error');
    errEl.classList.add('form-info');
    errEl.textContent = 'A new code has been sent.';
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleForgotStep2() {
  const otp = document.getElementById('forgotOtp').value.trim();
  const errEl = document.getElementById('forgotStep2Error');
  errEl.textContent = '';
  try {
    const data = await apiFetch('/auth/verify-reset-otp', {
      method: 'POST',
      body: JSON.stringify({ email: pendingResetEmail, otp }),
    });
    pendingResetToken = data.resetToken;
    document.getElementById('forgotNewPassword').value = '';
    document.getElementById('forgotConfirmPassword').value = '';
    document.getElementById('forgotStep3Error').textContent = '';
    showAuthForm('forgotStep3Form');
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function handleForgotStep3() {
  const newPassword = document.getElementById('forgotNewPassword').value;
  const confirm = document.getElementById('forgotConfirmPassword').value;
  const errEl = document.getElementById('forgotStep3Error');
  errEl.textContent = '';

  if (newPassword !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    return;
  }

  try {
    await apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken: pendingResetToken, newPassword }),
    });
    pendingResetToken = null;
    alert('Password updated! Please sign in.');
    document.getElementById('loginForm').reset();
    document.querySelector('.auth-tab[data-tab="login"]').click();
  } catch (err) {
    errEl.textContent = err.message;
  }
}

// ---------------- Session ----------------
async function restoreSession() {
  const token = getToken();
  if (!token) return false;

  state.token = token;
  try {
    const data = await apiFetch('/auth/me');
    state.me = data.user;
    await enterApp();
    return true;
  } catch (err) {
    clearSession();
    return false;
  }
}

async function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').classList.add('active');

  connectSocket();
  renderMyProfile();
  refreshCoinUI();
  applyAppearanceSettings();
  renderAccountNotice();
  await detectAdminAccess();

  await Promise.all([loadFriends(), loadFriendRequests(), loadBlockedUsers(), loadCommunities()]);

  renderDmList();
  showHomeView?.();
}


async function detectAdminAccess() {
  state.isAdmin = false;
  try {
    const d = await apiFetch('/admin/me');
    state.isAdmin = true;
    state.adminLevel = d.level || 'admin';
  } catch (e) { state.isAdmin = false; }
  const rail = document.getElementById('adminRailBtn'); if (rail) rail.style.display = state.isAdmin ? 'grid' : 'none';
  const badge = document.getElementById('adminMiniBadge'); if (badge) { badge.style.display = state.isAdmin ? 'inline-flex' : 'none'; badge.textContent=(state.adminLevel||'admin').toUpperCase(); }
  const link = document.getElementById('adminDashboardLink'); if (link) link.style.display = state.isAdmin ? 'inline-flex' : 'none';
}

function renderAccountNotice() {
  const el = document.getElementById('accountNotice');
  if (!el || !state.me) return;
  const pendingWarning = (state.me.warnings || []).find(w => !w.acknowledgedAt);
  if (state.me.accountStatus === 'restricted') {
    el.style.display = 'flex';
    el.innerHTML = `<span><strong>Account restricted:</strong> ${escapeHtml(state.me.restrictionReason || 'Some actions are temporarily unavailable.')}</span>`;
  } else if (pendingWarning) {
    el.style.display = 'flex';
    el.innerHTML = `<span><strong>Account warning:</strong> ${escapeHtml(pendingWarning.message)}</span><button id="ackWarningBtn" class="btn-ghost small">Acknowledge</button>`;
    document.getElementById('ackWarningBtn').addEventListener('click', async () => {
      try {
        const data = await apiFetch(`/users/me/warnings/${pendingWarning.id}/acknowledge`, { method: 'POST' });
        state.me = data.user;
        renderAccountNotice();
      } catch (err) { alert(err.message); }
    });
  } else {
    el.style.display = 'none';
    el.innerHTML = '';
  }
}

function logout() {
  disconnectSocket();
  clearSession();
  state.me = null;
  state.friends = [];
  state.requests = { incoming: [], outgoing: [] };
  state.blocked = [];
  state.presence = {};
  state.activeChatWith = null;
  state.conversations = {};

  document.getElementById('appScreen').classList.remove('active');
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
  document.getElementById('chatView').classList.remove('active');
  document.getElementById('emptyState').style.display = 'flex';
  showAuthForm('loginForm');
}
