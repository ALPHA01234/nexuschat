# NexusChat server

Production API and realtime server for NexusChat.

## Local start

```powershell
copy .env.example .env
npm install
npm start
```

At minimum configure `MONGO_URI` and `JWT_SECRET`. Configure either Gmail API or Resend for real OTP delivery.

## Email provider

`EMAIL_PROVIDER=gmail` uses Google OAuth + Gmail API over HTTPS. This is preferred for the current free Render deployment because it does not depend on SMTP ports.

`EMAIL_PROVIDER=resend` remains available if you later verify a domain in Resend.

If neither provider is configured, OTP emails are logged to the server console for development only.

## Admin

Set `ADMIN_EMAILS` to one or more comma-separated account emails. Authenticated matching users can use `/admin.html`.

## Uploads

Free/Premium per-file caps are configured with `FREE_UPLOAD_MB` and `PREMIUM_UPLOAD_MB`. Local disk uploads are not durable on every cloud host; use persistent object storage before serious production use.
