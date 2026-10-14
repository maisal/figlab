// Builds the stand-in wasm modules in many variants and measures their size.
//
// Usage:
//   node scripts/build-wasm.mjs          all variants, writes results/sizes.json and results/sizes.md
//   node scripts/build-wasm.mjs --app    only the modules the Vite app uses (pkg/app/)
//   node scripts/build-wasm.mjs --only a,b   rebuild these variants and update results/sizes.json
//
// Steps for each variant: cargo build (wasm32-unknown-unknown) -> wasm-bindgen
// --target web -> wasm-opt. Sizes are raw, gzip -9, and brotli 11 of the
// final .wasm file, plus the JS glue made by wasm-bindgen.

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attribute } from "./attribute.mjs";
import { kib, sizes } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appOnly = process.argv.includes("--app");
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > 0 ? process.argv[onlyArg + 1].split(",") : null;
const TARGET = "wasm32-unknown-unknown";

// Rust 1.99 enables these wasm features by default for wasm32-unknown-unknown.
const WASM_FEATURES = [
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
  "--enable-call-indirect-overlong",
];

function toolPath(spec, bin) {
  return execFileSync("mise", ["exec", spec, "--", "sh", "-c", `command -v ${bin}`], {
    encoding: "utf8",
  }).trim();
}
const WASM_BINDGEN = toolPath("github:wasm-bindgen/wasm-bindgen@0.2.129", "wasm-bindgen");
const WASM_OPT = toolPath("aqua:WebAssembly/binaryen@133", "wasm-opt");

// The number of generated functions that stand in for figlab's own code
// (rust/ballast). See README "Allowance for figlab's own code".
export const BALLAST = { compute: 900, render: 450, lang: 250 };

// Variants. `features` are passed with --no-default-features.
const V = [];
const add = (id, crate, features, group, note, extra = {}) =>
  V.push({ id, crate, features, group, note, ...extra });

// Fixed cost of a module.
add("baseline", "m-baseline", [], "baseline", "wasm-bindgen, one function, no allocation");
add("baseline-alloc", "m-baseline", ["alloc"], "baseline", "+ Vec (allocator)");
add("baseline-fmt", "m-baseline", ["fmt"], "baseline", "+ format! of a float (core::fmt)");

// Compute worker.
add("compute", "m-compute", ["csv", "sjis", "fit-lm", "interp"], "compute", "csv + encoding_rs + levenberg-marquardt + stand-in", { main: true });
add("compute-rmpfit", "m-compute", ["csv", "sjis", "fit-rmpfit", "interp"], "compute", "csv + encoding_rs + rmpfit + stand-in");
add("compute-nofit", "m-compute", ["csv", "sjis", "interp"], "compute", "csv + encoding_rs + stand-in (no fitting)");
add("compute-deps", "m-compute", ["csv", "sjis", "fit-lm"], "compute", "libraries only (no stand-in)");
add("compute-standin", "m-compute", ["interp"], "compute", "stand-in only (interpreter, CSV detection)");
add("compute-csv", "m-compute", ["csv"], "compute", "csv only");
add("compute-sjis", "m-compute", ["sjis"], "compute", "encoding_rs (Shift_JIS) only");
add("compute-lm", "m-compute", ["fit-lm"], "compute", "levenberg-marquardt + nalgebra only");
add("compute-rmpfit-only", "m-compute", ["fit-rmpfit"], "compute", "rmpfit only");
add("compute-empty", "m-compute", [], "compute", "import() without csv, sjis, fit, or stand-in");
add("compute-app", "m-compute", ["csv", "sjis", "fit-lm", "interp", "ballast"], "app", "compute + allowance for own code", { app: "compute", ballast: BALLAST.compute });

// Render module.
add("render-hr", "m-render", ["shape-harfrust", "standin"], "render", "harfrust + skrifa (libm, no std) + stand-in", { main: true });
add("render-rb", "m-render", ["shape-rustybuzz", "standin"], "render", "rustybuzz + ttf-parser + stand-in", { main: true });
add("render-rb-only", "m-render", ["shape-rustybuzz"], "render", "rustybuzz + ttf-parser only");
add("render-hr-only", "m-render", ["shape-harfrust"], "render", "harfrust + skrifa (libm) only");
add("render-standin", "m-render", ["standin"], "render", "stand-in only (layout, SVG, no shaping)");
add("render-hr-app", "m-render", ["shape-harfrust", "standin", "ballast"], "app", "render (harfrust) + allowance for own code", { app: "render", ballast: BALLAST.render });
add("render-rb-app", "m-render", ["shape-rustybuzz", "standin", "ballast"], "app", "render (rustybuzz) + allowance for own code", { ballast: BALLAST.render });

