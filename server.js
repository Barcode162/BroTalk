const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_PASSWORD = process.env.TURN_PASSWORD || '';
const TURN_URLS = (process.env.TURN_URLS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DATABASE_URL = process.env.DATABASE_URL || '';
let JWT_SECRET = process.env.JWT_SECRET || '';
let jwtSecretSource = JWT_SECRET ? 'env' : 'pending';

const TOKEN_TTL = '30d';
const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const RESERVED_USERNAMES = new Set(['admin', 'root', 'system', 'brotalk', 'lobby']);

const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_GRACE_MS = 60_000;
const PRESENCE_TTL_MS = 60_000;
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

let pool = null;
let dbReady = false;

async function initDb() {
  if (!DATABASE_URL) {
    console.warn('[server] DATABASE_URL not set — auth endpoints will return 503');
    if (!JWT_SECRET) {
      JWT_SECRET = crypto.randomBytes(48).toString('hex');
      jwtSecretSource = 'ephemeral';
      console.warn('[server] JWT_SECRET ephemeral — tokens reset on every restart');
    }
    return;
  }
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(24) UNIQUE NOT NULL,
        username_lower VARCHAR(24) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS server_secrets (
        key VARCHAR(48) PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    if (!JWT_SECRET) {
      const row = await pool.query(`SELECT value FROM server_secrets WHERE key = 'jwt_secret'`);
      if (row.rows[0]) {
        JWT_SECRET = row.rows[0].value;
        jwtSecretSource = 'db';
        console.log('[server] JWT_SECRET loaded from db');
      } else {
        JWT_SECRET = crypto.randomBytes(48).toString('hex');
        try {
          await pool.query(
            `INSERT INTO server_secrets (key, value) VALUES ('jwt_secret', $1) ON CONFLICT (key) DO NOTHING`,
            [JWT_SECRET]
          );
          const reread = await pool.query(`SELECT value FROM server_secrets WHERE key = 'jwt_secret'`);
          if (reread.rows[0] && reread.rows[0].value !== JWT_SECRET) {
            JWT_SECRET = reread.rows[0].value;
          }
          jwtSecretSource = 'db';
          console.log('[server] JWT_SECRET generated and persisted to db');
        } catch (err) {
          jwtSecretSource = 'ephemeral';
          console.warn('[server] failed to persist JWT_SECRET:', err.message);
        }
      }
    }
    dbReady = true;
    console.log('[server] database ready');
  } catch (err) {
    console.error('[server] db init failed:', err.message);
    if (!JWT_SECRET) {
      JWT_SECRET = crypto.randomBytes(48).toString('hex');
      jwtSecretSource = 'ephemeral';
    }
  }
}

function buildIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  // Open Relay Project — free public TURN, no signup. Closes the symmetric-NAT gap.
  servers.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
  if (TURN_URLS.length && TURN_USERNAME && TURN_PASSWORD) {
    servers.push({
      urls: TURN_URLS,
      username: TURN_USERNAME,
      credential: TURN_PASSWORD,
    });
  }
  return servers;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function validateCredentials(body) {
  const username = String(body && body.username || '').trim();
  const password = String(body && body.password || '');
  if (!USERNAME_RE.test(username)) {
    return { error: 'Username must be 3-24 chars, letters/numbers/_/- only' };
  }
  if (RESERVED_USERNAMES.has(username.toLowerCase())) {
    return { error: 'That username is reserved' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  if (password.length > 200) {
    return { error: 'Password too long' };
  }
  return { username, password };
}

const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/', (req, res) => {
  res.type('text/plain').send('BroTalk signaling server is running.');
});
app.get('/ice-servers', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ iceServers: buildIceServers() });
});
app.get('/stats', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(buildStatsPayload());
});

const presence = new Map();

function prunePresence() {
  const now = Date.now();
  for (const [id, seen] of presence) {
    if (now - seen > PRESENCE_TTL_MS) presence.delete(id);
  }
}

setInterval(prunePresence, 30_000).unref();

