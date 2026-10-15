# S3: passing large arrays between workers

ADR: [0012. Pass arrays between workers by transfer](../../docs/adr/0012-data-transfer-between-workers.md).

## Question

figlab is served from GitHub Pages. GitHub Pages cannot send the COOP and COEP headers.
So the page is not cross-origin isolated, and `SharedArrayBuffer` is not available (spec.md 13).
How long does it take to pass large arrays between the page and workers, and between two workers, as transferable buffers?
What does that mean for the design (spec.md 4, 9.1, 9.3, 10, 11)?

## Short answer

- Without COOP and COEP, no memory can be shared between threads. Each wasm instance has its own memory. That memory cannot be transferred, posted, or shared (Chrome and WebKit give an error). So every array that leaves wasm memory is copied once.
- A transfer is almost free. A round trip takes 0.02 to 0.3 ms up to 80 MB, and under 0.7 ms at 400 MB. It does not depend much on the size.
- A copy out of wasm memory costs about 0.11 ms per MB into a new buffer, and about 0.022 ms per MB into a buffer that is used again (Chrome). The difference is the first write to new pages. For 10 million f64 (80 MB): 8.2 ms with a new buffer, 2.2 ms with a reused buffer.
- A structured clone (no transfer list) copies twice on every hop: once in the sender's `postMessage`, and once in the receiver when it first reads `e.data`. That is about 0.2 ms per MB per hop in Chrome (80 MB: 19 ms), and the sender is blocked for the first copy. Posting a typed array view on wasm memory clones all of wasm memory (257 MB for a 100 KB view).
- Display data is cheap. One request for decimated points (4 x 3200 f64, 100 KB) takes about 0.08 ms in Chrome and in WebKit, from request to reply. With many requests in flight, each takes 0.015 to 0.02 ms of wall time.
- Posting a `File` to a worker does not copy it (0 to 0.1 ms, even for 400 MB). Reading it in the worker as a stream straight into wasm memory needs 400 + 125 MB of extra memory for a 400 MB file. `arrayBuffer()` and then a copy needs 400 + 365 MB.
- wasm memory never shrinks. Freeing an array in Rust keeps the pages, but later arrays use them again. A copy out of wasm memory needs room for a second copy until the copy is freed.

So: big arrays stay in the compute worker. Data crosses to the main thread only when it needs it, as transferred buffers. Files go to the compute worker as `File` objects.

## Setup

| Item | Version |
|---|---|
| Machine | Apple M1 Max, 10 cores, 64 GB |
| OS | macOS 27.0.1 |
| Chrome | Google Chrome 155.0.8059.79, headless, through Playwright (`channel: "chrome"`) |
| WebKit | Playwright's WebKit 27.2 (build 2370), headless |
| Firefox | Not measured. Playwright's Firefox build (1555) and the installed Firefox 157 both fail to start headless on this machine with "Could not find profile folder", also outside the sandbox |
| Playwright | 1.64.0 |
| Node | 24.14.1 |
| Rust | 1.99.0, target `wasm32-unknown-unknown` |

The parts:

- `src/lib.rs`: a tiny wasm module with no dependencies. It exports `alloc_bytes`, `free_bytes`, `fill_f64`, `sum_f64`, and `memory_bytes`. Its memory is a normal (not shared) `WebAssembly.Memory`, the same kind that wasm-bindgen makes.
- `serve.mjs`: a static server with headers like GitHub Pages (`Cache-Control: max-age=600`, no COOP, no COEP). With `coi: true` it also sends COOP and COEP, as a control.
- `web/`: the page (`main.js`) and the workers (`worker.js`). Worker A plays the compute worker. Worker B is a second worker, reached from A through a `MessageChannel` port.
- `measure.mjs`: starts the servers, runs every case in each browser, measures memory in Chrome, and writes `results/results.json` and `results/summary.md`.
- `summary.mjs`: turns `results.json` into Markdown tables.

How the times are taken:

