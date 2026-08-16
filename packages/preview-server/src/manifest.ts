import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function manifestPath(root) {
  return join(root, "manifests", "assets.json");
}

export async function readManifest(root) {
  return JSON.parse(await readFile(manifestPath(root), "utf-8"));
}

export async function writeManifest(root, manifest) {
  await writeFile(manifestPath(root), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function findProject(manifest, name) {
  return manifest.projects.find((item) => item.name === name);
}

export function pruneFavoriteColors(project) {
  const availableColors = new Set([
    ...(project.agentSteer?.sources || []).flatMap((source) =>
      (source.palette || []).map((color) => String(color.hex || "").toUpperCase())
    ),
    ...(project.agentSteer?.customColors || []).map((color) => String(color).toUpperCase()),
  ]);
  project.agentSteer.favoriteColors = (project.agentSteer.favoriteColors || [])
    .map((color) => String(color).toUpperCase())
    .filter((color) => availableColors.has(color));
}
