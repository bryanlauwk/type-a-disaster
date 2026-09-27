import * as THREE from "three";
import { LAKE, RIVER, SEA, SIZE, type Biome, type Tile } from "@/lib/island/types";

/**
 * Photographed ground for the island: eight CC0 Poly Haven surfaces (aerial
 * grass, forest litter, bare earth, sand, mossy rock, layered cliff, basalt,
 * burnt ground) blended per tile, with their normal maps, triplanar on steep
 * rock, two scales to hide tiling, drifting cloud shadows and a dry-season tint.
 */

export const LAYERS = [
  "grass",
  "forest",
  "dirt",
  "sand",
  "moss",
  "cliff",
  "basalt",
  "burned",
] as const;
type Layer = (typeof LAYERS)[number];
const L = Object.fromEntries(LAYERS.map((l, i) => [l, i])) as Record<Layer, number>;

/** Which surfaces a biome is made of. */
const BIOME_MIX: Record<Biome, Partial<Record<Layer, number>>> = {
  sea: { sand: 1 },
  shallows: { sand: 1 },
  beach: { sand: 1 },
  cliff: { cliff: 0.6, moss: 0.4 },
  lagoon: { sand: 1 },
  mangrove: { forest: 0.55, dirt: 0.45 },
  rock: { moss: 0.55, cliff: 0.45 },
  ash: { basalt: 0.7, dirt: 0.3 },
  lava: { basalt: 1 },
  fern: { grass: 0.7, forest: 0.3 },
  highland: { grass: 0.65, moss: 0.35 },
  conifer: { forest: 0.8, grass: 0.2 },
  ridge: { moss: 0.65, dirt: 0.35 },
  wetland: { grass: 0.45, dirt: 0.55 },
  grass: { grass: 1 },
  plains: { grass: 0.72, dirt: 0.28 },
  jungle: { forest: 1 },
  canyon: { cliff: 0.8, sand: 0.2 },
  tar: { basalt: 1 },
  springs: { dirt: 0.45, moss: 0.35, sand: 0.2 },
  farm: { dirt: 1 },
};

/** A colour cast per biome on top of the photographs (1 = as photographed). */
const BIOME_TINT: Record<Biome, [number, number, number]> = {
  sea: [0.8, 0.85, 0.85],
  shallows: [1, 1, 0.95],
  beach: [1.25, 1.2, 1.1],
  cliff: [1, 1, 1],
  lagoon: [1.15, 1.15, 1.05],
  mangrove: [0.8, 0.95, 0.8],
  rock: [1, 1, 1],
  ash: [1, 0.95, 0.95],
  lava: [1, 0.9, 0.85],
  fern: [0.66, 1.16, 0.55],
  highland: [0.95, 1.05, 0.8],
  conifer: [0.75, 0.95, 0.7],
  ridge: [0.95, 0.95, 0.9],
  wetland: [0.66, 1.0, 0.7],
  grass: [0.72, 1.18, 0.55],
  plains: [1.05, 1.05, 0.75],
  jungle: [0.72, 1.0, 0.68],
  canyon: [1.0, 0.88, 0.78],
  tar: [0.7, 0.65, 0.6],
  springs: [1.1, 1.1, 1.05],
  farm: [1.05, 0.95, 0.8],
};

const STRATA: [number, number, number][] = [
  [1.02, 0.9, 0.8],
  [0.88, 0.74, 0.64],
  [1.12, 1.02, 0.9],
  [0.8, 0.66, 0.56],
];

