/* ============================================================
 * BroTalk splash — animated loader + update gate
 * ============================================================ */

const FUN_FACTS = [
  "Your voice never goes through our servers. Once a call connects, audio flows peer-to-peer between you and your friends — the server only helped you find each other.",
  "BroTalk's signaling backend runs on $0/month — a free Render web service plus a free Neon Postgres for accounts.",
  "Passwords are hashed with bcrypt at cost factor 10 — the same baseline most banks use for login.",
  "The mic level meter you see while you talk is computed 60 times per second from a 256-bucket FFT of your audio.",
  "Echo cancellation, noise suppression, and auto gain are all native WebRTC — no extra audio library is shipped with the app.",
  "Room codes are case-insensitive, trimmed, and capped at 32 chars. \"Bros\", \"BROS \", and \" bros\" all land in the same room.",
  "BroTalk pings three STUN servers in parallel — two Google, one Cloudflare — so a NAT path can almost always be found.",
  "Your session token lasts 30 days. Sign in once a month and you're set.",
  "The accent green is #00d97e — picked to stay vibrant on OLED and IPS screens without burning your eyes at night.",
  "The whole desktop app — Electron runtime, code, assets, dependencies — fits in roughly the size of a single short video.",
];

const state = {
  version: '—',
  updateInfo: null,           // { version } when downloaded
  updateState: 'idle',        // 'idle' | 'checking' | 'downloading' | 'downloaded' | 'not-available' | 'error'
  downloadPercent: 0,
  dismissable: false,
  factIndex: -1,
};

