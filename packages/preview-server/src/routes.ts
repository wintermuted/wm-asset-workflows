import { scaffoldProject, renameProject } from "./scaffolding.js";
import { uploadGroundingImage, updateProjectColor, updateGroundingSource } from "./grounding.js";
import { serveStaticFile } from "./config.js";

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createRequestHandler({ root, reload }) {
  return async (req, res) => {
    if (req.url === "/~reload") { reload.connect(req, res); return; }
    if (req.method === "POST" && req.url === "/~scaffold") {
      let payload;
      try { payload = await readRequestJson(req); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      const name = String(payload.name || "").trim();
      const slug = String(payload.slug || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!name || !slug) { json(res, 400, { error: "name and slug are required" }); return; }
      try {
        const result = await scaffoldProject(root, name, slug);
        reload.suppressFor(1000);
        json(res, 200, { ok: true, ...result, svgDir: `assets/svg/${slug}/`, groundingDir: `assets/svg/${slug}/grounding/`, documentation: `assets/svg/${slug}/README.md` });
      } catch (error) { json(res, 500, { error: error.message }); }
      return;
    }
    if (req.method === "POST" && req.url === "/~grounding-image") {
      let payload;
      try { payload = await readRequestJson(req); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      const projectName = String(payload.project || "").trim();
      const rawFilename = String(payload.filename || "").trim();
      const filename = rawFilename.replace(/[^a-zA-Z0-9._-]+/g, "-");
      if (!projectName || !filename || !/^data:(image\/(?:png|jpeg|webp|gif));base64,/.test(String(payload.dataUrl || ""))) {
        json(res, 400, { error: "Project and a PNG, JPEG, WebP, or GIF image are required" }); return;
      }
      try { const result = await uploadGroundingImage(root, projectName, filename, payload.dataUrl); reload.suppressFor(2000); json(res, 200, { ok: true, ...result }); }
      catch (error) { json(res, 500, { error: error.message }); }
      return;
    }
    if (req.method === "POST" && req.url === "/~project-color") {
      let payload;
      try { payload = await readRequestJson(req); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      try {
        const result = await updateProjectColor(root, String(payload.project || "").trim(), String(payload.color || "").trim().toUpperCase(), payload.selected === true, payload.custom === true);
        reload.suppressFor(1000); json(res, 200, { ok: true, ...result });
      } catch (error) { json(res, 400, { error: error.message }); }
      return;
    }
    if (req.method === "POST" && req.url === "/~project") {
      let payload;
      try { payload = await readRequestJson(req); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      const currentName = String(payload.project || "").trim();
      const nextName = String(payload.name || "").trim();
      if (!currentName || !nextName || nextName.length > 100) { json(res, 400, { error: "A project name between 1 and 100 characters is required" }); return; }
      try { const result = await renameProject(root, currentName, nextName); reload.suppressFor(1500); json(res, 200, { ok: true, ...result }); }
      catch (error) { json(res, 400, { error: error.message }); }
      return;
    }
    if (req.method === "POST" && req.url === "/~grounding-source") {
      let payload;
      try { payload = await readRequestJson(req); } catch { json(res, 400, { error: "Invalid JSON" }); return; }
      try {
        await updateGroundingSource(root, String(payload.project || "").trim(), String(payload.source || "").trim(), String(payload.action || "").trim(), payload.filename);
        reload.suppressFor(1000); json(res, 200, { ok: true });
      } catch (error) { json(res, 400, { error: error.message }); }
      return;
    }
    try { await serveStaticFile(req, res, { root }); }
    catch { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); }
  };
}
