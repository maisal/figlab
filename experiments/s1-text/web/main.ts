// S1 browser side: draws the draw data from the wasm module on a Canvas 2D with
// Path2D (one cached Path2D per glyph), and compares it with the browser's own
// text rendering of the same font files (FontFace + fillText).
// scripts/measure.mjs drives the functions on `window.s1api` with Playwright.

// Must match FONT_FILES in crates/s1-core/src/lib.rs.
const FONT_FILES = [
  "Arimo-Regular.ttf",
  "Arimo-Italic.ttf",
  "Arimo-Bold.ttf",
  "Tinos-Regular.ttf",
  "NotoSansMath-Regular.ttf",
  "NotoSansSymbols-VF.ttf",
  "NotoSansSymbols2-Regular.ttf",
  "STIXTwoMath-Regular.ttf",
  "LibertinusMath-Regular.ttf",
  "NotoSans-VF.ttf",
  "FiraMath-Regular.otf",
];
const NOTO_MATH = 4;
/** CSS px per pt (96 dpi). */
const PX_PER_PT = 96 / 72;

interface Exports {
  memory: WebAssembly.Memory;
  s1_alloc(len: number): number;
  s1_load_font(id: number, ptr: number, len: number): void;
  s1_init(): void;
  s1_out_ptr(): number;
  s1_draw_sample(shaper: number, fallback: number): number;
  s1_draw_fallback_sheet(shaper: number): number;
  s1_draw_bench(shaper: number, n: number, fallback: number): number;
  s1_layout_bench(shaper: number, n: number, fallback: number): number;
  s1_pdf_sample(kind: number, shaper: number, fallback: number): number;
}

interface Outline {
  font: number;
  gid: number;
  verbs: Uint8Array;
  coords: Int16Array;
}
interface GlyphRef {
  outline: number;
  dx: number;
  dy: number;
}
interface Run {
  font: number;
  rotated: boolean;
  size: number;
  color: number;
  x: number;
  y: number;
  advance: number;
  text: string;
  glyphs: GlyphRef[];
}
interface Line {
  width: number;
  color: number;
  points: number[];
}
interface DrawData {
  upem: number[];
  outlines: Outline[];
  runs: Run[];
  lines: Line[];
}

let wasm: Exports;

async function init(): Promise<void> {
  const fontBufs = await Promise.all(
    FONT_FILES.map(async (f) => {
      const r = await fetch(`/downloads/fonts/${f}`);
      if (!r.ok) throw new Error(`missing font ${f}`);
      return new Uint8Array(await r.arrayBuffer());
    }),
  );
  const { instance } = await WebAssembly.instantiateStreaming(fetch("/dist/s1_all.wasm"), {});
  wasm = instance.exports as unknown as Exports;
  fontBufs.forEach((b, id) => {
    const ptr = wasm.s1_alloc(b.length);
    new Uint8Array(wasm.memory.buffer, ptr, b.length).set(b);
    wasm.s1_load_font(id, ptr, b.length);
  });
  wasm.s1_init();
  // The browser's own rendering of the same files, for the comparison.
  await Promise.all(
    fontBufs.map(async (b, id) => {
      const face = new FontFace(`F${String(id)}`, b.slice().buffer);
      await face.load();
      document.fonts.add(face);
    }),
  );
}

function out(len: number): Uint8Array {
  return new Uint8Array(wasm.memory.buffer, wasm.s1_out_ptr(), len).slice();
}

