const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');

const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');
const { requireAuth } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/users/search?q=term — excludes yourself and anyone blocked either direction
router.get('/search', requireAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ users: [] });

  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const blockedByMe = req.user.blockedUsers || [];
  const blockedMe = await User.find({ blockedUsers: req.user._id }).select('_id');

  const excludeIds = [req.user._id, ...blockedByMe, ...blockedMe.map(u => u._id)];

  const users = await User.find({
    username: { $regex: safeQ, $options: 'i' },
    _id: { $nin: excludeIds },
  })
    .select('username displayName avatar online')
    .limit(20);

  res.json({
    users: users.map(u => ({
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar,
      online: u.online,
    })),
  });
}));

// GET /api/users/me
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user.toPrivateJSON() });
}));

// PUT /api/users/me — profile + settings (everything except password)
router.put(
  '/me',
  requireAuth,
  [
    body('displayName').optional().trim().isLength({ max: 32 }),
    body('bio').optional().isLength({ max: 190 }),
    body('status').optional().isLength({ max: 60 }),
    body('pronouns').optional().isLength({ max: 30 }),
    body('themeColor').optional().matches(/^#[0-9a-fA-F]{6}$/),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { displayName, avatar, banner, bio, status, pronouns, themeColor, privacy, notifications, appearance } = req.body;

    if (typeof displayName === 'string') req.user.displayName = displayName.trim().slice(0, 32) || req.user.username;
    if (avatar && (avatar.type === 'image' || avatar.type === 'color') && typeof avatar.value === 'string') {
      req.user.avatar = { type: avatar.type, value: avatar.value };
    }
    if (banner && (banner.type === 'image' || banner.type === 'color') && typeof banner.value === 'string') {
      req.user.banner = { type: banner.type, value: banner.value };
    }
    if (typeof bio === 'string') req.user.bio = bio.slice(0, 190);
    if (typeof status === 'string') req.user.status = status.slice(0, 60);
    if (typeof pronouns === 'string') req.user.pronouns = pronouns.slice(0, 30);
    if (typeof themeColor === 'string') req.user.themeColor = themeColor;

    if (privacy && typeof privacy === 'object') {
      req.user.privacy = { ...req.user.privacy.toObject(), ...sanitizeSettingsPatch(privacy, ['friendRequests', 'readReceipts', 'typingIndicator', 'onlineVisibility']) };
    }
    if (notifications && typeof notifications === 'object') {
      req.user.notifications = { ...req.user.notifications.toObject(), ...sanitizeSettingsPatch(notifications, ['desktop', 'mentions', 'sounds', 'friendRequestAlerts']) };
    }
    if (appearance && typeof appearance === 'object') {
      req.user.appearance = { ...req.user.appearance.toObject(), ...sanitizeSettingsPatch(appearance, ['theme', 'fontSize', 'compactMode', 'animations', 'enterToSend', 'timestamp24h', 'reduceMotion', 'highContrast']) };
    }

    await req.user.save();
    res.json({ user: req.user.toPrivateJSON() });
  })
);

// Only copy over whitelisted keys — never trust arbitrary nested objects from the client.
function sanitizeSettingsPatch(obj, allowedKeys) {
  const out = {};
  allowedKeys.forEach(k => {
    if (obj[k] !== undefined) out[k] = obj[k];
  });
  return out;
}

// PUT /api/users/me/password — change password while logged in
router.put(
  '/me/password',
  requireAuth,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters.'),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const match = await bcrypt.compare(req.body.currentPassword, req.user.password);
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' });

    req.user.password = await bcrypt.hash(req.body.newPassword, 10);
    await req.user.save();
    res.json({ message: 'Password updated.' });
  })
);

// DELETE /api/users/me — permanently delete account
router.delete(
  '/me',
  requireAuth,
  [body('password').notEmpty().withMessage('Enter your password to confirm account deletion.')],
  handleValidation,
  asyncHandler(async (req, res) => {
    const match = await bcrypt.compare(req.body.password, req.user.password);
    if (!match) return res.status(400).json({ message: 'Incorrect password.' });

    await FriendRequest.deleteMany({ $or: [{ from: req.user._id }, { to: req.user._id }] });
    await req.user.deleteOne();

    res.json({ message: 'Account deleted.' });
  })
);

// GET /api/users/:username — public profile lookup
router.get('/:username', requireAuth, asyncHandler(async (req, res) => {
  const username = String(req.params.username).trim().toLowerCase();
  const user = await User.findOne({ username });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: user.toPublicJSON() });
}));

module.exports = router;
