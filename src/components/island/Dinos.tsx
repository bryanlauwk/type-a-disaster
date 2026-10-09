import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { SPECIES_DEFS, tuned } from "@/lib/island/species";
import { geography } from "@/lib/island/terrain";
import { seasonOf } from "@/lib/island/sim";
import {
  SEA,
  SPECIES,
  wx,
  wz,
  type Herd,
  type RegionId,
  type SpeciesId,
  type WorldState,
} from "@/lib/island/types";
import { MODELS, type Anim, type Geo, type Part, type Role } from "./dinoModels";
import { heightAt, tileAtWorld } from "./palette";
import { clipRows, coatLayers, loadSkin, type ClipName, type Skin } from "./dinoSkins";
import { COATS, FORMS, pickLook } from "./dinoForms";
import { surgeBus } from "./Tsunami";
import { eruptBus } from "./Eruption";
import { dustBus } from "./fx/dust";
import { newGroup, panic, slotOf, stepGroup, type HerdGroup } from "./herds";
import { env } from "./fx/env";
import { lifeBus } from "./lifeBus";
import { gaitPose, turnRateFor, updateFatigue, type GaitFamily } from "./animalKinetics";

/**
 * The island's animals on screen. The simulation says how many of each
 * species live in each region and which herds are on the move; this turns
 * that into animals you can watch: grazing in herds, drinking, nesting,
 * hunting, fleeing, migrating along the real routes, circling the cliffs and
 * surfacing offshore. Animals are drawn from a handful of instanced
 * primitives per species.
 */

type State =
  | "idle"
  | "graze"
  | "walk"
  | "run"
  | "drink"
  | "flee"
  | "hunt"
  | "eat"
  | "nest"
  | "dead";

export interface Agent {
  id: number;
  sp: SpeciesId;
  region: RegionId;
  herd: number;
  slot: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  speed: number;
  state: State;
  timer: number;
  tx: number;
  tz: number;
  scale: number;
  phase: number;
  shade: number;
  /** Seconds since death, for the carcass to sink away. */
  deadFor: number;
  prey: Agent | null;
  nextThink: number;
  /** A scripted run (a stampede, a raid): waypoints to follow, then gone. */
  path?: { x: number; z: number }[];
  pathAt?: number;
  runSpeed?: number;
  /** What the real model is playing, and the clip it's fading out of. */
  clip: ClipName;
  clipT: number;
  prevClip: ClipName;
  prevT: number;
  fade: number;
  /** A one-off action (a roar, a lunge) that plays over the current state. */
  act?: ClipName;
  actFor: number;
  /** The idle a standing animal is doing: resting, looking round, sniffing. */
  idleAs: ClipName;
  /** A youngster keeps close to an adult of its kind. */
  mum: Agent | null;
  young: boolean;
  /** Seconds spent carried by floodwater. */
  swept?: number;
  /** Body tilt to lie along the ground: nose up/down, and side to side. */
  pitch: number;
  roll: number;
  /** Which of the species' looks (model) this animal has, and its own colouring and build. */
  form: number;
  look: [number, number, number, number];
  look2: [number, number, number, number];
  build: [number, number];
  /** Fastest this animal can walk and run with its feet still gripping the ground. */
  maxWalk?: number;
  maxRun?: number;
  /** Seconds until the next puff of dust from its feet. */
  dust?: number;
  /** The herd it grazes with (plant-eaters), and which way it wants to face when standing. */
  group?: string;
  face?: number;
  /** Kinetic state used for weight, secondary motion and the live inspector. */
  acceleration: number;
  yawRate: number;
  fatigue: number;
  prevSpeed: number;
  prevYaw: number;
  intent: string;
  alertness: "calm" | "watchful" | "alarmed";
}


/** How many animals each simulated one looks like on screen. */
const SHOW: Record<SpeciesId, number> = {
  titan: 0.45,
  hornface: 0.22,
  duckbill: 0.22,
  plateback: 0.35,
  snapper: 0.25,
  tyrant: 1,
  raptor: 0.55,
  skywing: 0.25,
  leviathan: 1,
};
const MAX_AGENTS = 230;
/** Most animals of one species drawn at once with a real model. */
const SKIN_CAP = 160;
const WALK: Record<SpeciesId, number> = {
  titan: 0.9,
  hornface: 0.8,
  duckbill: 0.85,
  plateback: 0.6,
  snapper: 1.2,
  tyrant: 1.1,
  raptor: 1.3,
  skywing: 3.2,
  leviathan: 0.8,
};
const RUN = 2.6;

function gaitFamily(sp: SpeciesId, gait: string): GaitFamily {
  if (gait === "fly" || gait === "swim") return gait;
  if (gait === "biped") return "biped";
  return sp === "titan" || sp === "plateback" ? "heavy-quad" : "quad";
}

/** Body length on screen at the species' standard size (world units). */
/**
 * Body length on screen at the species' standard size (world units): the
 * real animals' lengths at one scale (about 0.19 units a metre, the same as
 * the people): Brachiosaurus ~23 m, Triceratops ~9 m, Parasaurolophus ~9.5 m,
 * Ankylosaurus ~7 m, Compsognathus ~1 m, T. rex ~12.5 m, Deinonychus ~3 m,
 * Pteranodon ~1.9 m long (6 m wings), Mosasaurus ~13 m.
 */
const LENGTH: Record<SpeciesId, number> = {
  titan: 4.4,
  hornface: 1.7,
  duckbill: 1.8,
  plateback: 1.35,
  snapper: 0.2,
  tyrant: 2.4,
  raptor: 0.58,
  skywing: 0.36,
  leviathan: 2.5,
};
/** Body lengths covered per cycle of each moving clip, so feet don't skate. */
const TRAVEL: Partial<Record<ClipName, number>> = { walk: 0.55, run: 1.2, creep: 0.3 };
const FALLBACK: Partial<Record<ClipName, ClipName[]>> = {
  graze: ["idle"],
  rest: ["idle"],
  eat: ["graze", "idle"],
  run: ["walk"],
  creep: ["walk"],
  roar: ["idle"],
  look: ["idle"],
  sniff: ["idle"],
  attack: ["eat", "idle"],
  tail: ["roar", "idle"],
  fly: ["glide", "walk"],
  glide: ["fly"],
  swim: ["walk", "idle"],
  walk: ["idle"],
};
/** Idle variations each species picks from when it stands about. */
const IDLES: Partial<Record<SpeciesId, ClipName[]>> = {
  tyrant: ["idle", "idle", "sniff", "roar"],
  raptor: ["idle", "look", "look"],
  hornface: ["idle", "idle", "rest"],
  plateback: ["idle"],
};

const GEOS: Geo[] = ["sphere", "capsule", "cone", "box", "cyl"];
function unitGeometry(g: Geo): THREE.BufferGeometry {
  switch (g) {
    case "sphere":
      return new THREE.SphereGeometry(0.5, 10, 8);
    case "capsule":
      return new THREE.CapsuleGeometry(0.5, 1, 3, 8).scale(1, 0.5, 1);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 8);
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cyl":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
  }
}

interface PreparedPart {
  part: Part;
  local: THREE.Matrix4;
  toPivot: THREE.Matrix4;
  fromPivot: THREE.Matrix4;
  color: Record<Role, THREE.Color>;
}

