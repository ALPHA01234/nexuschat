/* ============================================================
   messaging.js — real-time send + read-receipt socket handlers.
   Mirrors routes/messages.js (REST) so either path keeps clients
   in sync; this is the primary path when the socket is connected.
   ============================================================ */

const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const FriendRequest = require('../models/FriendRequest');
const { emitToUser, isUserOnline } = require('./presence');
const logger = require('../utils/logger');

async function areFriends(userIdA, userIdB) {
  const fr = await FriendRequest.findOne({
    status: 'accepted',
    $or: [{ from: userIdA, to: userIdB }, { from: userIdB, to: userIdA }],
  });
  return !!fr;
}

async function getOrCreateConversation(userIdA, userIdB) {
  const key = Conversation.keyFor(userIdA, userIdB);
  let convo = await Conversation.findOne({ key });
  if (!convo) convo = await Conversation.create({ participants: [userIdA, userIdB], key });
  return convo;
}

function registerMessagingHandlers(socket) {
  const userId = socket.userId;

  socket.on('message:send', async (data, ack) => {
    try {
      const { to, type, content, duration, attachment, replyTo } = data || {};
      if (!to || (type !== 'text' && type !== 'voice' && type !== 'attachment')) {
        if (ack) ack({ ok: false, message: 'Invalid message payload.' });
        return;
      }
      if (type === 'text' && !content) {
        if (ack) ack({ ok: false, message: 'Message content is required.' });
        return;
      }

      const recipient = await User.findOne({ username: String(to).trim().toLowerCase() });
      if (!recipient) {
        if (ack) ack({ ok: false, message: 'Recipient not found.' });
        return;
      }

      const friends = await areFriends(userId, recipient._id);
      if (!friends) {
        if (ack) ack({ ok: false, message: 'You are not friends with this user.' });
        return;
      }

      const me = await User.findById(userId).select('blockedUsers username');
      if ((me.blockedUsers || []).some(id => id.equals(recipient._id)) ||
          (recipient.blockedUsers || []).some(id => id.equals(userId))) {
        if (ack) ack({ ok: false, message: 'You cannot message this user.' });
        return;
      }

      const convo = await getOrCreateConversation(userId, recipient._id);
      const online = isUserOnline(recipient._id);

      const message = await Message.create({
        conversation: convo._id,
        from: userId,
        to: recipient._id,
        type,
        content: content || '',
        duration: duration || 0,
        attachment: type === 'attachment' ? attachment : null,
        replyTo: replyTo || null,
        status: online ? 'delivered' : 'sent',
        deliveredAt: online ? new Date() : undefined,
      });

      convo.lastMessageAt = message.ts;
      await convo.save();

      const payload = message.toClientJSON();
      payload.fromUsername = me.username;
      payload.toUsername = recipient.username;

      emitToUser(recipient._id, 'message:new', payload);
      if (ack) ack({ ok: true, message: payload });
      emitToUser(userId, 'message:new', payload); // sync sender's other devices
    } catch (err) {
      logger.error('message:send error', err);
      if (ack) ack({ ok: false, message: 'Server error sending message.' });
    }
  });

  socket.on('message:read', async ({ conversationId }) => {
    try {
      if (!conversationId) return;
      const unread = await Message.find({ conversation: conversationId, to: userId, status: { $ne: 'read' } });
      if (unread.length === 0) return;

      await Message.updateMany(
        { conversation: conversationId, to: userId, status: { $ne: 'read' } },
        { status: 'read', readAt: new Date() }
      );

      const senderIds = [...new Set(unread.map(m => m.from.toString()))];
      senderIds.forEach(senderId => {
        emitToUser(senderId, 'message:read', {
          conversationId,
          readBy: userId,
          messageIds: unread.map(m => m._id),
        });
      });
    } catch (err) {
      logger.error('message:read error', err);
    }
  });
}

module.exports = { registerMessagingHandlers };
