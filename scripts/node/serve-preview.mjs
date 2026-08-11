import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { access, readFile, watch, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const args = process.argv.slice(2);
const argPort = args.indexOf("--port");
const quiet = args.includes("--quiet");
const port = argPort >= 0 ? Number(args[argPort + 1]) : 4178;
const root = process.cwd();
const execFileAsync = promisify(execFile);

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

// SSE clients waiting for a reload signal
const reloadClients = new Set();
let suppressReloadUntil = 0;

function broadcastReload() {
  if (Date.now() < suppressReloadUntil) return;
  for (const res of reloadClients) {
    try { res.write("data: reload\n\n"); } catch { /* client already gone */ }
  }
}

// Watch the preview/ and manifests/ directories for changes
const WATCH_DIRS = ["preview", "manifests"];
for (const dir of WATCH_DIRS) {
  (async () => {
    try {
      const watcher = watch(join(root, dir), { recursive: true });
      for await (const { filename } of watcher) {
        if (!quiet) console.log(`[reload] changed: ${dir}/${filename}`);
        broadcastReload();
      }
    } catch { /* directory may not exist */ }
  })();
}

// Snippet injected into HTML responses to auto-reload on server signal
const RELOAD_SNIPPET = `<script>
(function(){
  var es = new EventSource('/~reload');
  es.onmessage = function(){ location.reload(); };
  es.onerror = function(){ setTimeout(function(){ location.reload(); }, 2000); };
})();
</script>`;

function projectReadme(name, slug) {
  return `# ${name}\n\n## Authoring\n\nUse the \`/create-svg-asset\` Copilot Chat prompt with:\n\n\`\`\`text\nProject: ${name}\nDirectory: assets/svg/${slug}/\n\`\`\`\n\nAdd reference images to \`assets/svg/${slug}/grounding/\`. Register finished SVGs in \`manifests/assets.json\`.\n\n## References\n\n- [Create SVG Asset prompt](../../../.github/prompts/create-svg-asset.prompt.md)\n- [Manifest specification](../../../.github/skills/wm-asset-manifest-spec/SKILL.md)\n- [Authoring workflow](../../../.github/skills/wm-asset-authoring-workflow/SKILL.md)\n`;
}

function projectSamplePrompts(name, slug) {
  return [
    `/create-svg-asset\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`,
    `/create-svg-asset\n\nCreate a minimal geometric mark using the uploaded steering source material.\nBase idea: combine a strong silhouette with one distinctive cutout or negative-space detail.\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`,
    `/create-svg-asset\n\nCreate an expressive symbol using the uploaded steering source material.\nBase idea: translate the project's core purpose into a modular emblem that remains recognizable at favicon size.\n\nProject: ${name}\nDirectory: assets/svg/${slug}/`
  ];
}

function slugifyProjectName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeProjectPrompt(prompt, projectName, projectSlug) {
  const fields = `Project: ${projectName}\nDirectory: assets/svg/${projectSlug}/`;
  const content = String(prompt)
    .replace(/^Project:.*(?:\r?\n)?/gm, "")
    .replace(/^Directory:.*(?:\r?\n)?/gm, "")
    .trimEnd();
  return content ? `${content}\n\n${fields}` : fields;
}

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body);
}

async function uniqueGroundingPath(slug, filename, sources) {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length) || "image";
  let sequence = 1;

  while (true) {
    const candidate = sequence === 1 ? filename : `${stem}-${sequence}${extension}`;
    const relativePath = `assets/svg/${slug}/grounding/${candidate}`;
    const registered = sources.some((source) => source.src === relativePath);
    let exists = false;
    try {
      await access(join(root, relativePath));
      exists = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (!registered && !exists) return { filename: candidate, relativePath };
    sequence += 1;
  }
}

async function analyzeImagePalette(imagePath) {
  const scriptPath = join(root, "scripts", "python", "analyze_palette.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, imagePath, "--colors", "10"], {
    maxBuffer: 1024 * 1024,
  });
  const palette = JSON.parse(stdout);
  if (!Array.isArray(palette)) throw new Error("Palette analyzer returned an invalid result");
  return palette.filter((color) => /^#[0-9A-F]{6}$/.test(color.hex) && Number.isFinite(color.percentage)).slice(0, 10);
}

function pruneFavoriteColors(project) {
  const availableColors = new Set(
    [
      ...(project.agentSteer?.sources || []).flatMap((source) =>
        (source.palette || []).map((color) => String(color.hex || "").toUpperCase())
      ),
      ...(project.agentSteer?.customColors || []).map((color) => String(color).toUpperCase()),
    ]
  );
  project.agentSteer.favoriteColors = (project.agentSteer.favoriteColors || [])
    .map((color) => String(color).toUpperCase())
    .filter((color) => availableColors.has(color));
}

