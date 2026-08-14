import { join } from "node:path";
import process from "node:process";

export const root = process.cwd();
export const paths = {
  specs: join(root, "specs"),
  preview: join(root, "preview"),
  specIndex: join(root, "preview", "spec-index.json"),
  manifests: join(root, "manifests"),
  assetManifest: join(root, "manifests", "assets.json"),
  screenshots: join(root, "outputs", "screenshots"),
  png: join(root, "outputs", "png")
};
