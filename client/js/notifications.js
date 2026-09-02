/* ============================================================
   notifications.js — desktop notifications + message sounds,
   respecting the user's saved notification preferences.
   ============================================================ */

// Short beep synthesized with the Web Audio API — no external asset needed.
function playMessageSound() {
  if (!state.me || state.me.notifications?.sounds === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 720;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (e) { /* audio may be blocked before user interaction; non-critical */ }
}

// settingKey: which state.me.notifications flag gates this alert
// ('desktop' is checked separately/always in addition to the specific key).
function notifyUser(title, body, settingKey) {
  if (!state.me || !state.me.notifications) return;
  if (settingKey && state.me.notifications[settingKey] === false) return;
  if (state.me.notifications.desktop === false) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // don't nag while the tab is already active

  try {
    new Notification(title, { body, silent: true });
  } catch (e) { /* ignore */ }
}
