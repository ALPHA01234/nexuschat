function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

function isOwnerAdmin(user) {
  return !!user && adminEmails().includes(String(user.email || '').toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!isOwnerAdmin(req.user)) return res.status(403).json({ message: 'Owner administrator access required.' });
  req.adminLevel = 'owner';
  next();
}

function requireFullAdmin(req, res, next) {
  return requireAdmin(req, res, next);
}

module.exports = { requireAdmin, requireFullAdmin, isOwnerAdmin };
