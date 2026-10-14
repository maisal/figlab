# S3 results

Made by `pnpm run measure` (summary.mjs). The raw numbers are in results.json.

Machine: Apple M1 Max, 10 cores, 64 GB, macOS 27.0.1, Node v24.14.1, Playwright 1.64.0.
Date: 2026-10-15T00:32:33.833Z.

| Browser | Version | Timer step (ms) |
|---|---|---|
| chrome | 155.0.8059.79 | 0.10 |
| webkit | 27.2 | 1.00 |

### Without COOP and COEP

| Check | chrome | webkit |
|---|---|---|
| crossOriginIsolated | false | false |
| typeof SharedArrayBuffer | undefined | undefined |
| post a SharedArrayBuffer | ReferenceError: SharedArrayBuffer is not defined | ReferenceError: Can't find variable: SharedArrayBuffer |
| new shared WebAssembly.Memory | created, buffer is [object SharedArrayBuffer] | created, buffer is [object SharedArrayBuffer] |
| post a shared WebAssembly.Memory | DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated. | DataCloneError: The object can not be cloned. |
| post a WebAssembly.Memory (not shared) | DataCloneError: Failed to execute 'postMessage' on 'Worker': #<Memory> could not be cloned. | DataCloneError: The object can not be cloned. |
| transfer memory.buffer | TypeError: Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 0 is not detachable and could not be transferred. | TypeError: Cannot transfer a WebAssembly.Memory |
| memory.buffer.transfer() | TypeError: ArrayBuffer is not detachable and could not be cloned. | TypeError: Receiver cannot be detached because it is WebAssembly.Memory |
| structuredClone(memory.buffer) | copied 1114112 bytes | copied 1114112 bytes |
| old memory.buffer after memory.grow | {"before":1114112,"afterGrow":0,"detached":true} | {"before":1114112,"afterGrow":0,"detached":true} |

### Control: with COOP and COEP

| Check | chrome | webkit |
|---|---|---|
| crossOriginIsolated | true | true |
| typeof SharedArrayBuffer | function | function |
| post a SharedArrayBuffer | posted | posted |
| new shared WebAssembly.Memory | created, buffer is [object SharedArrayBuffer] | created, buffer is [object SharedArrayBuffer] |
| post a shared WebAssembly.Memory | posted; the page reads 42 written by the worker | posted; the page reads 42 written by the worker |

### A view on wasm memory (256 MB) sent by structured clone

| Browser | What arrives (view clone) | Time, view clone | Time, slice + transfer |
|---|---|---|---|
| chrome | 12800 values in a buffer of 257 MB | 56.5 (78.9) | 0.050 (12.0) |
| webkit | 12800 values in a buffer of 257 MB | 34.0 (95.0) | 0 (1.00) |

### postMessage, chrome (ms, median (p95))

| Size | Runs | Round trip page-worker, transfer | Round trip page-worker, copy | Round trip worker-worker, transfer | Round trip worker-worker, copy |
|---|---|---|---|---|---|
| 1 KB | 40 | 0.021 (0.027) | 0.018 (0.022) | 0.026 (0.033) | 0.020 (0.035) |
| 64 KB | 40 | 0.019 (0.023) | 0.054 (0.086) | 0.026 (0.034) | 0.055 (0.079) |
| 1 MB | 40 | 0.020 (0.024) | 0.59 (0.66) | 0.029 (0.032) | 0.53 (0.67) |
| 8 MB | 40 | 0.022 (0.027) | 3.65 (4.30) | 0.024 (0.031) | 3.88 (4.35) |
| 80 MB | 20 | 0.020 (0.61) | 39.5 (42.9) | 0.022 (0.025) | 40.3 (45.2) |
| 400 MB | 10 | 0.49 (0.53) | 218 (401) | 0.67 (0.70) | 213 (360) |