function prepare(sp: SpeciesId): Record<Geo, PreparedPart[]> {
  const model = MODELS[sp];
  const colors = Object.fromEntries(
    Object.entries(model.colors).map(([k, v]) => [k, new THREE.Color(v)]),
  ) as Record<Role, THREE.Color>;
  const out = Object.fromEntries(GEOS.map((g) => [g, [] as PreparedPart[]])) as Record<
    Geo,
    PreparedPart[]
  >;
  for (const part of model.parts) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...part.p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.r ?? [0, 0, 0]))),
      new THREE.Vector3(...part.s),
    );
    const pv = part.pivot ?? [part.p[0], part.p[1] + part.s[1] / 2, part.p[2]];
    out[part.geo].push({
      part,
      local,
      toPivot: new THREE.Matrix4().makeTranslation(pv[0], pv[1], pv[2]),
      fromPivot: new THREE.Matrix4().makeTranslation(-pv[0], -pv[1], -pv[2]),
      color: colors,
    });
  }
  return out;
}

const PREPARED = Object.fromEntries(SPECIES.map((sp) => [sp, prepare(sp)])) as Record<
  SpeciesId,
  Record<Geo, PreparedPart[]>
>;

// Scratch objects.
const base = new THREE.Matrix4();
const anim = new THREE.Matrix4();
const rot = new THREE.Matrix4();
const out = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const v3 = new THREE.Vector3();

/** Moves an animal's clips along: picks the right one, crossfades, keeps feet planted. */
function animate(a: Agent, skin: Skin, gait: string, t: number, dt: number) {
  if (a.actFor > 0) {
    a.actFor -= dt;
    if (a.actFor <= 0) {
      a.actFor = 0;
      a.act = undefined;
    }
  }
  // Now and then a standing animal changes what it's doing: looks round, sniffs the air.
  const idles = IDLES[a.sp];
  if (idles && a.clip === a.idleAs && a.clipT > (skin.meta.clips[a.clip]?.dur ?? 3) * 2) {
    const next = idles[Math.floor(hash(a.id, Math.floor(t / 4)) * idles.length)];
    a.idleAs = next === "roar" && hash(a.id, Math.floor(t / 9), 5) > 0.3 ? "idle" : next;
  }
  // A model that has just loaded may not have the clip the stand-in was playing.
  if (!skin.meta.clips[a.clip]) {
    a.clip = resolve(skin, a.clip);
    a.fade = 0;
  }
  const want = resolve(skin, wantClip(a, gait, t));
  if (want !== a.clip) {
    a.prevClip = a.clip;
    a.prevT = a.clipT;
    a.fade = 1;
    a.clip = want;
    a.clipT = want === "roar" || want === "attack" || want === "tail" ? 0 : hash(a.id, 13) * 2;
  }
  const meta = skin.meta.clips[a.clip]!;
  const len = lengthOf(a);
  // How fast its legs can carry it: the stride measured from the model's own
  // walk and run, played at most a little faster than recorded.
  const speedOf = (c: ClipName, most: number) => {
    const m = skin.meta.clips[c];
    const tr = m?.travel ?? TRAVEL[c];
    return m && tr ? ((tr * len) / m.dur) * most : undefined;
  };
  a.maxWalk = speedOf("walk", 1.5);
  a.maxRun = speedOf("run", 2) ?? (a.maxWalk ? a.maxWalk * 1.4 : undefined);
  let rate = 1;
  const travel = meta.travel ?? TRAVEL[a.clip];
  if (a.state === "dead") rate = 0;
  else if (travel) {
    // Cycles per second that match the ground speed, so the feet don't skate.
    const natural = 1 / meta.dur;
    const cycles = a.speed / (travel * len);
    rate = Math.min(a.clip === "run" ? 2 : 1.5, Math.max(0.5, cycles / natural));
  }
  a.clipT += dt * rate;
  if (a.fade > 0) {
    a.prevT += dt;
    a.fade = Math.max(0, a.fade - dt / 0.3);
  }
}

/** The animation pose for a part's joint. */
function jointRotation(a: Anim, ag: Agent, t: number, gait: string): THREE.Matrix4 {
  const moving =
    ag.state === "walk" || ag.state === "run" || ag.state === "flee" || ag.state === "hunt";
  const pose = gaitPose(gaitFamily(ag.sp, gait), {
    speed: moving ? ag.speed : 0,
    maxWalk: ag.maxWalk ?? WALK[ag.sp],
    maxRun: ag.maxRun ?? WALK[ag.sp] * RUN,
    yawRate: ag.yawRate,
    acceleration: ag.acceleration,
    fatigue: ag.fatigue,
  });
  const stride = pose.stride;
  const ph = ag.phase;
  switch (a) {
    case "legFL":
      if (gait === "swim") return rot.makeRotationZ(Math.sin(t * 2 + ag.id) * 0.4);
      return rot.makeRotationX(Math.sin(ph + pose.phaseFrontLeft) * stride);
    case "legFR":
      if (gait === "swim") return rot.makeRotationZ(-Math.sin(t * 2 + ag.id) * 0.4);
      return rot.makeRotationX(Math.sin(ph + pose.phaseFrontRight) * stride);
    case "legBL":
      return rot.makeRotationX(Math.sin(ph + pose.phaseBackLeft) * stride);
    case "legBR":
      return rot.makeRotationX(Math.sin(ph + pose.phaseBackRight) * stride);
    case "neck":
      return rot.makeRotationFromEuler(
        e.set(
          ag.state === "graze" || ag.state === "drink" ? 0.35 : Math.sin(t * 0.7 + ag.id) * 0.08,
          Math.sin(t * 0.5 + ag.id) * 0.18 + pose.headCounterTurn,
          0,
        ),
      );
    case "head":
      if (ag.state === "graze" || ag.state === "drink" || ag.state === "eat")
        return rot.makeRotationX(0.6 + Math.sin(t * 3 + ag.id) * 0.12);
      return rot.makeRotationFromEuler(
        e.set(
          Math.sin(t * 1.3 + ag.id) * 0.05 + pose.bodyLean,
          Math.sin(t * 0.8 + ag.id) * 0.14 + pose.headCounterTurn,
          0,
        ),
      );
    case "tail":
      return rot.makeRotationY(
        Math.sin(t * (moving ? 3 : 1.2) + ag.id) * (moving ? 0.16 : 0.1) + pose.tailLag,
      );
    case "jaw":
      return rot.makeRotationX(
        ag.state === "eat" || ag.state === "hunt" ? 0.25 + Math.sin(t * 6) * 0.2 : 0.03,
      );
    case "wingL":
      return rot.makeRotationZ(Math.sin(ph) * 0.7);
    case "wingR":
      return rot.makeRotationZ(-Math.sin(ph) * 0.7);
  }
}

let nextId = 1;

function landTile(
  world: WorldState,
  list: number[],
  seedA: number,
  seedB: number,
  sp: SpeciesId,
): number {
  const model = MODELS[sp];
  for (let k = 0; k < 12; k++) {
    const i = list[Math.floor(hash(seedA, seedB, k) * list.length)];
    if (i === undefined) continue;
    const t = world.tiles[i];
    if (model.gait === "swim") {
      if (t.water === SEA && t.h < -0.6) return i;
    } else if (!t.water || model.gait === "fly") return i;
  }
  return list[0] ?? 0;
}

function spawn(world: WorldState, sp: SpeciesId, region: RegionId, herd = 0, at?: number): Agent {
  const geo = geography(world);
  const id = nextId++;
  const i = at ?? landTile(world, geo.tiles[region], id, 7, sp);
  const x = wx(i) + (hash(id, 1) - 0.5) * 0.8;
  const z = wz(i) + (hash(id, 2) - 0.5) * 0.8;
  const young = hash(id, 3) < 0.25;
  const lk = pickLook(sp, region, id, young);
  return {
    id,
    sp,
    region,
    herd,
    slot: 0,
    x,
    z,
    y: heightAt(world.tiles, x, z),
    yaw: hash(id, 4) * Math.PI * 2,
    speed: 0,
    state: "idle",
    timer: hash(id, 5) * 3,
    tx: x,
    tz: z,
    // Grown animals range from small to big old ones; youngsters are small.
    scale:
      tuned(SPECIES_DEFS[sp], world.traits[sp]).size *
      (young
        ? 0.45 + hash(id, 6) * 0.2
        : 0.8 + hash(id, 6) * 0.3 + (hash(id, 14) < 0.1 ? 0.15 : 0)),
    phase: 0,
    shade: 0.88 + hash(id, 8) * 0.24,
    deadFor: 0,
    prey: null,
    nextThink: 0,
    clip: "idle",
    clipT: hash(id, 11) * 5,
    prevClip: "idle",
    prevT: 0,
    fade: 0,
    actFor: 0,
    idleAs: "idle",
    mum: null,
    young,
    pitch: 0,
    roll: 0,
    form: lk.form,
    look: lk.look,
    look2: lk.look2,
    build: lk.build,
    acceleration: 0,
    yawRate: 0,
    fatigue: 0,
    prevSpeed: 0,
    prevYaw: hash(id, 4) * Math.PI * 2,
    intent: "Resting",
    alertness: "calm",
  };
}

/** An animal's body length on screen. */
function lengthOf(a: Agent) {
  return (a.scale / SPECIES_DEFS[a.sp].size) * LENGTH[a.sp] * FORMS[a.sp][a.form].size;
}

function has(skin: Skin | undefined, c: ClipName): boolean {
  return !!skin?.meta.clips[c];
}

/** The nearest clip a model actually has. */
function resolve(skin: Skin, c: ClipName): ClipName {
  if (has(skin, c)) return c;
  for (const f of FALLBACK[c] ?? []) if (has(skin, f)) return resolve(skin, f);
  return (Object.keys(skin.meta.clips)[0] as ClipName) ?? "idle";
}

/** What an animal's body should be doing, given what it's up to. */
function wantClip(a: Agent, gait: string, t: number): ClipName {
  if (a.act && a.actFor > 0) return a.act;
  if (a.state === "dead") return "idle";
  if (gait === "swim") return "swim";
  if (gait === "fly") return Math.sin(t * 0.35 + a.id * 1.7) > 0.1 ? "glide" : "fly";
  if (a.path || a.state === "flee") return "run";
  if (a.state === "hunt") {
    const pr = a.prey;
    if (a.sp === "raptor" && pr && Math.hypot(pr.x - a.x, pr.z - a.z) > 3) return "creep";
    return "run";
  }
  if (a.state === "eat") return SPECIES_DEFS[a.sp].diet === "plants" ? "graze" : "eat";
  if (a.state === "graze" || a.state === "drink") return "graze";
  if (a.state === "nest") return "rest";
  if (a.speed > 0.04)
    return a.speed > (a.maxWalk ? a.maxWalk * 0.97 : WALK[a.sp] * 1.7) ? "run" : "walk";
  return a.idleAs;
}

