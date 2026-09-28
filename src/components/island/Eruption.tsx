import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { around } from "@/lib/island/terrain";
import {
  HALF,
  idx,
  inBounds,
  tx,
  ty,
  wx,
  wz,
  type ActionRecord,
  type Tile,
  type WorldState,
} from "@/lib/island/types";
import { heightAt } from "./palette";
import { env } from "./fx/env";

/**
 * The eruption, the way a big one goes: the mountain rumbles and steams, the
 * top blows out in a blinding blast and a shock wave, a black column of ash
 * boils up for kilometres and spreads into an umbrella that darkens the sky,
 * lava fountains out of the crater and glowing rocks rain down the flanks,
 * rivers of lava crawl down the valleys (a bright front, crusting over
 * behind), a scorching avalanche of ash races down one side, and lightning
 * crackles through the cloud.
 */

// --- The plan: when things happen ------------------------------------------

export interface EruptionPlan {
  crater: number;
  cx: number;
  cz: number;
  /** Height of the crater floor. */
  cy: number;
  /** When the top blows. */
  blast: number;
  /** Seconds into the act when lava reaches each tile. */
  arrival: Map<number, number>;
  lastArrive: number;
  /** The scorching ash avalanche: the points it runs through, and when. */
  pyro: { x: number; z: number; y: number; at: number }[];
  wind: [number, number];
  end: number;
}

const BLAST = 2.2;
/** How fast the lava runs, tiles per second, on the flat and on a steep slope. */
const FLOW_FLAT = 0.9;
const FLOW_STEEP = 3.2;
const PYRO_SPEED = 6.5;

export function eruptionPlan(before: WorldState, record: ActionRecord): EruptionPlan {
  const tiles = before.tiles;
  const crater = tiles.findIndex((t) => t.landmark === "great_volcano");
  const cx = wx(crater);
  const cz = wz(crater);
  const cy = tiles[crater].h;
  const lava = record.impact?.tiles ?? [];
  const set = new Set(lava);
  // The lava spreads from the crater through the flow's tiles, faster down steep ground.
  const arrival = new Map<number, number>();
  const start = BLAST + 0.9;
  arrival.set(crater, start);
  const open: number[] = [crater];
  while (open.length) {
    let best = 0;
    for (let k = 1; k < open.length; k++)
      if (arrival.get(open[k])! < arrival.get(open[best])!) best = k;
    const cur = open.splice(best, 1)[0];
    const at = arrival.get(cur)!;
    for (const n of around(cur)) {
      if (!set.has(n)) continue;
      const step = Math.hypot(tx(n) - tx(cur), ty(n) - ty(cur));
      const drop = Math.max(0, tiles[cur].h - tiles[n].h) / step;
      const speed = FLOW_FLAT + (FLOW_STEEP - FLOW_FLAT) * Math.min(1, drop / 0.9);
      const t = at + step / speed;
      if (t < (arrival.get(n) ?? Infinity)) {
        if (!arrival.has(n)) open.push(n);
        arrival.set(n, t);
      }
    }
  }
  // Anything the search couldn't reach arrives in the order the sim listed it.
  lava.forEach((i, k) => {
    if (!arrival.has(i)) arrival.set(i, start + 1 + k * 0.04);
  });
  let lastArrive = start;
  for (const v of arrival.values()) lastArrive = Math.max(lastArrive, v);

  // The ash avalanche takes the steepest way down on the side facing the wind's back.
  const ang = (record.impact?.angle ?? 0) + Math.PI * 0.6;
  const pyro: EruptionPlan["pyro"] = [];
  let x = cx + Math.cos(ang) * 2.5;
  let z = cz + Math.sin(ang) * 2.5;
  let at = BLAST + 3.2;
  for (let k = 0; k < 40; k++) {
    const y = heightAt(tiles, x, z);
    pyro.push({ x, z, y, at });
    if (y < 0.3 || Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) break;
    // Downhill, but it keeps its momentum: a heavy cloud doesn't turn on a coin.
    const e = 0.6;
    const gx = heightAt(tiles, x + e, z) - heightAt(tiles, x - e, z);
    const gz = heightAt(tiles, x, z + e) - heightAt(tiles, x, z - e);
    const prev = pyro.length > 1 ? pyro[pyro.length - 2] : null;
    let dx = -gx;
    let dz = -gz;
    const gl = Math.hypot(dx, dz) || 1;
    dx /= gl;
    dz /= gl;
    if (prev) {
      const px = x - prev.x;
      const pz = z - prev.z;
      const pl = Math.hypot(px, pz) || 1;
      dx = dx * 0.45 + (px / pl) * 0.55;
      dz = dz * 0.45 + (pz / pl) * 0.55;
    } else {
      dx = dx * 0.5 + Math.cos(ang) * 0.5;
      dz = dz * 0.5 + Math.sin(ang) * 0.5;
    }
    const l = Math.hypot(dx, dz) || 1;
    x += (dx / l) * 1.2;
    z += (dz / l) * 1.2;
    // Slows as the ground flattens out.
    at += 1.2 / (PYRO_SPEED * (0.45 + Math.min(1, gl * 1.2)));
  }
  const wa = hash(before.seed, 91) * Math.PI * 2;
  return {
    crater,
    cx,
    cz,
    cy,
    blast: BLAST,
    arrival,
    lastArrive,
    pyro,
    wind: [Math.cos(wa), Math.sin(wa)],
    end: Math.max(lastArrive + 4, 19),
  };
}

