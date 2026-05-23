# BroTalk

Peer-to-peer voice chat for friends and family. Real-time audio over WebRTC using the Opus codec.

## Download

Grab the latest installer from the [Releases page](https://github.com/Barcode162/BroTalk/releases/latest) — download `BroTalk Setup x.y.z.exe`.

Windows will warn about an unrecognized app on first launch (the installer is unsigned). Click **More info → Run anyway**.

## How to talk

1. Run the installer and open BroTalk.
2. **Sign in** (or click *Continue as guest* to use the public lobby only).
3. From the home screen, either **Join lobby** (public) or enter a **room code** for a private named room.
4. Share the room code with whoever you want to talk to — they sign in and enter the same code.

Named rooms require an account so usernames are unique across users. The public lobby remains open to guests.

The app auto-updates on launch.

## Architecture

- **App** — Electron + vanilla JS + WebRTC.
- **Signaling server** — Node/Express + ws + Postgres, hosted on Render.
- **Auth** — username + password, bcrypt hashing, JWT session (30-day TTL). Stored in Postgres.
- **Audio** — never touches the server. Pure WebRTC peer-to-peer.
- **Auto-update** — `electron-updater` pulls from GitHub Releases.

## Server setup (Postgres on Render)

Since Render's free tier has no persistent disk, accounts live in an external Postgres database. **Neon** is free, fast, and works out of the box.

1. Sign up at [neon.tech](https://neon.tech) (free, GitHub login, no card).
2. Create a project — copy the **Connection string** (looks like `postgresql://user:pass@host/db`).
3. In your Render dashboard for `brotalk`, go to **Environment** and add:
   - `DATABASE_URL` = the Neon connection string
   - `JWT_SECRET` = a long random string (e.g. `openssl rand -hex 32`)
4. Trigger a redeploy. The server creates the `users` table on first boot.

Without these env vars the server still runs and the public lobby still works — but `/auth/signup` and `/auth/login` return `503`, so named rooms are unreachable.

## Local development

```bash
npm install

# Optional: set a local DATABASE_URL if you want to test auth locally.
# Otherwise auth endpoints will return 503 but the lobby works fine.
# export DATABASE_URL="postgresql://user:pass@localhost/brotalk"
# export JWT_SECRET="dev-secret"

# Terminal 1 — signaling server
npm start

# Terminal 2 — Electron app pointed at localhost
npm run dev
```

## Build the installer

```bash
npm run build           # local .exe in dist/
npm run release         # build + upload to GitHub Releases (uses GH_TOKEN)
```
