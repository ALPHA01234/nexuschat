const logger = require('./logger');

const RESEND_API_URL = 'https://api.resend.com/emails';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function otpEmailTemplate(otp, purpose) {
  const title = purpose === 'reset' ? 'Reset your NexusChat password' : 'Verify your NexusChat account';
  const body = purpose === 'reset'
    ? 'Use the code below to reset your password.'
    : 'Use the code below to finish creating your NexusChat account.';

  const html = `<!doctype html><html><body style="margin:0;background:#0d0f14;color:#eef1f6;font-family:Arial,sans-serif"><div style="max-width:520px;margin:auto;padding:36px"><div style="font-weight:800;letter-spacing:.08em;margin-bottom:26px">NEXUS<span style="color:#ff3152">CHAT</span></div><div style="background:#151821;border:1px solid #272c38;border-radius:16px;padding:28px"><h2 style="margin-top:0">${title}</h2><p style="color:#b9c0cc">${body}</p><div style="font-size:34px;letter-spacing:9px;font-weight:800;text-align:center;background:#0d0f14;padding:18px;border-radius:12px;margin:24px 0">${otp}</div><p style="font-size:13px;color:#7f8795">This code expires in 10 minutes. Never share it with anyone. NexusChat staff will never ask you for this code.</p></div></div></body></html>`;
  const text = `${title}\n\n${body}\n\nCode: ${otp}\n\nThis code expires in 10 minutes.`;
  return { html, text };
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function gmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth returned HTTP ${response.status}`);
  }
  return data.access_token;
}

async function sendWithGmailApi({ to, subject, html, text }) {
  const accessToken = await gmailAccessToken();
  if (!accessToken) return null;

  const from = process.env.GMAIL_FROM || process.env.GMAIL_ADDRESS;
  if (!from) throw new Error('GMAIL_FROM or GMAIL_ADDRESS is required for Gmail API sending.');

  const boundary = `nexus_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || '',
    `--${boundary}--`,
  ].join('\r\n');

  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(raw) }),
    signal: AbortSignal.timeout(12000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gmail API returned HTTP ${response.status}`);
  }
  logger.info(`Email sent to ${to} via Gmail API (${data.id || 'no id'}).`);
  return { sent: true, provider: 'gmail', id: data.id || null };
}

async function sendWithResend({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  const from = process.env.EMAIL_FROM || 'NexusChat <onboarding@resend.dev>';
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error?.message || `Resend returned HTTP ${response.status}`);
  logger.info(`Email sent to ${to} via Resend (${data.id || 'no id'}).`);
  return { sent: true, provider: 'resend', id: data.id || null };
}

async function sendMail(payload) {
  const preferred = String(process.env.EMAIL_PROVIDER || 'auto').toLowerCase();
  try {
    if (preferred === 'gmail' || preferred === 'auto') {
      const result = await sendWithGmailApi(payload);
      if (result) return result;
      if (preferred === 'gmail') throw new Error('Gmail API credentials are incomplete.');
    }
    if (preferred === 'resend' || preferred === 'auto') {
      const result = await sendWithResend(payload);
      if (result) return result;
      if (preferred === 'resend') throw new Error('RESEND_API_KEY is not configured.');
    }
  } catch (err) {
    logger.error(`Email delivery failed (${preferred}): ${err.message}`);
    throw err;
  }

  logger.warn(`[DEV EMAIL] To: ${payload.to} | Subject: ${payload.subject}\n${payload.text || payload.html}`);
  return { sent: false, provider: 'console', devMode: true };
}

async function sendVerificationEmail(to, otp) {
  const { html, text } = otpEmailTemplate(otp, 'verify');
  return sendMail({ to, subject: 'Your NexusChat verification code', html, text });
}

async function sendPasswordResetEmail(to, otp) {
  const { html, text } = otpEmailTemplate(otp, 'reset');
  return sendMail({ to, subject: 'Reset your NexusChat password', html, text });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendMail };
