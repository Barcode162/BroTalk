/* ============================================================
 * BroTalk renderer — v0.3.0
 * Reliability refit + UX polish + 12-theme system
 * ============================================================ */

const LS_TOKEN   = 'brotalk.token';
const LS_RECENT  = 'brotalk.recentRooms';
const LS_SESSION = 'brotalk.sessionId';
const LS_THEME   = 'brotalk.theme';
const MAX_RECENT = 8;
const PRESENCE_PING_MS = 30000;
const MIN_LOADING_MS   = 1200;
const MAX_LOADING_MS   = 3500;

const ALLOWED_THEMES = [
  'ashy', 'green',
  'midnight', 'cyber', 'sakura', 'brutalist', 'velvet',
  'ocean', 'terracotta', 'vapor', 'noir', 'aurora',
];
const DEFAULT_THEME = 'ashy';
const LIGHT_THEMES = new Set(['sakura', 'terracotta', 'noir']);

const RECONNECT_BACKOFF_MS = [800, 1600, 3200, 6400, 12800, 25000];
const HEARTBEAT_CLIENT_TIMEOUT_MS = 50_000;
const ICE_RESTART_MAX_TRIES = 3;
const ICE_RESTART_DELAY_MS = 1200;

const CHAT_CHUNK_SIZE = 16 * 1024;
const CHAT_BUFFER_HIGH = 16 * 1024 * 1024;
const CHAT_BUFFER_LOW  = 1 * 1024 * 1024;
const CHAT_HISTORY_MAX = 50;
const CHAT_LOG_MAX = 300;
const LS_CHAT_PREFIX = 'brotalk.chat.';
const LS_DMS = 'brotalk.dms';
const DM_MSG_MAX = 500;
const USERNAME_DM_RE = /^[A-Za-z0-9_-]{3,24}$/;

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const EE_LINES = [
  "a line meant only for the ones who notice.",
  "every voice here travels peer-to-peer — no server listens.",
  "the dot is white. the rest is warm. that's the deal.",
  "you and your people. nothing else in the room.",
  "stay a while.",
];

const ROOM_ADJ = [
  'quiet','warm','bright','soft','wild','calm','gold','silver','velvet','misty',
  'amber','jade','rust','coral','frost','silent','crimson','azure','linen','ember',
  'plum','olive','dusty','silken','hollow','tender','noble','windy','sleepy','curious',
];
const ROOM_NOUN = [
  'otter','fox','heron','willow','meadow','harbor','lantern','cabin','river','feather',
  'comet','orchid','cedar','pebble','sparrow','marble','thistle','glacier','prairie','aurora',
  'finch','poppy','dune','grove','rune','tide','quill','beacon','satin','clover',
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
  iceRestartCount: {},
  myPeerId: null,
  myName: '',
  myRoom: '',
  intendedRoom: '',
  pendingMode: 'auth',
  isMuted: false,
  pttHeld: false,
  pttPrevMute: false,
  masterVolume: 1.0,
  selectedDeviceId: '',
  availableMics: [],
  audioCtx: null,
  analyser: null,
  analyserData: null,
  meterRaf: 0,
  audio: null,
  audioSettings: null,
  audioPanelOpen: false,
  dm: { conversations: {}, currentPeer: null },
  identitySent: false,
  iceServers: null,
  currentScreen: 'loading',
  recentRooms: [],
  onlineCount: null,
  lobbyCount: null,
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
  myChatHistory: [],
  reconnectAttempt: 0,
  reconnectTimer: 0,
  wsLastMsg: 0,
  wsHeartbeatTimer: 0,
  watching: false,
  micError: null,
  micPopoverOpen: false,
};

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
    'btn-open-menu-corner', 'btn-settings', 'btn-profile', 'profile-avatar', 'btn-signin-corner',
    'welcome-line', 'btn-start', 'online-status', 'online-count', 'lobby-count', 'lobby-count-wrap',
    'btn-leave', 'room-display', 'btn-copy-room',
    'self-avatar', 'self-name', 'self-role', 'mic-fill',
    'btn-mute', 'volume-slider', 'btn-mic-popover', 'mic-popover', 'call-mic-select', 'call-error',
    'reconnect-pill', 'reconnect-pill-text',
    'btn-back-from-settings', 'mic-select', 'btn-refresh-mics', 'about-details',
    'btn-back-from-profile', 'profile-avatar-lg', 'profile-display-name', 'profile-sub-lg', 'profile-details', 'btn-logout',
    'btn-back-from-auth', 'tab-signin', 'tab-signup', 'form-signin', 'form-signup',
    'signin-username', 'signin-password', 'signin-error',
    'signup-username', 'signup-password', 'signup-error', 'btn-guest',
    'drawer', 'drawer-close', 'drawer-scrim',
    'btn-join-lobby', 'form-join-room', 'room-input', 'btn-room-dice', 'room-form-error', 'named-room-desc',
    'recent-rooms', 'btn-drawer-profile', 'drawer-avatar', 'drawer-profile-name', 'drawer-profile-sub',
    'btn-drawer-settings',
    'ee-dot', 'ee-panel', 'ee-poem',
    'peers-list', 'remote-audios', 'toast',
    'btn-toggle-chat', 'chat-unread', 'chat-panel', 'btn-close-chat',
    'chat-empty', 'chat-messages', 'chat-form', 'chat-file', 'chat-input', 'btn-chat-send',
    'mic-denied-card', 'mic-denied-instructions', 'btn-mic-open-settings', 'btn-mic-retry',
    'theme-grid',
    'btn-toggle-audio', 'btn-close-audio', 'audio-panel', 'audio-scrim',
    'gate-enabled', 'gate-meter', 'gate-meter-fill', 'gate-threshold-line', 'gate-open-dot',
    'gate-threshold', 'gate-threshold-val', 'gate-release', 'gate-release-val',
    'agc-enabled', 'agc-target', 'agc-target-val',
    'eq-enabled', 'eq-low', 'eq-low-val', 'eq-mid', 'eq-mid-val', 'eq-high', 'eq-high-val', 'eq-lowcut',
    'comp-enabled', 'comp-threshold', 'comp-threshold-val', 'comp-ratio', 'comp-ratio-val',
    'comp-attack', 'comp-attack-val', 'comp-release', 'comp-release-val', 'comp-makeup', 'comp-makeup-val',
    'reverb-enabled', 'reverb-mix', 'reverb-mix-val', 'reverb-size', 'reverb-size-val',
    'btn-audio-reset',
    'btn-messages', 'dm-badge', 'screen-messages', 'btn-back-from-messages', 'btn-new-dm',
    'form-new-dm', 'new-dm-username', 'dm-error', 'dm-conversations', 'dm-empty',
    'dm-thread', 'btn-dm-back', 'dm-thread-name', 'dm-thread-status', 'dm-messages',
    'dm-form', 'dm-input', 'btn-dm-send',
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
  for (const t of ALLOWED_THEMES) document.body.classList.remove('theme-' + t);
  document.body.classList.add('theme-' + theme);
  document.body.classList.toggle('theme-light', LIGHT_THEMES.has(theme));
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
  for (const key of ['Loading', 'Welcome', 'Call', 'Settings', 'Profile', 'Auth', 'Messages']) {
    const el = els['screen' + key];
    if (!el) continue;
    el.dataset.active = (key.toLowerCase() === name) ? 'true' : 'false';
  }
  if (name !== 'welcome' && name !== 'loading') closeDrawer();
  closeMicPopover();
  if (name !== 'call') closeAudioPanel();
  manageWatchChannel();
}

