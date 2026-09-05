/* ============================================================
   app.js — bootstraps the app: builds pfp swatches, wires every
   screen/module, and restores a session (via JWT) on load.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  buildSwatches('pfpSwatches');
  buildSwatches('settingsPfpSwatches');

  wireAuthScreen();
  wireGlobalModals();
  wireChatUI();
  wireFriendsUI();
  wireSettingsUI();
  wireCalling();
  wireProfilePopout();
  wireCommunitiesUI();
  wireRewardsUI();
  wireProfessionalUX();

  document.getElementById('logoutBtn').addEventListener('click', logout);

  await restoreSession();
});

// Generic modal close behavior (X buttons + click-outside), shared by
// every modal in the app.
function wireGlobalModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Escape closes the top-most open modal/overlay (the Settings close
  // button visually hints "ESC", so this needs to actually work).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal-overlay.active');
    if (!open.length) return;
    closeModal(open[open.length - 1].id);
  });
}