app.post('/presence', (req, res) => {
  const sessionId = String(req.body && req.body.sessionId || '').slice(0, 64);
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }
  presence.set(sessionId, Date.now());
  res.set('Cache-Control', 'no-store');
  res.json(buildStatsPayload());
});

function requireDb(res) {
  if (!dbReady) {
    res.status(503).json({
      error: 'Account service is offline (database not configured on the server yet). Try guest lobby for now.',
    });
    return false;
  }
  return true;
}

app.post('/auth/signup', async (req, res) => {
  if (!requireDb(res)) return;
  const v = validateCredentials(req.body);
  if (v.error) return res.status(400).json({ error: v.error });

  try {
    const hash = await bcrypt.hash(v.password, 10);
    const lower = v.username.toLowerCase();
    const result = await pool.query(
      `INSERT INTO users (username, username_lower, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username`,
      [v.username, lower, hash]
    );
    const user = result.rows[0];
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error('[server] signup failed:', err.message);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  if (!requireDb(res)) return;
  const username = String(req.body && req.body.username || '').trim();
  const password = String(req.body && req.body.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const result = await pool.query(
      `SELECT id, username, password_hash FROM users WHERE username_lower = $1`,
      [username.toLowerCase()]
    );
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'Invalid username or password' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
    pool.query(`UPDATE users SET last_seen = NOW() WHERE id = $1`, [row.id]).catch(() => {});
    const token = signToken({ id: row.id, username: row.username });
    res.json({ token, user: { id: row.id, username: row.username } });
  } catch (err) {
    console.error('[server] login failed:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/me', async (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = verifyToken(token);
  if (!claims) return res.status(401).json({ error: 'Invalid or expired token' });
  res.json({ user: { id: claims.sub, username: claims.username } });
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const rooms = new Map();
const watchers = new Set();
// sessionId -> { socket, peerId, roomCode } so a reconnect with the same sessionId
// can immediately boot the previous ghost peer instead of waiting 60s for heartbeat.
const sessionsById = new Map();

function send(socket, msg) {
  if (socket.readyState === 1) {
    try { socket.send(JSON.stringify(msg)); } catch {}
  }
}

function normalizeRoom(raw) {
  const s = String(raw || '').toLowerCase().trim().slice(0, 32);
  return s || 'lobby';
}

function buildStatsPayload() {
  prunePresence();
  let inRooms = 0;
  for (const room of rooms.values()) inRooms += room.size;
  const total = Math.max(inRooms, presence.size);
  const lobby = rooms.has('lobby') ? rooms.get('lobby').size : 0;
  return { type: 'stats', online: total, lobby, rooms: rooms.size };
}

function broadcastPeerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const ids = [...room.keys()];
  for (const [id, entry] of room.entries()) {
    const others = ids
      .filter((x) => x !== id)
      .map((i) => ({ id: i, name: room.get(i).name, authed: !!room.get(i).userId }));
    send(entry.socket, { type: 'peers', peers: others, self: id, room: roomCode });
  }
}

function broadcastStats() {
  const payload = buildStatsPayload();
  for (const room of rooms.values()) {
    for (const { socket } of room.values()) send(socket, payload);
  }
  for (const socket of watchers) send(socket, payload);
}

setInterval(broadcastStats, 10_000).unref();

wss.on('connection', (socket, req) => {
  let peerId = null;
  let roomCode = null;
  let sessionId = null;
  let watcher = false;
  let lastPong = Date.now();
  const remote = req.socket.remoteAddress;

  const hb = setInterval(() => {
    if (Date.now() - lastPong > HEARTBEAT_GRACE_MS) {
      try { socket.terminate(); } catch {}
      return;
    }
    try { socket.ping(); } catch {}
    send(socket, { type: 'ping', t: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  socket.on('pong', () => { lastPong = Date.now(); });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'pong') {
      lastPong = Date.now();
      return;
    }

    if (msg.type === 'watch') {
      if (peerId) return;
      watcher = true;
      watchers.add(socket);
      send(socket, buildStatsPayload());
      return;
    }

    if (msg.type === 'unwatch') {
      if (watcher) {
        watchers.delete(socket);
        watcher = false;
      }
      return;
    }

    if (msg.type === 'join') {
      if (peerId) return;
      if (watcher) {
        watchers.delete(socket);
        watcher = false;
      }
      const requestedRoom = normalizeRoom(msg.room);
      const claims = msg.token ? verifyToken(msg.token) : null;
      const isLobby = requestedRoom === 'lobby';

      if (!isLobby && !claims) {
        send(socket, { type: 'join-error', error: 'Sign in required to join named rooms' });
        try { socket.close(); } catch {}
        return;
      }

      let name;
      let userId = null;
      if (claims) {
        name = claims.username;
        userId = claims.sub;
      } else {
        name = String(msg.name || '').slice(0, 24).trim() || 'guest';
      }

      // Boot any previous socket for this same sessionId. Reconnects use this to
      // avoid leaving a ghost peer in the room until the 60s heartbeat times out.
      const rawSessionId = String(msg.sessionId || '').slice(0, 64);
      const candidateSessionId = SESSION_ID_RE.test(rawSessionId) ? rawSessionId : null;
      if (candidateSessionId) {
        const prev = sessionsById.get(candidateSessionId);
        if (prev && prev.socket !== socket) {
          const prevRoom = rooms.get(prev.roomCode);
          if (prevRoom && prevRoom.has(prev.peerId)) {
            prevRoom.delete(prev.peerId);
            for (const { socket: s } of prevRoom.values()) {
              send(s, { type: 'peer-left', id: prev.peerId });
            }
            if (prevRoom.size === 0) {
              rooms.delete(prev.roomCode);
            } else {
              broadcastPeerList(prev.roomCode);
            }
          }
          sessionsById.delete(candidateSessionId);
          try { prev.socket.close(); } catch {}
          console.log(`[server] evicted ghost peer ${prev.peerId.slice(0, 6)} from "${prev.roomCode}" (sessionId reconnect)`);
        }
      }

      peerId = crypto.randomUUID();
      roomCode = requestedRoom;
      sessionId = candidateSessionId;
      if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
      rooms.get(roomCode).set(peerId, { socket, name, userId });
      if (sessionId) sessionsById.set(sessionId, { socket, peerId, roomCode });
      send(socket, { type: 'welcome', id: peerId, room: roomCode, name });
      broadcastPeerList(roomCode);
      broadcastStats();
      console.log(`[server] peer ${peerId.slice(0, 6)} joined "${roomCode}" as "${name}"${userId ? ' (authed)' : ' (guest)'} from ${remote} (room size: ${rooms.get(roomCode).size})`);
      return;
    }

    if (!peerId || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
      const target = room.get(msg.to);
      if (target) send(target.socket, { ...msg, from: peerId });
    }
  });

  socket.on('close', () => {
    clearInterval(hb);
    if (watcher) watchers.delete(socket);
    if (sessionId) {
      const entry = sessionsById.get(sessionId);
      if (entry && entry.socket === socket) sessionsById.delete(sessionId);
    }
    if (!peerId || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    // Don't double-remove if this peerId was already evicted by a sessionId reconnect.
    if (!room.has(peerId) || room.get(peerId).socket !== socket) return;
    room.delete(peerId);
    console.log(`[server] peer ${peerId.slice(0, 6)} left "${roomCode}" (room size: ${room.size})`);
    if (room.size === 0) {
      rooms.delete(roomCode);
    } else {
      for (const { socket: s } of room.values()) {
        send(s, { type: 'peer-left', id: peerId });
      }
      broadcastPeerList(roomCode);
    }
    broadcastStats();
  });

  socket.on('error', (err) => {
    console.error('[server] socket error:', err.message);
  });
});

initDb().finally(() => {
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] BroTalk signaling listening on 0.0.0.0:${PORT} (jwt: ${jwtSecretSource})`);
  });
});
