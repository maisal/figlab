# 0012. Pass arrays between workers by transfer

- Status: Accepted
- Date: 2026-10-14

## Context

figlab is served from GitHub Pages, which cannot send special HTTP headers (spec.md 13).
Without the COOP and COEP headers, the page is not cross-origin isolated.
Then `SharedArrayBuffer` is not available, and threads cannot share memory.

The architecture has three threads (spec.md 4):

- the main thread, with the UI and the render module (wasm)
- the compute worker (wasm), the single owner of the data
- the language service worker (wasm), which gets an index from the compute worker

Data must move between them:

- decimated points for graphs (9.3), visible table rows (7), nearest points for tooltips (12.3.2), and fit results
- whole traces for WebGL markers (9.3) and for export of marker traces
- file contents for import (10) and for saving (11.3)

spec.md 9.1 said that TypeScript reads point coordinates directly from arrays in wasm memory, without copying.
That is the render module's memory, on the main thread (ADR 0007).
It did not say how the points get there from the compute worker, whose memory the main thread cannot see.

Experiment S3 ([experiments/s3-transfer](../../experiments/s3-transfer/README.md)) measured how data can move and what it costs.
It used Chrome 155 and Playwright's WebKit 27.2 on an Apple M1 Max, on a page served without COOP and COEP.
Firefox was not measured: Playwright's Firefox build and the installed Firefox 157 both fail to start headless on the test machine.
The numbers come from a run on 2026-10-15 with no other builds running. The normal desktop apps were open, and the load average was about 8 to 9.

What S3 found (Chrome unless noted):

- No memory can be shared or handed over:
  - A `WebAssembly.Memory` cannot be posted (DataCloneError).
  - Its buffer cannot be transferred (TypeError: not detachable).
  - A shared `WebAssembly.Memory` can be made, but it cannot be posted without cross-origin isolation (DataCloneError).
- So data that leaves a wasm instance is copied once, out of wasm memory, into an ArrayBuffer.
  - Copy into a new buffer: about 0.11 ms per MB. 10 million f64 (80 MB): 9.0 ms.
  - Copy into a buffer that is used again: about 0.022 ms per MB. 80 MB: 1.8 ms. The extra cost of a new buffer is the first write to new pages.
  - Copy from an ArrayBuffer into wasm memory that was used before: about 0.026 ms per MB (80 MB: 2.1 ms). The first copy into newly grown wasm memory pays the same first-write cost as a new buffer (80 MB: 7.7 ms). The grow itself takes under 1 ms.
- Moving an ArrayBuffer by transfer costs almost nothing and does not depend much on the size.
  - Round trip page to worker or worker to worker, up to 80 MB: 0.02 to 0.03 ms (Chrome) and 0.05 to 0.33 ms (WebKit). At 400 MB: under 0.7 ms.
- Moving it by structured clone (no transfer list) copies it twice on every hop: once in the sender's `postMessage`, and once in the receiver when it first reads the message.
  - 80 MB one way: 19 ms in Chrome (about 0.2 ms per MB), and the sender is blocked for 7.4 ms of it. WebKit: 5 to 7 ms.
  - A clone only beats a transfer for tiny messages. The two meet between 1 KB and 64 KB.
  - Posting a typed array view on wasm memory clones the whole wasm memory: 57 ms and 257 MB for a view of 100 KB.
