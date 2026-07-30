const jwt = require("jsonwebtoken");
const User = require("../models/user");

// Protects REST routes. Expects "Authorization: Bearer <token>".
// Never trusts any user id/username sent in the request body/query —
// req.user is always derived from the verified JWT.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "Missing or invalid authorization header." });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Password stays on req.user (needed by change-password/delete-account routes) —
    // it's never sent to the client because toPublicJSON/toPrivateJSON whitelist fields.
    const user = await User.findById(payload.id);

    if (!user) {
      return res.status(401).json({ message: "User no longer exists." });
    }

    req.user = user; // full mongoose doc (minus password)
    req.userId = user._id.toString();
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

module.exports = { requireAuth };
