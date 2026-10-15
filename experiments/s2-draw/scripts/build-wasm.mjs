// Builds the wasm module twice (plain and with simd128), runs wasm-opt, and
// copies the results to pkg/. Run from experiments/s2-draw: `pnpm run build:wasm`.
//
// The tools come from mise (mise.toml at the repository root pins Rust; wasm-opt
// is fetched on demand with `mise exec aqua:WebAssembly/binaryen@133`).

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const crate = root;
const pkg = join(root, "pkg");
mkdirSync(pkg, { recursive: true });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: crate, ...opts });
  if (r.status !== 0) {
    console.error(`failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

const variants = [
  { name: "s2_draw", targetDir: "target", rustflags: "", optFlags: [] },
  {
    name: "s2_draw_simd",
    targetDir: "target/simd",
    rustflags: "-C target-feature=+simd128",
    optFlags: ["--enable-simd"],
  },
];

// Features that Rust 1.99 enables by default on wasm32-unknown-unknown.
const features = [
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-multivalue",
  "--enable-reference-types",
];

for (const v of variants) {
  console.log(`\n== ${v.name} ==`);
  run(
    "mise",
    ["exec", "--", "cargo", "build", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--target-dir", v.targetDir],
    { env: { ...process.env, RUSTFLAGS: v.rustflags } },
  );
  const built = join(root, v.targetDir, "wasm32-unknown-unknown", "release", "s2_draw.wasm");
  const out = join(pkg, `${v.name}.wasm`);
  run("mise", [
    "exec",
    "aqua:WebAssembly/binaryen@133",
    "--",
    "wasm-opt",
    "-O3",
    ...features,
    ...v.optFlags,
    built,
    "-o",
    out,
  ]);
  console.log(`${out}: ${statSync(out).size} bytes`);
}