/** Surface weights (8) and tint (3) for one tile as it is now. */
export function tileGround(t: Tile, slopeRaw: number, w: Float32Array, tint: Float32Array) {
  w.fill(0);
  // Heights per tile shrank when the island grew: compare slopes at the old scale.
  const slope = (slopeRaw * SIZE) / 64;
  const add = (l: Layer, v: number) => (w[L[l]] += v);
  for (const [l, v] of Object.entries(BIOME_MIX[t.biome]) as [Layer, number][]) add(l, v);
  let [r, g, b] = BIOME_TINT[t.biome];
  if (t.water === SEA) {
    // The sea floor darkens with depth.
    const d = Math.max(0.35, 1 + t.h * 0.3);
    r *= d;
    g *= d;
    b *= d;
  } else if (t.water === RIVER || t.water === LAKE) {
    w.fill(0);
    add("dirt", 0.5);
    add("sand", 0.5);
    [r, g, b] = [0.85, 0.85, 0.75];
  } else {
    if (t.biome === "canyon")
      [r, g, b] = STRATA[Math.floor(Math.max(0, t.h) * 2.2) % STRATA.length];
    const soft =
      t.biome !== "beach" &&
      t.biome !== "rock" &&
      t.biome !== "canyon" &&
      t.biome !== "ash" &&
      t.biome !== "tar";
    // Grazed-down ground turns to earth; tree cover drops leaf litter.
    if (soft) add("dirt", Math.max(0, 0.55 - t.veg) * 1.4);
    if (t.forest > 0.3 && soft) add("forest", t.forest * 0.6);
    if (t.trail > 0.05) add("dirt", Math.min(1.5, t.trail * 2));
    if (slope > 1.0 && t.biome !== "beach")
      add(t.biome === "canyon" ? "cliff" : "moss", (slope - 1) * 1.2);
    if (slope > 1.8 && t.biome !== "beach") add("cliff", (slope - 1.8) * 1.5);
    if (t.fire > 0) add("burned", 3);
    if (t.lava > 0) add("basalt", 4);
    if (t.flood > 0) {
      r *= 0.62;
      g *= 0.64;
      b *= 0.66;
    }
    if (t.biome === "beach" && t.h < 0.15) {
      r *= 0.8;
      g *= 0.8;
      b *= 0.8;
    }
  }
  let sum = 0;
  for (let k = 0; k < 8; k++) sum += w[k];
  for (let k = 0; k < 8; k++) w[k] /= sum || 1;
  tint[0] = r;
  tint[1] = g;
  tint[2] = b;
}

export interface GroundTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
}

async function decode(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, size, size);
  return g.getImageData(0, 0, size, size).data;
}

async function arrayTexture(suffix: string, srgb: boolean): Promise<THREE.DataArrayTexture> {
  const size = 512;
  const layers = await Promise.all(
    LAYERS.map((l) => decode(`/textures/ground/${l}${suffix}.webp`, size)),
  );
  const data = new Uint8Array(size * size * 4 * LAYERS.length);
  layers.forEach((d, i) => data.set(d, i * size * size * 4));
  const tex = new THREE.DataArrayTexture(data, size, size, LAYERS.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

let loading: Promise<GroundTextures> | null = null;
export function loadGround(): Promise<GroundTextures> {
  loading ??= Promise.all([arrayTexture("", true), arrayTexture("_n", false)]).then(
    ([albedo, normal]) => ({ albedo, normal }),
  );
  return loading;
}

export const groundUniforms = {
  uAlbedo: { value: null as THREE.DataArrayTexture | null },
  uNormal: { value: null as THREE.DataArrayTexture | null },
  uTime: { value: 0 },
  uDry: { value: 0 },
  uCloud: { value: 1 },
};

/** Turns a standard material into the photographed ground. */
export function groundMaterial(tex: GroundTextures): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true });
  groundUniforms.uAlbedo.value = tex.albedo;
  groundUniforms.uNormal.value = tex.normal;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, groundUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 splatA;
