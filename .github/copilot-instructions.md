# Copilot Instructions — wm-asset-workflows

Standalone repo for SVG-first logo/glyph authoring, markdown-driven diagrams, deterministic PNG generation, and browser screenshot capture. Operated primarily from VS Code Copilot Chat with in-browser preview inspection.

## Stack

| Layer | Tool |
|-------|------|
| Preview/orchestration | Node.js 18+, ESM |
| Image generation | Python 3.10+, Pillow |
| Screenshot capture | Playwright (Chromium headless) |
| Preview server | `node:http` (zero-dependency) |

## Commands

```bash
npm install                    # Install Node deps (first time)
pip install -r requirements.txt  # Install Python deps (first time)
npx playwright install chromium  # Install browser for capture (first time)

npm run build:specs            # Parse specs/ markdown -> preview/spec-index.json
npm run preview                # Start preview server at http://localhost:4178/preview/index.html
npm run generate:png           # Generate PNG assets from Pillow scripts
npm run capture                # Headless-capture preview-light.png and preview-dark.png
npm run workflow:logo          # Run build:specs + generate:png + capture in sequence
```

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

## Copilot Chat Workflow

1. Add or edit SVG in `assets/svg/` and register in `manifests/assets.json`
2. Add or edit Mermaid specs in `specs/`
3. Run `npm run build:specs` to update the preview index
4. Inspect the result at `http://localhost:4178/preview/index.html` in the VS Code browser (supports `?theme=light` / `?theme=dark`)
5. Run `npm run generate:png` for image outputs
6. Run `npm run capture` for browser screenshots
7. Iterate on SVG source or spec and repeat from step 3

## Notes

- `outputs/` is treated as generated content — do not commit generated PNGs unless intentional
- The preview server auto-serves all repo files under `localhost:4178/`; SVG images are loaded via relative path from the manifest
- Always keep SVG sources minimal and editable; avoid baking raster artifacts back into source