// Language service.
add("lang-tables", "m-lang", ["parser", "spec-tables"], "lang", "parser stand-in + commands.json as Rust tables", { main: true });
add("lang-serde", "m-lang", ["parser", "spec-serde"], "lang", "parser stand-in + commands.json read by serde_json");
add("lang-raw", "m-lang", ["parser", "spec-raw"], "lang", "parser stand-in + commands.json as raw text");
add("lang-none", "m-lang", ["parser"], "lang", "parser stand-in, no commands.json");
add("lang-app", "m-lang", ["parser", "spec-tables", "ballast"], "app", "lang (tables) + allowance for own code", { app: "lang", ballast: BALLAST.lang });

// Export modules (loaded later).
add("pdf-writer-skrifa", "m-export-pdf", ["pdf-writer-skrifa"], "export", "pdf-writer + subsetter (no variable-fonts) + skrifa (libm) + miniz_oxide", { main: true, app: "pdf" });
add("pdf-krilla", "m-export-pdf", ["krilla"], "export", "krilla 0.8, default features off", { main: true });
add("pdf-krilla-default", "m-export-pdf", ["krilla-default"], "export", "krilla 0.8, default features on");
add("pdf-writer", "m-export-pdf", ["pdf-writer"], "export", "pdf-writer + subsetter (variable-fonts) + ttf-parser + miniz_oxide", { main: true });
add("pdf-writer-min", "m-export-pdf", ["pdf-writer-min"], "export", "pdf-writer + subsetter (no variable-fonts) + ttf-parser + miniz_oxide");
add("png", "m-export-png", ["png-format"], "export", "tiny-skia (std, png-format)", { main: true, app: "png" });
add("png-raster", "m-export-png", [], "export", "tiny-skia only, no PNG encoder (returns raw pixels)");
add("png-encoder", "m-baseline", ["png-encode"], "baseline", "the png crate alone (encode an RGBA image)");
add("png-default", "m-export-png", ["tiny-skia-default"], "export", "tiny-skia default features (adds simd)");

// One module with render and export, to compare with three modules.
add("render-hr+pdfwriter+png", "m-render", ["shape-harfrust", "standin", "with-pdf-writer-skrifa", "with-png"], "combined", "render (harfrust) + pdf-writer (skrifa) + tiny-skia in one module");
add("render-rb+krilla+png", "m-render", ["shape-rustybuzz", "standin", "with-pdf-krilla", "with-png"], "combined", "render (rustybuzz) + krilla + tiny-skia in one module");
add("render-hr+krilla+png", "m-render", ["shape-harfrust", "standin", "with-pdf-krilla", "with-png"], "combined", "render (harfrust) + krilla + tiny-skia in one module");
add("render-rb+pdfwriter+png", "m-render", ["shape-rustybuzz", "standin", "with-pdf-writer", "with-png"], "combined", "render (rustybuzz) + pdf-writer + tiny-skia in one module");

const PROFILES = ["release", "release-s", "release-o3", "release-plain"];
const OPTS = {
  none: [],
  Oz: ["-Oz"],
  Os: ["-Os"],
  O3: ["-O3"],
  "Oz-converge": ["-Oz", "--converge"],
};

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function cargoBuild(v, profile, nightly) {
  const args = [];
  if (nightly) args.push("+nightly");
  args.push("build", "--quiet", "--target", TARGET, "-p", v.crate, "--no-default-features");
  if (v.features.length) args.push("--features", v.features.join(","));
  args.push("--profile", profile);
  const env = { S4_BALLAST_FNS: String(v.ballast ?? 0) };
  let targetDir = join(root, "target");
  if (nightly) {
    // build-std with immediate-abort panics: no panic messages, no formatting for them.
    args.push("-Z", "build-std=std,panic_abort", "-Z", "build-std-features=optimize_for_size");
    targetDir = join(root, "target", "nightly");
    env.CARGO_TARGET_DIR = targetDir;
    env.RUSTFLAGS = "-Zunstable-options -Cpanic=immediate-abort";
  }
  run("cargo", args, env);
  const name = v.crate.replace(/-/g, "_");
  return join(targetDir, TARGET, profile === "release" ? "release" : profile, `${name}.wasm`);
}

