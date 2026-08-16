import { watch } from "node:fs/promises";
import { join } from "node:path";

export function createReloadSupport({ root, quiet }) {
  const clients = new Set<import("node:http").ServerResponse>();
  let suppressUntil = 0;

  function broadcast() {
    if (Date.now() < suppressUntil) return;
    for (const res of clients) {
      try { res.write("data: reload\n\n"); } catch { /* client already gone */ }
    }
  }

  function suppressFor(milliseconds) {
    suppressUntil = Date.now() + milliseconds;
  }

  function startWatchers() {
    for (const dir of ["preview", "manifests"]) {
      (async () => {
        try {
          const watcher = watch(join(root, dir), { recursive: true });
          for await (const { filename } of watcher) {
            if (!quiet) console.log(`[reload] changed: ${dir}/${filename}`);
            broadcast();
          }
        } catch { /* directory may not exist */ }
      })();
    }
  }

  return {
    clients,
    broadcast,
    suppressFor,
    startWatchers,
    connect(req, res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },
  };
}
