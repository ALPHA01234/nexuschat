const express = require('express');
const bcrypt = require('bcryptjs');
const { body, query } = require('express-validator');
const User = require('../models/user');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const FriendRequest = require('../models/FriendRequest');
const Call = require('../models/Call');
const VerificationToken = require('../models/VerificationToken');
const PasswordResetToken = require('../models/PasswordResetToken');
const Community = require('../models/Community');
const CommunityMessage = require('../models/CommunityMessage');
const RewardClaim = require('../models/RewardClaim');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requireFullAdmin } = require('../middleware/admin');
const { handleValidation } = require('../middleware/errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function adminUserJSON(user) {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    accountStatus: user.accountStatus,
    restrictionReason: user.restrictionReason,
    premium: { active: user.hasPremium(), until: user.premium?.until || null, source: user.premium?.source || 'none' },
    nexusCoins: user.nexusCoins || 0,
    warnings: user.warnings || [],
    badges: user.badges || [],
    createdAt: user.createdAt,
    lastSeen: user.lastSeen,
  };
}

router.get('/me', asyncHandler(async (req, res) => {
  res.json({ admin: true, level: 'owner', user: adminUserJSON(req.user) });
}));

router.get('/stats', asyncHandler(async (req, res) => {
  const [users, active, banned, premium, communities] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ accountStatus: 'active' }),
    User.countDocuments({ accountStatus: 'banned' }),
    User.countDocuments({ 'premium.active': true }),
    Community.countDocuments(),
  ]);
  res.json({ users, active, banned, premium, communities });
}));

router.get('/users', [query('page').optional().isInt({ min: 1 }), query('limit').optional().isInt({ min: 1, max: 100 })], handleValidation,
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const q = String(req.query.q || '').trim().slice(0, 80);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\$&');
    const filter = q ? { $or: [
      { username: { $regex: safe, $options: 'i' } },
      { displayName: { $regex: safe, $options: 'i' } },
      { email: { $regex: safe, $options: 'i' } },
    ] } : {};
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      User.countDocuments(filter),
    ]);
    res.json({ users: users.map(adminUserJSON), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

router.get('/users/:id/details', asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: 'User not found.' });
  const conversations = await Conversation.find({ participants: target._id }).select('_id');
  const conversationIds = conversations.map(c => c._id);
  const [messages, calls, friendLinks, communities, rewards] = await Promise.all([
    Message.countDocuments({ $or: [{ from: target._id }, { to: target._id }] }),
    Call.countDocuments({ $or: [{ caller: target._id }, { callee: target._id }] }),
    FriendRequest.countDocuments({ $or: [{ from: target._id }, { to: target._id }], status: 'accepted' }),
    Community.countDocuments({ 'members.user': target._id }),
    RewardClaim.countDocuments({ user: target._id }),
  ]);
  res.json({ user: adminUserJSON(target), stats: { conversations: conversationIds.length, messages, calls, friendLinks, communities, rewards, blockedUsers: target.blockedUsers?.length || 0 } });
}));

router.patch('/users/:id/status', [body('status').isIn(['active', 'restricted', 'suspended', 'banned']), body('reason').optional().isLength({ max: 500 })], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target._id.equals(req.user._id) && req.body.status !== 'active') return res.status(400).json({ message: 'You cannot restrict your own owner account.' });
    target.accountStatus = req.body.status;
    target.restrictionReason = req.body.status === 'active' ? '' : String(req.body.reason || '').slice(0, 500);
    await target.save();
    res.json({ user: adminUserJSON(target) });
  })
);

router.post('/users/:id/warnings', [body('message').trim().isLength({ min: 3, max: 500 })], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    target.warnings.push({ message: req.body.message.trim(), createdBy: req.user._id });
    await target.save();
    res.status(201).json({ user: adminUserJSON(target) });
  })
);

router.patch('/users/:id/premium', requireFullAdmin, [body('active').isBoolean(), body('until').optional({ nullable: true }).isISO8601(), body('source').optional().isLength({ max: 40 })], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    target.premium = { active: req.body.active, until: req.body.until ? new Date(req.body.until) : null, source: String(req.body.source || 'admin').slice(0, 40) };
    await target.save();
    res.json({ user: adminUserJSON(target) });
  })
);

router.patch('/users/:id/coins', requireFullAdmin, [body('amount').isInt({ min: -1000000, max: 1000000 })], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    target.nexusCoins = Math.max(0, (target.nexusCoins || 0) + Number(req.body.amount));
    await target.save();
    res.json({ user: adminUserJSON(target) });
  })
);

router.patch('/users/:id/role', requireFullAdmin, [body('role').isIn(['user', 'moderator', 'admin'])], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target._id.equals(req.user._id) && req.body.role !== 'admin') return res.status(400).json({ message: 'You cannot demote your owner account here.' });
    target.role = req.body.role;
    await target.save();
    res.json({ user: adminUserJSON(target) });
  })
);

router.delete('/users/:id', requireFullAdmin,
  [body('adminPassword').notEmpty(), body('confirmUsername').notEmpty()], handleValidation,
  asyncHandler(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target._id.equals(req.user._id)) return res.status(400).json({ message: 'For safety, the owner account cannot be deleted from the Control Center.' });
    if (String(req.body.confirmUsername).trim().toLowerCase() !== target.username) return res.status(400).json({ message: 'Username confirmation does not match.' });
    if (!(await bcrypt.compare(req.body.adminPassword, req.user.password))) return res.status(403).json({ message: 'Administrator password is incorrect.' });

    const conversations = await Conversation.find({ participants: target._id }).select('_id');
    const conversationIds = conversations.map(c => c._id);
    const owned = await Community.find({ owner: target._id }).select('_id');
    const ownedIds = owned.map(c => c._id);

    await Promise.all([
      Message.deleteMany({ $or: [{ from: target._id }, { to: target._id }, { conversation: { $in: conversationIds } }] }),
      Conversation.deleteMany({ _id: { $in: conversationIds } }),
      FriendRequest.deleteMany({ $or: [{ from: target._id }, { to: target._id }] }),
      Call.deleteMany({ $or: [{ caller: target._id }, { callee: target._id }] }),
      VerificationToken.deleteMany({ user: target._id }),
      PasswordResetToken.deleteMany({ user: target._id }),
      RewardClaim.deleteMany({ user: target._id }),
      CommunityMessage.deleteMany({ $or: [{ sender: target._id }, { community: { $in: ownedIds } }] }),
      Community.deleteMany({ _id: { $in: ownedIds } }),
      Community.updateMany({ 'members.user': target._id }, { $pull: { members: { user: target._id } } }),
      User.updateMany({ blockedUsers: target._id }, { $pull: { blockedUsers: target._id } }),
    ]);
    await target.deleteOne();
    res.json({ message: `@${target.username} was permanently deleted.` });
  })
);

module.exports = router;
