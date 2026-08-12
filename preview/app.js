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
let projectSamplePrompts = [];
let activeProjectPromptIndex = 0;
let toastTimeout;
const assetSvgDataCache = new Map();
const assetLayerEdits = new Map();
const assetCustomColors = new Map();
const assetLayerSelections = new Map();
// Tracks a group just created by "Combine" (asset id -> Set of element numbers it
// contains), so the panel can auto-focus that group's name field once rendered.
const assetPendingGroupFocus = new Map();
// Tracks an element just created via "Add element" (asset id -> element number),
// so the panel can select/highlight it once rendered.
const assetPendingElementSelection = new Map();
// Cleans up the keyboard/drag listeners wired for the previously rendered
// asset detail view, so re-rendering (navigating between assets) doesn't
// stack up duplicate global listeners.
let activePrimaryLayerInteractionCleanup = null;
const NEW_ELEMENT_SHAPES = [
  { value: "rect", label: "Rectangle" },
  { value: "circle", label: "Circle" },
  { value: "line", label: "Line" }
];
const SVG_PAINT_PROPERTIES = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];
const GRAPHIC_ELEMENT_SELECTOR = "path, rect, circle, ellipse, line, polyline, polygon";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

function normalizeSvgColor(value) {
  const color = String(value || "").trim();
  const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (!hex) return "";
  const expanded = hex.length <= 4
    ? [...hex].map((character) => character.repeat(2)).join("")
    : hex;
  return `#${expanded.toUpperCase()}`;
}

function resolveSvgPaint(element, property, svg) {
  let candidate = element;
  while (candidate) {
    const value = String(candidate.getAttribute(property) || candidate.style?.getPropertyValue(property) || "").trim();
    if (value) return normalizeSvgColor(value) || value;
    if (candidate === svg) break;
    candidate = candidate.parentElement;
  }
  return property === "fill" ? "#000000" : "none";
}

function graphicElementPaints(element, svg) {
  return ["fill", "stroke"]
    .map((property) => [property, resolveSvgPaint(element, property, svg)])
    .filter(([, value]) => value !== "none");
}

function describeGraphicElement(element, svg) {
  const paints = graphicElementPaints(element, svg)
    .map(([property, value]) => `${property} ${value}`);
  return `${element.localName}${paints.length ? ` · ${paints.join(" · ")}` : ""}`;
}

function computePaintLayers(svg) {
  const graphicElements = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
  return graphicElements.map((element, index) => {
    let depth = 0;
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== svg) {
      if (ancestor.localName === "g") depth += 1;
      ancestor = ancestor.parentElement;
    }
    return {
      number: index + 1,
      element: element.localName,
      id: element.getAttribute("id") || "",
      paints: graphicElementPaints(element, svg),
      opacity: element.getAttribute("opacity") || "",
      attributes: Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]),
      groupDepth: depth
    };
  });
}

// Builds a nested tree of elements/groups in document order so the panel can render
// SVG <g> nesting as real outlined sub-lists instead of a flat "group depth" label.
// Traversal order matches computePaintLayers' querySelectorAll order (depth-first,
// document order), so element numbers assigned here line up with `layer.number`.
function buildElementTree(container, counter = { value: 0 }) {
  const nodes = [];
  for (const child of container.children) {
    if (child.matches(GRAPHIC_ELEMENT_SELECTOR)) {
      counter.value += 1;
      nodes.push({ type: "element", number: counter.value });
    } else if (child.localName === "g") {
      nodes.push({ type: "group", element: child, children: buildElementTree(child, counter) });
    } else {
      // Non-<g> containers (defs, clipPath, symbol, ...) aren't a visual group,
      // but their descendants still count toward numbering, so flatten them in.
      nodes.push(...buildElementTree(child, counter));
    }
  }
  return nodes;
}

function remapAssetLayerEdits(assetId, remap) {
  const edits = assetLayerEdits.get(assetId);
  if (!edits) return;
  const next = new Map();
  for (const [oldNumber, edit] of edits) {
    const newNumber = remap.get(oldNumber);
    if (newNumber) next.set(newNumber, edit);
  }
  assetLayerEdits.set(assetId, next);
}

// Keeps the multi-select checkbox selection valid after operations that renumber
// elements (reorder, combine, add), same pattern as remapAssetLayerEdits.
function remapAssetLayerSelection(assetId, remap) {
  const selection = assetLayerSelections.get(assetId);
  if (!selection) return;
  const next = new Set();
  for (const oldNumber of selection) {
    const newNumber = remap.get(oldNumber);
    if (newNumber) next.add(newNumber);
  }
  assetLayerSelections.set(assetId, next);
}

function refreshAssetSvgMetrics(data, svg) {
  const graphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
  data.paintLayers = computePaintLayers(svg);
  data.paintLayerCount = data.paintLayers.length;
  data.topmostLayer = graphics.length ? describeGraphicElement(graphics.at(-1), svg) : "None";
  data.maxGroupDepth = Math.max(0, ...data.paintLayers.map((layer) => layer.groupDepth));
  data.groupCount = svg.querySelectorAll("g").length;
}

function reorderAssetLayer(asset, fromNumber, toNumber, onComplete) {
  if (fromNumber === toNumber) return;
  loadAssetSvgData(asset.source).then((data) => {
    const svg = data.svg;
    const graphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const moving = graphics[fromNumber - 1];
    const target = graphics[toNumber - 1];
    if (!moving || !target || moving === target) return;
    const oldNumberByElement = new Map(graphics.map((element, index) => [element, index + 1]));
    if (fromNumber < toNumber) target.after(moving); else target.before(moving);
    const newGraphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const remap = new Map();
    newGraphics.forEach((element, index) => {
      const oldNumber = oldNumberByElement.get(element);
      if (oldNumber) remap.set(oldNumber, index + 1);
    });
    remapAssetLayerEdits(asset.id, remap);
    remapAssetLayerSelection(asset.id, remap);
    refreshAssetSvgMetrics(data, svg);
    onComplete?.();
  });
}

function multiplySvgMatrices(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ];
}

function invertSvgMatrix(matrix) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!determinant) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ];
}

function svgTransformToMatrix(name, args) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  if (name === "matrix") return args.length === 6 ? args : IDENTITY_MATRIX;
  if (name === "translate") return [1, 0, 0, 1, args[0] || 0, args[1] || 0];
  if (name === "scale") {
    const scaleX = args[0] ?? 1;
    return [scaleX, 0, 0, args[1] ?? scaleX, 0, 0];
  }
  if (name === "rotate") {
    const angle = toRadians(args[0] || 0);
    const rotation = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
    if (args.length < 3) return rotation;
    return multiplySvgMatrices(
      multiplySvgMatrices([1, 0, 0, 1, args[1], args[2]], rotation),
      [1, 0, 0, 1, -args[1], -args[2]]
    );
  }
  if (name === "skewX") return [1, 0, Math.tan(toRadians(args[0] || 0)), 1, 0, 0];
  if (name === "skewY") return [1, Math.tan(toRadians(args[0] || 0)), 0, 1, 0, 0];
  return IDENTITY_MATRIX;
}

function parseSvgTransform(value) {
  let matrix = IDENTITY_MATRIX;
  for (const [, name, rawArgs] of String(value || "").matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const args = rawArgs.split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((argument) => !Number.isFinite(argument))) continue;
    matrix = multiplySvgMatrices(matrix, svgTransformToMatrix(name, args));
  }
  return matrix;
}

// Accumulates transforms from the SVG root down to and including `element`.
function accumulatedSvgMatrix(element, root) {
  const chain = [];
  let node = element;
  while (node) {
    chain.unshift(node);
    if (node === root) break;
    node = node.parentElement;
  }
  return chain.reduce(
    (matrix, node) => multiplySvgMatrices(matrix, parseSvgTransform(node.getAttribute("transform"))),
    IDENTITY_MATRIX
  );
}

function svgMatrixToString(matrix) {
  if (matrix.every((value, index) => Math.abs(value - IDENTITY_MATRIX[index]) < 1e-9)) return "";
  return `matrix(${matrix.map((value) => Number(value.toFixed(6))).join(" ")})`;
}

// Turns free-text input into a valid SVG/XML `id`: strips characters outside the
// permitted set, collapses whitespace to hyphens, and ensures a legal leading
// character (ids must start with a letter or underscore).
function sanitizeSvgId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  let id = trimmed.replace(/\s+/g, "-").replace(/[^A-Za-z0-9_:.-]/g, "");
  if (!id) return "";
  if (!/^[A-Za-z_]/.test(id)) id = `g-${id}`;
  return id;
}

// Recursively collects the element numbers a tree node (and its nested groups)
// contains, so a freshly combined group can be matched after a re-render.
function collectElementNumbers(node) {
  if (node.type === "element") return [node.number];
  return node.children.flatMap(collectElementNumbers);
}

// Wraps the selected graphic elements in a new <g>, placed at the topmost
// selected layer's position so the group keeps that layer's stacking order.
function combineAssetLayers(asset, layerNumbers, onComplete) {
  const numbers = [...new Set(layerNumbers)]
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((left, right) => left - right);
  if (numbers.length < 2) return;

  loadAssetSvgData(asset.source).then((data) => {
    const svg = data.svg;
    const graphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const selected = numbers.map((number) => graphics[number - 1]).filter(Boolean);
    if (selected.length < 2) return;

    const oldNumberByElement = new Map(graphics.map((element, index) => [element, index + 1]));
    const group = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "g");
    selected.at(-1).after(group);

    // Elements pulled out of transformed ancestors keep their rendered position.
    const inverseDestination = invertSvgMatrix(accumulatedSvgMatrix(group.parentElement, svg));
    for (const element of selected) {
      const effective = accumulatedSvgMatrix(element, svg);
      const preserved = inverseDestination ? multiplySvgMatrices(inverseDestination, effective) : effective;
      group.appendChild(element);
      const transform = svgMatrixToString(preserved);
      if (transform) element.setAttribute("transform", transform);
      else element.removeAttribute("transform");
    }

    for (const candidate of Array.from(svg.querySelectorAll("g"))) {
      if (candidate !== group && !candidate.children.length && !candidate.getAttribute("id")) candidate.remove();
    }

    const newGraphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const remap = new Map();
    newGraphics.forEach((element, index) => {
      const oldNumber = oldNumberByElement.get(element);
      if (oldNumber) remap.set(oldNumber, index + 1);
    });
    remapAssetLayerEdits(asset.id, remap);
    remapAssetLayerSelection(asset.id, remap);
    refreshAssetSvgMetrics(data, svg);
    onComplete?.(numbers.map((number) => remap.get(number)).filter(Boolean));
  });
}

// Computes a centered default position/size for a newly created shape, based on
// the SVG's viewBox (falling back to width/height attrs, then a 512x512 default).
function getAssetViewBoxBounds(svg) {
  const baseVal = svg.viewBox?.baseVal;
  if (baseVal && (baseVal.width || baseVal.height)) {
    return { minX: baseVal.x, minY: baseVal.y, width: baseVal.width, height: baseVal.height };
  }
  const width = Number(svg.getAttribute("width")) || 512;
  const height = Number(svg.getAttribute("height")) || 512;
  return { minX: 0, minY: 0, width, height };
}

function createDefaultShapeElement(svg, shape) {
  const { minX, minY, width, height } = getAssetViewBoxBounds(svg);
  const size = Math.max(1, Math.min(width, height) * 0.2);
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;
  const element = svg.ownerDocument.createElementNS(SVG_NAMESPACE, shape);
  element.setAttribute("fill", shape === "line" ? "none" : "#6366F1");
  if (shape === "rect") {
    element.setAttribute("x", String(centerX - size / 2));
    element.setAttribute("y", String(centerY - size / 2));
    element.setAttribute("width", String(size));
    element.setAttribute("height", String(size));
  } else if (shape === "circle") {
    element.setAttribute("cx", String(centerX));
    element.setAttribute("cy", String(centerY));
    element.setAttribute("r", String(size / 2));
  } else if (shape === "line") {
    element.setAttribute("x1", String(centerX - size / 2));
    element.setAttribute("y1", String(centerY));
    element.setAttribute("x2", String(centerX + size / 2));
    element.setAttribute("y2", String(centerY));
    element.setAttribute("stroke", "#6366F1");
    element.setAttribute("stroke-width", "2");
  }
  return element;
}

