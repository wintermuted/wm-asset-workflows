export async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return response.json();
}

export function getRouteFromHash() {
  const hash = window.location.hash || "#logos";
  const token = hash.replace(/^#/, "");

  if (token.startsWith("asset/")) {
    const encodedId = token.slice("asset/".length).trim();
    return { tab: "logos", page: "asset", assetId: decodeHashSegment(encodedId) };
  }

  if (token.startsWith("source/")) {
    const [encodedProject = "", encodedSource = ""] = token.slice("source/".length).split("/");
    return {
      tab: "logos",
      page: "source",
      projectName: decodeHashSegment(encodedProject),
      sourcePath: decodeHashSegment(encodedSource)
    };
  }

  if (token.startsWith("project/")) {
    const encodedProject = token.slice("project/".length).trim();
    return { tab: "logos", page: "project", projectName: decodeHashSegment(encodedProject) };
  }

  if (token === "diagrams") {
    return { tab: "diagrams", page: "collection" };
  }

  return { tab: "logos", page: "collection" };
}

export function applyThemeFromQuery() {
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

export function wireThemeToggle(renderDiagrams) {
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

export function wireTopNav() {
  const tabs = Array.from(document.querySelectorAll("[data-preview-tab]"));
  if (!tabs.length) return;

  const setActive = () => {
    const route = getRouteFromHash();
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute("data-preview-tab") === route.tab;
      tab.classList.toggle("is-active", isActive);
      if (isActive) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
  };

  if (!window.location.hash) window.location.hash = "#logos";
  window.addEventListener("hashchange", setActive);
  setActive();
}

export function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalizeProjectPrompt(prompt, projectName, projectSlug) {
  const fields = `Project: ${projectName}\nDirectory: assets/svg/${projectSlug}/`;
  const content = String(prompt)
    .replace(/^Project:.*(?:\r?\n)?/gm, "")
    .replace(/^Directory:.*(?:\r?\n)?/gm, "")
    .trimEnd();
  return content ? `${content}\n\n${fields}` : fields;
}

let toastTimeout;

export function showToast(message) {
  const toast = document.getElementById("app-toast");
  if (!toast) return;
  window.clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.hidden = false;
  toastTimeout = window.setTimeout(() => {
    toast.hidden = true;
    toast.textContent = "";
  }, 2400);
}

function decodeHashSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}
