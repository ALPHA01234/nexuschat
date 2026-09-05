const express = require('express');
const { body } = require('express-validator');

const User = require('../models/user');
const FriendRequest = require('../models/FriendRequest');
const { requireAuth, requireUnrestricted } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { asyncHandler } = require('../utils/asyncHandler');
const { emitToUser } = require('../socket');

const router = express.Router();

async function getAcceptedFriendIds(userId) {
  const accepted = await FriendRequest.find({
    status: 'accepted',
    $or: [{ from: userId }, { to: userId }],
  });
  return accepted.map(fr => (fr.from.equals(userId) ? fr.to : fr.from));
}

// GET /api/friends — accepted friends list
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const accepted = await FriendRequest.find({
    status: 'accepted',
    $or: [{ from: req.user._id }, { to: req.user._id }],
  }).populate('from to', 'username displayName avatar online lastSeen');

  const friends = accepted.map(fr => {
    const other = fr.from._id.equals(req.user._id) ? fr.to : fr.from;
    return {
      username: other.username,
      displayName: other.displayName || other.username,
      avatar: other.avatar,
      online: other.online,
      lastSeen: other.lastSeen,
    };
  });

  res.json({ friends });
}));

// GET /api/friends/requests — incoming + outgoing pending requests
router.get('/requests', requireAuth, asyncHandler(async (req, res) => {
  const incoming = await FriendRequest.find({ to: req.user._id, status: 'pending' }).populate('from', 'username displayName avatar');
  const outgoing = await FriendRequest.find({ from: req.user._id, status: 'pending' }).populate('to', 'username displayName avatar');

  res.json({
    incoming: incoming.map(r => ({ id: r._id, username: r.from.username, displayName: r.from.displayName || r.from.username, avatar: r.from.avatar, createdAt: r.createdAt })),
    outgoing: outgoing.map(r => ({ id: r._id, username: r.to.username, displayName: r.to.displayName || r.to.username, avatar: r.to.avatar, createdAt: r.createdAt })),
  });
}));

// GET /api/friends/blocked — blocked users list
router.get('/blocked', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('blockedUsers', 'username displayName avatar');
  res.json({ blocked: user.blockedUsers.map(u => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar })) });
}));

// GET /api/friends/mutual/:username — mutual friend count/list with another user
router.get('/mutual/:username', requireAuth, asyncHandler(async (req, res) => {
  const target = await User.findOne({ username: String(req.params.username).trim().toLowerCase() });
  if (!target) return res.status(404).json({ message: 'User not found.' });

  const [myFriendIds, theirFriendIds] = await Promise.all([
    getAcceptedFriendIds(req.user._id),
    getAcceptedFriendIds(target._id),
  ]);
  const theirSet = new Set(theirFriendIds.map(String));
  const mutualIds = myFriendIds.filter(id => theirSet.has(String(id)));

  const mutualUsers = await User.find({ _id: { $in: mutualIds } }).select('username displayName avatar');
  res.json({
    count: mutualUsers.length,
    users: mutualUsers.map(u => ({ username: u.username, displayName: u.displayName || u.username, avatar: u.avatar })),
  });
}));

// ---------------- Send / respond to requests ----------------

router.post(
  '/request',
  requireAuth,
  requireUnrestricted,
  [body('username').trim().notEmpty().withMessage('Username is required.')],
  handleValidation,
  asyncHandler(async (req, res) => {
    const target = String(req.body.username).trim().toLowerCase();
    if (target === req.user.username) return res.status(400).json({ message: "You can't add yourself." });

    // Always searches MongoDB — never any device-local lookup.
    const targetUser = await User.findOne({ username: target });
    if (!targetUser) return res.status(404).json({ message: `No account found with username "${target}".` });

    if ((req.user.blockedUsers || []).some(id => id.equals(targetUser._id))) {
      return res.status(400).json({ message: 'Unblock this user before sending a friend request.' });
    }
    if ((targetUser.blockedUsers || []).some(id => id.equals(req.user._id))) {
      return res.status(403).json({ message: 'You cannot send a friend request to this user.' });
    }
    if (targetUser.privacy?.friendRequests === 'none') {
      return res.status(403).json({ message: 'This user is not accepting friend requests.' });
    }
    if (targetUser.privacy?.friendRequests === 'friends-of-friends') {
      const [mine, theirs] = await Promise.all([getAcceptedFriendIds(req.user._id), getAcceptedFriendIds(targetUser._id)]);
      const theirSet = new Set(theirs.map(String));
      const hasMutual = mine.some(id => theirSet.has(String(id)));
      if (!hasMutual) return res.status(403).json({ message: 'This user only accepts requests from mutual friends.' });
    }

    const existingBetween = await FriendRequest.findOne({
      $or: [{ from: req.user._id, to: targetUser._id }, { from: targetUser._id, to: req.user._id }],
      status: { $in: ['pending', 'accepted'] },
    });

    if (existingBetween) {
      if (existingBetween.status === 'accepted') return res.status(400).json({ message: 'Already friends with this user.' });
      if (existingBetween.from.equals(req.user._id)) return res.status(400).json({ message: 'Friend request already sent.' });

      existingBetween.status = 'accepted';
      existingBetween.respondedAt = new Date();
      await existingBetween.save();

      emitToUser(targetUser._id, 'friend:accepted', {
        username: req.user.username, displayName: req.user.displayName, avatar: req.user.avatar, online: req.user.online,
      });

      return res.json({ message: 'Friend request accepted (they had already requested you).', status: 'accepted' });
    }

    const request = await FriendRequest.create({ from: req.user._id, to: targetUser._id });

    emitToUser(targetUser._id, 'friend:request', {
      id: request._id, username: req.user.username, displayName: req.user.displayName || req.user.username,
      avatar: req.user.avatar, createdAt: request.createdAt,
    });

    res.status(201).json({ message: 'Friend request sent.', status: 'pending' });
  })
);

router.post('/accept/:requestId', requireAuth, asyncHandler(async (req, res) => {
  const request = await FriendRequest.findOne({ _id: req.params.requestId, to: req.user._id, status: 'pending' });
  if (!request) return res.status(404).json({ message: 'Friend request not found.' });

  request.status = 'accepted';
  request.respondedAt = new Date();
  await request.save();

  const requester = await User.findById(request.from).select('username displayName avatar online');

  emitToUser(request.from, 'friend:accepted', {
    username: req.user.username, displayName: req.user.displayName || req.user.username, avatar: req.user.avatar, online: req.user.online,
  });

  res.json({
    message: 'Friend request accepted.',
    friend: { username: requester.username, displayName: requester.displayName || requester.username, avatar: requester.avatar, online: requester.online },
  });
}));

router.post('/reject/:requestId', requireAuth, asyncHandler(async (req, res) => {
  const request = await FriendRequest.findOne({ _id: req.params.requestId, to: req.user._id, status: 'pending' });
  if (!request) return res.status(404).json({ message: 'Friend request not found.' });

  request.status = 'rejected';
  request.respondedAt = new Date();
  await request.save();

  emitToUser(request.from, 'friend:rejected', { username: req.user.username });
  res.json({ message: 'Friend request rejected.' });
}));

router.post('/cancel/:requestId', requireAuth, asyncHandler(async (req, res) => {
  const request = await FriendRequest.findOne({ _id: req.params.requestId, from: req.user._id, status: 'pending' });
  if (!request) return res.status(404).json({ message: 'Friend request not found.' });
  request.status = 'cancelled';
  request.respondedAt = new Date();
  await request.save();
  res.json({ message: 'Friend request cancelled.' });
}));

router.delete('/:username', requireAuth, asyncHandler(async (req, res) => {
  const target = String(req.params.username).trim().toLowerCase();
  const targetUser = await User.findOne({ username: target });
  if (!targetUser) return res.status(404).json({ message: 'User not found.' });

  const request = await FriendRequest.findOneAndDelete({
    status: 'accepted',
    $or: [{ from: req.user._id, to: targetUser._id }, { from: targetUser._id, to: req.user._id }],
  });
  if (!request) return res.status(404).json({ message: 'You are not friends with this user.' });

  emitToUser(targetUser._id, 'friend:removed', { username: req.user.username });
  res.json({ message: 'Friend removed.' });
}));

// ---------------- Block / unblock ----------------

router.post('/block/:username', requireAuth, asyncHandler(async (req, res) => {
  const target = String(req.params.username).trim().toLowerCase();
  if (target === req.user.username) return res.status(400).json({ message: "You can't block yourself." });

  const targetUser = await User.findOne({ username: target });
  if (!targetUser) return res.status(404).json({ message: 'User not found.' });

  if (!req.user.blockedUsers.some(id => id.equals(targetUser._id))) {
    req.user.blockedUsers.push(targetUser._id);
    await req.user.save();
  }

  // Blocking also ends any existing friendship.
  await FriendRequest.deleteMany({
    $or: [{ from: req.user._id, to: targetUser._id }, { from: targetUser._id, to: req.user._id }],
  });

  emitToUser(targetUser._id, 'friend:removed', { username: req.user.username });
  res.json({ message: `${targetUser.username} has been blocked.` });
}));

router.post('/unblock/:username', requireAuth, asyncHandler(async (req, res) => {
  const target = String(req.params.username).trim().toLowerCase();
  const targetUser = await User.findOne({ username: target });
  if (!targetUser) return res.status(404).json({ message: 'User not found.' });

  req.user.blockedUsers = req.user.blockedUsers.filter(id => !id.equals(targetUser._id));
  await req.user.save();

  res.json({ message: `${targetUser.username} has been unblocked.` });
}));

module.exports = router;
