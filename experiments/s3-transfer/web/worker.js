// A worker of the S3 experiment. Worker A plays the compute worker: it holds
// arrays in its wasm memory. Worker B is a second worker, reached from A
// through a MessageChannel port (like the language service worker).

import {
  Endpoint,
  benchHandler,
  errorText,
  loadWasm,
  now,
  oneWays,
  roundTrips,
  stats,
  timeOp,
  runsFor,
} from "./common.js";

let wasm;
let peer; // Endpoint to the other worker
let role;
const arrays = {}; // name -> { ptr, n, bytes } in wasm memory
let held = null; // an ArrayBuffer kept alive for the memory steps

const f64 = (ptr, n) => new Float64Array(wasm.memory.buffer, ptr, n);

function allocArray(name, n) {
  const bytes = n * 8;
  const ptr = wasm.alloc_bytes(bytes);
  if (ptr === 0) throw new Error(`alloc of ${bytes} bytes failed`);
  wasm.fill_f64(ptr, n);
  arrays[name] = { ptr, n, bytes };
  return arrays[name];
}

function freeArray(name) {
  const a = arrays[name];
  if (!a) return;
  wasm.free_bytes(a.ptr, a.bytes);
  delete arrays[name];
}

/** Copies an ArrayBuffer into a new allocation in wasm memory. */
function copyIn(buf) {
  const n = buf.byteLength / 8;
  const ptr = wasm.alloc_bytes(buf.byteLength);
  if (ptr === 0) throw new Error("alloc failed");
  // Make the view after the allocation: a grow detaches the old memory.buffer.
  f64(ptr, n).set(new Float64Array(buf));
  return ptr;
}

