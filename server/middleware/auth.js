const jwt = require('jsonwebtoken');
const User = require('../models/user');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing or invalid authorization header.' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: 'User no longer exists.' });
    if (user.accountStatus === 'banned') return res.status(403).json({ message: user.restrictionReason || 'This account has been banned.' });
    if (user.accountStatus === 'suspended') return res.status(403).json({ message: user.restrictionReason || 'This account is suspended.' });

    req.user = user;
    req.userId = user._id.toString();
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function requireUnrestricted(req, res, next) {
  if (req.user?.accountStatus === 'restricted') {
    return res.status(403).json({ message: req.user.restrictionReason || 'Your account is currently restricted from this action.' });
  }
  next();
}

module.exports = { requireAuth, requireUnrestricted };
