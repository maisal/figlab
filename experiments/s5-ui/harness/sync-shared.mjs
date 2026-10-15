// Copy the framework-neutral files from shared/ into every app and template,
// so that they stay the same everywhere (APP-SPEC.md 1).
// Use: node harness/sync-shared.mjs

import { copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMON = ["types.ts", "draw.ts", "extensions.ts", "table.ts", "styles.css"];

for (const group of ["apps", "templates"]) {
  for (const name of readdirSync(join(root, group))) {
    // The CodeMirror-only baseline has only the editor extensions.
    let files = name === "cm-only" ? ["extensions.ts"] : COMMON;
    // The reference apps also share the editor bridge. Trial agents write their own.
    if (group === "apps" && name !== "cm-only") files = [...files, "editor.ts"];
    for (const file of files) copyFileSync(join(root, "shared", file), join(root, group, name, "src", file));
  }
}
console.log("shared files copied");