// Creates a new shape element as the topmost child of `container` (the SVG root
// for a global-topmost element, or an existing <g> to add inside that group),
// then remaps edits/selection just like reorder/combine. `onComplete` receives
// the new element's post-remap number (or undefined if the create failed).
function createAssetElement(asset, shape, container, onComplete) {
  loadAssetSvgData(asset.source).then((data) => {
    const svg = data.svg;
    const target = container && svg.contains(container) ? container : svg;
    const graphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const oldNumberByElement = new Map(graphics.map((element, index) => [element, index + 1]));
    const element = createDefaultShapeElement(svg, shape);
    target.appendChild(element);

    const newGraphics = Array.from(svg.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
    const remap = new Map();
    let newNumber;
    newGraphics.forEach((graphic, index) => {
      const oldNumber = oldNumberByElement.get(graphic);
      if (oldNumber) remap.set(oldNumber, index + 1);
      if (graphic === element) newNumber = index + 1;
    });
    remapAssetLayerEdits(asset.id, remap);
    remapAssetLayerSelection(asset.id, remap);
    refreshAssetSvgMetrics(data, svg);
    onComplete?.(newNumber);
  });
}

function describeSvgEffects(documentRoot) {
  const effects = [
    ["gradient", documentRoot.querySelectorAll("linearGradient, radialGradient").length],
    ["clip path", documentRoot.querySelectorAll("clipPath").length],
    ["mask", documentRoot.querySelectorAll("mask").length],
    ["filter", documentRoot.querySelectorAll("filter").length]
  ];
  const used = effects.filter(([, count]) => count > 0);
  return used.length
    ? used.map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(", ")
    : "None";
}

function loadAssetSvgData(source) {
  if (!assetSvgDataCache.has(source)) {
    assetSvgDataCache.set(source, (async () => {
      const response = await fetch(`../${source}`);
      if (!response.ok) throw new Error(`Failed to load ${source}`);
      const sourceText = await response.text();
      const documentRoot = new DOMParser().parseFromString(sourceText, "image/svg+xml");
      if (documentRoot.querySelector("parsererror")) throw new Error(`Failed to parse ${source}`);

      const colors = [];
      for (const element of documentRoot.querySelectorAll("*")) {
        for (const property of SVG_PAINT_PROPERTIES) {
          const color = normalizeSvgColor(element.getAttribute(property) || element.style?.getPropertyValue(property));
          if (color && !colors.includes(color)) colors.push(color);
        }
      }
      const svg = documentRoot.documentElement;
      const graphicElements = Array.from(documentRoot.querySelectorAll(GRAPHIC_ELEMENT_SELECTOR));
      const paths = Array.from(documentRoot.querySelectorAll("path"));
      const pathCommands = /[AaCcHhLlMmQqSsTtVvZz]/g;
      const paintLayers = computePaintLayers(svg);
      return {
        colors,
        viewBox: svg.getAttribute("viewBox") || "Not set",
        width: svg.getAttribute("width") || "Not set",
        height: svg.getAttribute("height") || "Not set",
        paintLayers,
        paintLayerCount: paintLayers.length,
        topmostLayer: graphicElements.length ? describeGraphicElement(graphicElements.at(-1), svg) : "None",
        pathCount: paths.length,
        closedPathCount: paths.filter((path) => /[Zz]/.test(path.getAttribute("d") || "")).length,
        pathSubpathCount: paths.reduce((count, path) => count + ((path.getAttribute("d") || "").match(/[Mm]/g)?.length || 0), 0),
        pathCommandCount: paths.reduce((count, path) => count + ((path.getAttribute("d") || "").match(pathCommands)?.length || 0), 0),
        groupCount: documentRoot.querySelectorAll("g").length,
        maxGroupDepth: Math.max(0, ...paintLayers.map((layer) => layer.groupDepth)),
        effects: describeSvgEffects(documentRoot),
        byteSize: new TextEncoder().encode(sourceText).length,
        accessibleName: svg.querySelector("title")?.textContent?.trim() || "Not defined",
        description: svg.querySelector("desc")?.textContent?.trim() || "Not defined",
        svg
      };
    })());
  }
  return assetSvgDataCache.get(source);
}

function loadAssetColors(source) {
  return loadAssetSvgData(source).then((data) => data.colors);
}

function elementUsesSvgColor(element, color) {
  return SVG_PAINT_PROPERTIES.some((property) => (
    normalizeSvgColor(element.getAttribute(property) || element.style?.getPropertyValue(property)) === color
  ));
}

function setPrimarySvgColorHighlight(root, color, highlighted) {
  const svg = root.querySelector("svg");
  if (!svg) return [];
  const graphics = Array.from(svg.querySelectorAll("path, rect, circle, ellipse, line, polyline, polygon"));
  graphics.forEach((element, index) => {
    element.dataset.paintLayer = String(index + 1);
  });

  if (!highlighted) {
    for (const element of graphics) {
      element.classList.remove("is-color-highlighted", "is-color-muted");
    }
    return [];
  }

  const selected = graphics.filter((element) => {
    let candidate = element;
    while (candidate && candidate !== svg) {
      if (elementUsesSvgColor(candidate, color)) return true;
      candidate = candidate.parentElement;
    }
    return false;
  });
  const selectedSet = new Set(selected);
  for (const element of graphics) {
    element.classList.toggle("is-color-highlighted", selectedSet.has(element));
    element.classList.toggle("is-color-muted", !selectedSet.has(element));
  }
  return selected;
}

function setPrimarySvgLayerHighlight(root, layerNumber, highlighted) {
  const graphics = Array.from(root.querySelectorAll("svg :is(path, rect, circle, ellipse, line, polyline, polygon)"));
  if (!highlighted) {
    for (const element of graphics) {
      element.classList.remove("is-color-highlighted", "is-color-muted");
    }
    return;
  }

  const selected = graphics[layerNumber - 1];
  for (const element of graphics) {
    element.classList.toggle("is-color-highlighted", element === selected);
    element.classList.toggle("is-color-muted", element !== selected);
  }
}

// Draws a lightweight blue selection outline on every shift-click-selected
// element. Only shown once 2+ elements are selected - a single selection
// already gets the stronger red is-color-highlighted treatment above, and
// stacking both would just be visual clutter for the common single-select case.
function setPrimarySvgMultiSelectHighlight(root, layerNumbers) {
  const graphics = Array.from(root.querySelectorAll("svg :is(path, rect, circle, ellipse, line, polyline, polygon)"));
  const selected = new Set(layerNumbers);
  const showAll = selected.size > 1;
  graphics.forEach((element, idx) => {
    element.classList.toggle("is-multi-selected", showAll && selected.has(idx + 1));
  });
}

function describeSvgRegions(elements) {
  const labels = { rect: "rectangle", ellipse: "ellipse", polyline: "polyline", polygon: "polygon" };
  const counts = new Map();
  for (const element of elements) {
    const name = labels[element.localName] || element.localName;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => `${count} ${name}${count === 1 ? "" : "s"}`).join(", ");
}

function describeSvgLayers(elements) {
  const layers = elements
    .map((element) => Number(element.dataset.paintLayer))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const ranges = [];
  for (const layer of layers) {
    const current = ranges.at(-1);
    if (current && layer === current[1] + 1) {
      current[1] = layer;
    } else {
      ranges.push([layer, layer]);
    }
  }
  const summary = ranges.map(([start, end]) => start === end ? String(start) : `${start}-${end}`).join(", ");
  return `${layers.length === 1 ? "element" : "elements"} ${summary}`;
}

function renderAssetPrimarySvg(root, asset) {
  root.replaceChildren();
  root.dataset.assetId = asset.id;
  root.setAttribute("aria-label", `${asset.label} at 512px`);

  loadAssetSvgData(asset.source).then((data) => {
    if (!root.isConnected || root.dataset.assetId !== asset.id) return;
    const svg = document.importNode(data.svg, true);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    applyAssetLayerEdits(svg, asset.id);
    root.replaceChildren(svg);
  }).catch(() => {
    if (root.isConnected && root.dataset.assetId === asset.id) root.textContent = "Preview unavailable";
  });
}

function updateAssetLayerEdits(assetId, layerNumber, updates) {
  if (!assetLayerEdits.has(assetId)) assetLayerEdits.set(assetId, new Map());
  const edits = assetLayerEdits.get(assetId);
  const existing = edits.get(layerNumber) || { paints: {}, attrs: {} };
  edits.set(layerNumber, {
    ...existing,
    ...updates,
    paints: { ...existing.paints, ...updates.paints },
    attrs: { ...existing.attrs, ...updates.attrs }
  });
}

function applyAssetLayerEdits(svg, assetId) {
  if (!svg) return;
  const edits = assetLayerEdits.get(assetId);
  if (!edits) return;
  const graphics = Array.from(svg.querySelectorAll(":is(path, rect, circle, ellipse, line, polyline, polygon)"));
  for (const [layerNumber, edit] of edits) {
    const element = graphics[layerNumber - 1];
    if (!element) continue;
    for (const [property, value] of Object.entries(edit.paints)) {
      element.setAttribute(property, value);
    }
    for (const [property, value] of Object.entries(edit.attrs || {})) {
      element.setAttribute(property, value);
    }
    if (edit.opacity !== undefined) element.setAttribute("opacity", String(edit.opacity));
    if (edit.offsetX !== undefined || edit.offsetY !== undefined || edit.resize || edit.rotation !== undefined) {
      const originalTransform = element.dataset.originalTransform ?? element.getAttribute("transform") ?? "";
      element.dataset.originalTransform = originalTransform;
      const parts = [originalTransform];
      if (edit.rotation !== undefined) {
        // Rotate around the element's current visual center - after resize
        // and move (offset) have been applied, but before any ambient
        // original/group transform - so it spins the shape in place
        // regardless of how it's been moved or resized.
        let centerX, centerY;
        if (edit.resize) {
          centerX = (edit.resize.left + edit.resize.right) / 2;
          centerY = (edit.resize.top + edit.resize.bottom) / 2;
        } else {
          let bbox = null;
          try { bbox = element.getBBox(); } catch { /* not renderable yet */ }
          centerX = bbox ? bbox.x + bbox.width / 2 : 0;
          centerY = bbox ? bbox.y + bbox.height / 2 : 0;
        }
        const cx = centerX + (edit.offsetX || 0);
        const cy = centerY + (edit.offsetY || 0);
        parts.push(`rotate(${edit.rotation} ${cx} ${cy})`);
      }
      if (edit.offsetX !== undefined || edit.offsetY !== undefined) {
        parts.push(`translate(${edit.offsetX || 0} ${edit.offsetY || 0})`);
      }
      if (edit.resize) {
        // Maps the element's native (untransformed) bounding box edges
        // (nativeLeft/Top/Right/Bottom, captured once on the first resize) onto
        // the stored current edges (left/top/right/bottom). Storing absolute
        // native-space edges - rather than an anchor point plus a scale factor -
        // means each edge's screen position is derived independently every time,
        // so dragging a different handle in a later resize never disturbs edges
        // that aren't being dragged, even if a previous resize used a different
        // anchor. Applied innermost (rightmost) so it acts on the element's
        // native geometry before the offset/original transform.
        const { nativeLeft, nativeTop, nativeWidth, nativeHeight, left, top, right, bottom } = edit.resize;
        const scaleX = nativeWidth > 0 ? (right - left) / nativeWidth : 1;
        const scaleY = nativeHeight > 0 ? (bottom - top) / nativeHeight : 1;
        const translateX = left - scaleX * nativeLeft;
        const translateY = top - scaleY * nativeTop;
        parts.push(`translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`);
      }
      element.setAttribute("transform", parts.join(" ").trim());
    }
  }
}

// Positions the primary preview tooltip next to `element`, anchoring its
// top-left corner at the element's bottom-right corner (with a small gap),
// flipping to anchor its bottom-right corner at the element's top-left
// corner when the default placement would overflow the container (i.e. the
// element sits too close to the artboard's southeast corner).
function positionPrimaryTooltip(tooltip, container, element) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const gap = 8;
  const relLeft = elementRect.left - containerRect.left;
  const relTop = elementRect.top - containerRect.top;
  const relRight = elementRect.right - containerRect.left;
  const relBottom = elementRect.bottom - containerRect.top;
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;

  let left = relRight + gap;
  let top = relBottom + gap;
  if (left + tooltipWidth > containerRect.width || top + tooltipHeight > containerRect.height) {
    left = relLeft - gap - tooltipWidth;
    top = relTop - gap - tooltipHeight;
  }
  left = Math.max(4, Math.min(left, containerRect.width - tooltipWidth - 4));
  top = Math.max(4, Math.min(top, containerRect.height - tooltipHeight - 4));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

// Wires up hover/selection sync and interaction between the primary preview
// canvas and the elements panel, plus a live-updating position tooltip and
// resize handles for the selected element. `layersController` is the object
// returned by renderAssetLayers, exposing setHoveredLayer/clearHoveredLayer/
// selectLayer/getSelectedLayer so both surfaces (canvas + panel) stay in
// sync. Returns `{ updateTooltip, cleanup }`; callers must invoke the
// previous cleanup before wiring up a new asset (renderAssetDetail re-runs
// per view).
function enablePrimaryLayerInteraction(root, previewContainer, tooltip, handles, guides, asset, layersController) {
  const getGraphics = () => {
    const svg = root.querySelector("svg");
    return svg ? Array.from(svg.querySelectorAll(":is(path, rect, circle, ellipse, line, polyline, polygon)")) : [];
  };
  const isTypingTarget = (element) => {
    if (!element) return false;
    if (element.isContentEditable) return true;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName);
  };

  const handleNames = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const handleElements = new Map();
  let rotateHandleEl = null;
  let rotateLineEl = null;
  if (handles) {
    handles.replaceChildren();
    for (const name of handleNames) {
      const handleEl = document.createElement("div");
      handleEl.className = `asset-resize-handle asset-resize-handle--${name}`;
      handleEl.dataset.handle = name;
      handles.appendChild(handleEl);
      handleElements.set(name, handleEl);
    }
    rotateLineEl = document.createElement("div");
    rotateLineEl.className = "asset-rotate-handle-line";
    handles.appendChild(rotateLineEl);
    rotateHandleEl = document.createElement("div");
    rotateHandleEl.className = "asset-rotate-handle";
    rotateHandleEl.dataset.handle = "rotate";
    handles.appendChild(rotateHandleEl);
  }

  const ROTATE_HANDLE_OFFSET = 24;

  const updateHandles = (layerNumber) => {
    if (!handles) return;
    if (layerNumber === null || layerNumber === undefined) {
      handles.hidden = true;
      return;
    }
    const element = getGraphics()[layerNumber - 1];
    if (!element || !element.isConnected) {
      handles.hidden = true;
      return;
    }
    const containerRect = previewContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const left = elementRect.left - containerRect.left;
    const top = elementRect.top - containerRect.top;
    const midX = left + elementRect.width / 2;
    const midY = top + elementRect.height / 2;
    const right = left + elementRect.width;
    const bottom = top + elementRect.height;
    const positions = {
      nw: [left, top], n: [midX, top], ne: [right, top],
      e: [right, midY], se: [right, bottom], s: [midX, bottom],
      sw: [left, bottom], w: [left, midY]
    };
    for (const [name, handleEl] of handleElements) {
      const [x, y] = positions[name];
      handleEl.style.left = `${x}px`;
      handleEl.style.top = `${y}px`;
    }
    if (rotateHandleEl) {
      rotateHandleEl.style.left = `${midX}px`;
      rotateHandleEl.style.top = `${top - ROTATE_HANDLE_OFFSET}px`;
    }
    if (rotateLineEl) {
      rotateLineEl.style.left = `${midX}px`;
      rotateLineEl.style.top = `${top - ROTATE_HANDLE_OFFSET}px`;
      rotateLineEl.style.height = `${ROTATE_HANDLE_OFFSET}px`;
    }
    handles.hidden = false;
  };


  const updateTooltip = (layerNumber) => {
    updateHandles(layerNumber);
    if (!tooltip) return;
    if (layerNumber === null || layerNumber === undefined) {
      tooltip.hidden = true;
      return;
    }
    const element = getGraphics()[layerNumber - 1];
    if (!element || !element.isConnected) {
      tooltip.hidden = true;
      return;
    }
    const edit = assetLayerEdits.get(asset.id)?.get(layerNumber);
    let bbox = { width: 0, height: 0 };
    try { bbox = element.getBBox(); } catch { /* element may not be renderable yet */ }
    tooltip.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = `Element ${layerNumber} · ${element.localName}`;
    const position = document.createElement("span");
    position.textContent = `x ${Math.round(edit?.offsetX || 0)}, y ${Math.round(edit?.offsetY || 0)}`;
    const size = document.createElement("span");
    size.textContent = `${Math.round(bbox.width)} × ${Math.round(bbox.height)}`;
    tooltip.append(title, position, size);
    if (edit?.rotation) {
      const rotation = document.createElement("span");
      rotation.textContent = `${Math.round(edit.rotation % 360)}°`;
      tooltip.append(rotation);
    }
    tooltip.hidden = false;
    positionPrimaryTooltip(tooltip, previewContainer, element);
  };

  const moveSelectedLayer = (layerNumber, offsetX, offsetY) => {
    updateAssetLayerEdits(asset.id, layerNumber, { offsetX, offsetY });
    applyAssetLayerEdits(root.querySelector("svg"), asset.id);
    updateTooltip(layerNumber);
  };

  const onKeydown = (event) => {
    const layerNumber = layersController.getSelectedLayer();
    if (layerNumber === null || layerNumber === undefined || isTypingTarget(document.activeElement)) return;
    const deltas = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const existing = assetLayerEdits.get(asset.id)?.get(layerNumber);
    const offsetX = (existing?.offsetX || 0) + delta[0] * step;
    const offsetY = (existing?.offsetY || 0) + delta[1] * step;
    moveSelectedLayer(layerNumber, offsetX, offsetY);
  };

  const onPointerOver = (event) => {
    const idx = getGraphics().indexOf(event.target);
    if (idx === -1) return;
    layersController.setHoveredLayer(idx + 1);
  };
  const onPointerOut = (event) => {
    const idx = getGraphics().indexOf(event.target);
    if (idx === -1) return;
    layersController.clearHoveredLayer(idx + 1);
  };

  const getUnitsPerPixel = () => {
    const svg = root.querySelector("svg");
    const viewBox = svg?.viewBox?.baseVal;
    const bounds = svg?.getBoundingClientRect();
    return {
      x: viewBox && bounds?.width ? viewBox.width / bounds.width : 1,
      y: viewBox && bounds?.height ? viewBox.height / bounds.height : 1
    };
  };

  // Alignment guides: while dragging/resizing, the moving element's screen
  // edges/centers are compared against every other element's edges/centers
  // (plus the artboard/svg bounds) and snapped when within GUIDE_SNAP_PX,
  // with a cyan guide line drawn at the matched position. Comparisons and
  // snapping happen in screen space (getBoundingClientRect, relative to
  // previewContainer) since that's the space users visually align in; the
  // resulting pixel correction is converted back to local SVG units via
  // unitsPerPixel before being written into the edit.
  const GUIDE_SNAP_PX = 6;

  const clearGuides = () => {
    if (guides) {
      guides.replaceChildren();
      guides.hidden = true;
    }
  };

  const showGuide = (axis, screenPos) => {
    if (!guides) return;
    guides.hidden = false;
    const line = document.createElement("div");
    line.className = `asset-alignment-guide asset-alignment-guide--${axis}`;
    if (axis === "v") line.style.left = `${screenPos}px`;
    else line.style.top = `${screenPos}px`;
    guides.appendChild(line);
  };

  // Returns edge/center rects (relative to previewContainer) for the
  // artboard SVG and every graphic other than `excludeIndex`.
  const getAlignmentTargets = (excludeIndex) => {
    const containerRect = previewContainer.getBoundingClientRect();
    const toEdges = (rect) => ({
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      centerX: (rect.left + rect.right) / 2 - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      centerY: (rect.top + rect.bottom) / 2 - containerRect.top
    });
    const targets = [];
    const svg = root.querySelector("svg");
    if (svg) targets.push(toEdges(svg.getBoundingClientRect()));
    getGraphics().forEach((el, idx) => {
      if (idx === excludeIndex) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      targets.push(toEdges(rect));
    });
    return targets;
  };

  // Among `keys` (edge/center property names to test on the moving element),
  // finds the target whose same-named property is closest to the moving
  // element's value, within GUIDE_SNAP_PX. Same-type comparison only (left
  // aligns to left, center to center, etc.) keeps snap behavior predictable.
  const findAxisSnap = (activeEdges, keys, targets) => {
    let best = null;
    for (const key of keys) {
      const activeVal = activeEdges[key];
      for (const target of targets) {
        const delta = target[key] - activeVal;
        if (Math.abs(delta) <= GUIDE_SNAP_PX && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, screenPos: target[key], key };
        }
      }
    }
    return best;
  };

  const getElementEdges = (element) => {
    const containerRect = previewContainer.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      centerX: (rect.left + rect.right) / 2 - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top,
      centerY: (rect.top + rect.bottom) / 2 - containerRect.top
    };
  };

  let dragState = null;
  let resizeState = null;
  let rotateState = null;
  let pendingSelectInfo = null;

  const onHandlePointerDown = (event) => {
    const handleName = event.target?.dataset?.handle;
    if (!handleName) return;
    event.stopPropagation();
    event.preventDefault();
    const layerNumber = layersController.getSelectedLayer();
    if (layerNumber === null || layerNumber === undefined) return;
    const element = getGraphics()[layerNumber - 1];
    if (!element) return;
    if (handleName === "rotate") {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const existingRotation = assetLayerEdits.get(asset.id)?.get(layerNumber)?.rotation || 0;
      rotateState = {
        layerNumber,
        pointerId: event.pointerId,
        centerX,
        centerY,
        startAngleDeg: existingRotation,
        startPointerAngleDeg: Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI)
      };
      event.target.setPointerCapture?.(event.pointerId);
      return;
    }
    let nativeBBox;
    try { nativeBBox = element.getBBox(); } catch { return; }
    if (!nativeBBox) return;
    const unitsPerPixel = getUnitsPerPixel();
    const existingResize = assetLayerEdits.get(asset.id)?.get(layerNumber)?.resize;
    // The native box is captured fresh every drag (getBBox() ignores the
    // element's own transform, so this is always the untransformed geometry).
    // If a previous resize already exists, its stored current edges continue
    // to describe the effective (scaled) box relative to THIS native box - but
    // only if the native box hasn't changed shape since. Guard against that by
    // falling back to the fresh native box when there's no existing resize.
    const currentBox = existingResize ?? {
      left: nativeBBox.x,
      top: nativeBBox.y,
      right: nativeBBox.x + nativeBBox.width,
      bottom: nativeBBox.y + nativeBBox.height
    };
    resizeState = {
      layerNumber,
      pointerId: event.pointerId,
      handle: handleName,
      startX: event.clientX,
      startY: event.clientY,
      nativeBBox,
      currentBox,
      unitsPerPixel
    };
    event.target.setPointerCapture?.(event.pointerId);
  };

  const onPointerDown = (event) => {
    const graphics = getGraphics();
    const idx = graphics.indexOf(event.target);
    if (idx === -1) {
      // Clicked off the artboard's drawn elements (background/empty canvas area) — deselect.
      const selectedLayerNumber = layersController.getSelectedLayer();
      if (selectedLayerNumber !== null && selectedLayerNumber !== undefined) {
        layersController.selectLayer(selectedLayerNumber);
      }
      return;
    }
    const layerNumber = idx + 1;
    if (event.shiftKey) {
      // Shift-click toggles this element in/out of the multi-selection
      // without starting a drag, so a chain of shift-clicks just builds up
      // the selection rather than moving the last-clicked element.
      event.preventDefault();
      layersController.selectLayer(layerNumber, { additive: true });
      return;
    }
    const selectedLayerNumber = layersController.getSelectedLayer();
    if (layerNumber === selectedLayerNumber) {
      const { x: scaleX, y: scaleY } = getUnitsPerPixel();
      const existing = assetLayerEdits.get(asset.id)?.get(layerNumber);
      dragState = {
        layerNumber,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseOffsetX: existing?.offsetX || 0,
        baseOffsetY: existing?.offsetY || 0,
        scaleX,
        scaleY,
        moved: false
      };
      event.target.setPointerCapture?.(event.pointerId);
    } else {
      pendingSelectInfo = { layerNumber, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    }
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (rotateState && event.pointerId === rotateState.pointerId) {
      const { centerX, centerY, startAngleDeg, startPointerAngleDeg, layerNumber } = rotateState;
      const pointerAngleDeg = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
      let rotation = startAngleDeg + (pointerAngleDeg - startPointerAngleDeg);
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15; // snap to 15° increments
      updateAssetLayerEdits(asset.id, layerNumber, { rotation });
      applyAssetLayerEdits(root.querySelector("svg"), asset.id);
      updateTooltip(layerNumber);
      return;
    }
    if (resizeState && event.pointerId === resizeState.pointerId) {
      const { handle, nativeBBox, currentBox, unitsPerPixel, layerNumber, startX, startY } = resizeState;
      const dxLocal = (event.clientX - startX) * unitsPerPixel.x;
      const dyLocal = (event.clientY - startY) * unitsPerPixel.y;
      const minSize = 2;
      let { left, top, right, bottom } = currentBox;
      // Only the edges implicated by the dragged handle move; edges not being
      // dragged keep their previously stored value, so switching handles
      // between separate resize operations never disturbs the fixed side(s).
      if (handle.includes("e")) right = Math.max(left + minSize, right + dxLocal);
      if (handle.includes("w")) left = Math.min(right - minSize, left + dxLocal);
      if (handle.includes("s")) bottom = Math.max(top + minSize, bottom + dyLocal);
      if (handle.includes("n")) top = Math.min(bottom - minSize, top + dyLocal);
      if (event.shiftKey && nativeBBox.width > 0 && nativeBBox.height > 0) {
        // Lock the box to the element's native aspect ratio. Corner handles
        // already touch both axes, so whichever axis the pointer moved
        // further along drives the locked dimension, recomputed from the
        // fixed anchor edge implied by the handle. Edge handles only touch
        // one axis normally; with the ratio locked they also grow/shrink the
        // perpendicular axis, centered on the box's current midpoint since an
        // edge handle has no natural anchor on that axis.
        const nativeAspect = nativeBBox.width / nativeBBox.height;
        const touchesX = handle.includes("e") || handle.includes("w");
        const touchesY = handle.includes("n") || handle.includes("s");
        if (touchesX && touchesY) {
          const dominant = Math.abs(dxLocal) >= Math.abs(dyLocal) ? "x" : "y";
          if (dominant === "x") {
            const height = Math.max(minSize, (right - left) / nativeAspect);
            if (handle.includes("s")) bottom = top + height; else top = bottom - height;
          } else {
            const width = Math.max(minSize, (bottom - top) * nativeAspect);
            if (handle.includes("e")) right = left + width; else left = right - width;
          }
        } else if (touchesX) {
          const height = Math.max(minSize, (right - left) / nativeAspect);
          const centerY = (currentBox.top + currentBox.bottom) / 2;
          top = centerY - height / 2;
          bottom = centerY + height / 2;
        } else if (touchesY) {
          const width = Math.max(minSize, (bottom - top) * nativeAspect);
          const centerX = (currentBox.left + currentBox.right) / 2;
          left = centerX - width / 2;
          right = centerX + width / 2;
        }
      }
      const applyResize = (box) => {
        updateAssetLayerEdits(asset.id, layerNumber, {
          resize: {
            nativeLeft: nativeBBox.x,
            nativeTop: nativeBBox.y,
            nativeWidth: nativeBBox.width,
            nativeHeight: nativeBBox.height,
            ...box
          }
        });
        applyAssetLayerEdits(root.querySelector("svg"), asset.id);
      };
      applyResize({ left, top, right, bottom });
      // Snap whichever edges the dragged handle actually moves against the
      // edges/centers of other elements and the artboard; edges the handle
      // doesn't touch are left alone so the fixed anchor side never moves.
      clearGuides();
      if (!event.ctrlKey && !event.metaKey) {
        const element = getGraphics()[layerNumber - 1];
        if (element) {
          const targets = getAlignmentTargets(layerNumber - 1);
          const activeEdges = getElementEdges(element);
          let snappedX = false;
          let snappedY = false;
          if (handle.includes("e")) {
            const snap = findAxisSnap(activeEdges, ["right"], targets);
            if (snap) { right += snap.delta * unitsPerPixel.x; snappedX = true; showGuide("v", snap.screenPos); }
          } else if (handle.includes("w")) {
            const snap = findAxisSnap(activeEdges, ["left"], targets);
            if (snap) { left += snap.delta * unitsPerPixel.x; snappedX = true; showGuide("v", snap.screenPos); }
          }
          if (handle.includes("s")) {
            const snap = findAxisSnap(activeEdges, ["bottom"], targets);
            if (snap) { bottom += snap.delta * unitsPerPixel.y; snappedY = true; showGuide("h", snap.screenPos); }
          } else if (handle.includes("n")) {
            const snap = findAxisSnap(activeEdges, ["top"], targets);
            if (snap) { top += snap.delta * unitsPerPixel.y; snappedY = true; showGuide("h", snap.screenPos); }
          }
          if (snappedX || snappedY) applyResize({ left, top, right, bottom });
        }
      }
      updateTooltip(layerNumber);
      return;
    }
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 2) dragState.moved = true;
    let offsetX = dragState.baseOffsetX + dx * dragState.scaleX;
    let offsetY = dragState.baseOffsetY + dy * dragState.scaleY;
    updateAssetLayerEdits(asset.id, dragState.layerNumber, { offsetX, offsetY });
    applyAssetLayerEdits(root.querySelector("svg"), asset.id);
    // Snap the moving element's edges/centers to other elements and the
    // artboard on both axes independently, drawing a guide line per match.
    clearGuides();
    if (!event.ctrlKey && !event.metaKey) {
      const element = getGraphics()[dragState.layerNumber - 1];
      if (element) {
        const targets = getAlignmentTargets(dragState.layerNumber - 1);
        const activeEdges = getElementEdges(element);
        const xSnap = findAxisSnap(activeEdges, ["left", "right", "centerX"], targets);
        const ySnap = findAxisSnap(activeEdges, ["top", "bottom", "centerY"], targets);
        if (xSnap) { offsetX += xSnap.delta * dragState.scaleX; showGuide("v", xSnap.screenPos); }
        if (ySnap) { offsetY += ySnap.delta * dragState.scaleY; showGuide("h", ySnap.screenPos); }
        if (xSnap || ySnap) {
          updateAssetLayerEdits(asset.id, dragState.layerNumber, { offsetX, offsetY });
          applyAssetLayerEdits(root.querySelector("svg"), asset.id);
        }
      }
    }
    updateTooltip(dragState.layerNumber);
  };

  const onPointerUp = (event) => {
    if (resizeState && event.pointerId === resizeState.pointerId) {
      clearGuides();
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      clearGuides();
    }
    if (rotateState && event.pointerId === rotateState.pointerId) {
      rotateState = null;
      return;
    }
    if (resizeState && event.pointerId === resizeState.pointerId) {
      resizeState = null;
      return;
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      const { layerNumber, moved } = dragState;
      dragState = null;
      if (!moved) layersController.selectLayer(layerNumber);
      return;
    }
    if (pendingSelectInfo && event.pointerId === pendingSelectInfo.pointerId) {
      const { layerNumber, startX, startY } = pendingSelectInfo;
      pendingSelectInfo = null;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < 3) {
        layersController.selectLayer(layerNumber);
      }
    }
  };
  const onWindowResize = () => {
    const layerNumber = layersController.getSelectedLayer();
    if (layerNumber !== null && layerNumber !== undefined) updateTooltip(layerNumber);
  };

  window.addEventListener("keydown", onKeydown);
  previewContainer.addEventListener("pointerdown", onPointerDown);
  handles?.addEventListener("pointerdown", onHandlePointerDown);
  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onWindowResize);

  return {
    updateTooltip,
    cleanup: () => {
      window.removeEventListener("keydown", onKeydown);
      previewContainer.removeEventListener("pointerdown", onPointerDown);
      handles?.removeEventListener("pointerdown", onHandlePointerDown);
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("resize", onWindowResize);
      if (tooltip) tooltip.hidden = true;
      if (handles) handles.hidden = true;
      clearGuides();
    }
  };
}

