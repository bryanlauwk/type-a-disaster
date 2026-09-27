# Rebuilding the plant impostors

1. `fetch_polyhaven.py <asset_id>` downloads a CC0 Poly Haven model (1k glTF). The CC BY models come from the Objaverse mirror on Hugging Face (see the main README for credits).
2. `impostor.html` + `impostor.mjs` (headless Chromium with three.js) photograph each plant from 8 directions at 2 heights, colour and view-space normals both, into a 4×4 atlas, and record its size.
3. The atlases were then colour-bled into their transparent areas (so mipmaps don't darken the edges), saved as WebP into `public/plants`, and their sizes written to `src/components/island/impostors.meta.json`.

Paths in the scripts point at a scratch folder; adjust them before rerunning.
