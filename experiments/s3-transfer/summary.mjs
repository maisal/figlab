// Turns results/results.json into Markdown tables.
//
//   node summary.mjs [results/results.json]
//
// Each cell is "median (p95)" in ms unless the header says otherwise.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Decimal units: 1 KB = 1000 bytes, 1 MB = 10^6 bytes. So 80 MB is 10 million f64.
const KB = 1000;
const MB = 1000 * 1000;

function size(bytes) {
  return bytes >= MB ? `${bytes / MB} MB` : `${bytes / KB} KB`;
}

function num(x) {
  if (x === undefined || x === null || Number.isNaN(x)) return "-";
  if (x === 0) return "0";
  if (Math.abs(x) >= 100) return x.toFixed(0);
  if (Math.abs(x) >= 1) return x.toPrecision(3);
  return x.toPrecision(2);
}

function cell(s) {
  if (!s) return "-";
  if (s.error) return "error";
  if (s.median === undefined) return "-";
  return `${num(s.median)} (${num(s.p95)})`;
}

/**
 * A one-way time from two clocks. Each context has its own clock offset of up
 * to one timer step, so small values can be negative. Values within one step
 * of zero get a "*".
 */
function owCell(s, step) {
  if (!s || s.error || s.median === undefined) return cell(s);
  const lim = Math.max(step, 0.1) * 1.01;
  const f = (x) => (Math.abs(x) < lim ? `${num(x)}*` : num(x));
  return `${f(s.median)} (${f(s.p95)})`;
}

