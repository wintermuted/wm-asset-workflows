import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { environmentRegistryArgs } from "./npm-registry.mjs";

const root = process.cwd();

// The preview page loads @wintermuted/ui-theme straight from node_modules,
// so a missing install shows up as an unthemed page rather than an obvious error.
const REQUIRED_PATHS = [
  "node_modules",
  join("node_modules", ".bin", process.platform === "win32" ? "nx.cmd" : "nx"),
  join("node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild"),
  join("node_modules", "@wintermuted", "ui-theme", "index.css")
];

const missing = REQUIRED_PATHS.filter((p) => !existsSync(join(root, p)));
if (missing.length === 0) process.exit(0);

console.log(`[ensure-deps] missing ${missing.join(", ")} — running npm install`);

const result = spawnSync("npm", [
  "install",
  "--no-audit",
  "--no-fund",
  ...environmentRegistryArgs()
], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
});

if (result.status !== 0) {
  console.error("[ensure-deps] npm install failed; preview styling will be broken.");
  process.exit(result.status ?? 1);
}

const stillMissing = REQUIRED_PATHS.filter((p) => !existsSync(join(root, p)));
if (stillMissing.length > 0) {
  console.error(`[ensure-deps] still missing after install: ${stillMissing.join(", ")}`);
  process.exit(1);
}
