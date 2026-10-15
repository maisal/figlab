// Install the npm packages of every app and template from their lock files.
// Use: node harness/install-apps.mjs

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const group of ["apps", "templates"]) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name);
    console.log(`${group}/${name}`);
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "inherit" });
  }
}