const els = {};
function bindEls() {
  for (const id of [
    'stage', 'tagline',
    'btn-update', 'btn-continue', 'update-title', 'continue-title',
    'btn-fact', 'fact-modal', 'fact-body', 'btn-fact-next', 'btn-fact-close',
    'footer-version',
  ]) {
    els[camel(id)] = document.getElementById(id);
  }
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

/* ─── Canvas animation ─────────────────── */

const stage = {
  canvas: null,
  ctx: null,
  dpr: 1,
  w: 0,
  h: 0,
  cx: 0,
  cy: 0,
  shapes: [],
  particles: [],
  phase: 'forming',
  phaseStart: 0,
  lastFrame: 0,
  raf: 0,
};

const PHASE_DURATIONS = {
  forming: 1400,
  holding: 1900,
  scattering: 900,
  drifting: 1200,
};

const SHAPE_PALETTE = [
  { sides: 3,  size: 18 },  // triangle
  { sides: 6,  size: 16 },  // hex
  { sides: 4,  size: 14 },  // square
  { sides: 5,  size: 17 },  // pentagon
  { sides: 8,  size: 14 },  // octagon
  { sides: 3,  size: 13 },  // small triangle
  { sides: 6,  size: 19 },  // big hex
  { sides: 4,  size: 12 },  // small square
  { sides: 5,  size: 13 },  // small pentagon
  { sides: 60, size: 10 },  // tiny "dot" (high-poly circle)
];

function initStage() {
  stage.canvas = els.stage;
  stage.ctx = stage.canvas.getContext('2d');
  resizeStage();
  window.addEventListener('resize', resizeStage);

  buildShapes();
  stage.phase = 'forming';
  stage.phaseStart = performance.now();
  applyTargetsForPhase();

  stage.lastFrame = performance.now();
  stage.raf = requestAnimationFrame(tick);
}

function resizeStage() {
  const dpr = window.devicePixelRatio || 1;
  stage.dpr = dpr;
  stage.w = window.innerWidth;
  stage.h = window.innerHeight;
  stage.canvas.width = Math.round(stage.w * dpr);
  stage.canvas.height = Math.round(stage.h * dpr);
  stage.canvas.style.width = stage.w + 'px';
  stage.canvas.style.height = stage.h + 'px';
  stage.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stage.cx = stage.w / 2;
  stage.cy = stage.h / 2 - 8;
  if (stage.shapes.length) applyTargetsForPhase();
}

function buildShapes() {
  stage.shapes = [];
  const n = SHAPE_PALETTE.length;
  for (let i = 0; i < n; i++) {
    const def = SHAPE_PALETTE[i];
    stage.shapes.push({
      sides: def.sides,
      size: def.size,
      x: stage.cx,
      y: stage.cy,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      tx: stage.cx,
      ty: stage.cy,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.012,
      scale: 1,
      scaleTarget: 1,
      stiffness: 0.018 + Math.random() * 0.012,
      damping: 0.82 + Math.random() * 0.06,
      seed: Math.random() * 1000,
      formedTriggered: false,
    });
  }
}

function logoPositions(R) {
  const cx = stage.cx, cy = stage.cy;
  return [
    { x: cx + R * 0.85,  y: cy - R * 0.50 },   // upper right
    { x: cx - R * 0.95,  y: cy - R * 0.10 },   // left
    { x: cx + R * 0.10,  y: cy - R * 1.05 },   // top
    { x: cx + R * 1.00,  y: cy + R * 0.45 },   // right-low
    { x: cx - R * 0.55,  y: cy + R * 0.85 },   // lower-left
    { x: cx + R * 0.55,  y: cy + R * 0.95 },   // lower-right
    { x: cx,             y: cy             },  // center (large hex)
    { x: cx - R * 0.75,  y: cy - R * 0.75 },   // upper-left
    { x: cx + R * 0.05,  y: cy + R * 0.20 },   // mid (near center)
    { x: cx,             y: cy - R * 0.05 },   // tiny dot near center
  ];
}

function scatterPositions(R) {
  const cx = stage.cx, cy = stage.cy;
  const n = stage.shapes.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = R + Math.random() * R * 0.4;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

function driftPositions(R) {
  const cx = stage.cx, cy = stage.cy;
  const n = stage.shapes.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 1.2;
    const r = R * (0.55 + Math.random() * 0.4);
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

function applyTargetsForPhase() {
  const baseR = Math.min(stage.w, stage.h) * 0.18;
  let positions;
  if (stage.phase === 'forming' || stage.phase === 'holding') {
    positions = logoPositions(baseR);
  } else if (stage.phase === 'scattering') {
    positions = scatterPositions(baseR * 2.6);
  } else {
    positions = driftPositions(baseR * 1.7);
  }
  for (let i = 0; i < stage.shapes.length; i++) {
    const s = stage.shapes[i];
    s.tx = positions[i].x;
    s.ty = positions[i].y;
    s.formedTriggered = false;
    if (stage.phase === 'forming') {
      s.scaleTarget = 1;
    } else if (stage.phase === 'holding') {
      s.scaleTarget = 1;
    } else if (stage.phase === 'scattering') {
      s.scaleTarget = 0.85;
    } else {
      s.scaleTarget = 0.95;
    }
  }
}

function setPhase(name, now) {
  stage.phase = name;
  stage.phaseStart = now;
  applyTargetsForPhase();
}

function emitFormationBurst() {
  for (const s of stage.shapes) {
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 1.0;
      stage.particles.push({
        x: s.x,
        y: s.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size: 1.4 + Math.random() * 1.2,
        life: 1,
        maxLife: 60 + Math.random() * 50,
        age: 0,
      });
    }
  }
}

function emitAmbientParticles() {
  if (stage.particles.length > 80) return;
  if (Math.random() > 0.35) return;
  const s = stage.shapes[Math.floor(Math.random() * stage.shapes.length)];
  stage.particles.push({
    x: s.x + (Math.random() - 0.5) * 6,
    y: s.y + (Math.random() - 0.5) * 6,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.2 - Math.random() * 0.4,
    size: 1.0 + Math.random() * 0.8,
    life: 1,
    maxLife: 80 + Math.random() * 60,
    age: 0,
  });
}

function tick(now) {
  const dt = Math.min(40, now - stage.lastFrame);
  stage.lastFrame = now;

  const elapsed = now - stage.phaseStart;
  const dur = PHASE_DURATIONS[stage.phase];
  if (elapsed > dur) {
    const next = {
      forming: 'holding',
      holding: 'scattering',
      scattering: 'drifting',
      drifting: 'forming',
    }[stage.phase];
    setPhase(next, now);
  }

  for (const s of stage.shapes) {
    const ax = (s.tx - s.x) * s.stiffness;
    const ay = (s.ty - s.y) * s.stiffness;
    s.vx = (s.vx + ax) * s.damping;
    s.vy = (s.vy + ay) * s.damping;
    s.x += s.vx;
    s.y += s.vy;
    s.rot += s.rotSpeed + Math.sin((now + s.seed) * 0.001) * 0.0015;
    s.scale += (s.scaleTarget - s.scale) * 0.08;

    if (stage.phase === 'forming' && !s.formedTriggered) {
      const dx = s.x - s.tx, dy = s.y - s.ty;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 6) {
        s.formedTriggered = true;
        burstSingleShape(s);
      }
    }
  }

  if (stage.phase === 'holding') emitAmbientParticles();

  for (let i = stage.particles.length - 1; i >= 0; i--) {
    const p = stage.particles[i];
    p.age++;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.life = 1 - (p.age / p.maxLife);
    if (p.life <= 0) stage.particles.splice(i, 1);
  }

  draw();
  stage.raf = requestAnimationFrame(tick);
}

function burstSingleShape(s) {
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.5 + Math.random() * 0.8;
    stage.particles.push({
      x: s.x,
      y: s.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: 1.2 + Math.random() * 1.0,
      life: 1,
      maxLife: 50 + Math.random() * 40,
      age: 0,
    });
  }
}