function createSteppedNumberField({ value, step, ariaLabel, onChange }) {
  const field = document.createElement("span");
  field.className = "asset-layer-attr-field";
  const input = document.createElement("input");
  input.type = "number";
  input.step = step;
  input.value = value;
  input.className = "asset-layer-attr-input";
  input.setAttribute("aria-label", ariaLabel);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => event.stopPropagation());
  const commit = (next) => {
    input.value = String(next);
    onChange(next);
  };
  input.addEventListener("input", () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onChange(next);
  });
  const stepAmount = Number(step) || 1;
  const steppers = document.createElement("span");
  steppers.className = "asset-layer-attr-steppers";
  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "asset-layer-attr-step asset-layer-attr-step--up";
  upButton.setAttribute("aria-label", `Increase ${ariaLabel}`);
  upButton.innerHTML = '<i data-lucide="chevron-up" aria-hidden="true"></i>';
  upButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = Number(input.value);
    commit((Number.isFinite(current) ? current : 0) + stepAmount);
  });
  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.className = "asset-layer-attr-step asset-layer-attr-step--down";
  downButton.setAttribute("aria-label", `Decrease ${ariaLabel}`);
  downButton.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
  downButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = Number(input.value);
    commit((Number.isFinite(current) ? current : 0) - stepAmount);
  });
  steppers.append(upButton, downButton);
  field.append(input, steppers);
  return { field, input };
}

