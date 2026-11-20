// Speed estimation for a handheld / fixed camera without road calibration.
//
// The desktop SpeedEstimator (speed_estimator.py) projects the bottom-center of the
// vehicle box onto the road with a homography. A phone has no calibrated road plane,
// so here the distance to each vehicle comes from the pinhole model and a known size:
//
//   Z = fx * W_real / w_px        (depth, metres)
//   X = (u - cx) * Z / fx         (lateral offset, metres)
//
// W_real is an average vehicle width (1.8 m). fx is the focal length in pixels,
// derived from the camera's horizontal field of view and the current zoom.
// Speed = displacement of (X, Z) over a time window, smoothed with the same EMA
// (alpha 0.3) used in speed_estimator.py.

export function focalFromFov(frameWidthPx, hfovDeg, zoom = 1) {
  const rad = (hfovDeg * Math.PI) / 180;
  return (frameWidthPx / 2 / Math.tan(rad / 2)) * zoom;
}

/** Least-squares slope of v over t (units per ms). */
function slope(hist, key) {
  const n = hist.length;
  let st = 0, sv = 0;
  for (const h of hist) { st += h.t; sv += h[key]; }
  const mt = st / n, mv = sv / n;
  let num = 0, den = 0;
  for (const h of hist) { num += (h.t - mt) * (h[key] - mv); den += (h.t - mt) * (h.t - mt); }
  return den > 0 ? num / den : 0;
}

export class SpeedEstimator {
  constructor({ vehicleWidthM = 1.8, windowMs = 1500, minSamples = 5, alpha = 0.3, maxKmh = 220, minWidthPx = 48 } = {}) {
    this.vehicleWidthM = vehicleWidthM;
    this.windowMs = windowMs;
    this.minSamples = minSamples;
    this.alpha = alpha;
    this.maxKmh = maxKmh;
    this.minWidthPx = minWidthPx;
  }

  /** Converts a box (frame pixels) into ground coordinates in metres. */
  toMetres(box, fx, cx) {
    const w = Math.max(1, box.x2 - box.x1);
    const z = (fx * this.vehicleWidthM) / w;
    const u = (box.x1 + box.x2) / 2;
    const x = ((u - cx) * z) / fx;
    return { x, z };
  }

  /**
   * @param {object} track  tracker track; history and speed are stored on it
   * @param {object} box    {x1,y1,x2,y2} in frame pixels
   * @param {number} tMs    timestamp in ms (video time for files, clock for camera)
   * @returns {number|null} smoothed km/h
   */
  update(track, box, tMs, fx, cx, frameW = Infinity, frameH = Infinity) {
    const hist = track.speedHist || (track.speedHist = []);
    // A jump back in time (video seek / loop) resets the history
    if (hist.length && tMs <= hist[hist.length - 1].t) hist.length = 0;

    // Far-away vehicles (tiny boxes) and vehicles cut by the frame edge give
    // unreliable widths, so they do not feed the estimate
    const w = box.x2 - box.x1;
    const cut = box.x1 < 3 || box.x2 > frameW - 3 || box.y2 > frameH - 3;
    if (w < this.minWidthPx || cut) return track.speedKmh ?? null;

    const p = this.toMetres(box, fx, cx);
    hist.push({ t: tMs, x: p.x, z: p.z });
    while (hist.length > 2 && tMs - hist[0].t > this.windowMs) hist.shift();
    track.distanceM = p.z;

    if (hist.length < this.minSamples) return track.speedKmh ?? null;
    const dt = (hist[hist.length - 1].t - hist[0].t) / 1000;
    if (dt < 0.5) return track.speedKmh ?? null;

    // Regression over the whole window instead of the two endpoints: one bad box
    // (occlusion, partial detection) barely moves the result
    const vx = slope(hist, 'x') * 1000;
    const vz = slope(hist, 'z') * 1000;
    const kmh = Math.hypot(vx, vz) * 3.6;
    if (!Number.isFinite(kmh) || kmh > this.maxKmh) return track.speedKmh ?? null;

    const prev = track.speedKmh ?? kmh;
    track.speedKmh = this.alpha * kmh + (1 - this.alpha) * prev;
    return track.speedKmh;
  }
}
