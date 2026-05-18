# BroTalk

Peer-to-peer voice chat for friends and family. Real-time audio over WebRTC using the Opus codec.

## Download

Grab the latest installer from the [Releases page](https://github.com/Barcode162/BroTalk/releases/latest) — download `BroTalk Setup x.y.z.exe`.

Windows will warn about an unrecognized app on first launch (the installer is unsigned). Click **More info → Run anyway**.

## How to talk

1. Run the installer.
2. Open BroTalk.
3. Type your name, pick a microphone, and enter a room code (or leave blank for the public lobby).
4. Click **Connect**.
5. Share the room code with whoever you want to talk to — they enter the same code and click Connect.

The app auto-updates on launch.

## Architecture

- **App** — Electron + vanilla JS + WebRTC.
- **Signaling server** — small Node/Express + ws service hosted on Render. Only exchanges WebRTC handshakes; audio never touches the server.
- **Auto-update** — `electron-updater` pulls from GitHub Releases.

## Local development

```bash
npm install
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
