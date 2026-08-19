import { writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { readManifest } from "./manifest.js";

const MAX_SVG_BYTES = 2 * 1024 * 1024;

export async function saveAssetSvg(root, assetId, svg) {
  if (!assetId) throw new Error("Asset id is required");
  if (!svg || Buffer.byteLength(svg, "utf-8") > MAX_SVG_BYTES || !/<svg(?:\s|>)/i.test(svg)) {
    throw new Error("A valid SVG document under 2 MB is required");
  }

  const manifest = await readManifest(root);
  const asset = (manifest.assets || []).find((item) => item.id === assetId);
  if (!asset) throw new Error(`Asset "${assetId}" is not registered`);

  const source = String(asset.source || "").replaceAll("\\", "/");
  const sourceSegments = source.split("/");
  if (
    isAbsolute(source)
    || sourceSegments.includes("..")
    || sourceSegments.includes(".")
    || sourceSegments[0] !== "assets"
    || sourceSegments[1] !== "svg"
    || !source.toLowerCase().endsWith(".svg")
  ) {
    throw new Error("Asset source must be an SVG under assets/svg");
  }

  const targetPath = resolve(root, ...sourceSegments);
  const relativeTarget = relative(resolve(root, "assets", "svg"), targetPath);
  if (!relativeTarget || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error("Asset source resolves outside assets/svg");
  }

  await writeFile(targetPath, svg.endsWith("\n") ? svg : `${svg}\n`, "utf-8");
  return { source };
}
