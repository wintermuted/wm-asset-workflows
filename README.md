# Agentic Icon Builder

Agentic workflow app for building SVG logos and glyphs, authoring markdown-driven Mermaid diagrams, generating deterministic PNGs, and capturing browser screenshots.

## Goals

- Keep SVG assets as source of truth.
- Support markdown-driven diagrams in a previewable lane.
- Generate deterministic PNG outputs.
- Capture live browser previews for review artifacts.
- Operate smoothly from VS Code Copilot Chat.

## Repository Layout

```
assets/svg/          SVG source files — source of truth, never overwritten by scripts
specs/               Markdown specs with Mermaid blocks for the diagram lane
manifests/assets.json  Asset catalog consumed by preview and generator scripts
packages/            Package-aligned source boundaries for the future monorepo
packages/preview-app/ Browser preview application source
packages/preview-server/ Preview HTTP server source
packages/workflows/  Node workflow source and shared paths
packages/image-generation/ Deterministic image generators (Pillow)
preview/             Static browser entrypoint and compatibility shell
scripts/node/        CLI compatibility entrypoints for package workflows/server
scripts/python/      Python compatibility entrypoints for image generation
outputs/png/         Generated PNG assets (git-ignored except .gitkeep)
outputs/screenshots/ Browser capture outputs (git-ignored except .gitkeep)
```

## Prerequisites

- Node.js 18+
- Python 3.10+
- Playwright Chromium (one-time install)

```bash
npm install
pip install -r requirements.txt
npx playwright install chromium   # one-time browser install
```

## Commands

```bash
npm run build:specs     # Parse specs/*.md Mermaid blocks → preview/spec-index.json
npm run preview         # Install deps if needed, build the spec index, then serve the preview
npm run generate:png    # Generate deterministic PNG assets via Pillow
npm run capture         # Capture light/dark screenshots using Playwright
npm run workflow:logo   # Run build:specs + generate:png + capture in sequence
```

## Prompt-Driven Authoring

Logos and glyphs are designed to be created primarily through VS Code Copilot Chat. Use the provided prompt file to start an interactive session:

```
/create-svg-asset
```

The agent will interview you for the design intent, generate the SVG, register it in the manifest, and run the pipeline. See [docs/prompt-driven-authoring.md](docs/prompt-driven-authoring.md) for example prompts and SVG conventions.

## Usage Guide

### Adding a New Logo or Glyph (Manual)

1. Author the SVG in `assets/svg/<id>.svg`. Keep it minimal and editable — no baked raster artifacts.
2. Register it in `manifests/assets.json`:

   ```json
   {
     "assets": [
       {
         "id": "my-glyph",
         "label": "My Glyph",
         "source": "assets/svg/my-glyph.svg",
         "variants": [
           { "size": 64, "theme": "dark" },
           { "size": 64, "theme": "light" }
         ]
       }
     ]
   }
   ```

3. Run `npm run preview`.
4. Inspect the logo tile in the browser at `http://localhost:4178/preview/index.html`.
5. Run `npm run generate:png` to produce `outputs/png/logo-sheet.png`.
6. Run `npm run capture` to produce `outputs/screenshots/preview-light.png` and `preview-dark.png`.

### Adding a Mermaid Diagram Spec

1. Create or edit a markdown file in `specs/`, e.g. `specs/my-system.md`.
2. Add a Mermaid fenced block:

   ````markdown
   ```mermaid
   flowchart LR
     A[Input] --> B[Process] --> C[Output]
   ```
   ````

3. Run `npm run build:specs` to update `preview/spec-index.json`.
4. Refresh the preview at `http://localhost:4178/preview/index.html` — the diagram appears in the Markdown Diagram Specs panel.

### Running the Full Workflow

```bash
npm run workflow:logo
```

This runs `build:specs → generate:png → capture` in sequence. Use it after any authoring change to produce fresh outputs.

### Theme Toggle and Capture

The preview supports a `?theme=light` or `?theme=dark` query param for deterministic capture. Click **Toggle Theme** in the header or append `?theme=dark` to the URL manually. The capture script automatically captures both variants.

### Serving the Preview

```bash
npm run preview
# → http://localhost:4178/preview/index.html
```

To use a different port:

```bash
node scripts/node/serve-preview.mjs --port 5000
```

To stop the server, kill the process holding the port:

```bash
lsof -ti :4178 | xargs kill -9
```

## Notes

- SVG sources in `assets/svg/` are the canonical source of truth — scripts never overwrite them.
- Mermaid blocks are for flow/architecture diagrams, not brand mark construction.
- `outputs/` is treated as generated content — do not commit generated PNGs unless intentional.
- `preview/spec-index.json` is also git-ignored (it is rebuilt from `specs/` on demand).

## Modularization Direction

The repository now uses package-aligned source boundaries while keeping the current runtime entrypoints and public commands stable:

- `packages/preview-app/` owns the browser application source; `preview/app.js` remains a compatibility entrypoint.
- `packages/preview-server/` owns the preview HTTP server; `scripts/node/serve-preview.mjs` remains its compatibility entrypoint.
- `packages/workflows/` owns spec indexing, screenshot capture, and shared workflow paths.
- `packages/image-generation/` owns the Pillow generators and palette analyzer.

The root `package.json` declares `packages/*` as workspaces so these boundaries can gain independent package dependencies and scripts without another structural migration.
