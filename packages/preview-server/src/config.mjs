import process from "node:process";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

export function parseServerArgs(argv = process.argv.slice(2)) {
  const portIndex = argv.indexOf("--port");
  return {
    port: portIndex >= 0 ? Number(argv[portIndex + 1]) : 4178,
    quiet: argv.includes("--quiet"),
  };
}

export function createServerConfig(root = process.cwd(), argv = process.argv.slice(2)) {
  return { root, ...parseServerArgs(argv) };
}

export const MIME = {
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

export const RELOAD_SNIPPET = `<script>
(function(){
  var es = new EventSource('/~reload');
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ setTimeout(function(){ location.reload(); }, 2000); };
})();
</script>`;

export async function serveStaticFile(req, res, { root, reloadSnippet = RELOAD_SNIPPET }) {
  const rawPath = (req.url || "/").split("?")[0];
  const requestPath = rawPath === "/" ? "/preview/index.html" : rawPath;
  const safePath = normalize(requestPath).replace(/^\.+/, "");
  const filePath = join(root, safePath);
  const body = await readFile(filePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
  res.end(ext === ".html" ? body.toString("utf-8").replace("</body>", `${reloadSnippet}</body>`) : body);
}
