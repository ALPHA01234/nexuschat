/* ============================================================
   calls.js — brand-new calling system (voice + video + screen
   share). Fully replaces the old raw-WebSocket signaling: every
   event here rides the same authenticated Socket.IO connection
   used for chat. Tracks call state server-side so both peers stay
   in sync (ringing / answered / ended) and writes call history.
   ============================================================ */

const User = require('../models/user');
const Call = require('../models/Call');
const { emitToUser, isUserOnline } = require('./presence');
const logger = require('../utils/logger');
const crypto = require('crypto');

const RING_TIMEOUT_MS = 45 * 1000;

// callId -> { callerId, calleeId, type, callDocId, answered, timer }
const activeCalls = new Map();

function newCallId() {
  return crypto.randomUUID();
}

async function endCall(callId, { status, endedBy } = {}) {
  const call = activeCalls.get(callId);
  if (!call) return;
  clearTimeout(call.timer);
  activeCalls.delete(callId);

  try {
    const doc = await Call.findById(call.callDocId);
    if (doc) {
      doc.endedAt = new Date();
      doc.durationSec = call.answeredAt ? Math.round((Date.now() - call.answeredAt) / 1000) : 0;
      doc.status = status || (call.answered ? 'completed' : 'missed');
      await doc.save();
    }
  } catch (err) {
    logger.error('Failed to finalize call record', err);
  }

  return call;
}

function registerCallHandlers(socket) {
  const userId = socket.userId;

  // ---------------- Offer (start a call) ----------------
  socket.on('call:offer', async ({ callId: requestedCallId, to, offer, callType }) => {
    try {
      const caller = await User.findById(userId).select('accountStatus restrictionReason');
      if (!caller || caller.accountStatus === 'restricted') {
        return socket.emit('call:error', { reason: 'restricted', message: caller?.restrictionReason || 'Your account is currently restricted from starting calls.', to });
      }
      const callee = await User.findOne({ username: String(to).trim().toLowerCase() }).select('_id username');
      if (!callee) return socket.emit('call:error', { reason: 'not-found', to });

      if (!isUserOnline(callee._id)) {
        await Call.create({ caller: userId, callee: callee._id, type: callType === 'video' ? 'video' : 'voice', status: 'missed', endedAt: new Date() });
        return socket.emit('call:error', { reason: 'offline', to });
      }

      // One call at a time per caller.
      for (const [id, c] of activeCalls) {
        if (c.callerId === userId || c.calleeId === userId) {
          return socket.emit('call:error', { reason: 'busy-self', to });
        }
      }

      const callDoc = await Call.create({ caller: userId, callee: callee._id, type: callType === 'video' ? 'video' : 'voice' });
      // The caller creates the id before ICE gathering so its first
      // candidates can be routed correctly. Keep a server fallback for
      // older clients.
      const candidateId = typeof requestedCallId === 'string' && requestedCallId.length <= 100
        ? requestedCallId
        : '';
      const callId = candidateId || newCallId();

      const timer = setTimeout(async () => {
        const call = activeCalls.get(callId);
        if (!call || call.answered) return;
        await endCall(callId, { status: 'missed' });
        emitToUser(call.callerId, 'call:timeout', { callId });
        emitToUser(call.calleeId, 'call:timeout', { callId });
      }, RING_TIMEOUT_MS);

      activeCalls.set(callId, {
        callId, callerId: userId, calleeId: callee._id.toString(),
        type: callType === 'video' ? 'video' : 'voice',
        callDocId: callDoc._id, answered: false, timer,
      });

      emitToUser(callee._id, 'call:incoming', {
        callId, from: socket.username, offer, callType: callType === 'video' ? 'video' : 'voice',
      });
    } catch (err) {
      logger.error('call:offer error', err);
      socket.emit('call:error', { reason: 'server-error', to });
    }
  });

  // ---------------- Answer ----------------
  socket.on('call:answer', async ({ callId, answer }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    call.answered = true;
    call.answeredAt = Date.now();
    clearTimeout(call.timer);

    try {
      await Call.findByIdAndUpdate(call.callDocId, { status: 'completed' });
    } catch (e) { /* finalized again on end with real duration */ }

    emitToUser(call.callerId, 'call:answer', { callId, answer, from: socket.username });
  });

  // ---------------- ICE candidates ----------------
  socket.on('call:ice', ({ callId, candidate }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    emitToUser(targetId, 'call:ice', { callId, candidate });
  });

  // ---------------- Decline (callee rejects before answering) ----------------
  socket.on('call:decline', async ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    await endCall(callId, { status: 'declined' });
    emitToUser(call.callerId, 'call:declined', { callId, from: socket.username });
  });

  // ---------------- Cancel (caller hangs up before answered) ----------------
  socket.on('call:cancel', async ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    await endCall(callId, { status: 'cancelled' });
    emitToUser(call.calleeId, 'call:cancelled', { callId });
  });

  // ---------------- End (either side, mid-call) ----------------
  socket.on('call:end', async ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    const otherId = call.callerId === userId ? call.calleeId : call.callerId;
    await endCall(callId, { status: call.answered ? 'completed' : 'cancelled' });
    emitToUser(otherId, 'call:ended', { callId });
  });

  // ---------------- Live status relays: mute / video / screen-share ----------------
  ['call:mute', 'call:video-toggle', 'call:screen-share'].forEach(evt => {
    socket.on(evt, ({ callId, ...rest }) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const otherId = call.callerId === userId ? call.calleeId : call.callerId;
      emitToUser(otherId, evt, { callId, ...rest });
    });
  });

  // ---------------- Disconnect mid-call ----------------
  socket.on('disconnect', async () => {
    for (const [callId, call] of activeCalls) {
      if (call.callerId === userId || call.calleeId === userId) {
        const otherId = call.callerId === userId ? call.calleeId : call.callerId;
        await endCall(callId, { status: call.answered ? 'completed' : 'missed' });
        emitToUser(otherId, 'call:ended', { callId, reason: 'disconnected' });
      }
    }
  });
}

module.exports = { registerCallHandlers };
