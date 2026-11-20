// YOLOv8 (ONNX) inference in the browser with onnxruntime-web.
// Both models (yolov8n.onnx and license_plate_detector.onnx) take a 1x3x640x640 image
// and return [1, 4 + classes, 8400] (cx, cy, w, h, class scores...).

const SIZE = 640;

export function configureOrt() {
  const ort = globalThis.ort;
  ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
  // Threads only work when the page is cross-origin isolated (COOP/COEP headers in _headers)
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1;
  return ort;
}

/** Letterboxes a canvas into a 640x640 CHW float tensor shared by both models. */
export class Letterbox {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.data = new Float32Array(3 * SIZE * SIZE);
  }

  prepare(source, sw, sh) {
    const scale = Math.min(SIZE / sw, SIZE / sh);
    const nw = Math.round(sw * scale);
    const nh = Math.round(sh * scale);
    const padX = Math.floor((SIZE - nw) / 2);
    const padY = Math.floor((SIZE - nh) / 2);
    const ctx = this.ctx;
    ctx.fillStyle = 'rgb(114,114,114)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(source, 0, 0, sw, sh, padX, padY, nw, nh);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const area = SIZE * SIZE;
    const d = this.data;
    for (let i = 0, p = 0; i < area; i++, p += 4) {
      d[i] = px[p] / 255;
      d[i + area] = px[p + 1] / 255;
      d[i + 2 * area] = px[p + 2] / 255;
    }
    const tensor = new globalThis.ort.Tensor('float32', d, [1, 3, SIZE, SIZE]);
    return { tensor, scale, padX, padY };
  }
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function nms(boxes, thr) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of boxes) {
    if (keep.every((k) => iou(k, b) < thr)) keep.push(b);
  }
  return keep;
}

export class YoloDetector {
  /**
   * @param {string} url  model url
   * @param {object} opts { classes: number[] | null, conf, iou }
   */
  constructor(url, { classes = null, conf = 0.35, iou: iouThr = 0.45 } = {}) {
    this.url = url;
    this.classes = classes;
    this.conf = conf;
    this.iou = iouThr;
  }

  async load(onProgress) {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`No se pudo descargar ${this.url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress && total) onProgress(got / total);
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    this.session = await globalThis.ort.InferenceSession.create(buf, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
  }

  /** Runs the model on an already letterboxed tensor; boxes come back in source pixels. */
  async run(lb, sw, sh) {
    const out = (await this.session.run({ [this.inputName]: lb.tensor }))[this.outputName];
    const [, ch, n] = out.dims;
    const d = out.data;
    const boxes = [];
    for (let i = 0; i < n; i++) {
      let best = -1, bestScore = 0;
      if (this.classes) {
        for (const c of this.classes) {
          const s = d[(4 + c) * n + i];
          if (s > bestScore) { bestScore = s; best = c; }
        }
      } else {
        for (let c = 0; c < ch - 4; c++) {
          const s = d[(4 + c) * n + i];
          if (s > bestScore) { bestScore = s; best = c; }
        }
      }
      if (bestScore < this.conf) continue;
      const cx = d[i], cy = d[n + i], w = d[2 * n + i], h = d[3 * n + i];
      const x1 = (cx - w / 2 - lb.padX) / lb.scale;
      const y1 = (cy - h / 2 - lb.padY) / lb.scale;
      const x2 = (cx + w / 2 - lb.padX) / lb.scale;
      const y2 = (cy + h / 2 - lb.padY) / lb.scale;
      boxes.push({
        x1: Math.max(0, x1), y1: Math.max(0, y1),
        x2: Math.min(sw, x2), y2: Math.min(sh, y2),
        score: bestScore, cls: best,
      });
    }
    return nms(boxes, this.iou);
  }
}

export { iou };
