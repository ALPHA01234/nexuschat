const rateLimit = require('express-rate-limit');

// Generic API limiter — generous, just to blunt abusive scripts.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

// Tight limiter for login/register/forgot-password — brute force protection.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

// Very tight limiter for OTP requests/resends — prevents email-bombing a user.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many verification requests. Please wait a few minutes and try again.' },
});

// Message-send limiter — basic spam protection, generous enough for real chatting.
const messageLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You are sending messages too quickly.' },
});

module.exports = { apiLimiter, authLimiter, otpLimiter, messageLimiter };
