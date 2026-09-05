const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');

const User = require('../models/user');
const FriendRequest = require('../models/FriendRequest');
const { requireAuth } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

function isAnimatedDataImage(obj) {
  return obj?.type === 'image' && typeof obj.value === 'string' && obj.value.startsWith('data:image/gif');
}

router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ users: [] });
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockedByMe = req.user.blockedUsers || [];
  const blockedMe = await User.find({ blockedUsers: req.user._id }).select('_id');
  const excludeIds = [req.user._id, ...blockedByMe, ...blockedMe.map(u => u._id)];
  const users = await User.find({
    $or: [
      { username: { $regex: safeQ, $options: 'i' } },
      { displayName: { $regex: safeQ, $options: 'i' } },
    ],
    _id: { $nin: excludeIds },
    accountStatus: { $nin: ['banned', 'suspended'] },
  }).select('username displayName avatar online premium').limit(20);
  res.json({ users: users.map(u => u.toPublicJSON()) });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => res.json({ user: req.user.toPrivateJSON() })));

router.put(
  '/me',
  requireAuth,
  [
    body('username').optional().trim().toLowerCase().isLength({ min: 3, max: 16 }).matches(/^[a-zA-Z0-9_]+$/),
    body('displayName').optional().trim().isLength({ max: 32 }),
    body('bio').optional().isLength({ max: 190 }),
    body('status').optional().isLength({ max: 60 }),
    body('pronouns').optional().isLength({ max: 30 }),
    body('themeColor').optional().matches(/^#[0-9a-fA-F]{6}$/),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { username, displayName, avatar, banner, bio, status, pronouns, themeColor, privacy, notifications, appearance } = req.body;

    if (typeof username === 'string' && username !== req.user.username) {
      const taken = await User.findOne({ username, _id: { $ne: req.user._id } });
      if (taken) return res.status(409).json({ message: 'That username is already taken.' });
      req.user.username = username;
      req.user.usernameChangedAt = new Date();
    }
    if (typeof displayName === 'string') req.user.displayName = displayName.trim().slice(0, 32) || req.user.username;

    const premium = req.user.hasPremium();
    if (avatar && (avatar.type === 'image' || avatar.type === 'color') && typeof avatar.value === 'string') {
      if (isAnimatedDataImage(avatar) && !premium) return res.status(403).json({ message: 'Animated GIF profile pictures are a NexusChat Premium feature.' });
      if (avatar.type === 'image' && avatar.value.length > 2200000) return res.status(413).json({ message: 'Profile image is too large.' });
      req.user.avatar = { type: avatar.type, value: avatar.value };
    }
    if (banner && (banner.type === 'image' || banner.type === 'color') && typeof banner.value === 'string') {
      if (isAnimatedDataImage(banner) && !premium) return res.status(403).json({ message: 'Animated GIF banners are a NexusChat Premium feature.' });
      if (banner.type === 'image' && banner.value.length > 3600000) return res.status(413).json({ message: 'Banner image is too large.' });
      req.user.banner = { type: banner.type, value: banner.value };
    }

    if (typeof bio === 'string') req.user.bio = bio.slice(0, 190);
    if (typeof status === 'string') req.user.status = status.slice(0, 60);
    if (typeof pronouns === 'string') req.user.pronouns = pronouns.slice(0, 30);
    if (typeof themeColor === 'string') req.user.themeColor = themeColor;

    if (privacy && typeof privacy === 'object') req.user.privacy = { ...req.user.privacy.toObject(), ...sanitizeSettingsPatch(privacy, ['friendRequests', 'readReceipts', 'typingIndicator', 'onlineVisibility']) };
    if (notifications && typeof notifications === 'object') req.user.notifications = { ...req.user.notifications.toObject(), ...sanitizeSettingsPatch(notifications, ['desktop', 'mentions', 'sounds', 'friendRequestAlerts']) };
    if (appearance && typeof appearance === 'object') req.user.appearance = { ...req.user.appearance.toObject(), ...sanitizeSettingsPatch(appearance, ['theme', 'fontSize', 'compactMode', 'animations', 'enterToSend', 'timestamp24h', 'reduceMotion', 'highContrast']) };

    await req.user.save();
    res.json({ user: req.user.toPrivateJSON() });
  })
);

function sanitizeSettingsPatch(obj, allowedKeys) {
  const out = {};
  allowedKeys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

router.put('/me/password', requireAuth,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters.')],
  handleValidation,
  asyncHandler(async (req, res) => {
    if (!(await bcrypt.compare(req.body.currentPassword, req.user.password))) return res.status(400).json({ message: 'Current password is incorrect.' });
    req.user.password = await bcrypt.hash(req.body.newPassword, 10);
    await req.user.save();
    res.json({ message: 'Password updated.' });
  })
);

router.post('/me/warnings/:warningId/acknowledge', requireAuth, asyncHandler(async (req, res) => {
  const warning = req.user.warnings.id(req.params.warningId);
  if (!warning) return res.status(404).json({ message: 'Warning not found.' });
  warning.acknowledgedAt = new Date();
  await req.user.save();
  res.json({ user: req.user.toPrivateJSON() });
}));

router.delete('/me', requireAuth, [body('password').notEmpty().withMessage('Enter your password to confirm account deletion.')], handleValidation,
  asyncHandler(async (req, res) => {
    if (!(await bcrypt.compare(req.body.password, req.user.password))) return res.status(400).json({ message: 'Incorrect password.' });
    await FriendRequest.deleteMany({ $or: [{ from: req.user._id }, { to: req.user._id }] });
    await req.user.deleteOne();
    res.json({ message: 'Account deleted.' });
  })
);

router.get('/:username', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findOne({ username: String(req.params.username).trim().toLowerCase() });
  if (!user || ['banned', 'suspended'].includes(user.accountStatus)) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: user.toPublicJSON() });
}));

module.exports = router;
