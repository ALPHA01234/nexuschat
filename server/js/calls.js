/* ============================================================
   calls.js — Discord-style calling: voice, video, screen share,
   mute/deafen, missed/declined/cancelled tracking, connection
   quality indicator, automatic reconnect. Signaling rides the
   same authenticated Socket.IO connection used for chat — no
   manual signaling URL, TURN creds come from /api/ice-config.
   ============================================================ */

let peerConnection = null;
let localStream = null;
let screenStream = null;
let callPartner = null;
let currentCallId = null;
let currentCallType = 'voice';
let callTimerInterval = null;
let qualityInterval = null;
let callSeconds = 0;
let isMuted = false;
let isDeafened = false;
let isScreenSharing = false;
let pendingIncoming = null; // { callId, from, offer, callType }

function wireCalling() {
  document.getElementById('voiceCallBtn').addEventListener('click', () => initiateCall('voice'));
  document.getElementById('videoCallBtn').addEventListener('click', () => initiateCall('video'));
  document.getElementById('acceptCallBtn').addEventListener('click', acceptIncomingCall);
  document.getElementById('declineCallBtn').addEventListener('click', declineIncomingCall);
  document.getElementById('endCallBtn').addEventListener('click', endCall);
  document.getElementById('muteBtn').addEventListener('click', toggleMute);
  document.getElementById('deafenBtn').addEventListener('click', toggleDeafen);
  document.getElementById('cameraToggleBtn').addEventListener('click', toggleCamera);
  document.getElementById('screenShareBtn').addEventListener('click', toggleScreenShare);
}

function requireSocketConnected() {
  if (!state.socket || !state.socket.connected) {
    alert('Not connected to the server yet. Please wait a moment and try again.');
    return false;
  }
  return true;
}

function rtcConfig() {
  return { iceServers: state.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] };
}

function buildPeerConnection() {
  const pc = new RTCPeerConnection(rtcConfig());
  pc.onicecandidate = (e) => {
    if (e.candidate) state.socket.emit('call:ice', { callId: currentCallId, candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    if (currentCallType === 'video') {
      document.getElementById('remoteVideo').srcObject = e.streams[0];
    }
    document.getElementById('remoteAudio').srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') startQualityMonitor(pc);
    if (['failed', 'closed'].includes(pc.connectionState)) stopQualityMonitor();
  };
  return pc;
}

// ---------------- Outgoing call ----------------
async function initiateCall(callType) {
  if (!state.activeChatWith) return;
  if (!requireSocketConnected()) return;

  callPartner = state.activeChatWith;
  currentCallType = callType;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: callType === 'video' });
  } catch (e) {
    alert(callType === 'video' ? 'Camera and microphone access is required to make a video call.' : 'Microphone access is required to make a call.');
    return;
  }

  peerConnection = buildPeerConnection();
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  if (callType === 'video') {
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callVideoStage').style.display = 'block';
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  state.socket.emit('call:offer', { to: callPartner, offer, callType });
  showCallHud(callPartner, 'CALLING', callType);
}

function micConstraints() {
  return {
    noiseSuppression: document.getElementById('voiceNoiseSuppression')?.checked !== false,
    echoCancellation: document.getElementById('voiceEchoCancellation')?.checked !== false,
  };
}

// ---------------- Incoming call ----------------
function onCallIncoming(data) {
  pendingIncoming = data;
  const fdata = findFriend(data.from);
  document.getElementById('incomingCallName').textContent = (fdata && fdata.displayName) || data.from;
  document.getElementById('incomingCallType').textContent = data.callType === 'video' ? 'Incoming video call...' : 'Incoming voice call...';
  applyPfpToEl(document.getElementById('incomingCallPfp'), fdata ? fdata.avatar : null, fdata ? fdata.displayName : data.from);
  openModal('incomingCallModal');

  if (state.me?.notifications?.desktop !== false) {
    notifyUser('Incoming Call', `${(fdata && fdata.displayName) || data.from} is calling you.`, null);
  }
}

