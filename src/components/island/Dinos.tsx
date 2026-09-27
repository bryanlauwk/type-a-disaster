import { useEffect, useMemo, useRef } from "react";
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
}

/** Shared with the rest of the scene: where the dangerous animals are right now. */
export const lifeBus = {
  hunters: [] as { x: number; z: number; danger: number }[],
  agents: [] as Agent[],
  /** Scripted runs for acts: a stampeding herd, a raiding pack. */
  runs: [] as { sp: SpeciesId; points: { x: number; z: number }[]; speed: number; count: number }[],
};

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

/** The animation pose for a part's joint. */
function jointRotation(a: Anim, ag: Agent, t: number, gait: string): THREE.Matrix4 {
  const moving =
    ag.state === "walk" || ag.state === "run" || ag.state === "flee" || ag.state === "hunt";
  const stride = moving ? (ag.state === "walk" ? 0.45 : 0.8) : 0;
  const ph = ag.phase;
  switch (a) {
    case "legFL":
    case "legBR":
      if (gait === "swim") return rot.makeRotationZ(Math.sin(t * 2 + ag.id) * 0.4);
      return rot.makeRotationX(Math.sin(ph) * stride);
    case "legFR":
    case "legBL":
      if (gait === "swim") return rot.makeRotationZ(-Math.sin(t * 2 + ag.id) * 0.4);
      return rot.makeRotationX(-Math.sin(ph) * stride);
    case "neck":
      return rot.makeRotationFromEuler(
        e.set(
          ag.state === "graze" || ag.state === "drink" ? 0.35 : Math.sin(t * 0.7 + ag.id) * 0.08,
          Math.sin(t * 0.5 + ag.id) * 0.25,
          0,
        ),
      );
    case "head":
      if (ag.state === "graze" || ag.state === "drink" || ag.state === "eat")
        return rot.makeRotationX(0.6 + Math.sin(t * 3 + ag.id) * 0.12);
      return rot.makeRotationFromEuler(
        e.set(Math.sin(t * 1.3 + ag.id) * 0.06, Math.sin(t * 0.8 + ag.id) * 0.2, 0),
      );
    case "tail":
      return rot.makeRotationY(Math.sin(t * (moving ? 3 : 1.2) + ag.id) * (moving ? 0.2 : 0.12));
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
    scale:
      tuned(SPECIES_DEFS[sp], world.traits[sp]).size * (young ? 0.55 : 0.85 + hash(id, 6) * 0.3),
    phase: 0,
    shade: 0.88 + hash(id, 8) * 0.24,
    deadFor: 0,
    prey: null,
    nextThink: 0,
  };
}

export function Dinos({ world, getPhase }: { world: WorldState; getPhase: () => number }) {
  const agents = useRef<Agent[]>([]);
  const worldRef = useRef(world);
  worldRef.current = world;
  // An anchor per species and region that each little herd grazes around.
  const anchors = useRef(new Map<string, { i: number; until: number }>());

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

    for (let k = list.length - 1; k >= 0; k--) {
      const a = list[k];
      const model = MODELS[a.sp];
      const walk = WALK[a.sp];
      if (a.state === "dead") {
        a.deadFor += dt;
        if (a.deadFor > 16) list.splice(k, 1);
        continue;
      }
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
          const step = Math.min(d, (a.runSpeed ?? 4) * dt);
          a.x += (dx / d) * step;
          a.z += (dz / d) * step;
          a.yaw = Math.atan2(dx, dz);
        }
        a.speed = a.runSpeed ?? 4;
        a.phase += dt * 14;
        a.y = Math.max(0, heightAt(w.tiles, a.x, a.z));
        continue;
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
            }
          }
        } else {
          // Grazers watch for hunters.
          for (const o of lifeBus.hunters) {
            const d = Math.hypot(o.x - a.x, o.z - a.z);
            if (d < 3 + a.scale) {
              a.state = "flee";
              a.timer = 3;
              const away = Math.atan2(a.z - o.z, a.x - o.x);
              a.tx = a.x + Math.cos(away) * 6;
              a.tz = a.z + Math.sin(away) * 6;
              break;
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
          if (Math.hypot(pr.x - a.x, pr.z - a.z) < 0.25 + a.scale * 0.25) {
            // Caught.
            pr.state = "dead";
            pr.deadFor = 0;
            a.state = "eat";
            a.timer = 7;
            a.prey = null;
          }
        }
      }

      if (
        !a.herd &&
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
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const dist = Math.hypot(dx, dz);
      const running = a.state === "flee" || a.state === "hunt";
      const want =
        a.state === "walk" || running
          ? walk * (running ? RUN : a.herd ? 1.2 : 1) * (0.6 + a.scale * 0.15)
          : 0;
      a.speed += (Math.min(want, dist * 2) - a.speed) * Math.min(1, dt * 3);
      if (dist > 0.05 && a.speed > 0.01) {
        const nx = a.x + (dx / dist) * a.speed * dt;
        const nz = a.z + (dz / dist) * a.speed * dt;
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
          a.state = a.herd ? "walk" : "idle";
          a.timer = 0.5;
        } else {
          a.x = nx;
          a.z = nz;
          const aim = Math.atan2(dx, dz);
          let d = aim - a.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          a.yaw += d * Math.min(1, dt * 4);
        }
      } else if (a.state === "walk" && !a.herd && model.gait !== "fly" && model.gait !== "swim") {
        a.state = SPECIES_DEFS[a.sp].diet === "plants" ? "graze" : "idle";
        a.timer = 2 + hash(a.id, Math.floor(t)) * 4;
      }
      a.phase += dt * (2 + (a.speed * (model.gait === "fly" ? 3 : 6)) / Math.max(0.4, a.scale));
      const ground = heightAt(w.tiles, a.x, a.z);
      if (model.gait === "fly")
        a.y = Math.max(ground, 0) + 3 + Math.sin(t * 0.8 + a.id) * 0.8 + (a.id % 3);
      else if (model.gait === "swim")
        a.y = -0.35 + Math.max(0, Math.sin(t * 0.25 + a.id)) * 0.4 - 0.1;
      else a.y = Math.max(ground, a.state === "nest" ? ground - 0.05 : ground);
    }
    lifeBus.hunters = hunters;
    lifeBus.agents = list;

    // --- Drawing ---------------------------------------------------------------
    const counts: Record<string, number> = {};
    for (const a of list) {
      const model = MODELS[a.sp];
      const dead = a.state === "dead";
      if (dead && a.deadFor > 16) continue;
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
  });

  return (
    <group>
      {SPECIES.flatMap((sp) =>
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
