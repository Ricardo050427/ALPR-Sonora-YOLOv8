// Plate OCR with Tesseract.js (self-hosted worker, core and language data).
// Mirrors read_license_plate() in util.py: read the whole crop first and, if that
// does not give a valid plate, read only the central band (drops the state banners).
import { findPlateInText } from './plates.js';

const base = new URL('../vendor/tesseract/', import.meta.url).href;

export class PlateReader {
  async load() {
    const T = globalThis.Tesseract;
    this.worker = await T.createWorker('eng', 1 /* OEM.LSTM_ONLY */, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base + 'lang',
      workerBlobURL: false,
      gzip: true,
    });
    await this.worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      tessedit_pageseg_mode: '7', // single text line
    });
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Grayscale + upscale + Otsu threshold (dark characters on white). */
  binarize(src, sy0 = 0, sy1 = 1) {
    const sw = src.width;
    const sh = src.height;
    const y0 = Math.floor(sh * sy0);
    const hh = Math.max(1, Math.floor(sh * (sy1 - sy0)));
    const targetH = 110;
    const scale = targetH / hh;
    const w = Math.max(8, Math.round(sw * scale));
    const pad = 16;
    const c = this.canvas;
    c.width = w + pad * 2;
    c.height = targetH + pad * 2;
    const ctx = this.ctx;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, y0, sw, hh, pad, pad, w, targetH);
    const img = ctx.getImageData(pad, pad, w, targetH);
    const d = img.data;
    const hist = new Array(256).fill(0);
    const gray = new Uint8Array(w * targetH);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
      gray[i] = g;
      hist[g]++;
    }
    // Otsu
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const v = gray[i] > thr ? 255 : 0;
      d[p] = d[p + 1] = d[p + 2] = v;
    }
    ctx.putImageData(img, pad, pad);
    return c;
  }

  async readOnce(crop, y0, y1) {
    const bin = this.binarize(crop, y0, y1);
    const { data } = await this.worker.recognize(bin);
    const found = findPlateInText(data.text);
    if (!found) return null;
    return { ...found, score: Math.max(0, Math.min(1, data.confidence / 100)), raw: data.text.trim() };
  }

  /** @returns {Promise<{plate,type,conversions,score,raw}|null>} */
  async read(crop) {
    if (!this.worker || !crop || crop.width < 12 || crop.height < 6) return null;
    const full = await this.readOnce(crop, 0, 1);
    if (full) return full;
    // Fallback for Mexican plates: crop out top 18% and bottom 18% (state banners)
    if (crop.height > 20 && crop.width > 40) return this.readOnce(crop, 0.18, 0.82);
    return null;
  }
}
