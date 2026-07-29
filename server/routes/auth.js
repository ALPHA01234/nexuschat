const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body } = require('express-validator');

const User = require('../models/User');
const VerificationToken = require('../models/VerificationToken');
const PasswordResetToken = require('../models/PasswordResetToken');
const { requireAuth } = require('../middleware/auth');
const { handleValidation } = require('../middleware/errorHandler');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { asyncHandler } = require('../utils/asyncHandler');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

const router = express.Router();

const OTP_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const RESET_TOKEN_TTL = '10m';

function signAuthToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

async function issueVerificationOtp(user) {
  await VerificationToken.deleteMany({ user: user._id });
  const otp = generateOtp();
  await VerificationToken.create({
    user: user._id,
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await sendVerificationEmail(user.email, otp);
}

// ---------------- Register ----------------
router.post(
  '/register',
  authLimiter,
  [
    body('username').trim().toLowerCase()
      .isLength({ min: 3, max: 16 }).withMessage('Username must be 3-16 characters.')
      .bail()
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores.'),
    body('email').trim().toLowerCase().isEmail().withMessage('Please enter a valid email address.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('displayName').optional().trim().isLength({ max: 32 }),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { username, email, password, displayName, avatar } = req.body;

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(409).json({ message: 'That username is already taken.' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      if (!existingEmail.emailVerified) {
        // Let them pick up where they left off instead of dead-ending.
        await issueVerificationOtp(existingEmail);
        return res.status(200).json({
          message: 'That email is already registered but not verified. We sent a new code.',
          requiresVerification: true,
          email: existingEmail.email,
        });
      }
      return res.status(409).json({ message: 'That email is already registered.' });
    }

    let safeAvatar = { type: 'color', value: '#ff1f3d' };
    if (avatar && (avatar.type === 'image' || avatar.type === 'color') && typeof avatar.value === 'string') {
      safeAvatar = { type: avatar.type, value: avatar.value };
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      displayName: (displayName && displayName.trim().slice(0, 32)) || username,
      avatar: safeAvatar,
    });

    await issueVerificationOtp(user);

    res.status(201).json({
      message: 'Account created. Check your email for a verification code.',
      requiresVerification: true,
      email: user.email,
    });
  })
);

// ---------------- Verify email ----------------
router.post(
  '/verify-email',
  otpLimiter,
  [
    body('email').trim().toLowerCase().isEmail(),
    body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with that email.' });
    if (user.emailVerified) return res.status(400).json({ message: 'This email is already verified.' });

    const token = await VerificationToken.findOne({ user: user._id }).sort({ createdAt: -1 });
    if (!token || token.expiresAt < new Date()) {
      return res.status(400).json({ message: 'That code has expired. Please request a new one.' });
    }
    if (token.attempts >= 5) {
      return res.status(429).json({ message: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (!verifyOtp(otp, token.otpHash)) {
      token.attempts += 1;
      await token.save();
      return res.status(400).json({ message: 'Incorrect code. Please try again.' });
    }

    user.emailVerified = true;
    await user.save();
    await VerificationToken.deleteMany({ user: user._id });

    const authToken = signAuthToken(user._id);
    res.json({ message: 'Email verified!', token: authToken, user: user.toPrivateJSON() });
  })
);

// ---------------- Resend verification ----------------
router.post(
  '/resend-verification',
  otpLimiter,
  [body('email').trim().toLowerCase().isEmail()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: 'No account found with that email.' });
    if (user.emailVerified) return res.status(400).json({ message: 'This email is already verified.' });

    await issueVerificationOtp(user);
    res.json({ message: 'Verification code sent.' });
  })
);

// ---------------- Login (username OR email, auto-detected) ----------------
router.post(
  '/login',
  authLimiter,
  [
    body('login').trim().notEmpty().withMessage('Enter your username or email.'),
    body('password').notEmpty().withMessage('Enter your password.'),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const loginValue = String(req.body.login).trim().toLowerCase();
    const isEmail = loginValue.includes('@');

    const user = await User.findOne(isEmail ? { email: loginValue } : { username: loginValue });
    if (!user) return res.status(400).json({ message: 'Invalid username/email or password.' });

    const match = await bcrypt.compare(req.body.password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid username/email or password.' });

    if (!user.emailVerified) {
      return res.status(403).json({
        message: 'Please verify your email before logging in.',
        requiresVerification: true,
        email: user.email,
      });
    }

    user.online = true;
    user.lastSeen = new Date();
    await user.save();

    const token = signAuthToken(user._id);
    res.json({ token, user: user.toPrivateJSON() });
  })
);

// ---------------- Forgot password ----------------
router.post(
  '/forgot-password',
  otpLimiter,
  [body('email').trim().toLowerCase().isEmail()],
  handleValidation,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    // Always respond the same way whether or not the account exists, to avoid
    // leaking which emails are registered.
    if (user) {
      await PasswordResetToken.deleteMany({ user: user._id });
      const otp = generateOtp();
      await PasswordResetToken.create({
        user: user._id,
        otpHash: hashOtp(otp),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      });
      await sendPasswordResetEmail(user.email, otp);
    }
    res.json({ message: 'If that email is registered, a reset code has been sent.' });
  })
);

// ---------------- Verify reset OTP -> short-lived reset ticket ----------------
router.post(
  '/verify-reset-otp',
  otpLimiter,
  [
    body('email').trim().toLowerCase().isEmail(),
    body('otp').trim().isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid or expired code.' });

    const token = await PasswordResetToken.findOne({ user: user._id }).sort({ createdAt: -1 });
    if (!token || token.expiresAt < new Date()) {
      return res.status(400).json({ message: 'That code has expired. Please request a new one.' });
    }
    if (token.attempts >= 5) {
      return res.status(429).json({ message: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (!verifyOtp(otp, token.otpHash)) {
      token.attempts += 1;
      await token.save();
      return res.status(400).json({ message: 'Incorrect code. Please try again.' });
    }

    token.verified = true;
    await token.save();

    const resetToken = jwt.sign(
      { id: user._id, purpose: 'password-reset', tokenId: token._id },
      process.env.JWT_SECRET,
      { expiresIn: RESET_TOKEN_TTL }
    );

    res.json({ message: 'Code verified.', resetToken });
  })
);

// ---------------- Reset password ----------------
router.post(
  '/reset-password',
  authLimiter,
  [
    body('resetToken').notEmpty(),
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  ],
  handleValidation,
  asyncHandler(async (req, res) => {
    const { resetToken, newPassword } = req.body;

    let payload;
    try {
      payload = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ message: 'This reset link has expired. Please start over.' });
    }
    if (payload.purpose !== 'password-reset') {
      return res.status(400).json({ message: 'Invalid reset token.' });
    }

    const token = await PasswordResetToken.findOne({ _id: payload.tokenId, user: payload.id, verified: true });
    if (!token) return res.status(400).json({ message: 'This reset link has already been used or expired.' });

    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await PasswordResetToken.deleteMany({ user: user._id });

    res.json({ message: 'Password updated. You can now log in.' });
  })
);

// ---------------- Current session ----------------
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: req.user.toPrivateJSON() });
}));

module.exports = router;
