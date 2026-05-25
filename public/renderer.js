/* ============================================================
 * BroTalk renderer — v0.2.6 Ashy Smoke
 * ============================================================ */

const LS_TOKEN   = 'brotalk.token';
const LS_RECENT  = 'brotalk.recentRooms';
const LS_SESSION = 'brotalk.sessionId';
const LS_THEME   = 'brotalk.theme';
const MAX_RECENT = 8;
const PRESENCE_PING_MS = 30000;
const MIN_LOADING_MS   = 1200;
const MAX_LOADING_MS   = 3500;
const ALLOWED_THEMES   = ['ashy', 'green'];
const DEFAULT_THEME    = 'ashy';

const EE_LINES = [
  "a line meant only for the ones who notice.",
  "every voice here travels peer-to-peer — no server listens.",
  "the dot is white. the rest is warm. that's the deal.",
  "you and your people. nothing else in the room.",
  "stay a while.",
];

function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(LS_SESSION);
    if (!id || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
      localStorage.setItem(LS_SESSION, id);
    }
    return id;
  } catch {
    return 'guest-' + Math.random().toString(36).slice(2, 12);
  }
}

const state = {
  auth: null,
  signaling: null,
  signalingUrl: '',
  httpBaseUrl: '',
  appVersion: '',
  localStream: null,
  peerConnections: {},
  dataChannels: {},
  incomingFiles: {},
  remoteAudios: {},
  peerNames: {},
  peerAuthed: {},
  myPeerId: null,
  myName: '',
  myRoom: '',
  pendingMode: 'auth',
  isMuted: false,
  masterVolume: 1.0,
  selectedDeviceId: '',
  availableMics: [],
  audioCtx: null,
  analyser: null,
  analyserData: null,
  meterRaf: 0,
  iceServers: null,
  currentScreen: 'loading',
  recentRooms: [],
  onlineCount: null,
  onlinePollTimer: 0,
  sessionId: '',
  theme: DEFAULT_THEME,
  loadingStart: 0,
  updateStatus: { state: 'idle' },
  loadingReady: false,
  drawerOpen: false,
  eeLineIdx: 0,
  chatOpen: false,
  chatMessages: [],
  chatBlobUrls: [],
  chatUnread: 0,
  chatComposerHasText: false,
  chatSendQueue: Promise.resolve(),
};

const CHAT_CHUNK_SIZE = 16 * 1024;
const CHAT_BUFFER_HIGH = 16 * 1024 * 1024;
const CHAT_BUFFER_LOW  = 1 * 1024 * 1024;

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
    'screen-loading', 'screen-welcome', 'screen-call', 'screen-settings', 'screen-profile', 'screen-auth',
    'loading-line', 'btn-install-update', 'install-update-label', 'btn-enter', 'enter-label',
    'btn-open-menu-corner', 'btn-settings', 'btn-profile', 'profile-avatar',
    'welcome-line', 'btn-start', 'online-status', 'online-count',
    'btn-leave', 'room-display', 'btn-copy-room',
    'self-avatar', 'self-name', 'self-role', 'mic-fill',
    'btn-mute', 'volume-slider', 'call-mic-select', 'call-error',
    'btn-back-from-settings', 'mic-select', 'btn-refresh-mics', 'about-details',
    'btn-back-from-profile', 'profile-avatar-lg', 'profile-display-name', 'profile-sub-lg', 'profile-details', 'btn-logout',
    'btn-back-from-auth', 'tab-signin', 'tab-signup', 'form-signin', 'form-signup',
    'signin-username', 'signin-password', 'signin-error',
    'signup-username', 'signup-password', 'signup-error', 'btn-guest',
    'drawer', 'drawer-close', 'drawer-scrim',
    'btn-join-lobby', 'form-join-room', 'room-input', 'room-form-error', 'named-room-desc',
    'recent-rooms', 'btn-drawer-profile', 'drawer-avatar', 'drawer-profile-name', 'drawer-profile-sub',
    'btn-drawer-settings',
    'ee-dot', 'ee-panel', 'ee-poem',
    'peers-list', 'remote-audios', 'toast',
    'btn-toggle-chat', 'chat-unread', 'chat-panel', 'btn-close-chat',
    'chat-empty', 'chat-messages', 'chat-form', 'chat-file', 'chat-input', 'btn-chat-send',
  ];
  for (const id of ids) els[camel(id)] = document.getElementById(id);
}

function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/* ── Theme ───────────────────────────────────────── */

function loadTheme() {
  try {
    const stored = localStorage.getItem(LS_THEME);
    if (stored && ALLOWED_THEMES.includes(stored)) return stored;
  } catch {}
  return DEFAULT_THEME;
}

