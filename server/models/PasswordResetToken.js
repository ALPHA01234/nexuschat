const mongoose = require('mongoose');

const PasswordResetTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  verified: { type: Boolean, default: false }, // set true once OTP is confirmed, before password is set
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