function renderAssetColorList(root, asset, onHighlight) {
  root.textContent = "Loading...";
  root.dataset.assetId = asset.id;

  loadAssetColors(asset.source).then((colors) => {
    if (!root.isConnected || root.dataset.assetId !== asset.id) return;
    root.textContent = "";
    if (!colors.length) {
      root.textContent = "No explicit colors";
      return;
    }
    for (const color of colors) {
      const item = document.createElement("span");
      item.className = "asset-color";
      item.setAttribute("aria-label", color);
      if (onHighlight) {
        let hovered = false;
        let focused = false;
        const syncHighlight = () => {
          const active = hovered || focused;
          item.classList.toggle("is-active", active);
          onHighlight(color, active);
        };
        item.tabIndex = 0;
        item.addEventListener("mouseenter", () => { hovered = true; syncHighlight(); });
        item.addEventListener("mouseleave", () => { hovered = false; syncHighlight(); });
        item.addEventListener("focus", () => { focused = true; syncHighlight(); });
        item.addEventListener("blur", () => { focused = false; syncHighlight(); });
      }
      const swatch = document.createElement("span");
      swatch.className = "asset-color-swatch";
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-hidden", "true");
      item.dataset.tooltip = color;
      item.appendChild(swatch);
      root.appendChild(item);
    }
  }).catch(() => {
    if (root.isConnected && root.dataset.assetId === asset.id) root.textContent = "Colors unavailable";
  });
}

function renderStaticAssetColorList(root, colors, emptyMessage) {
  root.textContent = "";
  if (!colors.length) {
    if (emptyMessage) root.textContent = emptyMessage;
    return;
  }
  for (const color of colors) {
    const item = document.createElement("span");
    item.className = "asset-color";
    item.setAttribute("aria-label", color);
    item.dataset.tooltip = color;
    const swatch = document.createElement("span");
    swatch.className = "asset-color-swatch";
    swatch.style.backgroundColor = color;
    swatch.setAttribute("aria-hidden", "true");
    item.appendChild(swatch);
    root.appendChild(item);
  }
}

function renderAssetDiagnostics(root, asset) {
  root.textContent = "Loading...";
  root.dataset.assetId = asset.id;

  loadAssetSvgData(asset.source).then((data) => {
    if (!root.isConnected || root.dataset.assetId !== asset.id) return;
    root.textContent = "";
    const diagnostics = [
      ["ViewBox", data.viewBox],
      ["Source size", `${data.width} × ${data.height}`],
      ["Elements", `${data.paintLayerCount} primitives`],
      ["Element order", "DOM order, bottom → top"],
      ["Topmost element", data.topmostLayer],
      ["Paths", `${data.pathCount} (${data.closedPathCount} closed, ${data.pathCount - data.closedPathCount} open)`],
      ["Path subpaths", String(data.pathSubpathCount)],
      ["Path commands", String(data.pathCommandCount)],
      ["Groups", data.groupCount ? `${data.groupCount} (max depth ${data.maxGroupDepth})` : "None"],
      ["Effects", data.effects],
      ["File size", data.byteSize < 1024 ? `${data.byteSize} B` : `${(data.byteSize / 1024).toFixed(1)} KB`],
      ["Accessible title", data.accessibleName],
      ["Description", data.description]
    ];
    for (const [label, value] of diagnostics) {
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = value;
      root.appendChild(term);
      root.appendChild(description);
    }
  }).catch(() => {
    if (root.isConnected && root.dataset.assetId === asset.id) root.textContent = "Diagnostics unavailable";
  });
}

function assetLayerSelection(assetId) {
  if (!assetLayerSelections.has(assetId)) assetLayerSelections.set(assetId, new Set());
  return assetLayerSelections.get(assetId);
}

