// Run the S6 tests in wasm under Node and write the JSON records to
// target/s6-results/wasm (or the folder given as the first argument).
// Build first: scripts/build-wasm.sh
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const wasmPath = new URL("../target/wasm32-unknown-unknown/release/s6wasm.wasm", import.meta.url);
const outDir = process.argv[2] ?? "target/s6-results/wasm";
const mod = new WebAssembly.Module(readFileSync(wasmPath));
const imports = WebAssembly.Module.imports(mod);
if (imports.length > 0) {
  throw new Error(`unexpected imports: ${JSON.stringify(imports)}`);
}
const { exports } = new WebAssembly.Instance(mod, {});

mkdirSync(outDir, { recursive: true });
for (const [kind, name] of [[0, "nist"], [1, "bounds"], [2, "gauss"]]) {
  const len = exports.run(kind);
  const ptr = exports.out_ptr();
  const text = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
  writeFileSync(`${outDir}/${name}.json`, text);
  console.error(`wrote ${outDir}/${name}.json`);
}