async function acceptIncomingCall() {
  closeModal('incomingCallModal');
  if (!pendingIncoming) return;

  const { callId, from, offer, callType } = pendingIncoming;
  callPartner = from;
  currentCallId = callId;
  currentCallType = callType;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: callType === 'video' });
  } catch (e) {
    alert('Microphone access is required to accept a call.');
    state.socket.emit('call:decline', { callId });
    pendingIncoming = null;
    return;
  }

  peerConnection = buildPeerConnection();
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  if (callType === 'video') {
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callVideoStage').style.display = 'block';
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  state.socket.emit('call:answer', { callId, answer });

  showCallHud(callPartner, 'CONNECTED', callType);
  startCallTimer();
  pendingIncoming = null;
}

function declineIncomingCall() {
  closeModal('incomingCallModal');
  if (pendingIncoming) state.socket.emit('call:decline', { callId: pendingIncoming.callId });
  pendingIncoming = null;
}

// ---------------- Ending ----------------
function endCall() {
  if (currentCallId && state.socket && state.socket.connected) {
    state.socket.emit('call:end', { callId: currentCallId });
  }
  endCallCleanup();
}

function endCallCleanup() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  document.getElementById('remoteAudio').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('callVideoStage').style.display = 'none';

  clearInterval(callTimerInterval);
  stopQualityMonitor();
  callSeconds = 0;
  isMuted = false;
  isDeafened = false;
  isScreenSharing = false;
  callPartner = null;
  currentCallId = null;
  pendingIncoming = null;

  document.getElementById('callHud').classList.remove('active');
  document.getElementById('muteBtn').classList.remove('muted');
  document.getElementById('deafenBtn').classList.remove('muted');
  document.getElementById('screenShareBtn').classList.remove('muted');
}

function showCallHud(withUsername, status, callType) {
  const fdata = findFriend(withUsername);
  document.getElementById('callHudName').textContent = (fdata && fdata.displayName) || withUsername;
  applyPfpToEl(document.getElementById('callHudPfp'), fdata ? fdata.avatar : null, fdata ? fdata.displayName : withUsername);
  document.getElementById('callHudPfp').style.display = callType === 'video' ? 'none' : 'flex';
  setCallStatus(status);
  document.getElementById('callHudTimer').textContent = '00:00';
  document.getElementById('callHud').classList.add('active');
}

function setCallStatus(status) { document.getElementById('callHudStatus').textContent = status; }

function startCallTimer() {
  callSeconds = 0;
  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    callSeconds++;
    const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
    const s = String(callSeconds % 60).padStart(2, '0');
    document.getElementById('callHudTimer').textContent = `${m}:${s}`;
  }, 1000);
}

// ---------------- Mute / Deafen / Camera / Screen share ----------------
function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  document.getElementById('muteBtn').classList.toggle('muted', isMuted);
  if (currentCallId) state.socket.emit('call:mute', { callId: currentCallId, muted: isMuted });
}

function toggleDeafen() {
  isDeafened = !isDeafened;
  document.getElementById('remoteAudio').muted = isDeafened;
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.muted = isDeafened;
  document.getElementById('deafenBtn').classList.toggle('muted', isDeafened);
  // Deafening also implies muting yourself, matching Discord's behavior.
  if (isDeafened && !isMuted) toggleMute();
}

async function toggleCamera() {
  if (!localStream) return;
  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length === 0 && currentCallType !== 'video') {
    // Upgrading a voice call to video on the fly.
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = camStream.getVideoTracks()[0];
      localStream.addTrack(track);
      peerConnection.addTrack(track, localStream);
      document.getElementById('localVideo').srcObject = localStream;
      document.getElementById('callVideoStage').style.display = 'block';
      currentCallType = 'video';
    } catch (e) { alert('Could not access your camera.'); return; }
  } else {
    videoTracks.forEach(t => t.enabled = !t.enabled);
    const enabled = videoTracks[0]?.enabled;
    document.getElementById('cameraToggleBtn').classList.toggle('muted', !enabled);
  }
  if (currentCallId) {
    const enabled = localStream.getVideoTracks()[0]?.enabled !== false;
    state.socket.emit('call:video-toggle', { callId: currentCallId, enabled });
  }
}