/** Decodes draw data version 1 (see encode_draw_data in s1-core). */
function decode(bytes: Uint8Array): DrawData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => v.getUint8(p++);
  const u16 = () => {
    const r = v.getUint16(p, true);
    p += 2;
    return r;
  };
  const u32 = () => {
    const r = v.getUint32(p, true);
    p += 4;
    return r;
  };
  const f32 = () => {
    const r = v.getFloat32(p, true);
    p += 4;
    return r;
  };
  const magic = String.fromCharCode(u8(), u8(), u8(), u8());
  if (magic !== "S1DD" || u16() !== 1) throw new Error("bad draw data");
  const nfonts = u8();
  const upem: number[] = [];
  for (let i = 0; i < nfonts; i++) upem.push(u16());
  const outlines: Outline[] = [];
  for (let n = u32(); n > 0; n--) {
    const font = u8();
    const gid = u16();
    const nv = u16();
    const nc = u16();
    const verbs = bytes.slice(p, p + nv);
    p += nv;
    const coords = new Int16Array(nc);
    for (let i = 0; i < nc; i++) {
      coords[i] = v.getInt16(p, true);
      p += 2;
    }
    outlines.push({ font, gid, verbs, coords });
  }
  const dec = new TextDecoder();
  const runs: Run[] = [];
  for (let n = u32(); n > 0; n--) {
    const font = u8();
    const rotated = u8() === 1;
    const size = f32();
    const color = u32();
    const x = f32();
    const y = f32();
    const advance = f32();
    const tl = u16();
    const text = dec.decode(bytes.subarray(p, p + tl));
    p += tl;
    const glyphs: GlyphRef[] = [];
    for (let g = u16(); g > 0; g--) glyphs.push({ outline: u16(), dx: f32(), dy: f32() });
    runs.push({ font, rotated, size, color, x, y, advance, text, glyphs });
  }
  const lines: Line[] = [];
  for (let n = u32(); n > 0; n--) {
    const width = f32();
    const color = u32();
    const points: number[] = [];
    for (let k = u16(); k > 0; k--) points.push(f32(), f32());
    lines.push({ width, color, points });
  }
  return { upem, outlines, runs, lines };
}

function toPath(o: Outline): Path2D {
  const path = new Path2D();
  const c = o.coords;
  let i = 0;
  for (const verb of o.verbs) {
    switch (verb) {
      case 0:
        path.moveTo(c[i], c[i + 1]);
        i += 2;
        break;
      case 1:
        path.lineTo(c[i], c[i + 1]);
        i += 2;
        break;
      case 2:
        path.quadraticCurveTo(c[i], c[i + 1], c[i + 2], c[i + 3]);
        i += 4;
        break;
      case 3:
        path.bezierCurveTo(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5]);
        i += 6;
        break;
      default:
        path.closePath();
    }
  }
  return path;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** Draws the glyphs of the draw data. `s` is device px per pt. */
