import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const scriptPath = join(
  process.cwd(),
  "packages",
  "image-generation",
  "src",
  "generate_images.py",
);
const result = spawnSync("python3", [scriptPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
