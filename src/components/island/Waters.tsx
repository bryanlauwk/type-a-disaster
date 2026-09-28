import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  HALF,
  LAKE,
  RIVER,
  SEA,
  SIZE,
  idx,
  inBounds,
  tx,
  ty,
  wx,
  wz,
  type Tile,
} from "@/lib/island/types";
import { around } from "@/lib/island/terrain";
import { env } from "./fx/env";
import { lavaGeometry, lavaMaterial, tickLava } from "./Eruption";
import { Puffs } from "./fx/vfx";

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** Shared by the sea and the tsunami: where the sea is pulled back, and by how much. */
export const seaFx = {
  /** Centre of the drawdown (world x, z) and its reach. */
  drawX: 0,
  drawZ: 0,
  drawR: 20,
  /** 0 = normal sea; 1 = the sea sucked far out. */
  draw: 0,
};

let waterNormals: THREE.Texture | null = null;
/** The ripple normal map shared by all water (three.js example texture, MIT). */
export function waterNormalMap(): THREE.Texture {
  if (!waterNormals) {
    waterNormals = new THREE.TextureLoader().load("/textures/water/normals.webp");
    waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
    waterNormals.anisotropy = 4;
  }
  return waterNormals;
}

// Gerstner swell: four trains of waves rolling in from the open ocean,
// smaller and steeper where the water shallows, with the tsunami's drawdown.
const WAVES = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeight;
uniform vec4 uDraw;   // x, z, reach, amount
uniform float uOuter;
uniform float uNearHalf;
float groundAt(vec2 p) {
  vec2 uv = (p + ${HALF.toFixed(1)}) / ${SIZE.toFixed(1)};
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -6.0;
  // Ease into the open ocean's depth towards the map's edge, so there's no seam.
  vec2 e = abs(uv * 2.0 - 1.0);
  return mix(texture2D(uHeight, uv).r * 16.0 - 8.0, -6.0, smoothstep(0.8, 0.99, max(e.x, e.y)));
}
vec3 gerstner(vec2 p, vec2 dir, float len, float amp, float steep, inout vec3 tang, inout vec3 bin) {
  float k = 6.2831853 / len;
  float c = sqrt(9.8 / k) * 0.35;
  vec2 d = normalize(dir);
  float f = k * (dot(d, p) - c * uTime);
  float a = amp;
  float q = steep / (k * a * 4.0 + 0.0001);
  tang += vec3(-d.x * d.x * q * k * a * sin(f), d.x * k * a * cos(f), -d.x * d.y * q * k * a * sin(f));
  bin += vec3(-d.x * d.y * q * k * a * sin(f), d.y * k * a * cos(f), -d.y * d.y * q * k * a * sin(f));
  return vec3(d.x * q * a * cos(f), a * sin(f), d.y * q * a * cos(f));
}
float drawdown(vec2 p) {
  float d = length(p - uDraw.xy);
  return uDraw.w * smoothstep(uDraw.z, uDraw.z * 0.35, d);
}
`;

const SEA_VERTEX = /* glsl */ `
${WAVES}
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float depth = -groundAt(w.xz);
  // Waves die down over the shallows and on the far horizon (no mesh there).
  float calm = smoothstep(0.05, 2.5, depth);
  // The swell fades out towards the edge of the finely divided sea, so it meets
  // the open ocean without a seam.
  calm *= (1.0 - uOuter) * (1.0 - smoothstep(uNearHalf - 34.0, uNearHalf - 2.0, max(abs(w.x), abs(w.z))));
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bin = vec3(0.0, 0.0, 1.0);
  vec3 off = vec3(0.0);
  // Trade-wind swell from the south-east, with cross-seas on top.
  off += gerstner(w.xz, vec2(-0.62, -0.78), 15.0, 0.14 * calm, 0.5, tang, bin);
  off += gerstner(w.xz, vec2(-0.85, -0.35), 9.3, 0.08 * calm, 0.45, tang, bin);
  off += gerstner(w.xz, vec2(-0.2, -0.95), 5.1, 0.045 * calm, 0.45, tang, bin);
  off += gerstner(w.xz, vec2(0.55, -0.7), 2.7, 0.022 * calm, 0.4, tang, bin);
  off += gerstner(w.xz, vec2(-0.9, 0.25), 1.6, 0.012 * calm, 0.35, tang, bin);
  w.xyz += off;
  w.y -= drawdown(w.xz) * 1.4;
  vWorld = w.xyz;
  vNormalW = normalize(cross(bin, tang));
  vCrest = off.y;
  vDepth = depth;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SEA_FRAGMENT = /* glsl */ `
${WAVES}
${NOISE}
uniform float uLight;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform sampler2D uRipples;
uniform float uBlue;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vCrest;
varying float vDepth;
#include <fog_pars_fragment>
void main() {
  vec2 q = vWorld.xz;
  // The open-ocean ring leaves the middle to the finely divided near sea.
  if (uOuter > 0.5 && max(abs(q.x), abs(q.y)) < uNearHalf - 0.5) discard;
  float depth = -groundAt(q) - drawdown(q) * 1.4;
  if (depth < -0.02) discard;
  // Fine ripples on top of the swell.
  vec3 r1 = texture2D(uRipples, q * 0.11 + vec2(uTime * 0.012, uTime * 0.008)).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipples, q * 0.037 - vec2(uTime * 0.006, -uTime * 0.01)).xyz * 2.0 - 1.0;
  vec3 r3 = texture2D(uRipples, q * 0.43 + vec2(-uTime * 0.03, uTime * 0.02)).xyz * 2.0 - 1.0;
  vec3 rip = r1 * 0.5 + r2 * 0.35 + r3 * 0.25;
  vec3 n = normalize(vNormalW + vec3(rip.x, 0.0, rip.y) * 0.45);
  vec3 view = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, view), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Reflected sky: bright near the horizon, bluer overhead.
  vec3 refl = reflect(-view, n);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.5, refl.y));
  // Sun glitter.
  vec3 h = normalize(uSun + view);
  float spec = pow(max(dot(n, h), 0.0), 380.0) * 18.0 + pow(max(dot(n, h), 0.0), 40.0) * 0.35;
  // Water colour: light absorbed with depth, turquoise over sand.
  float absorb = 1.0 - exp(-max(depth, 0.0) * 0.9);
  vec3 body = mix(uShallow, uDeep, absorb);
  // Light through the backs of the waves.
  float sss = pow(max(dot(view, -uSun), 0.0), 3.0) * max(vCrest, 0.0) * 6.0 + max(vCrest, 0.0) * 1.4;
  body += vec3(0.05, 0.28, 0.24) * sss;
  vec3 col = mix(body, sky, fres * 0.85);
  // Surf and whitecaps.
  float churn = vnoise(q * 2.3 + vec2(uTime * 0.6, -uTime * 0.4)) * 0.6 + vnoise(q * 7.0 - uTime * 0.8) * 0.4;
  float shore = (1.0 - smoothstep(0.0, 0.35, depth));
  float bands = 0.5 + 0.5 * sin(depth * 26.0 - uTime * 2.4 + churn * 3.0);
  float foam = shore * smoothstep(0.45, 0.85, churn * 0.55 + bands * 0.6);
  foam = max(foam, smoothstep(0.14, 0.22, vCrest) * smoothstep(0.68, 0.85, churn) * 0.7);
  col = mix(col, vec3(0.93, 0.96, 0.96), foam * 0.9);
  col = col * uLight + uSunColor * spec * uLight;
  // Deep water is opaque, so the edge of the sea bed never shows through.
  float alpha = mix(0.35, 1.0, smoothstep(0.02, 2.2, depth));
  alpha = max(alpha, max(foam * 0.95, fres));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
  if (uBlue > 0.001) {
    // The park map: navy sea, a bright coastline, depth rings and the grid.
    vec2 gq = q / 8.0;
    vec2 gd = abs(fract(gq + 0.5) - 0.5) / max(fwidth(gq), vec2(1e-4));
    float grid = 1.0 - clamp(min(gd.x, gd.y), 0.0, 1.0);
    float dk = depth * 1.2;
    float ring = (1.0 - clamp(abs(fract(dk + 0.5) - 0.5) / max(fwidth(dk), 1e-4), 0.0, 1.0)) * (1.0 - smoothstep(1.0, 4.0, depth));
    float coast = 1.0 - smoothstep(0.0, 0.35, depth);
    vec3 bp = vec3(0.01, 0.035, 0.08) + vec3(0.05, 0.18, 0.28) * grid * 0.35 + vec3(0.1, 0.4, 0.55) * ring * 0.3;
    bp = mix(bp, vec3(0.45, 0.9, 1.0), coast * 0.8);
    gl_FragColor = vec4(mix(gl_FragColor.rgb, bp, uBlue), mix(gl_FragColor.a, 1.0, uBlue));
  }
}`;

