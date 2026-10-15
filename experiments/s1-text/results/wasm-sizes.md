| Module | Contents | Raw KB | wasm-opt -Oz KB | gzip -9 KB | brotli -q 11 KB |
|---|---|---|---|---|---|
| base | allocator and layout code only, no shaper | 22.2 | 19.1 | 8.9 | 7.6 |
| rb | rustybuzz 0.20 + ttf-parser 0.25 (shaping, outlines, draw data) | 581.4 | 531.3 | 226.7 | 175.2 |
| hr | harfrust 0.14 + skrifa 0.48 (shaping, outlines, draw data) | 938.9 | 789.0 | 313.7 | 249.7 |
| hr08 | harfrust 0.8.4 + skrifa 0.42 (shaping, outlines, draw data) | 789.4 | 650.7 | 259.0 | 208.6 |
| rb+krilla | rustybuzz + krilla 0.8.2 | 1687.9 | 1449.8 | 601.6 | 466.8 |
| hr+krilla | harfrust 0.14 + krilla 0.8.2 (two font stacks: read-fonts 0.45 and 0.39) | 2051.7 | 1704.2 | 694.9 | 522.4 |
| hr08+krilla | harfrust 0.8.4 + krilla 0.8.2 (one font stack: read-fonts 0.39) | 1669.9 | 1397.0 | 574.3 | 444.5 |
| rb+pdfw | rustybuzz + pdf-writer 0.15 + subsetter 0.2.6 + skrifa 0.48 | 777.6 | 703.6 | 308.7 | 249.1 |
| hr+pdfw | harfrust 0.14 + pdf-writer 0.15 + subsetter 0.2.6 (one font stack: read-fonts 0.45) | 1134.1 | 961.5 | 406.6 | 324.7 |
