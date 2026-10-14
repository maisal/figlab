// A static file server for a built app (dist/). Serves gzip when the browser
// accepts it, like GitHub Pages. HTML is "no-cache"; hashed assets are cached
// for a long time, so a warm load takes them from the browser cache.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

/** Start a server for `dir`. Resolves to { url, close }. */
export function serve(dir) {
  const cache = new Map();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = normalize(join(dir, path));
    if (!file.startsWith(normalize(dir))) {
      res.writeHead(403).end();
      return;
    }
    if (path === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    let entry = cache.get(file);
    if (!entry) {
      const raw = readFileSync(file);
      entry = { raw, gz: gzipSync(raw, { level: 9 }) };
      cache.set(file, entry);
    }
    const headers = {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      Vary: "Accept-Encoding",
    };
    const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    if (gzip) headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers).end(gzip ? entry.gz : entry.raw);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