const SWELL: [number, number, number, number][] = [
  // direction x, z, wavelength, height (matching the sea shader's first trains)
  [-0.62, -0.78, 15.0, 0.14],
  [-0.85, -0.35, 9.3, 0.08],
  [-0.2, -0.95, 5.1, 0.045],
];

/**
 * The height of the sea's surface at a point, the same swell the sea is drawn
 * with (its main wave trains), so boats ride it. `depth` is how deep the
 * water is there: the swell dies down over the shallows.
 */
export function seaHeightAt(x: number, z: number, time: number, depth: number) {
  const calm = Math.min(1, Math.max(0, (depth - 0.05) / 2.45));
  const c2 = calm * calm * (3 - 2 * calm);
  let y = 0;
  for (const [dx, dz, len, amp] of SWELL) {
    const l = Math.hypot(dx, dz);
    const k = (Math.PI * 2) / len;
    const c = Math.sqrt(9.8 / k) * 0.35;
    y += amp * c2 * Math.sin(k * ((dx / l) * x + (dz / l) * z - c * time));
  }
  return y;
}

/** Island heights as a texture, so the sea knows how deep it is. */
function heightTexture(tiles: Tile[]) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  tiles.forEach((t, i) => {
    const v = Math.max(0, Math.min(255, Math.round(((t.h + 8) / 16) * 255)));
    data[i * 4] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const SUN_COLOR = new THREE.Color();
/** Size of the finely divided sea around the island. */
const NEAR = SIZE + 80;

/**
 * The ocean: a swell of Gerstner waves that shoals and breaks over the
 * shallows, sky reflections and sun glitter, turquoise where it's shallow and
 * deep blue off the shelf, with surf along every shore.
 */
export function Sea({ tiles }: { tiles: Tile[] }) {
  const heights = useMemo(() => heightTexture(tiles), [tiles]);
  useEffect(() => () => heights.dispose(), [heights]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SEA_VERTEX,
        fragmentShader: SEA_FRAGMENT,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uLight: { value: 1 },
            uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
            uSunColor: { value: new THREE.Color("#fff3dc") },
            uDeep: { value: new THREE.Color("#0b3144") },
            uShallow: { value: new THREE.Color("#2fa3a0") },
            uSky: { value: new THREE.Color("#6f9fc6") },
            uHorizon: { value: new THREE.Color("#cfe0ea") },
            uHeight: { value: null as THREE.Texture | null },
            uRipples: { value: null as THREE.Texture | null },
            uDraw: { value: new THREE.Vector4(0, 0, 20, 0) },
            uOuter: { value: 0 },
            uNearHalf: { value: NEAR / 2 },
            uBlue: { value: 0 },
          },
        ]),
        transparent: true,
        // The surface goes in the depth buffer, so the ambient-occlusion pass
        // sees the water rather than the sea bed beneath it.
        depthWrite: true,
        fog: true,
      }),
    [],
  );
  // The open ocean shares everything but its flag.
  const outer = useMemo(() => {
    const m = material.clone();
    m.uniforms = { ...material.uniforms, uOuter: { value: 1 } };
    return m;
  }, [material]);
  useEffect(
    () => () => {
      material.dispose();
      outer.dispose();
    },
    [material, outer],
  );
  const scene = useThree((st) => st.scene);
  useFrame(({ clock }) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uLight.value = 0.22 + env.daylight * 0.85 + env.flash * 0.3;
    u.uHeight.value = heights;
    u.uRipples.value = waterNormalMap();
    u.uDraw.value.set(seaFx.drawX, seaFx.drawZ, seaFx.drawR, seaFx.draw);
    u.uBlue.value = env.blueprint;
    // The sky it reflects follows the real sky.
    const bg = scene.background as THREE.Color | null;
    if (bg && (bg as THREE.Color).isColor) {
      u.uHorizon.value.copy(bg).lerp(SUN_COLOR.set("#ffffff"), 0.15);
      u.uSky.value.copy(bg).multiplyScalar(0.7);
    }
    const sun = env.sunDir;
    if (sun) u.uSun.value.copy(sun);
    u.uSunColor.value.setRGB(1, 0.93 - env.dusk * 0.25, 0.82 - env.dusk * 0.45);
  });
  return (
    <group>
      {/* Near sea: finely divided so the swell can roll. */}
      <mesh rotation-x={-Math.PI / 2} material={material} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[NEAR, NEAR, 300, 300]} />
      </mesh>
      {/* Open ocean out to the horizon. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={-0.01}
        material={outer}
        renderOrder={1}
        frustumCulled={false}
      >
        <planeGeometry args={[1800, 1800, 8, 8]} />
      </mesh>
    </group>
  );
}

const FRESH_VERTEX = /* glsl */ `
attribute vec3 color;
attribute float flow;
attribute float edge;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFlow;
varying float vEdge;
void main() {
  vColor = color;
  vFlow = flow;
  vEdge = edge;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRESH_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
uniform vec3 uSky;
uniform sampler2D uRipples;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFlow;
varying float vEdge;
${NOISE}
void main() {
  vec2 q = vWorld.xz;
  // Floodwater spreads in ragged sheets, not tile squares.
  float flood0 = step(0.3, vFlow) * step(vFlow, 0.5);
  float rag = (vnoise(q * 1.7) - 0.5) * 0.5 + (vnoise(q * 5.0) - 0.5) * 0.2;
  float sheet = mix(1.0, smoothstep(0.3, 0.55, vEdge + rag), flood0);
  if (sheet < 0.01) discard;
  // Ripples dragged downstream; still water barely stirs.
  vec3 r1 = texture2D(uRipples, q * 0.35 + vec2(uTime * 0.05, uTime * 0.12) * vFlow).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipples, q * 0.9 - vec2(uTime * 0.03, uTime * 0.2) * vFlow).xyz * 2.0 - 1.0;
  vec3 n = normalize(vec3((r1.x + r2.x * 0.6) * 0.5, 1.0, (r1.y + r2.y * 0.6) * 0.5));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
  vec3 h = normalize(uSun + view);
  float spec = pow(max(dot(n, h), 0.0), 220.0) * 6.0;
  float foam = smoothstep(0.7, 0.9, vnoise(q * 3.0 - vec2(0.0, uTime * 1.5 * vFlow)) * r1.z) * vFlow;
  // Floodwater (flow ~0.4) is murky and lets the ground show through.
  float flood = step(0.3, vFlow) * step(vFlow, 0.5);
  vec3 col = mix(vColor, uSky, fres * mix(0.8, 0.35, flood));
  col = mix(col, vec3(0.92), foam * 0.5);
  col = col * uLight + spec * uLight * mix(1.0, 0.4, flood);
  gl_FragColor = vec4(col, mix(mix(0.78, 0.95, fres), 0.62, flood) * sheet);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RIVER_C = new THREE.Color("#3f7f8a");
const LAKE_C = new THREE.Color("#35707e");
const LAGOON_C = new THREE.Color("#5fbdb0");
const FLOOD_C = new THREE.Color("#6b6948");
const CRATER_C = new THREE.Color("#2c6a78");

/** Surface height of a wet tile. */
function surface(t: Tile): number {
  if (t.water === RIVER || t.water === LAKE) return t.h - 0.04;
  return t.h + 0.08;
}

// Rivers and lakes are drawn by the ground itself (smooth banks); this mesh is
// for water that spills over it: floods.
const wetTile = (t: Tile) =>
  t.flood > 0 && t.water !== SEA && t.water !== RIVER && t.water !== LAKE;

/**
 * Rivers, lakes, ponds and floodwater: one mesh with a quad per wet tile,
 * corners shared so rivers run smoothly downhill.
 */
export function FreshWater({ tiles, except }: { tiles: Tile[]; except?: Set<number> }) {
  // Floodwater the act on screen is drawing itself is left to it.
  const wet = (t: Tile, i: number) => wetTile(t) && !except?.has(i);
  const geometry = useMemo(() => {
    const corner = (cx: number, cz: number) => {
      // Average surface of the wet tiles around this corner.
      let sum = 0;
      let n = 0;
      for (const [dx, dz] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ]) {
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(x, z)) continue;
        const t = tiles[idx(x, z)];
        if (!wet(t, idx(x, z))) continue;
        sum += surface(t);
        n += 1;
      }
      return n ? sum / n : 0;
    };
    const wetShare = (cx: number, cz: number) => {
      let n = 0;
      for (const [dx, dz] of [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [0, 0],
      ]) {
        const x = cx + dx;
        const z = cz + dz;
        if (inBounds(x, z) && wet(tiles[idx(x, z)], idx(x, z))) n++;
      }
      return n / 4;
    };
    const pos: number[] = [];
    const col: number[] = [];
    const flow: number[] = [];
    const edge: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!wet(t, i)) continue;
      const x = tx(i);
      const z = ty(i);
      const c =
        t.biome === "lagoon"
          ? LAGOON_C
          : t.water === RIVER
            ? RIVER_C
            : t.water === LAKE
              ? t.landmark === "crater_lake" || t.region === "titan_highlands"
                ? CRATER_C
                : LAKE_C
              : FLOOD_C;
      const f = t.water === RIVER ? 1 : t.water === LAKE ? 0.15 : 0.4;
      const own = surface(t);
      const h = (cx: number, cz: number) =>
        Math.max(own - 0.35, Math.min(own + 0.35, corner(cx, cz)));
      const quad = [
        [x, z],
        [x + 1, z],
        [x + 1, z + 1],
        [x, z],
        [x + 1, z + 1],
        [x, z + 1],
      ];
      for (const [cx, cz] of quad) {
        pos.push(cx - HALF, h(cx, cz), cz - HALF);
        col.push(c.r, c.g, c.b);
        flow.push(f);
        edge.push(wetShare(cx, cz));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 1));
    g.setAttribute("edge", new THREE.Float32BufferAttribute(edge, 1));
    g.computeBoundingSphere();
    return g;
  }, [tiles, except]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FRESH_VERTEX,
        fragmentShader: FRESH_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uLight: { value: 1 },
          uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
          uSky: { value: new THREE.Color("#9fc0d6") },
          uRipples: { value: null as THREE.Texture | null },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const scene = useThree((st) => st.scene);
  useFrame(({ clock }) => {
    const u = material.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uLight.value = 0.25 + env.daylight * 0.8 + env.flash * 0.3;
    u.uRipples.value = waterNormalMap();
    if (env.sunDir) u.uSun.value.copy(env.sunDir);
    const bg = scene.background as THREE.Color | null;
    if (bg && bg.isColor) u.uSky.value.copy(bg);
  });
  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}

/** Molten lava: the crater's pool and any flows still cooling, crusting over as they do. */
export function Lava({ tiles, except }: { tiles: Tile[]; except?: Set<number> }) {
  const geometry = useMemo(() => {
    const cover: number[] = [];
    tiles.forEach((t, i) => {
      if ((t.lava > 0 || t.biome === "lava") && !except?.has(i)) cover.push(i);
    });
    return lavaGeometry(
      tiles,
      cover,
      () => -100,
      (i) => (tiles[i].lava === 0 ? 1 : Math.min(1, 0.25 + tiles[i].lava / 10)),
    );
  }, [tiles, except]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => lavaMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => tickLava(material, clock.elapsedTime));
  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}

/** Waterfalls where rivers drop off a ledge, with mist at the foot. */
export function Waterfalls({ tiles }: { tiles: Tile[] }) {
  const falls = useMemo(() => {
    const out: {
      x: number;
      z: number;
      top: number;
      bottom: number;
      ang: number;
      big: boolean;
      seed: number;
    }[] = [];
    tiles.forEach((t, i) => {
      if (!t.falls || t.water !== RIVER) return;
      // The lowest wet neighbour is where it drops to.
      const below = around(i)
        .filter((n) => tiles[n].water)
        .sort((a, b) => tiles[a].h - tiles[b].h)[0];
      if (below === undefined) return;
      const top = t.h - 0.04;
      const bottom = Math.max(tiles[below].h, 0) - 0.04;
      if (top - bottom < 0.3) return;
      out.push({
        x: (wx(i) + wx(below)) / 2,
        z: (wz(i) + wz(below)) / 2,
        top,
        bottom,
        ang: Math.atan2(wz(below) - wz(i), wx(below) - wx(i)),
        big: t.landmark === "thunder_falls",
        seed: i,
      });
    });
    return out;
  }, [tiles]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uLight;
varying vec2 vUv;
${NOISE}
void main() {
  float streak = vnoise(vec2(vUv.x * 18.0, vUv.y * 3.0 + uTime * 3.5));
  float a = mix(0.55, 0.95, streak);
  vec3 col = mix(vec3(0.55, 0.72, 0.78), vec3(0.97), streak) * uLight;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
        uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.3 + env.daylight * 0.75;
  });
  const clock = useMemo(() => {
    const start = performance.now();
    return () => (performance.now() - start) / 1000;
  }, []);
  return (
    <group>
      {falls.map((f, k) => (
        <group key={k} position={[f.x, 0, f.z]} rotation-y={-f.ang + Math.PI / 2}>
          <mesh material={material} position={[0, (f.top + f.bottom) / 2, 0]}>
            <planeGeometry args={[f.big ? 1.4 : 0.8, f.top - f.bottom]} />
          </mesh>
          <Puffs
            getT={clock}
            origin={[0, f.bottom + 0.1, 0]}
            count={f.big ? 40 : 14}
            duration={2.5}
            spread={f.big ? 1.2 : 0.5}
            rise={f.big ? 1.6 : 0.8}
            size={f.big ? [0.5, 1.6] : [0.25, 0.7]}
            color="#f4f8fa"
            opacity={0.55}
            loop
            seed={f.seed}
          />
        </group>
      ))}
    </group>
  );
}

export const worldOf = (i: number) => ({ x: wx(i), z: wz(i) });
export const tileIndex = (x: number, z: number) => idx(Math.floor(x + HALF), Math.floor(z + HALF));
export const GRID = SIZE;
