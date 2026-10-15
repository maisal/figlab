// Score one app folder for S5: install, check the dependencies, the files that
// must stay as in the template, and the licenses, then type check, lint, build,
// and run the smoke test. Prints PASS or FAIL per step and per behavior.
//
// Use: node harness/score.mjs <app folder> [--out <file.json>] [--no-dev]
//
// The smoke test runs twice: on the production build, and on the Vite dev
// server. The second run finds problems that only show in development, such
// as React StrictMode mounting components twice. --no-dev skips it.
//
// The results are also written to results/scores/<folder name>.json unless
// --out is given. The exit code is 0 only if every step and behavior passed.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { BEHAVIORS, printResults, runSmoke } from "./smoke.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0"]);
// Licenses that tools/check-npm-licenses.mjs allows for build tools that never ship.
const ALLOWED_FOR_TOOLS = new Set([...ALLOWED, "BlueOak-1.0.0", "MPL-2.0"]);
// Dev-only licenses that the templates and reference apps bring in, but that the
// repository's tools list does not have yet. They are reported, not failed:
// CC-BY-4.0 is caniuse-lite (browser data, through Babel), MIT-0 and CC0-1.0
// come with jsdom. See README.md "Licenses".
const KNOWN_DEV_ONLY = new Set([...ALLOWED_FOR_TOOLS, "CC-BY-4.0", "MIT-0", "CC0-1.0"]);
// Files that the app must not change (APP-SPEC.md 1). styles.css may get more rules at the end.
const FIXED_FILES = ["src/types.ts", "src/draw.ts", "src/extensions.ts", "src/table.ts", "tsconfig.json", "eslint.config.js", "vite.config.ts"];

/**
 * Whether an SPDX expression is satisfied by the given set. Supports OR, AND,
 * and parentheses (the same as tools/check-npm-licenses.mjs).
 */
function satisfies(expression, set) {
  const tokens = expression.replace(/[()]/g, (p) => ` ${p} `).trim().split(/\s+/);
  let pos = 0;
  const parseOr = () => {
    let ok = parseAnd();
    while (tokens[pos] === "OR") {
      pos++;
      ok = parseAnd() || ok;
    }
    return ok;
  };
  const parseAnd = () => {
    let ok = parseTerm();
    while (tokens[pos] === "AND") {
      pos++;
      ok = parseTerm() && ok;
    }
    return ok;
  };
  const parseTerm = () => {
    const token = tokens[pos++];
    if (token === "(") {
      const ok = parseOr();
      pos++;
      return ok;
    }
    return set.has(token);
  };
  return parseOr() && pos === tokens.length;
}

const args = process.argv.slice(2);
const withDev = !args.includes("--no-dev");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : null;
const folderArg = args.find((a, i) => !a.startsWith("--") && (outIndex < 0 || i !== outIndex + 1));
if (!folderArg) {
  console.error("use: node harness/score.mjs <app folder> [--out <file.json>]");
  process.exit(2);
}
const app = resolve(folderArg);
const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));

/** Which template the app comes from, judged by its dependencies. */
function framework() {
  const deps = pkg.dependencies ?? {};
  if (deps.react) return "react";
  if (deps.preact) return "preact";
  if (deps["solid-js"]) return "solid";
  if (deps.svelte) return "svelte";
  return "vanilla";
}

