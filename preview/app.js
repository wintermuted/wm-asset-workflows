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
    const id = decodeHashSegment(encodedId);
    return { tab: "logos", page: "asset", assetId: id };
  }

  if (token.startsWith("project/")) {
    const encodedProject = token.slice("project/".length).trim();
    const projectName = decodeHashSegment(encodedProject);
    return { tab: "logos", page: "project", projectName };
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
let projectMetaByName = new Map();
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

function decodeHashSegment(value) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch (_error) {
    decoded = value;
  }
  return decoded;
}

function projectRouteHref(projectName) {
  return `#project/${encodeURIComponent(projectName)}`;
}

function resolveAssetPath(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (String(value).startsWith("/")) return value;
  return `../${value}`;
}

function normalizeProjectSteer(projectName) {
  const projectMeta = projectMetaByName.get(projectName);
  if (!projectMeta || !projectMeta.agentSteer) {
    return { notes: [], sources: [] };
  }

  const fromManifest = projectMeta.agentSteer;

  const notes = Array.isArray(fromManifest.notes) ? fromManifest.notes.map((item) => String(item).trim()).filter(Boolean) : [];
  const sources = Array.isArray(fromManifest.sources) ? fromManifest.sources : [];
  return { notes, sources };
}

function primaryProjectAsset(projectName, projectAssets) {
  const projectMeta = projectMetaByName.get(projectName);
  const primaryAssetId = String(projectMeta?.primaryAssetId || "").trim();

  if (primaryAssetId) {
    const matched = projectAssets.find((asset) => asset.id === primaryAssetId);
    if (matched) {
      return matched;
    }
  }

  return projectAssets[0] || null;
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
  const assetDetailSection = document.getElementById("asset-detail");
  const projectDetailSection = document.getElementById("project-detail");
  if (!logosSection || !diagramsSection || !assetDetailSection || !projectDetailSection) return;

  const onAssetPage = route.page === "asset";
  const onProjectPage = route.page === "project";
  const onDetailPage = onAssetPage || onProjectPage;

  logosSection.classList.toggle("is-hidden", onDetailPage);
  diagramsSection.classList.toggle("is-hidden", onDetailPage);
  assetDetailSection.classList.toggle("is-hidden", !onAssetPage);
  projectDetailSection.classList.toggle("is-hidden", !onProjectPage);
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
    if (activeGroupingMode === "project") {
      const titleLink = document.createElement("a");
      titleLink.className = "project-title-link";
      titleLink.href = projectRouteHref(groupName);
      titleLink.textContent = groupName;
      heading.appendChild(titleLink);
    } else {
      heading.textContent = groupName;
    }

    const count = document.createElement("p");
    count.textContent = `${groupAssets.length} item${groupAssets.length === 1 ? "" : "s"}`;

    const grid = document.createElement("div");
    grid.className = "asset-grid";

    header.appendChild(heading);
    header.appendChild(count);
    groupSection.appendChild(header);

    const visibleAssets =
      activeGroupingMode === "project"
        ? [primaryProjectAsset(groupName, groupAssets)].filter(Boolean)
        : groupAssets;

    for (const asset of visibleAssets) {
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

      if (activeGroupingMode === "project") {
        const iconLink = document.createElement("a");
        iconLink.className = "project-icon-link";
        iconLink.href = projectRouteHref(groupName);
        iconLink.setAttribute("aria-label", `Open project page for ${groupName}`);
        iconLink.appendChild(img);
        frame.appendChild(iconLink);
      } else {
        frame.appendChild(img);
      }
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
  const projectRow = document.getElementById("asset-project-row");
  const projectLink = document.getElementById("asset-project-link");
  const sizeGrid = document.getElementById("asset-size-grid");
  if (!title || !meta || !deepLink || !projectRow || !projectLink || !sizeGrid) return;

  sizeGrid.innerHTML = "";
  const asset = assetById.get(assetId);

  if (!asset) {
    title.textContent = "Asset not found";
    meta.textContent = `No logo or glyph exists for id: ${assetId}`;
    deepLink.textContent = window.location.href;
    deepLink.href = window.location.href;
    projectRow.classList.add("is-hidden");
    return;
  }

  const projectName = projectForAsset(asset);
  title.textContent = asset.label;
  meta.textContent = `${asset.id} - ${asset.source} - Project: ${projectForAsset(asset)} - Type: ${logoTypeForAsset(asset)} - Custom Groups: ${groupsForAsset(asset).join(", ")}`;
  deepLink.textContent = window.location.href;
  deepLink.href = window.location.href;
  projectLink.textContent = projectName;
  projectLink.href = projectRouteHref(projectName);
  projectRow.classList.remove("is-hidden");

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

function renderProjectDetail(projectName) {
  const title = document.getElementById("project-detail-title");
  const meta = document.getElementById("project-detail-meta");
  const deepLink = document.getElementById("project-deep-link");
  const grid = document.getElementById("project-asset-grid");
  const notesList = document.getElementById("project-steer-notes");
  const sourcesGrid = document.getElementById("project-steer-sources");
  const emptyState = document.getElementById("project-steer-empty");
  if (!title || !meta || !deepLink || !grid || !notesList || !sourcesGrid || !emptyState) return;

  grid.innerHTML = "";
  notesList.innerHTML = "";
  sourcesGrid.innerHTML = "";
  const targetProject = String(projectName || "").trim();
  const projectAssets = assetData
    .filter((asset) => projectForAsset(asset) === targetProject)
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!targetProject || !projectAssets.length) {
    title.textContent = "Project not found";
    meta.textContent = `No assets are registered for project: ${projectName}`;
    deepLink.textContent = window.location.href;
    deepLink.href = window.location.href;
    emptyState.classList.remove("is-hidden");
    return;
  }

  title.textContent = targetProject;
  meta.textContent = `${projectAssets.length} asset${projectAssets.length === 1 ? "" : "s"}`;
  deepLink.textContent = window.location.href;
  deepLink.href = window.location.href;

  const steer = normalizeProjectSteer(targetProject);
  const hasSteer = steer.notes.length > 0 || steer.sources.length > 0;
  emptyState.classList.toggle("is-hidden", hasSteer);

  for (const note of steer.notes) {
    const item = document.createElement("li");
    item.textContent = note;
    notesList.appendChild(item);
  }

  for (const source of steer.sources) {
    const card = document.createElement("article");
    card.className = "source-material-card";

    const titleEl = document.createElement("h5");
    titleEl.textContent = String(source.title || "Source Material");
    card.appendChild(titleEl);

    const kind = String(source.kind || "text").toLowerCase();

    if (kind === "image") {
      const img = document.createElement("img");
      img.className = "source-material-image";
      img.src = resolveAssetPath(source.src || source.url || "");
      img.alt = String(source.alt || source.title || "Source image");
      card.appendChild(img);
    } else if (kind === "url") {
      const link = document.createElement("a");
      link.href = String(source.url || "");
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = String(source.url || "Open URL");
      card.appendChild(link);
    } else if (kind === "file") {
      const link = document.createElement("a");
      link.href = resolveAssetPath(source.path || source.url || "");
      link.textContent = String(source.path || source.url || "Open file");
      card.appendChild(link);
    } else {
      const body = document.createElement("p");
      body.textContent = String(source.text || "");
      card.appendChild(body);
    }

    sourcesGrid.appendChild(card);
  }

  for (const asset of projectAssets) {
    const tile = document.createElement("article");
    tile.className = "asset-tile";

    const frame = document.createElement("div");
    frame.className = "logo-frame";

    const img = document.createElement("img");
    img.src = `../${asset.source}`;
    img.alt = asset.label;

    const assetTitle = document.createElement("h3");
    assetTitle.textContent = asset.label;

    const idText = document.createElement("p");
    idText.textContent = asset.id;

    const detailsLink = document.createElement("a");
    detailsLink.className = "asset-detail-link";
    detailsLink.href = `#asset/${encodeURIComponent(asset.id)}`;
    detailsLink.textContent = "View asset details";

    frame.appendChild(img);
    tile.appendChild(frame);
    tile.appendChild(assetTitle);
    tile.appendChild(idText);
    tile.appendChild(detailsLink);
    grid.appendChild(tile);
  }
}

function renderCurrentRoute() {
  const route = getRouteFromHash();
  setMainViewVisibility(route);
  if (route.page === "asset") {
    renderAssetDetail(route.assetId);
    return;
  }

  if (route.page === "project") {
    renderProjectDetail(route.projectName);
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
  const projectSteer = Array.isArray(assetManifest.projects) ? assetManifest.projects : [];
  projectMetaByName = new Map(
    projectSteer
      .filter((project) => project && project.name)
      .map((project) => [String(project.name).trim(), project])
  );
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
