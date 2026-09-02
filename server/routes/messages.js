const express = require('express');
const { body, query } = require('express-validator');

const User = require('../models/user');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const FriendRequest = require('../models/FriendRequest');
const { requireAuth } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { messageLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../utils/asyncHandler');
const { emitToUser, isUserOnline } = require('../socket');

const router = express.Router();

async function assertFriends(userIdA, userIdB) {
  const fr = await FriendRequest.findOne({
    status: 'accepted',
    $or: [{ from: userIdA, to: userIdB }, { from: userIdB, to: userIdA }],
  });
  return !!fr;
}

function assertNotBlocked(meDoc, otherUser) {
  if ((meDoc.blockedUsers || []).some(id => id.equals(otherUser._id))) {
    throw Object.assign(new Error('You have blocked this user.'), { status: 403 });
  }
  if ((otherUser.blockedUsers || []).some(id => id.equals(meDoc._id))) {
    throw Object.assign(new Error('You cannot message this user.'), { status: 403 });
  }
}

async function getOrCreateConversation(userIdA, userIdB) {
  const key = Conversation.keyFor(userIdA, userIdB);
  let convo = await Conversation.findOne({ key });
  if (!convo) convo = await Conversation.create({ participants: [userIdA, userIdB], key });
  return convo;
}

// GET /api/messages/with/:username?before=<ts>&limit=50 — history, newest-first pagination
router.get(
  '/with/:username',
  requireAuth,
  [query('limit').optional().isInt({ min: 1, max: 100 })],
  handleValidation,
  asyncHandler(async (req, res) => {
    const target = String(req.params.username).trim().toLowerCase();
    const targetUser = await User.findOne({ username: target });
    if (!targetUser) return res.status(404).json({ message: 'User not found.' });

    const friends = await assertFriends(req.user._id, targetUser._id);
    if (!friends) return res.status(403).json({ message: 'You are not friends with this user.' });

    const convo = await getOrCreateConversation(req.user._id, targetUser._id);

    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const filter = { conversation: convo._id };
    if (req.query.before) filter.ts = { $lt: new Date(Number(req.query.before)) };

    const page = await Message.find(filter).sort({ ts: -1 }).limit(limit);
    const messages = page.reverse().map(m => {
      const json = m.toClientJSON();
      json.fromUsername = m.from.equals(req.user._id) ? req.user.username : targetUser.username;
      json.toUsername = m.to.equals(req.user._id) ? req.user.username : targetUser.username;
      return json;
    });

    res.json({
      conversationId: convo._id,
      messages,
      hasMore: page.length === limit,
    });
  })
);

// GET /api/messages/search?withUsername=&q= — text search within a conversation
router.get(
  '/search',
  requireAuth,
  [query('withUsername').notEmpty(), query('q').trim().notEmpty()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const targetUser = await User.findOne({ username: String(req.query.withUsername).trim().toLowerCase() });
    if (!targetUser) return res.status(404).json({ message: 'User not found.' });

    const convo = await getOrCreateConversation(req.user._id, targetUser._id);
    const safeQ = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const results = await Message.find({
      conversation: convo._id,
      deleted: { $ne: true },
      content: { $regex: safeQ, $options: 'i' },
    }).sort({ ts: -1 }).limit(50);

    res.json({ results: results.map(m => m.toClientJSON()) });
  })
);

