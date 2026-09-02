const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter = null;
let configured = false;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    logger.warn(
      'Email is not configured (SMTP_HOST/PORT/USER/PASS missing in .env). ' +
      'OTP codes will be printed to the server console instead of emailed.'
    );
    configured = false;
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for 587/25 (STARTTLS)
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Hosts like Render's free tier block outbound SMTP ports (25/465/587)
    // entirely, which otherwise leaves nodemailer hanging until the platform's
    // own request timeout kills it. Fail fast instead so the caller can
    // recover gracefully (see sendMail below) rather than the whole request
    // hanging or dying with an opaque 500.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  configured = true;
  return transporter;
}

// Sends an email. IMPORTANT: this never throws — a broken/blocked SMTP
// connection (e.g. Render's free tier blocks outbound ports 25/465/587)
// must not be allowed to take down registration, login-adjacent flows, etc.
// Callers get { sent, devMode } and decide what, if anything, to tell the
// user; the OTP itself is always already persisted in Mongo before this is
// called, so verification/reset can still proceed via "resend" once email
// delivery is fixed.
async function sendMail({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || 'NexusChat <no-reply@nexuschat.app>';
  const t = getTransporter();

  if (!t) {
    // Dev fallback so the flow is still fully testable without real SMTP creds.
    logger.info(`[DEV EMAIL] To: ${to} | Subject: ${subject}\n${text || html}`);
    return { sent: false, devMode: true };
  }

  try {
    await t.sendMail({ from, to, subject, html, text });
    return { sent: true, devMode: false };
  } catch (err) {
    logger.error(`Failed to send email to ${to} ("${subject}"):`, err.message);
    logger.error(err.stack);
    // Still surface the code in server logs so the user isn't fully locked out
    // if SMTP is down/blocked — e.g. Render's free tier blocks outbound SMTP
    // ports, which surfaces here as ETIMEDOUT/ECONNECTION.
    logger.info(`[EMAIL FALLBACK] To: ${to} | Subject: ${subject}\n${text || html}`);
    return { sent: false, devMode: false, error: err.message };
  }
}

function otpEmailTemplate(otp, purpose) {
  const title = purpose === 'reset' ? 'Reset your password' : 'Verify your email';
  const body = purpose === 'reset'
    ? 'Use the code below to reset your NexusChat password.'
    : 'Use the code below to verify your NexusChat account.';
  const html = `
    <div style="font-family:Arial,sans-serif;background:#0f0f13;color:#eee;padding:32px;border-radius:12px;max-width:420px;margin:auto;">
      <h2 style="color:#ff1f3d;margin-top:0;">${title}</h2>
      <p>${body}</p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:700;background:#1a1a20;padding:16px;border-radius:8px;text-align:center;margin:20px 0;">${otp}</div>
      <p style="color:#999;font-size:13px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  const text = `${title}\n\n${body}\n\nCode: ${otp}\n\nThis code expires in 10 minutes.`;
  return { html, text };
}

async function sendVerificationEmail(to, otp) {
  const { html, text } = otpEmailTemplate(otp, 'verify');
  return sendMail({ to, subject: 'Verify your NexusChat account', html, text });
}

async function sendPasswordResetEmail(to, otp) {
  const { html, text } = otpEmailTemplate(otp, 'reset');
  return sendMail({ to, subject: 'Reset your NexusChat password', html, text });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendMail };
