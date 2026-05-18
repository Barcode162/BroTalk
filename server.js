const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const app = express();

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/', (req, res) => {
  res.type('text/plain').send('BroTalk signaling server is running.');
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const rooms = new Map();

function send(socket, msg) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg));
}

function normalizeRoom(raw) {
  const s = String(raw || '').toLowerCase().trim().slice(0, 32);
  return s || 'lobby';
}

function broadcastPeerList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const ids = [...room.keys()];
  for (const [id, entry] of room.entries()) {
    const others = ids
      .filter((x) => x !== id)
      .map((i) => ({ id: i, name: room.get(i).name }));
    send(entry.socket, { type: 'peers', peers: others, self: id, room: roomCode });
  }
}

wss.on('connection', (socket, req) => {
  let peerId = null;
  let roomCode = null;
  const remote = req.socket.remoteAddress;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      if (peerId) return;
      peerId = crypto.randomUUID();
      roomCode = normalizeRoom(msg.room);
      const name = String(msg.name || '').slice(0, 24).trim();
      if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
      rooms.get(roomCode).set(peerId, { socket, name });
      send(socket, { type: 'welcome', id: peerId, room: roomCode });
      broadcastPeerList(roomCode);
      console.log(`[server] peer ${peerId.slice(0, 6)} joined "${roomCode}" as "${name}" from ${remote} (room size: ${rooms.get(roomCode).size})`);
      return;
    }

    if (!peerId || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice') {
      const target = room.get(msg.to);
      if (target) send(target.socket, { ...msg, from: peerId });
    } else if (msg.type === 'set-name') {
      const entry = room.get(peerId);
      if (entry) {
        entry.name = String(msg.name || '').slice(0, 24).trim();
        broadcastPeerList(roomCode);
      }
    }
  });

  socket.on('close', () => {
    if (!peerId || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
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
  });

  socket.on('error', (err) => {
    console.error('[server] socket error:', err.message);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] BroTalk signaling listening on 0.0.0.0:${PORT}`);
});