const server = createServer(async (req, res) => {
  // SSE live-reload endpoint
  if (req.url === "/~reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(": connected\n\n");
    reloadClients.add(res);
    req.on("close", () => reloadClients.delete(res));
    return;
  }

  // Scaffold a new project
  if (req.method === "POST" && req.url === "/~scaffold") {
    let payload;
    try { payload = await readRequestJson(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const name = String(payload.name || "").trim();
    const slug = String(payload.slug || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!name || !slug) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "name and slug are required" }));
      return;
    }

    const svgDir = join(root, "assets", "svg", slug);
    const groundingDir = join(svgDir, "grounding");
    const manifestPath = join(root, "manifests", "assets.json");

    try {
      await mkdir(groundingDir, { recursive: true });
      await writeFile(join(svgDir, "README.md"), projectReadme(name, slug), { flag: "wx" }).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });

      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      let project = manifest.projects.find((item) => item.name === name || item.slug === slug);
      const alreadyExists = Boolean(project);
      if (!alreadyExists) {
        project = {
          name,
          slug,
          primaryAssetId: "",
          samplePrompts: projectSamplePrompts(name, slug),
          documentation: `assets/svg/${slug}/README.md`,
          iconSlots: {
            favicon: { title: "Favicon", assetId: "", note: "" },
            appIcon: { title: "Web App Icon", assetId: "", note: "" },
            logoMark: { title: "Logo Mark", assetId: "", note: "" },
            wordmark: { title: "Wordmark", assetId: "", note: "" },
            socialPreview: { title: "Social Preview", assetId: "", note: "" }
          },
          agentSteer: { notes: [], sources: [] }
        };
        manifest.projects.push(project);
      }

      project.slug ||= slug;
      project.documentation ||= `assets/svg/${slug}/README.md`;
      project.samplePrompts ||= projectSamplePrompts(name, slug);
      project.agentSteer ||= { notes: [], sources: [] };
      suppressReloadUntil = Date.now() + 1000;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        name,
        slug,
        svgDir: `assets/svg/${slug}/`,
        groundingDir: `assets/svg/${slug}/grounding/`,
        documentation: `assets/svg/${slug}/README.md`,
        alreadyExists
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/~grounding-image") {
    let payload;
    try { payload = await readRequestJson(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const projectName = String(payload.project || "").trim();
    const rawFilename = String(payload.filename || "").trim();
    const filename = rawFilename.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const match = String(payload.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    if (!projectName || !filename || !match) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project and a PNG, JPEG, WebP, or GIF image are required" }));
      return;
    }

    try {
      const manifestPath = join(root, "manifests", "assets.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      const project = manifest.projects.find((item) => item.name === projectName);
      if (!project) throw new Error(`Unknown project: ${projectName}`);

      const slug = String(project.slug || projectName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      project.slug ||= slug;
      project.agentSteer ||= { notes: [], sources: [] };
      project.agentSteer.sources ||= [];
      const upload = await uniqueGroundingPath(slug, filename, project.agentSteer.sources);
      await mkdir(join(root, "assets", "svg", slug, "grounding"), { recursive: true });
      const uploadedPath = join(root, upload.relativePath);
      await writeFile(uploadedPath, Buffer.from(match[2], "base64"), { flag: "wx" });

      let palette;
      try {
        palette = await analyzeImagePalette(uploadedPath);
      } catch (error) {
        await unlink(uploadedPath).catch(() => {});
        throw new Error(`Could not analyze image colors: ${error.message}`);
      }

      project.agentSteer.sources.push({
        kind: "image",
        title: upload.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
        src: upload.relativePath,
        alt: `${projectName} grounding reference`,
        palette,
      });
      suppressReloadUntil = Date.now() + 2000;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: upload.relativePath }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/~project-color") {
    let payload;
    try { payload = await readRequestJson(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const projectName = String(payload.project || "").trim();
    const color = String(payload.color || "").trim().toUpperCase();
    const selected = payload.selected === true;
    const custom = payload.custom === true;

    try {
      if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error("A valid palette color is required");
      const manifestPath = join(root, "manifests", "assets.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      const project = manifest.projects.find((item) => item.name === projectName);
      if (!project) throw new Error(`Unknown project: ${projectName}`);
      project.agentSteer ||= { notes: [], sources: [] };
      const availableColors = new Set(
        [
          ...(project.agentSteer.sources || []).flatMap((source) =>
            (source.palette || []).map((entry) => String(entry.hex || "").toUpperCase())
          ),
          ...(project.agentSteer.customColors || []).map((entry) => String(entry).toUpperCase()),
        ]
      );
      if (custom) {
        const customColors = new Set((project.agentSteer.customColors || []).map((entry) => String(entry).toUpperCase()));
        if (selected) customColors.add(color);
        else customColors.delete(color);
        project.agentSteer.customColors = [...customColors];
        if (selected) availableColors.add(color);
      }
      if (!availableColors.has(color)) throw new Error("Color is not available to this project");

      const favorites = new Set((project.agentSteer.favoriteColors || []).map((entry) => String(entry).toUpperCase()));
      if (selected) favorites.add(color);
      else favorites.delete(color);
      project.agentSteer.favoriteColors = [...favorites];

      suppressReloadUntil = Date.now() + 1000;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        favoriteColors: project.agentSteer.favoriteColors,
        customColors: project.agentSteer.customColors || [],
      }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/~project") {
    let payload;
    try { payload = await readRequestJson(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const currentName = String(payload.project || "").trim();
    const nextName = String(payload.name || "").trim();
    if (!currentName || !nextName || nextName.length > 100) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "A project name between 1 and 100 characters is required" }));
      return;
    }

    try {
      const manifestPath = join(root, "manifests", "assets.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      const project = manifest.projects.find((item) => item.name === currentName);
      if (!project) throw new Error(`Unknown project: ${currentName}`);
      if (manifest.projects.some((item) => item !== project && item.name.toLowerCase() === nextName.toLowerCase())) {
        throw new Error(`A project named ${nextName} already exists`);
      }

      const currentSlug = String(project.slug || slugifyProjectName(currentName));
      const nextSlug = slugifyProjectName(nextName);
      const currentPrefix = `assets/svg/${currentSlug}/`;
      const nextPrefix = `assets/svg/${nextSlug}/`;
      const rewriteProjectPath = (value) => {
        const path = String(value || "");
        return path.startsWith(currentPrefix) ? `${nextPrefix}${path.slice(currentPrefix.length)}` : path;
      };

      if (currentSlug !== nextSlug) {
        try {
          await access(join(root, nextPrefix));
          throw new Error(`Project directory already exists: ${nextPrefix}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        try {
          await rename(join(root, currentPrefix), join(root, nextPrefix));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }

      project.name = nextName;
      project.slug = nextSlug;
      project.documentation = rewriteProjectPath(project.documentation || `${currentPrefix}README.md`);
      project.samplePrompts = (project.samplePrompts || projectSamplePrompts(nextName, nextSlug)).map((prompt) =>
        normalizeProjectPrompt(prompt, nextName, nextSlug)
      );
      for (const source of project.agentSteer?.sources || []) {
        if (source.src) source.src = rewriteProjectPath(source.src);
        if (source.path) source.path = rewriteProjectPath(source.path);
        if (source.alt === `${currentName} grounding reference`) source.alt = `${nextName} grounding reference`;
      }
      for (const asset of manifest.assets || []) {
        const belongsToProject = asset.project === currentName || String(asset.source || "").startsWith(currentPrefix);
        if (belongsToProject) {
          asset.project = nextName;
          asset.source = rewriteProjectPath(asset.source);
        }
      }

      try {
        const readmePath = join(root, project.documentation);
        const readme = await readFile(readmePath, "utf-8");
        await writeFile(
          readmePath,
          readme
            .replace(/^# .*$/m, `# ${nextName}`)
            .replace(/^Project:.*$/gm, `Project: ${nextName}`)
            .split(currentPrefix).join(nextPrefix),
          "utf-8"
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      suppressReloadUntil = Date.now() + 1500;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: nextName }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (req.method === "POST" && req.url === "/~grounding-source") {
    let payload;
    try { payload = await readRequestJson(req); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const projectName = String(payload.project || "").trim();
    const sourcePath = String(payload.source || "").trim();
    const action = String(payload.action || "").trim();

    try {
      const manifestPath = join(root, "manifests", "assets.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      const project = manifest.projects.find((item) => item.name === projectName);
      if (!project) throw new Error(`Unknown project: ${projectName}`);

      const slug = String(project.slug || projectName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const groundingPrefix = `assets/svg/${slug}/grounding/`;
      const sources = project.agentSteer?.sources || [];
      const sourceIndex = sources.findIndex((source) => source.kind === "image" && source.src === sourcePath);
      if (sourceIndex < 0 || !sourcePath.startsWith(groundingPrefix) || basename(sourcePath) !== sourcePath.slice(groundingPrefix.length)) {
        throw new Error("Unknown grounding image");
      }

      if (action === "delete") {
        await unlink(join(root, sourcePath));
        sources.splice(sourceIndex, 1);
        pruneFavoriteColors(project);
      } else if (action === "rename") {
        const currentExtension = extname(sourcePath);
        const requestedName = String(payload.filename || "").trim();
        const requestedStem = requestedName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
        if (!requestedStem) throw new Error("A valid image name is required");
        const next = await uniqueGroundingPath(slug, `${requestedStem}${currentExtension}`, sources.filter((_, index) => index !== sourceIndex));
        await rename(join(root, sourcePath), join(root, next.relativePath));
        sources[sourceIndex].src = next.relativePath;
        sources[sourceIndex].title = next.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      } else {
        throw new Error("Unsupported grounding image action");
      }

      suppressReloadUntil = Date.now() + 1000;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  try {
    const rawPath = (req.url || "/").split("?")[0];
    const requestPath = rawPath === "/" ? "/preview/index.html" : rawPath;
    const safePath = normalize(requestPath).replace(/^\.+/, "");
    const filePath = join(root, safePath);
    const body = await readFile(filePath);

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });

    if (ext === ".html") {
      res.end(body.toString("utf-8").replace("</body>", `${RELOAD_SNIPPET}</body>`));
    } else {
      res.end(body);
    }
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
