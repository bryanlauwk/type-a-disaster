import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  /** Body lengths the feet carry the animal per cycle (moving clips), measured from the bake. */
  travel?: number;
}

export interface SkinMeta {
  bones: number;
  rows: number;
  clips: Partial<Record<ClipName, ClipMeta>>;
  height: number;
  width: number;
}

export const SKIN_META = META as unknown as Record<string, SkinMeta>;

export interface Skin {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material | THREE.Material[];
  depth: THREE.Material;
  meta: SkinMeta;
  /** The baked bone matrices (shared with any feather layers). */
  bake: THREE.DataTexture;
}

const VERT_PARS = /* glsl */ `
uniform highp sampler2D uBake;
attribute vec4 bakeBone;
attribute vec4 bakeWeight;
attribute vec3 aAnimA;
attribute vec3 aAnimB;
attribute float aFade;
attribute vec4 aLook;
attribute vec4 aLook2;
varying vec3 vRest;
varying vec3 vRestN;
varying vec4 vLook;
varying vec4 vLook2;
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
// The first baked frame: a steady, normalised body to lay patterns on.
mat4 bakeRestMatrix() {
  mat4 m = bakeRow(bakeBone.x, 0.0) * bakeWeight.x;
  if (bakeWeight.y > 0.0) m += bakeRow(bakeBone.y, 0.0) * bakeWeight.y;
  if (bakeWeight.z > 0.0) m += bakeRow(bakeBone.z, 0.0) * bakeWeight.z;
  if (bakeWeight.w > 0.0) m += bakeRow(bakeBone.w, 0.0) * bakeWeight.w;
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

const FRAG_PARS = /* glsl */ `
varying vec3 vRest;
varying vec3 vRestN;
varying vec4 vLook;
varying vec4 vLook2;
float lookH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float lookN(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lookH(i), lookH(i + vec3(1, 0, 0)), f.x), mix(lookH(i + vec3(0, 1, 0)), lookH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lookH(i + vec3(0, 0, 1)), lookH(i + vec3(1, 0, 1)), f.x), mix(lookH(i + vec3(0, 1, 1)), lookH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Each animal's own colouring over the model's painted skin: a shift in hue
// and richness, darker back and paler belly, and its markings.
vec3 dinoLook(vec3 c) {
  mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float cs = cos(vLook.x);
  float sn = sin(vLook.x);
  yiq.yz = vec2(yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs) * vLook.y;
  c = max(toRGB * yiq, vec3(0.0));
  float up = vRestN.y;
  // Countershading: sun-side dark, belly pale.
  c *= 1.0 + vLook2.x * (0.25 * smoothstep(0.0, -0.8, up) - 0.2 * smoothstep(0.0, 0.8, up));
  float seed = vLook2.y * 37.0;
  float dorsal = smoothstep(-0.35, 0.5, up);
  float kind = vLook.z;
  float pat = 0.0;
  vec3 q = vRest + seed;
  if (kind > 0.5 && kind < 1.5) {
    // Bands across the back and flanks.
    float f = 7.0 + vLook2.z * 9.0;
    float s = sin((vRest.z * f + lookN(q * 7.0) * 1.3) * 6.2832);
    pat = smoothstep(0.15, 0.75, s);
  } else if (kind > 1.5 && kind < 2.5) {
    // Rosettes and spots.
    float n = lookN(q * (16.0 + vLook2.z * 14.0));
    pat = smoothstep(0.6, 0.72, n);
  } else if (kind > 2.5) {
    // Mottled blotches.
    float n = lookN(q * 5.0) * 0.6 + lookN(q * 12.0) * 0.4;
    pat = smoothstep(0.48, 0.62, n);
  }
  c *= 1.0 - vLook.w * 0.5 * pat * dorsal;
  return c * vLook2.w;
}
`;

/**
 * A layer of a feather coat: the body drawn again a hair further out along
 * its surface, keeping only the strands long enough to reach this far.
 * Several of these stacked read as a soft coat of feathers or fuzz.
 */
export interface Shell {
  /** 0..1, how far out this layer is. */
  at: number;
  /** Coat depth, in body lengths. */
  len: number;
  /** Below this height (body lengths) the legs and feet stay bare scale. */
  legs: number;
}

const SHELL_FRAG = /* glsl */ `
uniform float uShellAt;
uniform float uShellLegs;
float shellH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`;

function patch(material: THREE.Material, bake: THREE.DataTexture, shell?: Shell) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBake = { value: bake };
    if (shell) {
      shader.uniforms.uShellAt = { value: shell.at };
      shader.uniforms.uShellLen = { value: shell.len };
      shader.uniforms.uShellLegs = { value: shell.legs };
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_PARS}`)
      .replace("void main() {", "void main() {\n\tbakeSkin = bakeSkinMatrix();")
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\n\tobjectNormal = normalize(mat3(bakeSkin) * objectNormal);",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
\tmat4 bakeRest = bakeRestMatrix();
\tvRest = (bakeRest * vec4(transformed, 1.0)).xyz;
\tvRestN = normalize(mat3(bakeRest) * normal);${
          shell
            ? `
\t// Out along the surface (in the model's own units), drooping a little.
\tfloat restScale = length(bakeRest[0].xyz);
\ttransformed += (normal * (1.0 - 0.35 * uShellAt) + vec3(0.0, -0.35, 0.0) * uShellAt) * uShellAt * uShellLen / max(restScale, 1e-6);`
            : ""
        }
