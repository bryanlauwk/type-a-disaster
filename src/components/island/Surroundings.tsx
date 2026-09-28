import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { fbm, hash } from "@/lib/island/rng";
import { HALF, SEA, SIZE, idx, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";
import { env } from "./fx/env";

/**
 * The world beyond the island and the life over its shores: other islands
 * on the horizon, blue with distance, and flocks of seabirds wheeling over
 * the cliffs and beaches.
 */

// --- Islands on the horizon --------------------------------------------------

/** A craggy, many-peaked island, one unit across. */
function horizonIsland(seed: number) {
  const flat = new THREE.BufferGeometry();
  const rings = 14;
  const segs = 64;
  const verts: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= rings; r++)
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const rr = r / rings;
      const edge = 1 + (fbm(seed, Math.cos(a) * 1.5 + 3, Math.sin(a) * 1.5 + 3) - 0.5) * 0.7;
      const x = Math.cos(a) * rr * edge;
      const z = Math.sin(a) * rr * edge * 0.55;
      const peak = Math.pow(1 - rr, 1.6) * (0.55 + fbm(seed + 1, x * 3, z * 3) * 0.9);
      const y = peak * (1 + (fbm(seed + 2, x * 7, z * 7) - 0.5) * 0.5) - (rr > 0.95 ? 0.05 : 0);
      verts.push(x, y, z);
    }
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  flat.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  flat.setIndex(index);
  flat.computeVertexNormals();
  return flat;
}

function HorizonIslands({ seed }: { seed: number }) {
  const spots = useMemo(
    () =>
      Array.from({ length: 7 }, (_, k) => {
        const a = (k / 7) * Math.PI * 2 + hash(seed, k, 1) * 0.6;
        const r = 200 + hash(seed, k, 2) * 90;
        return {
          x: Math.cos(a) * r,
          z: Math.sin(a) * r,
          w: 30 + hash(seed, k, 3) * 50,
          h: 8 + hash(seed, k, 4) * 16,
          turn: -a + Math.PI / 2,
          geo: horizonIsland(seed * 7 + k),
        };
      }),
    [seed],
  );
  useEffect(() => () => spots.forEach((s) => s.geo.dispose()), [spots]);
  const material = useMemo(
    // Lit flat and hazed by hand: beyond the fog's reach, but never lost in it.
    () => new THREE.MeshBasicMaterial({ color: "#2f4a3a", fog: false }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    // Far off, they take the colour of the air: bluer and paler than the island.
    const fog = scene.fog as THREE.Fog | null;
    const air = fog ? fog.color : (scene.background as THREE.Color | null);
    material.color.set("#26382e").multiplyScalar(0.4 + env.daylight * 0.6);
    if (air && (air as THREE.Color).isColor) material.color.lerp(air as THREE.Color, 0.62);
    material.visible = env.blueprint < 0.5;
  });
  return (
    <group>
      {spots.map((s, k) => (
        <mesh
          key={k}
          geometry={s.geo}
          material={material}
          position={[s.x, -0.5, s.z]}
          rotation-y={s.turn}
          scale={[s.w, s.h, s.w]}
        />
      ))}
    </group>
  );
}

// --- Seabirds ----------------------------------------------------------------

