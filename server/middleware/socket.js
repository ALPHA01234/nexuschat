const jwt = require("jsonwebtoken");
const User = require("../models/user");

// Authenticates a Socket.IO connection using the same JWT issued by
// POST /api/auth/login. The client sends it as socket auth: { token }.
async function socketAuth(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization || "").replace("Bearer ", "");

    if (!token) return next(new Error("No token provided"));

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select("-password");
    if (!user) return next(new Error("User not found"));

    socket.userId = user._id.toString();
    socket.username = user.username;
    next();
  } catch (err) {
    next(new Error("Authentication failed"));
  }
}

module.exports = { socketAuth };