/* ── Online counter + watch channel ──────────────── */

function renderOnlineCount() {
  if (!els.onlineCount) return;
  if (state.onlineCount === null) {
    els.onlineCount.textContent = '—';
    els.onlineStatus.classList.add('is-stale');
  } else {
    els.onlineCount.textContent = String(state.onlineCount);
    els.onlineStatus.classList.remove('is-stale');
  }
  if (els.lobbyCount && els.lobbyCountWrap) {
    if (state.lobbyCount === null || state.lobbyCount === 0) {
      els.lobbyCountWrap.classList.add('hidden');
    } else {
      els.lobbyCount.textContent = String(state.lobbyCount);
      els.lobbyCountWrap.classList.remove('hidden');
    }
  }
}

function applyStats(payload) {
  if (typeof payload.online === 'number' && payload.online >= 0) {
    state.onlineCount = Math.floor(payload.online);
  }
  if (typeof payload.lobby === 'number' && payload.lobby >= 0) {
    state.lobbyCount = Math.floor(payload.lobby);
  }
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
    applyStats(data);
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
    applyStats(data);
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

function manageWatchChannel() {
  const wantWatch = (state.currentScreen === 'welcome' || state.currentScreen === 'messages') && !state.myRoom;
  if (wantWatch && !state.watching) startWatchChannel();
  else if (!wantWatch && state.watching) stopWatchChannel();
}

function startWatchChannel() {
  if (!state.signalingUrl || state.watching) return;
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN && !state.myPeerId) {
    sendSignal({ type: 'watch' });
    state.watching = true;
    return;
  }
  if (state.signaling) return;
  // open a dedicated watch socket
  try {
    const ws = new WebSocket(state.signalingUrl);
    state.signaling = ws;
    ws.onopen = () => {
      if (state.signaling !== ws) return;
      sendSignal({ type: 'watch' });
      state.watching = true;
      state.wsLastMsg = Date.now();
      startWsHeartbeatWatchdog();
      sendIdentify();
    };
    ws.onmessage = (ev) => {
      // ignore messages from a socket we've already replaced
      if (state.signaling !== ws) return;
      handleSignalingMessage(ev.data);
    };
    ws.onclose = () => {
      // a newer socket has taken over — leave its state alone
      if (state.signaling !== ws && state.signaling !== null) return;
      if (state.signaling === ws) state.signaling = null;
      state.watching = false;
      stopWsHeartbeatWatchdog();
      if (state.currentScreen === 'welcome' && !state.myRoom) {
        scheduleReconnect();
      }
    };
    ws.onerror = () => {};
  } catch (err) {
    console.warn('[renderer] watch socket failed:', err.message);
  }
}

