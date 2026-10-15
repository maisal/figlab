// A small static server for the S3 experiment.
//
// By default it sends headers like GitHub Pages: Cache-Control max-age=600 and
// no COOP or COEP. So the page is not cross-origin isolated.
// With `coi: true` it also sends COOP and COEP, as a control.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

// URL path prefix -> folder under the experiment.
const mounts = [
  ["/wasm/", "target/wasm32-unknown-unknown/release/"],
  ["/", "web/"],
];

export function serve({ port = 0, coi = false } = {}) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const mount = mounts.find(([prefix]) => path.startsWith(prefix));
    let rel = path.slice(mount[0].length) || "index.html";
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, mount[1], rel);
    try {
      const body = await readFile(file);
      const headers = {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "max-age=600",
        "Access-Control-Allow-Origin": "*",
      };
      if (coi) {
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

// `node serve.mjs [--coi]` serves the page for a manual look.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const coi = process.argv.includes("--coi");
  const { url } = await serve({ port: 8083, coi });
  console.log(`serving ${url} (${coi ? "with" : "without"} COOP/COEP)`);
}
