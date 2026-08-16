import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { paths, root } from "./workflow-paths.mjs";

const port = 4178;
const outDir = paths.screenshots;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureTheme(page, theme, outputPath) {
  await page.goto(`http://localhost:${port}/preview/index.html?theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.locator("#logo-groups .logo-group").first().waitFor({ state: "visible" });
  await page.screenshot({ path: outputPath, fullPage: true });
}

async function run() {
  await mkdir(outDir, { recursive: true });

  const server = spawn("node", ["scripts/node/serve-preview.mjs", "--port", String(port), "--quiet"], {
    cwd: root,
    stdio: "ignore"
  });

  try {
    await delay(900);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });

    await captureTheme(page, "light", join(outDir, "preview-light.png"));
    await captureTheme(page, "dark", join(outDir, "preview-dark.png"));

    await browser.close();
    console.log("Wrote screenshots to outputs/screenshots/");
  } finally {
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