- End to end, 10 million f64 from the compute worker's wasm memory to a `Float64Array` on the page: 8.2 ms with a new buffer. With a buffer that the page sends back each time, 2.2 ms in the steady state; the first transfer still pays the first-write cost. WebKit: 2.2 to 2.4 ms.
- Display data is cheap. Decimated points of one trace (4 x 3200 f64, 100 KB), from request to reply: 0.08 ms (Chrome and WebKit). With many requests in flight, 0.015 to 0.02 ms each. Copying the reply into another wasm memory (such as the render module's) takes 0.002 ms.
- Posting a `File` or `Blob` does not copy its bytes: 0 to 0.1 ms, even for 400 MB.
  Reading 400 MB in the worker takes about 0.23 s in Chrome and 0.13 s in WebKit, whether it reads a stream into wasm memory or calls `arrayBuffer()` and then copies.
  The peak extra memory differs (Chrome): 524 MB with the stream, 764 MB with `arrayBuffer()`.
- wasm memory never shrinks. After Rust frees a 400 MB array, the 401 MB of wasm memory stay resident. A new allocation uses the freed pages again.
- `memory.grow` detaches the old `memory.buffer`. Views made before a grow have length 0.

## Options

1. **Shared memory through a service worker.** A service worker (such as coi-serviceworker) adds COOP and COEP, so the page becomes cross-origin isolated. The compute worker's wasm memory is shared, and the main thread reads it directly.
2. **Structured clone.** Post arrays without a transfer list. The browser copies them.
3. **Transfer, with one copy at each wasm boundary.** The sender copies data out of its wasm memory into an ArrayBuffer and transfers it. The receiver copies it into its own wasm memory if it uses the data in wasm. Big arrays stay in the compute worker. Data crosses only when the main thread needs it.

## Decision

Option 3. These are the rules:

1. **Data moves between threads only by `postMessage`.** figlab does not use `SharedArrayBuffer`, shared wasm memory, or cross-origin isolation.
2. **Every ArrayBuffer is posted in the transfer list.** No structured clone of array data. Never post a typed array view on wasm memory: copy the part that is needed first (`slice`), then transfer that.
3. **Big arrays stay in the compute worker.** Data crosses to the main thread only when the main thread needs it:
   - display data for most views: decimated points (9.3), the visible rows of a table (7), nearest points for tooltips (12.3.2), and fit results
   - the whole trace for WebGL markers (9.3) and for export of marker traces
4. **One copy at each wasm boundary.** The compute worker copies the requested points out of its wasm memory into an ArrayBuffer and transfers it. The render module copies them into its own wasm memory. TypeScript reads the draw data from the render module's memory. Both are on the main thread, so that read needs no copy.
5. **Reuse buffers for large, repeated transfers.** When large buffers cross again and again (for example, chunks of a big array, or the same large request many times), the receiver sends each buffer back with its next request (a pool). In the steady state this cuts the copy from 8.2 ms to 2.2 ms for 80 MB in Chrome. The first transfer still pays the first-write cost. Data that crosses only once, such as a trace sent to the GPU, gains nothing from a pool. Display requests do not need a pool either.
6. **Files go to the compute worker as `File` objects.** The main thread does not read file contents. The compute worker reads the file in parts: as a stream, or in slices with `File.slice()` for formats that need random access, such as Parquet. It copies each part into wasm memory, or parses it as it arrives. This keeps the peak memory near one copy of the data, and it lets plotting start before reading finishes (10.1).
7. **The compute worker writes files itself.** When saving (11.3), it gets the file or folder handle from the main thread and writes arrays in chunks. Array contents do not cross to the main thread. S3 did not test this; `createWritable()` and OPFS sync access handles are the candidates.
8. **Large data that must cross to the main thread moves in chunks** where the receiver allows it, so that the compute worker never holds a second copy of a whole big array.
9. **TypeScript makes views on wasm memory again after every call into wasm that may allocate.** A grow detaches the old `memory.buffer`.

## Reasons

- Option 1 adds a second data path that the app cannot drop. spec.md 13 (Offline) already plans a service worker, so adding the headers would be cheap. But the page is not always isolated:
  - On the first visit, the service worker must install, and then the page must reload.
  - A hard reload bypasses the service worker, so coi-serviceworker has to reload the page once more.
  - Firefox private windows run no service workers at all, so the page is never isolated there.

  So the app must work without shared memory anyway, and a second, shared-memory path doubles the work and the tests.
  Also, COEP blocks cross-origin resources that do not opt in, and shared wasm memory needs a Rust build with atomics, which needs a nightly toolchain to rebuild `std`.
- Option 2 copies twice on every hop and blocks the sender during the first copy. In Chrome it costs about 0.2 ms per MB per hop. It is slower than a transfer for every message above a few KB. A posted view on wasm memory brings all of wasm memory with it.
- Option 3 costs almost nothing for the data that actually crosses. A display request costs 0.015 to 0.08 ms from request to reply. That is wall time with an idle worker, not CPU time on the main thread. Still, it shows that the messaging itself does not limit the frame rate: hundreds of requests fit in one 16.7 ms frame. The one copy at each wasm boundary cannot be avoided without shared memory, and it is small for display data. Even a whole trace of 10 million f64 crosses in 2 to 9 ms.
- Keeping big arrays in the compute worker also keeps memory low. A copy of a whole array needs room for a second copy, and wasm memory does not give pages back.

## Consequences

- The main thread holds array contents only when it needs them: display data for most views, and the whole trace for WebGL markers and for export of marker traces. The size of that trace depends on the point format chosen for the GPU (S2, ADR 0011).
- The message protocol between the threads always carries ArrayBuffers in the transfer list. A test or lint rule should check this, because a missing transfer list still works but is slower and blocks the sender.
- The compute worker needs a "copy out" function for each kind of request (decimated points, table rows, nearest points). Each copies into a new or a reused buffer.
- Memory: the 2 GB limit in spec.md 13 is on the compute worker's wasm memory, plus the ArrayBuffers in flight outside it. wasm memory never shrinks, but pages freed by one array are reused by later arrays. A copy out of wasm memory needs room for a second copy until the copy is freed.
- Firefox was not measured. The rules use only standard APIs, so they should hold there too. The end-to-end tests in M3 run Quick Plot in Firefox.
- If GitHub Pages ever sends COOP and COEP, shared memory could remove the copy at the boundary. The rules above still work then.

This change updates spec.md to match:

- Section 4: the diagram passes File objects and file handles to the compute worker, which reads and writes the contents. A new rule says that data moves only by `postMessage` with every ArrayBuffer in the transfer list, that data is copied once at each wasm boundary, and when data crosses to the main thread.
- 9.1: the compute worker copies decimated points out and transfers them; the render module copies them into its own wasm memory; TypeScript reads the draw data from the render module's memory.
- 9.3, markers: the whole trace crosses to the main thread once. Its size depends on the point format for the GPU (ADR 0011).
- 10: the main thread passes `File` objects to the compute worker, which reads them in parts.
- 11.3: the compute worker writes arrays to the file itself, in chunks ([To confirm]: not tested yet).
- 13, Memory: the limit is on the compute worker's wasm memory, which never shrinks, plus the ArrayBuffers in flight outside it.