function stopWatchChannel() {
  if (!state.watching) return;
  sendSignal({ type: 'unwatch' });
  state.watching = false;
  if (state.signaling && !state.myPeerId) {
    try { state.signaling.close(); } catch {}
    state.signaling = null;
    stopWsHeartbeatWatchdog();
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
  const u = state.auth ? state.auth.user : null;
  const initial = u ? initialOf(u.username) : '?';
  const name = u ? u.username : 'Sign in';
  const sub = u ? 'view profile' : 'guest';

  if (els.profileAvatar) els.profileAvatar.textContent = initial;
  if (els.drawerAvatar) els.drawerAvatar.textContent = initial;
  if (els.drawerProfileName) els.drawerProfileName.textContent = name;
  if (els.drawerProfileSub) els.drawerProfileSub.textContent = sub;

  if (els.btnProfile && els.btnSigninCorner) {
    if (u) {
      els.btnProfile.classList.remove('hidden');
      els.btnSigninCorner.classList.add('hidden');
    } else {
      els.btnProfile.classList.add('hidden');
      els.btnSigninCorner.classList.remove('hidden');
    }
  }
  if (els.btnMessages) els.btnMessages.classList.toggle('hidden', !u);
}

function renderProfileScreen() {
  if (!state.auth || !state.auth.user) {
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
  if (state.auth && state.auth.user) {
    if (els.welcomeLine) els.welcomeLine.textContent = `welcome back, ${state.auth.user.username}.`;
    if (els.namedRoomDesc) els.namedRoomDesc.textContent = 'private room — pick a code, share it';
    if (els.roomInput) els.roomInput.disabled = false;
    if (els.btnRoomDice) els.btnRoomDice.disabled = false;
  } else {
    if (els.welcomeLine) els.welcomeLine.textContent = 'ready when you are.';
    if (els.namedRoomDesc) els.namedRoomDesc.textContent = 'sign in to use private rooms';
    if (els.roomInput) els.roomInput.disabled = true;
    if (els.btnRoomDice) els.btnRoomDice.disabled = true;
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

function generateRoomCode() {
  const adj = ROOM_ADJ[Math.floor(Math.random() * ROOM_ADJ.length)];
  const noun = ROOM_NOUN[Math.floor(Math.random() * ROOM_NOUN.length)];
  const num = Math.floor(Math.random() * 89) + 10;
  return `${adj}-${noun}-${num}`;
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
  if (res.status === 401) {
    const err = new Error('Session expired');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('Network error (HTTP ' + res.status + ')');
    err.network = true;
    throw err;
  }
  return res.json();
}

async function restoreSession() {
  const stored = loadStoredAuth();
  if (!stored || !stored.token) return false;
  setAuth({ token: stored.token, user: null });
  try {
    const me = await apiMe(stored.token);
    setAuth({ token: stored.token, user: me.user });
    return true;
  } catch (err) {
    if (err && err.unauthorized) {
      setAuth(null);
      return false;
    }
    // network blip — retry once, then keep the token rather than logging out
    try {
      await new Promise((r) => setTimeout(r, 1500));
      const me = await apiMe(stored.token);
      setAuth({ token: stored.token, user: me.user });
      return true;
    } catch (err2) {
      if (err2 && err2.unauthorized) {
        setAuth(null);
        return false;
      }
      console.warn('[renderer] session restore offline — keeping token:', err2.message);
      // keep token, will recheck on next user action
      return true;
    }
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

/* ── Mic handling + denial card ──────────────────── */

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

function classifyMicError(err) {
  const name = err && err.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  if (name === 'OverconstrainedError') return 'overconstrained';
  return 'unknown';
}

function showMicDeniedCard(kind) {
  state.micError = kind;
  if (!els.micDeniedCard) return;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const isMac = /Mac/i.test(platform);
  const isWin = /Win/i.test(platform);
  let title = 'Microphone access needed';
  let body = 'BroTalk uses your microphone for voice chat. Without it, no one can hear you.';
  let steps = '';
  if (kind === 'no-device') {
    title = 'No microphone found';
    body = 'BroTalk couldn\'t find an audio input device. Plug in a mic or headset, then retry.';
  } else if (kind === 'busy') {
    title = 'Microphone is in use';
    body = 'Another app is using your microphone. Close it (Discord, Zoom, OBS, browser tabs) and retry.';
  } else if (kind === 'denied') {
    if (isWin) {
      steps = '<ol><li>Open <strong>Settings → Privacy &amp; security → Microphone</strong></li><li>Turn on <em>Microphone access</em></li><li>Make sure <em>Let desktop apps access your microphone</em> is on</li><li>Come back here and tap <em>Try again</em></li></ol>';
    } else if (isMac) {
      steps = '<ol><li>Open <strong>System Settings → Privacy &amp; Security → Microphone</strong></li><li>Enable <em>BroTalk</em></li><li>Come back here and tap <em>Try again</em></li></ol>';
    } else {
      steps = '<p>Open your system settings, find Microphone permissions, and enable access for BroTalk. Then come back and tap <em>Try again</em>.</p>';
    }
  }
  els.micDeniedCard.querySelector('.mic-denied-title').textContent = title;
  els.micDeniedCard.querySelector('.mic-denied-body').textContent = body;
  els.micDeniedInstructions.innerHTML = steps;
  els.btnMicOpenSettings.classList.toggle('hidden', kind !== 'denied' || (!isWin && !isMac));
  els.micDeniedCard.classList.remove('hidden');
}

function hideMicDeniedCard() {
  state.micError = null;
  if (els.micDeniedCard) els.micDeniedCard.classList.add('hidden');
}

async function getMicStream() {
  if (state.localStream) return state.localStream;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints(state.selectedDeviceId));
    state.localStream = stream;
    hideMicDeniedCard();
    loadMicList();
    return stream;
  } catch (err) {
    console.error('[renderer] getUserMedia failed:', err);
    const kind = classifyMicError(err);
    showMicDeniedCard(kind);
    throw new Error('Microphone unavailable');
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

  // swap the raw input, rebuild the processing chain on it, then push the new
  // processed output track to every peer.
  for (const t of state.localStream.getTracks()) t.stop();
  state.localStream = newStream;
  setupAudioChain();

  const outTrack = getOutboundTrack();
  if (outTrack) {
    for (const pc of Object.values(state.peerConnections)) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      if (sender) {
        try { await sender.replaceTrack(outTrack); } catch (err) {
          console.error('[renderer] replaceTrack failed:', err);
        }
      }
    }
  }
}

/* ── Audio processing chain (DSP) ────────────────────
 * mic → low-cut/EQ → compressor → reverb (dry/wet) → noise gate → AGC → out
 * The destination's track is what we send to peers, so every effect lands on
 * outgoing audio. With all effects off the chain is transparent. */

const LS_AUDIO = 'brotalk.audioSettings';

const AUDIO_DEFAULTS = {
  gate:   { enabled: false, threshold: -50, release: 250 },
  agc:    { enabled: false, target: -18 },
  eq:     { enabled: false, low: 0, mid: 0, high: 0, lowcut: false },
  comp:   { enabled: false, threshold: -24, ratio: 3, attack: 3, release: 250, makeup: 0 },
  reverb: { enabled: false, mix: 20, size: 1.8 },
};

function loadAudioSettings() {
  const base = JSON.parse(JSON.stringify(AUDIO_DEFAULTS));
  try {
    const raw = localStorage.getItem(LS_AUDIO);
    if (raw) {
      const p = JSON.parse(raw);
      for (const k of Object.keys(base)) if (p && typeof p[k] === 'object') Object.assign(base[k], p[k]);
    }
  } catch {}
  return base;
}

function saveAudioSettings() {
  try { localStorage.setItem(LS_AUDIO, JSON.stringify(state.audioSettings)); } catch {}
}

function dbToGain(db) { return Math.pow(10, db / 20); }

function makeImpulseResponse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(Math.min(seconds, 6) * rate));
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
  }
  return ir;
}

function getOutboundStream() {
  return (state.audio && state.audio.outputStream) || state.localStream;
}
function getOutboundTrack() {
  const s = getOutboundStream();
  return s ? s.getAudioTracks()[0] : null;
}

function setupAudioChain() {
  if (!state.localStream) return;
  teardownAudioChain();
  if (!state.audioSettings) state.audioSettings = loadAudioSettings();
  let ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' }); }
  catch { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }

  const a = { ctx, gateOpen: true, agcCurrentGain: 1, meterRaf: 0 };
  try {
    a.source = ctx.createMediaStreamSource(state.localStream);

    a.lowcut = ctx.createBiquadFilter(); a.lowcut.type = 'highpass'; a.lowcut.frequency.value = 10;
    a.eqLow = ctx.createBiquadFilter(); a.eqLow.type = 'lowshelf'; a.eqLow.frequency.value = 180;
    a.eqMid = ctx.createBiquadFilter(); a.eqMid.type = 'peaking'; a.eqMid.frequency.value = 1100; a.eqMid.Q.value = 0.9;
    a.eqHigh = ctx.createBiquadFilter(); a.eqHigh.type = 'highshelf'; a.eqHigh.frequency.value = 6500;

    a.comp = ctx.createDynamicsCompressor();
    a.compMakeup = ctx.createGain();

    a.dry = ctx.createGain();
    a.wet = ctx.createGain();
    a.convolver = ctx.createConvolver();
    a.reverbSum = ctx.createGain();

    a.preGate = ctx.createGain();
    a.gateAnalyser = ctx.createAnalyser();
    a.gateAnalyser.fftSize = 1024;
    a.gateAnalyser.smoothingTimeConstant = 0.3;
    a.gateGain = ctx.createGain();
    a.agcGain = ctx.createGain();
    a.dest = ctx.createMediaStreamDestination();

    a.source.connect(a.lowcut);
    a.lowcut.connect(a.eqLow);
    a.eqLow.connect(a.eqMid);
    a.eqMid.connect(a.eqHigh);
    a.eqHigh.connect(a.comp);
    a.comp.connect(a.compMakeup);
    a.compMakeup.connect(a.dry);
    a.compMakeup.connect(a.convolver);
    a.convolver.connect(a.wet);
    a.dry.connect(a.reverbSum);
    a.wet.connect(a.reverbSum);
    a.reverbSum.connect(a.preGate);
    a.preGate.connect(a.gateAnalyser);
    a.preGate.connect(a.gateGain);
    a.gateGain.connect(a.agcGain);
    a.agcGain.connect(a.dest);

    a.convolver.buffer = makeImpulseResponse(ctx, state.audioSettings.reverb.size);
    a.outputStream = a.dest.stream;
  } catch (err) {
    console.error('[renderer] audio chain build failed:', err);
    try { ctx.close(); } catch {}
    return;
  }

  state.audio = a;
  try { ctx.resume(); } catch {}
  applyAudioSettings();
  startAudioMeters();
}

function teardownAudioChain() {
  const a = state.audio;
  if (!a) return;
  if (a.meterRaf) cancelAnimationFrame(a.meterRaf);
  try { a.source.disconnect(); } catch {}
  try { a.ctx.close(); } catch {}
  state.audio = null;
  if (els.micFill) els.micFill.style.width = '0%';
  if (els.gateMeterFill) els.gateMeterFill.style.width = '0%';
}

function applyAudioSettings() {
  const a = state.audio;
  if (!a) return;
  const s = state.audioSettings;
  const now = a.ctx.currentTime;

  const eqOn = s.eq.enabled;
  a.eqLow.gain.value = eqOn ? s.eq.low : 0;
  a.eqMid.gain.value = eqOn ? s.eq.mid : 0;
  a.eqHigh.gain.value = eqOn ? s.eq.high : 0;
  a.lowcut.frequency.value = (eqOn && s.eq.lowcut) ? 80 : 10;

  if (s.comp.enabled) {
    a.comp.threshold.value = s.comp.threshold;
    a.comp.ratio.value = s.comp.ratio;
    a.comp.knee.value = 24;
    a.comp.attack.value = Math.max(0, s.comp.attack / 1000);
    a.comp.release.value = Math.max(0.01, s.comp.release / 1000);
    a.compMakeup.gain.value = dbToGain(s.comp.makeup);
  } else {
    a.comp.threshold.value = 0;
    a.comp.ratio.value = 1;
    a.comp.knee.value = 0;
    a.comp.attack.value = 0.003;
    a.comp.release.value = 0.25;
    a.compMakeup.gain.value = 1;
  }

  const mix = s.reverb.enabled ? Math.max(0, Math.min(1, s.reverb.mix / 100)) : 0;
  a.wet.gain.value = mix * 0.9;
  a.dry.gain.value = 1 - mix * 0.55;

  if (!s.gate.enabled) { try { a.gateGain.gain.setTargetAtTime(1, now, 0.04); } catch {} a.gateOpen = true; }
  if (!s.agc.enabled) { try { a.agcGain.gain.setTargetAtTime(1, now, 0.2); } catch {} a.agcCurrentGain = 1; }
}

function regenerateReverb() {
  const a = state.audio;
  if (!a) return;
  try { a.convolver.buffer = makeImpulseResponse(a.ctx, state.audioSettings.reverb.size); } catch {}
}

function startAudioMeters() {
  const a = state.audio;
  if (!a) return;
  const buf = new Float32Array(a.gateAnalyser.fftSize);
  const tick = () => {
    if (!state.audio || state.audio !== a) return;
    a.gateAnalyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
    const pct = Math.max(0, Math.min(100, ((db + 70) / 70) * 100));
    const shown = state.isMuted ? 0 : pct;
    if (els.micFill) els.micFill.style.width = shown + '%';
    if (els.gateMeterFill) els.gateMeterFill.style.width = shown.toFixed(1) + '%';

    const s = state.audioSettings;
    const now = a.ctx.currentTime;
    if (s.gate.enabled) {
      const open = db > s.gate.threshold;
      if (open) { try { a.gateGain.gain.setTargetAtTime(1, now, 0.006); } catch {} a.gateOpen = true; }
      else { try { a.gateGain.gain.setTargetAtTime(0.0001, now, Math.max(0.02, s.gate.release / 3000)); } catch {} a.gateOpen = false; }
      if (els.gateOpenDot) els.gateOpenDot.classList.toggle('is-open', a.gateOpen && !state.isMuted);
    } else if (els.gateOpenDot) {
      els.gateOpenDot.classList.remove('is-open');
    }

    if (s.agc.enabled && !state.isMuted && rms > 8e-4) {
      const targetRms = Math.pow(10, s.agc.target / 20);
      const desired = Math.max(0.25, Math.min(6, targetRms / rms));
      a.agcCurrentGain += (desired - a.agcCurrentGain) * 0.04;
      try { a.agcGain.gain.setTargetAtTime(a.agcCurrentGain, now, 0.25); } catch {}
    }
    a.meterRaf = requestAnimationFrame(tick);
  };
  a.meterRaf = requestAnimationFrame(tick);
}

/* compatibility shims — existing call sites use these names */
function startMicMeter() { setupAudioChain(); }
function stopMicMeter() { teardownAudioChain(); }

/* ── Audio panel UI ──────────────────────────────── */

function openAudioPanel() {
  if (!els.audioPanel) return;
  state.audioPanelOpen = true;
  els.audioPanel.dataset.open = 'true';
  if (els.audioScrim) els.audioScrim.dataset.open = 'true';
  if (els.btnToggleAudio) els.btnToggleAudio.setAttribute('aria-pressed', 'true');
  syncAudioControls();
}
function closeAudioPanel() {
  if (!els.audioPanel) return;
  state.audioPanelOpen = false;
  els.audioPanel.dataset.open = 'false';
  if (els.audioScrim) els.audioScrim.dataset.open = 'false';
  if (els.btnToggleAudio) els.btnToggleAudio.setAttribute('aria-pressed', 'false');
}
function toggleAudioPanel() { if (state.audioPanelOpen) closeAudioPanel(); else openAudioPanel(); }

function updateGateThresholdLine() {
  if (!els.gateThresholdLine) return;
  const thr = state.audioSettings.gate.threshold;
  const pct = Math.max(0, Math.min(100, ((thr + 70) / 70) * 100));
  els.gateThresholdLine.style.left = pct + '%';
}

function reflectSectionStates() {
  const map = [['gate-enabled', 'gate'], ['agc-enabled', 'agc'], ['eq-enabled', 'eq'], ['comp-enabled', 'comp'], ['reverb-enabled', 'reverb']];
  for (const [id, key] of map) {
    const cb = els[camel(id)];
    if (cb) { const sec = cb.closest('.audio-section'); if (sec) sec.classList.toggle('is-on', !!state.audioSettings[key].enabled); }
  }
}

function syncAudioControls() {
  if (!state.audioSettings) return;
  const s = state.audioSettings;
  const set = (id, val) => { if (els[camel(id)]) els[camel(id)].value = val; };
  const chk = (id, val) => { if (els[camel(id)]) els[camel(id)].checked = !!val; };
  const lbl = (id, txt) => { if (els[camel(id)]) els[camel(id)].textContent = txt; };
  const sgn = (v) => (v > 0 ? '+' : '') + v;

  chk('gate-enabled', s.gate.enabled);
  set('gate-threshold', s.gate.threshold); lbl('gate-threshold-val', s.gate.threshold + ' dB');
  set('gate-release', s.gate.release); lbl('gate-release-val', s.gate.release + ' ms');
  updateGateThresholdLine();

  chk('agc-enabled', s.agc.enabled);
  set('agc-target', s.agc.target); lbl('agc-target-val', s.agc.target + ' dB');

  chk('eq-enabled', s.eq.enabled);
  set('eq-low', s.eq.low); lbl('eq-low-val', sgn(s.eq.low) + ' dB');
  set('eq-mid', s.eq.mid); lbl('eq-mid-val', sgn(s.eq.mid) + ' dB');
  set('eq-high', s.eq.high); lbl('eq-high-val', sgn(s.eq.high) + ' dB');
  chk('eq-lowcut', s.eq.lowcut);

  chk('comp-enabled', s.comp.enabled);
  set('comp-threshold', s.comp.threshold); lbl('comp-threshold-val', s.comp.threshold + ' dB');
  set('comp-ratio', s.comp.ratio); lbl('comp-ratio-val', s.comp.ratio + ':1');
  set('comp-attack', s.comp.attack); lbl('comp-attack-val', s.comp.attack + ' ms');
  set('comp-release', s.comp.release); lbl('comp-release-val', s.comp.release + ' ms');
  set('comp-makeup', s.comp.makeup); lbl('comp-makeup-val', sgn(s.comp.makeup) + ' dB');

  chk('reverb-enabled', s.reverb.enabled);
  set('reverb-mix', s.reverb.mix); lbl('reverb-mix-val', s.reverb.mix + '%');
  set('reverb-size', s.reverb.size); lbl('reverb-size-val', Number(s.reverb.size).toFixed(1) + ' s');

  reflectSectionStates();
}

function wireAudioPanel() {
  if (!els.audioPanel) return;
  if (els.btnToggleAudio) els.btnToggleAudio.addEventListener('click', toggleAudioPanel);
  if (els.btnCloseAudio) els.btnCloseAudio.addEventListener('click', closeAudioPanel);
  if (els.audioScrim) els.audioScrim.addEventListener('click', closeAudioPanel);

  const slider = (id, apply, fmt) => {
    const el = els[camel(id)];
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      apply(v);
      const valEl = els[camel(id + '-val')];
      if (valEl && fmt) valEl.textContent = fmt(v);
      saveAudioSettings();
    });
  };
  const toggle = (id, key) => {
    const el = els[camel(id)];
    if (!el) return;
    el.addEventListener('change', () => {
      state.audioSettings[key].enabled = el.checked;
      applyAudioSettings();
      reflectSectionStates();
      saveAudioSettings();
    });
  };
  const sgn = (v) => (v > 0 ? '+' : '') + v;

  toggle('gate-enabled', 'gate');
  slider('gate-threshold', (v) => { state.audioSettings.gate.threshold = v; updateGateThresholdLine(); }, (v) => v + ' dB');
  slider('gate-release', (v) => { state.audioSettings.gate.release = v; }, (v) => v + ' ms');

  toggle('agc-enabled', 'agc');
  slider('agc-target', (v) => { state.audioSettings.agc.target = v; }, (v) => v + ' dB');

  toggle('eq-enabled', 'eq');
  slider('eq-low', (v) => { state.audioSettings.eq.low = v; applyAudioSettings(); }, (v) => sgn(v) + ' dB');
  slider('eq-mid', (v) => { state.audioSettings.eq.mid = v; applyAudioSettings(); }, (v) => sgn(v) + ' dB');
  slider('eq-high', (v) => { state.audioSettings.eq.high = v; applyAudioSettings(); }, (v) => sgn(v) + ' dB');
  if (els.eqLowcut) els.eqLowcut.addEventListener('change', () => { state.audioSettings.eq.lowcut = els.eqLowcut.checked; applyAudioSettings(); saveAudioSettings(); });

  toggle('comp-enabled', 'comp');
  slider('comp-threshold', (v) => { state.audioSettings.comp.threshold = v; applyAudioSettings(); }, (v) => v + ' dB');
  slider('comp-ratio', (v) => { state.audioSettings.comp.ratio = v; applyAudioSettings(); }, (v) => v + ':1');
  slider('comp-attack', (v) => { state.audioSettings.comp.attack = v; applyAudioSettings(); }, (v) => v + ' ms');
  slider('comp-release', (v) => { state.audioSettings.comp.release = v; applyAudioSettings(); }, (v) => v + ' ms');
  slider('comp-makeup', (v) => { state.audioSettings.comp.makeup = v; applyAudioSettings(); }, (v) => sgn(v) + ' dB');

  toggle('reverb-enabled', 'reverb');
  slider('reverb-mix', (v) => { state.audioSettings.reverb.mix = v; applyAudioSettings(); }, (v) => v + '%');
  slider('reverb-size', (v) => { state.audioSettings.reverb.size = v; regenerateReverb(); }, (v) => v.toFixed(1) + ' s');

  if (els.btnAudioReset) els.btnAudioReset.addEventListener('click', () => {
    state.audioSettings = JSON.parse(JSON.stringify(AUDIO_DEFAULTS));
    saveAudioSettings();
    regenerateReverb();
    applyAudioSettings();
    syncAudioControls();
    toast('Audio reset to default');
  });
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

