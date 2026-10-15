// Checks that the wasm build gives the same bytes as the native build:
// the draw data of the sample page (rustybuzz and harfrust) and the four PDFs.
// Needs: cargo run --release -p s1-native --bin outputs, and scripts/build-wasm.sh.
// Output: results/determinism.json
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const FONT_FILES = [
  "Arimo-Regular.ttf", "Arimo-Italic.ttf", "Arimo-Bold.ttf", "Tinos-Regular.ttf",
  "NotoSansMath-Regular.ttf", "NotoSansSymbols-VF.ttf", "NotoSansSymbols2-Regular.ttf",
  "STIXTwoMath-Regular.ttf", "LibertinusMath-Regular.ttf", "NotoSans-VF.ttf", "FiraMath-Regular.otf",
];
const NOTO_MATH = 4;
const FIRA_MATH = 10;
const { instance } = await WebAssembly.instantiate(await readFile("dist/s1_all.wasm"), {});
const w = instance.exports;
for (const [id, f] of FONT_FILES.entries()) {
  const b = await readFile(`downloads/fonts/${f}`);
  const ptr = w.s1_alloc(b.length);
  new Uint8Array(w.memory.buffer, ptr, b.length).set(b);
  w.s1_load_font(id, ptr, b.length);
}
w.s1_init();
const out = (len) => Buffer.from(new Uint8Array(w.memory.buffer, w.s1_out_ptr(), len));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const cases = [
  ["drawdata-rb.bin", () => w.s1_draw_sample(0, NOTO_MATH)],
  ["drawdata-hr.bin", () => w.s1_draw_sample(1, NOTO_MATH)],
  ["krilla-noto.pdf", () => w.s1_pdf_sample(0, 1, NOTO_MATH)],
  ["pdfwriter-noto.pdf", () => w.s1_pdf_sample(1, 1, NOTO_MATH)],
  ["krilla-fira.pdf", () => w.s1_pdf_sample(0, 1, FIRA_MATH)],
  ["pdfwriter-fira.pdf", () => w.s1_pdf_sample(1, 1, FIRA_MATH)],
];
const rows = [];
let ok = true;
for (const [name, f] of cases) {
  const wasmBytes = Buffer.from(out(f()));
  const again = Buffer.from(out(f()));
  const native = await readFile(`target/out/${name}`);
  const same = sha(wasmBytes) === sha(native);
  ok &&= same && wasmBytes.equals(again);
  rows.push({ name, bytes: native.length, sha256: sha(native), wasmSameAsNative: same, wasmRepeatSame: wasmBytes.equals(again) });
  console.log(`${name}: ${native.length} B, wasm == native: ${same}, wasm repeat same: ${wasmBytes.equals(again)}`);
}
await writeFile("results/determinism.json", JSON.stringify({ allSame: ok, node: process.version, files: rows }, null, 1) + "\n");
process.exit(ok ? 0 : 1);
