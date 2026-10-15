// Code shared by the page and the workers of the S3 experiment.

/** Absolute time in ms. It can be compared between the page and its workers. */
export function now() {
  return performance.timeOrigin + performance.now();
}

/** The smallest step of performance.now() seen in a short loop, in ms. */
export function timerResolution() {
  let best = Infinity;
  for (let i = 0; i < 50; i++) {
    const a = performance.now();
    let b = a;
    while (b === a) b = performance.now();
    best = Math.min(best, b - a);
  }
  return best;
}

/** Median, p95 (nearest rank), min, max, mean, and the number of runs. */
export function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { n: 0 };
  const rank = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return {
    n,
    median: round(median),
    p95: round(rank(0.95)),
    min: round(s[0]),
    max: round(s[n - 1]),
    mean: round(mean),
  };
}

function round(x) {
  return Number(x.toPrecision(4));
}

/** Number of runs for a case of the given size, so that big cases do not take too long. */
export function runsFor(bytes, quick) {
  const n = bytes <= 8e6 ? 40 : bytes <= 100e6 ? 20 : 10;
  return quick ? Math.max(3, Math.ceil(n / 4)) : n;
}

/**
 * Times `fn` and returns per-call samples in ms.
 * When one call is shorter than `minSampleMs`, each sample runs `fn` several
 * times and divides, so that the timer resolution does not hide the cost.
 */
export async function timeOp(fn, { runs, minSampleMs, warmup = 2 }) {
  // Await only real promises: an await on a plain value costs more than a small copy.
  const call = async (n) => {
    for (let i = 0; i < n; i++) {
      const r = fn();
      if (r && typeof r.then === "function") await r;
    }
  };
  await call(warmup);
  let batch = 1;
  for (;;) {
    const t0 = performance.now();
    await call(batch);
    const dt = performance.now() - t0;
    if (dt >= minSampleMs || batch >= 1 << 20) break;
    batch *= dt <= 0 ? 16 : Math.min(16, Math.ceil((minSampleMs / dt) * 1.2));
  }
  const samples = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    await call(batch);
    samples.push((performance.now() - t0) / batch);
  }
  return { samples, batch };
}

/** A new ArrayBuffer of `bytes` bytes, with every page written. */
export function makeBuffer(bytes) {
  const buf = new ArrayBuffer(bytes);
  new Uint8Array(buf).fill(7);
  return buf;
}

/** Loads the experiment's wasm module. Returns the exports of a new instance. */
export async function loadWasm() {
  const { instance } = await WebAssembly.instantiateStreaming(
    fetch("/wasm/s3_transfer.wasm"),
  );
  return { exports: instance.exports };
}

/** Name and message of an error, for the results. */
export function errorText(e) {
  return `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
}

/**
 * One end of a message channel (a Worker, the worker's global scope, or a MessagePort).
 *
 * - `call(op, args)` sends a request and resolves with the reply.
 * - Requests from the other side go to `handlers[op]`, which returns
 *   `{ result, transfer }`.
 * - Other messages go to a waiter from `next()`, or else to `handlers.bench`.
 *   Each message carries the time it was received, `t`, taken right after the
 *   first read of `e.data` (so after the browser has deserialized it).
 */
export class Endpoint {
  constructor(port, handlers) {
    this.port = port;
    this.handlers = handlers;
    this.waiters = [];
    this.pending = new Map();
    this.nextId = 1;
    port.onmessage = (e) => this.dispatch(e);
  }

  dispatch(e) {
    // Read e.data first: Chrome and WebKit deserialize the message on the
    // first access to e.data, so a copy (structured clone) is paid here.
    const d = e.data;
    const t = now();
    if (d && d.reply !== undefined) {
      const resolve = this.pending.get(d.reply);
      this.pending.delete(d.reply);
      resolve({ result: d.result, error: d.error, t });
      return;
    }
    if (d && d.call !== undefined) {
      this.serve(d);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter({ data: d, t });
    else this.handlers.bench?.(d, t, this);
  }

  async serve(d) {
    try {
      const { result, transfer = [] } = await this.handlers[d.op](d.args, this);
      this.port.postMessage({ reply: d.call, result }, transfer);
    } catch (e) {
      this.port.postMessage({ reply: d.call, error: errorText(e) });
    }
  }

  /** Sends a request. Resolves with `{ result, error, t }`. */
  callRaw(op, args = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.port.postMessage({ call: id, op, args }, transfer);
    });
  }

  /** Sends a request and returns the result, or throws the remote error. */
  async call(op, args = {}, transfer = []) {
    const r = await this.callRaw(op, args, transfer);
    if (r.error) throw new Error(r.error);
    return r.result;
  }

  post(msg, transfer = []) {
    this.port.postMessage(msg, transfer);
  }

  /** The next message that is not a request or a reply. */
  next() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/**
 * The default handler for benchmark messages. Every context uses it, so any
 * context can be the receiver.
 * - `echo`: send the buffer straight back (by transfer or by copy, as sent).
 * - `oneway`: reply with the one-way time, and give the buffer back if it was transferred.
 */
export function benchHandler(d, t, ep) {
  if (d.kind === "echo") {
    if (d.mode === "transfer") ep.post({ kind: "echo", buf: d.buf }, [d.buf]);
    else ep.post({ kind: "echo", buf: d.buf });
  } else if (d.kind === "oneway") {
    const dt = t - d.t0;
    if (d.mode === "transfer")
      ep.post({ kind: "ack", dt, buf: d.buf }, [d.buf]);
    else ep.post({ kind: "ack", dt });
  }
}

/** Round trips of a buffer over `ep`. The other side runs `benchHandler`. */
export async function roundTrips(ep, bytes, mode, runs, minSampleMs) {
  let buf = makeBuffer(bytes);
  const once = async () => {
    ep.post({ kind: "echo", mode, buf }, mode === "transfer" ? [buf] : []);
    const r = await ep.next();
    if (mode === "transfer") buf = r.data.buf;
  };
  const { samples, batch } = await timeOp(once, {
    runs,
    minSampleMs,
    warmup: 2,
  });
  return { ...stats(samples), batch };
}

/**
 * One-way times over `ep`: the receiver subtracts the send time from its own
 * receive time. Also returns how long `postMessage` blocked the sender.
 */
export async function oneWays(ep, bytes, mode, runs) {
  let buf = makeBuffer(bytes);
  const oneway = [];
  const post = [];
  for (let i = -2; i < runs; i++) {
    const t0 = now();
    ep.post(
      { kind: "oneway", mode, t0, buf },
      mode === "transfer" ? [buf] : [],
    );
    const t1 = now();
    const r = await ep.next();
    if (mode === "transfer") buf = r.data.buf;
    if (i >= 0) {
      oneway.push(r.data.dt);
      post.push(t1 - t0);
    }
  }
  return { oneway: stats(oneway), post: stats(post) };
}
