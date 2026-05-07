# wm-asset-workflows

Standalone workflow repo for SVG logos/glyphs, markdown-driven Mermaid diagrams, deterministic PNG generation, and browser screenshot capture.

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
preview/             Static browser preview app (HTML/CSS/JS, uses @wintermuted/ui-theme)
scripts/node/        Orchestration scripts: serve-preview, build-spec-index, capture-preview
scripts/python/      Deterministic image generators (Pillow)
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
npm run preview         # Start local preview server at http://localhost:4178/preview/index.html
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

3. Run `npm run build:specs` (if specs also changed) then `npm run preview`.
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
