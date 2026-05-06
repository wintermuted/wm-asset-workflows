import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const port = 4178;
const root = process.cwd();
const outDir = join(root, "outputs/screenshots");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    await page.goto(`http://localhost:${port}/preview/index.html?theme=light`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(outDir, "preview-light.png"), fullPage: true });

    await page.goto(`http://localhost:${port}/preview/index.html?theme=dark`, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(outDir, "preview-dark.png"), fullPage: true });

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
