// The view state (the visible data range) and the scripted zoom and pan.

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/// The plot size in device pixels: 1600 × 600 CSS pixels at DPR 2.
export const WIDTH = 3200;
export const HEIGHT = 1200;

export function fullView(b: Bounds): View {
  const pad = (b.yMax - b.yMin) * 0.05;
  return { x0: b.xMin, x1: b.xMax, y0: b.yMin - pad, y1: b.yMax + pad };
}

export function sameView(a: View, b: View): boolean {
  return a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1;
}

/// Half a frame at 60 Hz. Every move ends half a frame off the frame grid,
/// so the first frame after a stop comes about 8 ms after it, not 0 or 16 ms
/// by chance of the phase.
const HALF = 1 / 120;

/// Keyframes of the script: time (s), and center and width as fractions of
/// the data span. Between two different keys the view moves (center linear,
/// width on a log scale). Between two equal keys it holds still.
/// The zoomed views stay between 37% and 47% of the span, away from the NaN
/// gap at 60%.
const KEYS: { t: number; c: number; w: number }[] = [
  { t: 0, c: 0.5, w: 1 },
  { t: 1.5 + HALF, c: 0.4, w: 1e-2 }, // zoom in to 1%
  { t: 2.0, c: 0.4, w: 1e-2 },
  { t: 3.0 + HALF, c: 0.405, w: 1e-2 }, // pan by half a view
  { t: 3.5, c: 0.405, w: 1e-2 },
  { t: 4.5 + HALF, c: 0.405, w: 1e-4 }, // zoom in to 0.01%
  { t: 5.0, c: 0.405, w: 1e-4 },
  { t: 6.0 + HALF, c: 0.4051, w: 1e-4 }, // pan by one view
  { t: 6.5, c: 0.4051, w: 1e-4 },
  { t: 7.5 + HALF, c: 0.42, w: 0.1 }, // zoom out to 10%
  { t: 8.0, c: 0.42, w: 0.1 },
  { t: 9.0 + HALF, c: 0.5, w: 1 }, // zoom out to the full view
  { t: 9.5, c: 0.5, w: 1 },
];

type Key = (typeof KEYS)[number];

export const SCRIPT_SECONDS = 9.5;

const still = (a: Key, b: Key) => a.c === b.c && a.w === b.w;

/// The times (s) at which a move ends and the view holds still.
export const STOP_TIMES: number[] = KEYS.filter((k, i) => {
  const prev = KEYS[i - 1];
  const next = KEYS[i + 1];
  return prev !== undefined && next !== undefined && !still(prev, k) && still(k, next);
}).map((k) => k.t);

function keyAt(t: number): { c: number; w: number; moving: boolean } {
  for (let i = 1; i < KEYS.length; i++) {
    const a = KEYS[i - 1] as Key;
    const b = KEYS[i] as Key;
    if (t < b.t) {
      const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
      return { c: a.c + (b.c - a.c) * u, w: a.w * Math.pow(b.w / a.w, u), moving: !still(a, b) };
    }
  }
  const last = KEYS[KEYS.length - 1] as Key;
  return { c: last.c, w: last.w, moving: false };
}

/// The scripted movement: the view at time t (seconds) since the start.
export function scriptedView(b: Bounds, t: number): View {
  const full = fullView(b);
  const k = keyAt(t);
  if (k.w >= 1 && k.c === 0.5) return full;
  const span = full.x1 - full.x0;
  const width = span * k.w;
  const center = full.x0 + span * k.c;
  // y follows the zoom a little, so the transform is not a pure x scale.
  const yc = (full.y0 + full.y1) / 2;
  const yh = ((full.y1 - full.y0) / 2) * Math.max(0.3, Math.sqrt(k.w));
  return { x0: center - width / 2, x1: center + width / 2, y0: yc - yh, y1: yc + yh };
}

export function isMoving(t: number): boolean {
  return keyAt(t).moving;
}
