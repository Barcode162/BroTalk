# BroTalk v0.3.3 — work log

A feature update (still 0.3.x — not a major release). Built on the desktop web
code in `public/`. Mobile (Capacitor) lives in the separate `BroTalk-Mobile` repo.

## What's new

### 1. In-call Audio Studio (the big one)
A new **Audio** button in the call header opens a side panel that processes your
**outgoing** mic in real time (Web Audio graph inserted between the mic and the
WebRTC senders, output sent to peers via `MediaStreamDestination` + `replaceTrack`):

- **Noise gate** — not just on/off: a live input meter with a draggable threshold
  line so you can see what's coming in and set the gate by eye. Threshold + release.
- **Automatic Gain Control (AGC)** — holds your voice at a target level.
- **Equalizer** — low / mid / high shelving+peaking bands, plus a low-cut.
- **Compressor** — threshold / ratio / attack / release / makeup gain.
- **Reverb** — wet/dry mix + room size (algorithmic impulse response).

All effects are **off by default** (chain is transparent, preserving the current
raw-audio quality). Settings persist to `localStorage` (`brotalk.audioSettings`)
and apply live. Reset button restores defaults.

### 2. Bigger, better-placed in-call chat (PC only)
On desktop the chat now opens as a wide column (`clamp(420px, 46vw, 620px)`) and the
low-information mic rail is compacted to 380px when chat is open — closing the big
gap so a conversation feels front-and-centre. Mobile layout is untouched (separate
stylesheet; this is a desktop-only `@media (min-width:781px)` rule).

### 3. Saved text chats
Room text chat now persists per room to `localStorage` (`brotalk.chat.<room>`, last
300 msgs) and reloads as backfill when you rejoin. Files remain peer-to-peer/ephemeral.

### 4. Direct Messages tab
New **Messages** screen (signed-in users): conversation list + threads, compose,
local history (`brotalk.dms`). Transport is an **additive relay over the signaling
WebSocket** — see server note below. Message someone by username; delivery status
shows sent / offline.

## Server (`server.js`) — additive & safe
- New WS message types: `identify` (registers username↔socket) and `dm` (relays to
  the recipient's sockets if online; replies `dm-status`). **No database, no changes
  to existing room/voice flows.** Old clients are unaffected (they never send these).
- Kill switch: set env **`DM_RELAY=0`** to disable. Default on.
- ⚠️ Render auto-deploys `main`. These changes are inert until clients that speak the
  new messages exist, so deploying ahead of the client release is safe.

## Releasing to users
Pushing `main` updates the repo and (via Render) the signaling server. The **desktop
app** only reaches users when a GitHub Release is published:
```
npm run release        # electron-builder --publish always  (needs GH_TOKEN)
```
This was NOT run automatically — cut the release when you're at the keyboard to watch it.

## Storage program (BroVault)
The new local data vault lives at `G:\BroVault` (its own README). BroTalk can persist
profiles/messages/DMs to it via `vault-client.js` when you choose to self-host the
backend. Wiring `server.js` to BroVault is the next integration step (documented, not
yet enabled, to avoid coupling the live cloud server to a localhost service).

## Verified
- `node --check` on `renderer.js` + `server.js`: clean.
- DM relay: 2-client local test — delivered / offline / unauthed all correct; existing
  join/peers/stats flow intact.
- Renderer in a browser preview: audio panel (5 sections, 13 sliders) renders + wires +
  persists; chat relayout measured (chat 588px / rail 380px at 1280w); DM flow
  (create / send / receive / persist) works; **no console errors**.
- Not testable without real hardware/peers: actual audio quality through the DSP, and
  cross-client DM delivery (needs the deployed server + two signed-in clients).
