---
name: wm-asset-authoring-workflow
description: >
  wm-asset-workflows authoring loop — adding SVG logos/glyphs, running the
  preview server, generating PNG outputs, and capturing browser screenshots.
  Use when authoring new assets, running workflow commands, starting or stopping
  the preview server, or troubleshooting the build pipeline in wm-asset-workflows.
---

# wm-asset-workflows — Authoring Workflow

## Overview

This repo follows a Copilot Chat-driven loop:

1. Author or edit SVG in `assets/svg/`
2. Register in `manifests/assets.json`
3. Add Mermaid specs in `specs/` (optional)
4. Run `npm run build:specs`
5. Inspect at `http://localhost:4178/preview/index.html`
6. Run `npm run generate:png` for PNG outputs
7. Run `npm run capture` for browser screenshots

## Commands

| Command | Purpose |
|---------|---------|
| `npm run build:specs` | Parse `specs/*.md` Mermaid blocks → `preview/spec-index.json` |
| `npm run preview` | Start preview server at `http://localhost:4178/preview/index.html` |
| `npm run generate:png` | Run Pillow script → `outputs/png/logo-sheet.png` |
| `npm run capture` | Playwright headless capture → `outputs/screenshots/preview-light.png` + `preview-dark.png` |
| `npm run workflow:logo` | Run `build:specs + generate:png + capture` in sequence |

## Starting the Preview Server

```bash
npm run preview
# → http://localhost:4178/preview/index.html
```

Custom port:

```bash
node scripts/node/serve-preview.mjs --port 5000
```

## Stopping the Preview Server

```bash
lsof -ti :4178 | xargs kill -9
```

## Adding a New Logo or Glyph

1. Add SVG to `assets/svg/<id>.svg`
2. Register in `manifests/assets.json` (see `wm-asset-manifest-spec` skill for schema)
3. Run `npm run workflow:logo`
4. Verify at `http://localhost:4178/preview/index.html`

## Adding a Mermaid Diagram

1. Create or edit a file in `specs/`
2. Add a fenced Mermaid block:
   ````
   ```mermaid
   flowchart LR
     A[Input] --> B[Process] --> C[Output]
   ```
   ````
3. Run `npm run build:specs`
4. Refresh the preview — the diagram appears in the Diagram Specs panel

## Theme Toggle and Capture

- The preview reads `?theme=light` or `?theme=dark` as a URL query param
- Capture script writes both variants automatically to `outputs/screenshots/`
- Click **Toggle Theme** in the preview header to switch manually

## Scope Boundaries

- SVGs in `assets/svg/` are the canonical source of truth — scripts never overwrite them
- Mermaid blocks are for flow/architecture diagrams, not brand mark construction
- `outputs/` is generated content — do not commit PNGs unless intentional
- `preview/spec-index.json` is git-ignored; always rebuild with `npm run build:specs`