function applyTheme(theme) {
  if (!ALLOWED_THEMES.includes(theme)) theme = DEFAULT_THEME;
  state.theme = theme;
  document.body.classList.remove('theme-ashy', 'theme-green');
  document.body.classList.add('theme-' + theme);
  try { localStorage.setItem(LS_THEME, theme); } catch {}
  for (const node of document.querySelectorAll('.theme-swatch')) {
    const active = node.dataset.theme === theme;
    node.classList.toggle('is-active', active);
    const input = node.querySelector('input[type="radio"]');
    if (input) input.checked = active;
  }
}

/* ── Screen routing ──────────────────────────────── */

function showScreen(name) {
  state.currentScreen = name;
  document.body.dataset.screen = name;
  for (const key of ['Loading', 'Welcome', 'Call', 'Settings', 'Profile', 'Auth']) {
    const el = els['screen' + key];
    if (!el) continue;
    el.dataset.active = (key.toLowerCase() === name) ? 'true' : 'false';
  }
  if (name !== 'welcome' && name !== 'loading') closeDrawer();
}

/* ── Online counter ──────────────────────────────── */

function renderOnlineCount() {
  if (!els.onlineCount) return;
  if (state.onlineCount === null) {
    els.onlineCount.textContent = '—';
    els.onlineStatus.classList.add('is-stale');
  } else {
    els.onlineCount.textContent = String(state.onlineCount);
    els.onlineStatus.classList.remove('is-stale');
  }
}

function setOnlineCount(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return;
  state.onlineCount = Math.floor(n);
  renderOnlineCount();
}

async function pingPresence() {
  if (!state.httpBaseUrl || !state.sessionId) return;
  try {
    const res = await fetch(state.httpBaseUrl + '/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId }),
      cache: 'no-store',
      keepalive: true,
    });
    if (!res.ok) {
      if (res.status === 404) return fetchOnlineCountFallback();
      throw new Error('HTTP ' + res.status);
    }
    const data = await res.json();
    setOnlineCount(data.online);
  } catch (err) {
    console.warn('[renderer] pingPresence failed:', err.message);
    fetchOnlineCountFallback();
  }
}

