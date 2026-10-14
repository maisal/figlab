// Side checks for the Preact decision (ADR 0014), as evidence that anyone can re-run:
//
// 1. Preact variants: Preact 10 with Vite's own JSX transform (the reference
//    app), Preact 10 with @preact/preset-vite, and Preact 11 with Vite's own
//    transform. For each: bundle size, build time, and the smoke test on the
//    production build.
// 2. Hooks lint with equal rules: eslint-plugin-react-hooks on the Preact and
//    React reference apps and trial apps, once with its v7 "recommended"
//    preset and once with only the two classic rules (rules-of-hooks and
//    exhaustive-deps).
//
// Use: node harness/variants.mjs [--builds N]   (default 5 builds per variant)
// Writes results/variants.json. Work folders go to dist-variants/ (ignored).
// The build times come from one run on a busy machine. They were not repeated on a quiet one.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { serve } from "./serve.mjs";
import { runSmoke } from "./smoke.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, "dist-variants");
const args = process.argv.slice(2);
const buildsAt = args.indexOf("--builds");
const BUILDS = buildsAt >= 0 ? Number(args[buildsAt + 1]) : 5;
const HOOKS_PLUGIN = "eslint-plugin-react-hooks@7.1.1";

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  return { n: v.length, median: Math.round(at(0.5)), max: Math.round(v[v.length - 1]) };
}

/** Copy an app folder without node_modules and dist. */
function copyApp(from, to) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (src) => !/\/(node_modules|dist)(\/|$)/.test(src) });
}

const pnpm = (cwd, ...cmdArgs) => execFileSync("pnpm", cmdArgs, { cwd, stdio: ["ignore", "ignore", "inherit"] });

function setJson(file, change) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  change(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function sizes(dir) {
  const assets = join(dir, "dist", "assets");
  const js = readdirSync(assets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assets, f)));
  const all = Buffer.concat(js);
  return {
    raw: all.length,
    gzip: js.reduce((s, b) => s + gzipSync(b, { level: 9 }).length, 0),
    brotli: js.reduce((s, b) => s + brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, 0),
  };
}

mkdirSync(work, { recursive: true });
const out = { date: new Date().toISOString(), builds: BUILDS, preact: [], hooksLint: [] };

// 1. Preact variants.
const PRESET_CONFIG = `import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
`;
const variants = [
  { name: "preact-10-vite-jsx", setup: () => {} },
  {
    name: "preact-10-preset",
    setup: (dir) => {
      setJson(join(dir, "package.json"), (p) => {
        p.devDependencies["@preact/preset-vite"] = "2.10.6";
      });
      writeFileSync(join(dir, "vite.config.ts"), PRESET_CONFIG);
    },
  },
  {
    name: "preact-11-vite-jsx",
    setup: (dir) => {
      setJson(join(dir, "package.json"), (p) => {
        p.dependencies.preact = "11.0.1";
      });
    },
  },
];
for (const v of variants) {
  const dir = join(work, v.name);
  copyApp(join(root, "apps", "preact"), dir);
  v.setup(dir);
  pnpm(dir, "install", "--prefer-offline", "--no-frozen-lockfile");
  const vite = join(dir, "node_modules", "vite", "bin", "vite.js");
  const times = [];
  for (let i = 0; i < BUILDS; i++) {
    const started = performance.now();
    execFileSync(process.execPath, [vite, "build", "--logLevel", "error"], { cwd: dir, stdio: "inherit" });
    times.push(performance.now() - started);
  }
  const server = await serve(join(dir, "dist"));
  let behaviors;
  try {
    behaviors = await runSmoke(server.url);
  } finally {
    await server.close();
  }
  const failed = behaviors.filter((b) => !b.ok);
  const versions = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const result = {
    name: v.name,
    preact: versions.dependencies.preact,
    preset: versions.devDependencies["@preact/preset-vite"] ?? null,
    size: sizes(dir),
    buildMs: stats(times),
    smokePassed: behaviors.length - failed.length,
    smokeFailed: failed,
  };
  out.preact.push(result);
  console.log(
    `${v.name.padEnd(20)} JS ${(result.size.raw / 1000).toFixed(1)} raw / ${(result.size.gzip / 1000).toFixed(1)} gzip kB,` +
      ` build ${result.buildMs.median} ms (max ${result.buildMs.max}), smoke ${result.smokePassed}/${behaviors.length}` +
      (failed.length ? ` failed: ${failed.map((f) => `${f.id}: ${f.detail}`).join("; ")}` : ""),
  );
}

// 2. Hooks lint with equal rules. Trial apps are rebuilt from their template
// plus the source files that results/trial/<name>/src keeps.
const targets = [
  { name: "apps/preact", from: join(root, "apps", "preact") },
  { name: "apps/react", from: join(root, "apps", "react") },
  { name: "trial t1-preact", from: join(root, "templates", "preact"), overlay: join(root, "results", "trial", "t1-preact", "src") },
  { name: "trial t1-react", from: join(root, "templates", "react"), overlay: join(root, "results", "trial", "t1-react", "src") },
];
const RULE_SETS = {
  recommended: "reactHooks.configs.flat.recommended",
  classic: `{ plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" } }`,
};
for (const t of targets) {
  if (t.overlay && !existsSync(t.overlay)) continue;
  const dir = join(work, `lint-${t.name.replace(/[^a-z0-9]+/g, "-")}`);
  copyApp(t.from, dir);
  if (t.overlay) cpSync(t.overlay, join(dir, "src"), { recursive: true });
  pnpm(dir, "install", "--prefer-offline", "--no-frozen-lockfile");
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (!pkg.devDependencies["eslint-plugin-react-hooks"]) pnpm(dir, "add", "-D", "--save-exact", HOOKS_PLUGIN);
  for (const [set, config] of Object.entries(RULE_SETS)) {
    writeFileSync(
      join(dir, "eslint.config.js"),
      `import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig(
  { ignores: ["dist/"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, ${config}],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
`,
    );
    const r = spawnSync(join(dir, "node_modules", ".bin", "eslint"), ["src", "--format", "json"], { cwd: dir, encoding: "utf8" });
    const report = JSON.parse(r.stdout || "[]");
    const byRule = {};
    for (const file of report) {
      for (const m of file.messages) if (m.severity === 2) byRule[m.ruleId ?? "parse"] = (byRule[m.ruleId ?? "parse"] ?? 0) + 1;
    }
    out.hooksLint.push({ target: t.name, rules: set, errors: byRule });
    console.log(`lint ${t.name.padEnd(16)} ${set.padEnd(12)} ${JSON.stringify(byRule)}`);
  }
}

const file = join(root, "results", "variants.json");
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`written: ${file}`);