/** Where the plan's avalanche front is at time t (null before it starts or once it's spent). */
function pyroFront(plan: EruptionPlan, t: number) {
  const p = plan.pyro;
  if (!p.length || t < p[0].at) return null;
  for (let k = 1; k < p.length; k++)
    if (p[k].at > t) {
      const f = (t - p[k - 1].at) / (p[k].at - p[k - 1].at);
      return {
        x: p[k - 1].x + (p[k].x - p[k - 1].x) * f,
        z: p[k - 1].z + (p[k].z - p[k - 1].z) * f,
        k,
      };
    }
  return null;
}

/** Shared with the animals: what's burning, and where the avalanche is. */
export const eruptBus = {
  active: false,
  plan: null as EruptionPlan | null,
  t: 0,
  pyroFront: (t: number) => (eruptBus.plan ? pyroFront(eruptBus.plan, t) : null),
};

// --- Billowing ash and steam, lit like real cloud ---------------------------

const CLOUD_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aData;   // size, alpha, heat, seed
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vSeed;
varying vec3 vColor;
varying float vFog;
uniform float uFogNear;
uniform float uFogFar;
void main() {
  vec4 mv = viewMatrix * vec4(aPos, 1.0);
  float spin = aData.w * 6.2831;
  vec2 c = position.xy;
  mv.xy += vec2(c.x * cos(spin) - c.y * sin(spin), c.x * sin(spin) + c.y * cos(spin)) * aData.x;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAlpha = aData.y;
  vHeat = aData.z;
  vSeed = aData.w;
  vColor = aColor;
  vFog = smoothstep(uFogNear, uFogFar, -mv.z);
  // Undo the spin for lighting: vUv in screen orientation.
  vec2 d = uv - 0.5;
  vUv = vec2(d.x * cos(spin) - d.y * sin(spin), d.x * sin(spin) + d.y * cos(spin)) + 0.5;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSunV;
uniform float uLight;
uniform float uFlash;
uniform vec3 uFogColor;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
varying float vHeat;
varying float vSeed;
varying vec3 vColor;
varying float vFog;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.1 + 3.1) * 0.3 + vn(p * 4.3 + 7.7) * 0.2; }
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec2 o = vec2(vSeed * 17.0, vSeed * 31.0);
  // A cauliflower edge: the radius wobbles with noise.
  float n = fbm(c * 1.6 + o + uTime * 0.05);
  float r = length(c) + (n - 0.5) * 0.55;
  float dens = smoothstep(1.0, 0.45, r);
  if (dens < 0.01) discard;
  // Treat the puff as a lumpy ball for lighting.
  vec3 nrm = normalize(vec3(c * 0.9 + (vec2(vn(c * 3.0 + o), vn(c * 3.0 - o)) - 0.5) * 0.6, sqrt(max(0.0, 1.0 - dot(c, c))) + 0.2));
  float sun = max(0.0, dot(nrm, uSunV) * 0.6 + 0.4);
  // Dark crevices between lumps, bright tops facing the sun.
  float lumps = fbm(c * 3.5 + o * 1.3);
  vec3 col = vColor * (0.16 + 1.0 * sun * sun * uLight) * (0.6 + lumps * 0.6);
  // Lit from below by the fire in the crater and the lava.
  float under = clamp(-nrm.y * 0.6 + 0.5, 0.0, 1.0);
  col += vec3(1.0, 0.36, 0.08) * vHeat * (0.35 + under * 1.1) * (1.4 - uLight * 0.5);
  // Lightning lights the whole cloud from inside.
  col += vec3(0.5, 0.55, 0.75) * uFlash * 0.35 * (1.0 - sun * 0.6);
  col = mix(col, uFogColor, vFog * 0.45);
  float a = dens * vAlpha * (0.75 + n * 0.35);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface Puff {
  kind: number;
  born: number;
  life: number;
  s1: number;
  s2: number;
  s3: number;
  /** The rock a trail or dust puff belongs to. */
  rock: number;
}

const K_COLUMN = 0;
const K_STEAM = 1;
const K_PYRO = 2;
const K_TRAIL = 3;
const K_DUST = 4;
const K_JET = 5;

interface Bomb {
  t0: number;
  vx: number;
  vz: number;
  vy: number;
  size: number;
  /** Seconds in the air, found by marching the arc down onto the ground. */
  flight: number;
  lx: number;
  lz: number;
  ly: number;
}

const G = 9.8;

function bombs(plan: EruptionPlan, tiles: Tile[]): Bomb[] {
  const out: Bomb[] = [];
  for (let k = 0; k < 26; k++) {
    const a = hash(k, 301) * Math.PI * 2;
    const range = 6 + hash(k, 302) * 16;
    const vy = 10 + hash(k, 303) * 9;
    // Time to come back down to about the crater's height, then onto the flank.
    const up = vy / G;
    const guess = up * 2 + 0.6;
    const vh = range / guess;
    let flight = guess;
    for (let s = up; s < 6; s += 0.05) {
      const x = plan.cx + Math.cos(a) * vh * s;
      const z = plan.cz + Math.sin(a) * vh * s;
      const y = plan.cy + 0.8 + vy * s - 0.5 * G * s * s;
      if (y <= Math.max(0, heightAt(tiles, x, z))) {
        flight = s;
        break;
      }
    }
    const lx = plan.cx + Math.cos(a) * vh * flight;
    const lz = plan.cz + Math.sin(a) * vh * flight;
    out.push({
      t0: plan.blast + (k < 10 ? hash(k, 304) * 0.5 : 0.6 + hash(k, 304) * 9),
      vx: Math.cos(a) * vh,
      vz: Math.sin(a) * vh,
      vy,
      size: 0.18 + hash(k, 305) * 0.3,
      flight,
      lx,
      lz,
      ly: Math.max(0, heightAt(tiles, lx, lz)),
    });
  }
  return out;
}

