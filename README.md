# wm-asset-workflows

Standalone workflow repo for SVG logos/glyphs, markdown-driven Mermaid diagrams, deterministic PNG generation, and browser screenshot capture.

## Goals

- Keep SVG assets as source of truth.
- Support markdown-driven diagrams in a previewable lane.
- Generate deterministic PNG outputs.
- Capture live browser previews for review artifacts.
- Operate smoothly from VS Code Copilot Chat.

## Repository Layout

- `assets/svg/` source logos and glyphs
- `specs/` markdown specs (supports Mermaid blocks)
- `manifests/assets.json` asset catalog for generation and preview
- `preview/` browser preview app
- `scripts/node/` preview server, spec index builder, screenshot capture
- `scripts/python/` deterministic PNG generation
- `outputs/png/` generated PNGs
- `outputs/screenshots/` browser capture outputs

## Prerequisites

- Node.js 18+
- Python 3.10+

Install dependencies:

```bash
npm install
pip install -r requirements.txt
```

## Commands

```bash
npm run build:specs     # Parse markdown specs into preview/spec-index.json
npm run preview         # Start local preview server on http://localhost:4178/preview/index.html
npm run generate:png    # Generate deterministic PNG assets via Pillow
npm run capture         # Capture light/dark screenshots of preview using Playwright
npm run workflow:logo   # Run build:specs + generate:png + capture
```

## Authoring Workflow

1. Add or edit SVG sources in `assets/svg/`.
2. Update `manifests/assets.json` to register new assets.
3. Add or edit markdown Mermaid specs in `specs/`.
4. Run `npm run build:specs`.
5. Run `npm run preview` and inspect results in browser.
6. Run `npm run generate:png` and `npm run capture` for outputs.

## Notes

- Mermaid is intended for diagram specs, not logo construction.
- `outputs/` is treated as generated content and mostly git-ignored.
- The preview supports `?theme=light` and `?theme=dark` query params for deterministic capture.
