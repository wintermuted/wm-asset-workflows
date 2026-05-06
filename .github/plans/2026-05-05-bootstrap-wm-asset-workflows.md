# Title
Bootstrap wm-asset-workflows repository

## Overview
Create a standalone repository for SVG-first logo and glyph workflows with markdown-driven diagram support, browser preview, deterministic PNG generation, and automated screenshot capture.

## Phases
1. [x] Create repository skeleton and core directories.
2. [ ] Add project metadata and command surface.
3. [ ] Implement preview app for SVG and Mermaid specs.
4. [ ] Implement deterministic generators and capture scripts.
5. [ ] Add sample assets/specs and documentation.
6. [ ] Verify core commands and update this plan.

## Relevant Files
- `package.json`
- `README.md`
- `preview/index.html`
- `preview/styles.css`
- `preview/app.js`
- `scripts/node/serve-preview.mjs`
- `scripts/node/capture-preview.mjs`
- `scripts/node/build-spec-index.mjs`
- `scripts/python/generate_images.py`
- `specs/`
- `assets/svg/`

## Verification
- `npm run preview`
- `npm run build:specs`
- `python3 scripts/python/generate_images.py`
- `npm run capture`

## Decisions
- Runtime is hybrid: Node.js for orchestration/preview/capture and Python for image generation.
- SVG files are source of truth; PNGs are generated outputs.
- Mermaid is supported for markdown-driven diagrams, not logo authoring.
