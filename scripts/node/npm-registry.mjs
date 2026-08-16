import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export function environmentRegistryArgs() {
  if (process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY) {
    return [];
  }

  const fallbackConfig = process.env.APPDATA
    ? join(process.env.APPDATA, "npm", "etc", "npmrc")
    : "";
  if (!fallbackConfig || !existsSync(fallbackConfig)) {
    return [];
  }

  const registry = readFileSync(fallbackConfig, "utf8")
    .match(/^\s*registry\s*=\s*(\S+)\s*$/m)?.[1];
  return registry
    ? [`--registry=${registry}`, "--omit-lockfile-registry-resolved=true"]
    : [];
}
