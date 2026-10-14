// A small static file server for the S1 page. Serves only web/, dist/, and
// downloads/fonts/ from the experiment folder.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf", ".otf": "font/otf" };

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
    if (path === "") path = "web/index.html";
    if (!/^(web|dist|downloads\/fonts)\//.test(path)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(join(root, path));
      res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await serve(Number(process.argv[2] ?? 8123));
  console.log(`http://127.0.0.1:${s.address().port}/`);
}