async function fetchOnlineCountFallback() {
  if (!state.httpBaseUrl) return;
  try {
    const res = await fetch(state.httpBaseUrl + '/stats', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setOnlineCount(data.online);
  } catch (err) {
    console.warn('[renderer] /stats fallback failed:', err.message);
  }
}

function startOnlinePolling() {
  stopOnlinePolling();
  if (!state.httpBaseUrl) return;
  pingPresence();
  state.onlinePollTimer = setInterval(pingPresence, PRESENCE_PING_MS);
}

function stopOnlinePolling() {
  if (state.onlinePollTimer) {
    clearInterval(state.onlinePollTimer);
    state.onlinePollTimer = 0;
  }
}

/* ── Loading screen ──────────────────────────────── */

function setLoadingLine(text) {
  els.loadingLine.textContent = text;
}

function applyUpdateStatus(status) {
  if (!status) return;
  state.updateStatus = { ...state.updateStatus, ...status };
  const s = state.updateStatus.state;
  if (s === 'checking') {
    setLoadingLine('looking for updates…');
  } else if (s === 'downloading') {
    const v = state.updateStatus.version || '';
    const pct = state.updateStatus.percent ? ` · ${Math.round(state.updateStatus.percent)}%` : '';
    setLoadingLine(`downloading v${v}${pct}`);
    els.btnInstallUpdate.classList.add('hidden');
    els.btnEnter.disabled = true;
    els.enterLabel.textContent = 'loading…';
  } else if (s === 'downloaded') {
    const v = state.updateStatus.version || '';
    setLoadingLine('update ready when you are.');
    els.installUpdateLabel.textContent = `Install v${v}`;
    els.btnInstallUpdate.classList.remove('hidden');
    enableEnter('Continue without updating');
  } else if (s === 'not-available') {
    setLoadingLine(`you're on the latest · v${state.appVersion || '—'}`);
    enableEnter('Enter BroTalk');
  } else if (s === 'error') {
    setLoadingLine('update check skipped.');
    enableEnter('Enter BroTalk');
  }
}

function enableEnter(label) {
  const since = performance.now() - state.loadingStart;
  const wait = Math.max(0, MIN_LOADING_MS - since);
  setTimeout(() => {
    state.loadingReady = true;
    els.btnEnter.disabled = false;
    els.enterLabel.textContent = label || 'Enter BroTalk';
  }, wait);
}

function startLoadingWatchdog() {
  setTimeout(() => {
    if (state.loadingReady) return;
    const s = state.updateStatus.state;
    if (s === 'downloading' || s === 'downloaded') return;
    enableEnter('Enter BroTalk');
  }, MAX_LOADING_MS);
}

function leaveLoading() {
  if (!state.loadingReady) return;
  showScreen('welcome');
}

/* ── Drawer ──────────────────────────────────────── */

function openDrawer() {
  state.drawerOpen = true;
  els.drawer.dataset.open = 'true';
  els.drawerScrim.dataset.open = 'true';
}
function closeDrawer() {
  state.drawerOpen = false;
  els.drawer.dataset.open = 'false';
  els.drawerScrim.dataset.open = 'false';
}
function toggleDrawer() {
  if (state.drawerOpen) closeDrawer(); else openDrawer();
}

/* ── Easter-egg ──────────────────────────────────── */

function pickEeLine() {
  state.eeLineIdx = (state.eeLineIdx + 1) % EE_LINES.length;
  els.eePoem.textContent = EE_LINES[state.eeLineIdx];
}
function toggleEe() {
  const open = els.eePanel.dataset.open === 'true';
  if (open) {
    els.eePanel.dataset.open = 'false';
  } else {
    pickEeLine();
    els.eePanel.dataset.open = 'true';
  }
}

/* ── Profile UI ──────────────────────────────────── */

function renderProfileChip() {
  const u = state.auth ? state.auth.user.username : null;
  const initial = u ? initialOf(u) : '?';
  const name = u ? u : 'Sign in';
  const sub = u ? 'view profile' : 'guest';
  if (els.profileAvatar) els.profileAvatar.textContent = initial;
  if (els.drawerAvatar) els.drawerAvatar.textContent = initial;
  if (els.drawerProfileName) els.drawerProfileName.textContent = name;
  if (els.drawerProfileSub) els.drawerProfileSub.textContent = sub;
}

function renderProfileScreen() {
  if (!state.auth) {
    showScreen('auth');
    return;
  }
  const u = state.auth.user;
  els.profileAvatarLg.textContent = initialOf(u.username);
  els.profileDisplayName.textContent = u.username;
  els.profileSubLg.textContent = 'signed in';
  els.profileDetails.innerHTML = `
    <dt>username</dt><dd>${escapeHtml(u.username)}</dd>
    <dt>user id</dt><dd>${escapeHtml(u.id)}</dd>
    <dt>session</dt><dd>active</dd>
  `;
}

function renderAboutDetails() {
  if (!els.aboutDetails) return;
  els.aboutDetails.innerHTML = `
    <dt>version</dt><dd>v${escapeHtml(state.appVersion || '—')}</dd>
    <dt>signaling</dt><dd>${escapeHtml(state.signalingUrl ? new URL(state.signalingUrl.replace(/^ws/, 'http')).host : '—')}</dd>
    <dt>session</dt><dd>${escapeHtml(state.sessionId.slice(0, 8))}…</dd>
  `;
}

function renderHomeAuthHint() {
  if (state.auth) {
    if (els.welcomeLine) els.welcomeLine.textContent = `welcome back, ${state.auth.user.username}.`;
    if (els.namedRoomDesc) els.namedRoomDesc.textContent = 'private room — pick a code, share it';
    if (els.roomInput) els.roomInput.disabled = false;
  } else {
    if (els.welcomeLine) els.welcomeLine.textContent = 'ready when you are.';
    if (els.namedRoomDesc) els.namedRoomDesc.textContent = 'sign in to use private rooms';
    if (els.roomInput) els.roomInput.disabled = true;
  }
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
    li.innerHTML = `<span class="dot"></span><span>${escapeHtml(r)}</span>`;
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
  renderHomeAuthHint();
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
    showScreen('welcome');
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
    showScreen('welcome');
  } catch (err) {
    showError(els.signupError, err.message || 'Signup failed.');
  } finally {
    btn.disabled = false;
  }
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

/* ── Mic handling ────────────────────────────────── */

function buildAudioConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    voiceIsolation: false,
    googEchoCancellation: false,
    googAutoGainControl: false,
    googNoiseSuppression: false,
    googHighpassFilter: false,
    googTypingNoiseDetection: false,
    googAudioMirroring: false,
    googNoiseReduction: false,
    googNoiseSuppression2: false,
    googEchoCancellation2: false,
    googAutoGainControl2: false,
    googDAEchoCancellation: false,
    googExperimentalEchoCancellation: false,
    googExperimentalNoiseSuppression: false,
    googExperimentalAutoGainControl: false,
    googBeamforming: false,
    channelCount: { ideal: 2 },
    sampleRate: 48000,
    sampleSize: 16,
    latency: 0,
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

/* ── Audio quality helpers ──────────────────────── */

const OPUS_MAX_BITRATE = 510000;

function enhanceOpusSdp(sdp) {
  if (!sdp) return sdp;
  const rtpmap = sdp.match(/a=rtpmap:(\d+)\s+opus\/\d+(?:\/\d+)?/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const fmtp = `a=fmtp:${pt} minptime=10;useinbandfec=1;usedtx=0;cbr=1;stereo=1;sprop-stereo=1;maxaveragebitrate=${OPUS_MAX_BITRATE};maxplaybackrate=48000;sprop-maxcapturerate=48000`;
  const fmtpRe = new RegExp(`a=fmtp:${pt}[^\\r\\n]*`);
  let out;
  if (fmtpRe.test(sdp)) {
    out = sdp.replace(fmtpRe, fmtp);
  } else {
    out = sdp.replace(rtpmap[0], rtpmap[0] + '\r\n' + fmtp);
  }
  return out;
}

async function applyHighQualityAudio(pc) {
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
  if (!sender || !sender.getParameters) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = OPUS_MAX_BITRATE;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    if ('adaptivePtime' in params.encodings[0]) {
      params.encodings[0].adaptivePtime = false;
    }
    await sender.setParameters(params);
  } catch (err) {
    console.warn('[renderer] setParameters high-quality failed:', err.message);
  }
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

  if (isInitiator) {
    const dc = pc.createDataChannel('chat', { ordered: true });
    setupDataChannel(dc, peerId);
  } else {
    pc.ondatachannel = (ev) => {
      if (ev.channel && ev.channel.label === 'chat') {
        setupDataChannel(ev.channel, peerId);
      }
    };
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) sendSignal({ type: 'ice', to: peerId, candidate: ev.candidate });
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
        offer.sdp = enhanceOpusSdp(offer.sdp);
        await pc.setLocalDescription(offer);
        await applyHighQualityAudio(pc);
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
  const dc = state.dataChannels[peerId];
  if (dc) {
    try { dc.close(); } catch {}
    delete state.dataChannels[peerId];
  }
  delete state.incomingFiles[peerId];
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

/* ── Chat (DataChannel mesh) ─────────────────────── */

function setupDataChannel(dc, peerId) {
  dc.binaryType = 'arraybuffer';
  dc.bufferedAmountLowThreshold = CHAT_BUFFER_LOW;
  state.dataChannels[peerId] = dc;

  dc.onopen = () => {
    console.log(`[renderer] chat channel open with ${peerId.slice(0, 6)}`);
  };
  dc.onclose = () => {
    if (state.dataChannels[peerId] === dc) delete state.dataChannels[peerId];
    delete state.incomingFiles[peerId];
  };
  dc.onerror = (err) => {
    console.warn(`[renderer] chat channel error with ${peerId.slice(0, 6)}:`, err);
  };
  dc.onmessage = (ev) => handleChatWireMessage(peerId, ev.data);
}

function handleChatWireMessage(peerId, data) {
  if (typeof data === 'string') {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'text') {
      receiveText(peerId, msg);
    } else if (msg.type === 'file-start') {
      receiveFileStart(peerId, msg);
    } else if (msg.type === 'file-end') {
      receiveFileEnd(peerId, msg);
    } else if (msg.type === 'file-abort') {
      delete state.incomingFiles[peerId];
    }
    return;
  }
  receiveFileChunk(peerId, data);
}

function receiveText(peerId, msg) {
  const text = String(msg.text || '').slice(0, 4000);
  if (!text) return;
  appendChatMessage({
    id: String(msg.id || crypto.randomUUID()),
    from: peerId,
    name: String(msg.name || state.peerNames[peerId] || 'peer').slice(0, 24),
    kind: 'text',
    text,
    ts: Number(msg.ts) || Date.now(),
    mine: false,
  });
}

function receiveFileStart(peerId, msg) {
  const size = Number(msg.fileSize);
  if (!Number.isFinite(size) || size < 0) return;
  state.incomingFiles[peerId] = {
    id: String(msg.id || crypto.randomUUID()),
    name: String(msg.name || state.peerNames[peerId] || 'peer').slice(0, 24),
    fileName: String(msg.fileName || 'file').slice(0, 200),
    fileSize: size,
    mime: String(msg.mime || 'application/octet-stream').slice(0, 120),
    ts: Number(msg.ts) || Date.now(),
    chunks: [],
    received: 0,
    msgRef: null,
  };

  const incoming = state.incomingFiles[peerId];
  const placeholder = {
    id: incoming.id,
    from: peerId,
    name: incoming.name,
    kind: 'file',
    fileName: incoming.fileName,
    fileSize: incoming.fileSize,
    mime: incoming.mime,
    ts: incoming.ts,
    mine: false,
    progress: 0,
    blobUrl: null,
  };
  appendChatMessage(placeholder);
  incoming.msgRef = placeholder;
}

function receiveFileChunk(peerId, buf) {
  const incoming = state.incomingFiles[peerId];
  if (!incoming) return;
  incoming.chunks.push(buf);
  incoming.received += buf.byteLength;
  if (incoming.msgRef) {
    incoming.msgRef.progress = incoming.fileSize ? incoming.received / incoming.fileSize : 0;
    updateChatProgress(incoming.msgRef);
  }
}

function receiveFileEnd(peerId, _msg) {
  const incoming = state.incomingFiles[peerId];
  if (!incoming) return;
  const blob = new Blob(incoming.chunks, { type: incoming.mime });
  const url = URL.createObjectURL(blob);
  state.chatBlobUrls.push(url);
  if (incoming.msgRef) {
    incoming.msgRef.progress = 1;
    incoming.msgRef.blobUrl = url;
    finalizeFileBubble(incoming.msgRef);
  }
  delete state.incomingFiles[peerId];
}

function getOpenChannels() {
  const open = [];
  for (const [id, dc] of Object.entries(state.dataChannels)) {
    if (dc && dc.readyState === 'open') open.push({ id, dc });
  }
  return open;
}

async function waitForBufferLow(dc) {
  if (dc.bufferedAmount <= CHAT_BUFFER_HIGH) return;
  await new Promise((resolve) => {
    const onLow = () => { dc.removeEventListener('bufferedamountlow', onLow); resolve(); };
    dc.addEventListener('bufferedamountlow', onLow);
    setTimeout(() => {
      dc.removeEventListener('bufferedamountlow', onLow);
      resolve();
    }, 5000);
  });
}

function sendChatText(text) {
  const trimmed = String(text || '').trim().slice(0, 2000);
  if (!trimmed) return;
  const channels = getOpenChannels();
  const msg = {
    type: 'text',
    id: crypto.randomUUID(),
    name: state.myName || 'you',
    text: trimmed,
    ts: Date.now(),
  };
  const wire = JSON.stringify(msg);
  let delivered = 0;
  for (const { dc } of channels) {
    try { dc.send(wire); delivered++; } catch (err) {
      console.warn('[renderer] chat send failed:', err);
    }
  }
  appendChatMessage({
    id: msg.id,
    from: state.myPeerId,
    name: msg.name,
    kind: 'text',
    text: msg.text,
    ts: msg.ts,
    mine: true,
    delivered,
    peerCount: channels.length,
  });
}

async function sendChatFile(file) {
  if (!file) return;
  const channels = getOpenChannels();
  if (channels.length === 0) {
    toast('No peers to send to yet.', 2400);
    return;
  }

  const id = crypto.randomUUID();
  const meta = {
    type: 'file-start',
    id,
    name: state.myName || 'you',
    fileName: file.name || 'file',
    fileSize: file.size,
    mime: file.type || 'application/octet-stream',
    ts: Date.now(),
  };

  const mineMsg = {
    id,
    from: state.myPeerId,
    name: meta.name,
    kind: 'file',
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    mime: meta.mime,
    ts: meta.ts,
    mine: true,
    progress: 0,
    blobUrl: URL.createObjectURL(file),
    sending: true,
  };
  state.chatBlobUrls.push(mineMsg.blobUrl);
  appendChatMessage(mineMsg);

  const metaWire = JSON.stringify(meta);
  for (const { dc } of channels) {
    try { dc.send(metaWire); } catch (err) {
      console.warn('[renderer] file-start send failed:', err);
    }
  }

  let sent = 0;
  const total = file.size;
  for (let offset = 0; offset < total; offset += CHAT_CHUNK_SIZE) {
    const slice = file.slice(offset, Math.min(offset + CHAT_CHUNK_SIZE, total));
    const buf = await slice.arrayBuffer();
    for (const { dc } of channels) {
      if (dc.readyState !== 'open') continue;
      try { dc.send(buf); } catch (err) {
        console.warn('[renderer] chunk send failed:', err);
      }
      if (dc.bufferedAmount > CHAT_BUFFER_HIGH) await waitForBufferLow(dc);
    }
    sent += buf.byteLength;
    mineMsg.progress = total ? sent / total : 1;
    updateChatProgress(mineMsg);
  }

  const endWire = JSON.stringify({ type: 'file-end', id, ts: Date.now() });
  for (const { dc } of channels) {
    if (dc.readyState !== 'open') continue;
    try { dc.send(endWire); } catch {}
  }
  mineMsg.progress = 1;
  mineMsg.sending = false;
  finalizeFileBubble(mineMsg);
}

/* ── Chat UI render ──────────────────────────────── */

function openChatPanel() {
  state.chatOpen = true;
  state.chatUnread = 0;
  els.chatPanel.dataset.open = 'true';
  els.btnToggleChat.setAttribute('aria-pressed', 'true');
  renderChatUnread();
  requestAnimationFrame(() => {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    els.chatInput.focus();
  });
}

function closeChatPanel() {
  state.chatOpen = false;
  els.chatPanel.dataset.open = 'false';
  els.btnToggleChat.setAttribute('aria-pressed', 'false');
}

function toggleChatPanel() {
  if (state.chatOpen) closeChatPanel(); else openChatPanel();
}

function renderChatUnread() {
  if (!els.chatUnread) return;
  if (state.chatUnread > 0) {
    els.chatUnread.textContent = state.chatUnread > 99 ? '99+' : String(state.chatUnread);
    els.chatUnread.classList.remove('hidden');
  } else {
    els.chatUnread.classList.add('hidden');
  }
}

function ensureChatEmptyHidden() {
  if (state.chatMessages.length > 0) {
    els.chatEmpty.classList.add('hidden');
  } else {
    els.chatEmpty.classList.remove('hidden');
  }
}

function appendChatMessage(msg) {
  state.chatMessages.push(msg);
  const li = document.createElement('li');
  li.className = 'chat-msg' + (msg.mine ? ' is-mine' : '');
  li.dataset.msgId = msg.id;

  const head = document.createElement('div');
  head.className = 'chat-msg-head';
  const who = document.createElement('span');
  who.className = 'chat-msg-name';
  who.textContent = msg.mine ? 'you' : (msg.name || 'peer');
  const when = document.createElement('span');
  when.className = 'chat-msg-time';
  when.textContent = formatChatTime(msg.ts);
  head.appendChild(who);
  head.appendChild(when);
  li.appendChild(head);

  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  if (msg.kind === 'text') {
    body.classList.add('chat-msg-body-text');
    renderLinkedText(body, msg.text);
  } else if (msg.kind === 'file') {
    renderFileBubble(body, msg);
  }
  li.appendChild(body);
  els.chatMessages.appendChild(li);

  ensureChatEmptyHidden();
  const nearBottom = els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight < 80;
  if (msg.mine || nearBottom || state.chatOpen) {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
  if (!msg.mine && !state.chatOpen) {
    state.chatUnread++;
    renderChatUnread();
  }
}

function renderLinkedText(node, text) {
  const re = /(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = m[1];
    a.textContent = m[1];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    node.appendChild(a);
    last = m.index + m[1].length;
  }
  if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
}

function renderFileBubble(body, msg) {
  body.classList.add('chat-msg-body-file');
  const card = document.createElement('div');
  card.className = 'chat-file-card';
  card.dataset.msgId = msg.id;

  const preview = document.createElement('div');
  preview.className = 'chat-file-preview';
  preview.dataset.role = 'preview';
  card.appendChild(preview);

  const info = document.createElement('div');
  info.className = 'chat-file-info';
  const fname = document.createElement('div');
  fname.className = 'chat-file-name';
  fname.textContent = msg.fileName;
  const meta = document.createElement('div');
  meta.className = 'chat-file-meta';
  meta.dataset.role = 'meta';
  meta.textContent = formatBytes(msg.fileSize);
  info.appendChild(fname);
  info.appendChild(meta);
  card.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'chat-file-actions';
  actions.dataset.role = 'actions';
  card.appendChild(actions);

  const bar = document.createElement('div');
  bar.className = 'chat-file-progress';
  bar.dataset.role = 'bar';
  const fill = document.createElement('div');
  fill.className = 'chat-file-progress-fill';
  fill.style.width = '0%';
  bar.appendChild(fill);
  card.appendChild(bar);

  body.appendChild(card);

  if (msg.blobUrl) renderFilePreview(msg);
  if (msg.progress >= 1) finalizeFileBubble(msg);
  else updateChatProgress(msg);
}

function renderFilePreview(msg) {
  const card = findCardForMessage(msg.id);
  if (!card) return;
  const preview = card.querySelector('[data-role="preview"]');
  if (!preview || preview.childElementCount > 0) return;
  if (msg.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = msg.blobUrl;
    img.alt = msg.fileName;
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(msg));
    preview.appendChild(img);
  } else if (msg.mime.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = msg.blobUrl;
    video.controls = true;
    video.preload = 'metadata';
    preview.appendChild(video);
  } else if (msg.mime.startsWith('audio/')) {
    const audio = document.createElement('audio');
    audio.src = msg.blobUrl;
    audio.controls = true;
    audio.preload = 'metadata';
    preview.appendChild(audio);
  } else {
    preview.classList.add('chat-file-preview-generic');
    preview.textContent = fileGlyph(msg.mime);
  }
}

function findCardForMessage(msgId) {
  return els.chatMessages.querySelector(`.chat-file-card[data-msg-id="${cssEscape(msgId)}"]`);
}

function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

function updateChatProgress(msg) {
  const card = findCardForMessage(msg.id);
  if (!card) return;
  const fill = card.querySelector('.chat-file-progress-fill');
  if (fill) fill.style.width = Math.min(100, Math.round((msg.progress || 0) * 100)) + '%';
  const meta = card.querySelector('[data-role="meta"]');
  if (meta) {
    const sentBytes = Math.floor((msg.progress || 0) * msg.fileSize);
    meta.textContent = `${formatBytes(sentBytes)} / ${formatBytes(msg.fileSize)}`;
  }
}

function finalizeFileBubble(msg) {
  const card = findCardForMessage(msg.id);
  if (!card) return;

  const bar = card.querySelector('[data-role="bar"]');
  if (bar) bar.remove();
  const meta = card.querySelector('[data-role="meta"]');
  if (meta) meta.textContent = formatBytes(msg.fileSize);

  if (msg.blobUrl) renderFilePreview(msg);

  const actions = card.querySelector('[data-role="actions"]');
  if (actions && msg.blobUrl && actions.childElementCount === 0) {
    const dl = document.createElement('a');
    dl.href = msg.blobUrl;
    dl.download = msg.fileName;
    dl.className = 'btn ghost btn-sm';
    dl.textContent = 'save';
    actions.appendChild(dl);
  }
}

function openLightbox(msg) {
  const existing = document.getElementById('chat-lightbox');
  if (existing) existing.remove();
  const wrap = document.createElement('div');
  wrap.id = 'chat-lightbox';
  wrap.className = 'chat-lightbox';
  const img = document.createElement('img');
  img.src = msg.blobUrl;
  img.alt = msg.fileName;
  wrap.appendChild(img);
  wrap.addEventListener('click', () => wrap.remove());
  document.body.appendChild(wrap);
}

function fileGlyph(mime) {
  if (!mime) return '⎙';
  if (mime.startsWith('text/')) return '✎';
  if (mime.includes('pdf')) return '⌘';
  if (mime.includes('zip') || mime.includes('compress')) return '◫';
  return '⎙';
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatChatTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
}

function clearChatHistory() {
  state.chatMessages = [];
  state.chatUnread = 0;
  state.incomingFiles = {};
  for (const url of state.chatBlobUrls) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  state.chatBlobUrls = [];
  if (els.chatMessages) els.chatMessages.innerHTML = '';
  if (els.chatEmpty) els.chatEmpty.classList.remove('hidden');
  renderChatUnread();
  closeChatPanel();
  const lb = document.getElementById('chat-lightbox');
  if (lb) lb.remove();
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
        <span class="peer-name">${escapeHtml(name)}${authed ? '<span class="peer-badge">verified</span>' : ''}</span>
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
    els.selfRole.textContent = state.auth ? 'you · signed in' : 'you · guest';
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
      answer.sdp = enhanceOpusSdp(answer.sdp);
      await pc.setLocalDescription(answer);
      await applyHighQualityAudio(pc);
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
    showScreen('welcome');
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
    ws.onclose = () => {};
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
  state.dataChannels = {};
  state.isMuted = false;
  setMuteButton(false);
  renderPeersList();
  clearChatHistory();
}

function setMuteButton(muted) {
  els.btnMute.querySelector('.btn-label').textContent = muted ? 'Unmute' : 'Mute';
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
  closeDrawer();
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
  els.btnEnter.addEventListener('click', leaveLoading);
  els.btnInstallUpdate.addEventListener('click', () => {
    if (window.api && window.api.installUpdate) {
      els.btnInstallUpdate.disabled = true;
      els.btnEnter.disabled = true;
      setLoadingLine('installing update…');
      window.api.installUpdate();
    }
  });

  els.btnStart.addEventListener('click', openDrawer);
  els.btnOpenMenuCorner.addEventListener('click', toggleDrawer);
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerScrim.addEventListener('click', closeDrawer);

  els.btnSettings.addEventListener('click', () => showScreen('settings'));
  els.btnDrawerSettings.addEventListener('click', () => showScreen('settings'));
  els.btnProfile.addEventListener('click', () => {
    if (state.auth) {
      renderProfileScreen();
      showScreen('profile');
    } else {
      showScreen('auth');
      switchAuthTab('signin');
    }
  });
  els.btnDrawerProfile.addEventListener('click', () => {
    if (state.auth) {
      renderProfileScreen();
      showScreen('profile');
    } else {
      showScreen('auth');
      switchAuthTab('signin');
    }
  });

  els.btnBackFromSettings.addEventListener('click', () => showScreen('welcome'));
  els.btnBackFromProfile.addEventListener('click', () => showScreen('welcome'));
  els.btnBackFromAuth.addEventListener('click', () => showScreen('welcome'));

  els.btnLogout.addEventListener('click', () => {
    setAuth(null);
    toast('Signed out');
    showScreen('welcome');
  });

  els.tabSignin.addEventListener('click', () => switchAuthTab('signin'));
  els.tabSignup.addEventListener('click', () => switchAuthTab('signup'));
  els.formSignin.addEventListener('submit', handleSignin);
  els.formSignup.addEventListener('submit', handleSignup);
  els.btnGuest.addEventListener('click', () => {
    setAuth(null);
    showScreen('welcome');
  });

  els.btnJoinLobby.addEventListener('click', joinLobby);
  els.formJoinRoom.addEventListener('submit', (ev) => {
    ev.preventDefault();
    requestJoinRoom(els.roomInput.value);
  });

  els.btnLeave.addEventListener('click', () => {
    disconnectAll();
    startOnlinePolling();
    showScreen('welcome');
    toast('Left room');
  });

  els.btnToggleChat.addEventListener('click', toggleChatPanel);
  els.btnCloseChat.addEventListener('click', closeChatPanel);
  els.chatForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = els.chatInput.value;
    sendChatText(text);
    els.chatInput.value = '';
    state.chatComposerHasText = false;
    els.btnChatSend.disabled = true;
  });
  els.chatInput.addEventListener('input', () => {
    const has = els.chatInput.value.trim().length > 0;
    state.chatComposerHasText = has;
    els.btnChatSend.disabled = !has;
  });
  els.chatFile.addEventListener('change', () => {
    const files = Array.from(els.chatFile.files || []);
    els.chatFile.value = '';
    for (const f of files) {
      state.chatSendQueue = state.chatSendQueue.then(() => sendChatFile(f)).catch((err) => {
        console.error('[renderer] sendChatFile failed:', err);
        toast('File send failed', 2400);
      });
    }
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

  for (const node of document.querySelectorAll('.theme-swatch')) {
    node.addEventListener('click', (ev) => {
      ev.preventDefault();
      const theme = node.dataset.theme;
      if (theme) applyTheme(theme);
    });
  }

  els.eeDot.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleEe();
  });
  document.addEventListener('click', (ev) => {
    if (els.eePanel.dataset.open === 'true' && !els.eePanel.contains(ev.target)) {
      els.eePanel.dataset.open = 'false';
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (els.eePanel.dataset.open === 'true') {
        els.eePanel.dataset.open = 'false';
        return;
      }
      if (state.drawerOpen) { closeDrawer(); return; }
      if (state.currentScreen === 'settings' || state.currentScreen === 'profile' || state.currentScreen === 'auth') {
        showScreen('welcome');
      }
    }
    if (ev.key === 'Enter' && state.currentScreen === 'loading' && state.loadingReady) {
      leaveLoading();
    }
  });
}

async function init() {
  bindEls();
  applyTheme(loadTheme());
  attachEvents();
  loadRecent();
  renderRecent();
  renderProfileChip();
  state.sessionId = getOrCreateSessionId();
  state.loadingStart = performance.now();

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

    if (typeof window.api.onUpdateStatus === 'function') {
      window.api.onUpdateStatus(applyUpdateStatus);
    }
    if (typeof window.api.getUpdateStatus === 'function') {
      try {
        const s = await window.api.getUpdateStatus();
        if (s) applyUpdateStatus(s);
      } catch {}
    }
  } else {
    console.warn('[renderer] window.api missing — running in browser preview mode');
    state.signalingUrl = '';
    state.httpBaseUrl = '';
    state.appVersion = 'preview';
    applyUpdateStatus({ state: 'not-available' });
  }

  renderAboutDetails();
  renderHomeAuthHint();

  startLoadingWatchdog();

  if (state.httpBaseUrl) {
    restoreSession().finally(() => {
      renderProfileChip();
      renderHomeAuthHint();
      renderAboutDetails();
    });
  }

  loadMicList();
  renderOnlineCount();
  startOnlinePolling();
}

init();