/* ── Direct messages ─────────────────────────────── */

function loadDms() {
  try {
    const raw = localStorage.getItem(LS_DMS);
    const obj = raw ? JSON.parse(raw) : {};
    state.dm.conversations = obj && typeof obj === 'object' ? obj : {};
  } catch { state.dm.conversations = {}; }
}

function saveDms() {
  try { localStorage.setItem(LS_DMS, JSON.stringify(state.dm.conversations)); } catch {}
}

function ensureConvo(key, name) {
  let c = state.dm.conversations[key];
  if (!c) { c = { name: name || key, unread: 0, updatedAt: 0, messages: [] }; state.dm.conversations[key] = c; }
  if (name && c.name !== name) c.name = name;
  return c;
}

function totalDmUnread() {
  let n = 0;
  for (const k in state.dm.conversations) n += state.dm.conversations[k].unread || 0;
  return n;
}

function updateMessagesBadge() {
  if (!els.dmBadge) return;
  const n = totalDmUnread();
  if (n > 0) { els.dmBadge.textContent = n > 99 ? '99+' : String(n); els.dmBadge.classList.remove('hidden'); }
  else els.dmBadge.classList.add('hidden');
}

function myUsername() {
  return (state.auth && state.auth.user && state.auth.user.username) || '';
}

