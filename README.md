# Mesh Gradient Tool

A small, standalone browser tool that generates mesh gradients and exports them as
JPG, WebP or PNG, for presentation backgrounds and social media posts. No backend,
everything runs in the browser (WebGL2). The shader is a port of the GALVANY
"CTA_Button" mesh gradient.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Needs Node 20+ (developed on Node 22) and a browser with WebGL2.

## Use

- **Size**: pick a preset (16:9 slides, 1:1, 4:5, 9:16 stories, 1200x630 link preview) or type any width/height. If a size is too large for the browser/GPU you get a warning and the export button is disabled.
- **Points**: the 16 circles on the preview are the control points. Drag them, use the arrow keys (Shift = bigger steps) or type x/y. Change the colour of the selected point with the colour field or by clicking a palette swatch. *Lock border* keeps corners fixed and lets edge points slide along their edge only, so the gradient never pulls away from the edge.
- **Colours**: choose a palette, press *Randomize* for a new layout built from it. The **seed** is shown; typing a seed reproduces that layout. `+` adds a custom colour to the palette, `×` on a swatch removes it.
- **Grain**: dither noise in 8-bit steps (default 1.5). It hides banding in 8-bit exports. Lossy formats smooth noise away, so raise it for WebP/JPG at lower quality; set it to 0 for a perfectly clean PNG.
- **Export**: choose JPG / WebP / PNG, quality (not for PNG) and 1x / 2x. *Export image* renders a fresh frame at the target size on an offscreen canvas (the preview is never scaled up) and downloads it as `mesh-gradient-<w>x<h>-<seed>.<ext>`.
- **Save & share**: *Copy link* copies the URL, which contains the whole gradient in its hash (`#g=...`). *Save JSON* / *Load JSON* store and restore the gradient plus export settings.

The preview is rendered at the export size up to 2048 px on the long side; larger sizes are previewed downsampled (the gradient is resolution independent, only the grain pattern differs).

## Add a palette

Open `src/palettes.ts` and append an entry to `PALETTES`:

```ts
{
  id: 'forest',
  name: 'Forest',
  colors: ['#0F2A1D', '#2E7D4F', '#9BD18B', '#F2F7E6'], // first = dominant base colour
}
```

The seeded randomizer lays it out. For a hand-made arrangement add a `layout`: 16 entries `[x %, y %, index into colors]`, row-major (see the GALVANY Brand preset).

## Code layout

- `src/mesh/mesh.ts`: shaders and `MeshRenderer`, no dependency on the rest. Copy this file to reuse the gradient elsewhere.
- `src/state.ts`: state shape, JSON and URL-hash (de)serialisation with validation.
- `src/export.ts`: offscreen render at the target size, size limit checks, encoding.
- `src/random.ts`, `src/palettes.ts`, `src/main.ts` (UI), `src/style.css`.

## Notes

- Colours are blended in linear light and converted back to sRGB in the fragment shader.
- Exported images are sRGB without an embedded colour profile (browser canvas encoders do not embed one).
- Browsers limit canvas sizes (the tool checks the WebGL limit and that a canvas of the target size can really be allocated). Safari allows far fewer pixels than Chrome.