\tvLook = aLook;
\tvLook2 = aLook2;
\ttransformed = (bakeSkin * vec4(transformed, 1.0)).xyz;`,
      );
    if (shell)
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nuniform float uShellAt;\nuniform float uShellLen;",
      );
    if (shader.fragmentShader.includes("#include <map_fragment>"))
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAG_PARS}${shell ? SHELL_FRAG : ""}`)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
\tdiffuseColor.rgb = dinoLook(diffuseColor.rgb);${
            shell
              ? `
\t// One strand per little cell of the body; fewer reach the outer layers,
\t// and none grow on the lower legs and feet.
\tfloat strand = shellH(floor(vRest * 190.0));
\tif (strand < uShellAt * 0.9 + 0.08 || vRest.y < uShellLegs) discard;
\tdiffuseColor.rgb *= mix(0.62, 1.12, uShellAt);`
              : ""
          }`,
        );
  };
  // One program per species (each has its own bake texture bound as a uniform).
  material.customProgramCacheKey = () => (shell ? "baked-skin-shell" : "baked-skin");
}

/** Materials for a feather coat over a loaded model: one set per layer. */
export function coatLayers(skin: Skin, layers: number, len: number, legs: number) {
  const list = Array.isArray(skin.materials) ? skin.materials : [skin.materials];
  return Array.from({ length: layers }, (_, k) => {
    const shell: Shell = { at: (k + 1) / layers, len, legs };
    const mats = list.map((m) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      c.alphaTest = 0;
      c.side = THREE.DoubleSide;
      patch(c, skin.bake, shell);
      return c;
    });
    return mats.length > 1 ? mats : mats[0];
  });
}

const cache = new Map<string, Promise<Skin>>();

/** Loads a model (a species' look) and its baked animations (once). */
export function loadSkin(sp: string): Promise<Skin> {
  let p = cache.get(sp);
  if (!p) {
    p = (async () => {
      const meta = SKIN_META[sp];
      if (!meta) throw new Error(`${sp}: no baked model`);
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
        // Some source textures carry stray alpha: skin is always opaque. Hair
        // and beards are cut-out cards and keep their holes.
        const cards = /hair|beard|transparency_pbr|obj_default_transparency/i.test(mat.name);
        mat.alphaTest = cards ? 0.5 : 0;
        mat.transparent = false;
        if (cards) mat.side = THREE.DoubleSide;
        patch(mat, bake);
      }
      const materials: THREE.Material | THREE.Material[] = list.length > 1 ? list : list[0];
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patch(depth, bake);
      return { geometry, materials, depth, meta, bake };
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