function bombAt(plan: EruptionPlan, b: Bomb, s: number, out: THREE.Vector3) {
  const f = Math.min(s, b.flight);
  return out.set(
    plan.cx + b.vx * f,
    plan.cy + 0.8 + b.vy * f - 0.5 * G * f * f,
    plan.cz + b.vz * f,
  );
}

function puffs(plan: EruptionPlan, rocks: Bomb[]): Puff[] {
  const out: Puff[] = [];
  const add = (kind: number, born: number, life: number, k: number, rock = 0) =>
    out.push({
      kind,
      born,
      life,
      s1: hash(k, kind, 11),
      s2: hash(k, kind, 12),
      s3: hash(k, kind, 13),
      rock,
    });
  // Steam and gas hissing out before the blast.
  for (let k = 0; k < 40; k++) add(K_STEAM, hash(k, 1) * (BLAST + 0.5), 3.5 + hash(k, 2) * 2, k);
  // The jet: a dense, hot, fast gush right out of the vent.
  const JET = 170;
  for (let k = 0; k < JET; k++)
    add(
      K_JET,
      plan.blast + 0.1 + (k / JET) * (plan.end - plan.blast - 3.5),
      1.8 + hash(k, 8) * 1.2,
      k,
    );
  // The column: dense at first, thinning as the eruption tires.
  const COL = 440;
  for (let k = 0; k < COL; k++) {
    const f = k / COL;
    add(
      K_COLUMN,
      plan.blast + Math.pow(f, 1.35) * (plan.end - plan.blast - 4),
      11 + hash(k, 3) * 5,
      k,
    );
  }
  // The ash avalanche: fed at its front as it runs.
  const p = plan.pyro;
  if (p.length > 2) {
    const t0 = p[0].at;
    const t1 = p[p.length - 1].at;
    for (let k = 0; k < 190; k++) add(K_PYRO, t0 + (k / 190) * (t1 - t0), 6 + hash(k, 4) * 4, k);
  }
  // Dust where the flying rocks land.
  rocks.forEach((b, j) => {
    for (let k = 0; k < 3; k++)
      add(K_DUST, b.t0 + b.flight + k * 0.05, 2.5 + hash(j, k, 6), j * 16 + 8 + k, j);
  });
  return out;
}

const COLORS: Record<number, THREE.Color> = {
  [K_COLUMN]: new THREE.Color("#7a7068"),
  [K_STEAM]: new THREE.Color("#d9d5cf"),
  [K_PYRO]: new THREE.Color("#857b72"),
  [K_TRAIL]: new THREE.Color("#6a625c"),
  [K_DUST]: new THREE.Color("#9a8f82"),
  [K_JET]: new THREE.Color("#6f655d"),
};

const v1 = new THREE.Vector3();

/** Where one puff is and how it looks at time t; false while it isn't alive. */
function place(
  pf: Puff,
  t: number,
  plan: EruptionPlan,
  rocks: Bomb[],
  tiles: Tile[],
  o: { x: number; y: number; z: number; size: number; alpha: number; heat: number },
): boolean {
  const age = t - pf.born;
  if (age < 0 || age > pf.life) return false;
  const life = age / pf.life;
  const fade = Math.min(1, age / 0.35) * Math.min(1, (1 - life) / 0.3);
  const ang = pf.s1 * Math.PI * 2;
  const [wdx, wdz] = plan.wind;
  switch (pf.kind) {
    case K_COLUMN: {
      // A rising thermal: fast out of the vent, slowing as it climbs, then
      // spreading sideways where it stops rising into the umbrella.
      const H = 34 + pf.s2 * 10;
      const tau = 2.4;
      const h = H * (1 - Math.exp(-age / tau));
      const top = Math.max(0, age - tau * 1.6);
      const spread = top * (1.4 + pf.s3 * 1.6);
      const r = (1.6 + h * 0.2) * (0.35 + 0.65 * Math.sqrt(pf.s3)) + spread;
      const swirl = ang + age * (0.18 + pf.s2 * 0.2);
      const drift = Math.max(0, h - 12) * 0.04 * age;
      o.x = plan.cx + Math.cos(swirl) * r + wdx * drift;
      o.z = plan.cz + Math.sin(swirl) * r + wdz * drift;
      o.y = plan.cy + 0.6 + h - top * 0.25;
      o.size = 2 + h * 0.17 + spread * 0.35;
      o.alpha = fade * 0.95;
      o.heat = Math.exp(-h / 4) * 1.4;
      return true;
    }
    case K_JET: {
      const h = 15 * (1 - Math.exp(-age / 1.1));
      const r = (0.7 + h * 0.2) * (0.3 + 0.7 * Math.sqrt(pf.s3));
      const swirl = ang + age * 0.8;
      o.x = plan.cx + Math.cos(swirl) * r;
      o.z = plan.cz + Math.sin(swirl) * r;
      o.y = plan.cy + 0.3 + h;
      o.size = 1.5 + h * 0.22;
      o.alpha = fade * 0.9;
      o.heat = Math.exp(-h / 5) * 1.6;
      return true;
    }
    case K_STEAM: {
      const r = 0.6 + pf.s2 * 1.6;
      o.x = plan.cx + Math.cos(ang) * r + wdx * age * 0.6;
      o.z = plan.cz + Math.sin(ang) * r + wdz * age * 0.6;
      o.y = plan.cy + 0.2 + age * (1.3 + pf.s3);
      o.size = 0.8 + age * 0.7;
      o.alpha = fade * 0.55;
      o.heat = 0.15;
      return true;
    }
    case K_PYRO: {
      // Born at the front, it keeps rolling downhill a little and billows up.
      const f = pyroFront(plan, pf.born);
      if (!f) return false;
      const a = plan.pyro[f.k - 1];
      const b = plan.pyro[f.k];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const roll = (1 - Math.exp(-age * 0.8)) * 1.8;
      const side = (pf.s2 - 0.5) * (1.2 + age * 0.9);
      o.x = f.x + (dx / l) * roll - (dz / l) * side;
      o.z = f.z + (dz / l) * roll + (dx / l) * side;
      o.y = Math.max(0, heightAt(tiles, o.x, o.z)) + 0.4 + age * (0.35 + pf.s3 * 0.35);
      o.size = 1.1 + age * 0.75;
      o.alpha = fade * 0.9;
      o.heat = age < 0.8 ? 0.25 * (1 - age / 0.8) : 0;
      return true;
    }
    case K_TRAIL: {
      const rock = rocks[pf.rock];
      bombAt(plan, rock, pf.born - rock.t0, v1);
      o.x = v1.x + (pf.s2 - 0.5) * 0.3 + wdx * age * 0.5;
      o.z = v1.z + (pf.s3 - 0.5) * 0.3 + wdz * age * 0.5;
      o.y = v1.y + age * 0.4;
      o.size = 0.5 + age * 0.8;
      o.alpha = fade * 0.45;
      o.heat = age < 0.3 ? 0.6 : 0;
      return true;
    }
    case K_DUST: {
      const rock = rocks[pf.rock];
      o.x = rock.lx + Math.cos(ang) * age * 0.5;
      o.z = rock.lz + Math.sin(ang) * age * 0.5;
      o.y = rock.ly + 0.2 + age * 0.5;
      o.size = 0.5 + age * 0.6;
      o.alpha = fade * 0.75;
      o.heat = 0;
      return true;
    }
  }
  return false;
}

