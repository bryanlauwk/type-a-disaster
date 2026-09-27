# Rebuilding the dinosaur models

The models in `public/dinos` come from Objaverse (CC BY Sketchfab models; see the main README for credits) and are prepared in two steps:

1. `bake.html` + `bake.mjs` (headless Chromium with three.js) load each source GLB, face it along +z, scale it to one body length, merge its meshes, and bake the clips listed in `config.js` into a half-float texture of bone matrices (`<species>.anim.bin`). Clips a model lacks (a duckbill's walk, say) are synthesised from bone rotations.
2. `post.mjs` (gltf-transform) welds and simplifies the mesh, recolours some textures to a natural palette, and converts textures to WebP.

Source GLBs are fetched from `https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/000-<chunk>/<uid>.glb`. Paths in the scripts point at a scratch folder; adjust them before rerunning.