export function Dinos({ world, getPhase }: { world: WorldState; getPhase: () => number }) {
  const agents = useRef<Agent[]>([]);
  const worldRef = useRef(world);
  worldRef.current = world;
  // An anchor per species and region that each little herd grazes around.
  const anchors = useRef(new Map<string, { i: number; until: number }>());
  // Plant-eaters' herds: a shared centre and mood for each kind in each place.
  const groups = useRef(new Map<string, HerdGroup>());

  // Match the animals on screen to the simulation.
  useEffect(() => {
    const geo = geography(world);
    const list = agents.current;
    const want = new Map<string, number>();
    let total = 0;
    for (const sp of SPECIES)
      for (const [r, n] of Object.entries(world.pop[sp]) as [RegionId, number][]) {
        const v = Math.max(n >= 0.5 ? 1 : 0, Math.round(n * SHOW[sp]));
        want.set(`${sp}|${r}`, v);
        total += v;
      }
    const herdWant = new Map<number, number>();
    for (const h of world.herds) {
      const v = Math.max(1, Math.round(h.count * SHOW[h.species]));
      herdWant.set(h.id, v);
      total += v;
    }
    const factor = Math.min(1, MAX_AGENTS / Math.max(1, total));
    // Herds that have arrived hand their animals to the region they reached.
    const herds = new Map(world.herds.map((h) => [h.id, h]));
    for (const a of list)
      if (a.herd && !herds.has(a.herd)) {
        const prev = prevHerds.current.get(a.herd);
        a.herd = 0;
        if (prev) a.region = prev.to;
        a.state = "idle";
      }
    prevHerds.current = herds;
    // New herds take their animals from the region they're leaving.
    for (const h of world.herds) {
      const n = Math.max(1, Math.round((herdWant.get(h.id) ?? 1) * factor));
      const mine = list.filter((a) => a.herd === h.id);
      let need = n - mine.length;
      if (need <= 0) continue;
      for (const a of list) {
        if (need <= 0) break;
        if (!a.herd && a.sp === h.species && a.region === h.from && a.state !== "dead") {
          a.herd = h.id;
          a.slot = mine.length + (n - need);
          need--;
        }
      }
      while (need-- > 0) {
        const a = spawn(world, h.species, h.from, h.id, h.path[Math.floor(h.at)]);
        a.slot = n - need;
        list.push(a);
      }
    }
    // Regional populations.
    const have = new Map<string, Agent[]>();
    for (const a of list) {
      if (a.herd || a.path || a.state === "dead") continue;
      const k = `${a.sp}|${a.region}`;
      if (!have.has(k)) have.set(k, []);
      have.get(k)!.push(a);
    }
    for (const [k, v] of want) {
      const n = Math.round(v * factor) || (v > 0 ? 1 : 0);
      const cur = have.get(k) ?? [];
      const [sp, r] = k.split("|") as [SpeciesId, RegionId];
      for (let m = cur.length; m < n; m++) list.push(spawn(world, sp, r));
      // Too many: the surplus quietly wanders off (or has died).
      for (let m = n; m < cur.length; m++) cur[m].state = "dead";
    }
    for (const [k, cur] of have) if (!want.has(k)) for (const a of cur) a.state = "dead";
    // Sizes follow evolution.
    for (const a of list) {
      const size = tuned(SPECIES_DEFS[a.sp], world.traits[a.sp]).size;
      if (a.scale > size * 1.5 || a.scale < size * 0.4) a.scale = size;
    }
    void geo;
  }, [world]);
  const prevHerds = useRef(new Map<number, Herd>());

  // The real models, as they arrive; until then a species keeps its sketch.
  // Each species' first look loads first, the others once those are in.
  const [skins, setSkins] = useState<Record<string, Skin>>({});
  const skinsRef = useRef(skins);
  skinsRef.current = skins;
  useEffect(() => {
    let live = true;
    const load = (key: string) =>
      loadSkin(key)
        .then((skin) => live && setSkins((cur) => ({ ...cur, [key]: skin })))
        .catch((err) => console.warn(`No model for ${key}:`, err));
    Promise.all(SPECIES.map((sp) => load(FORMS[sp][0].key))).then(() => {
      for (const sp of SPECIES) for (const f of FORMS[sp].slice(1)) load(f.key);
    });
    return () => {
      live = false;
    };
  }, []);
  const skinMeshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  // Feather layers over the coated looks, drawn from the same instances.
  const coatMeshes = useRef<Record<string, (THREE.InstancedMesh | null)[]>>({});
  const coatMats = useMemo(() => {
    const out: Record<string, THREE.Material[] | THREE.Material[][]> = {};
    for (const [key, skin] of Object.entries(skins)) {
      const c = COATS[key];
      if (c) out[key] = coatLayers(skin, c.layers, c.len, c.legs) as THREE.Material[];
    }
    return out;
  }, [skins]);
  interface SkinAttrs {
    a: THREE.InstancedBufferAttribute;
    b: THREE.InstancedBufferAttribute;
    f: THREE.InstancedBufferAttribute;
    l: THREE.InstancedBufferAttribute;
    l2: THREE.InstancedBufferAttribute;
  }
  const skinAttrs = useMemo(() => {
    const out: Record<string, SkinAttrs> = {};
    const attr = (n: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(SKIN_CAP * n), n).setUsage(
        THREE.DynamicDrawUsage,
      );
    for (const sp of SPECIES)
      for (const f of FORMS[sp])
        out[f.key] = { a: attr(3), b: attr(3), f: attr(1), l: attr(4), l2: attr(4) };
    return out;
  }, []);
  // Each look's mesh gets its own per-animal animation and colouring attributes.
  const skinGeoCache = useRef<Record<string, THREE.BufferGeometry>>({});
  const skinGeo = (key: string, skin: Skin) => {
    let g = skinGeoCache.current[key];
    if (!g) {
      g = skin.geometry.clone();
      const at = skinAttrs[key];
      g.setAttribute("aAnimA", at.a);
      g.setAttribute("aAnimB", at.b);
      g.setAttribute("aFade", at.f);
      g.setAttribute("aLook", at.l);
      g.setAttribute("aLook2", at.l2);
      skinGeoCache.current[key] = g;
    }
    return g;
  };

  const prepared = PREPARED;
  const geos = useMemo(
    () =>
      Object.fromEntries(GEOS.map((g) => [g, unitGeometry(g)])) as Record<
        Geo,
        THREE.BufferGeometry
      >,
    [],
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, flatShading: true }),
    [],
  );
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const capacity = useMemo(() => {
    const cap: Record<string, number> = {};
    for (const sp of SPECIES)
      for (const g of GEOS) {
        const n = prepared[sp][g].length;
        if (n)
          cap[`${sp}-${g}`] =
            n *
            (sp === "snapper" || sp === "skywing"
              ? 70
              : sp === "hornface" || sp === "duckbill"
                ? 90
                : 60);
      }
    return cap;
  }, [prepared]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const w = worldRef.current;
    const geo = geography(w);
    const phase = getPhase();
    const list = agents.current;
    const hunters: typeof lifeBus.hunters = [];
    const wet = seasonOf(w.day) === "wet";

    // Scripted runs join the scene as a pack in formation.
    while (lifeBus.runs.length) {
      const r = lifeBus.runs.shift()!;
      const start = r.points[0];
      for (let n = 0; n < r.count; n++) {
        const a = spawn(w, r.sp, w.tiles[0].region);
        const back = Math.floor(n / 3) * 0.9;
        const side = ((n % 3) - 1) * 0.8;
        a.x = start.x - back + side * 0.3;
        a.z = start.z + side;
        a.path = r.points;
        a.pathAt = 1;
        a.runSpeed = r.speed * (0.9 + hash(a.id, 12) * 0.2);
        a.state = "flee";
        list.push(a);
      }
    }

    // --- Herds: who's in which, and what each herd does next --------------------
    const gmap = groups.current;
    for (const g of gmap.values()) {
      g.n = 0;
      g.sumX = 0;
      g.sumZ = 0;
      g.len = 0;
    }
    for (const a of list) {
      a.group = undefined;
      if (a.state === "dead" || a.herd || a.path) continue;
      if (SPECIES_DEFS[a.sp].diet !== "plants") continue;
      const gait = MODELS[a.sp].gait;
      if (gait === "fly" || gait === "swim") continue;
      const key = `${a.sp}|${a.region}|${a.form}`;
      let g = gmap.get(key);
      if (!g) {
        g = newGroup(key, a.region, a.x, a.z, t);
        gmap.set(key, g);
      }
      g.n++;
      g.sumX += a.x;
      g.sumZ += a.z;
      g.len = Math.max(g.len, lengthOf(a));
      g.seen = t;
      a.group = key;
    }
    const hot = env.hour > 11.5 && env.hour < 15;
    for (const [key, g] of gmap) {
      if (t - g.seen > 5) {
        gmap.delete(key);
        continue;
      }
      if (!g.n) continue;
      // A herd that's drifted apart from its centre gathers round its members.
      const mx = g.sumX / g.n;
      const mz = g.sumZ / g.n;
      if (Math.hypot(mx - g.cx, mz - g.cz) > 14) {
        g.cx = mx;
        g.cz = mz;
      }
      stepGroup(g, w.tiles, t, dt, hot);
    }

    for (let k = list.length - 1; k >= 0; k--) {
      const a = list[k];
      const model = MODELS[a.sp];
      const walk = WALK[a.sp];
      if (a.state === "dead") {
        a.deadFor += dt;
        if (a.deadFor > 16) list.splice(k, 1);
        continue;
      }
      a.intent =
        a.state === "hunt"
          ? "Closing on prey"
          : a.state === "flee"
            ? "Escaping danger"
            : a.state === "drink"
              ? "Seeking water"
              : a.state === "graze"
                ? "Feeding with the herd"
                : a.state === "eat"
                  ? "Recovering after a hunt"
                  : a.state === "walk"
                    ? "Moving to fresh ground"
                    : a.state === "nest"
                      ? "Resting with the young"
                      : "Watching the surroundings";
      a.alertness = a.state === "flee" || a.state === "hunt" ? "alarmed" : a.face !== undefined ? "watchful" : "calm";
      if (SPECIES_DEFS[a.sp].diet === "meat")
        hunters.push({ x: a.x, z: a.z, danger: SPECIES_DEFS[a.sp].danger });
      if (a.path) {
        // Following a scripted run at full tilt.
        const wp = a.path[a.pathAt ?? 0];
        if (!wp) {
          list.splice(k, 1);
          continue;
        }
        const dx = wp.x - a.x;
        const dz = wp.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) a.pathAt = (a.pathAt ?? 0) + 1;
        else {
          const step = Math.min(d, Math.min(a.runSpeed ?? 4, a.maxRun ?? Infinity) * dt);
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
          const turn = Math.atan2(dx, dz) - a.yaw;
          a.yaw += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 6);
        }
        a.speed = Math.min(a.runSpeed ?? 4, a.maxRun ?? Infinity);
        a.phase += dt * 14;
        a.y = Math.max(0, heightAt(w.tiles, a.x, a.z));
        continue;
      }

      // --- A tsunami: run from it, or be carried off by it -----------------------
      const sb = surgeBus;
      if (sb.active && sb.plan && model.gait !== "fly" && model.gait !== "swim") {
        const pl = sb.plan;
        const al = (a.x - pl.ox) * pl.cos + (a.z - pl.oz) * pl.sin;
        const arrive = pl.arrival(al);
        const ti = tileAtWorld(a.x, a.z);
        const flooded = ti >= 0 && w.tiles[ti].flood > 0;
        if (flooded && sb.t >= arrive && sb.t < pl.drainAt) {
          // Swept along with the water, tumbling, until it loses its footing for good.
          const push = pl.surge * 0.55 * Math.max(0.15, 1 - (sb.t - arrive) / 5);
          a.x += pl.cos * push * dt;
          a.z += pl.sin * push * dt;
          a.yaw += dt * (hash(a.id, 72) - 0.5) * 3;
          a.state = "flee";
          a.speed = 0;
          a.swept = (a.swept ?? 0) + dt;
          if (a.swept > 1.6 && hash(a.id, 71) < (a.scale > 2 ? 0.35 : 0.7)) {
            a.state = "dead";
            a.deadFor = 0;
          }
          a.y = Math.max(0, heightAt(w.tiles, a.x, a.z)) + 0.15;
          continue;
        }
        if (sb.t > arrive - 3 && sb.t < arrive && al > pl.coast - 3 && al < pl.far + 4) {
          // The water's coming: stampede inland.
          a.state = "flee";
          a.timer = 2;
          a.tx = a.x + pl.cos * 10;
          a.tz = a.z + pl.sin * 10;
          a.herd = 0;
        }
      }

      // --- An eruption: run from the mountain; lava and the ash cloud kill ------
      const eb = eruptBus;
      if (eb.active && eb.plan && model.gait !== "fly" && model.gait !== "swim") {
        const pl = eb.plan;
        const ti = tileAtWorld(a.x, a.z);
        const reached = pl.arrival.get(ti);
        const front = eb.pyroFront(eb.t);
        if (
          (reached !== undefined && eb.t > reached + 0.2) ||
          (front && Math.hypot(front.x - a.x, front.z - a.z) < 3 + a.scale * 0.5)
        ) {
          a.state = "dead";
          a.deadFor = 0;
          a.shade *= 0.28;
          continue;
        }
        const dc = Math.hypot(a.x - pl.cx, a.z - pl.cz) || 1;
        if (eb.t > 0.8 && dc < 38 && a.state !== "flee") {
          a.state = "flee";
          a.timer = 3 + hash(a.id, 83) * 2;
          a.tx = pl.cx + ((a.x - pl.cx) / dc) * (dc + 16);
          a.tz = pl.cz + ((a.z - pl.cz) / dc) * (dc + 16);
          a.herd = 0;
          // A bellow of alarm from the big ones.
          if (!a.actFor && a.scale > 1 && hash(a.id, 84) < 0.4) {
            a.act = "roar";
            a.actFor = 1.4;
          }
        }
      }

      // --- Deciding what to do ------------------------------------------------
      if (a.herd) {
        // On the move with its herd, along the real route.
        const h = w.herds.find((hh) => hh.id === a.herd);
        if (h) {
          const along = Math.min(h.path.length - 1, h.at + phase * 3);
          const i0 = h.path[Math.floor(along)];
          const i1 = h.path[Math.min(h.path.length - 1, Math.floor(along) + 1)];
          const f = along % 1;
          const cx = wx(i0) * (1 - f) + wx(i1) * f;
          const cz = wz(i0) * (1 - f) + wz(i1) * f;
          const dir = Math.atan2(wz(i1) - wz(i0), wx(i1) - wx(i0));
          // A loose column: each animal has its place in the line.
          const back = (a.slot % 6) * 0.6 * (a.scale * 0.5 + 0.5);
          const side = ((Math.floor(a.slot / 6) % 3) - 1) * 0.7;
          a.tx = cx - Math.cos(dir) * back - Math.sin(dir) * side;
          a.tz = cz - Math.sin(dir) * back + Math.cos(dir) * side;
          a.state = "walk";
        }
      } else if (model.gait === "fly") {
        const key = `${a.sp}|${a.region}`;
        let anchor = anchors.current.get(key);
        if (!anchor || anchor.until < t) {
          anchor = {
            i: landTile(w, geo.tiles[a.region], Math.floor(t / 20), a.id % 3, a.sp),
            until: t + 25,
          };
          anchors.current.set(key, anchor);
        }
        const ang = t * (0.25 + (a.id % 5) * 0.05) + a.id;
        const r = 2 + (a.id % 4);
        a.tx = wx(anchor.i) + Math.cos(ang) * r;
        a.tz = wz(anchor.i) + Math.sin(ang) * r;
        a.state = "walk";
      } else if (model.gait === "swim") {
        if (a.timer <= 0 || Math.hypot(a.tx - a.x, a.tz - a.z) < 0.5) {
          const i = landTile(w, geo.tiles[a.region], a.id, Math.floor(t / 7), a.sp);
          a.tx = wx(i);
          a.tz = wz(i);
          a.timer = 12;
        }
        a.state = "walk";
      } else if (t > a.nextThink) {
        a.nextThink = t + 0.4 + hash(a.id, Math.floor(t)) * 0.3;
        const def = SPECIES_DEFS[a.sp];
        if (def.diet === "meat") {
          // Hunt the nearest likely prey now and then.
          if (a.state !== "hunt" && a.state !== "eat" && hash(a.id, Math.floor(t / 6)) < 0.18) {
            let best: Agent | null = null;
            let bestD = 9;
            for (const o of list) {
              if (o.state === "dead" || o.herd || !def.prey?.[o.sp]) continue;
              const d = Math.hypot(o.x - a.x, o.z - a.z);
              if (d < bestD) [best, bestD] = [o, d];
            }
            if (best) {
              a.prey = best;
              a.state = "hunt";
              a.timer = 8;
              // Raptors hunt as a pack: the others nearby join in on the same quarry.
              if (a.sp === "raptor")
                for (const o of list)
                  if (
                    o !== a &&
                    o.sp === "raptor" &&
                    o.state !== "dead" &&
                    o.state !== "hunt" &&
                    !o.herd &&
                    Math.hypot(o.x - a.x, o.z - a.z) < 8
                  ) {
                    o.prey = best;
                    o.state = "hunt";
                    o.timer = 8;
                  }
            }
          }
        } else {
          // Grazers watch for hunters. The armoured grown-ups turn and face
          // them (a clubtail swings its tail, a hornface lowers its horns and
          // bellows); for everyone else the whole herd bolts together.
          const g = a.group ? gmap.get(a.group) : undefined;
          let stood = false;
          for (const o of lifeBus.hunters) {
            const d = Math.hypot(o.x - a.x, o.z - a.z);
            if (d < 3.5 + lengthOf(a)) {
              const stand =
                !a.young && (a.sp === "plateback" || (a.sp === "hornface" && hash(a.id, 21) < 0.5));
              if (stand) {
                stood = true;
                a.state = "idle";
                a.timer = 2;
                a.tx = a.x;
                a.tz = a.z;
                a.face =
                  Math.atan2(o.x - a.x, o.z - a.z) + (a.sp === "plateback" ? Math.PI * 0.8 : 0);
                if (!a.actFor) {
                  a.act = a.sp === "plateback" ? "tail" : "roar";
                  a.actFor = 2.2;
                }
              } else if (g) panic(g, o.x, o.z, t);
              else {
                a.state = "flee";
                a.timer = 3;
                const away = Math.atan2(a.z - o.z, a.x - o.x);
                a.tx = a.x + Math.cos(away) * 6;
                a.tz = a.z + Math.sin(away) * 6;
              }
              break;
            }
          }
          if (g && !stood) {
            const slot = slotOf(g, a.id, a.young, t);
            const gap = Math.hypot(slot.x - a.x, slot.z - a.z);
            const len = lengthOf(a);
            a.tx = slot.x;
            a.tz = slot.z;
            a.timer = 1;
            switch (g.mode) {
              case "flee":
                a.state = "flee";
                break;
              case "move":
              case "drink":
                a.state = gap > len * 0.3 ? "walk" : "graze";
                break;
              default:
                if (gap > len * 0.6) a.state = "walk";
                else {
                  a.tx = a.x;
                  a.tz = a.z;
                  // Heads down to feed, but someone's always looking up.
                  const look = hash(a.id, Math.floor(t / (3 + hash(a.id, 84) * 3)), 85);
                  a.state =
                    g.mode === "rest"
                      ? a.young || hash(a.id, 86) < 0.5
                        ? "nest"
                        : "idle"
                      : g.mode === "alert"
                        ? "idle"
                        : g.mode === "water"
                          ? "drink"
                          : look < 0.28
                            ? "idle"
                            : "graze";
                  a.face =
                    g.mode === "alert" && g.threat
                      ? Math.atan2(g.threat.x - a.x, g.threat.z - a.z)
                      : g.mode === "water"
                        ? Math.atan2(g.tx - a.x, g.tz - a.z)
                        : g.heading + (hash(a.id, 87) - 0.5) * 1.6;
                }
            }
          }
          // Youngsters keep close to an adult of their kind (unless the herd is on the move).
          const herdMode = a.group ? gmap.get(a.group)?.mode : undefined;
          if (
            a.young &&
            a.state !== "flee" &&
            herdMode !== "flee" &&
            herdMode !== "move" &&
            herdMode !== "drink"
          ) {
            if (!a.mum || a.mum.state === "dead" || a.mum.region !== a.region) {
              a.mum = null;
              let bestD = 6;
              for (const o of list)
                if (
                  o.sp === a.sp &&
                  o.form === a.form &&
                  !o.young &&
                  o.state !== "dead" &&
                  !o.herd &&
                  o.region === a.region
                ) {
                  const d = Math.hypot(o.x - a.x, o.z - a.z);
                  if (d < bestD) [a.mum, bestD] = [o, d];
                }
            }
            const m = a.mum;
            if (m) {
              const len = lengthOf(m);
              const side = hash(a.id, 22) < 0.5 ? -1 : 1;
              const fx = m.x - Math.sin(m.yaw) * len * 0.3 + Math.cos(m.yaw) * side * len * 0.35;
              const fz = m.z - Math.cos(m.yaw) * len * 0.3 - Math.sin(m.yaw) * side * len * 0.35;
              if (Math.hypot(fx - a.x, fz - a.z) > len * 0.25) {
                a.tx = fx;
                a.tz = fz;
                a.state = "walk";
              } else if (a.state === "walk") {
                a.state = m.state === "graze" ? "graze" : "idle";
                a.timer = 1;
              }
            }
          }
        }
      }

      if (a.state === "hunt" && a.prey) {
        const pr = a.prey;
        if (pr.state === "dead" || a.timer <= 0) {
          a.state = "idle";
          a.prey = null;
        } else {
          a.tx = pr.x;
          a.tz = pr.z;
          const dp = Math.hypot(pr.x - a.x, pr.z - a.z);
          if (a.sp === "raptor" && dp > 1.5) {
            // Fanning out to come at it from the sides.
            const flank = (hash(a.id, 88) - 0.5) * 2;
            const ax = (pr.x - a.x) / dp;
            const az = (pr.z - a.z) / dp;
            a.tx += -az * flank * dp * 0.45;
            a.tz += ax * flank * dp * 0.45;
          }
          if (dp < 0.25 + a.scale * 0.25) {
            // Caught.
            pr.state = "dead";
            pr.deadFor = 0;
            a.state = "eat";
            a.timer = 7;
            a.prey = null;
            a.act = "attack";
            a.actFor = 1;
          }
        }
      }

      if (
        !a.herd &&
        !a.group &&
        model.gait !== "fly" &&
        model.gait !== "swim" &&
        (a.state === "idle" ||
          a.state === "graze" ||
          a.state === "nest" ||
          a.state === "drink" ||
          a.state === "eat")
      ) {
        a.timer -= dt;
        if (a.timer <= 0) {
          // Pick something new to do near the herd's grazing spot.
          const key = `${a.sp}|${a.region}`;
          let anchor = anchors.current.get(key);
          if (!anchor || anchor.until < t) {
            anchor = {
              i: landTile(w, geo.tiles[a.region], Math.floor(t / 30), a.region.length, a.sp),
              until: t + 30 + hash(a.id, 9) * 20,
            };
            anchors.current.set(key, anchor);
          }
          const roll = hash(a.id, Math.floor(t * 3));
          const nests =
            wet && a.region === "emerald_grasslands" && SPECIES_DEFS[a.sp].diet === "plants";
          if (a.state === "eat" || roll < 0.35) {
            a.state =
              nests && roll < 0.2
                ? "nest"
                : SPECIES_DEFS[a.sp].diet === "plants"
                  ? "graze"
                  : "idle";
            a.timer = 3 + hash(a.id, Math.floor(t), 1) * 5;
          } else {
            const spread = SPECIES_DEFS[a.sp].diet === "meat" ? 5 : 2.2;
            a.tx = wx(anchor.i) + (hash(a.id, Math.floor(t), 2) - 0.5) * spread * 2;
            a.tz = wz(anchor.i) + (hash(a.id, Math.floor(t), 3) - 0.5) * spread * 2;
            a.state = "walk";
          }
        }
      } else if (a.state === "flee") {
        a.timer -= dt;
        if (a.timer <= 0) a.state = "idle";
      } else if (a.state === "hunt") a.timer -= dt;

      // --- Moving --------------------------------------------------------------
      // Animals walk where they face and steer round towards where they're
      // going, as real ones do: a big animal swings round in a wide arc, and
      // one that needs to turn right round slows almost to a stop to do it.
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const dist = Math.hypot(dx, dz);
      const running = a.state === "flee" || a.state === "hunt";
      const len = lengthOf(a);
      const acting = a.actFor > 0 && a.act !== "attack";
      let want =
        (a.state === "walk" || running) && !acting
          ? walk * (running ? RUN : a.herd ? 1.2 : 1) * (0.6 + a.scale * 0.15)
          : 0;
      // No faster than its legs can go.
      if (model.gait !== "fly" && model.gait !== "swim") {
        const cap = running ? a.maxRun : a.maxWalk;
        if (cap) want = Math.min(want, cap);
      }
      let err = 0;
      if (dist > 0.05) {
        err = Math.atan2(dx, dz) - a.yaw;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        // Turn first, then go; ease off to arrive rather than stop dead.
        want *= Math.max(0.12, Math.cos(Math.min(Math.abs(err), 1.45)));
        want = Math.min(want, dist * (running ? 3 : 1.4));
      } else want = 0;
      // Heavy bodies take a while to get going and to pull up.
      const fatigueLimit = 1 - a.fatigue * 0.28;
      want *= fatigueLimit;
      const accel = ((want > a.speed ? 1.6 : 2.6) * walk * (running ? 2 : 1)) / (0.6 + len * 0.12);
      a.speed += Math.max(-accel * dt, Math.min(accel * dt, want - a.speed));
      if (want === 0 && a.speed < walk * 0.08) a.speed = 0;
      if (model.gait === "fly" || model.gait === "swim") {
        // Flyers and swimmers glide on: bank round smoothly.
        a.yaw += err * Math.min(1, dt * 1.6);
      } else {
        // Turning rate: brisk for small animals, ponderous for giants.
        const rate = turnRateFor(gaitFamily(a.sp, model.gait), len, running);
        a.yaw += Math.max(-rate * dt, Math.min(rate * dt, err * Math.min(1, dt * 6)));
      }
      let yawDelta = a.yaw - a.prevYaw;
      yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
      const smoothing = 1 - Math.exp(-8 * dt);
      a.yawRate += (yawDelta / Math.max(dt, 0.001) - a.yawRate) * smoothing;
      a.acceleration += ((a.speed - a.prevSpeed) / Math.max(dt, 0.001) - a.acceleration) * smoothing;
      a.fatigue = updateFatigue(a.fatigue, running ? a.speed / Math.max(walk * RUN, 0.01) : 0, dt);
      a.prevYaw = a.yaw;
      a.prevSpeed = a.speed;
      if (a.speed > 0.005) {
        const nx = a.x + Math.sin(a.yaw) * a.speed * dt;
        const nz = a.z + Math.cos(a.yaw) * a.speed * dt;
        const ti = tileAtWorld(nx, nz);
        const tile = ti >= 0 ? w.tiles[ti] : null;
        const blocked =
          !tile ||
          (model.gait === "swim"
            ? tile.water !== SEA
            : model.gait !== "fly" && (tile.water === SEA || tile.lava > 0 || tile.fire > 0));
        if (blocked) {
          a.tx = a.x;
          a.tz = a.z;
          a.speed *= 0.3;
          a.state = a.herd ? "walk" : "idle";
          a.timer = 0.5;
        } else {
          a.x = nx;
          a.z = nz;
          // A running animal kicks up dust off dry ground.
          if (model.gait !== "fly" && model.gait !== "swim" && a.speed > walk * 1.3) {
            const footPhase = Math.sin(a.phase);
            const footDown = footPhase < -0.72;
            a.dust = (a.dust ?? 0) - dt;
            const dry =
              !tile.water && !tile.flood && tile.biome !== "wetland" && tile.biome !== "mangrove";
            if (a.dust <= 0 && dry && footDown) {
              a.dust = 0.16 + hash(a.id, Math.floor(t * 10)) * 0.1;
              const back = len * 0.25;
              dustBus.emit(
                a.x - Math.sin(a.yaw) * back + (hash(a.id, Math.floor(t * 20)) - 0.5) * len * 0.3,
                Math.max(0, heightAt(w.tiles, a.x, a.z)),
                a.z - Math.cos(a.yaw) * back,
                Math.min(1.6, 0.25 + len * 0.3),
              );
            }
          }
        }
      } else if (a.state === "walk" && !a.herd && model.gait !== "fly" && model.gait !== "swim") {
        a.state = SPECIES_DEFS[a.sp].diet === "plants" ? "graze" : "idle";
        a.timer = 2 + hash(a.id, Math.floor(t)) * 4;
      }
      // Standing, it turns slowly to face where it means to (the herd's way, a threat, the water).
      if (a.face !== undefined && a.speed < 0.02 && model.gait !== "fly" && model.gait !== "swim") {
        let turn = a.face - a.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        a.yaw += turn * Math.min(1, dt * (1.2 / (0.6 + lengthOf(a) * 0.3)));
        if (Math.abs(turn) < 0.03) a.face = undefined;
      }
      a.phase += dt * (2 + (a.speed * (model.gait === "fly" ? 3 : 6)) / Math.max(0.4, a.scale));
      const ground = heightAt(w.tiles, a.x, a.z);
      if (model.gait === "fly") {
        a.y = Math.max(ground, 0) + 3 + Math.sin(t * 0.8 + a.id) * 0.8 + (a.id % 3);
        // Bank into turns.
        a.roll += (-err * 0.6 - a.roll) * Math.min(1, dt * 2);
      } else if (model.gait === "swim")
        a.y = -0.35 + Math.max(0, Math.sin(t * 0.25 + a.id)) * 0.4 - 0.1;
      else {
        // Lie along the slope: feel the ground under the chest and the hips.
        const fx = Math.sin(a.yaw) * len * 0.35;
        const fz = Math.cos(a.yaw) * len * 0.35;
        const hf = Math.max(0, heightAt(w.tiles, a.x + fx, a.z + fz));
        const hb = Math.max(0, heightAt(w.tiles, a.x - fx, a.z - fz));
        const hl = Math.max(0, heightAt(w.tiles, a.x + fz * 0.4, a.z - fx * 0.4));
        const hr = Math.max(0, heightAt(w.tiles, a.x - fz * 0.4, a.z + fx * 0.4));
        const pitch = Math.atan2(hb - hf, len * 0.7) * 0.85;
        const roll = Math.atan2(hl - hr, len * 0.28) * 0.35;
        const k = Math.min(1, dt * 5);
        a.pitch += (Math.max(-0.5, Math.min(0.5, pitch)) - a.pitch) * k;
        a.roll += (Math.max(-0.2, Math.min(0.2, roll)) - a.roll) * k;
        a.y = Math.max(Math.max(0, ground), (hf + hb) / 2) - (a.state === "nest" ? 0.05 : 0);
      }
    }
    // Animals keep a body's width apart instead of walking through each other.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (
        a.state === "dead" ||
        a.path
      )
        continue;
      const la = lengthOf(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.state === "dead" || b.path)
          continue;
        const aAerial = MODELS[a.sp].gait === "fly" || MODELS[a.sp].gait === "swim";
        const bAerial = MODELS[b.sp].gait === "fly" || MODELS[b.sp].gait === "swim";
        const aerialPair = MODELS[a.sp].gait === MODELS[b.sp].gait && aAerial;
        if (aAerial !== bAerial) continue;
        if ((MODELS[a.sp].gait === "fly" || MODELS[a.sp].gait === "swim") && !aerialPair) continue;
        if (aerialPair && (a.sp !== b.sp || a.region !== b.region)) continue;
        if (a.prey === b || b.prey === a) continue;
        const ddx = b.x - a.x;
        const ddz = b.z - a.z;
        const lb = lengthOf(b);
        const min = (la + lb) * 0.28;
        if (Math.abs(ddx) > min || Math.abs(ddz) > min) continue;
        const d = Math.hypot(ddx, ddz);
        if (d < 1e-4) continue;
        const sameHerd = !!a.group && a.group === b.group;
        if (sameHerd && d < min * 2.2) {
          // A gentle anticipatory steer opens a lane before bodies touch. It
          // keeps the stable herd layout while removing formation-like clumps.
          const soft = (1 - d / (min * 2.2)) * Math.min(0.12, dt * 0.8);
          a.tx -= (ddx / d) * soft * min;
          a.tz -= (ddz / d) * soft * min;
          b.tx += (ddx / d) * soft * min;
          b.tz += (ddz / d) * soft * min;
        }
        if (d >= min) continue;
        // The lighter animal gives way more.
        const push = ((min - d) / d) * Math.min(1, dt * 6);
        const wa = lb / (la + lb);
        a.x -= ddx * push * wa;
        a.z -= ddz * push * wa;
        b.x += ddx * push * (1 - wa);
        b.z += ddz * push * (1 - wa);
        if (aerialPair && d < min * 2.4) {
          // Flocks and pods anticipate one another instead of orbiting through
          // their neighbours; headings softly align after separating.
          let align = b.yaw - a.yaw;
          align = Math.atan2(Math.sin(align), Math.cos(align));
          a.yaw += align * Math.min(0.08, dt);
          b.yaw -= align * Math.min(0.08, dt);
        }
      }
    }
    lifeBus.hunters = hunters;
    lifeBus.agents = list;

    // --- Drawing ---------------------------------------------------------------
    const counts: Record<string, number> = {};
    const skinned = skinsRef.current;
    const skinCount: Record<string, number> = {};
    for (const a of list) {
      const model = MODELS[a.sp];
      const dead = a.state === "dead";
      if (dead && a.deadFor > 16) continue;
      // Its own look if that model is in, else the species' first.
      let key = FORMS[a.sp][a.form].key;
      if (!skinned[key]) key = FORMS[a.sp][0].key;
      const skin = skinned[key];
      const mesh = skin && skinMeshes.current[key];
      if (skin && mesh) {
        const n = skinCount[key] ?? 0;
        if (n >= SKIN_CAP) continue;
        skinCount[key] = n + 1;
        animate(a, skin, model.gait, t, dt);
        const len = lengthOf(a);
        // The dead keel over onto their side (not in one frame), then sink away.
        const fallTime = Math.max(0.55, Math.min(1.8, 0.55 + len * 0.22));
        const fall = dead ? Math.min(1, Math.max(0, a.deadFor) / fallTime) ** 2 : 0;
        const side = hash(a.id, 31) < 0.5 ? -1 : 1;
        e.set(
          a.pitch * (1 - fall),
          a.yaw,
          a.roll * (1 - fall) + side * fall * Math.PI * 0.5,
          "YXZ",
        );
        q.setFromEuler(e);
        const sink = dead ? Math.max(0, a.deadFor - 10) * 0.05 * len : 0;
        p.set(a.x, a.y + fall * skin.meta.width * 0.5 * len - sink, a.z);
        s.set(len * a.build[0], len * a.build[1], len);
        out.compose(p, q, s);
        mesh.setMatrixAt(n, out);
        c.setScalar(a.shade);
        mesh.setColorAt(n, c);
        const at = skinAttrs[key];
        at.l.setXYZW(n, ...a.look);
        at.l2.setXYZW(n, ...a.look2);
        const clipA = skin.meta.clips[a.clip]!;
        clipRows(clipA, a.clipT, v3);
        at.a.setXYZ(n, v3.x, v3.y, v3.z);
        const clipB = skin.meta.clips[a.prevClip] ?? clipA;
        clipRows(clipB, a.prevT, v3);
        at.b.setXYZ(n, v3.x, v3.y, v3.z);
        at.f.setX(n, a.fade);
        continue;
      }
      e.set(0, a.yaw, dead ? Math.PI / 2 : 0);
      q.setFromEuler(e);
      const sink = dead ? Math.max(0, a.deadFor - 10) * 0.05 : 0;
      p.set(a.x, a.y + (dead ? 0.1 * a.scale : 0) - sink, a.z);
      // Bob with each step.
      if (!dead && a.speed > 0.05 && model.gait !== "fly" && model.gait !== "swim")
        p.y += Math.abs(Math.sin(a.phase)) * 0.02 * a.scale;
      s.setScalar(a.scale);
      base.compose(p, q, s);
      for (const g of GEOS) {
        const parts = PREPARED[a.sp][g];
        if (!parts.length) continue;
        const key = `${a.sp}-${g}`;
        const mesh = meshes.current[key];
        if (!mesh) continue;
        for (const pp of parts) {
          const n = counts[key] ?? 0;
          if (n >= capacity[key]) break;
          counts[key] = n + 1;
          if (pp.part.anim && !dead) {
            anim
              .copy(pp.toPivot)
              .multiply(jointRotation(pp.part.anim, a, t, model.gait))
              .multiply(pp.fromPivot);
            out.copy(base).multiply(anim).multiply(pp.local);
          } else out.copy(base).multiply(pp.local);
          mesh.setMatrixAt(n, out);
          c.copy(pp.color[pp.part.role]).multiplyScalar(a.shade);
          mesh.setColorAt(n, c);
        }
      }
    }
    for (const [key, mesh] of Object.entries(meshes.current)) {
      if (!mesh) continue;
      mesh.count = counts[key] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const [key, mesh] of Object.entries(skinMeshes.current)) {
      if (!mesh) continue;
      const n = skinCount[key] ?? 0;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const at = skinAttrs[key];
      for (const layer of coatMeshes.current[key] ?? []) {
        if (!layer) continue;
        layer.instanceMatrix = mesh.instanceMatrix;
        if (mesh.instanceColor) layer.instanceColor = mesh.instanceColor;
        layer.count = n;
      }
      for (const attr of [at.a, at.b, at.f, at.l, at.l2]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  });

  return (
    <group>
      {Object.entries(skins).map(([key, skin]) => {
        const g = skinGeo(key, skin);
        return (
          <instancedMesh
            key={`skin-${key}`}
            ref={(r) => {
              skinMeshes.current[key] = r;
              if (r) {
                r.setColorAt(0, c.set("#ffffff"));
                r.count = 0;
                r.customDepthMaterial = skin.depth;
              }
            }}
            args={[g, skin.materials, SKIN_CAP]}
            castShadow
            receiveShadow
            frustumCulled={false}
          />
        );
      })}
      {Object.entries(coatMats).flatMap(([key, layers]) =>
        (layers as (THREE.Material | THREE.Material[])[]).map((mat, k) => (
          <instancedMesh
            key={`coat-${key}-${k}`}
            ref={(r) => {
              (coatMeshes.current[key] ??= [])[k] = r;
              if (r) r.count = 0;
            }}
            args={[skinGeo(key, skins[key]), mat, SKIN_CAP]}
            receiveShadow
            frustumCulled={false}
          />
        )),
      )}
      {SPECIES.filter((sp) => !skins[FORMS[sp][0].key]).flatMap((sp) =>
        GEOS.filter((g) => PREPARED[sp][g].length).map((g) => {
          const key = `${sp}-${g}`;
          return (
            <instancedMesh
              key={key}
              ref={(r) => {
                meshes.current[key] = r;
                if (r) {
                  // Make sure a colour buffer exists before the first frame.
                  r.setColorAt(0, c.set("#ffffff"));
                  r.count = 0;
                }
              }}
              args={[geos[g], material, capacity[key]]}
              castShadow
              frustumCulled={false}
            />
          );
        }),
      )}
    </group>
  );
}

export { HIDDEN };
