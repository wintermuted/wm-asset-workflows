---
name: lucide-svg-icons
description: >
  Lucide icon SVG path lookup for wm-asset-workflows. Use this skill when
  embedding a Lucide icon into an SVG asset — to find the canonical path data
  rather than hand-drawing approximations.
---

# Lucide SVG Icons in wm-asset-workflows

## Package location

`lucide` is a declared dependency in `package.json`. After `npm install`:

```
node_modules/lucide/dist/esm/icons/<icon-name>.js
```

Each file exports `__iconNode` — an array of `["path", { d: "..." }]` tuples designed for a **24×24 viewBox**.

## Fallback (when proxy blocks npm install)

Both sibling projects have `lucide-react` installed:

```bash
cat ../sub-killer/node_modules/lucide-react/dist/esm/icons/<icon-name>.js
# or
cat ../game-of-life/node_modules/lucide-react/dist/esm/icons/<icon-name>.js
```

The `__iconNode` path data is identical between `lucide` and `lucide-react`.

## Icon name mapping

React component name → kebab-case filename:

| Component | File |
|-----------|------|
| `RefreshCw` | `refresh-cw.js` |
| `DollarSign` | `dollar-sign.js` |
| `ArrowRight` | `arrow-right.js` |
| `X` | `x.js` |

General rule: `PascalCase` → `kebab-case`.

## Embedding in SVG

1. Read the `d` attributes from `__iconNode` entries.
2. Wrap all paths in a `<g>` with transform to scale and center them.
3. Put all stroke props on the `<g>`, not individual `<path>` elements.

**Template:**

```svg
<!-- Lucide <IconName> — scaled Sx, centered at (cx, cy) in a WxH canvas -->
<!-- translate = (cx - 12*S, cy - 12*S) to center the 24x24 icon -->
<g transform="translate(TX, TY) scale(S)"
   fill="none" stroke="#color" stroke-width="1.5"
   stroke-linecap="round" stroke-linejoin="round">
  <path d="...first path d..."/>
  <path d="...second path d..."/>
</g>
```

**Scale formula for a 128×128 canvas centered at (64,64):**

- Desired diameter D → `S = D / 24`
- `TX = 64 - 12*S`, `TY = 64 - 12*S`

Example: 67px icon → `S ≈ 2.8`, `TX = TY ≈ 30.4`

## Example — RefreshCw in sub-killer-savings-v3.svg

```svg
<g transform="translate(30.4, 30.4) scale(2.8)"
   fill="none" stroke="#dcfce7" stroke-width="2.3"
   stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
  <path d="M21 3v5h-5"/>
  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
  <path d="M8 16H3v5"/>
</g>
```

## Do not

- Hand-draw Lucide-style arcs — always read the canonical `d` strings from the package.
- Apply stroke to individual `<path>` elements when using a `<g>` wrapper.
- Use greyscale dithering or raster fills in source SVGs.
