# BroTalk

**Talk to your people. Nothing else in the room.**

A simple voice chat app for Windows. No accounts needed to try it. No ads. No server listening to your calls — your voice goes straight to your friends.

---

## Download

### [➜ Get BroTalk for Windows](https://github.com/Barcode162/BroTalk/releases/latest)

Click the link, then download the file called **BroTalk-Setup-x.y.z.exe** under "Assets". Open it. You're done — BroTalk will install and open itself.

> Windows might say "Windows protected your PC" on first install (that's normal for small apps). Click **More info** → **Run anyway**.

---

## How to use it

**Just want to try it?**
Open BroTalk → tap **Join lobby**. Anyone else in the public lobby can hear you.

**Want a private room with friends?**
1. Open BroTalk → tap **menu** in the corner.
2. Make a free account (just pick a name and password).
3. Type any room code you want — or hit the **⚄ dice** to get a random one like `quiet-otter-42`.
4. Send the code to whoever you want to talk to. They open BroTalk, sign in, and type the same code. You're in the same room.

**Hold space** to push-to-talk when you're muted. **Pick a theme** in settings — there are twelve, pick whatever fits your mood.

BroTalk updates itself when you launch it. You never have to do anything.

---

## A few things worth knowing

- **It's free and always will be.** I built BroTalk because Discord got bloated and I wanted something tiny just for talking.
- **Your audio never goes through my server.** When you talk to a friend, your voice goes directly from your computer to theirs. The server just helps you find each other at the start.
- **It works on slow internet.** Reconnects automatically if your wifi blips. Works behind weird routers and phone hotspots.
- **Bring whoever you want.** Up to 6 people in a room sounds great. More than that and things get crunchy — that's just how voice chat works.

---

## Something broken? Want a feature?

Open an [issue here](https://github.com/Barcode162/BroTalk/issues) and tell me. It might be just me reading it, but I do read everything.

---

<details>
<summary>For developers (if you want to run it from source or self-host the server)</summary>

### Architecture
- **App:** Electron + vanilla JS + WebRTC (Opus codec)
- **Signaling server:** Node + Express + ws + Postgres, hosted on Render
- **Auth:** username/password, bcrypt, JWT (30-day TTL)
- **Audio:** never touches the server. Pure peer-to-peer WebRTC.
- **TURN:** Open Relay Project as free fallback for tricky NATs; bring your own if you want.
- **Auto-update:** `electron-updater` from GitHub Releases.

### Local dev
```bash
npm install

# Terminal 1 — signaling server
npm start

# Terminal 2 — Electron app pointed at localhost
npm run dev
```

### Self-hosting the signaling server (Render + Neon)
Render free dynos have no persistent disk, so accounts live in an external Postgres database. Neon is free and works out of the box.

1. Sign up at [neon.tech](https://neon.tech) (free, no card).
2. Create a project, copy the **Connection string**.
3. In your Render dashboard for `brotalk`, add env vars:
   - `DATABASE_URL` = the Neon connection string
   - `JWT_SECRET` = a long random string (e.g. `openssl rand -hex 32`) — optional; if missing, BroTalk persists one in the DB automatically
4. Redeploy. The server creates the `users` and `server_secrets` tables on first boot.

Without these vars the server still runs and the public lobby works — but signup/login return 503 and named rooms are unreachable.

### Build the installer
```bash
npm run build     # local .exe in dist/
npm run release   # build + upload draft to GitHub Releases (needs GH_TOKEN)
```

After `npm run release`, the upload is a *draft*. Promote it with:
```bash
gh release edit vX.Y.Z --repo Barcode162/BroTalk --draft=false --latest
```
Auto-updater ignores drafts, so this step is mandatory.

</details>
