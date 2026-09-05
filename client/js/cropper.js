/* Lightweight in-browser cropper for avatar and banner images. No third-party CDN. */
let cropSession = null;

function openImageCropper(file, mode, onDone, options = {}) {
  if (!file) return;
  const isGif = file.type === 'image/gif';
  if (isGif) {
    if (!options.allowGif) {
      alert('Animated GIF profile media is a NexusChat Premium feature.');
      return;
    }
    // Canvas would flatten an animated GIF, so Premium GIFs keep their animation.
    const reader = new FileReader();
    reader.onload = e => onDone(e.target.result, { animated: true });
    reader.readAsDataURL(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('cropImage');
    const viewport = document.getElementById('cropViewport');
    const zoom = document.getElementById('cropZoom');
    const x = document.getElementById('cropX');
    const y = document.getElementById('cropY');

    cropSession = { mode, onDone, dataUrl: e.target.result };
    viewport.classList.toggle('avatar-mode', mode === 'avatar');
    viewport.classList.toggle('banner-mode', mode === 'banner');
    document.getElementById('cropModalTitle').textContent = mode === 'banner' ? 'Adjust banner' : 'Adjust profile picture';
    document.getElementById('cropHint').textContent = 'Use zoom and position controls. The saved image is cropped locally in your browser.';
    zoom.value = '1'; x.value = '0'; y.value = '0';
    img.onload = updateCropPreview;
    img.src = e.target.result;
    openModal('cropModal');
  };
  reader.readAsDataURL(file);
}

function cropGeometry(outW, outH) {
  const img = document.getElementById('cropImage');
  const zoom = Number(document.getElementById('cropZoom').value || 1);
  const px = Number(document.getElementById('cropX').value || 0);
  const py = Number(document.getElementById('cropY').value || 0);
  const baseScale = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
  const scale = baseScale * zoom;
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const overflowX = Math.max(0, drawW - outW);
  const overflowY = Math.max(0, drawH - outH);
  const dx = -overflowX * ((px + 1) / 2);
  const dy = -overflowY * ((py + 1) / 2);
  return { drawW, drawH, dx, dy };
}

function updateCropPreview() {
  if (!cropSession) return;
  const viewport = document.getElementById('cropViewport');
  const img = document.getElementById('cropImage');
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height || !img.naturalWidth) return;
  const g = cropGeometry(rect.width, rect.height);
  img.style.width = `${g.drawW}px`;
  img.style.height = `${g.drawH}px`;
  img.style.left = `${g.dx}px`;
  img.style.top = `${g.dy}px`;
}

function applyCrop() {
  if (!cropSession) return;
  const outW = cropSession.mode === 'banner' ? 1200 : 512;
  const outH = cropSession.mode === 'banner' ? 400 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  const g = cropGeometry(outW, outH);
  ctx.drawImage(document.getElementById('cropImage'), g.dx, g.dy, g.drawW, g.drawH);
  const dataUrl = canvas.toDataURL('image/webp', 0.9);
  const done = cropSession.onDone;
  cropSession = null;
  closeModal('cropModal');
  done(dataUrl, { animated: false });
}

document.addEventListener('DOMContentLoaded', () => {
  ['cropZoom', 'cropX', 'cropY'].forEach(id => document.getElementById(id)?.addEventListener('input', updateCropPreview));
  document.getElementById('cropApplyBtn')?.addEventListener('click', applyCrop);
  window.addEventListener('resize', updateCropPreview);
});
