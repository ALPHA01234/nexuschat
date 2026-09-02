/* ============================================================
   socket/index.js — creates the Socket.IO server, authenticates
   every connection with the same JWT used by the REST API, and
   delegates to the feature-specific handler modules.
   ============================================================ */

const { Server } = require('socket.io');
const { socketAuth } = require('../middleware/socket');
const presence = require('./presence');
const { registerMessagingHandlers } = require('./messaging');
const { registerTypingHandlers } = require('./typing');
const { registerCallHandlers } = require('./calls');
const logger = require('../utils/logger');

function initSocket(httpServer, corsOptions) {
  const io = new Server(httpServer, { cors: corsOptions || { origin: '*' } });
  presence.setIO(io);

  io.use(socketAuth);

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    presence.addSocket(userId, socket.id);
    logger.debug(`socket connected: ${socket.username} (${socket.id})`);

    try {
      await presence.markOnline(userId, socket.username);
    } catch (err) {
      logger.error('presence markOnline failed', err);
    }

    registerMessagingHandlers(socket);
    registerTypingHandlers(socket);
    registerCallHandlers(socket);

    socket.on('disconnect', async () => {
      presence.removeSocket(userId, socket.id);
      try {
        await presence.markOfflineIfNoSockets(userId, socket.username);
      } catch (err) {
        logger.error('presence markOffline failed', err);
      }
      logger.debug(`socket disconnected: ${socket.username} (${socket.id})`);
    });
  });

  return io;
}

module.exports = {
  initSocket,
  emitToUser: presence.emitToUser,
  isUserOnline: presence.isUserOnline,
};