- Round trips and copies: many calls in a row, divided by the number of calls, so that each sample lasts at least 5 ms (Chrome) or 20 ms (WebKit). This hides the coarse timers (0.1 ms in Chrome and 1 ms in WebKit, without cross-origin isolation).
- One-way times: `performance.timeOrigin + performance.now()` in the sender and in the receiver. Each context has its own clock offset of up to one timer step, so these times are only good to one step, and small ones can be negative. In the tables, values within one step of zero are marked with "*".
- The receive time is taken right after the first read of `e.data`. Chrome and WebKit deserialize a message on that first read, so the copy of a structured clone is included.
- Each cell is the median, with the p95 in brackets. The runs: 40 for sizes up to 8 MB, 20 for 80 MB, and 10 for 400 MB.
- Sizes are decimal: 1 KB = 1000 bytes, 1 MB = 10^6 bytes. So 80 MB is 10 million f64 and 400 MB is 50 million f64.
- Memory: the resident memory (`ps`) of all browser processes, sampled every 20 ms during each step. Chrome is started with `--js-flags=--expose-gc` for this part only, so that the steps can force a garbage collection.

## How to run

```sh
cd experiments/s3-transfer
pnpm install
pnpm exec playwright install firefox webkit   # optional; Chrome is the installed Google Chrome
pnpm run measure                              # builds the wasm module, runs everything (about 3 minutes)
```

- `pnpm run measure --quick` runs fewer times and writes `target/results-quick.json`.
- `pnpm run measure --browsers chrome --skip-memory` limits the run.
- `pnpm run serve` serves the page on http://127.0.0.1:8083/ for a look by hand (`node serve.mjs --coi` with COOP and COEP).

Run it inside the repository, so that mise gives the pinned Rust and Node.

## Results

The numbers below come from one run on 2026-10-15 with no other builds running. The user's normal desktop apps were open, and the load average was about 8 to 9.
All tables are in [results/summary.md](results/summary.md), and the raw numbers in [results/results.json](results/results.json).

### What works without COOP and COEP

| Check | Chrome 155 | WebKit 27.2 |
|---|---|---|
| `crossOriginIsolated` | false | false |
| `typeof SharedArrayBuffer` | undefined | undefined |
| `new WebAssembly.Memory({ shared: true })` | works; its buffer is a SharedArrayBuffer | works; its buffer is a SharedArrayBuffer |
| Post that shared memory to a worker | DataCloneError: "SharedArrayBuffer transfer requires self.crossOriginIsolated" | DataCloneError: "The object can not be cloned" |
| Post a normal `WebAssembly.Memory` | DataCloneError: "#<Memory> could not be cloned" | DataCloneError: "The object can not be cloned" |
| Transfer `memory.buffer` | TypeError: "ArrayBuffer at index 0 is not detachable" | TypeError: "Cannot transfer a WebAssembly.Memory" |
| `memory.buffer.transfer()` | TypeError: "ArrayBuffer is not detachable" | TypeError: "Receiver cannot be detached because it is WebAssembly.Memory" |
| `structuredClone(memory.buffer)` | works: a copy of all of wasm memory | works: a copy of all of wasm memory |
| Old `memory.buffer` after `memory.grow` | detached (length 0) | detached (length 0) |

With COOP and COEP (the control), both browsers are cross-origin isolated.
Then a shared `WebAssembly.Memory` can be posted, and the page reads what the worker wrote.

A view on wasm memory, posted without a transfer list, brings the whole memory with it:

| | Chrome | WebKit |
|---|---|---|
| Post `new Float64Array(memory.buffer, ptr, 12800)` (wasm memory is 257 MB) | 57 ms; the worker gets a 257 MB buffer | 34 ms; the worker gets a 257 MB buffer |
| Post `view.slice()` with a transfer list | 0.1 ms | < 1 ms |

### postMessage

Round trip, page and worker A (ms):

| Size | Chrome, transfer | Chrome, copy | WebKit, transfer | WebKit, copy |
|---|---|---|---|---|
| 1 KB | 0.021 | 0.018 | 0.047 | 0.047 |
| 64 KB | 0.019 | 0.054 | 0.047 | 0.064 |
| 1 MB | 0.020 | 0.59 | 0.055 | 0.33 |
| 8 MB | 0.022 | 3.7 | 0.10 | 1.7 |
| 80 MB | 0.020 | 40 | 0.15 | 12.5 |
| 400 MB | 0.49 | 218 | 0.23 | 56 |

Round trip, worker A and worker B through a `MessageChannel` (ms):

| Size | Chrome, transfer | Chrome, copy | WebKit, transfer | WebKit, copy |
|---|---|---|---|---|
| 1 KB | 0.026 | 0.020 | 0.18 | 0.17 |
| 1 MB | 0.029 | 0.53 | 0.18 | 0.42 |
| 8 MB | 0.024 | 3.9 | 0.28 | 1.8 |
| 80 MB | 0.022 | 40 | 0.33 | 12.5 |
| 400 MB | 0.67 | 213 | 0.38 | 83 (p95 451) |