function Billows({
  plan,
  tiles,
  rocks,
  getT,
}: {
  plan: EruptionPlan;
  tiles: Tile[];
  rocks: Bomb[];
  getT: () => number;
}) {
  const list = useMemo(() => puffs(plan, rocks), [plan, rocks]);
  const n = list.length;
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    g.setAttribute(
      "aPos",
      new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      "aData",
      new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      "aColor",
      new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.instanceCount = 0;
    return g;
  }, [n]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uSunV: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
          uLight: { value: 1 },
          uFlash: { value: 0 },
          uFogColor: { value: new THREE.Color("#9fb0bd") },
          uFogNear: { value: 80 },
          uFogFar: { value: 400 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const order = useMemo(() => new Array<{ k: number; d: number }>(), []);
  const tmp = useMemo(() => ({ x: 0, y: 0, z: 0, size: 0, alpha: 0, heat: 0 }), []);
  const state = useMemo(() => new Float32Array(n * 8), [n]);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const sunV = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }) => {
    const t = getT();
    order.length = 0;
    const view = camera.matrixWorldInverse;
    const e = view.elements;
    for (let k = 0; k < n; k++) {
      if (!place(list[k], t, plan, rocks, tiles, tmp)) continue;
      const o = k * 8;
      state[o] = tmp.x;
      state[o + 1] = tmp.y;
      state[o + 2] = tmp.z;
      state[o + 3] = tmp.size;
      state[o + 4] = tmp.alpha;
      state[o + 5] = tmp.heat;
      // View-space depth, for drawing far to near.
      const d = e[2] * tmp.x + e[6] * tmp.y + e[10] * tmp.z + e[14];
      order.push({ k, d });
    }
    order.sort((a, b) => a.d - b.d);
    const pos = geometry.getAttribute("aPos") as THREE.InstancedBufferAttribute;
    const data = geometry.getAttribute("aData") as THREE.InstancedBufferAttribute;
    const col = geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;
    order.forEach(({ k }, m) => {
      const o = k * 8;
      pos.setXYZ(m, state[o], state[o + 1], state[o + 2]);
      data.setXYZW(m, state[o + 3], state[o + 4], state[o + 5], list[k].s3);
      const c = COLORS[list[k].kind];
      // Each puff a slightly different grey-brown.
      const v = 0.85 + list[k].s2 * 0.3;
      col.setXYZ(m, c.r * v, c.g * v, c.b * v);
    });
    geometry.instanceCount = order.length;
    for (const a of [pos, data, col]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, order.length * a.itemSize);
      a.needsUpdate = true;
    }
    const u = material.uniforms;
    if (env.sunDir) {
      sunV.set(env.sunDir.x, env.sunDir.y, env.sunDir.z).transformDirection(view);
      u.uSunV.value.copy(sunV);
    }
    u.uLight.value = 0.35 + env.daylight * 0.75;
    u.uFlash.value = Math.max(bolt.flash, env.flash * 0.5);
    u.uTime.value = clock.elapsedTime;
    const fog = scene.fog as THREE.Fog | null;
    if (fog && "near" in fog) {
      u.uFogColor.value.copy(fog.color);
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    }
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}