function sendIdentify() {
  if (!state.auth || !state.auth.token) return;
  if (!state.signaling || state.signaling.readyState !== WebSocket.OPEN) return;
  sendSignal({ type: 'identify', token: state.auth.token });
  state.identitySent = true;
}

function receiveDm(m) {
  const key = String(m.from || '').toLowerCase();
  if (!key) return;
  const convo = ensureConvo(key, m.fromName || m.from);
  if (m.id && convo.messages.some((x) => x.id === m.id)) return;
  const msg = { id: m.id || crypto.randomUUID(), text: String(m.text || '').slice(0, 2000), ts: Number(m.ts) || Date.now(), mine: false };
  convo.messages.push(msg);
  if (convo.messages.length > DM_MSG_MAX) convo.messages.splice(0, convo.messages.length - DM_MSG_MAX);
  convo.updatedAt = msg.ts;
  const viewing = state.currentScreen === 'messages' && state.dm.currentPeer === key;
  if (!viewing) { convo.unread = (convo.unread || 0) + 1; toast(`DM from ${convo.name}`); }
  saveDms();
  updateMessagesBadge();
  if (state.currentScreen === 'messages') {
    renderConversations();
    if (viewing) { appendDmBubble(msg); markConvoRead(key); }
  }
}

function sendDm(text) {
  const key = state.dm.currentPeer;
  const trimmed = String(text || '').trim().slice(0, 2000);
  if (!key || !trimmed) return;
  const convo = ensureConvo(key);
  const msg = { id: crypto.randomUUID(), text: trimmed, ts: Date.now(), mine: true, status: 'sending' };
  convo.messages.push(msg);
  if (convo.messages.length > DM_MSG_MAX) convo.messages.splice(0, convo.messages.length - DM_MSG_MAX);
  convo.updatedAt = msg.ts;
  saveDms();
  appendDmBubble(msg);
  renderConversations();
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) {
    if (!state.identitySent) sendIdentify();
    sendSignal({ type: 'dm', to: key, toName: convo.name, id: msg.id, text: trimmed, ts: msg.ts });
  } else {
    setDmStatus(msg.id, 'offline');
  }
}

function setDmStatus(id, status) {
  for (const k in state.dm.conversations) {
    const m = state.dm.conversations[k].messages.find((x) => x.id === id);
    if (m) { m.status = status; saveDms(); break; }
  }
  const el = els.dmMessages && els.dmMessages.querySelector(`[data-dm-id="${cssEscape(id)}"] .dm-msg-status`);
  if (el) el.textContent = dmStatusLabel(status);
}

function dmStatusLabel(status) {
  return status === 'delivered' ? 'sent' : status === 'offline' ? 'offline' : status === 'unauthed' ? 'sign in to send' : '';
}

function renderConversations() {
  if (!els.dmConversations) return;
  const keys = Object.keys(state.dm.conversations)
    .sort((a, b) => (state.dm.conversations[b].updatedAt || 0) - (state.dm.conversations[a].updatedAt || 0));
  els.dmConversations.innerHTML = '';
  if (els.dmEmpty) els.dmEmpty.classList.toggle('hidden', keys.length > 0);
  for (const key of keys) {
    const c = state.dm.conversations[key];
    const last = c.messages[c.messages.length - 1];
    const li = document.createElement('li');
    li.className = 'dm-convo' + (c.unread ? ' has-unread' : '');
    li.innerHTML = `
      <span class="dm-convo-avatar">${escapeHtml(initialOf(c.name))}</span>
      <div class="dm-convo-main">
        <span class="dm-convo-name">${escapeHtml(c.name)}</span>
        <span class="dm-convo-preview">${last ? (last.mine ? 'you: ' : '') + escapeHtml(last.text.slice(0, 60)) : 'no messages yet'}</span>
      </div>
      ${c.unread ? `<span class="chat-unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}`;
    li.addEventListener('click', () => openThread(key));
    els.dmConversations.appendChild(li);
  }
}

function openThread(key) {
  const convo = ensureConvo(key);
  state.dm.currentPeer = key;
  markConvoRead(key);
  if (els.dmThread) els.dmThread.dataset.open = 'true';
  if (els.dmThreadName) els.dmThreadName.textContent = convo.name;
  if (els.dmThreadStatus) els.dmThreadStatus.textContent = '';
  renderThread(convo);
  if (els.dmInput) requestAnimationFrame(() => els.dmInput.focus());
}

function closeThread() {
  state.dm.currentPeer = null;
  if (els.dmThread) els.dmThread.dataset.open = 'false';
  renderConversations();
}

function markConvoRead(key) {
  const c = state.dm.conversations[key];
  if (c && c.unread) { c.unread = 0; saveDms(); updateMessagesBadge(); renderConversations(); }
}

function renderThread(convo) {
  if (!els.dmMessages) return;
  els.dmMessages.innerHTML = '';
  for (const m of convo.messages) appendDmBubble(m);
}

function appendDmBubble(m) {
  if (!els.dmMessages) return;
  const li = document.createElement('li');
  li.className = 'chat-msg dm-msg' + (m.mine ? ' is-mine' : '');
  li.dataset.dmId = m.id;

  const head = document.createElement('div');
  head.className = 'chat-msg-head';
  const who = document.createElement('span');
  who.className = 'chat-msg-name';
  const convo = state.dm.currentPeer ? state.dm.conversations[state.dm.currentPeer] : null;
  who.textContent = m.mine ? 'you' : (convo ? convo.name : 'them');
  const when = document.createElement('span');
  when.className = 'chat-msg-time';
  when.textContent = formatChatTime(m.ts);
  head.appendChild(who);
  head.appendChild(when);
  li.appendChild(head);

  const body = document.createElement('div');
  body.className = 'chat-msg-body chat-msg-body-text';
  renderLinkedText(body, m.text);
  li.appendChild(body);

  if (m.mine) {
    const st = document.createElement('span');
    st.className = 'dm-msg-status';
    st.textContent = dmStatusLabel(m.status);
    li.appendChild(st);
  }
  els.dmMessages.appendChild(li);
  els.dmMessages.scrollTop = els.dmMessages.scrollHeight;
}

function openMessagesScreen() {
  if (!state.auth || !state.auth.user) { showScreen('auth'); switchAuthTab('signin'); return; }
  loadDms();
  state.dm.currentPeer = null;
  if (els.dmThread) els.dmThread.dataset.open = 'false';
  if (els.formNewDm) els.formNewDm.classList.add('hidden');
  renderConversations();
  showScreen('messages');
  manageWatchChannel();
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) sendIdentify();
}

function startNewDm() {
  const raw = (els.newDmUsername.value || '').trim();
  clearError(els.dmError);
  if (!USERNAME_DM_RE.test(raw)) { showError(els.dmError, 'Enter a valid username (3–24 chars, letters/numbers/_/-).'); return; }
  if (raw.toLowerCase() === myUsername().toLowerCase()) { showError(els.dmError, "You can't message yourself."); return; }
  const key = raw.toLowerCase();
  ensureConvo(key, raw);
  saveDms();
  els.newDmUsername.value = '';
  els.formNewDm.classList.add('hidden');
  renderConversations();
  openThread(key);
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
  state.iceRestartCount[peerId] = 0;

  const outStream = getOutboundStream();
  if (outStream) {
    for (const track of outStream.getAudioTracks()) {
      pc.addTrack(track, outStream);
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
    if (pc.connectionState === 'failed') {
      attemptIceRestart(peerId);
    } else if (pc.connectionState === 'closed') {
      cleanupPeer(peerId);
    } else if (pc.connectionState === 'connected') {
      state.iceRestartCount[peerId] = 0;
    }
  };

  if (isInitiator) {
    sendOfferTo(pc, peerId, /*restart*/ false);
  }

  return pc;
}

async function sendOfferTo(pc, peerId, restart) {
  try {
    const offer = await pc.createOffer(restart ? { iceRestart: true } : undefined);
    offer.sdp = enhanceOpusSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    await applyHighQualityAudio(pc);
    sendSignal({ type: 'offer', to: peerId, sdp: pc.localDescription });
  } catch (err) {
    console.error('[renderer] sendOffer failed:', err);
  }
}

async function attemptIceRestart(peerId) {
  const pc = state.peerConnections[peerId];
  if (!pc) return;
  const tries = state.iceRestartCount[peerId] || 0;
  if (tries >= ICE_RESTART_MAX_TRIES) {
    console.warn(`[renderer] giving up on peer ${peerId.slice(0, 6)} after ${tries} ICE restart attempts`);
    cleanupPeer(peerId);
    return;
  }
  state.iceRestartCount[peerId] = tries + 1;
  console.log(`[renderer] ICE restart attempt ${tries + 1} for peer ${peerId.slice(0, 6)}`);
  await new Promise((r) => setTimeout(r, ICE_RESTART_DELAY_MS));
  if (pc.connectionState === 'closed') return;
  await sendOfferTo(pc, peerId, true);
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
  delete state.iceRestartCount[peerId];
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
    sendMyChatHistory(dc);
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

function sendMyChatHistory(dc) {
  if (state.myChatHistory.length === 0) return;
  try {
    dc.send(JSON.stringify({ type: 'history', messages: state.myChatHistory }));
  } catch (err) {
    console.warn('[renderer] history send failed:', err);
  }
}

function recordMyMessage(msg) {
  if (msg.kind !== 'text') return; // files can't be replayed (data not retained)
  state.myChatHistory.push({
    type: 'text',
    id: msg.id,
    name: msg.name,
    text: msg.text,
    ts: msg.ts,
  });
  if (state.myChatHistory.length > CHAT_HISTORY_MAX) {
    state.myChatHistory.splice(0, state.myChatHistory.length - CHAT_HISTORY_MAX);
  }
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
    } else if (msg.type === 'history') {
      if (Array.isArray(msg.messages)) {
        for (const m of msg.messages) {
          if (m && m.type === 'text') receiveText(peerId, m, /*backfill*/ true);
        }
      }
    }
    return;
  }
  receiveFileChunk(peerId, data);
}

