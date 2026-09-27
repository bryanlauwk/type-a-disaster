import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import {
  HALF,
  SIZE,
  idx,
  inBounds,
  tx,
  ty,
  wx,
  wz,
  type Tile,
  type WorldState,
} from "@/lib/island/types";
import type { ActionRecord } from "@/lib/island/types";
import { heightAt } from "./palette";
import { seaFx, waterNormalMap } from "./Waters";
import { Puffs } from "./fx/vfx";
import { env } from "./fx/env";

/**
 * The tsunami, in the order it really happens: the ground shudders, the sea
 * drains away from the shore and strands the reef, a white line rises on the
 * horizon and grows into a wall as it reaches the shallows, the wall breaks on
 * the coast, and a torrent of churning brown water surges inland, up the
 * valleys and over the low ground, carrying trees, huts and animals with it,
 * until it stalls at the hills and drains back to the sea.
 */

/** Seconds into the act for each beat. */
export interface TsunamiPlan {
  ox: number;
  oz: number;
  cos: number;
  sin: number;
  /** Distance (tiles) from the origin to the shore, and to the furthest flooded tile. */
  coast: number;
  far: number;
  /** When the wave hits the shore. */
  hit: number;
  /** How fast the surge runs inland (tiles per second). */
  surge: number;
  drainAt: number;
  drainFor: number;
  end: number;
  alongOf: (i: number) => number;
  arrival: (along: number) => number;
}

const DRAW_UNTIL = 3.2;
const WAVE_FROM = 1.2;
const HIT = 5.6;
const SURGE = 6;
const OFFSHORE = 46;

export function tsunamiPlan(before: WorldState, record: ActionRecord): TsunamiPlan {
  const impact = record.impact!;
  const origin = impact.origin ?? record.tile;
  const cos = Math.cos(impact.angle);
  const sin = Math.sin(impact.angle);
  const alongOf = (i: number) => (tx(i) - tx(origin)) * cos + (ty(i) - ty(origin)) * sin;
  let coast = Infinity;
  let far = 0;
  for (const i of impact.tiles) {
    const a = alongOf(i);
    coast = Math.min(coast, a);
    far = Math.max(far, a);
  }
  if (!Number.isFinite(coast)) coast = far = 4;
  const drainAt = HIT + (far - coast) / SURGE + 2.2;
  const drainFor = 5;
  void before;
  return {
    ox: wx(origin),
    oz: wz(origin),
    cos,
    sin,
    coast,
    far,
    hit: HIT,
    surge: SURGE,
    drainAt,
    drainFor,
    end: drainAt + drainFor + 1,
    alongOf,
    arrival: (a: number) => HIT + Math.max(0, a - coast) / SURGE,
  };
}

// --- The wall of water -------------------------------------------------------

