import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SpeciesId } from "@/lib/island/types";
import META from "./dinoSkins.meta.json";

export { SKIN_CREDITS } from "./dinoCredits";

/**
 * Real, scanned-and-sculpted dinosaur models (CC BY, from Sketchfab via
 * Objaverse), prepared offline: each one faces +z, stands on y = 0 and is
 * one body length long, and its animations are baked into a texture of bone
 * matrices (three texels per bone per frame, half floats). That lets every
 * animal of a species draw in a single instanced call, each playing its own
 * clip at its own time, with a short crossfade between clips.
 */

export type ClipName =
  | "walk"
  | "run"
  | "idle"
  | "graze"
  | "rest"
  | "roar"
  | "sniff"
  | "eat"
  | "attack"
  | "look"
  | "creep"
  | "tail"
  | "fly"
  | "glide"
  | "swim";

export interface ClipMeta {
  row: number;
  frames: number;
  dur: number;
}

export interface SkinMeta {
  bones: number;
  rows: number;
  clips: Partial<Record<ClipName, ClipMeta>>;
  height: number;
  width: number;
}

export const SKIN_META = META as unknown as Record<SpeciesId, SkinMeta>;

export interface Skin {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material | THREE.Material[];
  depth: THREE.Material;
  meta: SkinMeta;
}

const VERT_PARS = /* glsl */ `
uniform highp sampler2D uBake;
attribute vec4 bakeBone;
attribute vec4 bakeWeight;
attribute vec3 aAnimA;
attribute vec3 aAnimB;
attribute float aFade;
mat4 bakeSkin;
mat4 bakeRow(float bone, float row) {
  int x = int(bone + 0.5) * 3;
  int y = int(row + 0.5);
  vec4 r0 = texelFetch(uBake, ivec2(x, y), 0);
  vec4 r1 = texelFetch(uBake, ivec2(x + 1, y), 0);
  vec4 r2 = texelFetch(uBake, ivec2(x + 2, y), 0);
  return transpose(mat4(r0, r1, r2, vec4(0.0, 0.0, 0.0, 1.0)));
}
mat4 bakeBoneAt(float bone) {
  mat4 m = bakeRow(bone, aAnimA.x) * (1.0 - aAnimA.z) + bakeRow(bone, aAnimA.y) * aAnimA.z;
  if (aFade > 0.001) {
    mat4 b = bakeRow(bone, aAnimB.x) * (1.0 - aAnimB.z) + bakeRow(bone, aAnimB.y) * aAnimB.z;
    m = m * (1.0 - aFade) + b * aFade;
  }
  return m;
}
mat4 bakeSkinMatrix() {
  mat4 m = bakeBoneAt(bakeBone.x) * bakeWeight.x;
  if (bakeWeight.y > 0.0) m += bakeBoneAt(bakeBone.y) * bakeWeight.y;
  if (bakeWeight.z > 0.0) m += bakeBoneAt(bakeBone.z) * bakeWeight.z;
  if (bakeWeight.w > 0.0) m += bakeBoneAt(bakeBone.w) * bakeWeight.w;
  return m;
}
`;

function patch(material: THREE.Material, bake: THREE.DataTexture) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: bake };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("void main() {", "void main() {\n\tbakeSkin = bakeSkinMatrix();")
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n\tobjectNormal = normalize(mat3(bakeSkin) * objectNormal);",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n\ttransformed = (bakeSkin * vec4(transformed, 1.0)).xyz;",
      );
  };
  // One program per species (each has its own bake texture bound as a uniform).
  material.customProgramCacheKey = () => "baked-skin";
}

const cache = new Map<SpeciesId, Promise<Skin>>();

/** Loads a species' model and its baked animations (once). */
export function loadSkin(sp: SpeciesId): Promise<Skin> {
  let p = cache.get(sp);
  if (!p) {
    p = (async () => {
      const meta = SKIN_META[sp];
      const [gltf, bin] = await Promise.all([
        new GLTFLoader().loadAsync(`/dinos/${sp}.glb`),
        fetch(`/dinos/${sp}.anim.bin`).then((r) => {
          if (!r.ok) throw new Error(`${sp} animations: ${r.status}`);
          return r.arrayBuffer();
        }),
      ]);
      const bake = new THREE.DataTexture(
        new Uint16Array(bin),
        meta.bones * 3,
        meta.rows,
        THREE.RGBAFormat,
        THREE.HalfFloatType,
      );
      bake.minFilter = bake.magFilter = THREE.NearestFilter;
      bake.generateMipmaps = false;
      bake.needsUpdate = true;
      // One primitive per material comes back as one mesh each: merge them.
      const parts: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh);
      });
      if (!parts.length) throw new Error(`${sp}: no mesh`);
      const geos = parts.map((m) => {
        const g = m.geometry.clone();
        const bone = g.getAttribute("_bakebone");
        const weight = g.getAttribute("_bakeweight");
        if (!bone || !weight) throw new Error(`${sp}: not a baked model`);
        // Plain (non-interleaved) copies so the parts can be merged.
        const plain = new THREE.BufferGeometry();
        for (const name of ["position", "normal", "uv"]) {
          const a = g.getAttribute(name);
          if (a) plain.setAttribute(name, copyAttr(a));
        }
        if (!plain.getAttribute("uv"))
          plain.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bone.count * 2), 2));
        plain.setAttribute("bakeBone", copyAttr(bone));
        plain.setAttribute("bakeWeight", copyAttr(weight));
        plain.setIndex(g.index);
        if (!plain.getAttribute("normal")) plain.computeVertexNormals();
        return plain;
      });
      const geometry = geos.length > 1 ? mergeGeometries(geos, true) : geos[0];
      if (!geometry) throw new Error(`${sp}: parts don't merge`);
      const list = parts.map((m) => m.material as THREE.MeshStandardMaterial);
      for (const mat of list) {
        mat.roughness = 0.8;
        mat.metalness = 0;
        mat.envMapIntensity = 0.6;
        // Some source textures carry stray alpha: skin is always opaque.
        mat.alphaTest = 0;
        mat.transparent = false;
        patch(mat, bake);
      }
      const materials: THREE.Material | THREE.Material[] = list.length > 1 ? list : list[0];
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patch(depth, bake);
      return { geometry, materials, depth, meta };
    })();
    cache.set(sp, p);
  }
  return p;
}

function copyAttr(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/** Where a clip is at time t: two rows to blend and how far between them. */
export function clipRows(c: ClipMeta, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = (((t / c.dur) % 1) + 1) % 1;
  const f = u * c.frames;
  const i = Math.floor(f);
  return out.set(c.row + i, c.row + ((i + 1) % c.frames), f - i);
}
