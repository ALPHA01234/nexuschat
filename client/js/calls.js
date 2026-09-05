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
let pendingIceCandidates = []; // our own candidates gathered before we have a callId to send them with
let remoteIceQueue = []; // candidates received from the peer before our remoteDescription is set
let remoteMediaStream = null;
let speakingMonitors = [];

async function flushRemoteIceQueue() {
  if (!peerConnection || !peerConnection.remoteDescription) return;
  for (const candidate of remoteIceQueue.splice(0)) {
    try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (err) { console.warn('Could not add queued ICE candidate', err); }
  }
}

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
  return { iceServers: (state.iceServers && state.iceServers.length ? state.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]) };
}

function buildPeerConnection() {
  const pc = new RTCPeerConnection(rtcConfig());
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    if (currentCallId) {
      state.socket.emit('call:ice', { callId: currentCallId, candidate: e.candidate });
    } else {
      pendingIceCandidates.push(e.candidate);
    }
  };
  pc.ontrack = async (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === 'audio') {
      const remoteAudio = document.getElementById('remoteAudio');
      remoteAudio.srcObject = stream;
      remoteAudio.muted = isDeafened;
      remoteAudio.volume = 1;
      await routeAudioOutput(remoteAudio);
      playMediaWithUnlockFallback(remoteAudio);
      remoteMediaStream = stream;
      startSpeakingMonitor(stream, document.getElementById('callHudPfp'));
    }
    if (e.track.kind === 'video') {
      const remoteVideo = document.getElementById('remoteVideo');
      remoteVideo.srcObject = stream;
      remoteVideo.muted = isDeafened;
      if (currentCallType === 'video') { document.getElementById('callVideoStage').style.display = 'block'; document.getElementById('callVoiceParticipants').style.display='none'; }
      playMediaWithUnlockFallback(remoteVideo);
    }
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
  // Generate the signaling id on the caller before ICE gathering starts.
  // Previously the server created the id later, so the caller's ICE
  // candidates were emitted with callId=null and silently discarded.
  currentCallId = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  pendingIceCandidates = [];

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(), video: callType === 'video' });
  } catch (e) {
    alert(callType === 'video' ? 'Camera and microphone access is required to make a video call.' : 'Microphone access is required to make a call.');
    return;
  }

  peerConnection = buildPeerConnection();
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  // Pre-negotiate one video m-line on voice calls so screen sharing can start later without a second SDP exchange.
  if (callType === 'voice') peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  startSpeakingMonitor(localStream, document.getElementById('localCallPfp'));
  if (callType === 'video') {
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callVideoStage').style.display = 'block';
  }

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  state.socket.emit('call:offer', { callId: currentCallId, to: callPartner, offer, callType });
  showCallHud(callPartner, 'CALLING', callType);
}

function micConstraints() {
  const deviceId = localStorage.getItem('nexus_audio_input') || '';
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
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
  // Pre-negotiate one video m-line on voice calls so screen sharing can start later without a second SDP exchange.
  if (callType === 'voice') peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  startSpeakingMonitor(localStream, document.getElementById('localCallPfp'));
  if (callType === 'video') {
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callVideoStage').style.display = 'block';
  }

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  await flushRemoteIceQueue();
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
  pendingIceCandidates = []; remoteIceQueue = []; remoteMediaStream=null; stopSpeakingMonitors();
  forgetBlockedMedia(document.getElementById('remoteAudio'));
  forgetBlockedMedia(document.getElementById('remoteVideo'));

  document.getElementById('callHud').classList.remove('active','screen-sharing');
  document.getElementById('callVoiceParticipants').style.display='flex';
  document.getElementById('muteBtn').classList.remove('muted');
  document.getElementById('deafenBtn').classList.remove('muted');
  document.getElementById('screenShareBtn').classList.remove('muted');
}