function renderAssetLayerActions(actionsBar, data, onCombine, onClear, onAdd) {
  actionsBar.replaceChildren();
  actionsBar.hidden = false;

  const addGroup = document.createElement("div");
  addGroup.className = "asset-layer-add-group";

  const shapeSelect = document.createElement("select");
  shapeSelect.className = "asset-layer-add-shape";
  shapeSelect.setAttribute("aria-label", "New element shape");
  for (const { value, label } of NEW_ELEMENT_SHAPES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    shapeSelect.appendChild(option);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "asset-layer-add-button";
  addButton.title = "Add a new element at the topmost layer";
  addButton.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i><span>Add element</span>';
  addButton.addEventListener("click", () => onAdd(shapeSelect.value));

  addGroup.append(shapeSelect, addButton);

  const combineGroup = document.createElement("div");
  combineGroup.className = "asset-layer-combine-group";
  combineGroup.hidden = data.paintLayerCount < 2;

  const status = document.createElement("p");
  status.className = "asset-layer-actions-status";
  status.setAttribute("aria-live", "polite");

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "asset-layer-actions-clear";
  clearButton.textContent = "Clear";
  clearButton.title = "Clear element selection";
  clearButton.hidden = true;
  clearButton.addEventListener("click", onClear);

  const combineButton = document.createElement("button");
  combineButton.type = "button";
  combineButton.className = "asset-layer-combine-button";
  combineButton.disabled = true;
  combineButton.title = "Wrap the selected elements in a group";
  combineButton.innerHTML = '<i data-lucide="layers" aria-hidden="true"></i><span>Combine elements</span>';
  combineButton.addEventListener("click", onCombine);

  combineGroup.append(status, clearButton, combineButton);
  actionsBar.append(addGroup, combineGroup);
  return { status, combineButton, clearButton, shapeSelect };
}

function renderAssetLayers(root, editorPanel, actionsBar, asset, onHighlight, onEdit, onSelect, onMultiSelectChange) {
  root.textContent = "Loading...";
  root.dataset.assetId = asset.id;
  editorPanel.hidden = true;
  editorPanel.replaceChildren();
  actionsBar.hidden = true;
  actionsBar.replaceChildren();

  // Populated once asset data loads; exposes hover/selection sync methods so
  // the primary preview canvas can stay in sync with this elements list.
  const controller = {
    setHoveredLayer: () => {},
    clearHoveredLayer: () => {},
    selectLayer: () => {},
    getSelectedLayer: () => null
  };

  loadAssetSvgData(asset.source).then((data) => {
    if (!root.isConnected || root.dataset.assetId !== asset.id) return;
    root.textContent = "";
    const pendingSelection = assetPendingElementSelection.get(asset.id);
    if (pendingSelection !== undefined) assetPendingElementSelection.delete(asset.id);
    let selectedLayerNumber = pendingSelection ?? null;
    // Elements shift-clicked together (canvas or panel row) so multiple can be
    // moved/inspected as a group. Distinct from the checkbox-driven `selection`
    // Set below, which only tracks candidates for the "combine into group"
    // action - keeping the two decoupled means shift-clicking to multi-select
    // never clobbers an in-progress combine checkbox selection, and vice versa.
    let multiSelection = new Set(selectedLayerNumber !== null ? [selectedLayerNumber] : []);
    onSelect?.(selectedLayerNumber);
    onMultiSelectChange?.([...multiSelection]);
    let hoveredLayerNumber = null;
    let focusedLayerNumber = null;
    const layerItems = new Map();
    const layerButtons = new Map();
    const layerCheckboxes = new Map();
    const layerEdits = assetLayerEdits.get(asset.id) || new Map();
    const selection = assetLayerSelection(asset.id);
    for (const layerNumber of [...selection]) {
      if (layerNumber > data.paintLayerCount) selection.delete(layerNumber);
    }
    const addElement = (shape, container) => {
      createAssetElement(asset, shape, container, (newNumber) => {
        if (newNumber) assetPendingElementSelection.set(asset.id, newNumber);
        showToast(`Added a new ${shape} element.`);
        renderAssetDetail(asset.id);
      });
    };
    const { status: combineStatus, combineButton, clearButton } = renderAssetLayerActions(actionsBar, data, () => {
      const combining = [...selection];
      combineAssetLayers(asset, combining, (combinedNumbers) => {
        selection.clear();
        if (combinedNumbers?.length) assetPendingGroupFocus.set(asset.id, new Set(combinedNumbers));
        showToast(`Combined ${combinedNumbers.length || combining.length} elements into a group.`);
        renderAssetDetail(asset.id);
      });
    }, () => {
      selection.clear();
      syncSelection();
    }, (shape) => addElement(shape, data.svg));
    function syncSelection() {
      for (const [layerNumber, item] of layerItems) {
        const isSelected = selection.has(layerNumber);
        item.classList.toggle("is-multi-selected", isSelected);
        const checkbox = layerCheckboxes.get(layerNumber);
        if (checkbox) checkbox.checked = isSelected;
      }
      combineButton.disabled = selection.size < 2;
      clearButton.hidden = selection.size === 0;
      combineStatus.textContent = selection.size < 2
        ? `Select 2 or more elements to combine.${selection.size ? " 1 selected." : ""}`
        : `${selection.size} elements selected.`;
    }
    const syncHighlight = () => {
      const highlightedLayerNumber = hoveredLayerNumber ?? focusedLayerNumber ?? selectedLayerNumber;
      for (const [layerNumber, item] of layerItems) {
        item.classList.toggle("is-active", layerNumber === highlightedLayerNumber);
        item.classList.toggle("is-selected", multiSelection.has(layerNumber));
        layerButtons.get(layerNumber)?.setAttribute("aria-pressed", String(multiSelection.has(layerNumber)));
      }
      onHighlight(highlightedLayerNumber, highlightedLayerNumber !== null);
    };
    // `options.additive` (shift-click) adds/removes a layer from the
    // multi-selection without disturbing the rest of it; a plain click
    // replaces the whole multi-selection with just the toggled layer (or
    // clears it, matching the pre-existing single-select toggle behavior).
    const selectLayer = (layerNumber, options = {}) => {
      if (options.additive) {
        if (multiSelection.has(layerNumber)) {
          multiSelection.delete(layerNumber);
          if (selectedLayerNumber === layerNumber) {
            const remaining = [...multiSelection];
            selectedLayerNumber = remaining.length ? remaining[remaining.length - 1] : null;
          }
        } else {
          multiSelection.add(layerNumber);
          selectedLayerNumber = layerNumber;
        }
      } else {
        selectedLayerNumber = selectedLayerNumber === layerNumber ? null : layerNumber;
        multiSelection = new Set(selectedLayerNumber !== null ? [selectedLayerNumber] : []);
      }
      onSelect?.(selectedLayerNumber);
      onMultiSelectChange?.([...multiSelection]);
      syncHighlight();
    };
    controller.setHoveredLayer = (layerNumber) => { hoveredLayerNumber = layerNumber; syncHighlight(); };
    controller.clearHoveredLayer = (layerNumber) => {
      if (hoveredLayerNumber === layerNumber) hoveredLayerNumber = null;
      syncHighlight();
    };
    controller.selectLayer = selectLayer;
    controller.getSelectedLayer = () => selectedLayerNumber;
    const layerByNumber = new Map(data.paintLayers.map((entry) => [entry.number, entry]));
    function renderElementRow(layer) {
      const item = document.createElement("li");
      item.value = layer.number;
      let toggleSelection;
      if (onHighlight) {
        item.addEventListener("mouseenter", () => { hoveredLayerNumber = layer.number; syncHighlight(); });
        item.addEventListener("mouseleave", () => {
          if (hoveredLayerNumber === layer.number) hoveredLayerNumber = null;
          syncHighlight();
        });
        toggleSelection = (event) => selectLayer(layer.number, { additive: event?.shiftKey });
        item.addEventListener("click", toggleSelection);
      }
      const number = document.createElement(onHighlight ? "button" : "span");
      number.className = "asset-layer-number";
      number.textContent = String(layer.number);
      if (onHighlight) {
        number.type = "button";
        number.setAttribute("aria-label", `Select element ${layer.number}`);
        number.setAttribute("aria-pressed", "false");
        number.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleSelection();
        });
        number.addEventListener("focus", () => { focusedLayerNumber = layer.number; syncHighlight(); });
        number.addEventListener("blur", () => {
          if (focusedLayerNumber === layer.number) focusedLayerNumber = null;
          syncHighlight();
        });
      }
      const selectLabel = document.createElement("label");
      selectLabel.className = "asset-layer-select";
      const selectCheckbox = document.createElement("input");
      selectCheckbox.type = "checkbox";
      selectCheckbox.className = "asset-layer-select-input";
      selectCheckbox.checked = selection.has(layer.number);
      selectCheckbox.setAttribute("aria-label", `Select element ${layer.number} for combining`);
      selectLabel.title = `Select element ${layer.number} for combining`;
      selectLabel.addEventListener("click", (event) => event.stopPropagation());
      selectCheckbox.addEventListener("click", (event) => event.stopPropagation());
      selectCheckbox.addEventListener("change", () => {
        if (selectCheckbox.checked) selection.add(layer.number);
        else selection.delete(layer.number);
        syncSelection();
      });
      // Keep row drag-and-drop from hijacking checkbox interaction.
      const restoreDraggable = () => { item.draggable = true; };
      selectLabel.addEventListener("pointerdown", () => { item.draggable = false; });
      selectLabel.addEventListener("pointerup", restoreDraggable);
      selectLabel.addEventListener("pointercancel", restoreDraggable);
      item.addEventListener("mouseleave", restoreDraggable);
      selectLabel.appendChild(selectCheckbox);

      const identity = document.createElement("div");
      identity.className = "asset-layer-identity";
      const elementName = document.createElement("code");
      elementName.textContent = layer.element;
      identity.appendChild(elementName);
      if (layer.id) {
        const id = document.createElement("code");
        id.textContent = `#${layer.id}`;
        identity.appendChild(id);
      }

      const reorder = document.createElement("span");
      reorder.className = "asset-layer-reorder";
      const moveUpButton = document.createElement("button");
      moveUpButton.type = "button";
      moveUpButton.className = "asset-layer-reorder-button";
      moveUpButton.setAttribute("aria-label", `Move element ${layer.number} up`);
      moveUpButton.innerHTML = '<i data-lucide="chevron-up" aria-hidden="true"></i>';
      moveUpButton.disabled = layer.number >= data.paintLayerCount;
      moveUpButton.addEventListener("click", (event) => {
        event.stopPropagation();
        reorderAssetLayer(asset, layer.number, layer.number + 1, () => renderAssetDetail(asset.id));
      });
      const moveDownButton = document.createElement("button");
      moveDownButton.type = "button";
      moveDownButton.className = "asset-layer-reorder-button";
      moveDownButton.setAttribute("aria-label", `Move element ${layer.number} down`);
      moveDownButton.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';
      moveDownButton.disabled = layer.number <= 1;
      moveDownButton.addEventListener("click", (event) => {
        event.stopPropagation();
        reorderAssetLayer(asset, layer.number, layer.number - 1, () => renderAssetDetail(asset.id));
      });
      reorder.append(moveUpButton, moveDownButton);

      item.draggable = true;
      item.classList.add("asset-layer-draggable");
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", String(layer.number));
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
        for (const otherItem of layerItems.values()) otherItem.classList.remove("is-drag-over");
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        item.classList.add("is-drag-over");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("is-drag-over");
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("is-drag-over");
        const sourceNumber = Number(event.dataTransfer.getData("text/plain"));
        if (!Number.isFinite(sourceNumber) || sourceNumber === layer.number) return;
        reorderAssetLayer(asset, sourceNumber, layer.number, () => renderAssetDetail(asset.id));
      });

      const details = document.createElement("div");
      details.className = "asset-layer-details";
      const paints = document.createElement("div");
      paints.className = "asset-layer-paints";
      const positionPopover = (popover, trigger) => {
        if (!popover.matches(":popover-open")) popover.showPopover();
        const triggerBounds = trigger.getBoundingClientRect();
        const popoverBounds = popover.getBoundingClientRect();
        popover.style.top = `${Math.min(triggerBounds.bottom + 6, window.innerHeight - popoverBounds.height - 8)}px`;
        popover.style.left = `${Math.max(8, Math.min(triggerBounds.left, window.innerWidth - popoverBounds.width - 8))}px`;
      };
      const currentEdits = layerEdits.get(layer.number) || { paints: {}, attrs: {} };
      let firstColorInput = null;
      const colorInputsByProperty = new Map();
      const registerColorInput = (property, input, onSync) => {
        if (!colorInputsByProperty.has(property)) colorInputsByProperty.set(property, []);
        colorInputsByProperty.get(property).push({ input, onSync });
      };
      const syncColorInputs = (property, nextValue, sourceInput) => {
        for (const entry of colorInputsByProperty.get(property) || []) {
          if (entry.input !== sourceInput) entry.input.value = nextValue;
          entry.onSync?.(nextValue);
        }
      };
      for (const [property, value] of layer.paints) {
        const editedValue = currentEdits.paints[property] || value;
        const paint = document.createElement("span");
        paint.className = "asset-layer-paint";
        const color = normalizeSvgColor(editedValue);
        const label = document.createElement("code");
        label.textContent = color ? property : `${property} ${editedValue}`;
        paint.appendChild(label);
        if (color) {
          const colorInput = document.createElement("input");
          colorInput.className = "asset-layer-color-input";
          colorInput.type = "color";
          colorInput.id = `asset-layer-color-input-${asset.id}-${layer.number}-${property}`;
          colorInput.value = color;
          colorInput.setAttribute("aria-label", `Element ${layer.number} ${property} color`);
          colorInput.addEventListener("click", (event) => event.stopPropagation());
          colorInput.addEventListener("keydown", (event) => event.stopPropagation());
          colorInput.addEventListener("input", () => {
            const nextValue = colorInput.value.toUpperCase();
            updateAssetLayerEdits(asset.id, layer.number, { paints: { [property]: nextValue } });
            label.textContent = property;
            syncColorInputs(property, nextValue, colorInput);
            onEdit?.(layer.number, assetLayerEdits.get(asset.id).get(layer.number));
          });
          paint.appendChild(colorInput);
          registerColorInput(property, colorInput);
          if (!firstColorInput) firstColorInput = colorInput;
        }
        paints.appendChild(paint);
      }
      const opacityEditor = document.createElement("div");
      opacityEditor.className = "asset-layer-editor asset-layer-opacity-editor";
      opacityEditor.id = `asset-layer-opacity-editor-${asset.id}-${layer.number}`;
      opacityEditor.setAttribute("popover", "auto");
      opacityEditor.setAttribute("role", "dialog");
      opacityEditor.setAttribute("aria-label", `Edit element ${layer.number} opacity`);
      const opacityControl = document.createElement("label");
      opacityControl.className = "asset-layer-opacity-control";
      opacityControl.textContent = "Opacity";
      const decrement = document.createElement("button");
      decrement.type = "button";
      decrement.className = "asset-layer-opacity-step";
      decrement.setAttribute("aria-label", "Decrease opacity");
      decrement.innerHTML = '<i data-lucide="minus" aria-hidden="true"></i>';
      const opacitySlider = document.createElement("input");
      opacitySlider.type = "range";
      opacitySlider.min = "0";
      opacitySlider.max = "1";
      opacitySlider.step = "0.01";
      const opacityInput = document.createElement("input");
      opacityInput.type = "number";
      opacityInput.min = "0";
      opacityInput.max = "1";
      opacityInput.step = "0.01";
      opacityInput.value = String(currentEdits.opacity ?? (layer.opacity === "" ? 1 : Number(layer.opacity)));
      opacitySlider.value = opacityInput.value;
      opacityInput.setAttribute("aria-label", `Element ${layer.number} opacity`);
      opacityInput.addEventListener("click", (event) => event.stopPropagation());
      opacityInput.addEventListener("keydown", (event) => event.stopPropagation());
      let attrOpacityInput = null;
      const setOpacity = (value) => {
        const nextOpacity = Number(value);
        if (!Number.isFinite(nextOpacity) || nextOpacity < 0 || nextOpacity > 1) return;
        opacityInput.value = String(nextOpacity);
        opacitySlider.value = String(nextOpacity);
        if (attrOpacityInput) attrOpacityInput.value = String(nextOpacity);
        updateAssetLayerEdits(asset.id, layer.number, { opacity: nextOpacity });
        opacityValue.lastChild.textContent = String(nextOpacity);
        onEdit?.(layer.number, assetLayerEdits.get(asset.id).get(layer.number));
      };
      opacityInput.addEventListener("input", () => setOpacity(opacityInput.value));
      opacitySlider.addEventListener("input", () => setOpacity(opacitySlider.value));
      decrement.addEventListener("click", () => setOpacity(Math.max(0, Number(opacityInput.value) - 0.01)));
      const increment = document.createElement("button");
      increment.type = "button";
      increment.className = "asset-layer-opacity-step";
      increment.setAttribute("aria-label", "Increase opacity");
      increment.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i>';
      increment.addEventListener("click", () => setOpacity(Math.min(1, Number(opacityInput.value) + 0.01)));
      opacityControl.append(decrement, opacitySlider, opacityInput, increment);
      opacityEditor.appendChild(opacityControl);
      const opacityValue = document.createElement("button");
      opacityValue.type = "button";
      opacityValue.className = "asset-layer-opacity-value";
      opacityValue.setAttribute("aria-label", `Edit element ${layer.number} opacity`);
      opacityValue.setAttribute("aria-controls", opacityEditor.id);
      opacityValue.setAttribute("aria-expanded", "false");
      opacityValue.title = "Edit opacity";
      opacityValue.innerHTML = `<i data-lucide="circle-gauge" aria-hidden="true"></i><span>${opacityInput.value}</span>`;
      opacityValue.addEventListener("click", (event) => {
        event.stopPropagation();
        positionPopover(opacityEditor, opacityValue);
      });
      opacityEditor.addEventListener("toggle", () => opacityValue.setAttribute("aria-expanded", String(opacityEditor.matches(":popover-open"))));
      const layerEditor = document.createElement("div");
      layerEditor.className = "asset-layer-editor asset-layer-edit-mode";
      layerEditor.id = `asset-layer-edit-mode-${asset.id}-${layer.number}`;
      const editorHeader = document.createElement("div");
      editorHeader.className = "asset-layer-edit-mode-header";
      const editorTitle = document.createElement("strong");
      editorTitle.textContent = `Element ${layer.number}`;
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "asset-layer-editor-close";
      closeButton.setAttribute("aria-label", "Close element editor");
      closeButton.title = "Close element editor";
      closeButton.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      editorHeader.append(editorTitle, closeButton);
      const moveControls = document.createElement("div");
      moveControls.className = "asset-layer-move-controls";
      const xInput = document.createElement("input");
      xInput.type = "number";
      xInput.step = "1";
      xInput.value = String(currentEdits.offsetX || 0);
      xInput.setAttribute("aria-label", `Element ${layer.number} horizontal offset`);
      const yInput = document.createElement("input");
      yInput.type = "number";
      yInput.step = "1";
      yInput.value = String(currentEdits.offsetY || 0);
      yInput.setAttribute("aria-label", `Element ${layer.number} vertical offset`);
      const setPosition = (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        xInput.value = String(x);
        yInput.value = String(y);
        updateAssetLayerEdits(asset.id, layer.number, { offsetX: x, offsetY: y });
        onEdit?.(layer.number, assetLayerEdits.get(asset.id).get(layer.number));
      };
      xInput.addEventListener("input", () => setPosition(Number(xInput.value), Number(yInput.value)));
      yInput.addEventListener("input", () => setPosition(Number(xInput.value), Number(yInput.value)));
      const createNudgeButton = (direction, icon, xDelta, yDelta) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `asset-layer-nudge-button asset-layer-nudge-button--${direction}`;
        button.setAttribute("aria-label", `Move element ${direction}`);
        button.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i>`;
        button.addEventListener("click", () => setPosition(Number(xInput.value) + xDelta, Number(yInput.value) + yDelta));
        return button;
      };
      const moveHeading = document.createElement("span");
      moveHeading.textContent = "Position";
      const xLabel = document.createElement("label");
      xLabel.className = "asset-layer-position-input asset-layer-position-input--x";
      xLabel.textContent = "X";
      xLabel.appendChild(xInput);
      const yLabel = document.createElement("label");
      yLabel.className = "asset-layer-position-input asset-layer-position-input--y";
      yLabel.textContent = "Y";
      yLabel.appendChild(yInput);
      const positionInputs = document.createElement("div");
      positionInputs.className = "asset-layer-position-inputs";
      positionInputs.append(xLabel, yLabel);
      moveControls.append(
        moveHeading,
        createNudgeButton("up", "arrow-up", 0, -1),
        createNudgeButton("left", "arrow-left", -1, 0),
        positionInputs,
        createNudgeButton("right", "arrow-right", 1, 0),
        createNudgeButton("down", "arrow-down", 0, 1)
      );
      const attributes = document.createElement("dl");
      attributes.className = "asset-layer-attributes";
      const currentAttrs = currentEdits.attrs || {};
      for (const [name, value] of layer.attributes) {
        const term = document.createElement("dt");
        term.textContent = name;
        const description = document.createElement("dd");
        const isColorAttr = name === "fill" || name === "stroke";
        const normalizedColor = isColorAttr ? normalizeSvgColor(currentEdits.paints[name] ?? value) : "";
        if (normalizedColor) {
          const field = document.createElement("span");
          field.className = "asset-layer-attr-color-field";
          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.className = "asset-layer-color-input";
          colorInput.value = normalizedColor;
          colorInput.setAttribute("aria-label", `Element ${layer.number} ${name} color`);
          colorInput.addEventListener("click", (event) => event.stopPropagation());
          colorInput.addEventListener("keydown", (event) => event.stopPropagation());
          const valueText = document.createElement("code");
          valueText.textContent = normalizedColor;
          colorInput.addEventListener("input", () => {
            const nextValue = colorInput.value.toUpperCase();
            updateAssetLayerEdits(asset.id, layer.number, { paints: { [name]: nextValue } });
            valueText.textContent = nextValue;
            syncColorInputs(name, nextValue, colorInput);
            onEdit?.(layer.number, assetLayerEdits.get(asset.id).get(layer.number));
          });
          registerColorInput(name, colorInput, (nextValue) => { valueText.textContent = nextValue; });
          field.append(colorInput, valueText);
          description.appendChild(field);
        } else if (name === "opacity") {
          const initialOpacity = currentEdits.opacity ?? (value === "" ? 1 : Number(value));
          const { field, input } = createSteppedNumberField({
            value: String(initialOpacity),
            step: "0.01",
            ariaLabel: `Element ${layer.number} opacity`,
            onChange: (next) => setOpacity(Math.min(1, Math.max(0, next)))
          });
          attrOpacityInput = input;
          description.appendChild(field);
        } else if (value !== "" && Number.isFinite(Number(value))) {
          const step = value.includes(".") ? "0.01" : "1";
          const { field } = createSteppedNumberField({
            value: currentAttrs[name] ?? value,
            step,
            ariaLabel: `Element ${layer.number} ${name}`,
            onChange: (next) => {
              updateAssetLayerEdits(asset.id, layer.number, { attrs: { [name]: String(next) } });
              onEdit?.(layer.number, assetLayerEdits.get(asset.id).get(layer.number));
            }
          });
          description.appendChild(field);
        } else {
          description.textContent = value;
        }
        attributes.append(term, description);
      }
      layerEditor.append(editorHeader, moveControls, attributes);
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "asset-layer-edit-button";
      editButton.setAttribute("aria-label", `Edit element ${layer.number}`);
      editButton.setAttribute("aria-controls", layerEditor.id);
      editButton.setAttribute("aria-expanded", "false");
      editButton.title = `Edit element ${layer.number}`;
      editButton.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        root.hidden = true;
        editorPanel.replaceChildren(layerEditor);
        editorPanel.hidden = false;
        editButton.setAttribute("aria-expanded", "true");
        if (typeof lucide !== "undefined") lucide.createIcons();
        editorPanel.scrollIntoView({ block: "nearest" });
        closeButton.focus();
      });
      closeButton.addEventListener("click", () => {
        editorPanel.hidden = true;
        editorPanel.replaceChildren();
        root.hidden = false;
        editButton.setAttribute("aria-expanded", "false");
        editButton.focus();
      });
      details.appendChild(paints);
      details.append(opacityValue, editButton, opacityEditor);
      item.appendChild(selectLabel);
      item.appendChild(number);
      item.appendChild(reorder);
      item.appendChild(identity);
      item.appendChild(details);
      layerItems.set(layer.number, item);
      layerCheckboxes.set(layer.number, selectCheckbox);
      if (onHighlight) layerButtons.set(layer.number, number);
      return item;
    }

    function renderElementNodes(nodes, container) {
      for (const node of [...nodes].reverse()) {
        if (node.type === "group") {
          const groupItem = document.createElement("li");
          groupItem.className = "asset-element-group";
          const header = document.createElement("div");
          header.className = "asset-element-group-header";
          const tag = document.createElement("code");
          tag.textContent = "<g>";
          header.appendChild(tag);
          const nameInput = document.createElement("input");
          nameInput.type = "text";
          nameInput.className = "asset-element-group-name";
          nameInput.value = node.element.getAttribute("id") || "";
          nameInput.placeholder = "Unnamed group";
          nameInput.setAttribute("aria-label", "Group name");
          nameInput.title = "Group name (stored as this <g>'s id attribute)";
          nameInput.addEventListener("pointerdown", (event) => event.stopPropagation());
          nameInput.addEventListener("keydown", (event) => event.stopPropagation());
          nameInput.addEventListener("change", () => {
            const nextId = sanitizeSvgId(nameInput.value);
            if (nextId) node.element.setAttribute("id", nextId);
            else node.element.removeAttribute("id");
            nameInput.value = nextId;
          });
          header.appendChild(nameInput);
          const addToGroupButton = document.createElement("button");
          addToGroupButton.type = "button";
          addToGroupButton.className = "asset-element-group-add-button";
          addToGroupButton.title = "Add a new element inside this group";
          addToGroupButton.setAttribute("aria-label", "Add element to this group");
          addToGroupButton.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i>';
          addToGroupButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const shapeSelect = actionsBar.querySelector(".asset-layer-add-shape");
            addElement(shapeSelect?.value || "rect", node.element);
          });
          header.appendChild(addToGroupButton);
          const nestedList = document.createElement("ol");
          nestedList.className = "asset-element-group-children";
          renderElementNodes(node.children, nestedList);
          groupItem.append(header, nestedList);
          container.appendChild(groupItem);

          const pendingFocus = assetPendingGroupFocus.get(asset.id);
          if (pendingFocus) {
            const groupNumbers = collectElementNumbers(node);
            if (groupNumbers.length === pendingFocus.size && groupNumbers.every((number) => pendingFocus.has(number))) {
              assetPendingGroupFocus.delete(asset.id);
              setTimeout(() => {
                nameInput.focus();
                nameInput.select();
              }, 0);
            }
          }
        } else {
          const layer = layerByNumber.get(node.number);
          if (layer) container.appendChild(renderElementRow(layer));
        }
      }
    }
    renderElementNodes(buildElementTree(data.svg), root);
    syncSelection();
    if (selectedLayerNumber !== null) {
      syncHighlight();
      layerItems.get(selectedLayerNumber)?.scrollIntoView({ block: "nearest" });
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
  }).catch(() => {
    if (root.isConnected && root.dataset.assetId === asset.id) root.textContent = "Element information unavailable";
  });

  return controller;
}

function showToast(message) {
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

function renderActiveProjectPrompt() {
  const prompt = document.getElementById("project-sample-prompt");
  const count = document.getElementById("project-prompt-count");
  const previous = document.getElementById("project-prompt-previous");
  const next = document.getElementById("project-prompt-next");
  if (!prompt || !count || !previous || !next) return;

  prompt.textContent = projectSamplePrompts[activeProjectPromptIndex] || "";
  count.textContent = projectSamplePrompts.length
    ? `${activeProjectPromptIndex + 1} of ${projectSamplePrompts.length}`
    : "0 of 0";
  const hasMultiplePrompts = projectSamplePrompts.length > 1;
  previous.disabled = !hasMultiplePrompts;
  next.disabled = !hasMultiplePrompts;
}

function normalizeProjectPrompt(prompt, projectName, projectSlug) {
  const fields = `Project: ${projectName}\nDirectory: assets/svg/${projectSlug}/`;
  const content = String(prompt)
    .replace(/^Project:.*(?:\r?\n)?/gm, "")
    .replace(/^Directory:.*(?:\r?\n)?/gm, "")
    .trimEnd();
  return content ? `${content}\n\n${fields}` : fields;
}

const PROJECT_ICON_SLOTS = [
  { id: "favicon", label: "Favicon", usage: "Browser tabs and bookmarks" },
  { id: "appIcon", label: "App Icon", usage: "PWA launcher and app switchers" },
  { id: "logoMark", label: "Logo Mark", usage: "Compact nav and small brand surfaces" },
  { id: "wordmark", label: "Wordmark", usage: "Headers, login, and marketing bars" },
  { id: "socialPreview", label: "Social Preview", usage: "Open Graph and shared links" }
];

// Common icon targets used across web, desktop apps, iOS, and Android.
const COMMON_PREVIEW_SIZES = [
  16, 20, 24, 29, 32, 40, 48, 64, 72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512
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

function sourceRouteHref(projectName, sourcePath) {
  return `#source/${encodeURIComponent(projectName)}/${encodeURIComponent(sourcePath)}`;
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
    return { notes: [], sources: [], favoriteColors: [], customColors: [] };
  }

  const fromManifest = projectMeta.agentSteer;

  const notes = Array.isArray(fromManifest.notes) ? fromManifest.notes.map((item) => String(item).trim()).filter(Boolean) : [];
  const sources = Array.isArray(fromManifest.sources) ? fromManifest.sources : [];
  const favoriteColors = Array.isArray(fromManifest.favoriteColors)
    ? fromManifest.favoriteColors.map((color) => String(color).toUpperCase()).filter((color) => /^#[0-9A-F]{6}$/.test(color))
    : [];
  const customColors = Array.isArray(fromManifest.customColors)
    ? fromManifest.customColors.map((color) => String(color).toUpperCase()).filter((color) => /^#[0-9A-F]{6}$/.test(color))
    : [];
  return { notes, sources, favoriteColors, customColors };
}

async function updateProjectFavoriteColor(project, color, selected, custom = false) {
  const response = await fetch("/~project-color", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, color, selected, custom })
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "Favorite color update failed");
  return result;
}

