import { configureOrt, Letterbox, YoloDetector } from './detector.js';
import { Tracker } from './tracker.js';
import { SpeedEstimator, focalFromFov } from './speed.js';
import { PlateReader } from './ocr.js';

// COCO classes kept by the vehicle model, same as main.py: car, motorcycle, bus, truck
const VEHICLE_CLASSES = [2, 3, 5, 7];
const MAX_WORK_WIDTH = 1920;
const MAX_ZOOM = 8;
const DEMO_FOV = 14; // the demo clip was shot with a long lens from an overpass

const $ = (id) => document.getElementById(id);
const ui = {
  view: $('view'), stage: $('stage'), start: $('start'),
  statusDot: $('statusDot'), statusText: $('statusText'),
  cameraBtn: $('cameraBtn'), fileBtn: $('fileBtn'), demoBtn: $('demoBtn'), fileInput: $('fileInput'),
  progressBar: $('progressBar'), loadHint: $('loadHint'),
  zoombar: $('zoombar'), zoomRange: $('zoomRange'), zoomValue: $('zoomValue'),
  videobar: $('videobar'), playBtn: $('playBtn'), playIcon: $('playIcon'), seek: $('seek'), rate: $('rate'),
  torchBtn: $('torchBtn'), sourceBtn: $('sourceBtn'), historyBtn: $('historyBtn'), historyCount: $('historyCount'),
  settingsBtn: $('settingsBtn'), settings: $('settings'),
  fov: $('fov'), fovOut: $('fovOut'), vehWidth: $('vehWidth'), widthOut: $('widthOut'), conf: $('conf'), confOut: $('confOut'),
  drawer: $('drawer'), closeDrawer: $('closeDrawer'), historyList: $('historyList'), historyEmpty: $('historyEmpty'), csvBtn: $('csvBtn'),
  perf: $('perf'),
};
const viewCtx = ui.view.getContext('2d');

const state = {
  kind: null,          // 'camera' | 'file'
  video: document.createElement('video'),
  stream: null,
  track: null,
  hwZoom: null,        // { min, max, step } when the camera supports optical/sensor zoom
  hwZoomValue: 1,
  zoom: 1,
  torch: false,
  geom: null,          // crop + scale of the current frame
  frameT: 0,
  lastProcessedT: -1,
  perf: { det: 0, fps: 0, last: 0 },
  history: new Map(),  // track id -> entry
};
state.video.muted = true;
state.video.playsInline = true;
state.video.setAttribute('playsinline', '');

const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });
const letterbox = new Letterbox();
const tracker = new Tracker();
const speed = new SpeedEstimator();
// Two OCR workers when the device has the cores for it
const readers = Array.from({ length: (navigator.hardwareConcurrency || 2) >= 4 ? 2 : 1 }, () => new PlateReader());
let carDet, plateDet, ocrReady = false, modelsReady = false;

// ---------------------------------------------------------------- loading
function setStatus(text, kind = '') {
  ui.statusText.textContent = text;
  ui.statusDot.className = 'dot' + (kind ? ' ' + kind : '');
}

async function init() {
  try {
    configureOrt();
    carDet = new YoloDetector('models/yolov8n.onnx', { classes: VEHICLE_CLASSES, conf: 0.35 });
    plateDet = new YoloDetector('models/license_plate_detector.onnx', { conf: 0.3 });
    const prog = [0, 0];
    const show = () => { ui.progressBar.style.width = `${Math.round(((prog[0] + prog[1]) / 2) * 100)}%`; };
    await Promise.all([
      carDet.load((p) => { prog[0] = p; show(); }),
      plateDet.load((p) => { prog[1] = p; show(); }),
    ]);
    modelsReady = true;
    ui.progressBar.parentElement.classList.add('hidden');
    for (const b of [ui.cameraBtn, ui.fileBtn, ui.demoBtn]) b.disabled = false;
    const threads = globalThis.ort.env.wasm.numThreads;
    setStatus(`Listo · ${threads} hilo${threads > 1 ? 's' : ''}`, 'ok');
    ui.loadHint.textContent = 'Modelos listos. Elige una fuente.';
  } catch (err) {
    console.error(err);
    setStatus('Error al cargar modelos', 'err');
    ui.loadHint.textContent = `No se pudieron cargar los modelos: ${err.message}`;
    return;
  }
  try {
    await Promise.all(readers.map((r) => r.load()));
    ocrReady = true;
  } catch (err) {
    console.error(err);
    ui.loadHint.textContent = 'El OCR no se pudo cargar; se mostrarán vehículos y velocidad sin texto de placa.';
  }
}

