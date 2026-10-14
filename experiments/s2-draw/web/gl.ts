// WebGL markers: all 10 million points are sent to the GPU once, in data
// coordinates. Zoom and pan are a uniform transform (spec.md 9.3).
//
// x precision. Four modes; "fixed" is the one to use:
// - "fixed": x as integer fixed point, q = round((x − origin) / step) with
//   step = span / 2^40, sent as two int32 words (q = hi × 2^30 + lo). The
//   shader subtracts the words of the view's x0 as integers, which is exact
//   and not touched by float reordering in the shader compiler. Only then
//   does it convert to float (src/lib.rs shader_clip_f32 emulates it).
// - "naive": f32(x). At x = 1e6 the f32 spacing is 0.0625, so steps of
//   1e-3 collapse.
// - "offset": f32(x − origin), the origin subtracted in f64 on the CPU. The
//   f32 spacing of the remainder (about 1e-3 near 1e4) still limits it.
// - "hilo": hi = f32(x), lo = f32(x − hi); the shader computes
//   (hi − x0hi) + (lo − x0lo). Shown as a failure: the shader compilers in
//   Chrome and WebKit reorder it, and the result is off by up to x0 − f32(x0).
//
// The main buffer (fixed x and y, 12 bytes per point) is the product layout.
// The reference modes use a second buffer (8 bytes per point) that is only
// filled for the precision check.

import { HEIGHT, WIDTH, type View } from "./view";

/// "hilo-lo" is a diagnostic: it draws the lo part alone, to show that lo
/// reaches the GPU.
export type GlMode = "naive" | "offset" | "hilo" | "fixed" | "hilo-lo";
const MODE_INDEX: Record<GlMode, number> = { naive: 0, offset: 1, hilo: 2, fixed: 3, "hilo-lo": 4 };

const VERT = `#version 300 es
in ivec2 a_w;
in float a_y;
in vec2 a_ref;
uniform int u_mode;
uniform ivec2 u_w;
uniform float u_scale;
uniform vec2 u_ref;
uniform float u_sx;
uniform float u_y0;
uniform float u_sy;
uniform float u_size;
out float v_clip;
void main() {
  float cx;
  if (u_mode == 3) {
    int dhi = a_w.x - u_w.x;
    int dlo = a_w.y - u_w.y;
    float d;
    if (dhi >= -1 && dhi <= 1) {
      d = float(dhi * 1073741824 + dlo);
    } else {
      d = float(dhi) * 1073741824.0 + float(dlo);
    }
    cx = d * u_scale - 1.0;
  } else if (u_mode == 2) {
    cx = ((a_ref.x - u_ref.x) + (a_ref.y - u_ref.y)) * u_sx - 1.0;
  } else if (u_mode == 4) {
    cx = a_ref.y * u_sx - 1.0;
  } else {
    cx = (a_ref.x - u_ref.x) * u_sx - 1.0;
  }
  v_clip = cx;
  gl_Position = vec4(cx, (a_y - u_y0) * u_sy - 1.0, 0.0, 1.0);
  gl_PointSize = u_size;
}`;

