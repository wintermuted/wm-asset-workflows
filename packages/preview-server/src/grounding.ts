import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { readManifest, writeManifest, pruneFavoriteColors } from "./manifest.js";

const execFileAsync = promisify(execFile);

export async function uniqueGroundingPath(root, slug, filename, sources) {
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length) || "image";
  let sequence = 1;
  while (true) {
    const candidate = sequence === 1 ? filename : `${stem}-${sequence}${extension}`;
    const relativePath = `assets/svg/${slug}/grounding/${candidate}`;
    const registered = sources.some((source) => source.src === relativePath);
    let exists = false;
    try { await access(join(root, relativePath)); exists = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!registered && !exists) return { filename: candidate, relativePath };
    sequence += 1;
  }
}

export async function analyzeImagePalette(root, imagePath) {
  const scriptPath = join(root, "packages", "image-generation", "src", "analyze_palette.py");
  const { stdout } = await execFileAsync("python3", [scriptPath, imagePath, "--colors", "10"], { maxBuffer: 1024 * 1024 });
  const palette = JSON.parse(stdout);
  if (!Array.isArray(palette)) throw new Error("Palette analyzer returned an invalid result");
  return palette.filter((color) => /^#[0-9A-F]{6}$/.test(color.hex) && Number.isFinite(color.percentage)).slice(0, 10);
}

export async function uploadGroundingImage(root, projectName, filename, dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!match) throw new Error("Project and a PNG, JPEG, WebP, or GIF image are required");
  const manifest = await readManifest(root);
  const project = manifest.projects.find((item) => item.name === projectName);
  if (!project) throw new Error(`Unknown project: ${projectName}`);
  const slug = String(project.slug || projectName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  project.slug ||= slug;
  project.agentSteer ||= { notes: [], sources: [] };
  project.agentSteer.sources ||= [];
  const upload = await uniqueGroundingPath(root, slug, filename, project.agentSteer.sources);
  await mkdir(join(root, "assets", "svg", slug, "grounding"), { recursive: true });
  const uploadedPath = join(root, upload.relativePath);
  await writeFile(uploadedPath, Buffer.from(match[2], "base64"), { flag: "wx" });
  let palette;
  try { palette = await analyzeImagePalette(root, uploadedPath); }
  catch (error) { await unlink(uploadedPath).catch(() => {}); throw new Error(`Could not analyze image colors: ${error.message}`); }
  project.agentSteer.sources.push({
    kind: "image",
    title: upload.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
    src: upload.relativePath,
    alt: `${projectName} grounding reference`,
    palette,
  });
  await writeManifest(root, manifest);
  return { path: upload.relativePath };
}

export async function updateProjectColor(root, projectName, color, selected, custom) {
  if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error("A valid palette color is required");
  const manifest = await readManifest(root);
  const project = manifest.projects.find((item) => item.name === projectName);
  if (!project) throw new Error(`Unknown project: ${projectName}`);
  project.agentSteer ||= { notes: [], sources: [] };
  const availableColors = new Set([
    ...(project.agentSteer.sources || []).flatMap((source) => (source.palette || []).map((entry) => String(entry.hex || "").toUpperCase())),
    ...(project.agentSteer.customColors || []).map((entry) => String(entry).toUpperCase()),
  ]);
  if (custom) {
    const customColors = new Set((project.agentSteer.customColors || []).map((entry) => String(entry).toUpperCase()));
    if (selected) customColors.add(color); else customColors.delete(color);
    project.agentSteer.customColors = [...customColors];
    if (selected) availableColors.add(color);
  }
  if (!availableColors.has(color)) throw new Error("Color is not available to this project");
  const favorites = new Set((project.agentSteer.favoriteColors || []).map((entry) => String(entry).toUpperCase()));
  if (selected) favorites.add(color); else favorites.delete(color);
  project.agentSteer.favoriteColors = [...favorites];
  await writeManifest(root, manifest);
  return { favoriteColors: project.agentSteer.favoriteColors, customColors: project.agentSteer.customColors || [] };
}

export async function updateGroundingSource(root, projectName, sourcePath, action, requestedName) {
  const manifest = await readManifest(root);
  const project = manifest.projects.find((item) => item.name === projectName);
  if (!project) throw new Error(`Unknown project: ${projectName}`);
  const slug = String(project.slug || projectName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const groundingPrefix = `assets/svg/${slug}/grounding/`;
  const sources = project.agentSteer?.sources || [];
  const sourceIndex = sources.findIndex((source) => source.kind === "image" && source.src === sourcePath);
  if (sourceIndex < 0 || !sourcePath.startsWith(groundingPrefix) || basename(sourcePath) !== sourcePath.slice(groundingPrefix.length)) throw new Error("Unknown grounding image");
  if (action === "delete") {
    await unlink(join(root, sourcePath));
    sources.splice(sourceIndex, 1);
    pruneFavoriteColors(project);
  } else if (action === "rename") {
    const currentExtension = extname(sourcePath);
    const requestedStem = String(requestedName || "").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!requestedStem) throw new Error("A valid image name is required");
    const next = await uniqueGroundingPath(root, slug, `${requestedStem}${currentExtension}`, sources.filter((_, index) => index !== sourceIndex));
    await rename(join(root, sourcePath), join(root, next.relativePath));
    sources[sourceIndex].src = next.relativePath;
    sources[sourceIndex].title = next.filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  } else throw new Error("Unsupported grounding image action");
  await writeManifest(root, manifest);
}
