import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const argPort = args.indexOf("--port");
const quiet = args.includes("--quiet");
const port = argPort >= 0 ? Number(args[argPort + 1]) : 4178;
const root = process.cwd();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".md": "text/markdown; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const rawPath = (req.url || "/").split("?")[0];
    const requestPath = rawPath === "/" ? "/preview/index.html" : rawPath;
    const safePath = normalize(requestPath).replace(/^\.+/, "");
    const filePath = join(root, safePath);
    const body = await readFile(filePath);

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  if (!quiet) {
    console.log(`Preview server running at http://localhost:${port}/preview/index.html`);
  }
});