| Size | One way page to worker, transfer | One way page to worker, copy | Sender blocked in postMessage, copy | One way worker to page, transfer | One way worker to page, copy | One way worker to worker, transfer | One way worker to worker, copy |
|---|---|---|---|---|---|---|---|
| 1 KB | -0.10* (0.00024*) | -0.10* (0.00024*) | 0* (0.10*) | 0.10* (0.20) | 0.10* (0.20) | 0* (0.10*) | 0* (0.10*) |
| 64 KB | -0.10* (0.00024*) | -0.10* (0.00024*) | 0* (0.10*) | 0.10* (0.20) | 0.10* (0.20) | 0* (0.10*) | 0* (0.10*) |
| 1 MB | -0.10* (0*) | 0.15 (0.30) | 0.10* (0.20) | 0.10* (0.20) | 0.30 (0.40) | 0* (0.10*) | 0.30 (0.40) |
| 8 MB | -0.10* (0*) | 1.70 (3.00) | 0.80 (1.00) | 0.10* (0.20) | 2.00 (4.20) | 0* (0.10*) | 1.70 (3.10) |
| 80 MB | 0.30 (0.50) | 18.6 (20.6) | 7.40 (8.40) | 0.70 (0.80) | 18.6 (21.5) | 0.10* (0.20) | 19.4 (21.4) |
| 400 MB | 0.20 (0.40) | 90.2 (103) | 37.0 (40.6) | 0.75 (0.90) | 102 (115) | 0.20 (0.30) | 92.7 (107) |

\* Within one timer step (0.10 ms) of zero. One-way times subtract the clocks of two contexts, and each clock has its own offset of up to one step, so these values can be negative.

### postMessage, webkit (ms, median (p95))

| Size | Runs | Round trip page-worker, transfer | Round trip page-worker, copy | Round trip worker-worker, transfer | Round trip worker-worker, copy |
|---|---|---|---|---|---|
| 1 KB | 40 | 0.047 (0.057) | 0.047 (0.051) | 0.18 (0.21) | 0.17 (0.19) |
| 64 KB | 40 | 0.047 (0.052) | 0.064 (0.074) | 0.17 (0.20) | 0.18 (0.20) |
| 1 MB | 40 | 0.055 (0.070) | 0.33 (0.39) | 0.18 (0.23) | 0.42 (0.50) |
| 8 MB | 40 | 0.10 (0.16) | 1.69 (2.25) | 0.28 (0.36) | 1.84 (1.94) |
| 80 MB | 20 | 0.15 (0.16) | 12.5 (20.5) | 0.33 (0.36) | 12.5 (16.5) |
| 400 MB | 10 | 0.23 (0.25) | 55.5 (86.0) | 0.38 (0.47) | 82.5 (451) |

| Size | One way page to worker, transfer | One way page to worker, copy | Sender blocked in postMessage, copy | One way worker to page, transfer | One way worker to page, copy | One way worker to worker, transfer | One way worker to worker, copy |
|---|---|---|---|---|---|---|---|
| 1 KB | -1.00* (0*) | -1.00* (0*) | 0* (0*) | 1.00* (1.00*) | 1.00* (1.00*) | 0* (0*) | 0* (0*) |
| 64 KB | 0* (0*) | -1.00* (0*) | 0* (0*) | 1.00* (1.00*) | 1.00* (1.00*) | 0* (0*) | 0* (0*) |
| 1 MB | -0.50* (0*) | 0* (0*) | 0* (1.00*) | 1.00* (1.00*) | 1.00* (1.00*) | 0* (0*) | 0* (1.00*) |
| 8 MB | -1.00* (0*) | 0* (1.00*) | 0* (1.00*) | 1.00* (1.00*) | 1.00* (2.00) | 0* (0*) | 1.00* (1.00*) |
| 80 MB | 0* (0*) | 6.00 (8.00) | 4.00 (5.00) | 1.00* (1.00*) | 7.00 (13.0) | 0* (0*) | 5.00 (6.00) |
| 400 MB | -1.00* (0*) | 28.5 (69.0) | 19.0 (27.0) | 0* (1.00*) | 28.0 (57.0) | 0* (0*) | 27.0 (28.0) |

\* Within one timer step (1.00 ms) of zero. One-way times subtract the clocks of two contexts, and each clock has its own offset of up to one step, so these values can be negative.

### Copies at the wasm boundary, in a worker, chrome (ms, median (p95))