function drawGlyphs(ctx: CanvasRenderingContext2D, dd: DrawData, s: number, cache: (Path2D | undefined)[]): void {
  for (const r of dd.runs) {
    ctx.fillStyle = hex(r.color);
    const k = (r.size / dd.upem[r.font]) * s;
    for (const g of r.glyphs) {
      let path = cache[g.outline];
      if (!path) {
        path = toPath(dd.outlines[g.outline]);
        cache[g.outline] = path;
      }
      if (r.rotated) {
        // Baseline along -y: glyph (X, Y) goes to (ox - Y k, oy - X k).
        ctx.setTransform(0, -k, -k, 0, (r.x + g.dy) * s, (r.y - g.dx) * s);
      } else {
        ctx.setTransform(k, 0, 0, -k, (r.x + g.dx) * s, (r.y + g.dy) * s);
      }
      ctx.fill(path);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Draws the same runs with the browser's text rendering (fillText). */
function drawBrowserText(ctx: CanvasRenderingContext2D, dd: DrawData, s: number): void {
  ctx.fontKerning = "normal";
  for (const r of dd.runs) {
    ctx.fillStyle = hex(r.color);
    ctx.font = `${String(r.size * s)}px F${String(r.font)}`;
    if (r.rotated) ctx.setTransform(0, -1, 1, 0, r.x * s, r.y * s);
    else ctx.setTransform(1, 0, 0, 1, r.x * s, r.y * s);
    ctx.fillText(r.text, 0, 0);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawLines(ctx: CanvasRenderingContext2D, dd: DrawData, s: number): void {
  ctx.lineJoin = "round";
  for (const l of dd.lines) {
    ctx.strokeStyle = hex(l.color);
    ctx.lineWidth = l.width * s;
    ctx.beginPath();
    for (let i = 0; i < l.points.length; i += 2) {
      if (i === 0) ctx.moveTo(l.points[i] * s, l.points[i + 1] * s);
      else ctx.lineTo(l.points[i] * s, l.points[i + 1] * s);
    }
    ctx.stroke();
  }
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  return ctx;
}

/** Ink (0..255) per pixel, from the darkest channel. */
function ink(ctx: CanvasRenderingContext2D): Uint8Array {
  const { width, height } = ctx.canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  const r = new Uint8Array(width * height);
  for (let i = 0; i < r.length; i++) r[i] = 255 - Math.min(d[4 * i], d[4 * i + 1], d[4 * i + 2]);
  return r;
}

function centroid(a: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.ceil(y1); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
      const v = a[y * w + x];
      sx += v * (x + 0.5);
      sy += v * (y + 0.5);
      m += v;
    }
  }
  return m > 0 ? [sx / m, sy / m, m] : [0, 0, 0];
}

const PAGE = { w: 300, h: 330 };

/**
 * Compares glyph drawing on the sample page with a reference at this device pixel
 * ratio. The reference is the browser's fillText, or (with `pdfImage`) a PNG of
 * the PDF rendered at the same scale; then the lines are drawn too.
 */
async function compare(shaper: number, pdfImage?: string) {
  const dpr = window.devicePixelRatio;
  const s = PX_PER_PT * dpr;
  const bytes = out(wasm.s1_draw_sample(shaper, NOTO_MATH));
  const dd = decode(bytes);
  const W = PAGE.w * s;
  const H = PAGE.h * s;
  const a = canvas(W, H);
  if (pdfImage) drawLines(a, dd, s);
  drawGlyphs(a, dd, s, []);
  const b = canvas(W, H);
  if (pdfImage) {
    const r = await fetch(pdfImage);
    // A larger render is scaled down to the canvas size.
    b.imageSmoothingQuality = "high";
    b.drawImage(await createImageBitmap(await r.blob()), 0, 0, b.canvas.width, b.canvas.height);
  } else {
    drawBrowserText(b, dd, s);
  }
  const ia = ink(a);
  const ib = ink(b);
  const w = a.canvas.width;
  // Per run: advance (ours vs measureText) and ink centroid (ours vs browser).
  const runs = dd.runs.map((r) => {
    b.font = `${String(r.size * s)}px F${String(r.font)}`;
    const browserAdvance = pdfImage ? r.advance : b.measureText(r.text).width / s;
    const len = r.advance * s;
    const asc = r.size * s * 1.0;
    const desc = r.size * s * 0.35;
    const [x0, y0, x1, y1] = r.rotated
      ? [r.x * s - asc, r.y * s - len, r.x * s + desc, r.y * s]
      : [r.x * s, r.y * s - asc, r.x * s + len, r.y * s + desc];
    const ca = centroid(ia, w, x0, y0, x1, y1);
    const cb = centroid(ib, w, x0, y0, x1, y1);
    return {
      text: r.text,
      font: r.font,
      size: r.size,
      advancePt: r.advance,
      browserAdvancePt: browserAdvance,
      advanceDiffPt: browserAdvance - r.advance,
      centroidDx: ca[2] && cb[2] ? cb[0] - ca[0] : null,
      centroidDy: ca[2] && cb[2] ? cb[1] - ca[1] : null,
      inkRatio: ca[2] ? cb[2] / ca[2] : null,
    };
  });
  // Pixel statistics over pixels with ink in either image.
  let n = 0;
  let sum = 0;
  let max = 0;
  let over64 = 0;
  for (let i = 0; i < ia.length; i++) {
    if (ia[i] === 0 && ib[i] === 0) continue;
    const d = Math.abs(ia[i] - ib[i]);
    n++;
    sum += d;
    if (d > max) max = d;
    if (d > 64) over64++;
  }
  // Comparison image of the left column of sample texts: ours, browser, overlay.
  const crop = { x: 6 * s, y: 186 * s, w: 146 * s, h: 128 * s };
  const img = canvas(crop.w * 3 + 2 * 4 * dpr, crop.h);
  img.drawImage(a.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  img.drawImage(b.canvas, crop.x, crop.y, crop.w, crop.h, crop.w + 4 * dpr, 0, crop.w, crop.h);
  const ov = img.createImageData(Math.ceil(crop.w), Math.ceil(crop.h));
  for (let y = 0; y < ov.height; y++) {
    for (let x = 0; x < ov.width; x++) {
      const si = Math.floor(crop.y + y) * w + Math.floor(crop.x + x);
      const o = 4 * (y * ov.width + x);
      // Ours only: red. Browser only: cyan. Both: dark.
      ov.data[o] = 255 - ib[si];
      ov.data[o + 1] = 255 - ia[si];
      ov.data[o + 2] = 255 - ia[si];
      ov.data[o + 3] = 255;
    }
  }
  img.putImageData(ov, Math.round(2 * crop.w + 8 * dpr), 0);
  return {
    dpr,
    drawDataBytes: bytes.length,
    outlines: dd.outlines.length,
    runs,
    pixels: { inked: n, meanAbsDiff: n ? sum / n : 0, maxAbsDiff: max, fractionOver64: n ? over64 / n : 0 },
    png: img.canvas.toDataURL("image/png"),
  };
}

/** The sample page and the fallback sheet drawn from glyphs, as PNG data URLs. */
function images(shaper: number) {
  const dpr = window.devicePixelRatio;
  const s = PX_PER_PT * dpr;
  const dd = decode(out(wasm.s1_draw_sample(shaper, NOTO_MATH)));
  const page = canvas(PAGE.w * s, PAGE.h * s);
  drawLines(page, dd, s);
  drawGlyphs(page, dd, s, []);
  const fb = decode(out(wasm.s1_draw_fallback_sheet(shaper)));
  const sheet = canvas(520 * s, 250 * s);
  drawGlyphs(sheet, fb, s, []);
  const sheetBrowser = canvas(520 * s, 250 * s);
  drawBrowserText(sheetBrowser, fb, s);
  return {
    page: page.canvas.toDataURL("image/png"),
    sheet: sheet.canvas.toDataURL("image/png"),
    sheetBrowser: sheetBrowser.canvas.toDataURL("image/png"),
  };
}

function stats(v: number[]) {
  const a = [...v].sort((x, y) => x - y);
  return {
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
    runs: a.length,
  };
}

/**
 * Times `f`. Browsers round performance.now() (to 0.1 ms in Chrome), so each
 * sample runs `f` k times, with k chosen so that a sample takes about 10 ms.
 */
function time(reps: number, f: () => void) {
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) f();
  const est = Math.max((performance.now() - t0) / 5, 0.001);
  const k = Math.min(1000, Math.max(1, Math.ceil(10 / est)));
  const v: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    for (let j = 0; j < k; j++) f();
    v.push((performance.now() - t) / k);
  }
  return { ...stats(v), perSample: k };
}

/** Timing for `n` labels. "flush" adds a 1-pixel getImageData so that the GPU work is included. */
function bench(n: number, shaper: number, reps: number) {
  const dpr = window.devicePixelRatio;
  const s = PX_PER_PT * dpr;
  const len = wasm.s1_draw_bench(shaper, n, NOTO_MATH);
  const bytes = out(len);
  const dd = decode(bytes);
  const glyphs = dd.runs.reduce((acc, r) => acc + r.glyphs.length, 0);
  const ctx = canvas(640 * s, (Math.ceil(n / 4) * 14 + 20) * s);
  const clear = () => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
  const flush = () => ctx.getImageData(0, 0, 1, 1);
  const warm: (Path2D | undefined)[] = [];
  drawGlyphs(ctx, dd, s, warm);
  return {
    dpr,
    labels: n,
    runs: dd.runs.length,
    glyphs,
    outlines: dd.outlines.length,
    drawDataBytes: bytes.length,
    layoutOnly: time(reps, () => wasm.s1_layout_bench(shaper, n, NOTO_MATH)),
    layoutAndDrawData: time(reps, () => wasm.s1_draw_bench(shaper, n, NOTO_MATH)),
    decode: time(reps, () => decode(out(len))),
    drawCold: time(reps, () => {
      clear();
      drawGlyphs(ctx, dd, s, []);
    }),
    drawCachedPaths: time(reps, () => {
      clear();
      drawGlyphs(ctx, dd, s, warm);
    }),
    drawCachedPathsFlush: time(reps, () => {
      clear();
      drawGlyphs(ctx, dd, s, warm);
      flush();
    }),
    fillTextFlush: time(reps, () => {
      clear();
      drawBrowserText(ctx, dd, s);
      flush();
    }),
    pdfKrilla: time(Math.max(10, reps / 4), () => wasm.s1_pdf_sample(0, 1, NOTO_MATH)),
    pdfWriter: time(Math.max(10, reps / 4), () => wasm.s1_pdf_sample(1, 1, NOTO_MATH)),
  };
}

declare global {
  interface Window {
    s1api: { compare: typeof compare; images: typeof images; bench: typeof bench };
    s1ready: boolean | string;
  }
}

window.s1api = { compare, images, bench };
init().then(
  () => {
    window.s1ready = true;
    const st = document.getElementById("status");
    if (st) st.textContent = "ready";
  },
  (e: unknown) => {
    window.s1ready = String(e);
  },
);

export {};
