async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

function getRouteFromHash() {
  const hash = window.location.hash || "#logos";
  const token = hash.replace(/^#/, "");

  if (token.startsWith("asset/")) {
    const encodedId = token.slice("asset/".length).trim();
    let id = encodedId;
    try {
      id = decodeURIComponent(encodedId);
    } catch (_error) {
      id = encodedId;
    }
    return { tab: "logos", page: "asset", assetId: id };
  }

  if (token === "diagrams") {
    return { tab: "diagrams", page: "collection" };
  }

  return { tab: "logos", page: "collection" };
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
  const syncToggleIcon = () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const dark = current === "dark";
    const iconName = dark ? "sun" : "moon";
    const label = dark ? "Light" : "Dark";
    button.innerHTML = `<i data-lucide="${iconName}" aria-hidden="true"></i><span>${label}</span>`;
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    if (typeof lucide !== "undefined") lucide.createIcons();
  };

  syncToggleIcon();

  button?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("wm-assets-theme", next);
    syncToggleIcon();

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

function wireTopNav() {
  const tabs = Array.from(document.querySelectorAll("[data-preview-tab]"));
  if (!tabs.length) return;

  const setActive = () => {
    const route = getRouteFromHash();

    tabs.forEach((tab) => {
      const isActive = tab.getAttribute("data-preview-tab") === route.tab;
      tab.classList.toggle("is-active", isActive);
      if (isActive) {
        tab.setAttribute("aria-current", "page");
      } else {
        tab.removeAttribute("aria-current");
      }
    });
  };

  if (!window.location.hash) {
    window.location.hash = "#logos";
  }

  window.addEventListener("hashchange", setActive);
  setActive();
}

let diagramData = [];
let assetData = [];
let assetById = new Map();
let activeGroupingMode = "project";

const GROUPING_MODES = [
  { id: "project", label: "Project" },
  { id: "type", label: "Type" },
  { id: "custom", label: "Custom" }
];

function logoTypeForAsset(asset) {
  const raw = String(asset.logoType ?? "").trim();
  return raw || "Uncategorized Type";
}

function projectForAsset(asset) {
  const raw = String(asset.project ?? "").trim();
  return raw || "Unassigned Project";
}

function slugifyGroupName(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ungrouped";
}

function groupsForAsset(asset) {
  const multiGroups = Array.isArray(asset.groups) ? asset.groups : [];
  const singleGroup = asset.group ? [asset.group] : [];
  const rawGroups = [...multiGroups, ...singleGroup];
  const cleanedGroups = rawGroups
    .map((group) => String(group).trim())
    .filter((group) => group.length > 0);

  if (!cleanedGroups.length) {
    return ["Ungrouped"];
  }

  return Array.from(new Set(cleanedGroups));
}

function buildGroupedAssets(assets) {
  if (activeGroupingMode === "project") {
    const byProject = new Map();
    for (const asset of assets) {
      const project = projectForAsset(asset);
      if (!byProject.has(project)) {
        byProject.set(project, []);
      }
      byProject.get(project).push(asset);
    }

    return Array.from(byProject.entries())
      .map(([project, grouped]) => [project, grouped.sort((a, b) => a.label.localeCompare(b.label))])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  if (activeGroupingMode === "type") {
    const byType = new Map();
    for (const asset of assets) {
      const type = logoTypeForAsset(asset);
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type).push(asset);
    }

    return Array.from(byType.entries())
      .map(([type, grouped]) => [type, grouped.sort((a, b) => a.label.localeCompare(b.label))])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  const groupMap = new Map();

  for (const asset of assets) {
    for (const groupName of groupsForAsset(asset)) {
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      groupMap.get(groupName).push(asset);
    }
  }

  return Array.from(groupMap.entries())
    .map(([groupName, groupAssets]) => [
      groupName,
      groupAssets.sort((a, b) => a.label.localeCompare(b.label))
    ])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function syncGroupingControlState() {
  const controls = Array.from(document.querySelectorAll("[data-grouping-mode]"));
  controls.forEach((button) => {
    const mode = button.getAttribute("data-grouping-mode");
    const isActive = mode === activeGroupingMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function groupingLabelForCurrentMode() {
  const mode = GROUPING_MODES.find((item) => item.id === activeGroupingMode);
  return mode ? mode.label : "Project";
}

function wireGroupingControls() {
  const controls = Array.from(document.querySelectorAll("[data-grouping-mode]"));
  if (!controls.length) return;

  const savedMode = localStorage.getItem("wm-assets-grouping-mode");
  if (savedMode && GROUPING_MODES.some((mode) => mode.id === savedMode)) {
    activeGroupingMode = savedMode;
  }

  controls.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-grouping-mode");
      if (!mode || mode === activeGroupingMode) return;
      activeGroupingMode = mode;
      localStorage.setItem("wm-assets-grouping-mode", mode);
      syncGroupingControlState();
      renderLogos(assetData);
    });
  });

  syncGroupingControlState();
}

function uniqueSortedSizes(asset) {
  const variantSizes = (asset.variants ?? []).map((variant) => Number(variant.size)).filter((value) => Number.isFinite(value));
  const sizes = variantSizes.length ? variantSizes : [32, 64, 128, 256];
  return Array.from(new Set(sizes)).sort((a, b) => a - b);
}

function setMainViewVisibility(route) {
  const logosSection = document.getElementById("logos");
  const diagramsSection = document.getElementById("diagrams");
  const detailSection = document.getElementById("asset-detail");
  if (!logosSection || !diagramsSection || !detailSection) return;

  const onAssetPage = route.page === "asset";
  logosSection.classList.toggle("is-hidden", onAssetPage);
  diagramsSection.classList.toggle("is-hidden", onAssetPage);
  detailSection.classList.toggle("is-hidden", !onAssetPage);
}

function renderLogos(assets) {
  const index = document.getElementById("logo-group-index");
  const groupsRoot = document.getElementById("logo-groups");
  const label = document.getElementById("grouping-label");
  if (!index || !groupsRoot || !label) return;

  index.innerHTML = "";
  groupsRoot.innerHTML = "";
  label.textContent = groupingLabelForCurrentMode();

  const groupedAssets = buildGroupedAssets(assets);

  for (const [groupName, groupAssets] of groupedAssets) {
    const groupId = `group-${activeGroupingMode}-${slugifyGroupName(groupName)}`;

    const jumpLink = document.createElement("a");
    jumpLink.className = "group-jump-link";
    jumpLink.href = `#${groupId}`;
    jumpLink.textContent = `${groupName} (${groupAssets.length})`;
    index.appendChild(jumpLink);

    const groupSection = document.createElement("section");
    groupSection.className = "logo-group";
    groupSection.id = groupId;

    const header = document.createElement("div");
    header.className = "logo-group-header";

    const heading = document.createElement("h4");
    heading.textContent = groupName;

    const count = document.createElement("p");
    count.textContent = `${groupAssets.length} item${groupAssets.length === 1 ? "" : "s"}`;

    const grid = document.createElement("div");
    grid.className = "asset-grid";

    header.appendChild(heading);
    header.appendChild(count);
    groupSection.appendChild(header);

    for (const asset of groupAssets) {
      const tile = document.createElement("article");
      tile.className = "asset-tile";

      const frame = document.createElement("div");
      frame.className = "logo-frame";

      const img = document.createElement("img");
      img.src = `../${asset.source}`;
      img.alt = asset.label;

      const title = document.createElement("h3");
      title.textContent = asset.label;

      const idText = document.createElement("p");
      idText.textContent = asset.id;

      const detailLink = document.createElement("a");
      detailLink.className = "asset-detail-link";
      detailLink.href = `#asset/${encodeURIComponent(asset.id)}`;
      detailLink.textContent = "View details";

      frame.appendChild(img);
      tile.appendChild(title);
      tile.appendChild(idText);
      tile.appendChild(detailLink);
      tile.prepend(frame);
      grid.appendChild(tile);
    }

    groupSection.appendChild(grid);
    groupsRoot.appendChild(groupSection);
  }
}

function renderAssetDetail(assetId) {
  const title = document.getElementById("asset-detail-title");
  const meta = document.getElementById("asset-detail-meta");
  const deepLink = document.getElementById("asset-deep-link");
  const sizeGrid = document.getElementById("asset-size-grid");
  if (!title || !meta || !deepLink || !sizeGrid) return;

  sizeGrid.innerHTML = "";
  const asset = assetById.get(assetId);

  if (!asset) {
    title.textContent = "Asset not found";
    meta.textContent = `No logo or glyph exists for id: ${assetId}`;
    deepLink.textContent = window.location.href;
    deepLink.href = window.location.href;
    return;
  }

  title.textContent = asset.label;
  meta.textContent = `${asset.id} - ${asset.source} - Project: ${projectForAsset(asset)} - Type: ${logoTypeForAsset(asset)} - Custom Groups: ${groupsForAsset(asset).join(", ")}`;
  deepLink.textContent = window.location.href;
  deepLink.href = window.location.href;

  for (const size of uniqueSortedSizes(asset)) {
    const card = document.createElement("article");
    card.className = "size-preview-card";

    const frame = document.createElement("div");
    frame.className = "size-preview-frame";
    frame.style.width = `${Math.max(size + 32, 120)}px`;
    frame.style.height = `${Math.max(size + 32, 120)}px`;

    const img = document.createElement("img");
    img.src = `../${asset.source}`;
    img.alt = `${asset.label} at ${size}px`;
    img.style.maxWidth = `${size}px`;
    img.style.maxHeight = `${size}px`;

    const caption = document.createElement("p");
    caption.className = "size-preview-caption";
    caption.textContent = `${size}px`;

    frame.appendChild(img);
    card.appendChild(frame);
    card.appendChild(caption);
    sizeGrid.appendChild(card);
  }
}

function renderCurrentRoute() {
  const route = getRouteFromHash();
  setMainViewVisibility(route);
  if (route.page === "asset") {
    renderAssetDetail(route.assetId);
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
    tile.className = "asset-tile";

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
  wireTopNav();

  const [assetManifest, specs] = await Promise.all([
    loadJson("../manifests/assets.json"),
    loadJson("./spec-index.json")
  ]);

  diagramData = specs.diagrams ?? [];
  assetData = assetManifest.assets ?? [];
  assetById = new Map(assetData.map((asset) => [asset.id, asset]));
  wireGroupingControls();
  renderLogos(assetData);
  await renderDiagrams();

  renderCurrentRoute();
  window.addEventListener("hashchange", renderCurrentRoute);
}

init().catch((error) => {
  console.error(error);
  const content = document.querySelector(".preview-content");
  if (content) {
    content.innerHTML = `<section class="card"><div class="card-header"><h3>Preview failed</h3></div><div class="card-body"><p>${error.message}</p></div></section>`;
  }
});