const WALL_VERT = /* glsl */ `
uniform float uH;
uniform float uCurl;
uniform float uTime;
uniform float uHalf;
varying float vUp;
varying vec3 vWorld;
varying vec3 vN;
varying float vFront;
void main() {
  // x: across the wave's travel (back ... front), z: along its crest.
  vec3 p = position;
  float u = p.x;               // -1 (back) .. 1 (front)
  float lat = p.z;
  // A long gentle back and a steep face; the crest pitches forward.
  float back = exp(-pow(min(u, 0.0) * 1.8, 2.0));
  float face = 1.0 - smoothstep(0.0, 0.55, u);
  float h = uH * mix(back, face, step(0.0, u));
  // Lumpy crest line, so it isn't a ruler-straight wall.
  float wob = 0.85 + 0.15 * sin(lat * 0.35 + uTime * 0.9) + 0.08 * sin(lat * 1.3 - uTime * 1.7);
  // The ends of the wave taper away into the sea instead of stopping dead.
  float ends = smoothstep(uHalf, uHalf * 0.55, abs(lat));
  h *= wob * ends;
  // Churning, uneven water: lumps travel along the face.
  float lump = sin(lat * 2.1 + u * 3.0 - uTime * 2.2) * 0.5 + sin(lat * 4.7 - uTime * 3.1 + u * 5.0) * 0.25;
  h += lump * 0.06 * uH * (1.0 - abs(u));
  float lip = smoothstep(uH * 0.55, uH, h);
  p.x = u * max(2.5, uH * 2.2) + lip * uCurl * uH * 0.9;
  p.y = h - 0.35 - lip * lip * uCurl * uH * 0.25;
  vUp = h / max(uH, 0.01);
  vFront = step(0.0, u);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normalize(vec3(-(u > 0.0 ? -2.0 : 0.6) * uH, 1.0, 0.0)));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
uniform sampler2D uRipples;
varying float vUp;
varying vec3 vWorld;
varying vec3 vN;
varying float vFront;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() {
  vec3 rip = texture2D(uRipples, vWorld.xz * 0.2 + vec2(0.0, uTime * 0.3)).xyz * 2.0 - 1.0;
  // The real shape of the face (it's displaced), plus fine ripples.
  vec3 geo = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(geo, cameraPosition - vWorld) < 0.0) geo = -geo;
  vec3 n = normalize(mix(vN, geo, 0.7) + rip * 0.3);
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  // Deep green-blue at the foot, glassy turquoise up the face where light comes through.
  vec3 col = mix(vec3(0.02, 0.12, 0.14), vec3(0.08, 0.45, 0.42), smoothstep(0.1, 0.8, vUp));
  col += vec3(0.1, 0.35, 0.3) * pow(max(dot(view, -uSun), 0.0), 2.0) * vUp;
  col = mix(col, vec3(0.75, 0.85, 0.9), fres * 0.4);
  // Streaks running down the face, and white water where it breaks.
  float streak = vn(vec2(vWorld.x * 3.0 + vWorld.z * 3.0, vWorld.y * 0.8 - uTime * 2.5));
  float foam = smoothstep(0.62, 0.9, vUp + streak * 0.25) + smoothstep(0.75, 0.95, streak) * 0.3 * vFront;
  col = mix(col, vec3(0.95, 0.97, 0.97), clamp(foam, 0.0, 1.0));
  float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 80.0);
  col = col * uLight + spec * 0.8 * uLight;
  gl_FragColor = vec4(col, mix(0.82, 1.0, foam));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// --- The surge over the land -------------------------------------------------

const SURGE_VERT = /* glsl */ `
attribute float aArrive;
attribute float aGround;
attribute float aDepth;
attribute float aEdge;
uniform float uT;
uniform float uDrainAt;
uniform float uDrainFor;
varying float vFresh;
varying float vLevel;
varying float vEdge;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  float since = uT - aArrive;
  float rise = smoothstep(0.0, 0.7, since);
  float drain = 1.0 - smoothstep(uDrainAt, uDrainAt + uDrainFor, uT);
  vLevel = rise * drain;
  vFresh = 1.0 - smoothstep(0.0, 2.6, since);
  vEdge = aEdge;
  vec3 p = position;
  // A rolling bore of white water at the leading edge.
  float bore = smoothstep(0.0, 0.25, since) * (1.0 - smoothstep(0.25, 1.4, since));
  // Thin at the margins, so the flood feathers out over the land.
  float d = aDepth * aEdge;
  p.y = aGround + 0.04 + d * vLevel + bore * 0.5 * d - (1.0 - rise) * 0.6;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SURGE_FRAG = /* glsl */ `
uniform float uT;
uniform float uLight;
uniform vec3 uSun;
uniform vec2 uDir;
uniform sampler2D uRipples;
varying float vFresh;
varying float vLevel;
varying float vEdge;
varying vec3 vWorld;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() {
  if (vLevel < 0.02) discard;
  // Water rushing inland: ripples dragged along the flow.
  vec2 flow = uDir * uT * (0.9 - 0.6 * (1.0 - vFresh));
  vec3 r1 = texture2D(uRipples, vWorld.xz * 0.18 - flow * 0.3).xyz * 2.0 - 1.0;
  vec3 r2 = texture2D(uRipples, vWorld.xz * 0.5 - flow * 0.9).xyz * 2.0 - 1.0;
  vec3 n = normalize(vec3((r1.x + r2.x) * 0.9, 1.0, (r1.y + r2.y) * 0.9));
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
  // Churned up with sand and mud.
  vec3 col = mix(vec3(0.6, 0.55, 0.45), vec3(0.42, 0.52, 0.5), 0.45 + 0.3 * vn(vWorld.xz * 0.3 + uT * 0.2));
  col = mix(col, vec3(0.82, 0.86, 0.9), fres * 0.7);
  // White water at the leading edge, marbled foam behind it.
  float churn = vn(vWorld.xz * 1.6 - flow * 2.0) * 0.6 + vn(vWorld.xz * 4.5 - flow * 3.0) * 0.4;
  // Foam streaks drawn out along the flow.
  vec2 along = vec2(dot(vWorld.xz, uDir), dot(vWorld.xz, vec2(-uDir.y, uDir.x)));
  float streaks = vn(vec2(along.x * 0.6 - uT * 2.0, along.y * 4.0)) * 0.6 + vn(vec2(along.x * 1.5 - uT * 3.0, along.y * 9.0)) * 0.4;
  float foam = smoothstep(0.25, 0.7, vFresh * (0.8 + churn)) + smoothstep(0.6, 0.82, streaks) * 0.45 + smoothstep(0.62, 0.85, churn) * 0.4;
  col = mix(col, vec3(0.94, 0.95, 0.93), clamp(foam, 0.0, 1.0));
  float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 240.0);
  col = col * uLight + spec * 0.35 * uLight;
  gl_FragColor = vec4(col, 0.93 * smoothstep(0.02, 0.2, vLevel) * smoothstep(0.2, 0.75, vEdge));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function surgeGeometry(tiles: Tile[], flooded: number[], plan: TsunamiPlan) {
  const wet = new Set(flooded);
  const pos: number[] = [];
  const arrive: number[] = [];
  const ground: number[] = [];
  const depth: number[] = [];
  const cornerWet = (cx: number, cz: number) => {
    let n = 0;
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ]) {
      const x = cx + dx;
      const z = cz + dz;
      if (inBounds(x, z) && wet.has(idx(x, z))) n++;
    }
    return n / 4;
  };
  const edge: number[] = [];
  const cornerArrive = (cx: number, cz: number) => {
    let best = Infinity;
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ]) {
      const x = cx + dx;
      const z = cz + dz;
      if (!inBounds(x, z)) continue;
      const i = idx(x, z);
      if (wet.has(i)) best = Math.min(best, plan.arrival(plan.alongOf(i)));
    }
    return Number.isFinite(best) ? best : 99;
  };
  const span = Math.max(1, plan.far - plan.coast);
  for (const i of flooded) {
    const x = tx(i);
    const z = ty(i);
    const inland = Math.max(0, plan.alongOf(i) - plan.coast) / span;
    for (const [cx, cz] of [
      [x, z],
      [x + 1, z],
      [x + 1, z + 1],
      [x, z],
      [x + 1, z + 1],
      [x, z + 1],
    ]) {
      const px = cx - HALF;
      const pz = cz - HALF;
      pos.push(px, 0, pz);
      arrive.push(cornerArrive(cx, cz));
      ground.push(Math.max(0, heightAt(tiles, px, pz)));
      // Deep and violent at the shore, a shallow sheet by the time it stalls.
      depth.push(0.12 + 0.55 * (1 - inland));
      edge.push(cornerWet(cx, cz));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aArrive", new THREE.Float32BufferAttribute(arrive, 1));
  g.setAttribute("aGround", new THREE.Float32BufferAttribute(ground, 1));
  g.setAttribute("aDepth", new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

// --- Debris ------------------------------------------------------------------

interface Piece {
  x: number;
  z: number;
  start: number;
  speed: number;
  side: number;
  spin: number;
  size: number;
  kind: number;
}

/** Wreckage the surge carries: timbers and thatch from huts, trunks from the forest. */
function debris(before: Tile[], after: Tile[], flooded: number[], plan: TsunamiPlan): Piece[] {
  const out: Piece[] = [];
  for (const i of flooded) {
    const lostHut = before[i].build && !after[i].build;
    const lostTrees = before[i].forest - after[i].forest;
    const n = (lostHut ? 5 : 0) + (lostTrees > 0.2 && hash(i, 61) < 0.35 ? 1 : 0);
    for (let k = 0; k < n; k++)
      out.push({
        x: wx(i) + (hash(i, k, 62) - 0.5),
        z: wz(i) + (hash(i, k, 63) - 0.5),
        start: plan.arrival(plan.alongOf(i)),
        speed: plan.surge * (0.35 + hash(i, k, 64) * 0.35),
        side: (hash(i, k, 65) - 0.5) * 1.2,
        spin: (hash(i, k, 66) - 0.5) * 3,
        size: lostHut ? 0.05 + hash(i, k, 67) * 0.05 : 0.1 + hash(i, k, 67) * 0.08,
        kind: lostHut ? k % 2 : 2,
      });
    if (out.length > 180) break;
  }
  return out;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

/** Where the sim's tsunami sends the animals: the land a surge is racing over. */
export const surgeBus = {
  active: false,
  plan: null as TsunamiPlan | null,
  t: 0,
};

export function TsunamiSpectacle({
  before,
  after,
  record,
  getT,
  shake,
}: {
  before: WorldState;
  after: WorldState;
  record: ActionRecord;
  getT: () => number;
  shake: { current: number };
}) {
  const plan = useMemo(() => tsunamiPlan(before, record), [before, record]);
  const flooded = record.impact?.tiles ?? [];
  const wall = useRef<THREE.Mesh>(null);
  const crest = useRef<THREE.Group>(null);
  const logs = useRef<THREE.InstancedMesh>(null);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const camFrom = useRef<{ p: THREE.Vector3; t: THREE.Vector3 } | null>(null);

  const coastX = plan.ox + plan.cos * plan.coast;
  const coastZ = plan.oz + plan.sin * plan.coast;
  const width = 2 * (7 + plan.coast * 0.45) + 14;

  const wallGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, width, 48, 64);
    // x runs across the wave (-1 back .. 1 front), z along the crest.
    g.rotateX(-Math.PI / 2);
    return g;
  }, [width]);
  const wallMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: WALL_VERT,
        fragmentShader: WALL_FRAG,
        uniforms: {
          uH: { value: 0 },
          uCurl: { value: 0 },
          uTime: { value: 0 },
          uHalf: { value: width / 2 },
          uLight: { value: 1 },
          uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
          uRipples: { value: waterNormalMap() },
        },
        transparent: true,
        side: THREE.DoubleSide,
      }),
    [width],
  );
  const surgeGeo = useMemo(
    () => surgeGeometry(before.tiles, flooded, plan),
    [before.tiles, flooded, plan],
  );
  const surgeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SURGE_VERT,
        fragmentShader: SURGE_FRAG,
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uT: { value: 0 },
            uDrainAt: { value: plan.drainAt },
            uDrainFor: { value: plan.drainFor },
            uLight: { value: 1 },
            uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
            uDir: { value: new THREE.Vector2(plan.cos, plan.sin) },
            uRipples: { value: waterNormalMap() },
          },
        ]),
        transparent: true,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
      }),
    [plan],
  );
  const pieces = useMemo(
    () => debris(before.tiles, after.tiles, flooded, plan),
    [before.tiles, after.tiles, flooded, plan],
  );
  useEffect(
    () => () => {
      wallGeo.dispose();
      wallMat.dispose();
      surgeGeo.dispose();
      surgeMat.dispose();
      seaFx.draw = 0;
      surgeBus.active = false;
      surgeBus.plan = null;
    },
    [wallGeo, wallMat, surgeGeo, surgeMat],
  );

  useFrame(({ clock }) => {
    const t = getT();
    surgeBus.active = t < plan.drainAt + plan.drainFor;
    surgeBus.plan = plan;
    surgeBus.t = t;

    // 1. The ground shudders; the sea drains away from the shore.
    if (t < 1.2) shake.current = Math.max(shake.current, 0.05);
    seaFx.drawX = coastX - plan.cos * 10;
    seaFx.drawZ = coastZ - plan.sin * 10;
    seaFx.drawR = 34;
    const back = Math.min(1, t / DRAW_UNTIL);
    const refill = THREE.MathUtils.smoothstep(t, plan.hit - 1.2, plan.hit + 0.3);
    seaFx.draw = back * back * (3 - 2 * back) * (1 - refill);

    // 2. The wall: a white line on the horizon that rears up in the shallows.
    const s = THREE.MathUtils.clamp((t - WAVE_FROM) / (plan.hit - WAVE_FROM), 0, 1);
    const along = plan.coast - OFFSHORE * Math.pow(1 - s, 1.35);
    const w = wall.current;
    if (w) {
      w.visible = t > WAVE_FROM && t < plan.hit + 1.4;
      const collapse = THREE.MathUtils.clamp((t - plan.hit) / 1.4, 0, 1);
      const H = (0.35 + 3.1 * s * s) * (1 - collapse * 0.85);
      wallMat.uniforms.uH.value = H;
      wallMat.uniforms.uCurl.value = Math.min(1, s * 1.3) * (1 - collapse);
      wallMat.uniforms.uTime.value = clock.elapsedTime;
      w.position.set(
        plan.ox + plan.cos * (along + collapse * 3),
        0,
        plan.oz + plan.sin * (along + collapse * 3),
      );
      w.rotation.y = -Math.atan2(plan.sin, plan.cos);
      if (crest.current) {
        crest.current.visible = w.visible;
        crest.current.position.copy(w.position);
        crest.current.position.y = H * 0.9;
        crest.current.rotation.y = w.rotation.y;
      }
    }
    // 3. The hit.
    if (t > plan.hit - 0.1 && t < plan.hit + 1.2) shake.current = Math.max(shake.current, 0.35);
    else if (t > plan.hit && t < plan.drainAt) shake.current = Math.max(shake.current, 0.06);

    // 4. The surge.
    surgeMat.uniforms.uT.value = t;
    const light = 0.4 + env.daylight * 0.75 + env.flash * 0.3;
    // White water catches what light there is: keep the flood readable at dusk.
    surgeMat.uniforms.uLight.value = Math.max(0.75, light);
    wallMat.uniforms.uLight.value = light;
    if (env.sunDir) {
      surgeMat.uniforms.uSun.value.copy(env.sunDir);
      wallMat.uniforms.uSun.value.copy(env.sunDir);
    }

    // 5. Wreckage rides the water, then drops where it stalls.
    const lg = logs.current;
    if (lg) {
      pieces.forEach((p, k) => {
        const since = t - p.start;
        if (since < 0) {
          lg.setMatrixAt(k, HIDE);
          return;
        }
        const ride = Math.min(since, Math.max(0, plan.drainAt - p.start));
        const slow = 1 - Math.exp(-ride * 0.35);
        const d = (p.speed / 0.35) * slow;
        // Back out towards the sea as it drains.
        const out = Math.max(0, t - plan.drainAt) * p.speed * 0.25;
        const x = p.x + plan.cos * (d - out) - plan.sin * p.side * slow;
        const z = p.z + plan.sin * (d - out) + plan.cos * p.side * slow;
        const floating = t < plan.drainAt + plan.drainFor * 0.8;
        const y =
          Math.max(0, heightAt(before.tiles, x, z)) +
          (floating ? 0.55 + Math.sin(t * 3 + k) * 0.05 : 0.03);
        tmpE.set(
          Math.sin(t * p.spin) * 0.4,
          t * p.spin * (floating ? 1 : 0) + k,
          Math.cos(t * p.spin) * 0.3,
        );
        tmpQ.setFromEuler(tmpE);
        tmpP.set(x, y, z);
        tmpS.set(p.kind === 2 ? p.size * 6 : p.size * 3, p.size * 0.6, p.size);
        tmpM.compose(tmpP, tmpQ, tmpS);
        lg.setMatrixAt(k, tmpM);
      });
      lg.instanceMatrix.needsUpdate = true;
    }

    // Camera: watch it come in from the shore, then rise to see the flood.
    if (controls) {
      if (!camFrom.current)
        camFrom.current = { p: camera.position.clone(), t: controls.target.clone() };
      const inX = coastX + plan.cos * 9 - plan.sin * 11;
      const inZ = coastZ + plan.sin * 9 + plan.cos * 11;
      const gy = Math.max(0, heightAt(before.tiles, inX, inZ));
      const shoreP = new THREE.Vector3(inX, gy + 7, inZ);
      const shoreT = new THREE.Vector3(coastX - plan.cos * 18, 0.5, coastZ - plan.sin * 18);
      const mid = (plan.coast + plan.far) / 2;
      const floodT = new THREE.Vector3(plan.ox + plan.cos * mid, 1, plan.oz + plan.sin * mid);
      const floodP = floodT
        .clone()
        .add(new THREE.Vector3(-plan.cos * 18 - plan.sin * 14, 20, -plan.sin * 18 + plan.cos * 14));
      const a = THREE.MathUtils.smoothstep(t, 0, 1.6);
      const b = THREE.MathUtils.smoothstep(t, plan.hit + 0.4, plan.hit + 3.2);
      const p = camFrom.current.p.clone().lerp(shoreP, a).lerp(floodP, b);
      const tg = camFrom.current.t.clone().lerp(shoreT, a).lerp(floodT, b);
      camera.position.copy(p);
      controls.target.copy(tg);
      controls.update();
    }
  });

  // Spray blown off the crest, spread along it.
  const sprays = useMemo(() => [-0.36, -0.18, 0, 0.18, 0.36].map((f) => f * width), [width]);
  return (
    <group>
      <mesh
        ref={wall}
        geometry={wallGeo}
        material={wallMat}
        visible={false}
        renderOrder={3}
        frustumCulled={false}
      />
      <group ref={crest} visible={false}>
        {sprays.map((z, k) => (
          <Puffs
            key={`foot-${k}`}
            getT={getT}
            origin={[2.2, -1.2, z]}
            count={18}
            duration={1.4}
            spread={3}
            rise={0.8}
            size={[0.6, 1.6]}
            color="#eef5f5"
            opacity={0.7}
            loop
            seed={60 + k}
          />
        ))}
        {sprays.map((z, k) => (
          <Puffs
            key={k}
            getT={getT}
            origin={[0.8, 0, z]}
            count={26}
            duration={1.2}
            spread={2.2}
            rise={1.6}
            fall={1.5}
            size={[0.4, 1.4]}
            color="#f4fafa"
            opacity={0.75}
            loop
            seed={40 + k}
          />
        ))}
      </group>
      <mesh geometry={surgeGeo} material={surgeMat} renderOrder={2} frustumCulled={false} />
      <instancedMesh
        ref={logs}
        args={[undefined, undefined, Math.max(1, pieces.length)]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#5a4630" roughness={0.9} />
      </instancedMesh>
      {/* Spume and mist over the breaking line at the shore. */}
      <Puffs
        getT={() => getT() - plan.hit + 0.3}
        origin={[coastX, 0.5, coastZ]}
        count={70}
        duration={3.5}
        stagger={1.5}
        spread={width * 0.35}
        rise={4}
        size={[1.2, 3.5]}
        color="#eef4f4"
        opacity={0.7}
        seed={77}
      />
    </group>
  );
}
