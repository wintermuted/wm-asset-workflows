async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

function applyThemeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const forcedTheme = params.get("theme");
  if (forcedTheme === "dark" || forcedTheme === "light") {
    document.documentElement.setAttribute("data-theme", forcedTheme);
    return;
  }

  const savedTheme = localStorage.getItem("wm-assets-theme");
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  }
}

function wireThemeToggle() {
  const button = document.getElementById("theme-toggle");
  button?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("wm-assets-theme", next);

    if (typeof mermaid !== "undefined") {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: next === "dark" ? "dark" : "default"
      });
      renderDiagrams();
    }
  });
}

let diagramData = [];

function renderLogos(assets) {
  const grid = document.getElementById("logo-grid");
  if (!grid) return;
  grid.innerHTML = "";

  for (const asset of assets) {
    const tile = document.createElement("article");
    tile.className = "tile";

    const frame = document.createElement("div");
    frame.className = "logo-frame";

    const img = document.createElement("img");
    img.src = `../${asset.source}`;
    img.alt = asset.label;

    frame.appendChild(img);
    tile.innerHTML = `<h3>${asset.label}</h3><p>${asset.id}</p>`;
    tile.prepend(frame);
    grid.appendChild(tile);
  }
}

async function renderDiagrams() {
  const grid = document.getElementById("diagram-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme });

  for (const item of diagramData) {
    const tile = document.createElement("article");
    tile.className = "tile";

    const title = document.createElement("h3");
    title.textContent = item.title;

    const wrapper = document.createElement("div");
    wrapper.className = "mermaid";
    wrapper.textContent = item.code;

    tile.appendChild(title);
    tile.appendChild(wrapper);
    grid.appendChild(tile);
  }

  await mermaid.run({ querySelector: ".mermaid" });
}

async function init() {
  applyThemeFromQuery();
  wireThemeToggle();

  const [assetManifest, specs] = await Promise.all([
    loadJson("../manifests/assets.json"),
    loadJson("./spec-index.json")
  ]);

  diagramData = specs.diagrams ?? [];
  renderLogos(assetManifest.assets ?? []);
  await renderDiagrams();
}

init().catch((error) => {
  console.error(error);
  const layout = document.querySelector(".layout");
  if (layout) {
    layout.innerHTML = `<section class="panel"><h2>Preview failed</h2><p>${error.message}</p></section>`;
  }
});