// --- Incandescent spatter from the lava fountain ----------------------------

const SPARK_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uT;
uniform float uFrom;
uniform float uTo;
uniform vec3 uVent;
uniform float uPower;
varying float vHeat;
varying vec2 vUv;
varying float vAlive;
void main() {
  // Each spark loops: shot out of the vent, arcs, falls back and dies.
  float period = 1.6 + aSeed.w * 1.4;
  float local = uT - uFrom - aSeed.z * period;
  float cycle = floor(local / period);
  float age = local - cycle * period;
  float alive = step(0.0, local) * step(uT, uTo);
  float s = fract(sin((aSeed.x + cycle) * 91.7) * 4375.5);
  float ang = (aSeed.x + cycle * 0.37) * 6.2831;
  float up = (4.0 + s * 6.5) * uPower;
  float side = 0.6 + aSeed.y * 2.8;
  vec3 v = vec3(cos(ang) * side, up, sin(ang) * side);
  vec3 p = uVent + v * age + vec3(0.0, -4.9 * age * age, 0.0);
  alive *= step(uVent.y - 2.5, p.y);
  vec3 vel = v + vec3(0.0, -9.8 * age, 0.0);
  // Stretch the spark along its motion on screen.
  vec4 a = viewMatrix * vec4(p, 1.0);
  vec4 b = viewMatrix * vec4(p + vel * 0.045, 1.0);
  vec2 dir = b.xy - a.xy;
  float len = length(dir);
  dir = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
  vec2 across = vec2(-dir.y, dir.x);
  float w = 0.09 + aSeed.y * 0.08;
  vec2 c = position.xy;
  a.xy += across * c.x * w + dir * c.y * (len + w);
  gl_Position = projectionMatrix * a;
  vHeat = clamp(1.0 - age / period, 0.0, 1.0);
  vUv = uv;
  vAlive = alive;
}`;

const SPARK_FRAG = /* glsl */ `
varying float vHeat;
varying vec2 vUv;
varying float vAlive;
void main() {
  if (vAlive < 0.5) discard;
  vec2 c = vUv * 2.0 - 1.0;
  float a = smoothstep(1.0, 0.2, length(c));
  vec3 col = mix(vec3(0.8, 0.08, 0.01), vec3(1.0, 0.45, 0.08), vHeat * vHeat) * (0.8 + vHeat * 1.2);
  gl_FragColor = vec4(col * a, a);
}`;

function Sparks({ plan, getT }: { plan: EruptionPlan; getT: () => number }) {
  const N = 520;
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute("position", plane.getAttribute("position"));
    g.setAttribute("uv", plane.getAttribute("uv"));
    const seeds = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) {
      seeds[k * 4] = hash(k, 401);
      seeds[k * 4 + 1] = hash(k, 402);
      seeds[k * 4 + 2] = hash(k, 403);
      seeds[k * 4 + 3] = hash(k, 404);
    }
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = N;
    return g;
  }, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPARK_VERT,
        fragmentShader: SPARK_FRAG,
        uniforms: {
          uT: { value: 0 },
          uFrom: { value: plan.blast + 0.3 },
          uTo: { value: plan.end - 2.5 },
          uVent: { value: new THREE.Vector3(plan.cx, plan.cy + 0.3, plan.cz) },
          uPower: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [plan],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useFrame(() => {
    const t = getT();
    material.uniforms.uT.value = t;
    // Strongest just after the blast, pulsing, then dying back.
    const since = t - plan.blast;
    material.uniforms.uPower.value =
      (0.55 + 0.45 * Math.exp(-Math.max(0, since - 1) / 5)) * (0.9 + 0.1 * Math.sin(t * 7));
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}

// --- The lava itself --------------------------------------------------------

const LAVA_VERT = /* glsl */ `
attribute float aArrive;
attribute float aGround;
attribute float aEdge;
attribute float aHeat;
attribute vec2 aFlow;
uniform float uT;
varying float vSince;
varying float vEdge;
varying float vHeat;
varying vec2 vFlow;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  float since = uT - aArrive;
  float fill = smoothstep(0.0, 0.9, since);
  vSince = since;
  vEdge = aEdge;
  vHeat = aHeat;
  vFlow = aFlow;
  vec3 p = position;
  // A thick, rounded tongue: thickest in the middle, with a bulging front.
  float thick = 0.05 + 0.2 * smoothstep(0.45, 1.0, aEdge);
  float front = smoothstep(0.0, 0.3, since) * (1.0 - smoothstep(0.3, 1.6, since));
  p.y = aGround + 0.02 + thick * fill + front * 0.12 * aEdge - (1.0 - fill) * 0.4;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LAVA_FRAG = /* glsl */ `
uniform float uT;
uniform float uTime;
uniform float uLight;
uniform vec3 uSun;
varying float vSince;
varying float vEdge;
varying float vHeat;
varying vec2 vFlow;
varying vec3 vWorld;
#include <fog_pars_fragment>
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
// Distance to the nearest crack between crust plates (Voronoi cell borders).
float cracks(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0; float d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = h22(i + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
void main() {
  if (vSince < 0.0) discard;
  // Flowing: the surface creeps downhill, slower as it stiffens.
  float creep = min(vSince, 12.0) * 0.12 + uTime * 0.015;
  vec2 q = vWorld.xz * 2.3 - vFlow * creep;
  float warp = vn(q * 0.7) * 0.6;
  // How cooled the surface is: fresh at the front, crusting over behind.
  float fresh = 1.0 - smoothstep(0.0, 2.5, vSince);
  float cool = clamp(1.0 - vHeat, 0.0, 1.0);
  float crust = clamp(smoothstep(0.6, 5.0, vSince) * 0.95 * (1.6 - vHeat * 0.9) + cool * 0.9 - fresh * 0.6, 0.0, 1.0);
  float c1 = cracks(q + warp);
  float c2 = cracks(q * 2.7 + warp * 2.0);
  float plates = smoothstep(0.02, 0.16, c1) * (0.6 + 0.4 * smoothstep(0.01, 0.1, c2));
  // Molten colour: white-yellow when hottest, orange, then deep red.
  float t = clamp(vHeat * (0.7 + fresh * 0.6) + (vn(q * 3.0 + uTime * 0.3) - 0.5) * 0.25, 0.0, 1.2);
  vec3 molten = mix(vec3(0.45, 0.03, 0.005), vec3(1.0, 0.26, 0.02), smoothstep(0.15, 0.7, t));
  molten = mix(molten, vec3(1.0, 0.55, 0.16), smoothstep(0.95, 1.25, t));
  molten *= 1.1 + fresh * 0.4;
  // Crust: dark, ropey basalt with a faint sheen.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  float rope = vn(vec2(dot(q, vFlow) * 5.0, dot(q, vec2(-vFlow.y, vFlow.x)) * 1.2));
  // Fresh basalt: near-black, grey where it catches the light, a faint glassy sheen.
  vec3 rock = mix(vec3(0.035, 0.034, 0.036), vec3(0.12, 0.115, 0.115), rope * 0.7 + vn(q * 6.0) * 0.3);
  vec3 view = normalize(cameraPosition - vWorld);
  float sheen = pow(max(dot(reflect(-uSun, n), view), 0.0), 24.0) * 0.25;
  rock = (rock * (0.3 + 0.8 * max(dot(n, uSun), 0.0)) + sheen) * uLight;
  // The middle of a flow stays open longer: a channel of running lava.
  float channel = smoothstep(0.9, 1.0, vEdge) * (1.0 - smoothstep(3.0, 10.0, vSince)) * vn(q * 0.4 + 3.0);
  float crustN = crust - channel * 0.5 + (vn(q * 0.45 + 9.0) - 0.5) * 0.45;
  // Plates of crust with molten gaps between them, not a smeared mix.
  float covered = smoothstep(0.32, 0.5, crustN) * smoothstep(0.02, 0.09, c1) * (0.75 + 0.25 * smoothstep(0.01, 0.08, c2));
  vec3 col = mix(molten, rock, covered);
  // Cracks in the crust still glow while the flow is hot.
  float crack = (1.0 - smoothstep(0.0, 0.06, c1)) * smoothstep(0.3, 0.5, crustN);
  col += vec3(1.0, 0.2, 0.02) * crack * vHeat * vHeat * (1.2 - cool);
  // Dark crusty levees along the edges.
  float rag = (vn(vWorld.xz * 2.2) - 0.5) * 0.45 + (vn(vWorld.xz * 6.0) - 0.5) * 0.15;
  float edge = vEdge + rag;
  col = mix(rock, col, smoothstep(0.55, 0.8, edge));
  float a = smoothstep(0.4, 0.5, edge);
  if (a < 0.01) discard;
  // Glowing lava shines through the haze; the dark crust fades into it.
  float glow = clamp(max(col.r, col.g) - 0.35, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogK = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogK = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    fogK *= 1.0 - glow * 0.75;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogK);
  #endif
}`;

