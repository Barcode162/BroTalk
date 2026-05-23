/* ============================================================
 * BroTalk renderer
 * ============================================================ */

const LS_TOKEN = 'brotalk.token';
const LS_RECENT = 'brotalk.recentRooms';
const MAX_RECENT = 8;

const state = {
  auth: null,                      // { token, user: { id, username } } | null
  signaling: null,
  signalingUrl: '',
  httpBaseUrl: '',
  appVersion: '',
  localStream: null,
  peerConnections: {},
  remoteAudios: {},
  peerNames: {},
  peerAuthed: {},
  myPeerId: null,
  myName: '',
  myRoom: '',
  pendingRoom: '',
  pendingMode: 'auth',             // 'auth' | 'lobby' | 'named'
  isMuted: false,
  masterVolume: 1.0,
  selectedDeviceId: '',
  availableMics: [],
  audioCtx: null,
  analyser: null,
  analyserData: null,
  meterRaf: 0,
  iceServers: null,
  currentScreen: 'auth',
  recentRooms: [],
  onlineCount: null,
  onlinePollTimer: 0,
};

const ONLINE_POLL_MS = 15000;

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function buildRtcConfig() {
  return {
    iceServers: state.iceServers && state.iceServers.length ? state.iceServers : DEFAULT_ICE_SERVERS,
    iceCandidatePoolSize: 4,
  };
}

const els = {};
function bindEls() {
  const ids = [
    'screen-auth', 'screen-home', 'screen-call', 'screen-profile',
    'tab-signin', 'tab-signup',
    'form-signin', 'form-signup',
    'signin-username', 'signin-password', 'signin-error',
    'signup-username', 'signup-password', 'signup-error',
    'btn-guest',
    'btn-new-room', 'btn-join-lobby',
    'form-join-room', 'room-input', 'room-form-error',
    'hero-subtitle', 'named-room-desc',
    'mic-select', 'call-mic-select', 'btn-refresh-mics',
    'topbar-title', 'topbar-meta',
    'profile-avatar', 'profile-name', 'profile-sub',
    'profile-avatar-lg', 'profile-display-name', 'profile-sub-lg', 'profile-details',
    'btn-profile', 'btn-back-home', 'btn-logout',
    'recent-rooms',
    'room-display', 'btn-copy-room', 'btn-leave',
    'self-avatar', 'self-name', 'self-role', 'mic-fill',
    'btn-mute', 'volume-slider',
    'peers-list', 'call-error', 'remote-audios',
    'toast',
    'online-pill', 'online-count',
  ];
  for (const id of ids) els[camel(id)] = document.getElementById(id);
}

function camel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initialOf(name) {
  const c = (name || '?').trim().charAt(0).toUpperCase();
  return c || '?';
}

/* ── Toast ───────────────────────────────────────── */

let toastTimer = 0;
function toast(msg, ms = 2400) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

/* ── Online counter ──────────────────────────────── */

function renderOnlineCount() {
  if (!els.onlinePill) return;
  if (state.onlineCount === null) {
    els.onlineCount.textContent = '—';
    els.onlinePill.classList.add('is-stale');
  } else {
    els.onlineCount.textContent = String(state.onlineCount);
    els.onlinePill.classList.remove('is-stale');
  }
}

function setOnlineCount(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return;
  state.onlineCount = Math.floor(n);
  renderOnlineCount();
}

async function fetchOnlineCount() {
  if (!state.httpBaseUrl) return;
  try {
    const res = await fetch(state.httpBaseUrl + '/stats', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setOnlineCount(data.online);
  } catch (err) {
    console.warn('[renderer] fetchOnlineCount failed:', err.message);
  }
}

function startOnlinePolling() {
  stopOnlinePolling();
  if (!state.httpBaseUrl) return;
  fetchOnlineCount();
  state.onlinePollTimer = setInterval(fetchOnlineCount, ONLINE_POLL_MS);
}

function stopOnlinePolling() {
  if (state.onlinePollTimer) {
    clearInterval(state.onlinePollTimer);
    state.onlinePollTimer = 0;
  }
}

/* ── Screen routing ──────────────────────────────── */

function showScreen(name) {
  state.currentScreen = name;
  for (const k of ['screenAuth', 'screenHome', 'screenCall', 'screenProfile']) {
    els[k].classList.toggle('hidden', k !== 'screen' + name.charAt(0).toUpperCase() + name.slice(1));
  }
  const titles = {
    auth: 'Welcome',
    home: 'Home',
    call: `Room · ${state.myRoom || ''}`,
    profile: 'Profile',
  };
  els.topbarTitle.textContent = titles[name] || 'BroTalk';
  updateTopbarMeta();
}

function updateTopbarMeta() {
  const v = state.appVersion ? `v${state.appVersion}` : '';
  const acct = state.auth ? `· @${state.auth.user.username}` : '· guest';
  els.topbarMeta.textContent = `${v} ${acct}`.trim();
}

/* ── Error helpers ───────────────────────────────── */

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}

