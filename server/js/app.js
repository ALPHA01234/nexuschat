/* ============================================================
   app.js — bootstraps the app: builds pfp swatches, wires every
   screen/module, and restores a session (via JWT) on load.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  installUiIntegrityGuard();

  buildSwatches('pfpSwatches');
  buildSwatches('settingsPfpSwatches');

  wireAuthScreen();
  wireGlobalModals();
  wireChatUI();
  wireFriendsUI();
  wireSettingsUI();
  wireCalling();
  wireProfilePopout();

  document.getElementById('logoutBtn').addEventListener('click', logout);

  await restoreSession();
});


// Keep critical modal DOM available. Some browser/runtime combinations can
// unexpectedly detach large modal trees after initial parsing. We snapshot
// them as soon as DOMContentLoaded fires and restore them if that happens.
function installUiIntegrityGuard() {
  const criticalIds = ['addFriendModal', 'friendRequestsModal', 'settingsModal', 'profileModal'];
  const snapshots = new Map();

  criticalIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) snapshots.set(id, el.cloneNode(true));
    else console.error(`[UI integrity] Missing at startup: #${id}`);
  });

  console.info('[UI integrity] startup', {
    addFriendInput: !!document.getElementById('addFriendInput'),
    accountUsername: !!document.getElementById('accountUsername'),
    settingsModal: !!document.getElementById('settingsModal'),
    profileModal: !!document.getElementById('profileModal'),
  });

  const restoreMissing = () => {
    let restored = false;
    snapshots.forEach((snapshot, id) => {
      if (!document.getElementById(id)) {
        const clone = snapshot.cloneNode(true);
        document.body.appendChild(clone);
        console.warn(`[UI integrity] Restored detached #${id}`);
        restored = true;
      }
    });
    if (restored) {
      // Re-wire handlers on the freshly restored nodes.
      wireGlobalModals();
      wireFriendsUI();
      wireSettingsUI();
      wireProfilePopout();
    }
  };

  const observer = new MutationObserver(() => {
    if (
      !document.getElementById('addFriendModal') ||
      !document.getElementById('settingsModal') ||
      !document.getElementById('profileModal')
    ) {
      restoreMissing();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Generic modal close behavior (X buttons + click-outside), shared by
// every modal in the app.
function wireGlobalModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}