| Size | memory.buffer.slice | view.slice() | new Float64Array(n).set(view) | pooled.set(view) | new ArrayBuffer | new Float64Array(n).fill | pooled.fill | into wasm: alloc + set + free | into wasm: set only | into wasm: first alloc (grow), new worker | into wasm: first copy into new pages, new worker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 KB | 0.00042 (0.00058) | 0.00059 (0.00078) | 0.00064 (0.00086) | 0.000045 (0.000047) | 0.00048 (0.00077) | 0.00037 (0.00044) | 0.000070 (0.000072) | 0.000094 (0.000095) | 0.000047 (0.000048) | 0 (0.10) | 0 (0) |
| 64 KB | 0.0070 (0.011) | 0.0072 (0.0082) | 0.0073 (0.0080) | 0.0011 (0.0011) | 0.0053 (0.011) | 0.0085 (0.011) | 0.0026 (0.0027) | 0.0011 (0.0011) | 0.0010 (0.0011) | 0 (0.10) | 0 (0) |
| 1 MB | 0.10 (0.11) | 0.091 (0.10) | 0.092 (0.095) | 0.018 (0.020) | 0.0079 (0.0099) | 0.12 (0.12) | 0.040 (0.041) | 0.020 (0.023) | 0.019 (0.022) | 0 (0) | 0.10 (0.20) |
| 8 MB | 0.89 (0.99) | 0.80 (1.08) | 0.76 (0.83) | 0.16 (0.19) | 0.023 (0.030) | 0.89 (1.00) | 0.33 (0.34) | 0.19 (0.26) | 0.18 (0.24) | 0 (0) | 0.80 (0.80) |
| 80 MB | 8.95 (11.6) | 6.70 (8.20) | 7.30 (8.00) | 1.79 (1.95) | 0.096 (0.10) | 8.70 (9.40) | 3.60 (4.70) | 2.13 (2.50) | 2.10 (3.40) | 0.50 (0.60) | 7.70 (9.20) |
| 400 MB | 42.9 (48.9) | 36.5 (75.5) | 38.9 (80.8) | 8.60 (9.90) | 0.091 (0.11) | 41.5 (50.5) | 15.6 (16.0) | 8.45 (10.7) | 8.40 (9.10) | 0.50 (0.60) | 38.0 (43.0) |

### Copies at the wasm boundary, in a worker, webkit (ms, median (p95))

| Size | memory.buffer.slice | view.slice() | new Float64Array(n).set(view) | pooled.set(view) | new ArrayBuffer | new Float64Array(n).fill | pooled.fill | into wasm: alloc + set + free | into wasm: set only | into wasm: first alloc (grow), new worker | into wasm: first copy into new pages, new worker |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 KB | 0.00020 (0.00027) | 0.00011 (0.00011) | 0.00014 (0.00015) | 0.000064 (0.000069) | 0.00021 (0.00022) | 0.00012 (0.00013) | 0.000029 (0.000031) | 0.00013 (0.00015) | 0.000067 (0.000073) | 0 (0) | 0 (0) |
| 64 KB | 0.0024 (0.0028) | 0.0022 (0.0027) | 0.0028 (0.0033) | 0.0012 (0.0014) | 0.0019 (0.0021) | 0.0029 (0.0034) | 0.0012 (0.0014) | 0.0011 (0.0013) | 0.0011 (0.0012) | 0 (0) | 0 (0) |
| 1 MB | 0.033 (0.036) | 0.030 (0.033) | 0.038 (0.040) | 0.018 (0.020) | 0.019 (0.021) | 0.034 (0.039) | 0.016 (0.017) | 0.019 (0.020) | 0.019 (0.021) | 0 (0) | 0 (1.00) |
| 8 MB | 0.21 (0.25) | 0.21 (0.26) | 0.31 (0.33) | 0.16 (0.17) | 0.11 (0.14) | 0.24 (0.26) | 0.13 (0.13) | 0.19 (0.25) | 0.16 (0.19) | 0 (0) | 1.00 (1.00) |
| 80 MB | 1.83 (4.17) | 1.83 (2.33) | 3.00 (3.13) | 1.75 (1.83) | 1.16 (1.19) | 2.56 (2.75) | 1.29 (1.29) | 1.72 (2.06) | 1.67 (1.75) | 0 (0) | 7.00 (8.00) |
| 400 MB | 36.0 (84.0) | 10.0 (117) | 43.0 (64.0) | 9.00 (10.3) | 5.50 (6.25) | 12.5 (23.5) | 6.50 (7.25) | 9.33 (10.7) | 9.83 (10.3) | 0 (0) | 36.0 (37.0) |

### End to end: 10 million f64 (80 MB) (ms, median (p95))