A clone and a transfer cost about the same at 1 KB. From 64 KB up, the transfer is faster.

One way, Chrome (ms, timer step 0.1 ms; "*" is within one step of zero):

| Size | Page to worker, transfer | Page to worker, copy | Page blocked in `postMessage`, copy | Worker to page, copy | Worker to worker, copy |
|---|---|---|---|---|---|
| 1 KB | -0.1* | -0.1* | 0* | 0.1* | 0* |
| 1 MB | -0.1* | 0.15 | 0.1* | 0.3 | 0.3 |
| 8 MB | -0.1* | 1.7 | 0.8 | 2.0 | 1.7 |
| 80 MB | 0.3 | 18.6 | 7.4 | 18.6 | 19.4 |
| 400 MB | 0.2 | 90 | 37 | 102 | 93 |

A clone copies the data twice per hop.
The sender copies it inside `postMessage` (the "blocked" column).
The receiver copies it again when it first reads `e.data`.
In WebKit, the same hop for 80 MB takes 5 to 7 ms, and the sender is blocked for 4 ms of it (timer step 1 ms).

### Copies at the wasm boundary

In worker A, ms per call:

| Size | Chrome: `memory.buffer.slice` | Chrome: copy into a reused buffer | Chrome: copy into wasm | WebKit: `memory.buffer.slice` | WebKit: copy into a reused buffer | WebKit: copy into wasm |
|---|---|---|---|---|---|---|
| 64 KB | 0.0070 | 0.0011 | 0.0011 | 0.0024 | 0.0012 | 0.0011 |
| 1 MB | 0.10 | 0.018 | 0.020 | 0.033 | 0.018 | 0.019 |
| 8 MB | 0.89 | 0.16 | 0.19 | 0.21 | 0.16 | 0.19 |
| 80 MB | 9.0 | 1.8 | 2.1 | 1.8 | 1.8 | 1.7 |
| 400 MB | 43 | 8.6 | 8.5 | 36 | 9.0 | 9.3 |

- `view.slice()` and `new Float64Array(n).set(view)` cost about the same as `memory.buffer.slice`. wasm-bindgen does `view.slice()` when Rust returns a `Vec<f64>`.
- A new buffer costs about 5 times more than a reused one in Chrome. The extra cost is the first write to new pages: `new ArrayBuffer(80 MB)` alone takes 0.1 ms, but filling it takes 8.7 ms, and filling a reused buffer takes 3.6 ms.
- "Copy into wasm" is `alloc_bytes` in Rust, then `view.set(src)`, then `free_bytes`, on memory that was used before.
- The first allocation of a new size grows wasm memory. This was measured in a new worker each time (5 runs, or 3 at 400 MB). The grow itself is cheap: 0.5 ms for 80 MB in Chrome, and under the 1 ms timer step in WebKit. The first copy into the new pages pays the first-write cost: 7.7 ms for 80 MB and 38 ms for 400 MB in Chrome, 7 ms and 36 ms in WebKit.

### End to end: 10 million f64 (80 MB)

| Case (ms) | Chrome | WebKit |
|---|---|---|
| Worker wasm to page: `memory.buffer.slice`, transfer | 8.2 (p95 16) | 2.2 (p95 2.9) |
| Worker wasm to page: copy into a buffer the page sent, transfer back | 2.2 | 2.4 |
| Worker wasm to page: `memory.buffer.slice`, structured clone | 32 | 19 |
| Page to worker wasm: transfer, copy in, transfer the buffer back | 2.2 | 2.6 |
| Page to worker wasm: structured clone, copy in | 23 | 15 |

The pooled cases (a buffer sent back and forth) are steady-state numbers. The first transfer still pays the first-write cost of a new buffer.

### Display data

Decimated points of one trace, copied out of worker A's wasm memory and transferred to the page:

| Case (ms) | Chrome | WebKit |
|---|---|---|
| f64, 4 x 3200 values (100 KB): one request at a time, request to reply | 0.080 (p95 0.10) | 0.082 (p95 0.094) |
| f32, 4 x 3200 values (50 KB): one request at a time | 0.072 | 0.060 |
| f64: copy the reply into the page's own wasm memory | 0.0017 | 0.0018 |
| f64: 16 requests in flight, per request | 0.021 | 0.016 |
| f64: 256 requests in flight, per request | 0.016 | 0.014 |