/* ── Profile UI ──────────────────────────────────── */

function renderProfileChip() {
  if (state.auth) {
    const u = state.auth.user.username;
    els.profileAvatar.textContent = initialOf(u);
    els.profileName.textContent = u;
    els.profileSub.textContent = 'View profile';
  } else {
    els.profileAvatar.textContent = '?';
    els.profileName.textContent = 'Sign in';
    els.profileSub.textContent = 'Guest';
  }
}

function renderProfileScreen() {
  if (!state.auth) {
    showScreen('auth');
    return;
  }
  const u = state.auth.user;
  els.profileAvatarLg.textContent = initialOf(u.username);
  els.profileDisplayName.textContent = u.username;
  els.profileSubLg.textContent = 'Signed in';
  els.profileDetails.innerHTML = `
    <dt>Username</dt><dd>${escapeHtml(u.username)}</dd>
    <dt>User ID</dt><dd>${escapeHtml(u.id)}</dd>
    <dt>Session</dt><dd>active</dd>
  `;
}

/* ── Recent rooms ────────────────────────────────── */

function loadRecent() {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    state.recentRooms = raw ? JSON.parse(raw) : [];
  } catch {
    state.recentRooms = [];
  }
}

function saveRecent() {
  try { localStorage.setItem(LS_RECENT, JSON.stringify(state.recentRooms)); } catch {}
}

function pushRecent(room) {
  if (!room || room === 'lobby') return;
  state.recentRooms = [room, ...state.recentRooms.filter((r) => r !== room)].slice(0, MAX_RECENT);
  saveRecent();
  renderRecent();
}

function renderRecent() {
  els.recentRooms.innerHTML = '';
  for (const r of state.recentRooms) {
    const li = document.createElement('li');
    li.dataset.room = r;
    li.innerHTML = `<span class="recent-dot"></span><span>${escapeHtml(r)}</span>`;
    li.addEventListener('click', () => requestJoinRoom(r));
    els.recentRooms.appendChild(li);
  }
}

/* ── Auth ────────────────────────────────────────── */

function loadStoredAuth() {
  try {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) return null;
    return { token, user: null };
  } catch {
    return null;
  }
}

function setAuth(auth) {
  state.auth = auth;
  if (auth && auth.token) {
    try { localStorage.setItem(LS_TOKEN, auth.token); } catch {}
  } else {
    try { localStorage.removeItem(LS_TOKEN); } catch {}
  }
  renderProfileChip();
  updateTopbarMeta();
  updateHomeForAuth();
}

async function apiSignup(username, password) {
  const res = await fetch(state.httpBaseUrl + '/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Signup failed');
  return data;
}

async function apiLogin(username, password) {
  const res = await fetch(state.httpBaseUrl + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Login failed');
  return data;
}

async function apiMe(token) {
  const res = await fetch(state.httpBaseUrl + '/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Session expired');
  return res.json();
}

async function restoreSession() {
  const stored = loadStoredAuth();
  if (!stored || !stored.token) return false;
  try {
    const me = await apiMe(stored.token);
    setAuth({ token: stored.token, user: me.user });
    return true;
  } catch {
    setAuth(null);
    return false;
  }
}

/* ── Home UI ─────────────────────────────────────── */

function updateHomeForAuth() {
  if (state.auth) {
    els.heroSubtitle.textContent = `Welcome back, ${state.auth.user.username}.`;
    els.namedRoomDesc.textContent = 'Pick a code, share it with friends.';
    els.roomInput.disabled = false;
  } else {
    els.heroSubtitle.textContent = 'Hop into the public lobby — or sign in to use named rooms.';
    els.namedRoomDesc.textContent = 'Sign in to create or join a named room.';
    els.roomInput.disabled = true;
  }
}

/* ── Auth screen behaviors ───────────────────────── */

function switchAuthTab(which) {
  const isSignin = which === 'signin';
  els.tabSignin.classList.toggle('active', isSignin);
  els.tabSignup.classList.toggle('active', !isSignin);
  els.tabSignin.setAttribute('aria-selected', String(isSignin));
  els.tabSignup.setAttribute('aria-selected', String(!isSignin));
  els.formSignin.classList.toggle('hidden', !isSignin);
  els.formSignup.classList.toggle('hidden', isSignin);
  clearError(els.signinError);
  clearError(els.signupError);
}

async function handleSignin(ev) {
  ev.preventDefault();
  clearError(els.signinError);
  const username = els.signinUsername.value.trim();
  const password = els.signinPassword.value;
  if (!username || !password) {
    showError(els.signinError, 'Enter your username and password.');
    return;
  }
  const btn = els.formSignin.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await apiLogin(username, password);
    setAuth({ token: data.token, user: data.user });
    toast(`Signed in as ${data.user.username}`);
    els.signinPassword.value = '';
    showScreen('home');
  } catch (err) {
    showError(els.signinError, err.message || 'Sign-in failed.');
  } finally {
    btn.disabled = false;
  }
}