// ---------------------------------------------------------------- sources
function stopSource() {
  state.video.pause();
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  if (state.video.src && state.video.src.startsWith('blob:')) URL.revokeObjectURL(state.video.src);
  state.stream = null;
  state.track = null;
  state.hwZoom = null;
  state.video.srcObject = null;
  state.video.removeAttribute('src');
  tracker.reset();
  state.lastProcessedT = -1;
}

async function startCamera() {
  stopSource();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    state.stream = stream;
    state.track = stream.getVideoTracks()[0];
    const caps = state.track.getCapabilities ? state.track.getCapabilities() : {};
    state.hwZoom = caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : null;
    ui.torchBtn.classList.toggle('hidden', !caps.torch);
    state.video.srcObject = stream;
    state.video.loop = false;
    await state.video.play();
    state.kind = 'camera';
    setFov(66);
    afterSourceStart();
  } catch (err) {
    console.error(err);
    alert('No se pudo abrir la cámara. Revisa el permiso del navegador (la página debe abrirse con HTTPS).');
  }
}

async function startFile(url, fov) {
  stopSource();
  ui.torchBtn.classList.add('hidden');
  state.video.src = url;
  state.video.loop = true;
  state.video.playbackRate = Number(ui.rate.value);
  await state.video.play().catch(() => {});
  state.kind = 'file';
  if (fov) setFov(fov);
  afterSourceStart();
}

function afterSourceStart() {
  ui.start.classList.add('hidden');
  ui.zoombar.classList.remove('hidden');
  ui.videobar.classList.toggle('hidden', state.kind !== 'file');
  setZoom(1);
}

// ---------------------------------------------------------------- zoom
let zoomApplyPending = false;
function setZoom(z) {
  z = Math.max(1, Math.min(MAX_ZOOM, z));
  state.zoom = z;
  if (state.hwZoom) {
    const hz = Math.max(state.hwZoom.min, Math.min(state.hwZoom.max, z));
    if (Math.abs(hz - state.hwZoomValue) > 0.01 && !zoomApplyPending) {
      zoomApplyPending = true;
      requestAnimationFrame(() => {
        const target = Math.max(state.hwZoom.min, Math.min(state.hwZoom.max, state.zoom));
        state.track.applyConstraints({ advanced: [{ zoom: target }] })
          .then(() => { state.hwZoomValue = target; })
          .catch(() => { state.hwZoom = null; state.hwZoomValue = 1; })
          .finally(() => { zoomApplyPending = false; });
      });
    }
  } else {
    state.hwZoomValue = 1;
  }
  // Distances change with the zoom, so start the speed window again
  for (const t of tracker.tracks) t.speedHist = [];
  ui.zoomRange.value = String(z);
  ui.zoomValue.textContent = `${z.toFixed(1)}×`;
  document.querySelectorAll('.zoom-chip').forEach((c) => c.classList.toggle('on', Math.abs(Number(c.dataset.zoom) - z) < 0.05));
}

/** Geometry of the frame actually analysed: digital crop of the source + work-canvas scale. */
function computeGeom() {
  const v = state.video;
  const sw = v.videoWidth, sh = v.videoHeight;
  if (!sw || !sh) return null;
  const digital = state.zoom / (state.hwZoom ? state.hwZoomValue : 1);
  const cw = sw / Math.max(1, digital);
  const ch = sh / Math.max(1, digital);
  const cx0 = (sw - cw) / 2;
  const cy0 = (sh - ch) / 2;
  const ws = Math.min(1, MAX_WORK_WIDTH / cw);
  const W = Math.round(cw * ws), H = Math.round(ch * ws);
  const fx = focalFromFov(sw, Number(ui.fov.value), state.hwZoom ? state.hwZoomValue : 1) * ws;
  return { sw, sh, cx0, cy0, cw, ch, ws, W, H, fx };
}

// ---------------------------------------------------------------- processing
function frameTime() {
  return state.kind === 'file' ? state.video.currentTime * 1000 : performance.now();
}

