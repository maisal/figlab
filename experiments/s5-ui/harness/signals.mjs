// Cheap public signals for S5: npm downloads in the last week, the date of the
// first release of the current major version, the license, and whether the
// package ships its own TypeScript types. Also checks the CodeMirror wrappers.
//
// Use: node harness/signals.mjs   (needs the network; writes results/signals.json)

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = {
  frameworks: ["react", "react-dom", "preact", "@preact/signals", "solid-js", "svelte", "vue", "lit"],
  codemirror: ["codemirror", "@codemirror/view"],
  wrappers: ["@uiw/react-codemirror", "svelte-codemirror-editor", "solid-codemirror", "@solid-codemirror/codemirror", "vue-codemirror"],
  testing: ["@testing-library/react", "@testing-library/preact", "@solidjs/testing-library", "@testing-library/svelte"],
};

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

async function info(name) {
  const enc = name.replace("/", "%2F");
  const [downloads, meta] = await Promise.all([
    json(`https://api.npmjs.org/downloads/point/last-week/${name}`),
    json(`https://registry.npmjs.org/${enc}`),
  ]);
  if (!meta) return { name, missing: true };
  const latest = meta["dist-tags"]?.latest;
  const major = latest?.split(".")[0];
  const firstOfMajor = Object.entries(meta.time ?? {})
    .filter(([v]) => v.split(".")[0] === major && /^\d+\.\d+\.\d+$/.test(v))
    .map(([, t]) => t)
    .sort()[0];
  const manifest = meta.versions?.[latest] ?? {};
  return {
    name,
    latest,
    published: meta.time?.[latest],
    firstOfMajor,
    yearsSinceMajor: firstOfMajor ? Math.round(((Date.now() - Date.parse(firstOfMajor)) / (365.25 * 864e5)) * 10) / 10 : null,
    weeklyDownloads: downloads?.downloads ?? null,
    license: manifest.license ?? null,
    ownTypes: Boolean(manifest.types || manifest.typings || manifest.exports?.["."]?.types || JSON.stringify(manifest.exports ?? {}).includes(".d.ts")),
    peerDependencies: manifest.peerDependencies ?? {},
    dependencies: Object.keys(manifest.dependencies ?? {}),
  };
}

const out = { date: new Date().toISOString().slice(0, 10) };
for (const [group, names] of Object.entries(PACKAGES)) {
  out[group] = await Promise.all(names.map(info));
}
for (const [group, list] of Object.entries(out)) {
  if (group === "date") continue;
  console.log(group);
  for (const p of list) {
    if (p.missing) {
      console.log(`  ${p.name}: not found`);
      continue;
    }
    console.log(
      `  ${p.name.padEnd(30)} ${String(p.latest).padEnd(10)} ${String(p.weeklyDownloads).padStart(10)}/week  major since ${p.firstOfMajor?.slice(0, 10)} (${p.yearsSinceMajor} y)  ${p.license}  types:${p.ownTypes ? "own" : "no"}  last ${p.published?.slice(0, 10)}`,
    );
  }
}
const file = join(root, "results", "signals.json");
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`written: ${file}`);