function normalizeProjectSlots(projectName) {
  const projectMeta = projectMetaByName.get(projectName);
  const slotMap = projectMeta?.iconSlots && typeof projectMeta.iconSlots === "object"
    ? projectMeta.iconSlots
    : {};

  return PROJECT_ICON_SLOTS.map((slot) => {
    const configured = slotMap[slot.id] || {};
    return {
      ...slot,
      title: String(configured.title || slot.label),
      note: String(configured.note || "").trim(),
      assetId: String(configured.assetId || "").trim(),
      src: String(configured.src || "").trim(),
      url: String(configured.url || "").trim()
    };
  });
}

function resolveSlotPreview(slot) {
  if (slot.assetId) {
    const asset = assetById.get(slot.assetId);
    if (asset) {
      return {
        sourceType: "asset",
        src: resolveAssetPath(asset.source),
        label: asset.label,
        href: `#asset/${encodeURIComponent(asset.id)}`
      };
    }
  }

  if (slot.src) {
    return {
      sourceType: "src",
      src: resolveAssetPath(slot.src),
      label: slot.src,
      href: ""
    };
  }

  if (slot.url) {
    return {
      sourceType: "url",
      src: "",
      label: slot.url,
      href: slot.url
    };
  }

  return {
    sourceType: "empty",
    src: "",
    label: "",
    href: ""
  };
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

function buildProjectAssets(assets) {
  // Seed with all manifest projects so empty ones still render
  const byProject = new Map(
    Array.from(projectMetaByName.keys()).map((name) => [name, []])
  );
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

function uniqueSortedSizes(asset) {
  const variantSizes = (asset.variants ?? [])
    .map((variant) => Number(variant.size))
    .filter((value) => Number.isFinite(value));
  const allSizes = [...COMMON_PREVIEW_SIZES, ...variantSizes];
  return Array.from(new Set(allSizes)).sort((a, b) => a - b);
}

function setMainViewVisibility(route) {
  const logosSection = document.getElementById("logos");
  const diagramsSection = document.getElementById("diagrams");
  const assetDetailSection = document.getElementById("asset-detail");
  const sourceDetailSection = document.getElementById("source-detail");
  const projectDetailSection = document.getElementById("project-detail");
  if (!logosSection || !diagramsSection || !assetDetailSection || !sourceDetailSection || !projectDetailSection) return;

  const onAssetPage = route.page === "asset";
  const onSourcePage = route.page === "source";
  const onProjectPage = route.page === "project";
  const onDetailPage = onAssetPage || onSourcePage || onProjectPage;

  logosSection.classList.toggle("is-hidden", onDetailPage);
  diagramsSection.classList.toggle("is-hidden", onDetailPage);
  assetDetailSection.classList.toggle("is-hidden", !onAssetPage);
  sourceDetailSection.classList.toggle("is-hidden", !onSourcePage);
  projectDetailSection.classList.toggle("is-hidden", !onProjectPage);
}

function renderLogos(assets) {
  const groupsRoot = document.getElementById("logo-groups");
  if (!groupsRoot) return;

  groupsRoot.innerHTML = "";
  groupsRoot.classList.add("logo-groups--project");

  const groupedAssets = buildProjectAssets(assets);

  for (const [projectName, groupAssets] of groupedAssets) {
    const groupSection = document.createElement("section");
    groupSection.className = "logo-group";

    const header = document.createElement("div");
    header.className = "logo-group-header";

    const heading = document.createElement("h4");
    const titleLink = document.createElement("a");
    titleLink.className = "project-title-link";
    titleLink.href = projectRouteHref(projectName);
    titleLink.textContent = projectName;
    heading.appendChild(titleLink);

    const count = document.createElement("p");
    count.textContent = `${groupAssets.length} item${groupAssets.length === 1 ? "" : "s"}`;

    const grid = document.createElement("div");
    grid.className = "asset-grid";

    header.appendChild(heading);
    header.appendChild(count);
    groupSection.appendChild(header);

    const visibleAssets = [primaryProjectAsset(projectName, groupAssets)].filter(Boolean);

    if (visibleAssets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "project-empty-state";
      const emptyLink = document.createElement("a");
      emptyLink.href = projectRouteHref(projectName);
      emptyLink.className = "project-empty-cta";
      emptyLink.innerHTML = '<i data-lucide="image-plus" aria-hidden="true"></i><span>Add first asset</span>';
      empty.appendChild(emptyLink);
      groupSection.appendChild(empty);
    } else {
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

      const iconLink = document.createElement("a");
      iconLink.className = "project-icon-link";
      iconLink.href = projectRouteHref(projectName);
      iconLink.setAttribute("aria-label", `Open project page for ${projectName}`);
      iconLink.appendChild(img);
      frame.appendChild(iconLink);
      tile.prepend(frame);

      if (activeGroupingMode !== "project") {
        tile.appendChild(title);
        tile.appendChild(idText);
        tile.appendChild(detailLink);
      }
      grid.appendChild(tile);
    }
    groupSection.appendChild(grid);
    }

    groupsRoot.appendChild(groupSection);
  }
}

function renderAssetDetail(assetId) {
  const title = document.getElementById("asset-detail-title");
  const meta = document.getElementById("asset-detail-meta");
  const deepLink = document.getElementById("asset-deep-link");
  const projectLink = document.getElementById("asset-project-link");
  const overview = document.getElementById("asset-detail-overview");
  const primaryPreview = document.getElementById("asset-primary-preview");
  const primarySvg = document.getElementById("asset-primary-svg");
  const primaryTooltip = document.getElementById("asset-primary-tooltip");
  const primaryHandles = document.getElementById("asset-primary-handles");
  const primaryGuides = document.getElementById("asset-primary-guides");
  const colorsSection = document.getElementById("asset-detail-colors-section");
  const colorsList = document.getElementById("asset-detail-colors");
  const projectColorsList = document.getElementById("asset-project-colors");
  const customColorsList = document.getElementById("asset-custom-colors");
  const customColorForm = document.getElementById("asset-custom-color-form");
  const customColorInput = document.getElementById("asset-custom-color-input");
  const customColorAddButton = document.getElementById("asset-custom-color-add");
  const highlightStatus = document.getElementById("asset-color-highlight-status");
  const diagnostics = document.getElementById("asset-detail-diagnostics");
  const layersSection = document.getElementById("asset-detail-layers-section");
  const layersList = document.getElementById("asset-detail-layers");
  const layerEditorPanel = document.getElementById("asset-layer-editor-panel");
  const layerActions = document.getElementById("asset-layer-actions");
  const sizesSection = document.getElementById("asset-sizes-section");
  const sizeGrid = document.getElementById("asset-size-grid");
  if (!title || !meta || !deepLink || !projectLink || !overview || !primaryPreview || !primarySvg || !primaryTooltip || !primaryHandles || !primaryGuides || !colorsSection || !colorsList || !projectColorsList || !customColorsList || !customColorForm || !customColorInput || !customColorAddButton || !highlightStatus || !diagnostics || !layersSection || !layersList || !layerEditorPanel || !layerActions || !sizesSection || !sizeGrid) return;

  sizeGrid.innerHTML = "";
  colorsList.textContent = "";
  projectColorsList.textContent = "";
  customColorsList.textContent = "";
  highlightStatus.textContent = "";
  diagnostics.textContent = "";
  layersList.textContent = "";
  layerEditorPanel.hidden = true;
  layerEditorPanel.replaceChildren();
  layerActions.hidden = true;
  layerActions.replaceChildren();
  sizesSection.open = false;
  const asset = assetById.get(assetId);

  if (!asset) {
    activePrimaryLayerInteractionCleanup?.();
    activePrimaryLayerInteractionCleanup = null;
    title.textContent = "Asset not found";
    meta.textContent = `No logo or glyph exists for id: ${assetId}`;
    deepLink.href = window.location.href;
    projectLink.href = "#logos";
    projectLink.setAttribute("aria-label", "Back to all assets");
    projectLink.title = "Back to all assets";
    overview.hidden = true;
    layersSection.hidden = true;
    layerActions.hidden = true;
    sizesSection.hidden = true;
    return;
  }

  const projectName = projectForAsset(asset);
  title.textContent = asset.label;
  meta.textContent = `${asset.id} · ${asset.source} · ${projectName} · ${logoTypeForAsset(asset)}`;
  deepLink.href = window.location.href;
  deepLink.setAttribute("aria-label", `${asset.label} deep link`);
  projectLink.href = projectRouteHref(projectName);
  projectLink.setAttribute("aria-label", `Back to ${projectName}`);
  projectLink.title = `Back to ${projectName}`;
  overview.hidden = false;
  layersSection.hidden = false;
  sizesSection.hidden = false;
  renderAssetPrimarySvg(primarySvg, asset);
  activePrimaryLayerInteractionCleanup?.();
  const primaryInteractionState = { updateTooltip: () => {} };
  const layersController = renderAssetLayers(
    layersList,
    layerEditorPanel,
    layerActions,
    asset,
    (layerNumber, highlighted) => setPrimarySvgLayerHighlight(primarySvg, layerNumber, highlighted),
    () => applyAssetLayerEdits(primarySvg.querySelector("svg"), asset.id),
    (layerNumber) => primaryInteractionState.updateTooltip(layerNumber),
    (layerNumbers) => setPrimarySvgMultiSelectHighlight(primarySvg, layerNumbers)
  );
  const primaryInteraction = enablePrimaryLayerInteraction(primarySvg, primaryPreview, primaryTooltip, primaryHandles, primaryGuides, asset, layersController);
  primaryInteractionState.updateTooltip = primaryInteraction.updateTooltip;
  activePrimaryLayerInteractionCleanup = primaryInteraction.cleanup;
  renderAssetColorList(colorsList, asset, (color, highlighted) => {
    const regions = setPrimarySvgColorHighlight(primarySvg, color, highlighted);
    highlightStatus.textContent = highlighted && regions.length
      ? `${describeSvgRegions(regions)} highlighted for ${color}; ${describeSvgLayers(regions)}.`
      : "";
  });
  const projectPalette = normalizeProjectSteer(projectName).favoriteColors;
  renderStaticAssetColorList(projectColorsList, projectPalette, "No project favorites");
  const renderCustomColors = () => {
    renderStaticAssetColorList(customColorsList, assetCustomColors.get(asset.id) || []);
  };
  const addCustomColor = () => {
    const color = customColorInput.value.toUpperCase();
    const colors = assetCustomColors.get(asset.id) || [];
    if (!colors.includes(color)) assetCustomColors.set(asset.id, [...colors, color]);
    renderCustomColors();
  };
  renderCustomColors();
  customColorForm.onsubmit = (event) => event.preventDefault();
  customColorAddButton.onclick = () => {
    if (customColorInput.showPicker) customColorInput.showPicker();
    else customColorInput.click();
  };
  customColorInput.onchange = addCustomColor;
  renderAssetDiagnostics(diagnostics, asset);

  for (const size of uniqueSortedSizes(asset).filter((value) => value !== 512)) {
    const card = document.createElement("article");
    card.className = "size-preview-card";

    const displaySize = Math.min(size, 220);
    const frameSize = Math.max(displaySize + 32, 120);
    const frame = document.createElement("div");
    frame.className = "size-preview-frame";
    frame.style.setProperty("--frame-size", `${frameSize}px`);
    frame.style.setProperty("--img-size", `${displaySize}px`);

    const img = document.createElement("img");
    img.src = `../${asset.source}`;
    img.alt = `${asset.label} at ${size}px`;

    const caption = document.createElement("p");
    caption.className = "size-preview-caption";
    caption.textContent = `${size}px`;

    frame.appendChild(img);
    card.appendChild(frame);
    card.appendChild(caption);
    sizeGrid.appendChild(card);
  }
}

function renderSourceDetail(projectName, sourcePath) {
  const title = document.getElementById("source-detail-title");
  const meta = document.getElementById("source-detail-meta");
  const projectLink = document.getElementById("source-project-link");
  const deepLink = document.getElementById("source-deep-link");
  const image = document.getElementById("source-detail-image");
  const reference = document.getElementById("source-prompt-reference");
  const copyStatus = document.getElementById("source-copy-status");
  if (!title || !meta || !projectLink || !deepLink || !image || !reference || !copyStatus) return;

  const projectMeta = projectMetaByName.get(projectName);
  const source = projectMeta?.agentSteer?.sources?.find((item) => item.kind === "image" && item.src === sourcePath);
  projectLink.href = projectRouteHref(projectName);
  projectLink.textContent = `Back to ${projectName}`;
  copyStatus.textContent = "";

  if (!source) {
    title.textContent = "Source image not found";
    meta.textContent = "This source may have been renamed or removed.";
    image.hidden = true;
    reference.textContent = window.location.href;
    deepLink.href = window.location.href;
    return;
  }

  title.textContent = String(source.title || "Source Image");
  meta.textContent = `${projectName} · ${source.src}`;
  image.hidden = false;
  image.src = resolveAssetPath(source.src);
  image.alt = String(source.alt || source.title || "Steering source image");
  deepLink.href = window.location.href;
  deepLink.setAttribute("aria-label", `${source.title || "Source image"} deep link`);
  reference.textContent = `Steering source: ${window.location.href}\nRepository file: ${source.src}`;
}

function renderProjectDetail(projectName) {
  const title = document.getElementById("project-detail-title");
  const deepLink = document.getElementById("project-deep-link");
  const grid = document.getElementById("project-asset-grid");
  const notesList = document.getElementById("project-steer-notes");
  const sourcesGrid = document.getElementById("project-steer-sources");
  const emptyState = document.getElementById("project-steer-empty");
  const favoriteColorsRoot = document.getElementById("project-favorite-colors");
  const favoriteColorsEmpty = document.getElementById("project-favorite-colors-empty");
  const customColorForm = document.getElementById("project-custom-color-form");
  const customColorInput = document.getElementById("project-custom-color-input");
  const customColorValue = document.getElementById("project-custom-color-value");
  const customColorStatus = document.getElementById("project-custom-color-status");
  const slotsGrid = document.getElementById("project-icon-slots");
  const promptsRoot = document.getElementById("project-sample-prompts");
  const promptCopyStatus = document.getElementById("project-prompt-copy-status");
  const docsRoot = document.getElementById("project-documentation-links");
  const generateButton = document.getElementById("project-generate-new");
  const generatePanel = document.getElementById("project-generate-panel");
  const renameForm = document.getElementById("project-rename-form");
  const renameInput = document.getElementById("project-rename-input");
  const renameStatus = document.getElementById("project-rename-status");
  if (!title || !deepLink || !grid || !notesList || !sourcesGrid || !emptyState || !favoriteColorsRoot || !favoriteColorsEmpty || !customColorForm || !customColorInput || !customColorValue || !customColorStatus || !slotsGrid || !promptsRoot || !promptCopyStatus || !docsRoot || !generateButton || !generatePanel || !renameForm || !renameInput || !renameStatus) return;

  grid.innerHTML = "";
  notesList.innerHTML = "";
  sourcesGrid.innerHTML = "";
  favoriteColorsRoot.innerHTML = "";
  customColorStatus.textContent = "";
  slotsGrid.innerHTML = "";
  promptCopyStatus.textContent = "";
  docsRoot.innerHTML = "";
  const targetProject = String(projectName || "").trim();
  const projectMeta = projectMetaByName.get(targetProject);
  const projectAssets = assetData
    .filter((asset) => projectForAsset(asset) === targetProject)
    .sort((a, b) => a.label.localeCompare(b.label));

  if (!targetProject || (!projectMeta && !projectAssets.length)) {
    title.textContent = "Project not found";
    deepLink.href = window.location.href;
    deepLink.setAttribute("aria-label", "Project deep link");
    emptyState.classList.remove("is-hidden");
    return;
  }

  title.textContent = targetProject;
  renameForm.dataset.project = targetProject;
  renameForm.hidden = true;
  renameInput.value = targetProject;
  renameStatus.textContent = "";
  deepLink.href = window.location.href;
  deepLink.setAttribute("aria-label", `${targetProject} project deep link`);

  const steer = normalizeProjectSteer(targetProject);

  const syncFavoriteSwatches = (color) => {
    const selected = steer.favoriteColors.includes(color);
    for (const swatch of sourcesGrid.querySelectorAll(`.source-material-swatch[data-color="${color}"]`)) {
      swatch.setAttribute("aria-pressed", String(selected));
      swatch.setAttribute("aria-label", `${selected ? "Remove" : "Select"} ${color} as a project favorite`);
    }
  };

  const applyFavoriteResult = (result, color) => {
    steer.favoriteColors = result.favoriteColors || [];
    steer.customColors = result.customColors || [];
    renderFavoriteColors();
    syncFavoriteSwatches(color);
  };

  const renderFavoriteColors = () => {
    favoriteColorsRoot.innerHTML = "";
    favoriteColorsEmpty.hidden = steer.favoriteColors.length > 0;
    for (const color of steer.favoriteColors) {
      const item = document.createElement("div");
      item.className = "project-favorite-color";
      const swatch = document.createElement("span");
      swatch.className = "project-favorite-color-swatch";
      swatch.style.setProperty("--favorite-color", color);
      swatch.setAttribute("aria-hidden", "true");
      const value = document.createElement("code");
      value.textContent = color;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "project-favorite-color-remove";
      remove.setAttribute("aria-label", `Remove ${color} from project favorites`);
      remove.title = "Remove color";
      remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          const result = await updateProjectFavoriteColor(targetProject, color, false, steer.customColors.includes(color));
          applyFavoriteResult(result, color);
        } catch (error) {
          customColorStatus.textContent = error.message;
          remove.disabled = false;
        }
      });
      item.append(swatch, value, remove);
      favoriteColorsRoot.appendChild(item);
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
  };

  customColorValue.textContent = customColorInput.value.toUpperCase();
  customColorInput.oninput = () => {
    customColorValue.textContent = customColorInput.value.toUpperCase();
  };
  customColorForm.onsubmit = async (event) => {
    event.preventDefault();
    const color = customColorInput.value.toUpperCase();
    customColorStatus.textContent = "Adding color...";
    try {
      const result = await updateProjectFavoriteColor(targetProject, color, true, true);
      applyFavoriteResult(result, color);
      customColorStatus.textContent = "";
      showToast(`${color} added to project favorites.`);
    } catch (error) {
      customColorStatus.textContent = error.message;
    }
  };
  renderFavoriteColors();

  const slots = normalizeProjectSlots(targetProject);
  const projectSlug = String(projectMeta?.slug || slugify(targetProject));
  generatePanel.hidden = true;
  generateButton.setAttribute("aria-expanded", "false");
  projectSamplePrompts = Array.isArray(projectMeta?.samplePrompts) && projectMeta.samplePrompts.length
    ? projectMeta.samplePrompts
    : [
        `/create-svg-asset\n\nProject: ${targetProject}\nDirectory: assets/svg/${projectSlug}/`,
        `/create-svg-asset\n\nCreate a minimal geometric mark using the uploaded steering source material.\nBase idea: combine a strong silhouette with one distinctive cutout or negative-space detail.\n\nProject: ${targetProject}\nDirectory: assets/svg/${projectSlug}/`,
        `/create-svg-asset\n\nCreate an expressive symbol using the uploaded steering source material.\nBase idea: translate the project's core purpose into a modular emblem that remains recognizable at favicon size.\n\nProject: ${targetProject}\nDirectory: assets/svg/${projectSlug}/`
      ];
  projectSamplePrompts = projectSamplePrompts.map((prompt) =>
    normalizeProjectPrompt(prompt, targetProject, projectSlug)
  );
  activeProjectPromptIndex = 0;
  renderActiveProjectPrompt();

  const documentationLinks = [
    [projectMeta?.documentation || `assets/svg/${projectSlug}/README.md`, "Project README"],
    [".github/prompts/create-svg-asset.prompt.md", "Create SVG Asset prompt"],
    [".github/skills/wm-asset-manifest-spec/SKILL.md", "Manifest specification"],
    [".github/skills/wm-asset-authoring-workflow/SKILL.md", "Authoring workflow"]
  ];
  for (const [path, label] of documentationLinks) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = resolveAssetPath(path);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label;
    item.appendChild(link);
    docsRoot.appendChild(item);
  }
  const hasSteer = steer.notes.length > 0 || steer.sources.length > 0;
  emptyState.classList.toggle("is-hidden", hasSteer);

  for (const slot of slots) {
    const card = document.createElement("article");
    card.className = "icon-slot-card";

    const header = document.createElement("div");
    header.className = "icon-slot-header";

    const heading = document.createElement("h5");
    heading.textContent = slot.title;

    const usage = document.createElement("p");
    usage.className = "icon-slot-usage";
    usage.textContent = slot.usage;

    const preview = resolveSlotPreview(slot);
    const body = document.createElement("div");
    body.className = "icon-slot-body";

    if (preview.sourceType === "asset" || preview.sourceType === "src") {
      const img = document.createElement("img");
      img.className = "icon-slot-image";
      img.src = preview.src;
      img.alt = `${slot.title} preview`;

      if (preview.href) {
        const link = document.createElement("a");
        link.href = preview.href;
        link.className = "icon-slot-image-link";
        link.appendChild(img);
        body.appendChild(link);
      } else {
        body.appendChild(img);
      }
    } else if (preview.sourceType === "url") {
      const link = document.createElement("a");
      link.href = preview.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = preview.label;
      body.appendChild(link);
    } else {
      const empty = document.createElement("p");
      empty.className = "icon-slot-empty";
      empty.textContent = "No source assigned";
      body.appendChild(empty);
    }

    if (slot.note) {
      const note = document.createElement("p");
      note.className = "icon-slot-note";
      note.textContent = slot.note;
      body.appendChild(note);
    }

    header.appendChild(heading);
    header.appendChild(usage);
    card.appendChild(header);
    card.appendChild(body);
    slotsGrid.appendChild(card);
  }

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

    const kind = String(source.kind || "text").toLowerCase();

    if (kind === "image") {
      const sourceHref = sourceRouteHref(targetProject, source.src);
      const sourceDeepLink = new URL(sourceHref, window.location.href).href;
      const titleLink = document.createElement("a");
      titleLink.href = sourceHref;
      titleLink.textContent = titleEl.textContent;
      titleEl.replaceChildren(titleLink);
      const header = document.createElement("div");
      header.className = "source-material-header";
      const actions = document.createElement("div");
      actions.className = "source-material-actions";
      const linkButton = document.createElement("button");
      linkButton.type = "button";
      linkButton.className = "source-material-action";
      linkButton.setAttribute("aria-label", `Copy deep link for ${titleEl.textContent}`);
      linkButton.title = "Copy deep link";
      linkButton.innerHTML = '<i data-lucide="link" aria-hidden="true"></i>';
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "source-material-action";
      editButton.setAttribute("aria-label", `Rename ${titleEl.textContent}`);
      editButton.title = "Rename image";
      editButton.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "source-material-action source-material-delete";
      deleteButton.setAttribute("aria-label", `Remove ${titleEl.textContent}`);
      deleteButton.title = "Remove image";
      deleteButton.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      actions.append(linkButton, editButton, deleteButton);
      header.append(titleEl, actions);
      card.appendChild(header);

      const img = document.createElement("img");
      img.className = "source-material-image";
      img.src = resolveAssetPath(source.src || source.url || "");
      img.alt = String(source.alt || source.title || "Source image");
      const imageLink = document.createElement("a");
      imageLink.className = "source-material-image-link";
      imageLink.href = sourceHref;
      imageLink.setAttribute("aria-label", `Open ${titleEl.textContent} source page`);
      imageLink.appendChild(img);
      card.appendChild(imageLink);

      const palette = Array.isArray(source.palette) ? source.palette.slice(0, 10) : [];
      if (palette.length) {
        const paletteRegion = document.createElement("div");
        paletteRegion.className = "source-material-palette";
        const paletteLabel = document.createElement("p");
        paletteLabel.className = "source-material-palette-label";
        paletteLabel.textContent = "Project favorites";
        const swatches = document.createElement("div");
        swatches.className = "source-material-swatches";

        for (const entry of palette) {
          const color = String(entry.hex || "").toUpperCase();
          if (!/^#[0-9A-F]{6}$/.test(color)) continue;
          const percentage = Number(entry.percentage || 0);
          const selected = steer.favoriteColors.includes(color);
          const swatch = document.createElement("button");
          swatch.type = "button";
          swatch.className = "source-material-swatch";
          swatch.dataset.color = color;
          swatch.style.setProperty("--swatch-color", color);
          swatch.setAttribute("aria-pressed", String(selected));
          swatch.setAttribute("aria-label", `${selected ? "Remove" : "Select"} ${color} as a project favorite; ${percentage}% of image`);
          swatch.title = color;
          swatch.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
          swatch.addEventListener("click", async () => {
            const shouldSelect = swatch.getAttribute("aria-pressed") !== "true";
            swatch.disabled = true;
            try {
              const result = await updateProjectFavoriteColor(targetProject, color, shouldSelect);
              applyFavoriteResult(result, color);
              showToast(shouldSelect ? `${color} added to project favorites.` : `${color} removed from project favorites.`);
            } catch (error) {
              showToast(error.message);
            } finally {
              swatch.disabled = false;
            }
          });
          swatches.appendChild(swatch);
        }

        paletteRegion.append(paletteLabel, swatches);
        card.appendChild(paletteRegion);
      }

      const editor = document.createElement("form");
      editor.className = "source-material-editor";
      editor.hidden = true;
      const input = document.createElement("input");
      input.className = "wm-input source-material-name-input";
      input.value = String(source.title || "");
      input.setAttribute("aria-label", "Image name");
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "btn btn-primary btn-sm";
      save.textContent = "Save";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-sm";
      cancel.textContent = "Cancel";
      const status = document.createElement("p");
      status.className = "source-material-status";
      status.setAttribute("aria-live", "polite");
      editor.append(input, save, cancel);
      card.append(editor, status);

      const mutateSource = async (action, filename) => {
        const response = await fetch("/~grounding-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: targetProject, source: source.src, action, filename })
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || "Image update failed");
        window.location.reload();
      };

      editButton.addEventListener("click", () => {
        editor.hidden = false;
        input.focus();
        input.select();
      });
      cancel.addEventListener("click", () => {
        editor.hidden = true;
        status.textContent = "";
      });
      linkButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(sourceDeepLink);
          status.textContent = "";
          showToast("Link copied.");
        } catch {
          status.textContent = "Copy failed. Open the image and copy its URL manually.";
        }
      });
      editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        status.textContent = "Renaming...";
        try { await mutateSource("rename", input.value); } catch (error) { status.textContent = error.message; }
      });
      deleteButton.addEventListener("click", async () => {
        if (deleteButton.dataset.confirm !== "true") {
          deleteButton.dataset.confirm = "true";
          deleteButton.classList.add("is-confirming");
          deleteButton.setAttribute("aria-label", `Confirm removal of ${titleEl.textContent}`);
          deleteButton.title = "Click again to confirm removal";
          window.setTimeout(() => {
            deleteButton.dataset.confirm = "false";
            deleteButton.classList.remove("is-confirming");
            deleteButton.setAttribute("aria-label", `Remove ${titleEl.textContent}`);
            deleteButton.title = "Remove image";
          }, 4000);
          return;
        }
        deleteButton.disabled = true;
        try { await mutateSource("delete"); } catch (error) {
          deleteButton.disabled = false;
          status.textContent = error.message;
        }
      });
    } else if (kind === "url") {
      card.appendChild(titleEl);
      const link = document.createElement("a");
      link.href = String(source.url || "");
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = String(source.url || "Open URL");
      card.appendChild(link);
    } else if (kind === "file") {
      card.appendChild(titleEl);
      const link = document.createElement("a");
      link.href = resolveAssetPath(source.path || source.url || "");
      link.textContent = String(source.path || source.url || "Open file");
      card.appendChild(link);
    } else {
      card.appendChild(titleEl);
      const body = document.createElement("p");
      body.textContent = String(source.text || "");
      card.appendChild(body);
    }

    sourcesGrid.appendChild(card);
  }

  if (typeof lucide !== "undefined") lucide.createIcons();

  for (const asset of projectAssets) {
    const tile = document.createElement("article");
    tile.className = "asset-tile";
    const assetHref = `#asset/${encodeURIComponent(asset.id)}`;

    const frame = document.createElement("div");
    frame.className = "logo-frame";

    const img = document.createElement("img");
    img.src = `../${asset.source}`;
    img.alt = asset.label;

    const imageLink = document.createElement("a");
    imageLink.className = "asset-preview-link";
    imageLink.href = assetHref;
    imageLink.appendChild(frame);

    const assetTitle = document.createElement("h3");
    assetTitle.textContent = asset.label;

    const titleLink = document.createElement("a");
    titleLink.className = "asset-title-link";
    titleLink.href = assetHref;
    titleLink.appendChild(assetTitle);

    const colorsRoot = document.createElement("div");
    colorsRoot.className = "asset-colors";
    colorsRoot.setAttribute("aria-label", `Colors used in ${asset.label}`);
    const colorsLabel = document.createElement("span");
    colorsLabel.className = "asset-colors-label";
    colorsLabel.textContent = "Colors";
    const colorsList = document.createElement("div");
    colorsList.className = "asset-colors-list";
    colorsList.textContent = "Loading...";
    colorsRoot.appendChild(colorsLabel);
    colorsRoot.appendChild(colorsList);

    renderAssetColorList(colorsList, asset);

    const idText = document.createElement("p");
    idText.textContent = asset.id;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "asset-copy-link btn btn-sm";
    copyButton.setAttribute("aria-label", `Copy ${asset.label} deep link`);
    copyButton.title = "Copy asset deep link";
    copyButton.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
    copyButton.addEventListener("click", async () => {
      const deepLink = new URL(window.location.href);
      deepLink.hash = assetHref.slice(1);
      try {
        await navigator.clipboard.writeText(deepLink.href);
        showToast("Asset link copied.");
      } catch {
        showToast("Unable to copy asset link.");
      }
    });

    const footer = document.createElement("div");
    footer.className = "asset-tile-footer";
    footer.appendChild(idText);
    footer.appendChild(copyButton);

    frame.appendChild(img);
    tile.appendChild(imageLink);
    tile.appendChild(titleLink);
    tile.appendChild(colorsRoot);
    tile.appendChild(footer);
    grid.appendChild(tile);
  }

  if (typeof lucide !== "undefined") lucide.createIcons();
}

