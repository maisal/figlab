// Check the licenses of npm packages against the allow list in
// docs/development.md 6.6. Run by `mise run check:deps`.
//
// Packages that ship in the app (dependencies) must use a license on the
// allow list. Packages used only to build and test (devDependencies) never
// ship, so a few more licenses are allowed for them. Each has a reason below.

import { execFileSync } from "node:child_process";

// The same list as deny.toml.
const allowed = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
]);

const allowedForTools = new Set([
  ...allowed,
  // A permissive license, similar to MIT (used by minimatch).
  "BlueOak-1.0.0",
  // Weak copyleft that covers only the tool's own files. Allowed for build
  // tools only, which never ship (used by lightningcss, through Vite).
  "MPL-2.0",
]);

/** Licenses of the installed packages, keyed by SPDX expression. */
function licenses(prodOnly) {
  const args = ["licenses", "list", "--json"];
  if (prodOnly) args.push("--prod");
  const out = execFileSync("pnpm", args, { encoding: "utf8" });
  // pnpm prints a plain message instead of JSON when there are no packages.
  return out.trim().startsWith("{") ? JSON.parse(out) : {};
}

/**
 * Whether an SPDX expression is satisfied by the given set. Supports `OR`,
 * `AND`, and parentheses, which is enough for npm packages.
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
      pos++; // ")"
      return ok;
    }
    return set.has(token);
  };
  const ok = parseOr();
  return ok && pos === tokens.length;
}

let failed = false;
const prod = licenses(true);
const all = licenses(false);
for (const [list, set, kind] of [
  [prod, allowed, "dependency"],
  [all, allowedForTools, "package"],
]) {
  for (const [license, packages] of Object.entries(list)) {
    if (!satisfies(license, set)) {
      failed = true;
      for (const p of packages) {
        console.error(`not allowed: ${kind} ${p.name} ${p.versions.join(", ")}: ${license}`);
      }
    }
  }
}
if (failed) {
  console.error("See the allow list in docs/development.md 6.6.");
  process.exit(1);
}
console.log("npm licenses ok");