function receiveText(peerId, msg, backfill) {
  const text = String(msg.text || '').slice(0, 4000);
  if (!text) return;
  const id = String(msg.id || crypto.randomUUID());
  if (state.chatMessages.some((m) => m.id === id)) return;
  appendChatMessage({
    id,
    from: peerId,
    name: String(msg.name || state.peerNames[peerId] || 'peer').slice(0, 24),
    kind: 'text',
    text,
    ts: Number(msg.ts) || Date.now(),
    mine: false,
    backfill: !!backfill,
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
  const mine = {
    id: msg.id,
    from: state.myPeerId,
    name: msg.name,
    kind: 'text',
    text: msg.text,
    ts: msg.ts,
    mine: true,
    delivered,
    peerCount: channels.length,
  };
  appendChatMessage(mine);
  recordMyMessage(mine);
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

/* ── Saved chat (persist text per room) ──────────── */

function chatLogKey(room) { return LS_CHAT_PREFIX + (room || 'lobby'); }

function persistChatText(msg) {
  const room = state.myRoom || state.intendedRoom;
  if (!room) return;
  try {
    const key = chatLogKey(room);
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if (arr.some((m) => m.id === msg.id)) return;
    arr.push({ id: msg.id, name: msg.name, text: msg.text, ts: msg.ts, mine: !!msg.mine });
    if (arr.length > CHAT_LOG_MAX) arr.splice(0, arr.length - CHAT_LOG_MAX);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

function loadSavedChat(room) {
  let arr;
  try { arr = JSON.parse(localStorage.getItem(chatLogKey(room)) || '[]'); } catch { arr = []; }
  if (!arr.length) return;
  for (const m of arr) {
    appendChatMessage({
      id: m.id, from: m.mine ? state.myPeerId : 'saved',
      name: m.name, kind: 'text', text: m.text, ts: m.ts,
      mine: !!m.mine, backfill: true, restored: true,
    });
  }
}

function clearSavedChat(room) {
  try { localStorage.removeItem(chatLogKey(room)); } catch {}
}

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
  if (msg.id && state.chatMessages.some((m) => m.id === msg.id)) return;
  state.chatMessages.push(msg);
  if (msg.kind === 'text' && !msg.restored) persistChatText(msg);
  const li = document.createElement('li');
  li.className = 'chat-msg' + (msg.mine ? ' is-mine' : '') + (msg.backfill ? ' is-backfill' : '');
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

  // backfill messages get inserted in timestamp order; live messages append at end
  if (msg.backfill) {
    let inserted = false;
    const existing = els.chatMessages.children;
    for (let i = 0; i < existing.length; i++) {
      const otherMsg = state.chatMessages.find((m) => m.id === existing[i].dataset.msgId);
      if (otherMsg && otherMsg.ts > msg.ts) {
        els.chatMessages.insertBefore(li, existing[i]);
        inserted = true;
        break;
      }
    }
    if (!inserted) els.chatMessages.appendChild(li);
  } else {
    els.chatMessages.appendChild(li);
  }

  ensureChatEmptyHidden();
  const nearBottom = els.chatMessages.scrollHeight - els.chatMessages.scrollTop - els.chatMessages.clientHeight < 80;
  if (msg.mine || nearBottom || state.chatOpen) {
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
  if (!msg.mine && !state.chatOpen && !msg.backfill) {
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
  state.myChatHistory = [];
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
  state.wsLastMsg = Date.now();
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'ping') {
    sendSignal({ type: 'pong', t: msg.t });
    return;
  }

  if (msg.type === 'welcome') {
    state.myPeerId = msg.id;
    state.myRoom = msg.room;
    state.myName = msg.name || state.myName;
    state.reconnectAttempt = 0;
    els.roomDisplay.textContent = msg.room;
    els.selfName.textContent = state.myName || msg.id.slice(0, 8);
    els.selfAvatar.textContent = initialOf(state.myName);
    els.selfRole.textContent = state.auth && state.auth.user ? 'you · signed in' : 'you · guest';
    pushRecent(msg.room);
    hideReconnectPill();
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
    applyStats(msg);
  } else if (msg.type === 'dm') {
    receiveDm(msg);
  } else if (msg.type === 'dm-status') {
    setDmStatus(msg.id, msg.status);
  } else if (msg.type === 'identified') {
    state.identitySent = true;
  } else if (msg.type === 'join-error') {
    showError(els.callError, msg.error || 'Failed to join');
    toast(msg.error || 'Failed to join', 3500);
    leaveCallToWelcome();
  }
}

/* ── WS lifecycle + reconnect ────────────────────── */

function connectSignaling(url) {
  return new Promise((resolve, reject) => {
    // Defensively close any leftover socket (watch or otherwise) so its lingering
    // onclose handler can't null out the new state.signaling we're about to set.
    if (state.signaling) {
      const old = state.signaling;
      state.signaling = null;
      try { old.close(); } catch {}
    }
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
      if (state.signaling !== ws) return;
      settled = true;
      clearTimeout(timeout);
      state.wsLastMsg = Date.now();
      startWsHeartbeatWatchdog();
      sendIdentify();
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
      // a newer socket has taken over — don't touch its state
      if (state.signaling !== ws && state.signaling !== null) return;
      if (state.signaling === ws) state.signaling = null;
      stopWsHeartbeatWatchdog();
      if (state.intendedRoom) {
        showReconnectPill('reconnecting…');
        scheduleReconnect();
      } else if (state.currentScreen === 'welcome') {
        scheduleReconnect();
      }
    };
    ws.onmessage = (ev) => {
      // drop messages from a socket we've already replaced
      if (state.signaling !== ws) return;
      handleSignalingMessage(ev.data);
    };
  });
}

function startWsHeartbeatWatchdog() {
  stopWsHeartbeatWatchdog();
  state.wsHeartbeatTimer = setInterval(() => {
    if (!state.signaling || state.signaling.readyState !== WebSocket.OPEN) {
      stopWsHeartbeatWatchdog();
      return;
    }
    if (Date.now() - state.wsLastMsg > HEARTBEAT_CLIENT_TIMEOUT_MS) {
      console.warn('[renderer] heartbeat silent — forcing reconnect');
      try { state.signaling.close(); } catch {}
    }
  }, 10_000);
}

function stopWsHeartbeatWatchdog() {
  if (state.wsHeartbeatTimer) {
    clearInterval(state.wsHeartbeatTimer);
    state.wsHeartbeatTimer = 0;
  }
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  // already connected? skip — this lets stale onclose handlers from a previous
  // socket fire scheduleReconnect harmlessly without reopening anything.
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) return;
  const attempt = state.reconnectAttempt;
  const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
  state.reconnectAttempt = attempt + 1;
  console.log(`[renderer] reconnect scheduled in ${delay}ms (attempt ${attempt + 1})`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = 0;
    doReconnect();
  }, delay);
}

async function doReconnect() {
  // double-check at fire time
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) return;
  if (state.intendedRoom) {
    // mid-call reconnect: re-establish signaling + rejoin
    try {
      // tear down existing peer connections; they will be re-negotiated after rejoin
      for (const id of Object.keys(state.peerConnections)) cleanupPeer(id);
      await connectSignaling(state.signalingUrl);
      const join = { type: 'join', room: state.intendedRoom, sessionId: state.sessionId };
      if (state.auth && state.auth.token) join.token = state.auth.token;
      else join.name = 'guest';
      sendSignal(join);
      hideReconnectPill();
    } catch (err) {
      console.warn('[renderer] reconnect failed:', err.message);
      showReconnectPill('reconnecting…');
      scheduleReconnect();
    }
  } else if (state.currentScreen === 'welcome' && state.signalingUrl) {
    // welcome-screen watch reconnect
    startWatchChannel();
  }
}

function showReconnectPill(text) {
  if (!els.reconnectPill) return;
  els.reconnectPillText.textContent = text || 'reconnecting…';
  els.reconnectPill.classList.remove('hidden');
}

function hideReconnectPill() {
  if (!els.reconnectPill) return;
  els.reconnectPill.classList.add('hidden');
}

function leaveCallToWelcome() {
  state.intendedRoom = '';
  disconnectAll();
  startOnlinePolling();
  showScreen('welcome');
}

function disconnectAll() {
  for (const id of Object.keys(state.peerConnections)) cleanupPeer(id);
  if (state.signaling) {
    try { state.signaling.close(); } catch {}
    state.signaling = null;
  }
  stopWsHeartbeatWatchdog();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
  }
  state.reconnectAttempt = 0;
  state.watching = false;
  hideReconnectPill();
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
  state.iceRestartCount = {};
  state.isMuted = false;
  state.pttHeld = false;
  setMuteButton(false);
  renderPeersList();
  clearChatHistory();
}