const FRAG = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.12, 0.37, 0.75, 1.0); }`;

const WORD = 1073741824; // 2^30
const Q_LIMIT = 9007199254740992; // 2^53

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type) as WebGLShader;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
  }
  return s;
}

export class GlMarkers {
  readonly gl: WebGL2RenderingContext;
  private readonly prog: WebGLProgram;
  private readonly u: Record<string, WebGLUniformLocation | null>;
  private readonly loc: { w: number; y: number; ref: number };
  private main: WebGLBuffer | null = null;
  private ref: WebGLBuffer | null = null;
  count = 0;
  mode: GlMode = "fixed";
  pointSize = 2;
  origin = 0;
  step = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const prog = gl.createProgram() as WebGLProgram;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    // v_clip can be captured with transform feedback (the precision check).
    gl.transformFeedbackVaryings(prog, ["v_clip"], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    }
    this.prog = prog;
    gl.useProgram(prog);
    this.u = {};
    for (const name of ["u_mode", "u_w", "u_scale", "u_ref", "u_sx", "u_y0", "u_sy", "u_size"]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    this.loc = {
      w: gl.getAttribLocation(prog, "a_w"),
      y: gl.getAttribLocation(prog, "a_y"),
      ref: gl.getAttribLocation(prog, "a_ref"),
    };
    gl.viewport(0, 0, WIDTH, HEIGHT);
    gl.clearColor(1, 1, 1, 1);
  }

  /// Which GPU the browser uses.
  rendererInfo(): { vendor: string; renderer: string } {
    const gl = this.gl;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { vendor: String(vendor), renderer: String(renderer) };
  }

  /// Allocates the main buffer for n points (frees the old one).
  allocMain(n: number, origin: number, step: number): void {
    const gl = this.gl;
    if (this.main) gl.deleteBuffer(this.main);
    if (this.ref) gl.deleteBuffer(this.ref);
    this.ref = null;
    gl.disableVertexAttribArray(this.loc.ref);
    gl.vertexAttrib2f(this.loc.ref, 0, 0);
    this.count = n;
    this.origin = origin;
    this.step = step;
    this.main = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.main);
    gl.bufferData(gl.ARRAY_BUFFER, n * 12, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.w);
    gl.vertexAttribIPointer(this.loc.w, 2, gl.INT, 12, 0);
    gl.enableVertexAttribArray(this.loc.y);
    gl.vertexAttribPointer(this.loc.y, 1, gl.FLOAT, false, 12, 8);
  }

  /// Copies one chunk of the main data (12 bytes per point) to the GPU.
  writeMain(start: number, data: ArrayBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.main);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * 12, new Uint8Array(data));
  }

  /// Allocates the reference buffer (8 bytes per point; frees the old one).
  allocRef(): void {
    const gl = this.gl;
    if (this.ref) gl.deleteBuffer(this.ref);
    this.ref = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ref);
    gl.bufferData(gl.ARRAY_BUFFER, this.count * 8, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc.ref);
    gl.vertexAttribPointer(this.loc.ref, 2, gl.FLOAT, false, 8, 0);
  }

  /// Copies one chunk of the reference data (8 bytes per point) to the GPU.
  writeRef(start: number, data: ArrayBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ref);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * 8, new Uint8Array(data));
  }

  /// The two words of the view's x0 in fixed point.
  fixedWords(x0: number): [number, number] {
    let q = Math.round((x0 - this.origin) / this.step);
    q = Math.min(Q_LIMIT, Math.max(-Q_LIMIT, q));
    const hi = Math.floor(q / WORD);
    return [hi, q - hi * WORD];
  }

  private setUniforms(view: View): void {
    const gl = this.gl;
    const u = (n: string) => this.u[n] ?? null;
    gl.useProgram(this.prog);
    gl.uniform1i(u("u_mode"), MODE_INDEX[this.mode]);
    const [whi, wlo] = this.fixedWords(view.x0);
    gl.uniform2i(u("u_w"), whi, wlo);
    gl.uniform1f(u("u_scale"), (2 * this.step) / (view.x1 - view.x0));
    let r0 = 0;
    let r1 = 0;
    if (this.mode === "naive") r0 = Math.fround(view.x0);
    if (this.mode === "offset") r0 = Math.fround(view.x0 - this.origin);
    if (this.mode === "hilo" || this.mode === "hilo-lo") {
      r0 = Math.fround(view.x0);
      r1 = Math.fround(view.x0 - r0);
    }
    gl.uniform2f(u("u_ref"), r0, r1);
    gl.uniform1f(u("u_sx"), 2 / (view.x1 - view.x0));
    gl.uniform1f(u("u_y0"), view.y0);
    gl.uniform1f(u("u_sy"), 2 / (view.y1 - view.y0));
    gl.uniform1f(u("u_size"), this.pointSize);
  }

  /// Draws the points [first, first + count) for `view`. The uniforms are
  /// the only per-frame data.
  draw(view: View, first = 0, count = this.count): void {
    const gl = this.gl;
    this.setUniforms(view);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, first, count);
  }

  /// Waits for the GPU (readPixels of one pixel forces a sync).
  sync(): void {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  /// Draws and waits for the GPU. Returns the wall time in ms.
  drawSync(view: View): number {
    const t0 = performance.now();
    this.draw(view);
    this.sync();
    return performance.now() - t0;
  }

  /// The clip-space x that the vertex shader computes for the points
  /// [first, first + count), read back with transform feedback. This is the
  /// position the GPU draws, from the same shader.
  capture(view: View, first: number, count: number): Float32Array {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    const tf = gl.createTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
    this.setUniforms(view);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, first, count);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    const out = new Float32Array(count);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    gl.deleteBuffer(buf);
    gl.deleteTransformFeedback(tf);
    return out;
  }

  /// Reads the frame back: one flag per pixel column, 1 if any pixel in it
  /// is drawn.
  litColumns(): Uint8Array {
    const gl = this.gl;
    const px = new Uint8Array(WIDTH * HEIGHT * 4);
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const lit = new Uint8Array(WIDTH);
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      if ((px[i * 4] as number) < 250) lit[i % WIDTH] = 1;
    }
    return lit;
  }
}