One frame at 60 Hz is 16.7 ms. At 0.015 to 0.08 ms per request, 100 requests take 1.5 to 8 ms of wall time (the low end with the requests in flight together).
This is wall time with an idle worker, not CPU time on the main thread.
It shows that the messaging does not limit the frame rate.
The real cost of a display request is the decimation in the worker (S2), not the transfer.

### Files

A file on disk (warm in the OS cache), picked in an `<input type="file">` and passed to worker A:

| Case (ms) | Chrome | WebKit |
|---|---|---|
| `postMessage(file)` on the page, any size up to 400 MB | 0 to 0.1 | 0 to 1 |
| 80 MB: the worker reads a stream into wasm memory | 46 | 26 |
| 80 MB: the worker calls `arrayBuffer()`, then copies into wasm memory | 46 | 26 |
| 80 MB: the page calls `arrayBuffer()`, transfers it, the worker copies into wasm | 47 | 26 |
| 400 MB: stream into wasm memory | 232 | 125 |
| 400 MB: `arrayBuffer()` in the worker, then copy | 234 | 132 |
| 400 MB: `arrayBuffer()` on the page, transfer, copy | 223 | 125 |

No way of reading is clearly faster. In Chrome, the stream sometimes has a slow run (8 MB: median 6.1 ms, p95 15.5 ms; 400 MB: median 232 ms, p95 353 ms).
A stream cannot read straight into wasm memory with a BYOB reader, because wasm memory cannot be detached.
So each chunk is copied once into wasm memory. That copy is a small part of the time.

### Memory

Chrome, resident memory of all browser processes (MB), with an array of 400 MB:

| Step | After the step | Change |
|---|---|---|
| Start | 988 | |
| Worker: allocate and fill 400 MB in wasm | 1372 | +384 |
| Worker: copy it out to a new ArrayBuffer | 1754 | +382 (two copies) |
| Worker: transfer it to the page | 1758 | +4 |
| Worker: free the array in Rust | 1758 | 0 (wasm memory stays 401 MB) |
| Page: drop the buffer, force a garbage collection | 1382 | -376 |
| Worker: allocate 400 MB in wasm again | 1383 | +1 (the freed wasm pages are used again) |

Reading a 400 MB file into worker wasm memory, each in a new page:

| Way | Peak increase (MB) |
|---|---|
| The worker reads a stream into wasm memory | 524 |
| The worker calls `arrayBuffer()`, then copies | 764 |
| The page calls `arrayBuffer()`, transfers, the worker copies | 765 |

## Cross-origin isolation through a service worker

A service worker such as coi-serviceworker (MIT) can add COOP and COEP headers to the responses it serves.
Then the page is cross-origin isolated even on GitHub Pages, and `SharedArrayBuffer` works (the control above shows what that allows).
This was not measured. figlab should not depend on it. The main reason is that it adds a second data path that the app cannot drop:

- spec.md 13 (Offline) already plans a service worker, so adding the headers would be cheap.
- But on the first visit the page is not isolated. The service worker must install, and then the page must reload.
- A hard reload bypasses the service worker, so coi-serviceworker reloads the page once more.
- Firefox private windows run no service workers, so the page is never isolated there.
- So the app must work without `SharedArrayBuffer` anyway. A second, shared-memory path doubles the work and the tests.

Other reasons:

- COEP blocks cross-origin resources that do not opt in (fonts, images, or scripts from other origins).
- Shared wasm memory needs a Rust build with atomics, which needs a nightly toolchain to rebuild `std`.
- The measured costs of the transfer path are small for what crosses (display data and file handles).

## Limits

- One machine and one run (2026-10-15, no other builds running; normal desktop apps were open, load average about 8 to 9). An earlier run on a busy machine (2026-10-14) led to the same conclusions. Some numbers differed by up to 2 times: file reads in Chrome, small round trips, and single display requests.
- No Firefox numbers. Neither Playwright's Firefox nor the installed Firefox 157 started headless here.
- Playwright's WebKit is close to Safari, but it is not Safari.
- The timers are coarse without cross-origin isolation. One-way times are only good to 0.1 ms (Chrome) and 1 ms (WebKit), and small ones can be negative.
- Files were warm in the OS cache, so the file times show the browser's reading cost, not the disk.
- The memory numbers are from Chrome only, and from `ps`, which also counts other browser processes. WebKit's processes are not children of the Playwright process, so they were not measured.
- The wasm module uses plain exports, not wasm-bindgen. The memory and the copies are the same.
- Not tested: writing files from the compute worker (File System Access API writable streams, OPFS sync access handles), and decimation itself (S2).
