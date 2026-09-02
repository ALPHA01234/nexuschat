# NexusChat

A Discord-style chat web app — black & red gaming theme — with username/password
login, profile pictures, friends-by-username, text chat, voice notes, and real
voice calling.

## Quick start (chat + voice notes only, zero setup)

Just open `index.html` in a browser. That's it. Works fully offline.

- **Register** with a username, password, and pick a profile picture (upload
  or choose a color).
- **Add a friend**: click the **+** next to "Direct Messages" and type their
  exact username. Note: that account must already exist on this device
  (registered in the same browser) — see "How accounts work" below.
- **Chat**: text messages and voice notes (mic icon in the composer) both work
  immediately, no setup needed.

## How accounts & friends actually work

This is a **frontend-only app** — there's no shared backend database. Accounts,
friends, and messages are stored in your browser's `localStorage`. That means:

- Two different **tabs in the same browser** (or two windows) share the same
  storage, so you can register "alice" in one tab and "bob" in another, add
  each other as friends, and chat between them like a live demo.
- A different **device or browser** won't see accounts created elsewhere —
  there's no central server storing accounts, by design (you asked for
  local-only storage, no backend).
- If someone clears their browser data, their account/messages disappear.

If you later want accounts shared across devices for real, that requires
adding a real backend (e.g. a small Node + database server) — happy to build
that next if you want it.

## Voice calling — two modes

Voice **notes** (recorded clips sent as messages) always work, no setup.

Real-time voice **calls** need a signaling server so two browsers can find
each other (this is a WebRTC requirement, not a NexusChat limitation):

1. `cd server && npm install && node server.js`
2. In the app, open **Settings** (gear icon in the left rail) → enter
   `ws://localhost:8080` if testing in two tabs on this same computer, or
   `ws://<your-LAN-IP>:8080` if calling a friend on another device on the
   same WiFi — see `server/README.md` for full details, including how to
   deploy it so it works over the internet.
3. Both people connect to the same signaling server URL, then click the
   phone icon on a friend's chat to call them.

## File overview

```
index.html        — app structure (login, chat UI, modals, call HUD)
style.css         — black/red gaming HUD theme
app.js            — all app logic: auth, chat, voice notes, WebRTC calling
server/server.js  — optional signaling server for cross-device calls
server/README.md  — signaling server setup details
```

## Notes on this being a demo-grade app

- Passwords are stored in plain text in `localStorage` — fine for a local
  demo with friends, not meant for production/public deployment as-is.
- No message encryption — anyone with access to the browser's storage can
  read message history.
- Built for clarity and hackability over production hardening — it's meant
  to be a real, working starting point you can extend.
