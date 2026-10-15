// The page of the S3 experiment. measure.mjs calls the functions in `window.bench`.

import {
  Endpoint,
  benchHandler,
  errorText,
  loadWasm,
  makeBuffer,
  now,
  oneWays,
  roundTrips,
  runsFor,
  stats,
  timeOp,
  timerResolution,
} from "./common.js";

// Decimal units: 1 KB = 1000 bytes, 1 MB = 10^6 bytes. So 80 MB is 10 million f64.
const KB = 1000;
const MB = 1000 * 1000;

let epA; // to worker A (the compute worker)
let wasm; // the page's own wasm instance (stands in for the render module)
let minSampleMs = 5;
let heldMain = null;
let sink = 0;

const handlers = { bench: benchHandler };

async function init() {
  wasm = (await loadWasm()).exports;
  const a = new Worker("./worker.js", { type: "module" });
  const b = new Worker("./worker.js", { type: "module" });
  epA = new Endpoint(a, handlers);
  const epB = new Endpoint(b, handlers);
  const ch = new MessageChannel();
  await epA.call("init", { name: "A", port: ch.port1 }, [ch.port1]);
  await epB.call("init", { name: "B", port: ch.port2 }, [ch.port2]);
  minSampleMs = Math.max(5, 20 * timerResolution());
  return { minSampleMs };
}

async function tryIt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** What the page can and cannot do without COOP and COEP. */
async function env() {
  const r = {
    crossOriginIsolated: self.crossOriginIsolated,
    isSecureContext: self.isSecureContext,
    sharedArrayBufferGlobal: typeof SharedArrayBuffer,
    timerResolutionMs: timerResolution(),
    worker: await epA.call("env"),
  };
  r.postSharedArrayBuffer = await tryIt(async () => {
    const sab = new SharedArrayBuffer(16);
    await epA.call("env", { sab });
    return "posted";
  });
  r.newSharedWasmMemory = await tryIt(() => {
    const m = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return `created, buffer is ${Object.prototype.toString.call(m.buffer)}`;
  });
  r.postSharedWasmMemory = await tryIt(async () => {
    const memory = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });
    await epA.call("sharedMemory", { memory });
    return `posted; the page reads ${new Int32Array(memory.buffer)[0]} written by the worker`;
  });
  r.postWasmMemoryObject = await tryIt(async () => {
    await epA.call("env", { memory: wasm.memory });
    return "posted";
  });
  r.transferWasmMemoryBuffer = await tryIt(async () => {
    await epA.call("env", {}, [wasm.memory.buffer]);
    return "transferred";
  });
  r.arrayBufferTransferMethod = await tryIt(() => {
    if (typeof ArrayBuffer.prototype.transfer !== "function")
      return "no ArrayBuffer.prototype.transfer";
    wasm.memory.buffer.transfer();
    return "transferred";
  });
  r.structuredCloneWasmMemoryBuffer = await tryIt(() => {
    const copy = structuredClone(wasm.memory.buffer);
    return `copied ${copy.byteLength} bytes`;
  });
  r.growDetachesOldBuffer = await tryIt(() => {
    const old = wasm.memory.buffer;
    const before = old.byteLength;
    wasm.memory.grow(1);
    return { before, afterGrow: old.byteLength, detached: old.detached };
  });
  // A view on wasm memory, sent by structured clone, brings the whole memory with it.
  r.cloneViewOnWasmMemory = await tryIt(async () => {
    const big = wasm.alloc_bytes(256 * MB); // grow wasm memory to about 256 MB
    const n = 12800;
    const ptr = wasm.alloc_bytes(n * 8);
    wasm.fill_f64(ptr, n);
    const view = new Float64Array(wasm.memory.buffer, ptr, n);
    const runs = 10;
    const tv = [];
    let got;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      got = await epA.call("inspect", { view });
      tv.push(performance.now() - t0);
    }
    const ts = [];
    let gotSlice;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const copy = view.slice();
      gotSlice = await epA.call("inspect", { view: copy }, [copy.buffer]);
      ts.push(performance.now() - t0);
    }
    wasm.free_bytes(ptr, n * 8);
    wasm.free_bytes(big, 256 * MB);
    return {
      wasmMemoryBytes: wasm.memory.buffer.byteLength,
      viewClone: { ...got, ms: stats(tv) },
      sliceTransfer: { ...gotSlice, ms: stats(ts) },
    };
  });
  return r;
}