/**
 * A lava surface over a set of tiles, draped over the ground. The tiles are
 * blurred into a smooth field so flows come out as rounded tongues and lobes
 * rather than squares; the shader cuts the outline where the field is thin.
 * `arriveOf` says when each tile fills; `heatOf` how molten it is.
 */
export function lavaGeometry(
  tiles: Tile[],
  cover: number[],
  arriveOf: (i: number) => number,
  heatOf: (i: number) => number,
  lift = 0,
) {
  const set = new Set(cover);
  const cand = new Set<number>();
  for (const i of cover) {
    cand.add(i);
    for (const n of around(i)) cand.add(n);
  }
  const S = 4;
  const R = 0.8;
  const pos: number[] = [];
  const arrive: number[] = [];
  const ground: number[] = [];
  const edge: number[] = [];
  const heat: number[] = [];
  const flow: number[] = [];
  const index: number[] = [];
  const sample = (px: number, pz: number) => {
    // Tile coordinates of the point.
    const fx = px + HALF - 0.5;
    const fz = pz + HALF - 0.5;
    const cx = Math.round(fx);
    const cz = Math.round(fz);
    let dens = 0;
    let wsum = 0;
    let at = 0;
    let hot = 0;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (!inBounds(x, z)) continue;
        const i = idx(x, z);
        if (!set.has(i)) continue;
        const d = Math.hypot(x - fx, z - fz);
        const k = Math.exp(-((d / R) ** 2));
        dens += k;
        wsum += k;
        at += arriveOf(i) * k;
        hot += heatOf(i) * k;
      }
    return {
      dens: Math.min(1, dens),
      at: wsum > 1e-4 ? at / wsum : 999,
      heat: wsum > 1e-4 ? hot / wsum : 0,
    };
  };
  let base = 0;
  for (const i of cand) {
    const x0 = tx(i) - HALF;
    const z0 = ty(i) - HALF;
    const first = base;
    let any = false;
    for (let b = 0; b <= S; b++)
      for (let a = 0; a <= S; a++) {
        const px = x0 + a / S;
        const pz = z0 + b / S;
        const f = sample(px, pz);
        if (f.dens > 0.3) any = true;
        pos.push(px, 0, pz);
        edge.push(f.dens);
        arrive.push(f.at);
        heat.push(f.heat);
        ground.push(Math.max(0, heightAt(tiles, px, pz)) + lift * Math.min(1, f.dens * 1.5));
        const d = 0.5;
        let gx = heightAt(tiles, px - d, pz) - heightAt(tiles, px + d, pz);
        let gz = heightAt(tiles, px, pz - d) - heightAt(tiles, px, pz + d);
        const gl = Math.hypot(gx, gz) || 1;
        gx /= gl;
        gz /= gl;
        flow.push(gx, gz);
        base++;
      }
    if (!any) {
      // Nothing of this tile shows: drop its vertices again.
      const n = (S + 1) * (S + 1);
      pos.length -= n * 3;
      edge.length -= n;
      arrive.length -= n;
      heat.length -= n;
      ground.length -= n;
      flow.length -= n * 2;
      base = first;
      continue;
    }
    for (let b = 0; b < S; b++)
      for (let a = 0; a < S; a++) {
        const v = first + b * (S + 1) + a;
        index.push(v, v + S + 1, v + 1, v + 1, v + S + 1, v + S + 2);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aArrive", new THREE.Float32BufferAttribute(arrive, 1));
  g.setAttribute("aGround", new THREE.Float32BufferAttribute(ground, 1));
  g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute("aHeat", new THREE.Float32BufferAttribute(heat, 1));
  g.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(index);
  return g;
}

export function lavaMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: LAVA_VERT,
    fragmentShader: LAVA_FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uT: { value: 1000 },
        uTime: { value: 0 },
        uLight: { value: 1 },
        uSun: { value: new THREE.Vector3(0.5, 0.75, 0.3).normalize() },
      },
    ]),
    transparent: true,
    fog: true,
    side: THREE.DoubleSide,
  });
}