| Case | chrome total | chrome copy in worker | webkit total | webkit copy in worker |
|---|---|---|---|---|
| worker wasm to page: slice + transfer | 8.15 (15.8) | 8.00 (9.70) | 2.19 (2.88) | 2.00 (8.00) |
| worker wasm to page: copy into a pooled buffer + transfer | 2.23 (3.05) | 2.00 (3.30) | 2.38 (2.88) | 2.00 (3.00) |
| worker wasm to page: slice + structured clone | 32.2 (37.6) | 9.70 (14.3) | 19.0 (24.0) | 8.00 (9.00) |
| page to worker wasm: transfer + copy in (buffer sent back) | 2.16 (2.45) | 2.00 (3.30) | 2.58 (2.92) | 2.00 (3.00) |
| page to worker wasm: structured clone + copy in | 23.1 (29.3) | 3.80 (7.70) | 15.0 (16.7) | 2.00 (4.00) |

### Display data: decimated points of one trace, worker to page

| Case | chrome | webkit |
|---|---|---|
| f64: latency (ms) | 0.080 (0.10) | 0.082 (0.094) |
| f64: copy into the page's wasm (ms) | 0.0017 (0.0019) | 0.0018 (0.0019) |
| f64: 1 requests at once, ms per message | 0.076 | 0.059 |
| f64: 4 requests at once, ms per message | 0.033 | 0.026 |
| f64: 16 requests at once, ms per message | 0.021 | 0.016 |
| f64: 64 requests at once, ms per message | 0.017 | 0.015 |
| f64: 256 requests at once, ms per message | 0.016 | 0.014 |
| f32: latency (ms) | 0.072 (0.094) | 0.060 (0.072) |
| f32: copy into the page's wasm (ms) | 0.00090 (0.00096) | 0.00085 (0.00090) |
| f32: 1 requests at once, ms per message | 0.039 | 0.088 |
| f32: 4 requests at once, ms per message | 0.023 | 0.030 |
| f32: 16 requests at once, ms per message | 0.016 | 0.017 |
| f32: 64 requests at once, ms per message | 0.015 | 0.013 |
| f32: 256 requests at once, ms per message | 0.015 | 0.011 |

### Files: post a File to the worker and read it there (ms, median (p95))

| Case | chrome | webkit |
|---|---|---|
| 8 MB: postMessage(file) on the page | 0 (0.10) | 0 (0) |
| 8 MB: worker reads a stream into wasm, total | 6.10 (15.5) | 5.00 (5.00) |
| 8 MB: worker arrayBuffer() then copy into wasm, total | 5.65 (8.20) | 5.00 (6.00) |
| 8 MB: page arrayBuffer(), transfer, copy into wasm, total | 7.45 (8.60) | 3.00 (4.00) |
| 80 MB: postMessage(file) on the page | 0 (0.10) | 0 (0) |
| 80 MB: worker reads a stream into wasm, total | 46.1 (61.1) | 25.5 (28.0) |
| 80 MB: worker arrayBuffer() then copy into wasm, total | 45.9 (58.2) | 26.0 (27.0) |
| 80 MB: page arrayBuffer(), transfer, copy into wasm, total | 46.5 (61.9) | 26.0 (28.0) |
| 400 MB: postMessage(file) on the page | 0 (0.10) | 0 (1.00) |
| 400 MB: worker reads a stream into wasm, total | 232 (353) | 125 (132) |
| 400 MB: worker arrayBuffer() then copy into wasm, total | 234 (244) | 132 (135) |
| 400 MB: page arrayBuffer(), transfer, copy into wasm, total | 223 (269) | 125 (130) |
| 80 MB Blob made in memory: postMessage(blob) | 0 (0.10) | 0 (1.00) |

### Memory (Chrome 155.0.8059.79, resident MB of all browser processes, array of 400 MB)

| Step | Before | Peak | After | wasm memory (MB) |
|---|---|---|---|---|
| baseline | 987 | 988 | 988 | - |
| alloc | 988 | 1372 | 1372 | 401 |
| copyOut | 1372 | 1754 | 1754 | 401 |
| transfer | 1756 | 1758 | 1758 | 401 |
| free | 1758 | 1758 | 1758 | 401 |
| gc | 1758 | 1760 | 1760 | 401 |
| dropMain | 1761 | 1761 | 1382 | - |
| alloc | 1383 | 1383 | 1383 | 401 |

| Read a file into worker wasm | File (MB) | Before | Peak | Peak increase |
|---|---|---|---|---|
| readStream | 400 | 1015 | 1539 | 524 |
| readArrayBuffer | 400 | 1016 | 1780 | 764 |
| mainReadTransfer | 400 | 1019 | 1784 | 765 |
