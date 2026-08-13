# Copilot Instructions — wm-asset-workflows

Standalone repo for SVG-first logo/glyph authoring, markdown-driven diagrams, deterministic PNG generation, and browser screenshot capture. Operated primarily from VS Code Copilot Chat with in-browser preview inspection.

## Stack

| Layer | Tool |
|-------|------|
| Preview/orchestration | Node.js 18+, ESM |
| Image generation | Python 3.10+, Pillow |
| Screenshot capture | Playwright (Chromium headless) |
| Preview server | `node:http` (zero-dependency) |
| Icon paths | `lucide` (declared dependency) |

## Commands

```bash
npm install                    # Install Node deps (first time)
pip install -r requirements.txt  # Install Python deps (first time)
npx playwright install chromium  # Install browser for capture (first time)

npm run build:specs            # Parse specs/ markdown -> preview/spec-index.json
npm run preview                # Ensure deps + build specs, then serve at http://localhost:4178/preview/index.html
npm run generate:png           # Generate PNG assets from Pillow scripts
npm run capture                # Headless-capture preview-light.png and preview-dark.png
npm run workflow:logo          # Run build:specs + generate:png + capture in sequence
```

## Git Remote Operations

This repo is owned by the **`wintermuted`** GitHub account. Copilot sessions typically run as a different account (e.g. `jnyeholt_microsoft`), which has **read-only** access — pushes and PR creation fail with `403`.

The session injects a `GH_TOKEN` environment variable that **overrides** gh's stored accounts, so `gh auth switch` alone does not fix this. Clear the env tokens and use the `wintermuted` token explicitly:

```bash
export GH_TOKEN=$(gh auth token --user wintermuted --hostname github.com)
export GITHUB_TOKEN="$GH_TOKEN"
gh pr create --repo wintermuted/wm-asset-workflows ...
```

If `gh auth status` does not list a `wintermuted` account, run `gh auth login --hostname github.com` as that account first — do not work around it by granting the session account write access.

## Directory Layout

```
assets/svg/          SVG source files — source of truth, never overwritten by scripts
specs/               Markdown specs with Mermaid blocks for diagram lane
manifests/assets.json  Asset catalog consumed by preview and generator scripts
preview/             Static browser preview app (HTML/CSS/JS)
scripts/node/        Orchestration scripts: serve-preview, build-spec-index, capture-preview
scripts/python/      Deterministic image generators
outputs/png/         Generated PNG assets (git-ignored except .gitkeep)
outputs/screenshots/ Browser capture outputs (git-ignored except .gitkeep)
```

## Authoring Conventions

- **Logos and glyphs** → author as SVG files in `assets/svg/`; register in `manifests/assets.json`
- **Diagrams** → author as Mermaid blocks in `specs/*.md` markdown files; Mermaid is for flows/architecture, not brand mark construction
- **PNG generation** → script-driven via Pillow; controlled through the spec/manifest, not manual drawing
- **Naming** → kebab-case asset ids, deterministic output filenames, variant suffixes for size/theme

## Prompt Library

This repo includes a VS Code Copilot Chat prompt file for the primary authoring workflow:

| Prompt | Location | Use When... |
|--------|---------|-------------|
| **Create SVG Asset** | `.github/prompts/create-svg-asset.prompt.md` | Creating a new logo or glyph from scratch via a guided interview |

Use `/create-svg-asset` in Copilot Chat to start an interactive session. The prompt handles: design interview → SVG generation → manifest registration → pipeline run → iteration loop.

## Copilot Chat Workflow

1. Add or edit SVG in `assets/svg/` and register in `manifests/assets.json`
2. Add or edit Mermaid specs in `specs/`
3. Run `npm run build:specs` to update the preview index
4. Inspect the result at `http://localhost:4178/preview/index.html` in the VS Code browser (supports `?theme=light` / `?theme=dark`)
5. Run `npm run generate:png` for image outputs
6. Run `npm run capture` for browser screenshots
7. Iterate on SVG source or spec and repeat from step 3

## Using Lucide Icons in SVGs

`lucide` is declared as a dependency. After `npm install` it is available at:

```
node_modules/lucide/dist/esm/icons/<icon-name>.js
```

Each file exports a `__iconNode` array of `["path", { d: "..." }]` tuples on a **24×24 viewBox**. Use these `d` strings directly in SVG `<path>` elements — never hand-draw approximations.

**Fallback while proxy blocks install:** sibling projects `sub-killer` and `game-of-life` both have `lucide-react` installed. Read icons from:

```
../sub-killer/node_modules/lucide-react/dist/esm/icons/<icon-name>.js
```

**Icon naming:** React component names map to kebab-case filenames, e.g. `RefreshCw` → `refresh-cw.js`.

**Embedding in SVG:** scale with a `<g transform="translate(tx, ty) scale(s)">` wrapper. Stroke attributes (`fill="none"`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`) go on the `<g>`, not individual paths.

**Quick lookup command:**
```bash
cat node_modules/lucide/dist/esm/icons/refresh-cw.js
# or fallback:
cat ../sub-killer/node_modules/lucide-react/dist/esm/icons/refresh-cw.js
```

## Notes

- `outputs/` is treated as generated content — do not commit generated PNGs unless intentional
- The preview server auto-serves all repo files under `localhost:4178/`; SVG images are loaded via relative path from the manifest
- Always keep SVG sources minimal and editable; avoid baking raster artifacts back into source