function cropPlate(g, box, padX = 0.08, padY = 0.15) {
  // Crop from the snapshot that was analysed (the video has moved on since then)
  const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
  const sx = Math.max(0, box.x1 - bw * padX);
  const sy = Math.max(0, box.y1 - bh * padY);
  const sw = Math.min(g.W - sx, bw * (1 + 2 * padX));
  const sh = Math.min(g.H - sy, bh * (1 + 2 * padY));
  if (sw < 4 || sh < 4) return null;
  const c = document.createElement('canvas');
  c.width = Math.round(sw);
  c.height = Math.round(sh);
  c.getContext('2d').drawImage(work, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function assignPlates(tracks, plates, g, t) {
  for (const p of plates) {
    const pcx = (p.x1 + p.x2) / 2, pcy = (p.y1 + p.y2) / 2;
    let owner = null, ownerArea = Infinity;
    for (const tr of tracks) {
      const b = tr.det;
      if (pcx > b.x1 && pcx < b.x2 && pcy > b.y1 && pcy < b.y2) {
        const area = (b.x2 - b.x1) * (b.y2 - b.y1);
        if (area < ownerArea) { owner = tr; ownerArea = area; }
      }
    }
    if (!owner) continue;
    const b = owner.det, bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    const crop = cropPlate(g, p);
    owner.plate = {
      rel: { x1: (p.x1 - b.x1) / bw, y1: (p.y1 - b.y1) / bh, x2: (p.x2 - b.x1) / bw, y2: (p.y2 - b.y1) / bh },
      crop,
      seenAt: t,
      lastOcr: owner.plate?.lastOcr ?? -Infinity,
      pending: true,
    };
  }
}

async function processFrame() {
  const g = computeGeom();
  if (!g) return;
  const t = frameTime();
  if (t === state.lastProcessedT) return;
  state.lastProcessedT = t;
  state.geom = g;

  if (work.width !== g.W || work.height !== g.H) { work.width = g.W; work.height = g.H; }
  workCtx.drawImage(state.video, g.cx0, g.cy0, g.cw, g.ch, 0, 0, g.W, g.H);

  const t0 = performance.now();
  const lb = letterbox.prepare(work, g.W, g.H);
  carDet.conf = Number(ui.conf.value);
  const cars = (await carDet.run(lb, g.W, g.H)).filter((b) => (b.x2 - b.x1) > 12 && (b.y2 - b.y1) > 12);
  const plates = await plateDet.run(lb, g.W, g.H);
  const dt = performance.now() - t0;

  const active = tracker.update(cars, t);
  assignPlates(active, plates, g, t);
  speed.vehicleWidthM = Number(ui.vehWidth.value);
  for (const tr of active) {
    if (tr.hits < 2) continue;
    const v = speed.update(tr, tr.box, t, g.fx, g.W / 2, g.W, g.H);
    if (v != null) {
      tr.maxSpeedKmh = Math.max(tr.maxSpeedKmh ?? 0, v);
      updateHistorySpeed(tr);
    }
  }

  const now = performance.now();
  const p = state.perf;
  p.det = p.det ? p.det * 0.8 + dt * 0.2 : dt;
  if (p.last) p.fps = p.fps ? p.fps * 0.8 + (1000 / (now - p.last)) * 0.2 : 1000 / (now - p.last);
  p.last = now;
  ui.perf.textContent = `${p.fps.toFixed(1)} fps · detección ${Math.round(p.det)} ms · ${active.length} vehículo${active.length === 1 ? '' : 's'}`;
}

async function processLoop() {
  for (;;) {
    if (modelsReady && state.kind && state.video.readyState >= 2) {
      try { await processFrame(); } catch (err) { console.error(err); }
    }
    // Not tied to requestAnimationFrame: it is throttled in background tabs and would cap detection
    await new Promise((r) => setTimeout(r, 4));
  }
}

// ---------------------------------------------------------------- OCR
function pickOcrTarget() {
  let best = null, bestPrio = -Infinity;
  const now = state.lastProcessedT;
  for (const tr of tracker.tracks) {
    const p = tr.plate;
    if (!p || !p.pending || !p.crop) continue;
    if (now - p.seenAt > 800) continue;
    const confident = tr.reading && tr.reading.count >= 3 && tr.reading.score > 0.8;
    const interval = confident ? 2500 : 350;
    if (Math.abs(now - p.lastOcr) < interval) continue;
    // Tracks without a reading first, then the biggest plates
    const prio = (tr.reading ? 0 : 1e6) + p.crop.width * p.crop.height;
    if (prio > bestPrio) { bestPrio = prio; best = tr; }
  }
  return best;
}

async function ocrLoop(reader) {
  for (;;) {
    const tr = ocrReady && state.kind ? pickOcrTarget() : null;
    if (!tr) { await new Promise((r) => setTimeout(r, 60)); continue; }
    const p = tr.plate;
    p.pending = false;
    p.lastOcr = state.lastProcessedT;
    const crop = p.crop;
    try {
      const r = await reader.read(crop);
      if (r) addVote(tr, r, crop);
    } catch (err) {
      console.error(err);
    }
  }
}

function addVote(tr, r, crop) {
  // Like visualize.py keeps the highest-score reading per car, but votes across
  // frames so one lucky misread does not win.
  const v = tr.votes.get(r.plate) || { count: 0, score: 0, crop: null, type: r.type };
  v.count++;
  if (r.score >= v.score) { v.score = r.score; v.crop = crop; }
  tr.votes.set(r.plate, v);
  let best = null;
  for (const [text, e] of tr.votes) {
    const rank = e.count + e.score;
    if (!best || rank > best.rank) best = { text, rank, ...e };
  }
  tr.reading = { text: best.text, type: best.type, score: best.score, count: best.count, crop: best.crop };
  upsertHistory(tr);
}

// ---------------------------------------------------------------- history
function upsertHistory(tr) {
  const r = tr.reading;
  const prev = state.history.get(tr.id);
  const img = (!prev || prev.text !== r.text || prev.score < r.score) ? r.crop.toDataURL('image/jpeg', 0.85) : prev.img;
  state.history.set(tr.id, {
    id: tr.id,
    text: r.text,
    type: r.type,
    score: r.score,
    img,
    speed: tr.speedKmh,
    maxSpeed: tr.maxSpeedKmh,
    time: prev?.time ?? new Date(),
  });
  renderHistorySoon();
}

function updateHistorySpeed(tr) {
  const e = state.history.get(tr.id);
  if (!e) return;
  e.speed = tr.speedKmh;
  e.maxSpeed = tr.maxSpeedKmh;
}

let historyTimer = 0;
function renderHistorySoon() {
  if (historyTimer) return;
  historyTimer = setTimeout(() => { historyTimer = 0; renderHistory(); }, 300);
}

function renderHistory() {
  const items = [...state.history.values()].sort((a, b) => b.time - a.time);
  ui.historyCount.textContent = String(items.length);
  ui.historyCount.classList.toggle('hidden', items.length === 0);
  ui.historyEmpty.classList.toggle('hidden', items.length > 0);
  ui.historyList.replaceChildren(...items.map((e) => {
    const li = document.createElement('li');
    const txt = document.createElement('div');
    txt.className = 'plate-text';
    txt.textContent = e.text;
    const img = document.createElement('img');
    img.src = e.img;
    img.alt = `Placa ${e.text}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const sp = e.speed != null ? `${Math.round(e.speed)} km/h` : '— km/h';
    meta.innerHTML = '';
    for (const s of [e.type, sp, e.time.toLocaleTimeString('es-MX')]) {
      const span = document.createElement('span');
      span.textContent = s;
      meta.append(span);
    }
    li.append(txt, img, meta);
    return li;
  }));
}

function exportCsv() {
  const rows = [['hora', 'placa', 'formato', 'confianza', 'velocidad_kmh', 'velocidad_max_kmh']];
  for (const e of state.history.values()) {
    rows.push([
      e.time.toISOString(), e.text, e.type, e.score.toFixed(2),
      e.speed != null ? e.speed.toFixed(1) : '', e.maxSpeed != null ? e.maxSpeed.toFixed(1) : '',
    ]);
  }
  const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `placas_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- rendering (demo style)
function resizeView() {
  const r = ui.view.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (ui.view.width !== w || ui.view.height !== h) { ui.view.width = w; ui.view.height = h; }
}

function viewTransform(g) {
  const vw = ui.view.width, vh = ui.view.height;
  // Camera fills the screen (cover); videos are shown whole (contain)
  const fit = state.kind === 'camera' ? Math.max(vw / g.cw, vh / g.ch) : Math.min(vw / g.cw, vh / g.ch);
  const dw = g.cw * fit, dh = g.ch * fit;
  return { fit, ox: (vw - dw) / 2, oy: (vh - dh) / 2, dw, dh };
}

function drawBorder(ctx, x1, y1, x2, y2, color, thick) {
  // Same corner-bracket style as draw_border() in visualize.py
  const lx = (x2 - x1) * 0.22, ly = (y2 - y1) * 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = thick;
  ctx.lineCap = 'square';
  ctx.beginPath();
  ctx.moveTo(x1, y1 + ly); ctx.lineTo(x1, y1); ctx.lineTo(x1 + lx, y1);
  ctx.moveTo(x2 - lx, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + ly);
  ctx.moveTo(x1, y2 - ly); ctx.lineTo(x1, y2); ctx.lineTo(x1 + lx, y2);
  ctx.moveTo(x2 - lx, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - ly);
  ctx.stroke();
}

function fitText(ctx, text, maxW, maxH, weight = 900) {
  let size = maxH;
  ctx.font = `${weight} ${size}px "Arial Black", Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    size *= maxW / w;
    ctx.font = `${weight} ${size}px "Arial Black", Arial, sans-serif`;
  }
  return size;
}

function speedLabel(tr) {
  return tr.speedKmh != null ? `${Math.round(tr.speedKmh)} km/h` : '— km/h';
}

function drawCallout(ctx, tr, carL, carT, carR, carB, vh, sh) {
  // sh = height of the video on screen, so sizes follow the picture and not the page
  const r = tr.reading;
  const crop = r.crop;
  const cropH = Math.max(26, Math.min(170, sh * 0.11));
  const aspect = Math.max(2, Math.min(5, crop.width / crop.height));
  const w = cropH * aspect;
  const whiteH = cropH * 0.75; // 300:400 like visualize.py
  const speedH = cropH * 0.5;
  const total = whiteH + cropH + speedH;
  const gap = Math.max(4, sh * 0.012);
  const cx = (carL + carR) / 2;
  let x = cx - w / 2;
  x = Math.max(4, Math.min(ui.view.width - w - 4, x));
  let y = carT - gap - total;
  if (y < 4) y = Math.min(carB + gap, vh - total - 4);

  // White box with the plate number
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, w, whiteH);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, r.text, w * 0.88, whiteH * 0.62);
  ctx.fillText(r.text, x + w / 2, y + whiteH / 2 + 1);

  // Real crop of the plate right underneath
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop, x, y + whiteH, w, cropH);

  // Speed strip (the only addition to the original layout)
  const sy = y + whiteH + cropH;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, sy, w, speedH);
  ctx.fillStyle = '#000000';
  fitText(ctx, speedLabel(tr), w * 0.8, speedH * 0.62, 800);
  ctx.fillText(speedLabel(tr), x + w / 2, sy + speedH / 2 + 1);
}

function render() {
  resizeView();
  const ctx = viewCtx;
  const vw = ui.view.width, vh = ui.view.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);
  const g = computeGeom();
  if (g && state.kind && state.video.readyState >= 2) {
    const T = viewTransform(g);
    ctx.drawImage(state.video, g.cx0, g.cy0, g.cw, g.ch, T.ox, T.oy, T.dw, T.dh);

    const det = state.geom;
    if (det) {
      const toV = (x, y) => [T.ox + (x / det.ws) * T.fit, T.oy + (y / det.ws) * T.fit];
      const sh = Math.min(vh, T.dh);
      const thick = Math.max(2, Math.min(8, sh * 0.006));
      const now = state.lastProcessedT;
      const callouts = [];
      for (const tr of tracker.tracks) {
        if (tr.hits < 2 || now - tr.lastSeen > 400) continue;
        // Like the original demo, only nearby vehicles get the overlay
        const rel = (tr.box.y2 - tr.box.y1) / det.H;
        if (rel < 0.1 && !tr.reading) continue;
        const [l, t] = toV(tr.box.x1, tr.box.y1);
        const [r, b] = toV(tr.box.x2, tr.box.y2);
        drawBorder(ctx, l, t, r, b, '#00FF00', thick);
        if (tr.plate && now - tr.plate.seenAt < 600) {
          const q = tr.plate.rel, bw = r - l, bh = b - t;
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = Math.max(2, thick * 0.7);
          ctx.strokeRect(l + q.x1 * bw, t + q.y1 * bh, (q.x2 - q.x1) * bw, (q.y2 - q.y1) * bh);
        }
        // As in the demo, text only appears once the plate is read; speed goes in that callout
        if (tr.reading) callouts.push([tr, l, t, r, b]);
      }
      for (const c of callouts) drawCallout(ctx, c[0], c[1], c[2], c[3], c[4], vh, sh);
    }
    if (state.kind === 'file' && !seeking && state.video.duration) {
      ui.seek.value = String(Math.round((state.video.currentTime / state.video.duration) * 1000));
    }
  }
  requestAnimationFrame(render);
}

// ---------------------------------------------------------------- UI wiring
function setFov(v) {
  ui.fov.value = String(v);
  ui.fovOut.textContent = `${v}°`;
}

ui.cameraBtn.onclick = startCamera;
ui.fileBtn.onclick = () => ui.fileInput.click();
ui.demoBtn.onclick = () => startFile('media/demo.mp4', DEMO_FOV);
ui.fileInput.onchange = () => {
  const f = ui.fileInput.files[0];
  if (f) startFile(URL.createObjectURL(f));
  ui.fileInput.value = '';
};
ui.sourceBtn.onclick = () => {
  stopSource();
  state.kind = null;
  ui.start.classList.remove('hidden');
  ui.zoombar.classList.add('hidden');
  ui.videobar.classList.add('hidden');
  ui.torchBtn.classList.add('hidden');
  ui.perf.textContent = '';
};
ui.torchBtn.onclick = async () => {
  if (!state.track) return;
  state.torch = !state.torch;
  try {
    await state.track.applyConstraints({ advanced: [{ torch: state.torch }] });
  } catch { state.torch = false; }
  ui.torchBtn.classList.toggle('on', state.torch);
};

ui.zoomRange.oninput = () => setZoom(Number(ui.zoomRange.value));
document.querySelectorAll('.zoom-chip').forEach((c) => { c.onclick = () => setZoom(Number(c.dataset.zoom)); });

// Pinch to zoom (touch) and wheel zoom (desktop)
const pointers = new Map();
let pinchStart = null;
ui.stage.addEventListener('pointerdown', (e) => {
  if (!state.kind || e.target !== ui.view) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), z: state.zoom };
  }
});
ui.stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStart.d > 0) setZoom(pinchStart.z * (d / pinchStart.d));
  }
});
const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; };
ui.stage.addEventListener('pointerup', endPointer);
ui.stage.addEventListener('pointercancel', endPointer);
ui.stage.addEventListener('wheel', (e) => {
  if (!state.kind) return;
  e.preventDefault();
  setZoom(state.zoom * Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

// Video controls
let seeking = false;
ui.playBtn.onclick = () => (state.video.paused ? state.video.play() : state.video.pause());
state.video.addEventListener('play', () => ui.playIcon.setAttribute('d', 'M7 5h4v14H7zM13 5h4v14h-4z'));
state.video.addEventListener('pause', () => ui.playIcon.setAttribute('d', 'M8 5v14l11-7z'));
ui.seek.addEventListener('input', () => {
  seeking = true;
  if (state.video.duration) state.video.currentTime = (Number(ui.seek.value) / 1000) * state.video.duration;
});
ui.seek.addEventListener('change', () => { seeking = false; });
ui.rate.onchange = () => { state.video.playbackRate = Number(ui.rate.value); };

// Drawer & settings
const openDrawer = (open) => {
  ui.drawer.classList.toggle('open', open);
  ui.drawer.setAttribute('aria-hidden', String(!open));
};
ui.historyBtn.onclick = () => { renderHistory(); openDrawer(true); };
ui.closeDrawer.onclick = () => openDrawer(false);
ui.csvBtn.onclick = exportCsv;
ui.settingsBtn.onclick = () => ui.settings.showModal();
ui.fov.oninput = () => { ui.fovOut.textContent = `${ui.fov.value}°`; for (const t of tracker.tracks) t.speedHist = []; };
ui.vehWidth.oninput = () => { ui.widthOut.textContent = `${Number(ui.vehWidth.value).toFixed(2)} m`; };
ui.conf.oninput = () => { ui.confOut.textContent = Number(ui.conf.value).toFixed(2); };

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
}

init();
processLoop();
readers.forEach((r) => ocrLoop(r));
requestAnimationFrame(render);
