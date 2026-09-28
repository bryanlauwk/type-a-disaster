import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "fs";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const TARGET = { titan: 12000, hornface: 8844, duckbill: 11000, plateback: 10000, snapper: 7000, tyrant: 5967, raptor: 7380, skywing: 5227, leviathan: 12000, raptor_2: 7380, hornface_2: 6264, duckbill_2: 8082, tyrant_2: 9000, skywing_2: 5227, leviathan_2: 9000 };
const ADJUST = { raptor: { hue: 28, saturation: 0.55, brightness: 0.92 }, hornface: { saturation: 0.38, brightness: 0.8, hue: -6 }, duckbill: { tint: { r: 150, g: 128, b: 88 }, brightness: 0.95 }, hornface_2: { saturation: 0.35, brightness: 0.85, tint: { r: 138, g: 124, b: 100 } }, tyrant_2: { saturation: 0.6, brightness: 0.9, tint: { r: 128, g: 116, b: 88 } }, duckbill_2: { saturation: 0.7, brightness: 0.9 } };
fs.mkdirSync("/tmp/claude-0/dino/final", { recursive: true });
for (const sp of process.argv.slice(2)) {
  const doc = await io.read(`/tmp/claude-0/dino/baked/${sp}.raw.glb`);
  const root = doc.getRoot();
  let tris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.getIndices().getCount() / 3, 0), 0);
  const before = tris();
  if (sp === 'snapper') for (const m of root.listMeshes()) for (const p of m.listPrimitives()) p.setAttribute('NORMAL', null);
  await doc.transform(weld({}));
  const want = TARGET[sp];
  if (before > want * 1.05) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: want / before, error: sp === "snapper" ? 0.05 : 0.004, lockBorder: false }));
  if (ADJUST[sp]) for (const t of root.listTextures()) {
    // Only colour maps.
    const isColor = root.listMaterials().some((m) => m.getBaseColorTexture() === t);
    if (!isColor) continue;
    const { tint, ...mod } = ADJUST[sp];
    let img = sharp(Buffer.from(t.getImage())).modulate(mod);
    if (tint) img = sharp(await img.png().toBuffer()).tint(tint);
    const buf = await img.png().toBuffer();
    t.setImage(new Uint8Array(buf));
  }
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 82 }), dedup(), prune());
  const out = `/tmp/claude-0/dino/final/${sp}.glb`;
  await io.write(out, doc);
  console.log(sp, before, "->", tris(), (fs.statSync(out).size / 1e6).toFixed(2) + "MB");
}
