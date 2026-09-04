const logger = require('./logger');

const RESEND_API_URL = 'https://api.resend.com/emails';

function getEmailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'NexusChat <onboarding@resend.dev>';

  if (!apiKey) {
    logger.warn(
      'RESEND_API_KEY is not set. OTP emails will be logged to the server console instead of sent.'
    );
    return null;
  }

  return { apiKey, from };
}

// Sends mail through Resend's HTTPS API instead of SMTP.
// This works on hosts where outbound SMTP ports are unavailable.
async function sendMail({ to, subject, html, text }) {
  const config = getEmailConfig();

  if (!config) {
    logger.info(`[DEV EMAIL] To: ${to} | Subject: ${subject}\n${text || html}`);
    return { sent: false, devMode: true };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        data?.message ||
        data?.error?.message ||
        `Resend returned HTTP ${response.status}`;
      throw new Error(detail);
    }

    logger.info(`Email sent to ${to} via Resend (${data.id || 'no message id returned'}).`);
    return { sent: true, devMode: false, id: data.id || null };
  } catch (err) {
    logger.error(`Failed to send email to ${to} ("${subject}") via Resend: ${err.message}`);
    // Keep a development fallback in logs so testing is not completely blocked
    // if the API key/domain configuration is temporarily wrong.
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
  return sendMail({
    to,
    subject: 'Verify your NexusChat account',
    html,
    text,
  });
}

async function sendPasswordResetEmail(to, otp) {
  const { html, text } = otpEmailTemplate(otp, 'reset');
  return sendMail({
    to,
    subject: 'Reset your NexusChat password',
    html,
    text,
  });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMail,
};
