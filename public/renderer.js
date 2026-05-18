const state = {
  signaling: null,
  signalingUrl: '',
  localStream: null,
  peerConnections: {},
  remoteAudios: {},
  peerNames: {},
  myPeerId: null,
  myName: '',
  myRoom: '',
  isMuted: false,
  masterVolume: 1.0,
  selectedDeviceId: '',
  availableMics: [],
  audioCtx: null,
  analyser: null,
  analyserData: null,
  meterRaf: 0,
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 4,
};

const els = {
  setupScreen: document.getElementById('setup-screen'),
  callScreen: document.getElementById('call-screen'),
  statusText: document.getElementById('status-text'),
  nameInput: document.getElementById('name-input'),
  roomInput: document.getElementById('room-input'),
  micSelect: document.getElementById('mic-select'),
  callMicSelect: document.getElementById('call-mic-select'),
  btnRefreshMics: document.getElementById('btn-refresh-mics'),
  btnConnect: document.getElementById('btn-connect'),
  btnMute: document.getElementById('btn-mute'),
  btnLeave: document.getElementById('btn-leave'),
  btnCopyRoom: document.getElementById('btn-copy-room'),
  volumeSlider: document.getElementById('volume-slider'),
  roomDisplay: document.getElementById('room-display'),
  selfName: document.getElementById('self-name'),
  micFill: document.getElementById('mic-fill'),
  peersList: document.getElementById('peers-list'),
  setupError: document.getElementById('setup-error'),
  callError: document.getElementById('call-error'),
  remoteAudios: document.getElementById('remote-audios'),
};

function showScreen(name) {
  els.setupScreen.classList.toggle('hidden', name !== 'setup');
  els.callScreen.classList.toggle('hidden', name !== 'call');
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function showError(scope, msg) {
  const el = scope === 'setup' ? els.setupError : els.callError;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(scope) {
  const el = scope === 'setup' ? els.setupError : els.callError;
  el.textContent = '';
  el.classList.add('hidden');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPeersList() {
  els.peersList.innerHTML = '';
  for (const id of Object.keys(state.peerConnections)) {
    const li = document.createElement('li');
    const conn = state.peerConnections[id];
    const connState = conn ? conn.connectionState || 'connecting' : 'unknown';
    const name = state.peerNames[id] || '(unnamed)';
    li.innerHTML = `<span><span class="status-dot"></span><span class="peer-name">${escapeHtml(name)}</span><span class="peer-id">${id.slice(0, 6)}</span></span><span>${connState}</span>`;
    els.peersList.appendChild(li);
  }
}

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
    const stream = await navigator.mediaDevices.getUserMedia(
      buildAudioConstraints(state.selectedDeviceId)
    );
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
      els.micFill.style.width = (state.isMuted ? 0 : pct) + '%';
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
  els.micFill.style.width = '0%';
}

function sendSignal(msg) {
  if (state.signaling && state.signaling.readyState === WebSocket.OPEN) {
    state.signaling.send(JSON.stringify(msg));
  }
}

function createPeerConnection(peerId, isInitiator) {
  if (state.peerConnections[peerId]) return state.peerConnections[peerId];

  const pc = new RTCPeerConnection(RTC_CONFIG);
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

async function handleSignalingMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.type === 'welcome') {
    state.myPeerId = msg.id;
    state.myRoom = msg.room;
    els.roomDisplay.textContent = msg.room;
    setStatus(`In room "${msg.room}" as ${state.myName || msg.id.slice(0, 8)}`);
  } else if (msg.type === 'peers') {
    const incomingIds = msg.peers.map((p) => p.id);
    for (const p of msg.peers) {
      state.peerNames[p.id] = p.name || '';
      if (!state.peerConnections[p.id] && p.id !== state.myPeerId) {
        const initiator = state.myPeerId && state.myPeerId < p.id;
        createPeerConnection(p.id, initiator);
      }
    }
    for (const id of Object.keys(state.peerConnections)) {
      if (!incomingIds.includes(id)) cleanupPeer(id);
    }
    for (const id of Object.keys(state.peerNames)) {
      if (!incomingIds.includes(id)) delete state.peerNames[id];
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
      setStatus('Disconnected from server');
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
  state.isMuted = false;
  setMuteButton(false);
  renderPeersList();
}

function setMuteButton(muted) {
  els.btnMute.textContent = muted ? 'Unmute' : 'Mute';
  els.btnMute.classList.toggle('muted-btn', muted);
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

async function connect() {
  clearError('setup');
  state.myName = (els.nameInput.value || '').trim().slice(0, 24);
  els.selfName.textContent = state.myName || '(unnamed)';

  const room = (els.roomInput.value || '').trim().slice(0, 32);

  if (!state.signalingUrl) {
    showError('setup', 'No signaling server URL configured yet.');
    return;
  }

  els.btnConnect.disabled = true;
  setStatus('Acquiring microphone…');

  try {
    await getMicStream();
    startMicMeter();
    setStatus('Connecting to server…');
    await connectSignaling(state.signalingUrl);
    sendSignal({ type: 'join', name: state.myName, room });
    showScreen('call');
  } catch (err) {
    console.error('[renderer] connect failed:', err);
    showError('setup', err.message);
    setStatus('Connect failed');
    disconnectAll();
  } finally {
    els.btnConnect.disabled = false;
  }
}

function attachEvents() {
  els.btnConnect.addEventListener('click', connect);
  els.btnLeave.addEventListener('click', () => {
    disconnectAll();
    showScreen('setup');
    setStatus('Disconnected');
  });
  els.btnMute.addEventListener('click', () => setMuted(!state.isMuted));
  els.volumeSlider.addEventListener('input', (e) => setVolume(+e.target.value));
  els.btnCopyRoom.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.myRoom);
      els.btnCopyRoom.textContent = 'Copied!';
      setTimeout(() => (els.btnCopyRoom.textContent = 'Copy'), 1200);
    } catch (err) {
      console.error('[renderer] copy failed:', err);
    }
  });
  els.roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
  });
  els.nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.roomInput.focus();
  });

  const onMicChange = (e) => switchMicDevice(e.target.value);
  els.micSelect.addEventListener('change', onMicChange);
  els.callMicSelect.addEventListener('change', onMicChange);
  els.btnRefreshMics.addEventListener('click', loadMicList);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', loadMicList);
  }
}

async function init() {
  attachEvents();
  showScreen('setup');
  try {
    const config = await window.api.getConfig();
    state.signalingUrl = config.signalingUrl;
    document.title = `BroTalk v${config.version}`;
    setStatus(`Ready (v${config.version}) — Ctrl+R to restart & update`);
  } catch (err) {
    console.error('[renderer] failed to load config:', err);
    setStatus('Ready');
  }
  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus((data) => {
      if (data.state === 'downloading') {
        const pct = data.percent ? ` (${Math.round(data.percent)}%)` : '';
        setStatus(`Downloading update v${data.version || ''}${pct}…`);
      } else if (data.state === 'ready') {
        setStatus(`Update v${data.version} ready — press Ctrl+R to install`);
      }
    });
  }
  loadMicList();
}

init();