const handlers = {
  bench: benchHandler,

  async init({ name, port }) {
    role = name;
    wasm = (await loadWasm()).exports;
    if (port) peer = new Endpoint(port, handlers);
    return { result: { role, crossOriginIsolated: self.crossOriginIsolated } };
  },

  // Messaging from this worker to the page ("main") or to the other worker ("peer").
  async roundTrips({ to, bytes, mode, runs, minSampleMs }, ep) {
    const target = to === "peer" ? peer : ep;
    return { result: await roundTrips(target, bytes, mode, runs, minSampleMs) };
  },
  async oneWays({ to, bytes, mode, runs }, ep) {
    const target = to === "peer" ? peer : ep;
    return { result: await oneWays(target, bytes, mode, runs) };
  },

  // Copies at the wasm boundary, all inside this worker.
  async wasmCopies({ sizes, quick, minSampleMs }) {
    const out = {};
    for (const bytes of sizes) {
      const n = bytes / 8;
      const runs = runsFor(bytes, quick);
      const opt = { runs, minSampleMs };
      const r = {};
      try {
        const src = allocArray("copy", n);
        const pool = new Float64Array(n).fill(0.5); // a reused buffer, pages already touched
        const time = async (name, fn) => {
          const { samples, batch } = await timeOp(fn, opt);
          r[name] = { ...stats(samples), batch };
        };
        await time("outSlice", () =>
          wasm.memory.buffer.slice(src.ptr, src.ptr + bytes),
        );
        await time("outTypedSlice", () => f64(src.ptr, n).slice());
        await time("outNewSet", () => new Float64Array(n).set(f64(src.ptr, n)));
        await time("outPooled", () => pool.set(f64(src.ptr, n)));
        await time("newBuffer", () => new ArrayBuffer(bytes));
        await time("newBufferFill", () => new Float64Array(n).fill(0.5));
        await time("pooledFill", () => pool.fill(0.25));
        // Copy in. (The first allocation of a new size is measured by firstCopy,
        // in a new worker each time.)
        const input = new Float64Array(n).fill(1.5);
        // Grow this instance once, so the timings below see memory that is already there.
        wasm.free_bytes(copyIn(input.buffer), bytes);
        await time("inAllocSetFree", () =>
          wasm.free_bytes(copyIn(input.buffer), bytes),
        );
        const dst = wasm.alloc_bytes(bytes);
        await time("inSet", () => f64(dst, n).set(input));
        wasm.free_bytes(dst, bytes);
        // Check that a copy arrived.
        const check = new Float64Array(
          wasm.memory.buffer.slice(src.ptr, src.ptr + bytes),
        );
        r.ok = check[n - 1] === n - 1;
      } catch (e) {
        r.error = errorText(e);
      }
      freeArray("copy");
      out[bytes] = r;
    }
    return { result: { results: out, memoryBytes: wasm.memory_bytes() } };
  },

  // The first allocation of `bytes` in a new instance (it grows wasm memory),
  // then the first copy into those new pages. The page runs this in a new
  // worker each time and ends the worker after, so the memory is freed.
  async firstCopy({ bytes }) {
    const n = bytes / 8;
    const input = new Float64Array(n).fill(1.5);
    const t0 = performance.now();
    const ptr = wasm.alloc_bytes(bytes);
    const t1 = performance.now();
    f64(ptr, n).set(input);
    const t2 = performance.now();
    return { result: { growMs: t1 - t0, copyMs: t2 - t1 } };
  },

  // Arrays held in wasm memory, for the end-to-end cases.
  async makeArray({ name, n }) {
    freeArray(name);
    allocArray(name, n);
    return { result: { memoryBytes: wasm.memory_bytes() } };
  },
  async freeArray({ name }) {
    freeArray(name);
    return { result: { memoryBytes: wasm.memory_bytes() } };
  },

  // The page asks for an array from wasm memory.
  // how = "slice": copy into a new ArrayBuffer and transfer it.
  // how = "pooled": copy into the buffer the page sent, and transfer it back.
  // how = "clone": copy into a new ArrayBuffer and send it by structured clone (a second copy).
  // how = "view": post a view on wasm memory by structured clone (a pitfall: it copies all of wasm memory).
  async getArray({ name, how, buf }) {
    const a = arrays[name];
    const t0 = performance.now();
    if (how === "view") {
      const view = f64(a.ptr, a.n);
      return { result: { view, copyMs: 0 } };
    }
    let out;
    if (how === "pooled") {
      new Float64Array(buf).set(f64(a.ptr, a.n));
      out = buf;
    } else {
      out = wasm.memory.buffer.slice(a.ptr, a.ptr + a.bytes);
    }
    const copyMs = performance.now() - t0;
    return {
      result: { buf: out, copyMs },
      transfer: how === "clone" ? [] : [out],
    };
  },

  // The page sends an ArrayBuffer. Copy it into wasm memory.
  // With giveBack, the buffer is transferred back so the page can use it again.
  async putArray({ buf, giveBack }) {
    const t0 = performance.now();
    const ptr = copyIn(buf);
    const copyMs = performance.now() - t0;
    wasm.free_bytes(ptr, buf.byteLength);
    if (giveBack) return { result: { copyMs, buf }, transfer: [buf] };
    return { result: { copyMs } };
  },

  // The page sends a File or Blob. Read it here and copy it into wasm memory.
  // how = "arrayBuffer": read it all, then copy (two copies exist for a moment).
  // how = "stream": allocate in wasm first, then copy each chunk as it arrives.
  async readFile({ file, how, t0 }) {
    const tRecv = now();
    const bytes = file.size;
    const tr = performance.now();
    let ptr;
    let chunks = 0;
    let readMs;
    if (how === "arrayBuffer") {
      const buf = await file.arrayBuffer();
      const tRead = performance.now();
      ptr = wasm.alloc_bytes(bytes);
      new Uint8Array(wasm.memory.buffer, ptr, bytes).set(new Uint8Array(buf));
      chunks = 1;
      readMs = tRead - tr;
    } else {
      ptr = wasm.alloc_bytes(bytes);
      const reader = file.stream().getReader();
      let off = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        new Uint8Array(wasm.memory.buffer, ptr + off, value.byteLength).set(
          value,
        );
        off += value.byteLength;
        chunks++;
      }
      if (off !== bytes) throw new Error(`read ${off} of ${bytes} bytes`);
    }
    const totalMs = performance.now() - tr;
    wasm.free_bytes(ptr, bytes);
    return { result: { postToRecvMs: tRecv - t0, readMs, totalMs, chunks } };
  },

  // Display data: decimated points for one trace, copied out of wasm memory.
  async points({ name }) {
    const a = arrays[name];
    const buf = wasm.memory.buffer.slice(a.ptr, a.ptr + a.bytes);
    return { result: { buf }, transfer: [buf] };
  },

  // Steps for the memory measurement (driven from measure.mjs).
  async memStep({ step, n }) {
    if (step === "alloc") allocArray("mem", n);
    else if (step === "copyOut") {
      const a = arrays.mem;
      held = wasm.memory.buffer.slice(a.ptr, a.ptr + a.bytes);
    } else if (step === "transfer") {
      const buf = held;
      held = null;
      return {
        result: { buf, memoryBytes: wasm.memory_bytes() },
        transfer: [buf],
      };
    } else if (step === "free") freeArray("mem");
    else if (step === "gc") globalThis.gc?.();
    return {
      result: {
        memoryBytes: wasm.memory_bytes(),
        gc: typeof globalThis.gc === "function",
      },
    };
  },

  // The control run with COOP/COEP: a shared wasm memory posted here is the same memory.
  async sharedMemory({ memory }) {
    new Int32Array(memory.buffer)[0] = 42;
    return { result: { wrote: true } };
  },

  // What arrived: used to show that a cloned view brings its whole buffer.
  async inspect({ view }) {
    return {
      result: { length: view.length, bufferBytes: view.buffer.byteLength },
    };
  },

  async env() {
    return {
      result: {
        crossOriginIsolated: self.crossOriginIsolated,
        sab: typeof SharedArrayBuffer,
      },
    };
  },
};

new Endpoint(self, handlers);
