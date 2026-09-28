// Prepares the island's props from Poly Haven (CC0) models:
//   node scripts/props/props.mjs <srcdir> <outdir>
// Each prop is one or more nodes of a source model, flattened into its own
// file: transforms applied, sat on y = 0 and centred, simplified to a small
// triangle budget, with its colour and normal maps at 512px WebP.
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, prune, simplify, textureCompress, weld, transformMesh } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "fs";

export const PROPS = {
  // Rocks and cliffs
  boulder: { src: "boulder_01", tris: 1600 },
  moss_rock_1: { src: "rock_moss_set_01", nodes: /rock01$/, tris: 900 },
  moss_rock_2: { src: "rock_moss_set_01", nodes: /rock02$/, tris: 900 },
  moss_rock_3: { src: "rock_moss_set_01", nodes: /rock04$/, tris: 900 },
  moss_rock_4: { src: "rock_moss_set_01", nodes: /rock05$/, tris: 900 },
  moss_rock_5: { src: "rock_moss_set_02", nodes: /rock11$/, tris: 700 },
  moss_rock_6: { src: "rock_moss_set_02", nodes: /rock13$/, tris: 700 },
  rock_face_1: { src: "rock_face_01", tris: 900 },
  rock_face_2: { src: "rock_face_02", tris: 900 },
  crag: { src: "namaqualand_cliff_01", tris: 1200 },
  slab: { src: "namaqualand_boulder_02", tris: 1000 },
  coast_rock: { src: "coast_rocks_05", tris: 1200 },
  // Fallen wood
  dead_trunk: { src: "dead_tree_trunk_02", tris: 1000 },
  stump: { src: "tree_stump_01", tris: 800 },
  roots: { src: "root_cluster_01", tris: 1500 },
  // The old park
  gate: { src: "large_iron_gate", tris: 3000 },
  fence: { src: "modular_chainlink_fence", nodes: /^modular_chainlink_fence_double$/, tris: 1600 },
  fence_post: { src: "modular_chainlink_fence", nodes: /^modular_chainlink_fence_post$/, tris: 300 },
  pole: { src: "modular_electricity_poles", nodes: /^preset_03_/, tris: 1600 },
  car: { src: "covered_car", tris: 3000 },
  tyre: { src: "old_tyre", tris: 500 },
  barrel: { src: "barrel_03", tris: 600 },
  crate: { src: "wooden_crate_01", tris: 700 },
  barrier: { src: "concrete_road_barrier", tris: 500 },
  utility_box: { src: "utility_box_01", tris: 600 },
  wheel_rim: { src: "rusted_wheel_rim_01", tris: 500 },
};

const [srcDir, outDir] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
fs.mkdirSync(outDir, { recursive: true });
const metaPath = `${outDir}/props.meta.json`;
const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
for (const [key, spec] of Object.entries(PROPS)) {
  if (only && !only.test(key)) continue;
  const doc = await io.read(`${srcDir}/${spec.src}/${spec.src}.gltf`);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  // Keep only the wanted nodes (and their parents).
  if (spec.nodes) {
    const keep = new Set();
    scene.traverse((n) => {
      if (n.getMesh() && spec.nodes.test(n.getName())) keep.add(n);
    });
    scene.traverse((n) => {
      if (n.getMesh() && !keep.has(n)) n.setMesh(null);
    });
  }
  await doc.transform(flatten(), prune(), join({ keepNamed: false }), weld({}));
  // Bake node transforms into the vertices, one mesh per material.
  for (const n of root.listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    transformMesh(m, n.getWorldMatrix());
    n.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  for (const n of root.listNodes()) if (!n.getMesh()) for (const c of n.listChildren()) void c;
  const tris = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
  const before = tris();
  if (before > spec.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: spec.tris / before, error: 0.02, lockBorder: false }));
  // Scans split along their UV seams resist that: thin those down roughly.
  if (tris() > spec.tris * 1.5)
    for (const m of root.listMeshes())
      for (const p of m.listPrimitives()) {
        const n = p.getIndices().getCount() / 3;
        const want = Math.min(n, Math.max(60, Math.round((n / tris()) * spec.tris)));
        const [out] = MeshoptSimplifier.simplifySloppy(
          new Uint32Array(p.getIndices().getArray()),
          p.getAttribute("POSITION").getArray(),
          3,
          null,
          want * 3,
          1,
        );
        p.getIndices().setArray(new Uint32Array(out));
      }
  // Sit it on the ground, centred.
  const b = getBounds(scene);
  const shift = [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2];
  for (const m of root.listMeshes()) transformMesh(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...shift, 1]);
  // Colour and normal maps only; the rest is left to the material.
  for (const mat of root.listMaterials()) {
    mat.setMetallicRoughnessTexture(null);
    mat.setOcclusionTexture(null);
    mat.setMetallicFactor(0);
  }
  await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 80 }), dedup(), prune());
  const out = `${outDir}/${key}.glb`;
  await io.write(out, doc);
  const nb = getBounds(root.listScenes()[0]);
  meta[key] = { size: nb.max.map((v, k) => +(v - nb.min[k]).toFixed(2)), tris: tris() };
  console.log(key, before, "->", tris(), (fs.statSync(out).size / 1e3).toFixed(0) + "KB", meta[key].size.join("x"));
}
fs.writeFileSync(`${outDir}/props.meta.json`, JSON.stringify(meta, null, 1));
