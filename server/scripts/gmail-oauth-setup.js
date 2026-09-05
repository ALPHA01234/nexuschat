/*
  One-time Gmail API OAuth helper for NexusChat.
  Run this on your own PC, not on Render:
    1) Enable Gmail API in Google Cloud.
    2) Create OAuth credentials of type "Desktop app".
    3) Put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env.
    4) node scripts/gmail-oauth-setup.js
    5) Open the printed URL and approve the Gmail sending permission.
    6) Copy the printed refresh token into Render as GMAIL_REFRESH_TOKEN.
*/
require('dotenv').config();
const http = require('http');
const { URL } = require('url');

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
const port = 53682;
const redirectUri = `http://127.0.0.1:${port}/callback`;

if (!clientId || !clientSecret) {
  console.error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env first.');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, redirectUri);
    if (url.pathname !== '/callback') return;
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Authorization failed: ${error || 'missing code'}`);
      return;
    }

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || `HTTP ${response.status}`);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>NexusChat Gmail authorization complete.</h2><p>You can close this tab and return to PowerShell.</p>');

    console.log('\nSUCCESS. Add this secret to Render:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token || '(not returned)'}`);
    if (!data.refresh_token) console.log('\nNo refresh token was returned. Revoke the app permission from your Google Account and run this helper again.');
    setTimeout(() => server.close(() => process.exit(0)), 500);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange failed. Check PowerShell.');
    console.error('Failed:', err.message);
    setTimeout(() => server.close(() => process.exit(1)), 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Google to redirect back to this PC...\n');
});
