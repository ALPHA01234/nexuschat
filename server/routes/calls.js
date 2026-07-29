const express = require('express');
const Call = require('../models/Call');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

// GET /api/calls — recent call history (both directions)
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const calls = await Call.find({ $or: [{ caller: req.user._id }, { callee: req.user._id }] })
    .sort({ startedAt: -1 })
    .limit(50)
    .populate('caller callee', 'username displayName avatar');

  res.json({
    calls: calls.map(c => {
      const isOutgoing = c.caller._id.equals(req.user._id);
      const other = isOutgoing ? c.callee : c.caller;
      return {
        id: c._id,
        withUsername: other.username,
        withDisplayName: other.displayName || other.username,
        avatar: other.avatar,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        type: c.type,
        status: c.status,
        startedAt: c.startedAt.getTime(),
        durationSec: c.durationSec,
      };
    }),
  });
}));

module.exports = router;
