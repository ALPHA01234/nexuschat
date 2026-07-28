/* ============================================================
   utils.js — shared helpers used across all modules.
   No localStorage here except reading/writing the JWT + username,
   which is handled in api.js.
   ============================================================ */

const PFP_COLORS = ['#ff1f3d', '#c41230', '#7a1b9e', '#1b66c2', '#1b9e6b', '#d68a1b', '#5a5a66', '#9e1b6a'];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function formatDuration(sec) {
  const s = Math.round(sec);
  return `0:${String(s).padStart(2, '0')}`;
}

function previewText(msg) {
  if (msg.deleted) return 'Message deleted';
  if (msg.type === 'voice') return '🎤 Voice note';
  if (msg.type === 'attachment') return `📎 ${msg.attachment?.filename || 'Attachment'}`;
  return escapeHtml(msg.content).slice(0, 40);
}

// Renders a pfp object ({type:'color'|'image', value}) into an element,
// falling back to the first letter of the display name.
function applyPfpToEl(el, pfp, displayName) {
  if (!el) return;
  if (!pfp || !pfp.value) {
    el.innerHTML = '';
    el.textContent = (displayName || '?')[0].toUpperCase();
    el.style.background = PFP_COLORS[0];
    return;
  }
  if (pfp.type === 'image') {
    el.innerHTML = `<img src="${pfp.value}" alt="">`;
    el.style.background = 'var(--raised)';
  } else {
    el.innerHTML = '';
    el.textContent = (displayName || '?')[0].toUpperCase();
    el.style.background = pfp.value;
  }
}

function buildSwatches(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
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

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function playIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
}
function pauseIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
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

// Debounce helper used by the friend-search box.
function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