/** postMessage between the page and worker A, and between workers A and B. */
async function messaging({ sizes, quick }) {
  const out = [];
  for (const bytes of sizes) {
    const runs = runsFor(bytes, quick);
    for (const mode of ["transfer", "clone"]) {
      const row = { bytes, mode, runs };
      const safe = async (fn) => {
        try {
          return await fn();
        } catch (e) {
          return { error: errorText(e) };
        }
      };
      row.rtMainWorker = await safe(() =>
        roundTrips(epA, bytes, mode, runs, minSampleMs),
      );
      row.rtWorkerWorker = await safe(() =>
        epA.call("roundTrips", { to: "peer", bytes, mode, runs, minSampleMs }),
      );
      row.owMainToWorker = await safe(() => oneWays(epA, bytes, mode, runs));
      row.owWorkerToMain = await safe(() =>
        epA.call("oneWays", { to: "main", bytes, mode, runs }),
      );
      row.owWorkerToWorker = await safe(() =>
        epA.call("oneWays", { to: "peer", bytes, mode, runs }),
      );
      out.push(row);
    }
  }
  return out;
}

async function wasmCopies({ sizes, quick }) {
  const r = await epA.call("wasmCopies", { sizes, quick, minSampleMs });
  // The first allocation of each size, each time in a new worker that is ended after.
  for (const bytes of sizes) {
    const grow = [];
    const copy = [];
    try {
      for (let i = 0; i < (bytes > 100 * MB ? 3 : 5); i++) {
        const w = new Worker("./worker.js", { type: "module" });
        const ep = new Endpoint(w, handlers);
        await ep.call("init", { name: "G" });
        const res = await ep.call("firstCopy", { bytes });
        w.terminate();
        grow.push(res.growMs);
        copy.push(res.copyMs);
      }
      r.results[bytes].inFirstGrow = stats(grow);
      r.results[bytes].inFirstCopy = stats(copy);
    } catch (e) {
      r.results[bytes].inFirstGrow = { error: errorText(e) };
    }
  }
  return r;
}

/** 10 million f64 between the compute worker's wasm memory and the page. */
async function e2e({ quick }) {
  const n = 10_000_000;
  const bytes = n * 8;
  const runs = quick ? 5 : 20;
  await epA.call("makeArray", { name: "big", n });
  const r = {};
  // Totals use timeOp, so a coarse timer (1 ms in WebKit) still gives usable numbers.
  // The worker's own copy time is kept from every call.
  const out = async (how) => {
    const copy = [];
    let pool = how === "pooled" ? makeBuffer(bytes) : undefined;
    const once = async () => {
      const res = await epA.call(
        "getArray",
        { name: "big", how, buf: pool },
        pool ? [pool] : [],
      );
      const a = new Float64Array(res.buf);
      sink += a[n - 1];
      if (how === "pooled") pool = res.buf;
      copy.push(res.copyMs);
    };
    const { samples } = await timeOp(once, { runs, minSampleMs, warmup: 1 });
    return { total: stats(samples), workerCopy: stats(copy) };
  };
  r.outSliceTransfer = await out("slice");
  r.outPooledTransfer = await out("pooled");
  r.outSliceClone = await out("clone");
  await epA.call("freeArray", { name: "big" });

  // mode "transfer": the worker copies the buffer into wasm memory and transfers it back (a pool of one).
  // mode "clone": the buffer is copied by postMessage, then copied into wasm memory.
  const into = async (mode) => {
    const copy = [];
    let buf = makeBuffer(bytes);
    const once = async () => {
      const transfer = mode === "transfer";
      const res = await epA.call(
        "putArray",
        { buf, giveBack: transfer },
        transfer ? [buf] : [],
      );
      if (transfer) buf = res.buf;
      copy.push(res.copyMs);
    };
    const { samples } = await timeOp(once, { runs, minSampleMs, warmup: 1 });
    return { total: stats(samples), workerCopy: stats(copy) };
  };
  r.inTransfer = await into("transfer");
  r.inClone = await into("clone");
  return r;
}

