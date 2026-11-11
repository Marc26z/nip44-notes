import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dist");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(arg("--port", "4173"));
const host = arg("--host", "127.0.0.1");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    let file = path.resolve(root, "." + pathname);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    let data;
    try {
      data = await readFile(file);
    } catch {
      if (!path.extname(pathname)) {
        file = path.join(root, "index.html");
        data = await readFile(file);
      } else {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
    }

    response.writeHead(200, {
      "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "service-worker-allowed": "/",
      "x-content-type-options": "nosniff",
    });
    response.end(data);
  } catch (error) {
    response.writeHead(500);
    response.end(`Server error: ${error?.message || error}`);
  }
});

server.listen(port, host, () => {
  console.log(`Serving dist at http://${host}:${port}`);
});