function run(cmd, cmdArgs) {
  const started = performance.now();
  const r = spawnSync(cmd, cmdArgs, { cwd: app, encoding: "utf8", env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { ok: r.status === 0, output, seconds: (performance.now() - started) / 1000 };
}

const steps = [];
function step(id, result, detail = "") {
  steps.push({ id, ok: result.ok, seconds: result.seconds, detail: result.ok ? detail : tail(result.output) });
  console.log(`${result.ok ? "PASS" : "FAIL"} ${id}${result.seconds ? ` (${result.seconds.toFixed(1)} s)` : ""}`);
  if (!result.ok) console.log(indent(tail(result.output)));
  return result.ok;
}
const tail = (text) => text.trim().split("\n").slice(-25).join("\n");
const indent = (text) => text.replace(/^/gm, "    ");

const name = framework();
console.log(`app: ${app}`);
console.log(`framework: ${name}`);

// 1. Install if needed. The template's lock file pins the versions.
if (!existsSync(join(app, "node_modules"))) {
  step("install", run("pnpm", ["install", "--prefer-offline"]));
} else {
  steps.push({ id: "install", ok: true, seconds: 0, detail: "already installed" });
  console.log("PASS install (already installed)");
}

// 2. Runtime dependencies must be the template's, with the same versions (APP-SPEC.md 1).
{
  const template = JSON.parse(readFileSync(join(root, "templates", name, "package.json"), "utf8"));
  const extra = Object.entries(pkg.dependencies ?? {}).filter(([d, v]) => template.dependencies[d] !== v);
  step("dependencies", {
    ok: extra.length === 0,
    output: `runtime dependencies not in the template: ${extra.map(([d, v]) => `${d}@${v}`).join(", ")}`,
  });
}

// 3. Files that must stay as in the template.
{
  const template = join(root, "templates", name);
  // Comment lines are ignored, so that a template comment can be fixed later without failing older apps.
  const code = (file) => readFileSync(file, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const changed = FIXED_FILES.filter((f) => !existsSync(join(app, f)) || code(join(app, f)) !== code(join(template, f)));
  const css = join(app, "src", "styles.css");
  if (!existsSync(css) || !readFileSync(css, "utf8").startsWith(readFileSync(join(template, "src", "styles.css"), "utf8"))) {
    changed.push("src/styles.css (the template's rules must stay at the start)");
  }
  step("template-files", { ok: changed.length === 0, output: `changed: ${changed.join(", ")}` });
}

// 4. Licenses: runtime packages must be on the allow list. Dev packages must be
// on the tools list or a known dev-only exception.
function licenseList(prodOnly) {
  const cmdArgs = ["licenses", "list", "--json"];
  if (prodOnly) cmdArgs.push("--prod");
  const text = execFileSync("pnpm", cmdArgs, { cwd: app, encoding: "utf8" });
  return text.trim().startsWith("{") ? JSON.parse(text) : {};
}
{
  let ok = true;
  let output = "";
  try {
    for (const [license, packages] of Object.entries(licenseList(true))) {
      if (!satisfies(license, ALLOWED)) {
        ok = false;
        output += `${license}: ${packages.map((p) => p.name).join(", ")}\n`;
      }
    }
  } catch (e) {
    ok = false;
    output = String(e.message);
  }
  step("licenses", { ok, output });
}
{
  let ok = true;
  let output = "";
  const notes = [];
  try {
    for (const [license, packages] of Object.entries(licenseList(false))) {
      const names = packages.map((p) => p.name).join(", ");
      if (satisfies(license, ALLOWED_FOR_TOOLS)) continue;
      if (satisfies(license, KNOWN_DEV_ONLY)) notes.push(`${license}: ${names}`);
      else {
        ok = false;
        output += `${license}: ${names}\n`;
      }
    }
  } catch (e) {
    ok = false;
    output = String(e.message);
  }
  step("dev-licenses", { ok, output }, notes.length ? `known dev-only exceptions: ${notes.join("; ")}` : "");
  if (ok && notes.length) console.log(indent(`known dev-only exceptions: ${notes.join("; ")}`));
}

// 5. Type check, lint, build.
const typecheck = step("typecheck", run("pnpm", ["run", "-s", "typecheck"]));
const lint = step("lint", run("pnpm", ["run", "-s", "lint"]));
const build = step("build", run("pnpm", ["run", "-s", "build"]));

/** A free TCP port on 127.0.0.1. */
function freePort() {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/** Start the Vite dev server of the app. Resolves to { url, close }. */
async function devServer() {
  const port = await freePort();
  const vite = join(app, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: app,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, close: async () => child.kill() };
}

// 6. Smoke test, on the build and on the dev server.
let behaviors;
if (build) {
  const server = await serve(join(app, "dist"));
  try {
    behaviors = await runSmoke(server.url);
  } finally {
    await server.close();
  }
} else {
  behaviors = BEHAVIORS.map((id) => ({ id, ok: false, detail: "not run: the build failed" }));
}
console.log("smoke test (production build):");
const buildOk = printResults(behaviors);

let devBehaviors = null;
let devOk = true;
if (withDev) {
  const server = await devServer();
  try {
    devBehaviors = await runSmoke(server.url);
  } finally {
    await server.close();
  }
  console.log("smoke test (dev server):");
  devOk = printResults(devBehaviors);
}
const allBehaviors = buildOk && devOk;

// Lines of code the app added (files that differ from the template, without unit tests).
const templateSrc = join(root, "templates", name, "src");
let lines = 0;
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else {
      const rel = path.slice(join(app, "src").length + 1);
      if (/\.test\.|test-setup/.test(rel)) continue; // unit tests are not app code
      const text = readFileSync(path, "utf8");
      const original = join(templateSrc, rel);
      if (existsSync(original) && readFileSync(original, "utf8") === text) continue;
      const n = text.split("\n").filter((l) => l.trim() !== "").length;
      lines += n;
      files.push({ file: rel, lines: n });
    }
  }
}
if (existsSync(join(app, "src"))) walk(join(app, "src"));
console.log(`app code: ${lines} non-empty lines in ${files.length} files`);

const allSteps = steps.every((s) => s.ok);
const shown = relative(root, app);
const result = {
  // Relative to experiments/s5-ui/, so no personal paths end up in the results.
  app: shown.startsWith("..") ? basename(app) : shown,
  framework: name,
  date: new Date().toISOString(),
  ok: allSteps && allBehaviors,
  steps,
  behaviors,
  passed: behaviors.filter((b) => b.ok).length,
  total: behaviors.length,
  devBehaviors,
  devPassed: devBehaviors ? devBehaviors.filter((b) => b.ok).length : null,
  appCode: { lines, files },
};
const file = out ?? join(root, "results", "scores", `${basename(app)}.json`);
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
const devText = devBehaviors ? `, ${result.devPassed}/${result.total} on the dev server` : "";
console.log(`${result.ok ? "RESULT: PASS" : "RESULT: FAIL"} (${result.passed}/${result.total} behaviors${devText}; typecheck ${typecheck ? "ok" : "failed"}, lint ${lint ? "ok" : "failed"}, build ${build ? "ok" : "failed"})`);
console.log(`written: ${file}`);
process.exit(result.ok ? 0 : 1);