const BIRD_VERT = /* glsl */ `
attribute vec4 aPath;   // centre x, centre z, radius, height
attribute vec4 aMotion; // speed, phase, wobble, size
uniform float uTime;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  float t = uTime * aMotion.x + aMotion.y;
  // Wheeling in loose, drifting circles, rising and dipping.
  float r = aPath.z * (1.0 + 0.25 * sin(t * 0.37 + aMotion.y * 3.0));
  vec3 c = vec3(aPath.x + cos(t) * r, aPath.w + sin(t * 0.8 + aMotion.z) * 1.2, aPath.y + sin(t) * r * 0.8);
  vec3 dir = normalize(vec3(-sin(t), 0.0, cos(t) * 0.8));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 p = position;
  // Wings (|x| > 0.1) flap, gliding now and then.
  float flapOn = smoothstep(-0.3, 0.3, sin(t * 0.9 + aMotion.z * 5.0));
  float flap = sin(uTime * 11.0 + aMotion.y * 20.0) * 0.55 * flapOn;
  p.y += abs(p.x) * flap - abs(p.x) * 0.12;
  // Bank into the turn.
  p.y += p.x * 0.25;
  vec3 w = c + (side * p.x + vec3(0.0, p.y, 0.0) + dir * p.z) * aMotion.w;
  vShade = 0.7 + 0.3 * step(0.0, p.y);
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const BIRD_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLight;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uColor * vShade * uLight, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function birdGeometry() {
  // A gull in outline: body along z, swept wings along x.
  const v = [
    // left wing
    0, 0, 0.35, -1, 0.02, -0.1, 0, 0, -0.15,
    // right wing
    0, 0, 0.35, 0, 0, -0.15, 1, 0.02, -0.1,
    // body
    0, 0.03, 0.6, -0.08, 0, -0.5, 0.08, 0, -0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return g;
}

function Seabirds({ tiles, seed }: { tiles: Tile[]; seed: number }) {
  const geometry = useMemo(() => {
    const base = birdGeometry();
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", base.getAttribute("position"));
    // Flocks over the shore: pick coastal land tiles, a few birds each.
    const coast: number[] = [];
    for (let z = 2; z < SIZE - 2; z += 3)
      for (let x = 2; x < SIZE - 2; x += 3) {
        const i = idx(x, z);
        if (tiles[i].water === SEA) continue;
        if (
          [idx(x + 2, z), idx(x - 2, z), idx(x, z + 2), idx(x, z - 2)].some(
            (n) => tiles[n].water === SEA,
          )
        )
          coast.push(i);
      }
    const FLOCKS = 9;
    const PER = 9;
    const path: number[] = [];
    const motion: number[] = [];
    for (let f = 0; f < FLOCKS; f++) {
      const i = coast[Math.floor(hash(seed, f, 31) * coast.length)] ?? 0;
      const cx = (i % SIZE) - HALF + 0.5;
      const cz = Math.floor(i / SIZE) - HALF + 0.5;
      const ground = Math.max(0, heightAt(tiles, cx, cz));
      for (let k = 0; k < PER; k++) {
        path.push(
          cx + (hash(f, k, 32) - 0.5) * 4,
          cz + (hash(f, k, 33) - 0.5) * 4,
          2.5 + hash(f, k, 34) * 5,
          ground + 3 + hash(f, k, 35) * 5,
        );
        motion.push(
          (0.18 + hash(f, k, 36) * 0.12) * (hash(f, k, 37) < 0.5 ? -1 : 1),
          hash(f, k, 38) * 6.28,
          hash(f, k, 39),
          0.14 + hash(f, k, 40) * 0.06,
        );
      }
    }
    g.setAttribute("aPath", new THREE.InstancedBufferAttribute(new Float32Array(path), 4));
    g.setAttribute("aMotion", new THREE.InstancedBufferAttribute(new Float32Array(motion), 4));
    g.instanceCount = path.length / 4;
    return g;
    // Where the coast is doesn't change within an island.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BIRD_VERT,
        fragmentShader: BIRD_FRAG,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color("#e9ecea") },
            uLight: { value: 1 },
          },
        ]),
        side: THREE.DoubleSide,
        fog: true,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uLight.value = 0.25 + env.daylight * 0.8;
    material.visible = env.blueprint < 0.5 && !env.night;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

export function Surroundings({ tiles, seed }: { tiles: Tile[]; seed: number }) {
  return (
    <group>
      <HorizonIslands seed={seed} />
      <Seabirds tiles={tiles} seed={seed} />
    </group>
  );
}