// POST /api/messages/send — REST fallback for real-time socket send
router.post(
  '/send',
  requireAuth,
  messageLimiter,
  [
    body('to').trim().notEmpty(),
    body('type').isIn(['text', 'voice', 'attachment']),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { to, type, content, duration, attachment, replyTo } = req.body;
    if (type === 'text' && !content) return res.status(400).json({ message: 'Message content is required.' });
    if (type === 'attachment' && !attachment) return res.status(400).json({ message: 'Attachment data is required.' });

    const recipient = await User.findOne({ username: String(to).trim().toLowerCase() });
    if (!recipient) return res.status(404).json({ message: 'Recipient not found.' });

    const friends = await assertFriends(req.user._id, recipient._id);
    if (!friends) return res.status(403).json({ message: 'You are not friends with this user.' });
    assertNotBlocked(req.user, recipient);

    const convo = await getOrCreateConversation(req.user._id, recipient._id);
    const online = isUserOnline(recipient._id);

    const message = await Message.create({
      conversation: convo._id,
      from: req.user._id,
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
    payload.fromUsername = req.user.username;
    payload.toUsername = recipient.username;

    emitToUser(recipient._id, 'message:new', payload);
    res.status(201).json({ message: payload });
  })
);

// PUT /api/messages/:id — edit (sender only, text messages only)
router.put(
  '/:id',
  requireAuth,
  [body('content').trim().notEmpty().isLength({ max: 4000 })],
  handleValidation,
  asyncHandler(async (req, res) => {
    const msg = await Message.findById(req.params.id);
    if (!msg || msg.deleted) return res.status(404).json({ message: 'Message not found.' });
    if (!msg.from.equals(req.user._id)) return res.status(403).json({ message: 'You can only edit your own messages.' });
    if (msg.type !== 'text') return res.status(400).json({ message: 'Only text messages can be edited.' });

    msg.content = req.body.content.trim();
    msg.edited = true;
    msg.editedAt = new Date();
    await msg.save();

    const payload = msg.toClientJSON();
    emitToUser(msg.to, 'message:edited', payload);
    emitToUser(msg.from, 'message:edited', payload);
    res.json({ message: payload });
  })
);

// DELETE /api/messages/:id — soft delete (sender only)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg || msg.deleted) return res.status(404).json({ message: 'Message not found.' });
  if (!msg.from.equals(req.user._id)) return res.status(403).json({ message: 'You can only delete your own messages.' });

  msg.deleted = true;
  msg.deletedAt = new Date();
  msg.content = '';
  msg.attachment = null;
  await msg.save();

  const payload = { id: msg._id, conversationId: msg.conversation };
  emitToUser(msg.to, 'message:deleted', payload);
  emitToUser(msg.from, 'message:deleted', payload);
  res.json({ message: 'Message deleted.' });
}));

// POST /api/messages/:id/pin, DELETE /api/messages/:id/pin — either participant can pin/unpin
router.post('/:id/pin', requireAuth, asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg || msg.deleted) return res.status(404).json({ message: 'Message not found.' });
  if (!msg.from.equals(req.user._id) && !msg.to.equals(req.user._id)) {
    return res.status(403).json({ message: 'Not authorized.' });
  }

  msg.pinned = true;
  msg.pinnedAt = new Date();
  await msg.save();

  const payload = msg.toClientJSON();
  emitToUser(msg.to, 'message:pinned', payload);
  emitToUser(msg.from, 'message:pinned', payload);
  res.json({ message: payload });
}));

router.delete('/:id/pin', requireAuth, asyncHandler(async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found.' });
  if (!msg.from.equals(req.user._id) && !msg.to.equals(req.user._id)) {
    return res.status(403).json({ message: 'Not authorized.' });
  }

  msg.pinned = false;
  msg.pinnedAt = undefined;
  await msg.save();

  const payload = msg.toClientJSON();
  emitToUser(msg.to, 'message:unpinned', payload);
  emitToUser(msg.from, 'message:unpinned', payload);
  res.json({ message: payload });
}));

// GET /api/messages/:conversationId/pinned — pinned messages in a conversation
router.get('/:conversationId/pinned', requireAuth, asyncHandler(async (req, res) => {
  const convo = await Conversation.findById(req.params.conversationId);
  if (!convo) return res.status(404).json({ message: 'Conversation not found.' });
  if (!convo.participants.some(p => p.equals(req.user._id))) return res.status(403).json({ message: 'Not authorized.' });

  const pinned = await Message.find({ conversation: convo._id, pinned: true }).sort({ pinnedAt: -1 });
  res.json({ pinned: pinned.map(m => m.toClientJSON()) });
}));

module.exports = router;
