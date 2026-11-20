// Lightweight IoU tracker (the browser stand-in for SORT): keeps a stable id per vehicle
// so speed and the best plate reading can be accumulated over time.
import { iou } from './detector.js';

let nextId = 1;

export class Tracker {
  constructor({ iouThr = 0.2, maxAgeMs = 1200, smooth = 0.55 } = {}) {
    this.iouThr = iouThr;
    this.maxAgeMs = maxAgeMs;
    this.smooth = smooth;
    this.tracks = [];
  }

  reset() {
    this.tracks = [];
  }

  /** @returns {Array} tracks matched/created this step, each with `.det` = raw detection */
  update(dets, tMs) {
    // Drop stale tracks (also handles video seeks backwards)
    this.tracks = this.tracks.filter((t) => tMs >= t.lastSeen && tMs - t.lastSeen <= this.maxAgeMs);

    const pairs = [];
    this.tracks.forEach((t, ti) => {
      dets.forEach((d, di) => {
        const v = iou(t.box, d);
        if (v >= this.iouThr) pairs.push({ ti, di, v });
      });
    });
    pairs.sort((a, b) => b.v - a.v);

    const usedT = new Set();
    const usedD = new Set();
    const active = [];
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      const t = this.tracks[ti];
      const d = dets[di];
      const s = this.smooth;
      t.box = {
        x1: t.box.x1 * (1 - s) + d.x1 * s,
        y1: t.box.y1 * (1 - s) + d.y1 * s,
        x2: t.box.x2 * (1 - s) + d.x2 * s,
        y2: t.box.y2 * (1 - s) + d.y2 * s,
      };
      t.det = d;
      t.lastSeen = tMs;
      t.hits++;
      active.push(t);
    }
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      const t = {
        id: nextId++,
        box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
        det: d,
        cls: d.cls,
        firstSeen: tMs,
        lastSeen: tMs,
        hits: 1,
        plate: null,      // { rel: {x1,y1,x2,y2} relative to car box, crop: canvas, lastOcr }
        reading: null,    // { text, type, score, crop }
        votes: new Map(), // plate text -> { count, score, crop, type }
        speedKmh: null,
        maxSpeedKmh: null,
      };
      this.tracks.push(t);
      active.push(t);
    });
    return active;
  }
}
