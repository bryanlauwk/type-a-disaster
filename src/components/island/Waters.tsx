import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
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
import { Puffs } from "./fx/vfx";

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const SEA_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SEA_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform sampler2D uHeight;
varying vec3 vWorld;
${NOISE}
float groundAt(vec2 p) {
  vec2 uv = (p + 32.0) / 64.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -6.0;
  return texture2D(uHeight, uv).r * 16.0 - 8.0;
}
void main() {
  vec2 q = vWorld.xz;
  float depth = -groundAt(q);
  // Swell rolling in, with small chop on top.
  float n1 = vnoise(q * 0.35 + vec2(uTime * 0.08, uTime * 0.05));
  float n2 = vnoise(q * 1.4 - vec2(uTime * 0.25, -uTime * 0.18));
  float n3 = vnoise(q * 4.0 + vec2(uTime * 0.6, uTime * 0.4));
  vec3 n = normalize(vec3((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.35 + (n3 - 0.5) * 0.15, 1.0, (n2 - 0.5) * 0.4 + (n3 - 0.5) * 0.2));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 90.0);
  // Turquoise over the sand, deep blue where the shelf drops away.
  vec3 col = mix(uShallow, uDeep, smoothstep(0.2, 2.2, depth));
  col += vec3(0.55, 0.68, 0.75) * fres * 0.4;
  // Surf breaking along the shore, pulsing with the swell.
  float surf = (1.0 - smoothstep(0.0, 0.28, depth)) * step(-0.05, depth);
  float churn = vnoise(q * 3.5 + vec2(uTime * 0.7, -uTime * 0.5));
  float wave = 0.5 + 0.5 * sin(depth * 22.0 - uTime * 2.2 + churn * 3.0);
  float foam = surf * smoothstep(0.35, 0.8, churn * 0.6 + wave * 0.6);
  col = mix(col, vec3(0.95, 0.97, 0.96), foam * 0.85);
  col = col * uLight + vec3(1.0, 0.96, 0.88) * spec * 0.9 * uLight;
  float alpha = mix(0.55, 1.0, smoothstep(0.15, 1.6, depth));
  alpha = max(alpha, foam * 0.9);
  if (depth < -0.05) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

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

/** The ocean around the island: see-through over the shallows, deep blue beyond. */
export function Sea({ tiles }: { tiles: Tile[] }) {
  const heights = useMemo(() => heightTexture(tiles), [tiles]);
  useEffect(() => () => heights.dispose(), [heights]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SEA_VERTEX,
        fragmentShader: SEA_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uLight: { value: 1 },
          uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
          uDeep: { value: new THREE.Color("#12405a") },
          uShallow: { value: new THREE.Color("#3a9aa0") },
          uHeight: { value: null as THREE.Texture | null },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.22 + env.daylight * 0.85 + env.flash * 0.3;
    material.uniforms.uHeight.value = heights;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.0} material={material} renderOrder={1}>
      <planeGeometry args={[320, 320, 1, 1]} />
    </mesh>
  );
}

const FRESH_VERTEX = /* glsl */ `
attribute vec3 color;
attribute float flow;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFlow;
void main() {
  vColor = color;
  vFlow = flow;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRESH_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
varying vec3 vColor;
varying vec3 vWorld;
varying float vFlow;
${NOISE}
void main() {
  vec2 q = vWorld.xz * 2.0;
  float a = vnoise(q + vec2(uTime * 0.9 * vFlow, uTime * 0.7 * vFlow));
  float b = vnoise(q * 2.3 - vec2(uTime * 0.6, -uTime * 0.8 * vFlow));
  vec3 n = normalize(vec3(a - 0.5, 1.2, b - 0.5));
  vec3 view = normalize(cameraPosition - vWorld);
  float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 60.0);
  float foam = smoothstep(0.72, 0.9, a * b * 1.8) * vFlow;
  vec3 col = mix(vColor, vec3(0.92), foam * 0.6) * (0.75 + 0.25 * max(dot(n, uSun), 0.0));
  col = col * uLight + spec * 0.6 * uLight;
  gl_FragColor = vec4(col, 0.86);
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

const wet = (t: Tile) => t.water === RIVER || t.water === LAKE || (t.flood > 0 && t.water !== SEA);

/**
 * Rivers, lakes, ponds and floodwater: one mesh with a quad per wet tile,
 * corners shared so rivers run smoothly downhill.
 */
export function FreshWater({ tiles }: { tiles: Tile[] }) {
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
        if (!wet(t)) continue;
        sum += surface(t);
        n += 1;
      }
      return n ? sum / n : 0;
    };
    const pos: number[] = [];
    const col: number[] = [];
    const flow: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!wet(t)) continue;
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
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 1));
    g.computeBoundingSphere();
    return g;
  }, [tiles]);
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
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.25 + env.daylight * 0.8 + env.flash * 0.3;
  });
  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}

const LAVA_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec3 vColor;
varying float vFlow;
${NOISE}
void main() {
  vec2 q = vWorld.xz * 1.6;
  float crust = vnoise(q + vec2(uTime * 0.12, -uTime * 0.08)) * 0.6 + vnoise(q * 3.0 - uTime * 0.2) * 0.4;
  float glow = smoothstep(0.35, 0.75, crust);
  vec3 hot = mix(vec3(1.0, 0.32, 0.05), vec3(1.0, 0.8, 0.3), vnoise(q * 5.0 + uTime));
  vec3 col = mix(vec3(0.12, 0.07, 0.06), hot * (1.2 + vFlow), glow * (0.5 + vFlow * 0.5));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Molten lava: the crater's pool and any flows still cooling. */
export function Lava({ tiles }: { tiles: Tile[] }) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const flow: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (!(t.lava > 0 || t.biome === "lava")) continue;
      const x = wx(i);
      const z = wz(i);
      const y = t.h + 0.06;
      const heat = t.biome === "lava" && t.lava === 0 ? 1 : Math.min(1, t.lava / 6);
      for (const [dx, dz] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ]) {
        pos.push(x + dx * 1.04, y, z + dz * 1.04);
        col.push(1, 0.4, 0.1);
        flow.push(heat);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("flow", new THREE.Float32BufferAttribute(flow, 1));
    return g;
  }, [tiles]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FRESH_VERTEX,
        fragmentShader: LAVA_FRAGMENT,
        uniforms: { uTime: { value: 0 } },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => (material.uniforms.uTime.value = clock.elapsedTime));
  return <mesh geometry={geometry} material={material} />;
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
