# Prompt-Driven Logo and Glyph Authoring

Logos and glyphs in this repo are authored primarily through VS Code Copilot Chat conversations. The agent generates SVG markup, creates the source file, and registers it in the manifest. You then run the pipeline to preview and export outputs.

## Overview

The authoring loop looks like this:

```
Describe the mark → Agent generates SVG → Preview in browser → Iterate → Export
```

No design tools required. The SVG is written directly to `assets/svg/` as plain markup, then the preview and generation pipeline handles the rest.

## Starting a New Asset

Use the `.github/prompts/create-svg-asset.prompt.md` prompt file in Copilot Chat:

```
/create-svg-asset
```

The prompt walks you through describing the mark, specifying colors and sizes, then generates the SVG file and manifest entry. You can also just describe what you want in plain language — example prompts are below.

## Example Prompts

### Create a new glyph from a concept

```
Create a new SVG glyph for wm-asset-workflows. I want a stylized compass rose — minimal,
geometric, monochrome-friendly. Dark background with a white/teal mark. Square canvas, 128×128.
Register it as `wm-compass` in the manifest with 64px and 128px variants in both light and dark themes.
```

### Create a minimal wordmark

```
Create an SVG wordmark for "Wintermuted" using a tight monospaced-style letterform.
Use a dark (#101828) background with off-white (#F8FAFC) text.
Keep it wide-format: 320×80 viewBox. Register as `wm-wordmark` in the manifest.
```

### Create a badge/icon glyph

```
I want a circuit-board-style hexagon glyph — 128×128 viewBox, sharp corners,
dark bg (#0F172A), with a single centered hex outline and short connecting lines radiating outward.
Color: #818CF8 (indigo). Save as `wm-circuit-hex` and add 64 and 128px variants to the manifest.
```

### Iterate on an existing mark

```
Open assets/svg/wm-spark.svg. I want to try a version where the star point is replaced
with a lightning bolt shape instead of a diamond star. Keep the background rect and color palette the same.
Overwrite the file and regenerate the preview.
```

### Generate variants at a new size

```
Add a 32px variant (dark theme only) for the wm-spark asset in manifests/assets.json,
then run npm run workflow:logo.
```

### Adjust colors for a theme

```
Update wm-spark.svg so the mark color is #C084FC (purple) instead of #5EEAD4 (teal).
Then run npm run generate:png and npm run capture to refresh outputs.
```

## SVG Conventions

When the agent generates SVG, it should follow these rules:

- **Canvas**: Square `viewBox`, typically `0 0 128 128` or `0 0 64 64`
- **Background**: `<rect>` with rounded corners (`rx="28"` for 128px canvas, `rx="14"` for 64px)
- **Fills only**: No strokes on the mark itself unless the design specifically requires them
- **No raster references**: No `<image>` elements, no embedded base64 data
- **Minimal markup**: Only the elements needed to describe the shape — no invisible helpers, no comments unless explaining a non-obvious technique
- **Named colors**: Use hex values from the token palette when possible

### Token Palette Reference

These align with `@wintermuted/ui-theme` tokens:

| Role | Light value | Dark value |
|------|-------------|------------|
| Background | `#F8FAFC` | `#101828` |
| Background alt | `#F1F5F9` | `#0F172A` |
| Accent teal | `#5EEAD4` | `#5EEAD4` |
| Accent indigo | `#818CF8` | `#A5B4FC` |
| Accent purple | `#C084FC` | `#D8B4FE` |
| Neutral white | `#FFFFFF` | — |
| Text primary | `#1E293B` | `#F8FAFC` |

## After Generating an SVG

1. The agent creates `assets/svg/<id>.svg`
2. The agent adds or updates the entry in `manifests/assets.json`
3. Run the pipeline:

   ```bash
   npm run workflow:logo
   ```

4. Inspect the preview at `http://localhost:4178/preview/index.html`
5. Iterate by asking the agent to edit the SVG, then re-run `npm run workflow:logo`

## Stopping and Restarting the Preview Server

```bash
# Start
npm run preview

# Stop (if port is stuck)
lsof -ti :4178 | xargs kill -9
```

## Manifest Entry Format

Every SVG must be registered in `manifests/assets.json` before it will appear in the preview or be picked up by the PNG generator:

```json
{
  "id": "my-glyph",
  "label": "My Glyph",
  "source": "assets/svg/my-glyph.svg",
  "variants": [
    { "size": 64, "theme": "light" },
    { "size": 64, "theme": "dark" },
    { "size": 128, "theme": "light" },
    { "size": 128, "theme": "dark" }
  ]
}
```

See [wm-asset-manifest-spec skill](./.github/skills/wm-asset-manifest-spec/SKILL.md) for full schema reference.