function bindgen(wasm, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  run(WASM_BINDGEN, ["--target", "web", "--out-dir", outDir, wasm]);
  const bg = readdirSync(outDir).find((f) => f.endsWith("_bg.wasm"));
  const js = readdirSync(outDir).find((f) => f.endsWith(".js"));
  return { bg: join(outDir, bg), js: join(outDir, js) };
}

function wasmOpt(input, output, flags, keepNames = false) {
  run(WASM_OPT, [...WASM_FEATURES, ...flags, ...(keepNames ? ["-g"] : ["--strip-debug", "--strip-producers"]), input, "-o", output]);
}

const sizesFile = join(root, "results", "sizes.json");
const results = only && existsSync(sizesFile) ? JSON.parse(readFileSync(sizesFile, "utf8")).results.filter((r) => !only.includes(r.id)) : [];
function record(v, profile, opt, file, js, extra = {}) {
  const s = sizes(readFileSync(file));
  const j = js ? sizes(readFileSync(js)) : null;
  const r = { id: v.id, group: v.group, note: v.note, features: v.features, profile, opt, wasm: s, js: j, ...extra };
  results.push(r);
  console.log(`${v.id.padEnd(26)} ${profile.padEnd(14)} ${opt.padEnd(12)} raw ${kib(s.raw).padStart(8)} KiB  gz ${kib(s.gzip).padStart(7)}  br ${kib(s.brotli).padStart(7)}`);
  return r;
}

const work = join(root, "pkg", "work");
mkdirSync(work, { recursive: true });

const selected = only ? V.filter((v) => only.includes(v.id)) : appOnly ? V.filter((v) => v.app) : V;
for (const v of selected) {
  const profiles = v.main && !appOnly ? PROFILES : ["release"];
  for (const profile of profiles) {
    const wasm = cargoBuild(v, profile, false);
    const dir = join(work, `${v.id}.${profile}`);
    const { bg, js } = bindgen(wasm, dir);
    const opts = v.main && profile === "release" && !appOnly ? Object.keys(OPTS) : profile === "release" ? ["none", "Oz"] : ["Oz"];
    for (const opt of opts) {
      const out = join(dir, `opt-${opt}.wasm`);
      if (opt === "none") copyFileSync(bg, out);
      else wasmOpt(bg, out, OPTS[opt]);
      record(v, profile, opt, out, js);
    }
    if (profile === "release" && !appOnly) {
      // Attribution by crate, on the -Oz output with names kept.
      const named = join(dir, "opt-Oz-named.wasm");
      wasmOpt(bg, named, OPTS.Oz, true);
      results[results.length - 1].crates = attribute(readFileSync(named));
    }
    if (v.app && profile === "release") {
      const appDir = join(root, "pkg", "app", v.app);
      rmSync(appDir, { recursive: true, force: true });
      mkdirSync(appDir, { recursive: true });
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".js") || f.endsWith(".d.ts")) copyFileSync(join(dir, f), join(appDir, f));
      }
      copyFileSync(join(dir, "opt-Oz.wasm"), join(appDir, bg.split("/").pop()));
    }
  }
}

// Nightly: build-std with immediate-abort panics, for the main variants.
if (!appOnly && spawnSync("cargo", ["+nightly", "--version"], { stdio: "ignore" }).status === 0) {
  for (const v of V.filter((v) => v.main && (!only || only.includes(v.id)))) {
    try {
      const wasm = cargoBuild(v, "release", true);
      const dir = join(work, `${v.id}.nightly`);
      const { bg, js } = bindgen(wasm, dir);
      const out = join(dir, "opt-Oz.wasm");
      wasmOpt(bg, out, OPTS.Oz);
      record(v, "nightly-immediate-abort", "Oz", out, js);
    } catch (e) {
      console.log(`nightly build of ${v.id} failed: ${e.message}`);
    }
  }
}

if (!appOnly) {
  mkdirSync(join(root, "results"), { recursive: true });
  const rustc = execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim();
  const nightly = spawnSync("rustc", ["+nightly", "--version"], { encoding: "utf8" }).stdout?.trim() ?? null;
  writeFileSync(
    sizesFile,
    JSON.stringify({ rustc, nightly, wasmBindgen: "0.2.129", wasmOpt: "binaryen 133", ballast: BALLAST, results }, null, 2) + "\n",
  );
  console.log("wrote results/sizes.json");
}