function wireGenerateAssetPrompt() {
  const button = document.getElementById("project-generate-new");
  const panel = document.getElementById("project-generate-panel");
  const copyButton = document.getElementById("project-prompt-copy");
  if (!button || !panel || !copyButton) return;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const section = button.closest(".project-assets-section-shell")?.querySelector("details");
    const wasSectionOpen = section?.open ?? true;
    if (section) section.open = true;
    if (wasSectionOpen || panel.hidden) panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) copyButton.focus();
  });
}

function wireProjectRename() {
  const button = document.getElementById("project-rename-button");
  const form = document.getElementById("project-rename-form");
  const input = document.getElementById("project-rename-input");
  const cancel = document.getElementById("project-rename-cancel");
  const status = document.getElementById("project-rename-status");
  if (!button || !form || !input || !cancel || !status) return;

  button.addEventListener("click", () => {
    form.hidden = false;
    input.focus();
    input.select();
  });
  cancel.addEventListener("click", () => {
    form.hidden = true;
    status.textContent = "";
    input.value = form.dataset.project || "";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextName = input.value.trim();
    status.textContent = "Renaming...";
    try {
      const response = await fetch("/~project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: form.dataset.project, name: nextName })
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Project rename failed");
      window.location.hash = projectRouteHref(result.name).slice(1);
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
    }
  });
}

function wireProjectPromptCarousel() {
  const previous = document.getElementById("project-prompt-previous");
  const next = document.getElementById("project-prompt-next");
  const copy = document.getElementById("project-prompt-copy");
  const status = document.getElementById("project-prompt-copy-status");
  if (!previous || !next || !copy || !status) return;

  const move = (offset) => {
    if (!projectSamplePrompts.length) return;
    activeProjectPromptIndex = (activeProjectPromptIndex + offset + projectSamplePrompts.length) % projectSamplePrompts.length;
    status.textContent = "";
    renderActiveProjectPrompt();
  };

  previous.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(projectSamplePrompts[activeProjectPromptIndex] || "");
      status.textContent = "Prompt copied.";
    } catch {
      status.textContent = "Copy failed. Select the prompt and copy it manually.";
    }
  });
}