/** Keeps a lava material's clock and lighting current. */
export function tickLava(m: THREE.ShaderMaterial, time: number) {
  m.uniforms.uTime.value = time;
  m.uniforms.uLight.value = 0.3 + env.daylight * 0.8;
  if (env.sunDir) m.uniforms.uSun.value.set(env.sunDir.x, env.sunDir.y, env.sunDir.z);
}

// --- Lightning in the ash cloud ---------------------------------------------

const bolt = { flash: 0 };

function boltGeometry(seed: number) {
  const pts: THREE.Vector3[] = [];
  let x = 0;
  let z = 0;
  const n = 9;
  for (let k = 0; k <= n; k++) {
    pts.push(new THREE.Vector3(x, -k * 1.1, z));
    x += (hash(seed, k, 1) - 0.5) * 1.6;
    z += (hash(seed, k, 2) - 0.5) * 1.6;
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1);
  return new THREE.TubeGeometry(curve, 30, 0.06, 4, false);
}

function Lightning({ plan, getT }: { plan: EruptionPlan; getT: () => number }) {
  const geos = useMemo(() => [0, 1, 2, 3].map((k) => boltGeometry(k + 7)), []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  useFrame(() => {
    const t = getT();
    // Strikes come in bursts once the column is up.
    const slot = Math.floor(t * 5);
    const live = t > plan.blast + 3.5 && t < plan.end - 2 && hash(slot, 811) < 0.16;
    const since = t * 5 - slot;
    bolt.flash = live ? Math.max(0, 1 - since * 1.5) : bolt.flash * 0.8;
    refs.current.forEach((m, k) => {
      if (!m) return;
      const mine = live && Math.floor(hash(slot, 812) * 4) === k;
      m.visible = mine && since < 0.6;
      if (mine) {
        const a = hash(slot, 813) * Math.PI * 2;
        const r = 2 + hash(slot, 814) * 6;
        const h = 14 + hash(slot, 815) * 18;
        m.position.set(plan.cx + Math.cos(a) * r, plan.cy + h, plan.cz + Math.sin(a) * r);
        m.rotation.set(0, hash(slot, 816) * 6, (hash(slot, 817) - 0.5) * 1.2);
        m.scale.setScalar(1 + hash(slot, 818) * 1.2);
      }
    });
  });
  return (
    <>
      {geos.map((g, k) => (
        <mesh
          key={k}
          ref={(m) => {
            refs.current[k] = m;
          }}
          geometry={g}
          visible={false}
          renderOrder={6}
        >
          <meshBasicMaterial color="#f2f0ff" toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// --- The whole show ---------------------------------------------------------

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export function EruptionSpectacle({
  before,
  record,
  getT,
  shake,
  flashRef,
}: {
  before: WorldState;
  record: ActionRecord;
  getT: () => number;
  shake: { current: number };
  flashRef: { current: number };
}) {
  const plan = useMemo(() => eruptionPlan(before, record), [before, record]);
  const rocks = useMemo(() => bombs(plan, before.tiles), [plan, before.tiles]);
  const rockMesh = useRef<THREE.InstancedMesh>(null);
  const dome = useRef<THREE.Mesh>(null);
  const flow = useMemo(() => {
    const cover = [...plan.arrival.keys()];
    return lavaGeometry(
      before.tiles,
      cover,
      (i) => plan.arrival.get(i) ?? 0,
      () => 1,
      // The sim raises the ground under the flow as it arrives.
      0.13,
    );
  }, [plan, before.tiles]);
  const flowMat = useMemo(() => lavaMaterial(), []);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const camFrom = useRef<{ p: THREE.Vector3; t: THREE.Vector3; ang: number } | null>(null);
  // Let the camera look up at the column while the act plays.
  useEffect(() => {
    const c = controls as unknown as { maxPolarAngle: number } | null;
    if (!c) return;
    const was = c.maxPolarAngle;
    c.maxPolarAngle = 1.75;
    return () => {
      c.maxPolarAngle = was;
    };
  }, [controls]);

  useEffect(
    () => () => {
      flow.dispose();
      flowMat.dispose();
      eruptBus.active = false;
      eruptBus.plan = null;
      env.actLight = 0;
    },
    [flow, flowMat],
  );

  useFrame(({ clock }) => {
    const t = getT();
    eruptBus.active = t < plan.end;
    eruptBus.plan = plan;
    eruptBus.t = t;
    const since = t - plan.blast;

    // 1. Rumbling, then the blast, then the long roar of the column.
    if (since < 0) shake.current = Math.max(shake.current, 0.03 + (t / plan.blast) * 0.12);
    else if (since < 1.2) {
      shake.current = Math.max(shake.current, 0.6 * (1 - since / 1.2) + 0.15);
      if (since < 0.1) flashRef.current = 0.9;
    } else if (t < plan.end - 3) shake.current = Math.max(shake.current, 0.05);

    // The crater's glow lights the land around it.
    env.actLight =
      (since < 0 ? 0.3 + (t / plan.blast) * 0.5 : since < 1 ? 4 - since * 2 : 1.6) *
      (0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 3.1));
    env.actLightPos = [plan.cx, plan.cy + 3, plan.cz];

    // 2. The blast's shock wave: a condensation dome racing outwards.
    const d = dome.current;
    if (d) {
      const k = since / 1.4;
      d.visible = k > 0 && k < 1;
      d.scale.setScalar(1 + k * 34);
      (d.material as THREE.MeshBasicMaterial).opacity = 0.2 * (1 - k) * (1 - k);
    }

    // 3. Flying rocks: glowing, cooling as they fly, left smoking where they land.
    const rm = rockMesh.current;
    if (rm) {
      rocks.forEach((b, k) => {
        const s = t - b.t0;
        if (s < 0 || s > b.flight + 6) {
          rm.setMatrixAt(k, HIDE);
          return;
        }
        bombAt(plan, b, s, v1);
        const spin = Math.min(s, b.flight) * 4;
        tmpQ.setFromEuler(tmpE.set(spin + k, spin * 0.7, k));
        tmpM.compose(v1, tmpQ, tmpS.setScalar(b.size * (s > b.flight ? 1.2 : 1)));
        rm.setMatrixAt(k, tmpM);
      });
      rm.instanceMatrix.needsUpdate = true;
    }

    // 4. The lava.
    flowMat.uniforms.uT.value = t;
    tickLava(flowMat, clock.elapsedTime);

    // 5. Camera: on the flank for the blast, back to take in the column,
    // then up and round to follow the lava down the mountain.
    if (controls) {
      if (!camFrom.current) {
        const off = camera.position.clone().sub(new THREE.Vector3(plan.cx, 0, plan.cz));
        camFrom.current = {
          p: camera.position.clone(),
          t: controls.target.clone(),
          ang: Math.atan2(off.z, off.x),
        };
      }
      const a0 = camFrom.current.ang;
      const at = (ang: number, r: number, y: number) =>
        new THREE.Vector3(plan.cx + Math.cos(ang) * r, y, plan.cz + Math.sin(ang) * r);
      const closeP = at(a0, 40, plan.cy + 2);
      const closeT = new THREE.Vector3(plan.cx, plan.cy + 5, plan.cz);
      const wideP = at(a0 + 0.35, 88, plan.cy + 9);
      const wideT = new THREE.Vector3(plan.cx, plan.cy + 13, plan.cz);
      const flowP = at(a0 + 0.8, 58, plan.cy + 38);
      const flowT = new THREE.Vector3(plan.cx, Math.max(0, plan.cy * 0.35), plan.cz);
      const a = THREE.MathUtils.smoothstep(t, 0, 1.8);
      const b = THREE.MathUtils.smoothstep(t, plan.blast + 1.2, plan.blast + 7);
      const c = THREE.MathUtils.smoothstep(t, plan.blast + 9, plan.blast + 14);
      const p = camFrom.current.p.clone().lerp(closeP, a).lerp(wideP, b).lerp(flowP, c);
      const tg = camFrom.current.t.clone().lerp(closeT, a).lerp(wideT, b).lerp(flowT, c);
      camera.position.copy(p);
      controls.target.copy(tg);
      controls.update();
    }
  });

  return (
    <group>
      <mesh geometry={flow} material={flowMat} renderOrder={1} frustumCulled={false} />
      <instancedMesh
        ref={rockMesh}
        args={[undefined, undefined, rocks.length]}
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#231a16"
          emissive="#ff4a10"
          emissiveIntensity={0.9}
          roughness={0.9}
          flatShading
        />
      </instancedMesh>
      <mesh ref={dome} position={[plan.cx, plan.cy, plan.cz]} visible={false} renderOrder={3}>
        <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial color="#f4efe8" transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Sparks plan={plan} getT={getT} />
      <Billows plan={plan} tiles={before.tiles} rocks={rocks} getT={getT} />
      <Lightning plan={plan} getT={getT} />
    </group>
  );
}