/** Decimated points for one trace, from the compute worker to the page, many times. */
async function display({ quick }) {
  const cases = [
    ["f64", 12800], // 4 x 3200 f64 = 100 KB
    ["f32", 6400], // 4 x 3200 f32 = 50 KB (same bytes as 6400 f64)
  ];
  const out = {};
  for (const [label, n] of cases) {
    const bytes = n * 8;
    await epA.call("makeArray", { name: `pts-${label}`, n });
    const dst = wasm.alloc_bytes(bytes); // stands in for the render module's input buffer
    const runs = quick ? 10 : 40;
    const name = `pts-${label}`;
    // One request at a time: the request, the copy out of wasm, the transfer, and the reply.
    const single = await timeOp(() => epA.call("points", { name }), {
      runs,
      minSampleMs,
    });
    // Copy the received points into the page's own wasm memory.
    const res = await epA.call("points", { name });
    const copy = await timeOp(
      () =>
        new Uint8Array(wasm.memory.buffer, dst, bytes).set(
          new Uint8Array(res.buf),
        ),
      {
        runs,
        minSampleMs,
      },
    );
    // Many requests at once: how many fit in one frame.
    const bursts = {};
    for (const k of [1, 4, 16, 64, 256]) {
      const burst = () =>
        Promise.all(
          Array.from({ length: k }, () => epA.call("points", { name })),
        );
      const { samples } = await timeOp(burst, { runs, minSampleMs });
      const s = stats(samples);
      bursts[k] = {
        total: s,
        perMessageMs: Number((s.median / k).toPrecision(3)),
      };
    }
    wasm.free_bytes(dst, bytes);
    out[label] = {
      bytes,
      latency: stats(single.samples),
      copyIntoPageWasm: stats(copy.samples),
      bursts,
    };
  }
  return out;
}

/** Files picked in the file input: post to the worker and read there, or read here and transfer. */
async function files({ quick }) {
  const list = [...document.getElementById("files").files];
  const out = [];
  for (const file of list) {
    const runs = quick ? 3 : file.size > 100 * MB ? 5 : 10;
    const row = { name: file.name, bytes: file.size, runs };
    for (const how of ["stream", "arrayBuffer"]) {
      const post = [];
      const recv = [];
      const total = [];
      try {
        for (let i = -1; i < runs; i++) {
          const t0 = now();
          const p = epA.call("readFile", { file, how, t0 });
          const postMs = now() - t0;
          const res = await p;
          const dt = now() - t0;
          if (i >= 0) {
            post.push(postMs);
            recv.push(res.postToRecvMs);
            total.push(dt);
          }
        }
        row[`worker_${how}`] = {
          postMessage: stats(post),
          oneWay: stats(recv),
          total: stats(total),
        };
      } catch (e) {
        row[`worker_${how}`] = { error: errorText(e) };
      }
    }
    try {
      const total = [];
      const read = [];
      for (let i = -1; i < runs; i++) {
        const t0 = performance.now();
        const buf = await file.arrayBuffer();
        const t1 = performance.now();
        await epA.call("putArray", { buf }, [buf]);
        if (i >= 0) {
          total.push(performance.now() - t0);
          read.push(t1 - t0);
        }
      }
      row.mainArrayBufferTransfer = {
        mainRead: stats(read),
        total: stats(total),
      };
    } catch (e) {
      row.mainArrayBufferTransfer = { error: errorText(e) };
    }
    out.push(row);
  }
  // A Blob made in memory behaves like a File: posting it does not copy the bytes.
  const blob = new Blob([makeBuffer(80 * MB)]);
  const post = [];
  const total = [];
  for (let i = -1; i < (quick ? 3 : 10); i++) {
    const t0 = now();
    const p = epA.call("readFile", { file: blob, how: "stream", t0 });
    const postMs = now() - t0;
    await p;
    if (i >= 0) {
      post.push(postMs);
      total.push(now() - t0);
    }
  }
  return {
    files: out,
    blob80MB: { postMessage: stats(post), total: stats(total) },
  };
}

/** One step of the memory measurement. measure.mjs reads the process memory between steps. */
async function memStep({ step, n, fileIndex }) {
  if (step === "transfer") {
    const r = await epA.call("memStep", { step });
    heldMain = r.buf;
    return { memoryBytes: r.memoryBytes, mainHolds: heldMain.byteLength };
  }
  if (step === "dropMain") {
    heldMain = null;
    globalThis.gc?.();
    return { gc: typeof globalThis.gc === "function" };
  }
  if (step === "readStream" || step === "readArrayBuffer") {
    const file = document.getElementById("files").files[fileIndex];
    const how = step === "readStream" ? "stream" : "arrayBuffer";
    return epA.call("readFile", { file, how, t0: now() });
  }
  if (step === "mainReadTransfer") {
    const file = document.getElementById("files").files[fileIndex];
    const buf = await file.arrayBuffer();
    return epA.call("putArray", { buf }, [buf]);
  }
  return epA.call("memStep", { step, n });
}

window.bench = {
  init,
  env,
  messaging,
  wasmCopies,
  e2e,
  display,
  files,
  memStep,
  KB,
  MB,
  sink: () => sink,
};
window.benchReady = true;