function showCallHud(withUsername, status, callType) {
  const fdata = findFriend(withUsername);
  document.getElementById('callHudName').textContent = (fdata && fdata.displayName) || withUsername;
  applyPfpToEl(document.getElementById('callHudPfp'), fdata ? fdata.avatar : null, fdata ? fdata.displayName : withUsername);
  applyPfpToEl(document.getElementById('localCallPfp'), state.me?.avatar, state.me?.displayName || state.me?.username);
  const rl=document.getElementById('callRemoteLabel'); if(rl) rl.textContent=(fdata&&fdata.displayName)||withUsername;
  document.getElementById('callVoiceParticipants').style.display = callType === 'video' ? 'none' : 'flex';
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
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video') || peerConnection.getTransceivers().find(t => t.receiver?.track?.kind === 'video')?.sender;
    if (sender && camTrack) sender.replaceTrack(camTrack);
    document.getElementById('callHud').classList.remove('screen-sharing');
    if (currentCallId) state.socket.emit('call:screen-share', { callId: currentCallId, active: false });
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video') || peerConnection.getTransceivers().find(t => t.receiver?.track?.kind === 'video')?.sender;
    if (sender) await sender.replaceTrack(screenTrack);
    else { alert('Screen sharing needs the call to reconnect once. End the call and start it again with this updated build.'); return; }

    document.getElementById('callVideoStage').style.display = 'block';
    document.getElementById('localVideo').srcObject = screenStream;
    isScreenSharing = true;
    document.getElementById('screenShareBtn').classList.add('muted');
    document.getElementById('callHud').classList.add('screen-sharing');

    screenTrack.addEventListener('ended', () => { if (isScreenSharing) toggleScreenShare(); });
    if (currentCallId) state.socket.emit('call:screen-share', { callId: currentCallId, active: true });
  } catch (e) {
    // user cancelled the picker — not an error worth surfacing
  }
}


function startSpeakingMonitor(stream, targetEl) {
  if (!stream || !targetEl || !stream.getAudioTracks().length) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = ctx.createAnalyser(); analyser.fftSize=256; analyser.smoothingTimeConstant=.72; src.connect(analyser);
    const data=new Uint8Array(analyser.frequencyBinCount); let raf=0, active=true, lastAbove=0;
    // Debounce: keep the speaking ring on for a short hold window after the
    // last frame that crossed the threshold, instead of toggling on raw
    // per-frame RMS — that produced the flickery/weak-looking indicator.
    const HOLD_MS = 250;
    const tick=()=>{
      if(!active)return;
      analyser.getByteTimeDomainData(data);
      let sum=0; for(const v of data){const n=(v-128)/128; sum+=n*n;}
      const rms=Math.sqrt(sum/data.length);
      const now = performance.now();
      if (rms > 0.035) lastAbove = now;
      targetEl.classList.toggle('speaking', (now - lastAbove) < HOLD_MS);
      raf=requestAnimationFrame(tick);
    }; tick();
    speakingMonitors.push(()=>{active=false;cancelAnimationFrame(raf);targetEl.classList.remove('speaking');try{ctx.close()}catch(e){}});
  } catch(e) { console.warn('Speaking detector unavailable',e); }
}
function stopSpeakingMonitors(){ speakingMonitors.splice(0).forEach(fn=>{try{fn()}catch(e){}}); }

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
async function onCallAnswer(msg) {
  currentCallId = msg.callId || currentCallId;
  if (peerConnection) {
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
      await flushRemoteIceQueue();
      for (const candidate of pendingIceCandidates.splice(0)) {
        state.socket.emit('call:ice', { callId: currentCallId, candidate });
      }
      setCallStatus('CONNECTED');
      startCallTimer();
    } catch (err) {
      console.error('Failed to apply call answer', err);
      setCallStatus('CONNECTION ERROR');
    }
  }
}

async function onCallIce(msg) {
  if (!peerConnection || !msg.candidate) return;
  // Queue candidates that arrive before our remoteDescription is set
  // (e.g. the callee's ICE can beat the offer/answer round trip) instead
  // of guessing with a fixed delay — flushRemoteIceQueue() drains this
  // right after setRemoteDescription() succeeds, on both call legs.
  if (!peerConnection.remoteDescription) {
    remoteIceQueue.push(msg.candidate);
    return;
  }
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
  } catch (err) {
    console.warn('Could not add ICE candidate', err);
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
  document.getElementById('callHud')?.classList.toggle('screen-sharing', !!data.active);
  if (data.active) { setCallStatus('SCREEN SHARING'); document.getElementById('callVideoStage').style.display='block'; document.getElementById('callVoiceParticipants').style.display='none'; }
  else { setCallStatus('CONNECTED'); if(currentCallType==='voice'){ document.getElementById('callVideoStage').style.display='none'; document.getElementById('callVoiceParticipants').style.display='flex'; } }
}
