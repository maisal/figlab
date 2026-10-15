// A static server for dist/ that sends GitHub Pages-like headers:
// Cache-Control: max-age=600, a weak ETag, Last-Modified, gzip for text,
// wasm, and fonts, and no COOP/COEP headers.
//
// Usage: node scripts/serve.mjs [port]   (default 4610)

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const COMPRESS = new Set([".html", ".js", ".css", ".json", ".wasm", ".ttf", ".svg"]);

const cache = new Map();
function load(path) {
  const st = statSync(path);
  const key = `${path}:${st.mtimeMs}:${st.size}`;
  let e = cache.get(key);
  if (!e) {
    const body = readFileSync(path);
    const etag = `W/"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
    const gz = COMPRESS.has(extname(path)) ? gzipSync(body, { level: 9 }) : null;
    e = { body, gz, etag, mtime: st.mtime.toUTCString() };
    cache.set(key, e);
  }
  return e;
}

export function startServer(port = 4610) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const path = normalize(join(root, p));
    if (!path.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    let e;
    try {
      e = load(path);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const headers = {
      "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "max-age=600",
      ETag: e.etag,
      "Last-Modified": e.mtime,
      Vary: "Accept-Encoding",
    };
    if (req.headers["if-none-match"] === e.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    const gzip = e.gz && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    if (gzip) headers["Content-Encoding"] = "gzip";
    const body = gzip ? e.gz : e.body;
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4610);
  await startServer(port);
  console.log(`serving dist/ on http://127.0.0.1:${port}/`);
}
