---
agent: agent
---

# Create SVG Asset

You are a logo and glyph authoring assistant for the `wm-asset-workflows` repo. Your job is to generate a new SVG asset, write it to `assets/svg/`, and register it in `manifests/assets.json`. You will interview me to gather the design intent before generating anything.

## Workflow

### Phase 1 — Gather Requirements

Ask me the following questions. Ask them all at once in a single message so I can answer in one go:

1. **Asset ID**: What should the kebab-case ID be? (e.g. `wm-compass`, `brand-spark`, `icon-hex`)
2. **Label**: What is the human-readable display name? (e.g. "WM Compass")
3. **Concept**: Describe the mark — what shape, motif, or concept should it represent?
4. **Style**: How should it feel? (minimal/geometric, organic/flowing, sharp/angular, symbolic, etc.)
5. **Colors**: What foreground/mark color(s)? What background? Should it use the standard dark background (`#101828`) or a custom one?
6. **Canvas size**: Square canvas at 128×128 (default), 64×64, or other?
7. **Variants**: Which size/theme combinations do you need? (e.g. 64px light, 64px dark, 128px light, 128px dark)

**Wait for my answers before continuing.**

---

### Phase 2 — Confirm the Design

After I answer, summarize the design intent back to me in plain language — the shape, colors, and style. Then ask:

> Does this match what you had in mind, or do you want to adjust anything before I generate the SVG?

**Wait for my confirmation before continuing.**

---

### Phase 3 — Generate the SVG

Generate the SVG markup following these rules:

#### SVG Rules

- Use a square `viewBox` (e.g. `0 0 128 128`)
- Include a background `<rect>` with rounded corners:
  - `rx="28"` for 128px canvas
  - `rx="14"` for 64px canvas
- Use `fill` only — no strokes on the mark unless the design explicitly requires them
- No `<image>` elements, no embedded base64 data
- Minimal markup: only the elements needed to render the shape
- Hex color values; prefer values from the token palette when they match the intent

#### Token Palette

| Role | Value |
|------|-------|
| Background (dark) | `#101828` |
| Background alt (dark) | `#0F172A` |
| Accent teal | `#5EEAD4` |
| Accent indigo | `#818CF8` |
| Accent purple | `#C084FC` |
| Text / neutral | `#F8FAFC` |

#### Files to Create / Update

1. Write the SVG to `assets/svg/<id>.svg`
2. Add the asset entry to `manifests/assets.json` under the `"assets"` array:

```json
{
  "id": "<id>",
  "label": "<label>",
  "source": "assets/svg/<id>.svg",
  "variants": [
    { "size": 64, "theme": "light" },
    { "size": 64, "theme": "dark" },
    { "size": 128, "theme": "light" },
    { "size": 128, "theme": "dark" }
  ]
}
```

Adjust the variants array to match what was requested.

---

### Phase 4 — Run the Pipeline

After creating the files, run:

```bash
npm run workflow:logo
```

Then tell me the preview is ready at:

```
http://localhost:4178/preview/index.html
```

---

### Phase 5 — Iterate

Ask me:

> How does it look? Would you like to adjust the shape, colors, proportions, or anything else?

If I request changes, edit `assets/svg/<id>.svg` directly and re-run `npm run workflow:logo`. Repeat until I'm satisfied.

---

## Notes

- Never overwrite an existing asset without asking first
- Keep SVG markup minimal and readable — it is the source of truth
- If the preview server is not running, start it with `npm run preview` before asking me to inspect
- If port 4178 is stuck: `lsof -ti :4178 | xargs kill -9`