async function handleSignup(ev) {
  ev.preventDefault();
  clearError(els.signupError);
  const username = els.signupUsername.value.trim();
  const password = els.signupPassword.value;
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) {
    showError(els.signupError, 'Username must be 3–24 chars (letters/numbers/_/-).');
    return;
  }
  if (password.length < 8) {
    showError(els.signupError, 'Password must be at least 8 characters.');
    return;
  }
  const btn = els.formSignup.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await apiSignup(username, password);
    setAuth({ token: data.token, user: data.user });
    toast(`Welcome, ${data.user.username}!`);
    els.signupPassword.value = '';
    showScreen('home');
  } catch (err) {
    showError(els.signupError, err.message || 'Signup failed.');
  } finally {
    btn.disabled = false;
  }
}

/* ── Mic handling ────────────────────────────────── */

function buildAudioConstraints(deviceId) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio, video: false };
}

async function getMicStream() {
  if (state.localStream) return state.localStream;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints(state.selectedDeviceId));
    state.localStream = stream;
    loadMicList();
    return stream;
  } catch (err) {
    console.error('[renderer] getUserMedia failed:', err);
    throw new Error('Microphone access denied or unavailable: ' + err.message);
  }
}

async function loadMicList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.availableMics = devices.filter((d) => d.kind === 'audioinput');
    if (state.availableMics.length && !state.selectedDeviceId) {
      state.selectedDeviceId = state.availableMics[0].deviceId;
    }
    if (state.selectedDeviceId && !state.availableMics.find((d) => d.deviceId === state.selectedDeviceId)) {
      state.selectedDeviceId = state.availableMics[0] ? state.availableMics[0].deviceId : '';
    }
    populateMicSelects();
  } catch (err) {
    console.error('[renderer] enumerateDevices failed:', err);
  }
}

