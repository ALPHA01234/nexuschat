const crypto = require('crypto');

// 6-digit numeric OTP — easy to type, short-lived, always hashed at rest.
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function verifyOtp(otp, hash) {
  if (!otp || !hash) return false;
  const a = Buffer.from(hashOtp(otp));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateOtp, hashOtp, verifyOtp };