attribute vec4 splatB;
attribute vec2 wet;
varying vec2 vWet;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
vSplatA = splatA;
vSplatB = splatB;
vWet = wet;
vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
uniform float uTime;
uniform float uDry;
uniform float uCloud;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec2 vWet;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
float waterMask;
float gh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gh(i), gh(i + vec2(1.0, 0.0)), u.x), mix(gh(i + vec2(0.0, 1.0)), gh(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Two scales per layer, so the photo never visibly repeats.
vec4 sampleFlat(sampler2DArray s, vec2 p, float layer) {
  return mix(texture(s, vec3(p * 0.42, layer)), texture(s, vec3(p * 0.097 + 0.31, layer)), 0.45);
}
// Rock that wraps cliffs: projected from the three axes.
vec4 sampleTri(sampler2DArray s, vec3 p, vec3 n, float layer) {
  vec3 b = pow(abs(n), vec3(4.0));
  b /= (b.x + b.y + b.z);
  return texture(s, vec3(p.zy * 0.3, layer)) * b.x + sampleFlat(s, p.xz, layer) * b.y + texture(s, vec3(p.xy * 0.3, layer)) * b.z;
}
vec3 groundAlbedo;
vec3 groundNormalW;
float groundRough;
void groundShade() {
  float w[8] = float[8](vSplatA.x, vSplatA.y, vSplatA.z, vSplatA.w, vSplatB.x, vSplatB.y, vSplatB.z, vSplatB.w);
  // Break up the borders between surfaces with noise.
  float jitter = gn(vGroundPos.xz * 0.9) - 0.5;
  vec3 alb = vec3(0.0);
  vec3 nrm = vec3(0.0);
  float wsum = 0.0;
  groundRough = 0.0;
  for (int k = 0; k < 8; k++) {
    float wk = max(0.0, w[k] + jitter * 0.35 * w[k]);
    if (wk < 0.02) continue;
    float layer = float(k);
    bool tri = k == 4 || k == 5 || k == 6;
    vec4 a = tri ? sampleTri(uAlbedo, vGroundPos, vGroundNormal, layer) : sampleFlat(uAlbedo, vGroundPos.xz, layer);
    vec4 nm = tri ? sampleTri(uNormal, vGroundPos, vGroundNormal, layer) : sampleFlat(uNormal, vGroundPos.xz, layer);
    alb += a.rgb * wk;
    nrm += (nm.xyz * 2.0 - 1.0) * wk;
    groundRough += (k == 3 ? 0.97 : k >= 4 && k <= 6 ? 0.82 : 0.92) * wk;
    wsum += wk;
  }
  alb /= max(wsum, 0.001);
  nrm /= max(wsum, 0.001);
  groundRough /= max(wsum, 0.001);
  // The dry season yellows the grass.
  float green = clamp((alb.g - alb.b) * 3.0, 0.0, 1.0) * (vSplatA.x + vSplatA.y * 0.5);
  alb = mix(alb, alb * vec3(1.18, 1.0, 0.7), uDry * green);
  // Large, slow variation so plains aren't one flat colour.
  float macro = gn(vGroundPos.xz * 0.045) * 0.6 + gn(vGroundPos.xz * 0.013 + 7.0) * 0.4;
  alb *= 0.82 + macro * 0.36;
  // Cloud shadows drifting across the island.
  float cloud = smoothstep(0.52, 0.72, gn(vGroundPos.xz * 0.018 + vec2(uTime * 0.012, uTime * 0.006)) * 0.7 + gn(vGroundPos.xz * 0.05 + uTime * 0.02) * 0.3);
  alb *= 1.0 - cloud * 0.28 * uCloud;
  vec3 n = normalize(vGroundNormal);
  // Tangent frame on the ground: +x along u, +z along v.
  groundNormalW = normalize(n + vec3(nrm.x, 0.0, nrm.y) * 0.9 * (1.0 - abs(n.y) * 0.1));
  // Rivers and lakes: a smooth-edged, glassy, rippling surface in the channel.
  float edgeNoise = (gn(vGroundPos.xz * 3.0) - 0.5) * 0.12;
  waterMask = smoothstep(0.42, 0.58, vWet.x + vWet.y + edgeNoise);
  if (waterMask > 0.0) {
    vec2 q = vGroundPos.xz;
    float a1 = gn(q * 2.4 + vec2(uTime * 0.35, uTime * 0.6));
    float a2 = gn(q * 5.5 - vec2(uTime * 0.5, -uTime * 0.3));
    vec3 wn = normalize(vec3((a1 - 0.5) * 0.35 + (a2 - 0.5) * 0.2, 1.0, (a2 - 0.5) * 0.35 - (a1 - 0.5) * 0.15));
    vec3 deep = mix(vec3(0.03, 0.09, 0.1), vec3(0.18, 0.5, 0.48), clamp(vWet.y, 0.0, 1.0));
    float shore = smoothstep(0.0, 0.25, waterMask) * (1.0 - smoothstep(0.25, 0.6, waterMask));
    alb = mix(alb, deep, waterMask * 0.92);
    alb = mix(alb, vec3(0.75, 0.78, 0.74), shore * 0.25);
    groundNormalW = normalize(mix(groundNormalW, wn, waterMask));
    groundRough = mix(groundRough, 0.06, waterMask);
  }
  groundAlbedo = alb;
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
groundShade();
diffuseColor.rgb *= groundAlbedo * 2.2;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = groundRough;`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
metalnessFactor = waterMask * 0.15;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(groundNormalW, 0.0)).xyz);`,
      );
  };
  return m;
}