function wireSourceReferenceCopy() {
  const button = document.getElementById("source-copy-reference");
  const reference = document.getElementById("source-prompt-reference");
  const status = document.getElementById("source-copy-status");
  if (!button || !reference || !status) return;

  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(reference.textContent || "");
      status.textContent = "Reference copied.";
    } catch {
      status.textContent = "Copy failed. Select the reference and copy it manually.";
    }
  });
}

function wireGroundingDropZone() {
  const dropzone = document.getElementById("project-grounding-dropzone");
  const input = document.getElementById("project-grounding-input");
  const status = document.getElementById("project-grounding-status");
  if (!dropzone || !input || !status) return;

  const uploadFiles = async (files) => {
    const project = getRouteFromHash().projectName;
    if (!project || files.length === 0) return;
    status.textContent = `Uploading ${files.length} image${files.length === 1 ? "" : "s"}...`;

    try {
      for (const file of files) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("Could not read image"));
          reader.readAsDataURL(file);
        });
        const response = await fetch("/~grounding-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, filename: file.name, dataUrl })
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || "Upload failed");
      }
      status.textContent = "Steering source material uploaded. Refreshing project sources...";
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      status.textContent = error.message;
    }
  };

  input.addEventListener("change", () => uploadFiles(Array.from(input.files || [])));
  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  }
  dropzone.addEventListener("drop", (event) => uploadFiles(Array.from(event.dataTransfer?.files || [])));
}

function renderCurrentRoute() {
  const route = getRouteFromHash();
  setMainViewVisibility(route);
  if (route.page === "asset") {
    renderAssetDetail(route.assetId);
    return;
  }

  if (route.page === "source") {
    renderSourceDetail(route.projectName, route.sourcePath);
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

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function wireStickyHeaderOffset() {
  const topbar = document.querySelector(".docs-topbar");
  const detailHeaders = document.querySelectorAll("#project-detail > .project-detail-header, #asset-detail > .project-detail-header");
  const assetHeader = document.querySelector("#asset-detail > .project-detail-header");
  if (!topbar || !detailHeaders.length) return;

  const updateStickyState = () => {
    const topbarHeight = topbar.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--preview-topbar-height", `${topbarHeight}px`);
    if (assetHeader) {
      document.documentElement.style.setProperty("--asset-detail-header-height", `${assetHeader.getBoundingClientRect().height}px`);
    }
    for (const header of detailHeaders) {
      const isVisible = header.getClientRects().length > 0;
      const isStuck = isVisible && window.scrollY > 0 && header.getBoundingClientRect().top <= topbarHeight + 1;
      header.classList.toggle("is-stuck", isStuck);
    }
  };
  updateStickyState();
  new ResizeObserver(updateStickyState).observe(topbar);
  if (assetHeader) new ResizeObserver(updateStickyState).observe(assetHeader);
  window.addEventListener("scroll", updateStickyState, { passive: true });
  window.addEventListener("hashchange", () => window.requestAnimationFrame(updateStickyState));
}

function wireNewProjectModal() {
  const btn = document.getElementById("new-project-btn");
  const modal = document.getElementById("new-project-modal");
  const formView = document.getElementById("np-form-view");
  const successView = document.getElementById("np-success-view");
  const form = document.getElementById("np-form");
  const nameInput = document.getElementById("np-name");
  const slugInput = document.getElementById("np-slug");
  const errorEl = document.getElementById("np-error");
  if (!btn || !modal || !form) return;

  const openModal = () => {
    formView.hidden = false;
    successView.hidden = true;
    form.reset();
    errorEl.hidden = true;
    modal.hidden = false;
    nameInput.focus();
    if (typeof lucide !== "undefined") lucide.createIcons();
  };

  const closeModal = () => { modal.hidden = true; };

  btn.addEventListener("click", openModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  modal.querySelectorAll(".np-close, .np-cancel").forEach((el) =>
    el.addEventListener("click", closeModal)
  );
  modal.querySelector(".np-done")?.addEventListener("click", (event) => {
    const project = event.currentTarget.dataset.project;
    closeModal();
    if (project) window.location.hash = projectRouteHref(project).slice(1);
    window.location.reload();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  // Auto-derive slug from name
  nameInput.addEventListener("input", () => {
    slugInput.value = slugify(nameInput.value);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const name = nameInput.value.trim();
    const slug = slugify(slugInput.value || name);
    if (!name || !slug) {
      errorEl.textContent = "Project name and slug are required.";
      errorEl.hidden = false;
      return;
    }

    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    try {
      const response = await fetch("/~scaffold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Scaffold failed");

      // Show success view
      formView.hidden = true;
      successView.hidden = false;
      document.getElementById("np-success-name").textContent = name;
      modal.querySelector(".np-done").dataset.project = name;

      const createdItems = document.getElementById("np-created-items");
      createdItems.innerHTML = [
        result.alreadyExists
          ? `<li><i data-lucide="info" aria-hidden="true"></i> Project entry already existed in manifest (skipped)</li>`
          : `<li><i data-lucide="check" aria-hidden="true"></i> Added <code>${name}</code> to <code>manifests/assets.json</code></li>`,
        `<li><i data-lucide="check" aria-hidden="true"></i> Created <code>${result.svgDir}</code></li>`,
        `<li><i data-lucide="check" aria-hidden="true"></i> Created <code>${result.groundingDir}</code></li>`,
        `<li><i data-lucide="check" aria-hidden="true"></i> Created <code>${result.documentation}</code></li>`,
      ].join("");

      document.getElementById("np-prompt-snippet").textContent =
        `/create-svg-asset\n\nProject: ${name}\nDirectory: ${result.svgDir}`;

      const resourceList = document.getElementById("np-resource-list");
      resourceList.innerHTML = [
        `<li><a href="http://localhost:4178/manifests/assets.json" target="_blank" rel="noopener">manifests/assets.json</a></li>`,
        `<li><a href="http://localhost:4178/.github/prompts/create-svg-asset.prompt.md" target="_blank" rel="noopener">.github/prompts/create-svg-asset.prompt.md</a></li>`,
        `<li><a href="http://localhost:4178/.github/skills/wm-asset-manifest-spec/SKILL.md" target="_blank" rel="noopener">.github/skills/wm-asset-manifest-spec/SKILL.md</a></li>`,
        `<li><a href="http://localhost:4178/.github/skills/wm-asset-authoring-workflow/SKILL.md" target="_blank" rel="noopener">.github/skills/wm-asset-authoring-workflow/SKILL.md</a></li>`,
      ].join("");

      if (typeof lucide !== "undefined") lucide.createIcons();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Project";
    }
  });
}

async function init() {
  applyThemeFromQuery();
  wireThemeToggle();
  wireTopNav();
  wireStickyHeaderOffset();
  wireNewProjectModal();
  wireGroundingDropZone();
  wireGenerateAssetPrompt();
  wireProjectRename();
  wireProjectPromptCarousel();
  wireSourceReferenceCopy();

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
