import { spawnSync } from "node:child_process";
import process from "node:process";
import { environmentRegistryArgs } from "./npm-registry.mjs";

const registryArgs = environmentRegistryArgs();
if (registryArgs.length > 0) {
  console.log("[install-deps] using the environment npm registry");
}

const result = spawnSync(
  "npm",
  ["install", "--no-audit", "--no-fund", ...registryArgs, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