function setMuteButton(muted) {
  els.btnMute.querySelector('.btn-label').textContent = muted ? 'Unmute' : 'Mute';
  els.btnMute.setAttribute('aria-pressed', String(muted));
  els.btnMute.classList.toggle('is-muted', muted);
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

/* ── Mic popover ─────────────────────────────────── */

function openMicPopover() {
  if (!els.micPopover) return;
  state.micPopoverOpen = true;
  els.micPopover.dataset.open = 'true';
  els.btnMicPopover.setAttribute('aria-expanded', 'true');
}

function closeMicPopover() {
  if (!els.micPopover) return;
  state.micPopoverOpen = false;
  els.micPopover.dataset.open = 'false';
  els.btnMicPopover.setAttribute('aria-expanded', 'false');
}

function toggleMicPopover() {
  if (state.micPopoverOpen) closeMicPopover(); else openMicPopover();
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
  if (room !== 'lobby' && (!state.auth || !state.auth.user)) {
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
  stopOnlinePolling();
  state.intendedRoom = room;
  toast('Connecting…');

  // close any existing watch socket
  if (state.signaling) {
    try { state.signaling.close(); } catch {}
    state.signaling = null;
    state.watching = false;
  }

  try {
    await getMicStream();
    startMicMeter();
    state.iceServers = await fetchIceServers();
    await connectSignaling(state.signalingUrl);
    const join = { type: 'join', room, sessionId: state.sessionId };
    if (state.auth && state.auth.token) {
      join.token = state.auth.token;
    } else {
      join.name = 'guest';
    }
    sendSignal(join);
    showScreen('call');
    loadSavedChat(room);
  } catch (err) {
    console.error('[renderer] connect failed:', err);
    state.intendedRoom = '';
    if (err.message !== 'Microphone unavailable') {
      toast(err.message || 'Connect failed', 3500);
    }
    disconnectAll();
    startOnlinePolling();
  }
}

/* ── Wiring ──────────────────────────────────────── */

function attachEvents() {
  wireAudioPanel();
  els.btnEnter.addEventListener('click', leaveLoading);
  els.btnInstallUpdate.addEventListener('click', () => {
    if (window.api && window.api.installUpdate) {
      els.btnInstallUpdate.disabled = true;
      els.btnEnter.disabled = true;
      setLoadingLine('installing update…');
      window.api.installUpdate();
    }
  });

  els.btnStart.addEventListener('click', joinLobby);
  els.btnOpenMenuCorner.addEventListener('click', toggleDrawer);
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerScrim.addEventListener('click', closeDrawer);

  els.btnSettings.addEventListener('click', () => showScreen('settings'));
  els.btnDrawerSettings.addEventListener('click', () => showScreen('settings'));

  const goProfile = () => {
    if (state.auth && state.auth.user) {
      renderProfileScreen();
      showScreen('profile');
    } else {
      showScreen('auth');
      switchAuthTab('signin');
    }
  };
  els.btnProfile.addEventListener('click', goProfile);
  els.btnSigninCorner.addEventListener('click', () => {
    showScreen('auth');
    switchAuthTab('signin');
  });
  els.btnDrawerProfile.addEventListener('click', goProfile);

  els.btnBackFromSettings.addEventListener('click', () => showScreen('welcome'));
  els.btnBackFromProfile.addEventListener('click', () => showScreen('welcome'));
  els.btnBackFromAuth.addEventListener('click', () => showScreen('welcome'));

  if (els.btnMessages) els.btnMessages.addEventListener('click', openMessagesScreen);
  if (els.btnBackFromMessages) els.btnBackFromMessages.addEventListener('click', () => showScreen('welcome'));
  if (els.btnNewDm) els.btnNewDm.addEventListener('click', () => {
    els.formNewDm.classList.toggle('hidden');
    if (!els.formNewDm.classList.contains('hidden')) els.newDmUsername.focus();
  });
  if (els.formNewDm) els.formNewDm.addEventListener('submit', (ev) => { ev.preventDefault(); startNewDm(); });
  if (els.btnDmBack) els.btnDmBack.addEventListener('click', closeThread);
  if (els.dmForm) els.dmForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    sendDm(els.dmInput.value);
    els.dmInput.value = '';
    if (els.btnDmSend) els.btnDmSend.disabled = true;
  });
  if (els.dmInput) els.dmInput.addEventListener('input', () => {
    if (els.btnDmSend) els.btnDmSend.disabled = els.dmInput.value.trim().length === 0;
  });

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
  els.btnRoomDice.addEventListener('click', () => {
    if (els.roomInput.disabled) return;
    els.roomInput.value = generateRoomCode();
    els.roomInput.focus();
  });

  els.btnLeave.addEventListener('click', leaveCallToWelcome);

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

  els.btnMicPopover.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleMicPopover();
  });
  els.micPopover.addEventListener('click', (ev) => ev.stopPropagation());

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

  els.btnMicRetry.addEventListener('click', async () => {
    try {
      await getMicStream();
      startMicMeter();
      if (state.intendedRoom) {
        toast('Mic back online');
      }
    } catch {}
  });
  els.btnMicOpenSettings.addEventListener('click', () => {
    if (window.api && typeof window.api.openMicSettings === 'function') {
      window.api.openMicSettings();
    }
  });

  els.eeDot.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleEe();
  });
  document.addEventListener('click', (ev) => {
    if (els.eePanel.dataset.open === 'true' && !els.eePanel.contains(ev.target)) {
      els.eePanel.dataset.open = 'false';
    }
    if (state.micPopoverOpen && !els.micPopover.contains(ev.target) && ev.target !== els.btnMicPopover) {
      closeMicPopover();
    }
  });

  document.addEventListener('keydown', (ev) => {
    // Push-to-talk: hold Space when in call + not typing → unmute temporarily
    if (ev.code === 'Space' && !ev.repeat && state.currentScreen === 'call') {
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!typing && !state.pttHeld && state.isMuted) {
        state.pttHeld = true;
        state.pttPrevMute = true;
        setMuted(false);
        ev.preventDefault();
        return;
      }
    }

    if (ev.key === 'Escape') {
      if (els.eePanel.dataset.open === 'true') {
        els.eePanel.dataset.open = 'false';
        return;
      }
      if (state.audioPanelOpen) { closeAudioPanel(); return; }
      if (state.micPopoverOpen) { closeMicPopover(); return; }
      if (state.drawerOpen) { closeDrawer(); return; }
      if (state.currentScreen === 'messages') {
        if (state.dm.currentPeer) { closeThread(); return; }
        showScreen('welcome'); return;
      }
      if (state.currentScreen === 'settings' || state.currentScreen === 'profile' || state.currentScreen === 'auth') {
        showScreen('welcome');
      }
    }
    if (ev.key === 'Enter' && state.currentScreen === 'loading' && state.loadingReady) {
      leaveLoading();
    }
  });

  document.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space' && state.pttHeld) {
      state.pttHeld = false;
      if (state.pttPrevMute) setMuted(true);
    }
  });

  // Blur cancels PTT to avoid getting stuck unmuted
  window.addEventListener('blur', () => {
    if (state.pttHeld) {
      state.pttHeld = false;
      if (state.pttPrevMute) setMuted(true);
    }
  });
}

async function init() {
  bindEls();
  state.audioSettings = loadAudioSettings();
  loadDms();
  applyTheme(loadTheme());
  attachEvents();
  loadRecent();
  renderRecent();
  renderProfileChip();
  updateMessagesBadge();
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
