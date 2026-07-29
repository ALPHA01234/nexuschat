const User = require('../models/User');
const { emitToUser } = require('./presence');

function registerTypingHandlers(socket) {
  socket.on('typing', async ({ to, isTyping }) => {
    if (!to) return;
    try {
      const recipient = await User.findOne({ username: String(to).trim().toLowerCase() }).select('_id');
      if (!recipient) return;
      emitToUser(recipient._id, 'typing', { from: socket.username, isTyping: !!isTyping });
    } catch (e) {
      // typing indicator failures are non-critical; swallow silently
    }
  });
}

module.exports = { registerTypingHandlers };
