# Steering Image Color Palettes

Status: completed

## Overview

Analyze steering images during upload, persist their ten most-used colors, and display those colors as selectable swatches. Project-level favorite colors will be stored in the manifest so selections remain consistent across all steering images.

## Phases

### A. Palette Extraction

1. [x] Add a Pillow-based script that extracts up to ten dominant opaque colors as hex values and pixel percentages.
2. [x] Validate extraction against an existing steering image.

### B. Server Persistence

1. [x] Run palette extraction inside the grounding-image upload endpoint before committing the manifest record.
2. [x] Add a project-color endpoint that persists selected favorite colors.
3. [x] Backfill palettes for existing steering images.

### C. Preview Interaction

1. [x] Render analyzed colors below each steering image as accessible swatch buttons.
2. [x] Allow users to select and deselect project favorites, with selection shared across image cards.
3. [x] Add responsive styling for palette swatches and selected states.

### D. Verification

1. [x] Upload a controlled test image and verify the server stores no more than ten dominant colors.
2. [x] Select and deselect favorites in the browser and verify manifest persistence.
3. [x] Confirm existing upload, rename, delete, and project rename behavior still works.

### E. Favorite Color Summary and Custom Colors

1. [x] Add a Colors section above steering-image upload that lists selected project favorites.
2. [x] Add a native custom-color control and persist validated custom colors as project favorites.
3. [x] Preserve custom favorites when steering images are removed.
4. [x] Verify add, remove, reload persistence, and responsive layout in the browser.

### F. Collapsible Project Cards

1. [x] Move favorite colors into an independent project card above steering sources.
2. [x] Make Colors and Steering Source Material independently expandable and collapsible.
3. [x] Verify pointer, keyboard, and mobile expanded/collapsed behavior.

### G. Sticky Project Header

1. [x] Keep the project name and actions visible beneath the application topbar while scrolling.
2. [x] Track the responsive topbar height so desktop and mobile headers do not overlap.
3. [x] Verify sticky geometry, rename interaction, mobile width, and source-page isolation.
4. [x] Keep the header transparent at rest and match the nav's translucent page background and blur while docked.

### H. Generated Asset Interactions

1. [x] Make Generated Assets an unframed collapsible section while retaining cards for individual assets.
2. [x] Link each asset image and name to its detail route and remove the text details link.
3. [x] Add a card action that copies the full asset deep link to the clipboard.

## Relevant Files

| File | Purpose |
|---|---|
| `scripts/python/analyze_palette.py` | Dominant-color extraction |
| `scripts/node/serve-preview.mjs` | Upload processing and favorite persistence |
| `preview/app.js` | Palette and favorite interaction rendering |
| `preview/styles.css` | Swatch layout and states |
| `manifests/assets.json` | Stored palettes and project favorites |
| `.github/skills/wm-asset-manifest-spec/SKILL.md` | Palette manifest schema documentation |

## Verification

- Run the extractor directly against an existing PNG or JPEG.
- Run `node --check` on modified JavaScript files.
- Use Playwright against the running preview server to upload an image, inspect swatches, toggle favorites, and verify persisted manifest data.

## Decisions

- Use the existing Pillow dependency instead of adding a Node image-processing package.
- Store normalized uppercase hex colors and percentages with each image source.
- Store unique favorite hex colors at the project level under `agentSteer.favoriteColors`.
- Store accepted custom colors under `agentSteer.customColors` so they remain valid independently of image palettes.
- Ignore fully transparent pixels so transparent backgrounds do not dominate palettes.