function populateMicSelects() {
  const targets = [els.micSelect, els.callMicSelect];
  for (const sel of targets) {
    if (!sel) continue;
    sel.innerHTML = '';
    if (state.availableMics.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No microphones found';
      sel.appendChild(opt);
      continue;
    }
    for (const mic of state.availableMics) {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone (${mic.deviceId.slice(0, 8)})`;
      if (mic.deviceId === state.selectedDeviceId) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

async function switchMicDevice(deviceId) {
  if (!deviceId || deviceId === state.selectedDeviceId) return;
  state.selectedDeviceId = deviceId;
  populateMicSelects();
  if (!state.localStream) return;

  let newStream;
  try {
    newStream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints(deviceId));
  } catch (err) {
    console.error('[renderer] switch mic failed:', err);
    return;
  }
  const newTrack = newStream.getAudioTracks()[0];
  newTrack.enabled = !state.isMuted;

  for (const pc of Object.values(state.peerConnections)) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
    if (sender) {
      try { await sender.replaceTrack(newTrack); } catch (err) {
        console.error('[renderer] replaceTrack failed:', err);
      }
    }
  }

  for (const t of state.localStream.getTracks()) t.stop();
  state.localStream = newStream;
  startMicMeter();
}

function startMicMeter() {
  if (!state.localStream) return;
  stopMicMeter();
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioCtx.createMediaStreamSource(state.localStream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 512;
    state.analyser.smoothingTimeConstant = 0.7;
    source.connect(state.analyser);
    state.analyserData = new Uint8Array(state.analyser.fftSize);
    const tick = () => {
      if (!state.analyser) return;
      state.analyser.getByteTimeDomainData(state.analyserData);
      let sum = 0;
      for (let i = 0; i < state.analyserData.length; i++) {
        const v = (state.analyserData[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / state.analyserData.length);
      const pct = Math.min(100, Math.round(rms * 400));
      if (els.micFill) els.micFill.style.width = (state.isMuted ? 0 : pct) + '%';
      state.meterRaf = requestAnimationFrame(tick);
    };
    state.meterRaf = requestAnimationFrame(tick);
  } catch (err) {
    console.error('[renderer] mic meter setup failed:', err);
  }
}

function stopMicMeter() {
  if (state.meterRaf) {
    cancelAnimationFrame(state.meterRaf);
    state.meterRaf = 0;
  }
  state.analyser = null;
  state.analyserData = null;
  if (state.audioCtx) {
    try { state.audioCtx.close(); } catch {}
    state.audioCtx = null;
  }
  if (els.micFill) els.micFill.style.width = '0%';
}

/* ── WebRTC / signaling ──────────────────────────── */

function sendSignal(msg) {
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) {
    state.signaling.send(JSON.stringify(msg));
  }
}

function createPeerConnection(peerId, isInitiator) {
  if (state.peerConnections[peerId]) return state.peerConnections[peerId];

  const pc = new RTCPeerConnection(buildRtcConfig());
  pc.pendingIce = [];
  state.peerConnections[peerId] = pc;

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      pc.addTrack(track, state.localStream);
    }
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      sendSignal({ type: 'ice', to: peerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    let audio = state.remoteAudios[peerId];
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.dataset.peerId = peerId;
      audio.volume = state.masterVolume;
      els.remoteAudios.appendChild(audio);
      state.remoteAudios[peerId] = audio;
    }
    audio.srcObject = ev.streams[0];
  };

  pc.onconnectionstatechange = () => {
    console.log(`[renderer] peer ${peerId.slice(0, 6)} connection state:`, pc.connectionState);
    renderPeersList();
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      cleanupPeer(peerId);
    }
  };

  if (isInitiator) {
    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', to: peerId, sdp: pc.localDescription });
      } catch (err) {
        console.error('[renderer] createOffer failed:', err);
      }
    })();
  }

  return pc;
}

async function flushPendingIce(pc) {
  if (!pc.pendingIce || pc.pendingIce.length === 0) return;
  const buffered = pc.pendingIce;
  pc.pendingIce = [];
  for (const c of buffered) {
    try { await pc.addIceCandidate(c); } catch (err) {
      console.error('[renderer] buffered ICE add failed:', err);
    }
  }
}

function cleanupPeer(peerId) {
  const pc = state.peerConnections[peerId];
  if (pc) {
    try { pc.close(); } catch {}
    delete state.peerConnections[peerId];
  }
  const audio = state.remoteAudios[peerId];
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    delete state.remoteAudios[peerId];
  }
  renderPeersList();
}

function renderPeersList() {
  els.peersList.innerHTML = '';
  for (const id of Object.keys(state.peerConnections)) {
    const li = document.createElement('li');
    const conn = state.peerConnections[id];
    const connState = conn ? conn.connectionState || 'connecting' : 'unknown';
    const name = state.peerNames[id] || '(unnamed)';
    const authed = !!state.peerAuthed[id];
    const dotClass =
      connState === 'connected' ? 'connected' :
      connState === 'failed' || connState === 'closed' ? 'failed' :
      'connecting';
    li.innerHTML = `
      <span class="peer-avatar">${escapeHtml(initialOf(name))}</span>
      <div class="peer-main">
        <span class="peer-name">${escapeHtml(name)}${authed ? '<span class="peer-badge" style="margin-left:6px">verified</span>' : ''}</span>
        <span class="peer-meta">${id.slice(0, 6)}</span>
      </div>
      <span class="peer-state"><span class="peer-state-dot ${dotClass}"></span>${escapeHtml(connState)}</span>
    `;
    els.peersList.appendChild(li);
  }
}

async function handleSignalingMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'welcome') {
    state.myPeerId = msg.id;
    state.myRoom = msg.room;
    state.myName = msg.name || state.myName;
    els.roomDisplay.textContent = msg.room;
    els.selfName.textContent = state.myName || msg.id.slice(0, 8);
    els.selfAvatar.textContent = initialOf(state.myName);
    els.selfRole.textContent = state.auth ? 'You · signed in' : 'You · guest';
    els.topbarTitle.textContent = `Room · ${msg.room}`;
    pushRecent(msg.room);
  } else if (msg.type === 'peers') {
    const incomingIds = msg.peers.map((p) => p.id);
    for (const p of msg.peers) {
      state.peerNames[p.id] = p.name || '';
      state.peerAuthed[p.id] = !!p.authed;
      if (!state.peerConnections[p.id] && p.id !== state.myPeerId) {
        const initiator = state.myPeerId && state.myPeerId < p.id;
        createPeerConnection(p.id, initiator);
      }
    }
    for (const id of Object.keys(state.peerConnections)) {
      if (!incomingIds.includes(id)) cleanupPeer(id);
    }
    for (const id of Object.keys(state.peerNames)) {
      if (!incomingIds.includes(id)) {
        delete state.peerNames[id];
        delete state.peerAuthed[id];
      }
    }
    renderPeersList();
  } else if (msg.type === 'offer') {
    const pc = createPeerConnection(msg.from, false);
    try {
      await pc.setRemoteDescription(msg.sdp);
      await flushPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: 'answer', to: msg.from, sdp: pc.localDescription });
    } catch (err) {
      console.error('[renderer] handle offer failed:', err);
    }
  } else if (msg.type === 'answer') {
    const pc = state.peerConnections[msg.from];
    if (pc) {
      try {
        await pc.setRemoteDescription(msg.sdp);
        await flushPendingIce(pc);
      } catch (err) {
        console.error('[renderer] setRemoteDescription(answer) failed:', err);
      }
    }
  } else if (msg.type === 'ice') {
    const pc = state.peerConnections[msg.from];
    if (!pc || !msg.candidate) return;
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(msg.candidate); } catch (err) {
        console.error('[renderer] addIceCandidate failed:', err);
      }
    } else {
      pc.pendingIce.push(msg.candidate);
    }
  } else if (msg.type === 'peer-left') {
    cleanupPeer(msg.id);
    delete state.peerNames[msg.id];
    delete state.peerAuthed[msg.id];
  } else if (msg.type === 'stats') {
    setOnlineCount(msg.online);
  } else if (msg.type === 'join-error') {
    showError(els.callError, msg.error || 'Failed to join');
    toast(msg.error || 'Failed to join', 3500);
    disconnectAll();
    startOnlinePolling();
    showScreen('home');
  }
}

function connectSignaling(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    state.signaling = ws;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error('Connection timed out (server may be waking up — try again in 30 seconds)'));
      }
    }, 45000);

    ws.onopen = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    ws.onerror = (ev) => {
      console.error('[renderer] websocket error:', ev);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Failed to reach signaling server'));
      }
    };
    ws.onclose = () => {
      // No-op; state.signaling becomes invalid until reconnect
    };
    ws.onmessage = (ev) => handleSignalingMessage(ev.data);
  });
}

function disconnectAll() {
  for (const id of Object.keys(state.peerConnections)) cleanupPeer(id);
  if (state.signaling) {
    try { state.signaling.close(); } catch {}
    state.signaling = null;
  }
  stopMicMeter();
  if (state.localStream) {
    for (const t of state.localStream.getTracks()) t.stop();
    state.localStream = null;
  }
  state.myPeerId = null;
  state.myRoom = '';
  state.peerNames = {};
  state.peerAuthed = {};
  state.isMuted = false;
  setMuteButton(false);
  renderPeersList();
}

function setMuteButton(muted) {
  els.btnMute.querySelector('.control-label').textContent = muted ? 'Unmute' : 'Mute';
  els.btnMute.setAttribute('aria-pressed', String(muted));
}

function setMuted(muted) {
  state.isMuted = muted;
  if (state.localStream) {
    for (const t of state.localStream.getAudioTracks()) t.enabled = !muted;
  }
  setMuteButton(muted);
}

function setVolume(value) {
  const vol = Math.max(0, Math.min(1, value / 100));
  state.masterVolume = vol;
  for (const audio of Object.values(state.remoteAudios)) audio.volume = vol;
}

async function fetchIceServers() {
  try {
    const res = await fetch(state.httpBaseUrl + '/ice-servers', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data.iceServers)) throw new Error('bad response');
    return data.iceServers;
  } catch (err) {
    console.error('[renderer] fetchIceServers failed, falling back to STUN only:', err);
    return null;
  }
}

/* ── Room join orchestration ─────────────────────── */

function requestJoinRoom(roomCode) {
  const room = (roomCode || '').toLowerCase().trim();
  clearError(els.roomFormError);
  clearError(els.callError);

  if (!room) {
    showError(els.roomFormError, 'Enter a room code.');
    return;
  }
  if (!/^[a-z0-9-_]{1,32}$/i.test(room)) {
    showError(els.roomFormError, 'Use letters, numbers, _ or - (1–32 chars).');
    return;
  }
  if (room !== 'lobby' && !state.auth) {
    showError(els.roomFormError, 'Sign in to join named rooms.');
    return;
  }
  state.pendingMode = 'named';
  doConnect(room);
}

function joinLobby() {
  state.pendingMode = 'lobby';
  doConnect('lobby');
}

async function doConnect(room) {
  if (!state.signalingUrl) {
    toast('No signaling URL configured.', 3500);
    return;
  }
  toast('Connecting…');

  try {
    await getMicStream();
    startMicMeter();
    state.iceServers = await fetchIceServers();
    await connectSignaling(state.signalingUrl);
    const join = { type: 'join', room };
    if (state.auth) {
      join.token = state.auth.token;
    } else {
      join.name = 'guest';
    }
    sendSignal(join);
    stopOnlinePolling();
    showScreen('call');
  } catch (err) {
    console.error('[renderer] connect failed:', err);
    toast(err.message || 'Connect failed', 3500);
    disconnectAll();
    startOnlinePolling();
  }
}

/* ── Wiring ──────────────────────────────────────── */

function attachEvents() {
  els.tabSignin.addEventListener('click', () => switchAuthTab('signin'));
  els.tabSignup.addEventListener('click', () => switchAuthTab('signup'));
  els.formSignin.addEventListener('submit', handleSignin);
  els.formSignup.addEventListener('submit', handleSignup);
  els.btnGuest.addEventListener('click', () => {
    setAuth(null);
    showScreen('home');
  });

  els.btnNewRoom.addEventListener('click', () => {
    if (state.currentScreen !== 'home') showScreen('home');
    els.roomInput.focus();
  });

  els.btnJoinLobby.addEventListener('click', joinLobby);

  els.formJoinRoom.addEventListener('submit', (ev) => {
    ev.preventDefault();
    requestJoinRoom(els.roomInput.value);
  });

  els.btnLeave.addEventListener('click', () => {
    disconnectAll();
    startOnlinePolling();
    showScreen('home');
    toast('Left room');
  });

  els.btnMute.addEventListener('click', () => setMuted(!state.isMuted));
  els.volumeSlider.addEventListener('input', (e) => setVolume(+e.target.value));

  els.btnCopyRoom.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.myRoom);
      toast('Room code copied');
    } catch (err) {
      console.error('[renderer] copy failed:', err);
    }
  });

  const onMicChange = (e) => switchMicDevice(e.target.value);
  els.micSelect.addEventListener('change', onMicChange);
  els.callMicSelect.addEventListener('change', onMicChange);
  els.btnRefreshMics.addEventListener('click', loadMicList);

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', loadMicList);
  }

  els.btnProfile.addEventListener('click', () => {
    if (state.auth) {
      renderProfileScreen();
      showScreen('profile');
    } else {
      showScreen('auth');
    }
  });

  els.btnBackHome.addEventListener('click', () => showScreen('home'));

  els.btnLogout.addEventListener('click', () => {
    setAuth(null);
    toast('Signed out');
    showScreen('auth');
    switchAuthTab('signin');
  });
}

async function init() {
  bindEls();
  attachEvents();
  loadRecent();
  renderRecent();
  renderProfileChip();

  const hasApi = typeof window.api === 'object' && window.api !== null;
  if (hasApi && typeof window.api.getConfig === 'function') {
    try {
      const config = await window.api.getConfig();
      state.signalingUrl = config.signalingUrl;
      state.httpBaseUrl = config.signalingUrl.replace(/^ws(s?):/, 'http$1:');
      state.appVersion = config.version || '';
      document.title = `BroTalk v${config.version}`;
    } catch (err) {
      console.error('[renderer] failed to load config:', err);
    }
  } else {
    console.warn('[renderer] window.api missing — running in browser preview mode');
    state.signalingUrl = '';
    state.httpBaseUrl = '';
    state.appVersion = 'preview';
  }

  updateTopbarMeta();

  const restored = state.httpBaseUrl ? await restoreSession() : false;
  if (restored) {
    showScreen('home');
  } else {
    showScreen('auth');
    switchAuthTab('signin');
  }

  loadMicList();
  renderOnlineCount();
  startOnlinePolling();
}

init();
