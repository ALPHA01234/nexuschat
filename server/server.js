const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

const logger = require('./utils/logger');
const { sanitizeInput } = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const uploadRoutes = require('./routes/uploads');
const callRoutes = require('./routes/calls');
const adminRoutes = require('./routes/admin');
const communityRoutes = require('./routes/communities');
const rewardRoutes = require('./routes/rewards');

const { initSocket } = require('./socket');

// ---------------- Environment sanity check ----------------
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
  process.exit(1);
}
if (!process.env.GMAIL_REFRESH_TOKEN && !process.env.RESEND_API_KEY) {
  logger.warn('No email provider configured — OTP emails will be logged to the console. Configure Gmail API or Resend.');
}
if (!process.env.TURN_URL) {
  logger.warn('TURN_URL not set — calls will rely on STUN only and may fail across strict NATs/firewalls.');
}

const app = express();
const httpServer = http.createServer(app);
const corsOptions = { origin: process.env.CORS_ORIGIN || '*' };

// Render, Railway, and Fly.io all put the app behind a single reverse proxy.
// Without this, req.ip (and therefore express-rate-limit's per-IP buckets)
// resolves to the proxy's IP for every request, effectively rate-limiting
// all users of the app together instead of individually. Configurable via
// TRUST_PROXY_HOPS for setups with more than one proxy hop in front of us.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      scriptSrc: ["'self'"],

      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],

      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "data:"
      ],

      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https:"
      ],

      connectSrc: [
        "'self'",
        "ws:",
        "wss:"
      ],

      mediaSrc: [
        "'self'",
        "blob:",
        "data:"
      ],

      objectSrc: ["'none'"],

      baseUri: ["'self'"],

      frameAncestors: ["'self'"]
    }
  }
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '12mb' })); // voice notes are base64-encoded, need generous limit
app.use(sanitizeInput);
app.use('/api', apiLimiter);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the API-backed NexusChat client from the backend as well.
// This prevents the old device-local frontend from being used accidentally.
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/rewards', rewardRoutes);

// Exposes ICE server config (STUN always, TURN if configured) so the client
// never needs to hardcode credentials.
app.get('/api/ice-config', (req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

const io = initSocket(httpServer, corsOptions);
app.set('io', io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} (HTTP + Socket.IO)`);
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection:', err?.message || err);
  logger.error(err?.stack || '(no stack trace available)');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err?.message || err);
  logger.error(err?.stack || '(no stack trace available)');
});