function draw() {
  const ctx = stage.ctx;
  ctx.clearRect(0, 0, stage.w, stage.h);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const p of stage.particles) {
    const alpha = Math.max(0, p.life);
    const size = p.size * (0.4 + 0.6 * p.life);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 240, 140, ${alpha * 0.85})`;
    ctx.shadowColor = 'rgba(0, 240, 140, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fill();
  }

  for (const s of stage.shapes) {
    drawShape(ctx, s);
  }

  ctx.restore();
}

function drawShape(ctx, s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  ctx.scale(s.scale, s.scale);

  ctx.beginPath();
  for (let i = 0; i < s.sides; i++) {
    const a = (i / s.sides) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * s.size;
    const y = Math.sin(a) * s.size;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.shadowColor = 'rgba(0, 240, 140, 0.8)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(0, 220, 130, 0.35)';
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(180, 255, 220, 0.95)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();
}

/* ─── Fun facts ────────────────────────── */

function randomFactIndex() {
  if (FUN_FACTS.length <= 1) return 0;
  let i = state.factIndex;
  while (i === state.factIndex) {
    i = Math.floor(Math.random() * FUN_FACTS.length);
  }
  return i;
}

function showFact() {
  state.factIndex = randomFactIndex();
  els.factBody.textContent = FUN_FACTS[state.factIndex];
  els.factModal.classList.remove('hidden');
}

function hideFact() {
  els.factModal.classList.add('hidden');
}

/* ─── Update flow ──────────────────────── */

function setTagline(text) {
  els.tagline.textContent = text;
}

function setContinueLabel(text, enabled = true) {
  els.continueTitle.textContent = text;
  els.btnContinue.disabled = !enabled;
}

function showUpdateButton(version) {
  els.updateTitle.textContent = `Update to v${version}`;
  els.btnUpdate.classList.remove('hidden');
}

function applyUpdateState(data) {
  state.updateState = data.state || state.updateState;
  if (data.version) state.updateInfo = { version: data.version };
  if (typeof data.percent === 'number') state.downloadPercent = data.percent;

  switch (state.updateState) {
    case 'checking':
      setTagline('Looking for updates…');
      break;
    case 'downloading': {
      const v = state.updateInfo ? state.updateInfo.version : '';
      const pct = state.downloadPercent ? ` · ${Math.round(state.downloadPercent)}%` : '';
      setTagline(`Downloading v${v}${pct}`);
      break;
    }
    case 'downloaded':
      setTagline('Update ready when you are');
      if (state.updateInfo) showUpdateButton(state.updateInfo.version);
      break;
    case 'not-available':
      setTagline(`You're on the latest · v${state.version}`);
      break;
    case 'error':
      setTagline('Update check skipped');
      break;
  }
}

function enableContinue() {
  state.dismissable = true;
  if (state.updateState !== 'downloaded') {
    setContinueLabel('Enter BroTalk');
  } else {
    setContinueLabel('Continue without updating');
  }
}

/* ─── Wiring ───────────────────────────── */

function attachEvents() {
  els.btnContinue.addEventListener('click', () => {
    if (!state.dismissable) return;
    if (window.splashApi && window.splashApi.dismiss) window.splashApi.dismiss();
  });

  els.btnUpdate.addEventListener('click', () => {
    els.btnUpdate.disabled = true;
    els.btnContinue.disabled = true;
    setTagline('Installing update…');
    if (window.splashApi && window.splashApi.installUpdate) window.splashApi.installUpdate();
  });

  els.btnFact.addEventListener('click', showFact);
  els.btnFactClose.addEventListener('click', hideFact);
  els.btnFactNext.addEventListener('click', showFact);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.factModal.classList.contains('hidden')) hideFact();
  });
}

async function init() {
  bindEls();
  initStage();
  attachEvents();
  setTagline('Tuning the line…');

  if (window.splashApi && typeof window.splashApi.getInfo === 'function') {
    try {
      const info = await window.splashApi.getInfo();
      state.version = info.version || '—';
      els.footerVersion.textContent = `v${state.version}`;
    } catch {}
    if (typeof window.splashApi.onUpdate === 'function') {
      window.splashApi.onUpdate(applyUpdateState);
    }
    if (typeof window.splashApi.ready === 'function') {
      window.splashApi.ready();
    }
  } else {
    els.footerVersion.textContent = 'v(preview)';
  }

  setTimeout(enableContinue, 1600);
}

window.addEventListener('beforeunload', () => {
  if (stage.raf) cancelAnimationFrame(stage.raf);
});

init();