function table(head, rows) {
  const lines = [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
  ];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

function short(r) {
  if (!r) return "-";
  if (r.ok)
    return typeof r.value === "string" ? r.value : JSON.stringify(r.value);
  return r.error.replace(/\|/g, "/");
}

export function summary(res) {
  const out = [];
  const m = res.machine;
  out.push(
    `Machine: ${m.cpu}, ${m.cores} cores, ${m.memoryGB} GB, macOS ${m.os}, Node ${m.node}, Playwright ${m.playwright}.`,
  );
  out.push(`Date: ${res.date}${res.quick ? " (quick run)" : ""}.`);
  out.push("");
  out.push(
    table(
      ["Browser", "Version", "Timer step (ms)"],
      res.browsers.map((b) => [
        b.browser,
        b.version,
        num(b.env?.timerResolutionMs),
      ]),
    ),
  );

  out.push("\n### Without COOP and COEP\n");
  const checks = [
    ["crossOriginIsolated", (e) => String(e.crossOriginIsolated)],
    ["typeof SharedArrayBuffer", (e) => e.sharedArrayBufferGlobal],
    ["post a SharedArrayBuffer", (e) => short(e.postSharedArrayBuffer)],
    ["new shared WebAssembly.Memory", (e) => short(e.newSharedWasmMemory)],
    ["post a shared WebAssembly.Memory", (e) => short(e.postSharedWasmMemory)],
    [
      "post a WebAssembly.Memory (not shared)",
      (e) => short(e.postWasmMemoryObject),
    ],
    ["transfer memory.buffer", (e) => short(e.transferWasmMemoryBuffer)],
    ["memory.buffer.transfer()", (e) => short(e.arrayBufferTransferMethod)],
    [
      "structuredClone(memory.buffer)",
      (e) => short(e.structuredCloneWasmMemoryBuffer),
    ],
    [
      "old memory.buffer after memory.grow",
      (e) => short(e.growDetachesOldBuffer),
    ],
  ];
  const envRows = (key) =>
    checks.map(([label, f]) => [
      label,
      ...res.browsers.map((b) => (b[key] && !b[key].error ? f(b[key]) : "-")),
    ]);
  out.push(
    table(["Check", ...res.browsers.map((b) => b.browser)], envRows("env")),
  );
  out.push("\n### Control: with COOP and COEP\n");
  out.push(
    table(
      ["Check", ...res.browsers.map((b) => b.browser)],
      envRows("envWithCoopCoep").slice(0, 5),
    ),
  );

  out.push("\n### A view on wasm memory (256 MB) sent by structured clone\n");
  out.push(
    table(
      [
        "Browser",
        "What arrives (view clone)",
        "Time, view clone",
        "Time, slice + transfer",
      ],
      res.browsers.map((b) => {
        const v = b.env?.cloneViewOnWasmMemory?.value;
        if (!v)
          return [b.browser, short(b.env?.cloneViewOnWasmMemory), "-", "-"];
        return [
          b.browser,
          `${v.viewClone.length} values in a buffer of ${(v.viewClone.bufferBytes / MB).toFixed(0)} MB`,
          cell(v.viewClone.ms),
          cell(v.sliceTransfer.ms),
        ];
      }),
    ),
  );

  for (const b of res.browsers) {
    if (!Array.isArray(b.messaging)) continue;
    out.push(`\n### postMessage, ${b.browser} (ms, median (p95))\n`);
    const sizesSeen = [...new Set(b.messaging.map((r) => r.bytes))];
    const step = b.env?.timerResolutionMs ?? 0.1;
    const get = (bytes, mode) =>
      b.messaging.find((r) => r.bytes === bytes && r.mode === mode) ?? {};
    out.push(
      table(
        [
          "Size",
          "Runs",
          "Round trip page-worker, transfer",
          "Round trip page-worker, copy",
          "Round trip worker-worker, transfer",
          "Round trip worker-worker, copy",
        ],
        sizesSeen.map((bytes) => {
          const t = get(bytes, "transfer");
          const c = get(bytes, "clone");
          return [
            size(bytes),
            t.runs,
            cell(t.rtMainWorker),
            cell(c.rtMainWorker),
            cell(t.rtWorkerWorker),
            cell(c.rtWorkerWorker),
          ];
        }),
      ),
    );
    out.push("");
    out.push(
      table(
        [
          "Size",
          "One way page to worker, transfer",
          "One way page to worker, copy",
          "Sender blocked in postMessage, copy",
          "One way worker to page, transfer",
          "One way worker to page, copy",
          "One way worker to worker, transfer",
          "One way worker to worker, copy",
        ],
        sizesSeen.map((bytes) => {
          const t = get(bytes, "transfer");
          const c = get(bytes, "clone");
          return [
            size(bytes),
            owCell(t.owMainToWorker?.oneway, step),
            owCell(c.owMainToWorker?.oneway, step),
            owCell(c.owMainToWorker?.post, step),
            owCell(t.owWorkerToMain?.oneway, step),
            owCell(c.owWorkerToMain?.oneway, step),
            owCell(t.owWorkerToWorker?.oneway, step),
            owCell(c.owWorkerToWorker?.oneway, step),
          ];
        }),
      ),
    );
    out.push(
      `\n\\* Within one timer step (${num(step)} ms) of zero. One-way times subtract the clocks of two contexts, and each clock has its own offset of up to one step, so these values can be negative.`,
    );
  }

  for (const b of res.browsers) {
    const w = b.wasmCopies?.results;
    if (!w) continue;
    out.push(
      `\n### Copies at the wasm boundary, in a worker, ${b.browser} (ms, median (p95))\n`,
    );
    out.push(
      table(
        [
          "Size",
          "memory.buffer.slice",
          "view.slice()",
          "new Float64Array(n).set(view)",
          "pooled.set(view)",
          "new ArrayBuffer",
          "new Float64Array(n).fill",
          "pooled.fill",
          "into wasm: alloc + set + free",
          "into wasm: set only",
          "into wasm: first alloc (grow), new worker",
          "into wasm: first copy into new pages, new worker",
        ],
        Object.entries(w).map(([bytes, r]) => [
          size(Number(bytes)),
          cell(r.outSlice),
          cell(r.outTypedSlice),
          cell(r.outNewSet),
          cell(r.outPooled),
          cell(r.newBuffer),
          cell(r.newBufferFill),
          cell(r.pooledFill),
          cell(r.inAllocSetFree),
          cell(r.inSet),
          cell(r.inFirstGrow),
          cell(r.inFirstCopy),
        ]),
      ),
    );
  }

  out.push("\n### End to end: 10 million f64 (80 MB) (ms, median (p95))\n");
  const e2eRows = [
    ["worker wasm to page: slice + transfer", "outSliceTransfer"],
    [
      "worker wasm to page: copy into a pooled buffer + transfer",
      "outPooledTransfer",
    ],
    ["worker wasm to page: slice + structured clone", "outSliceClone"],
    [
      "page to worker wasm: transfer + copy in (buffer sent back)",
      "inTransfer",
    ],
    ["page to worker wasm: structured clone + copy in", "inClone"],
  ];
  out.push(
    table(
      [
        "Case",
        ...res.browsers.flatMap((b) => [
          `${b.browser} total`,
          `${b.browser} copy in worker`,
        ]),
      ],
      e2eRows.map(([label, key]) => [
        label,
        ...res.browsers.flatMap((b) => [
          cell(b.e2e?.[key]?.total),
          cell(b.e2e?.[key]?.workerCopy),
        ]),
      ]),
    ),
  );

  out.push(
    "\n### Display data: decimated points of one trace, worker to page\n",
  );
  const dispRows = [];
  for (const label of ["f64", "f32"]) {
    dispRows.push([
      `${label}: latency (ms)`,
      ...res.browsers.map((b) => cell(b.display?.[label]?.latency)),
    ]);
    dispRows.push([
      `${label}: copy into the page's wasm (ms)`,
      ...res.browsers.map((b) => cell(b.display?.[label]?.copyIntoPageWasm)),
    ]);
    for (const k of [1, 4, 16, 64, 256]) {
      dispRows.push([
        `${label}: ${k} requests at once, ms per message`,
        ...res.browsers.map((b) =>
          num(b.display?.[label]?.bursts?.[k]?.perMessageMs),
        ),
      ]);
    }
  }
  out.push(table(["Case", ...res.browsers.map((b) => b.browser)], dispRows));

  out.push(
    "\n### Files: post a File to the worker and read it there (ms, median (p95))\n",
  );
  const fileRows = [];
  const names = res.browsers[0]?.files?.files?.map((f) => f.bytes) ?? [];
  for (const bytes of names) {
    const f = (b) => b.files?.files?.find((x) => x.bytes === bytes);
    fileRows.push([
      `${size(bytes)}: postMessage(file) on the page`,
      ...res.browsers.map((b) => cell(f(b)?.worker_stream?.postMessage)),
    ]);
    fileRows.push([
      `${size(bytes)}: worker reads a stream into wasm, total`,
      ...res.browsers.map((b) => cell(f(b)?.worker_stream?.total)),
    ]);
    fileRows.push([
      `${size(bytes)}: worker arrayBuffer() then copy into wasm, total`,
      ...res.browsers.map((b) => cell(f(b)?.worker_arrayBuffer?.total)),
    ]);
    fileRows.push([
      `${size(bytes)}: page arrayBuffer(), transfer, copy into wasm, total`,
      ...res.browsers.map((b) => cell(f(b)?.mainArrayBufferTransfer?.total)),
    ]);
  }
  fileRows.push([
    "80 MB Blob made in memory: postMessage(blob)",
    ...res.browsers.map((b) => cell(b.files?.blob80MB?.postMessage)),
  ]);
  out.push(table(["Case", ...res.browsers.map((b) => b.browser)], fileRows));

  if (res.memory) {
    const mm = res.memory;
    out.push(
      `\n### Memory (Chrome ${mm.version}, resident MB of all browser processes, array of ${mm.arrayMB} MB)\n`,
    );
    out.push(
      table(
        ["Step", "Before", "Peak", "After", "wasm memory (MB)"],
        mm.copyOut.map((s) => [
          s.step,
          s.beforeMB,
          s.peakMB,
          s.afterMB,
          s.result?.memoryBytes ? (s.result.memoryBytes / MB).toFixed(0) : "-",
        ]),
      ),
    );
    out.push("");
    out.push(
      table(
        [
          "Read a file into worker wasm",
          "File (MB)",
          "Before",
          "Peak",
          "Peak increase",
        ],
        mm.copyIn.map((s) => [
          s.step,
          s.fileMB,
          s.beforeMB,
          s.peakMB,
          s.increaseMB,
        ]),
      ),
    );
  }
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path =
    process.argv[2] ??
    fileURLToPath(new URL("results/results.json", import.meta.url));
  console.log(summary(JSON.parse(await readFile(path, "utf8"))));
}