async function toggleScreenShare() {
  if (!peerConnection) return;
  if (isScreenSharing) {
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    isScreenSharing = false;
    document.getElementById('screenShareBtn').classList.remove('muted');
    // Revert to camera (or blank) track.
    const camTrack = localStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && camTrack) sender.replaceTrack(camTrack);
    if (currentCallId) state.socket.emit('call:screen-share', { callId: currentCallId, active: false });
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(screenTrack);
    else peerConnection.addTrack(screenTrack, screenStream);

    document.getElementById('callVideoStage').style.display = 'block';
    document.getElementById('localVideo').srcObject = screenStream;
    isScreenSharing = true;
    document.getElementById('screenShareBtn').classList.add('muted');

    screenTrack.addEventListener('ended', () => { if (isScreenSharing) toggleScreenShare(); });
    if (currentCallId) state.socket.emit('call:screen-share', { callId: currentCallId, active: true });
  } catch (e) {
    // user cancelled the picker — not an error worth surfacing
  }
}

// ---------------- Connection quality (via getStats) ----------------
function startQualityMonitor(pc) {
  stopQualityMonitor();
  qualityInterval = setInterval(async () => {
    try {
      const stats = await pc.getStats();
      let packetsLost = 0, packetsReceived = 0, rtt = 0;
      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && !r.isRemote) { packetsLost += r.packetsLost || 0; packetsReceived += r.packetsReceived || 0; }
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime) rtt = r.currentRoundTripTime;
      });
      const lossRatio = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
      updateQualityIndicator(lossRatio, rtt);
    } catch (e) { /* non-critical */ }
  }, 3000);
}

function stopQualityMonitor() {
  clearInterval(qualityInterval);
  qualityInterval = null;
}

function updateQualityIndicator(lossRatio, rtt) {
  const label = document.getElementById('callHudQualityLabel');
  const dots = document.querySelectorAll('#callHudQuality .quality-dot');
  let level = 3, text = 'Good';
  if (lossRatio > 0.08 || rtt > 0.4) { level = 1; text = 'Poor'; }
  else if (lossRatio > 0.03 || rtt > 0.2) { level = 2; text = 'Fair'; }
  dots.forEach((d, i) => d.style.background = i < level ? (level === 1 ? 'var(--red)' : level === 2 ? '#e6b422' : 'var(--green)') : 'var(--border)');
  label.textContent = text;
}

// ---------------- Signaling events (dispatched from socket.js) ----------------
function onCallAnswer(msg) {
  currentCallId = msg.callId;
  if (peerConnection) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    setCallStatus('CONNECTED');
    startCallTimer();
  }
}

function onCallIce(msg) {
  if (peerConnection && msg.candidate) {
    peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
  }
}

function onCallDeclined(msg) {
  alert(`${(findFriend(callPartner)?.displayName) || 'They'} declined the call.`);
  endCallCleanup();
}

function onCallCancelled() { endCallCleanup(); closeModal('incomingCallModal'); }
function onCallEnded() { endCallCleanup(); }
function onCallTimeout() { endCallCleanup(); closeModal('incomingCallModal'); }

function onCallError(msg) {
  if (msg.reason === 'offline') alert(`${msg.to} is not connected right now.`);
  else if (msg.reason === 'busy-self') alert('You are already on a call.');
  else if (msg.reason === 'not-found') alert('User not found.');
  else alert('Could not start the call.');
  endCallCleanup();
}

function onPeerMute() { /* HUD name already visible; nothing further to render for voice-only UI */ }
function onPeerVideoToggle() { /* remote video track auto-updates via ontrack/replaceTrack on their end */ }
function onPeerScreenShare(data) {
  if (data.active) setCallStatus('SCREEN SHARING');
  else setCallStatus('CONNECTED');
}
