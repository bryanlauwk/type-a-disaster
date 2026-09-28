import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { seasonOf } from "@/lib/island/sim";
import { around } from "@/lib/island/terrain";
import {
  SEA,
  SIZE,
  tx,
  ty,
  wx,
  wz,
  type StructureKind,
  type Tile,
  type WorldState,
} from "@/lib/island/types";
import { heightAt } from "./palette";
import { lifeBus } from "./Dinos";
import { env } from "./fx/env";
import { Puffs } from "./fx/vfx";
import { clipRows, loadSkin, type ClipName, type Skin } from "./dinoSkins";
import { seaHeightAt } from "./Waters";

/** Buildings are drawn this much bigger than their sketch, so people fit them. */
const BUILD_SCALE = 2.6;

type Geo = "box" | "cyl" | "cone" | "sphere" | "torus";
interface KitPart {
  geo: Geo;
  p: [number, number, number];
  s: [number, number, number];
  r?: [number, number, number];
  color: string;
}

const WOOD = "#7a5a3a";
const DARK_WOOD = "#5a4029";
const THATCH = "#b99a58";
const STONE = "#8f8a80";
const HIDE = "#c9ad7e";

/** Handmade structures, in tile units (a tile is one unit across). */
function kit(kind: StructureKind, i: number, tiles: Tile[], dry: boolean): KitPart[] {
  const v = hash(i, 5);
  switch (kind) {
    case "hut":
      return [
        { geo: "cyl", p: [0, 0.07, 0], s: [0.26, 0.14, 0.26], color: v < 0.5 ? WOOD : HIDE },
        { geo: "cone", p: [0, 0.21, 0], s: [0.36, 0.18, 0.36], color: THATCH },
        { geo: "box", p: [0, 0.05, 0.13], s: [0.06, 0.09, 0.01], color: "#2a1f16" },
      ];
    case "fire_pit":
      return [
        {
          geo: "torus",
          p: [0, 0.015, 0],
          s: [0.14, 0.14, 0.05],
          r: [Math.PI / 2, 0, 0],
          color: STONE,
        },
        ...[0, 1, 2, 3].map((k): KitPart => {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          return {
            geo: "box",
            p: [Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22],
            s: [0.12, 0.04, 0.04],
            r: [0, -a, 0],
            color: DARK_WOOD,
          };
        }),
      ];
    case "dock": {
      // A pier of lashed planks on driven posts, running from the beach out
      // over the water, with a rack of fish drying on the shore.
      const deck = DOCK_DECK - tiles[i].h;
      const parts: KitPart[] = [];
      for (let k = 0; k < 11; k++) {
        const z = 0.15 + (k * (DOCK_LEN - 0.15)) / 10;
        parts.push({
          geo: "box",
          p: [(hash(i, k, 21) - 0.5) * 0.02, deck + (hash(i, k, 22) - 0.5) * 0.01, z],
          s: [0.44 + (hash(i, k, 23) - 0.5) * 0.05, 0.026, 0.17],
          r: [0, (hash(i, k, 24) - 0.5) * 0.08, 0],
          color: k % 3 ? WOOD : DARK_WOOD,
        });
      }
      for (const sx of [-1, 1])
        parts.push({
          geo: "box",
          p: [sx * 0.16, deck - 0.03, DOCK_LEN / 2 + 0.1],
          s: [0.035, 0.035, DOCK_LEN - 0.1],
          color: DARK_WOOD,
        });
      for (let k = 1; k <= 4; k++)
        for (const sx of [-1, 1])
          parts.push({
            geo: "cyl",
            p: [sx * 0.22, deck - 0.45, (k / 4) * DOCK_LEN],
            s: [0.035, 1.0, 0.035],
            r: [(hash(i, k * 3 + sx, 25) - 0.5) * 0.08, 0, (hash(i, k * 3 + sx, 26) - 0.5) * 0.08],
            color: DARK_WOOD,
          });
      // Drying rack on the beach.
      for (const sx of [-1, 1])
        parts.push({
          geo: "cyl",
          p: [0.45 + sx * 0.14, 0.1, -0.15],
          s: [0.02, 0.2, 0.02],
          color: DARK_WOOD,
        });
      parts.push({
        geo: "cyl",
        p: [0.45, 0.19, -0.15],
        s: [0.015, 0.3, 0.015],
        r: [0, 0, Math.PI / 2],
        color: WOOD,
      });
      for (let k = 0; k < 4; k++)
        parts.push({
          geo: "box",
          p: [0.34 + k * 0.07, 0.14, -0.15],
          s: [0.02, 0.09, 0.035],
          color: k % 2 ? "#8a8f86" : "#a39a84",
        });
      return parts;
    }
    case "lookout":
      return [
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map(
            (sz): KitPart => ({
              geo: "cyl",
              p: [sx * 0.08, 0.22, sz * 0.08],
              s: [0.025, 0.44, 0.025],
              color: DARK_WOOD,
            }),
          ),
        ),
        { geo: "box", p: [0, 0.45, 0], s: [0.22, 0.025, 0.22], color: WOOD },
        { geo: "cone", p: [0, 0.56, 0], s: [0.28, 0.12, 0.28], color: THATCH },
      ];
    case "fence":
      // A palisade of sharpened stakes.
      return Array.from(
        { length: 7 },
        (_, k): KitPart => ({
          geo: "cone",
          p: [-0.45 + k * 0.15, 0.13, 0],
          s: [0.06, 0.26 + hash(i, k, 7) * 0.05, 0.06],
          color: k % 2 ? WOOD : DARK_WOOD,
        }),
      );
    case "farm": {
      const crop = dry ? "#c8a94a" : "#6d9b36";
      return [
        { geo: "box", p: [0, 0.01, 0], s: [0.86, 0.02, 0.86], color: "#8a6a40" },
        ...[-0.3, -0.1, 0.1, 0.3].map(
          (z): KitPart => ({ geo: "box", p: [0, 0.035, z], s: [0.78, 0.04, 0.08], color: crop }),
        ),
      ];
    }
    case "workshop":
      return [
        { geo: "box", p: [0, 0.08, 0], s: [0.36, 0.16, 0.26], color: WOOD },
        { geo: "box", p: [0, 0.2, 0], s: [0.42, 0.03, 0.32], r: [0.15, 0, 0], color: THATCH },
        {
          geo: "cyl",
          p: [0.28, 0.04, 0.12],
          s: [0.05, 0.22, 0.05],
          r: [0, 0, Math.PI / 2],
          color: DARK_WOOD,
        },
        {
          geo: "cyl",
          p: [0.28, 0.08, 0.12],
          s: [0.05, 0.22, 0.05],
          r: [0, 0, Math.PI / 2],
          color: DARK_WOOD,
        },
      ];
    case "granary":
      return [
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map(
            (sz): KitPart => ({
              geo: "cyl",
              p: [sx * 0.08, 0.07, sz * 0.08],
              s: [0.03, 0.14, 0.03],
              color: DARK_WOOD,
            }),
          ),
        ),
        { geo: "cyl", p: [0, 0.2, 0], s: [0.24, 0.13, 0.24], color: HIDE },
        { geo: "cone", p: [0, 0.33, 0], s: [0.32, 0.14, 0.32], color: THATCH },
      ];
    case "market":
      return [-0.25, 0, 0.25].flatMap((x, k): KitPart[] => [
        { geo: "box", p: [x, 0.05, 0], s: [0.16, 0.08, 0.12], color: WOOD },
        {
          geo: "box",
          p: [x, 0.17, 0],
          s: [0.2, 0.02, 0.18],
          r: [0.2, 0, 0],
          color: ["#b5452d", "#d9a13a", "#3f6f8a"][k],
        },
        { geo: "cyl", p: [x - 0.08, 0.09, 0.07], s: [0.015, 0.18, 0.015], color: DARK_WOOD },
      ]);
    case "walkway":
      return [
        { geo: "box", p: [0, 0.12, 0], s: [0.9, 0.025, 0.14], color: WOOD },
        ...[-0.35, 0, 0.35].map(
          (x): KitPart => ({
            geo: "cyl",
            p: [x, 0.04, 0],
            s: [0.025, 0.18, 0.025],
            color: DARK_WOOD,
          }),
        ),
      ];
    case "stone_hall":
      return [
        { geo: "box", p: [0, 0.14, 0], s: [0.55, 0.28, 0.38], color: STONE },
        {
          geo: "cone",
          p: [0, 0.38, 0],
          s: [0.62, 0.2, 0.5],
          r: [0, Math.PI / 4, 0],
          color: "#6f6a62",
        },
        { geo: "box", p: [0, 0.08, 0.2], s: [0.12, 0.16, 0.02], color: "#2a241e" },
      ];
    case "watchtower":
      return [
        ...[-1, 1].flatMap((sx) =>
          [-1, 1].map(
            (sz): KitPart => ({
              geo: "cyl",
              p: [sx * 0.1, 0.38, sz * 0.1],
              s: [0.035, 0.76, 0.035],
              color: DARK_WOOD,
            }),
          ),
        ),
        { geo: "box", p: [0, 0.74, 0], s: [0.3, 0.03, 0.3], color: WOOD },
        { geo: "box", p: [0, 0.8, 0], s: [0.3, 0.1, 0.3], color: WOOD },
        { geo: "cone", p: [0, 0.94, 0], s: [0.38, 0.16, 0.38], color: THATCH },
      ];
    case "pen":
      return Array.from({ length: 10 }, (_, k): KitPart => {
        const a = (k / 10) * Math.PI * 2;
        return {
          geo: "cyl",
          p: [Math.cos(a) * 0.4, 0.07, Math.sin(a) * 0.4],
          s: [0.025, 0.14, 0.025],
          color: DARK_WOOD,
        };
      }).concat([
        { geo: "torus", p: [0, 0.1, 0], s: [0.8, 0.8, 0.02], r: [Math.PI / 2, 0, 0], color: WOOD },
      ]);
    case "totem":
      return [
        { geo: "cyl", p: [0, 0.45, 0], s: [0.09, 0.9, 0.09], color: WOOD },
        { geo: "cyl", p: [0, 0.3, 0], s: [0.11, 0.08, 0.11], color: "#b5452d" },
        { geo: "cyl", p: [0, 0.55, 0], s: [0.11, 0.08, 0.11], color: "#d9a13a" },
        { geo: "box", p: [0, 0.82, 0], s: [0.4, 0.05, 0.06], color: "#3f6f8a" },
        { geo: "sphere", p: [0, 0.93, 0], s: [0.12, 0.12, 0.12], color: HIDE },
      ];
  }
  void tiles;
  return [];
}

/** Which way a structure faces: docks out to sea, fences outwards, the rest towards home. */
/** Height of a pier's deck above the sea. */
export const DOCK_DECK = 0.16;
/** How far a pier reaches out from its tile's centre. */
export const DOCK_LEN = 2.2;

/** The way a pier points: out towards the open water around its tile. */
export function dockHeading(i: number, tiles: Tile[]) {
  let sx = 0;
  let sz = 0;
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx(i) + dx;
      const z = ty(i) + dz;
      if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
      if (tiles[z * SIZE + x].water !== SEA || (!dx && !dz)) continue;
      const d = Math.hypot(dx, dz);
      sx += dx / d / d;
      sz += dz / d / d;
    }
  return Math.atan2(sx, sz);
}

function facingOf(kind: StructureKind, i: number, tiles: Tile[], home: number) {
  if (kind === "dock") return dockHeading(i, tiles);
  const toHome = Math.atan2(wx(home) - wx(i), wz(home) - wz(i));
  if (kind === "fence") return toHome + Math.PI / 2 + Math.PI / 2;
  if (kind === "walkway") return (tx(i) + ty(i)) % 2 ? 0 : Math.PI / 2;
  return toHome;
}

const GEOS: Geo[] = ["box", "cyl", "cone", "sphere", "torus"];
function unit(g: Geo) {
  switch (g) {
    case "box":
      return new THREE.BoxGeometry(1, 1, 1);
    case "cyl":
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
    case "cone":
      return new THREE.ConeGeometry(0.5, 1, 8);
    case "sphere":
      return new THREE.SphereGeometry(0.5, 8, 6);
    case "torus":
      return new THREE.TorusGeometry(0.5, 0.12, 5, 14);
  }
}

const m = new THREE.Matrix4();
const base = new THREE.Matrix4();
const local = new THREE.Matrix4();
const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const e = new THREE.Euler();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();
const cc = new THREE.Color();
const v3 = new THREE.Vector3();
const CAP = 2600;

export function Structures({ world }: { world: WorldState }) {
  const geos = useMemo(
    () =>
      Object.fromEntries(GEOS.map((g) => [g, unit(g)])) as unknown as Record<
        Geo,
        THREE.BufferGeometry
      >,
    [],
  );
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    [],
  );
  const refs = useRef<Partial<Record<Geo, THREE.InstancedMesh | null>>>({});
  const tiles = world.tiles;
  const dry = seasonOf(world.day) === "dry";
  const pits = useMemo(() => {
    const out: number[] = [];
    tiles.forEach((t, i) => t.build === "fire_pit" && out.push(i));
    return out;
  }, [tiles]);

  useLayoutEffect(() => {
    const n: Partial<Record<Geo, number>> = {};
    tiles.forEach((t, i) => {
      if (!t.build) return;
      const x = wx(i);
      const z = wz(i);
      const y = heightAt(tiles, x, z);
      const face = facingOf(t.build, i, tiles, world.tribe.home);
      // Newly built structures rise into place.
      const age = world.day - (t.builtDay ?? 0);
      const grow = age >= 1 ? 1 : 0.6;
      // Things shift a little within the tile so rows don't look stamped.
      const still =
        t.build === "farm" || t.build === "fence" || t.build === "walkway" || t.build === "dock";
      const ox = still ? 0 : (hash(i, 1) - 0.5) * 0.3;
      const oz = still ? 0 : (hash(i, 2) - 0.5) * 0.3;
      q.setFromEuler(e.set(0, face, 0));
      // Buildings at a size people fit (fields, fences and walkways fill their tile).
      const big =
        t.build === "farm" || t.build === "fence" || t.build === "walkway" || t.build === "dock"
          ? 1
          : BUILD_SCALE;
      base.compose(pv.set(x + ox, y, z + oz), q, sv.set(big, grow * big, big));
      for (const part of kit(t.build, i, tiles, dry)) {
        const mesh = refs.current[part.geo];
        if (!mesh) continue;
        const k = n[part.geo] ?? 0;
        if (k >= CAP) continue;
        n[part.geo] = k + 1;
        local.compose(
          pv.set(...part.p),
          q.setFromEuler(e.set(...(part.r ?? [0, 0, 0]))),
          sv.set(...part.s),
        );
        m.copy(base).multiply(local);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, cc.set(part.color));
      }
    });
    for (const g of GEOS) {
      const mesh = refs.current[g];
      if (!mesh) continue;
      mesh.count = n[g] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [tiles, world.day, world.tribe.home, dry]);

  const clock = useMemo(() => {
    const start = performance.now();
    return () => (performance.now() - start) / 1000;
  }, []);

  return (
    <group>
      {GEOS.map((g) => (
        <instancedMesh
          key={g}
          ref={(r) => {
            refs.current[g] = r;
            // Runs on every render: set up once, or placed huts would vanish.
            if (r && !r.userData.ready) {
              r.userData.ready = true;
              r.setColorAt(0, cc.set("#ffffff"));
              r.count = 0;
            }
          }}
          args={[geos[g], material, CAP]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}
      {/* Cooking fires, a warm glow after dark. */}
      {pits.slice(0, 10).map((i) => (
        <group key={i} position={[wx(i), heightAt(tiles, wx(i), wz(i)), wz(i)]}>
          <Puffs
            getT={clock}
            origin={[0, 0.03, 0]}
            count={10}
            duration={0.8}
            spread={0.08}
            rise={0.35}
            size={[0.06, 0.16]}
            color="#ffa040"
            opacity={0.9}
            additive
            loop
            seed={i}
          />
          <Puffs
            getT={clock}
            origin={[0, 0.2, 0]}
            count={10}
            duration={4}
            spread={0.3}
            rise={1.4}
            size={[0.1, 0.4]}
            color="#9a938c"
            opacity={0.35}
            loop
            seed={i + 1}
          />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type Task = "fish" | "farm" | "gather" | "fire" | "patrol" | "hunt" | "home";

interface Person {
  id: number;
  task: Task;
  x: number;
  z: number;
  tx: number;
  tz: number;
  work: number;
  phase: number;
  fleeing: number;
  shade: number;
  yaw: number;
  /** What the body is doing: clip, time in it, and the clip it's fading from. */
  clip: ClipName;
  clipT: number;
  prev: ClipName;
  prevT: number;
  fade: number;
  /** Children are smaller; everyone a little different. */
  size: number;
  /** Fishing from a pier: which one, and how far out along it. */
  pier?: { dock: number; along: number; side: number };
}

/** A pier: where it starts (its tile's centre) and which way it runs. */
interface Pier {
  tile: number;
  x: number;
  z: number;
  sin: number;
  cos: number;
}

/** A dugout canoe that paddles out to fish and comes home. */
interface Canoe {
  id: number;
  pier: number;
  x: number;
  z: number;
  yaw: number;
  mode: "moored" | "out" | "fishing" | "home";
  timer: number;
  tx: number;
  tz: number;
  stroke: number;
}

const SKIN = ["#8a5a3a", "#a4704a", "#6f4428", "#b98458"];
/** How tall a grown person stands (world units; a tile is about five metres). */
const PERSON_H = 0.32;
const PEOPLE_CAP = 120;
const CLOTH = ["#9a7a4a", "#6f5a3a", "#b5452d", "#c9ad7e"];

/** The tribe going about its day, and running for the huts when something comes. */
export function People({ world }: { world: WorldState }) {
  const people = useRef<Person[]>([]);
  const worldRef = useRef(world);
  worldRef.current = world;
  const places = useMemo(() => {
    const by: Record<string, number[]> = {};
    world.tiles.forEach((t, i) => {
      if (!t.build) return;
      (by[t.build] ??= []).push(i);
    });
    return by;
  }, [world.tiles]);
  const placesRef = useRef(places);
  placesRef.current = places;

  // As many figures as the tribe has people (roughly).
  useLayoutEffect(() => {
    const want = Math.min(110, Math.round(world.tribe.pop * 0.7));
    const list = people.current;
    const home = world.tribe.home;
    while (list.length < want) {
      const id = list.length + 1;
      list.push({
        id,
        task: "home",
        x: wx(home) + (hash(id, 1) - 0.5) * 2,
        z: wz(home) + (hash(id, 2) - 0.5) * 2,
        tx: wx(home),
        tz: wz(home),
        work: 0,
        phase: 0,
        fleeing: 0,
        shade: hash(id, 3),
        yaw: hash(id, 4) * Math.PI * 2,
        clip: "idle",
        clipT: hash(id, 5) * 3,
        prev: "idle",
        prevT: 0,
        fade: 0,
        size: hash(id, 6) < 0.18 ? 0.62 + hash(id, 7) * 0.12 : 0.9 + hash(id, 7) * 0.18,
      });
    }
    list.length = want;
  }, [world.tribe.pop, world.tribe.home]);

  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const spear = useRef<THREE.InstancedMesh>(null);
  const canoe = useRef<THREE.InstancedMesh>(null);
  const canoeInner = useRef<THREE.InstancedMesh>(null);
  const canoes = useRef<Canoe[]>([]);
  // Where the piers are and which way they run.
  const piers = useMemo<Pier[]>(
    () =>
      (places.dock ?? []).slice(0, 4).map((i) => {
        const a = dockHeading(i, world.tiles);
        return { tile: i, x: wx(i), z: wz(i), sin: Math.sin(a), cos: Math.cos(a) };
      }),
    // Piers stay put once built.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [places.dock?.join(",")],
  );
  const piersRef = useRef(piers);
  piersRef.current = piers;
  // The real figure, once it has loaded (the sketch stands in until then).
  const [skin, setSkin] = useState<Skin | null>(null);
  const skinRef = useRef<Skin | null>(null);
  skinRef.current = skin;
  useEffect(() => {
    let live = true;
    loadSkin("person")
      .then((s) => live && setSkin(s))
      .catch((err) => console.warn("Keeping the sketched people:", err));
    return () => {
      live = false;
    };
  }, []);
  const personAttrs = useMemo(() => {
    const attr = (n: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(PEOPLE_CAP * n), n).setUsage(
        THREE.DynamicDrawUsage,
      );
    return { a: attr(3), b: attr(3), f: attr(1), l: attr(4), l2: attr(4) };
  }, []);
  const personGeo = useMemo(() => {
    if (!skin) return null;
    const g = skin.geometry.clone();
    g.setAttribute("aAnimA", personAttrs.a);
    g.setAttribute("aAnimB", personAttrs.b);
    g.setAttribute("aFade", personAttrs.f);
    g.setAttribute("aLook", personAttrs.l);
    g.setAttribute("aLook2", personAttrs.l2);
    return g;
  }, [skin, personAttrs]);
  const personMesh = useRef<THREE.InstancedMesh>(null);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = clock.elapsedTime;
    const w = worldRef.current;
    const pl = placesRef.current;
    const home = w.tribe.home;
    const focus = w.tribe.focus;
    let nb = 0;
    let ns = 0;
    let nc = 0;
    let np = 0;
    for (const p of people.current) {
      // Danger first: anything with teeth close by sends everyone running home.
      for (const h of lifeBus.hunters) {
        if (Math.hypot(h.x - p.x, h.z - p.z) < 3 * h.danger + 1) {
          p.fleeing = 4;
          break;
        }
      }
      if (p.fleeing > 0) {
        p.fleeing -= dt;
        const hut = pl.hut?.[p.id % Math.max(1, pl.hut.length)] ?? home;
        p.tx = wx(hut);
        p.tz = wz(hut);
      } else if (p.work <= t) {
        // A new job, depending on the time of day and what the tribe is focused on.
        const r = hash(p.id, Math.floor(t / 20));
        let task: Task;
        if (env.night) task = r < 0.7 ? "fire" : "home";
        else {
          const weights: [Task, number][] = [
            ["fish", focus === "fish" ? 3 : 1.2],
            ["farm", pl.farm?.length ? (focus === "farm" ? 3 : 1.2) : 0],
            ["gather", 1],
            ["patrol", focus === "defend" ? 2 : 0.4],
            ["hunt", focus === "hunt" ? 2 : 0.4],
            ["fire", 0.6],
          ];
          const total = weights.reduce((a, [, v]) => a + v, 0);
          let pick = r * total;
          task = "gather";
          for (const [k, v] of weights) {
            if ((pick -= v) <= 0) {
              task = k;
              break;
            }
          }
        }
        p.task = task;
        const choose = (list?: number[]) =>
          list?.length ? list[Math.floor(hash(p.id, Math.floor(t / 20), 5) * list.length)] : home;
        let target = home;
        let spread = 0.4;
        p.pier = undefined;
        switch (task) {
          case "fish": {
            // Out along a pier to fish off the end or the side.
            const piers = piersRef.current;
            if (piers.length) {
              const k = Math.floor(hash(p.id, Math.floor(t / 20), 5) * piers.length);
              p.pier = {
                dock: k,
                along: 0.9 + hash(p.id, Math.floor(t / 20), 6) * (DOCK_LEN - 1.1),
                side: (hash(p.id, Math.floor(t / 20), 7) - 0.5) * 0.18,
              };
            }
            target = choose(pl.dock);
            spread = 0;
            break;
          }
          case "farm":
            target = choose(pl.farm);
            spread = 0.7;
            break;
          case "fire":
            target = choose(pl.fire_pit);
            spread = 0.45;
            break;
          case "patrol":
            target = choose(pl.fence?.length ? pl.fence : pl.lookout);
            spread = 0.5;
            break;
          case "home":
            target = choose(pl.hut);
            spread = 0.3;
            break;
          case "gather":
          case "hunt": {
            // Out into the country beyond the huts.
            const a = hash(p.id, Math.floor(t / 20), 6) * Math.PI * 2;
            const d = task === "hunt" ? 7 : 4.5;
            p.tx = wx(home) + Math.cos(a) * d;
            p.tz = wz(home) + Math.sin(a) * d;
            spread = 0;
            target = -1;
          }
        }
        if (target >= 0) {
          p.tx = wx(target) + (hash(p.id, 7, Math.floor(t)) - 0.5) * spread * 2;
          p.tz = wz(target) + (hash(p.id, 8, Math.floor(t)) - 0.5) * spread * 2;
        }
        p.work = t + 12 + hash(p.id, 9, Math.floor(t)) * 14;
      }
      // Onto a pier: first to where it leaves the beach, then out along it.
      let onPier = false;
      if (p.pier && p.fleeing <= 0) {
        const pr = piersRef.current[p.pier.dock];
        if (pr) {
          const rx = p.x - pr.x;
          const rz = p.z - pr.z;
          const along = rx * pr.sin + rz * pr.cos;
          const across = rx * pr.cos - rz * pr.sin;
          onPier = along > 0.25 && Math.abs(across) < 0.2;
          if (Math.hypot(rx, rz) > 0.35 && !onPier) {
            p.tx = pr.x;
            p.tz = pr.z;
          } else {
            p.tx = pr.x + pr.sin * p.pier.along + pr.cos * p.pier.side;
            p.tz = pr.z + pr.cos * p.pier.along - pr.sin * p.pier.side;
          }
        }
      }
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const running = p.fleeing > 0;
      // Walking about 1.4 m/s, running about 4 (a tile is ~5 m), smaller for children.
      const speed = (running ? 0.75 : 0.28) * (0.8 + p.size * 0.2);
      const moving = d > 0.05;
      if (moving) {
        // Turn towards the way you're going, then walk that way.
        let turn = Math.atan2(dx, dz) - p.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        p.yaw += turn * Math.min(1, dt * 7);
        const step = Math.min(
          d,
          speed * dt * Math.max(0.2, Math.cos(Math.min(1.4, Math.abs(turn)))),
        );
        p.x += Math.sin(p.yaw) * step;
        p.z += Math.cos(p.yaw) * step;
      } else if (p.task === "fire" || p.task === "home") {
        // Face the fire or the hut.
        const hx = wx(home) - p.x;
        const hz = wz(home) - p.z;
        if (Math.hypot(hx, hz) > 0.1) {
          let turn = Math.atan2(hx, hz) - p.yaw;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          p.yaw += turn * Math.min(1, dt * 2);
        }
      }
      // The body: walk or run to match the ground covered, bend to work, stand.
      const skin = skinRef.current;
      if (skin) {
        const want: ClipName = moving
          ? running
            ? "run"
            : "walk"
          : p.task === "farm" || p.task === "gather"
            ? "graze"
            : "idle";
        if (want !== p.clip) {
          p.prev = p.clip;
          p.prevT = p.clipT;
          p.fade = 1;
          p.clip = want;
          p.clipT = hash(p.id, 11) * 2;
        }
        const meta = skin.meta.clips[p.clip];
        let rate = 1;
        if (meta && moving) {
          const h = PERSON_H * p.size;
          // Stride of about 0.8 of standing height per step, two steps a cycle.
          const perCycle = h * (running ? 2.2 : 1.5);
          rate = Math.min(1.8, Math.max(0.6, (speed / perCycle) * meta.dur));
        }
        p.clipT += dt * rate;
        if (p.fade > 0) {
          p.prevT += dt;
          p.fade = Math.max(0, p.fade - dt / 0.25);
        }
      }
      p.phase += dt * (moving ? 14 : 2);
      const ground = heightAt(w.tiles, p.x, p.z);
      const y =
        (onPier ? Math.max(ground, DOCK_DECK + 0.01) : Math.max(ground, 0)) +
        (skin ? 0 : moving ? Math.abs(Math.sin(p.phase)) * 0.012 : 0);
      const lean = !skin && p.task === "farm" && !moving ? 0.5 : 0;
      q.setFromEuler(e.set(lean, p.yaw, 0));
      const person = personMesh.current;
      if (skin && person && np < PEOPLE_CAP) {
        const k = (PERSON_H * p.size) / skin.meta.height;
        m.compose(pv.set(p.x, y, p.z), q, sv.set(k, k, k));
        person.setMatrixAt(np, m);
        cc.setScalar(0.85 + p.shade * 0.3);
        person.setColorAt(np, cc);
        const at = personAttrs;
        const ca = skin.meta.clips[p.clip] ?? skin.meta.clips.idle!;
        clipRows(ca, p.clipT, v3);
        at.a.setXYZ(np, v3.x, v3.y, v3.z);
        const cb = skin.meta.clips[p.prev] ?? ca;
        clipRows(cb, p.prevT, v3);
        at.b.setXYZ(np, v3.x, v3.y, v3.z);
        at.f.setX(np, p.fade);
        // Skin tones and hide colours vary from person to person.
        at.l.setXYZW(np, (p.shade - 0.5) * 0.35, 0.85 + hash(p.id, 12) * 0.35, 0, 0);
        at.l2.setXYZW(np, 0, hash(p.id, 13), 0, 0.85 + hash(p.id, 14) * 0.25);
        np++;
      } else if (!skin && body.current && nb < 120) {
        m.compose(pv.set(p.x, y + 0.035, p.z), q, sv.set(0.035, 0.07, 0.03));
        body.current.setMatrixAt(nb, m);
        body.current.setColorAt(nb, cc.set(CLOTH[p.id % CLOTH.length]));
        if (head.current) {
          m.compose(pv.set(p.x, y + 0.085, p.z), q, sv.setScalar(0.028));
          head.current.setMatrixAt(nb, m);
          head.current.setColorAt(nb, cc.set(SKIN[Math.floor(p.shade * SKIN.length)]));
        }
        nb++;
      }
      if (spear.current && (p.task === "hunt" || p.task === "patrol") && ns < 60) {
        // Carried upright in the right hand.
        const h = skin ? PERSON_H * p.size : 0.1;
        const side = 0.22 * h;
        m.compose(
          pv.set(
            p.x + Math.cos(p.yaw) * -side + Math.sin(p.yaw) * 0.08 * h,
            y + h * 0.55,
            p.z - Math.sin(p.yaw) * -side + Math.cos(p.yaw) * 0.08 * h,
          ),
          q.setFromEuler(e.set(0.15, p.yaw, 0)),
          sv.set(0.012 * h * 5, h * 1.25, 0.012 * h * 5),
        );
        spear.current.setMatrixAt(ns++, m);
      }
    }

    // --- Canoes: out to the fishing grounds and back ---------------------------
    const piers = piersRef.current;
    const boats = canoes.current;
    const want = env.night ? 0 : Math.min(8, piers.length * 2);
    while (boats.length < piers.length * 2 && boats.length < 8) {
      const id = boats.length;
      const pr = piers[id % piers.length];
      boats.push({
        id,
        pier: id % piers.length,
        x: pr.x + pr.sin * DOCK_LEN * 0.8,
        z: pr.z + pr.cos * DOCK_LEN * 0.8,
        yaw: Math.atan2(pr.sin, pr.cos),
        mode: "moored",
        timer: 3 + hash(id, 51) * 20,
        tx: 0,
        tz: 0,
        stroke: 0,
      });
      // ?boats=1 starts with the canoes already out (for checking them).
      if (typeof window !== "undefined" && /[?&]boats=1\b/.test(window.location.search)) {
        const b = boats[boats.length - 1];
        const a = Math.atan2(pr.sin, pr.cos) + (hash(id, 55) - 0.5) * 1.2;
        const r = 1.5 + hash(id, 56) * 3;
        b.x = pr.x + Math.sin(a) * r;
        b.z = pr.z + Math.cos(a) * r;
        b.yaw = a;
        b.mode = id % 2 ? "fishing" : "out";
        b.tx = pr.x + Math.sin(a) * (r + 4);
        b.tz = pr.z + Math.cos(a) * (r + 4);
        b.timer = 60;
      }
    }
    boats.length = Math.min(boats.length, piers.length * 2);
    for (const b of boats) {
      const pr = piers[b.pier];
      if (!pr) continue;
      const side = b.id % 2 ? 1 : -1;
      // Moored alongside the pier, near the end.
      const mx = pr.x + pr.sin * DOCK_LEN * (0.55 + (b.id % 2) * 0.25) + pr.cos * side * 0.3;
      const mz = pr.z + pr.cos * DOCK_LEN * (0.55 + (b.id % 2) * 0.25) - pr.sin * side * 0.3;
      b.timer -= dt;
      if (b.mode === "moored" && b.timer <= 0 && b.id < want) {
        // Pick a fishing ground: open water out beyond the pier.
        for (let k = 0; k < 8; k++) {
          const a = Math.atan2(pr.sin, pr.cos) + (hash(b.id, Math.floor(t), k) - 0.5) * 1.8;
          const r = 3 + hash(b.id, Math.floor(t), k + 9) * 7;
          const fx = pr.x + Math.sin(a) * r;
          const fz = pr.z + Math.cos(a) * r;
          if (heightAt(w.tiles, fx, fz) < -0.4) {
            b.tx = fx;
            b.tz = fz;
            b.mode = "out";
            break;
          }
        }
        b.timer = 5;
      } else if (b.mode === "fishing" && b.timer <= 0) {
        b.mode = "home";
      } else if (b.mode === "moored") {
        b.x += (mx - b.x) * Math.min(1, dt);
        b.z += (mz - b.z) * Math.min(1, dt);
        let turn = Math.atan2(pr.sin, pr.cos) - b.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        b.yaw += turn * Math.min(1, dt * 0.5);
      }
      if (b.mode === "out" || b.mode === "home") {
        const gx = b.mode === "out" ? b.tx : mx;
        const gz = b.mode === "out" ? b.tz : mz;
        const ddx = gx - b.x;
        const ddz = gz - b.z;
        const dd = Math.hypot(ddx, ddz);
        let turn = Math.atan2(ddx, ddz) - b.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        b.yaw += Math.max(-dt * 0.9, Math.min(dt * 0.9, turn));
        // Paddle strokes: a surge with each pull, gliding between.
        b.stroke += dt * 2.6;
        const v = 0.45 * (0.55 + 0.45 * Math.max(0, Math.sin(b.stroke * Math.PI * 2)));
        const step = Math.min(dd, v * dt * Math.max(0.3, Math.cos(Math.min(1.3, Math.abs(turn)))));
        b.x += Math.sin(b.yaw) * step;
        b.z += Math.cos(b.yaw) * step;
        if (dd < 0.25) {
          b.mode = b.mode === "out" ? "fishing" : "moored";
          b.timer =
            b.mode === "fishing" ? 20 + hash(b.id, Math.floor(t)) * 25 : 8 + hash(b.id, 52) * 20;
        }
      }
      if (b.mode === "fishing") {
        // Drift a little on the swell.
        b.x += Math.sin(t * 0.2 + b.id) * dt * 0.02;
        b.yaw += Math.sin(t * 0.13 + b.id) * dt * 0.05;
      }
      // Riding the swell: height from the sea itself, tilting with its slope.
      const depth = -heightAt(w.tiles, b.x, b.z);
      const fx = Math.sin(b.yaw) * 0.4;
      const fz = Math.cos(b.yaw) * 0.4;
      const hc = seaHeightAt(b.x, b.z, t, depth);
      const hf = seaHeightAt(b.x + fx, b.z + fz, t, depth);
      const hb = seaHeightAt(b.x - fx, b.z - fz, t, depth);
      const hl = seaHeightAt(b.x + fz * 0.4, b.z - fx * 0.4, t, depth);
      const bob = hc + 0.04;
      const pitch = Math.atan2(hb - hf, 0.8) * 0.8;
      const roll = Math.atan2(hl - hc, 0.16) * 0.3 + Math.sin(t * 1.7 + b.id) * 0.03;
      q.setFromEuler(e.set(pitch, b.yaw, roll, "YXZ"));
      if (canoe.current && nc < 16) {
        // The hull sits low: mostly under the waterline, gunwales just above.
        m.compose(pv.set(b.x, bob + 0.05, b.z), q, sv.set(0.2, 0.13, 0.95));
        canoe.current.setMatrixAt(nc, m);
        if (canoeInner.current) {
          m.compose(pv.set(b.x, bob + 0.042, b.z), q, sv.set(0.15, 0.01, 0.82));
          canoeInner.current.setMatrixAt(nc, m);
        }
        nc++;
      }
      // The fisher kneels in it, paddling on the way, still while fishing.
      const person = personMesh.current;
      if (skin && person && np < PEOPLE_CAP) {
        const h = PERSON_H;
        const k = h / skin.meta.height;
        const back = -0.12;
        m.compose(
          pv.set(b.x + Math.sin(b.yaw) * back, bob + 0.03 - h * 0.3, b.z + Math.cos(b.yaw) * back),
          q,
          sv.set(k, k, k),
        );
        person.setMatrixAt(np, m);
        cc.setScalar(0.95);
        person.setColorAt(np, cc);
        const clip = b.mode === "out" || b.mode === "home" ? "graze" : "idle";
        const c = skin.meta.clips[clip] ?? skin.meta.clips.idle!;
        clipRows(c, b.mode === "out" || b.mode === "home" ? b.stroke * c.dur : t + b.id * 3, v3);
        personAttrs.a.setXYZ(np, v3.x, v3.y, v3.z);
        personAttrs.b.setXYZ(np, v3.x, v3.y, v3.z);
        personAttrs.f.setX(np, 0);
        personAttrs.l.setXYZW(np, (hash(b.id, 53) - 0.5) * 0.3, 1, 0, 0);
        personAttrs.l2.setXYZW(np, 0, hash(b.id, 54), 0, 0.95);
        np++;
        // The paddle, dipping on alternate sides.
        if (spear.current && ns < 60 && (b.mode === "out" || b.mode === "home")) {
          const sw = Math.sin(b.stroke * Math.PI * 2);
          const sideP = (Math.floor(b.stroke) % 2 ? 1 : -1) * 0.1;
          m.compose(
            pv.set(
              b.x + Math.cos(b.yaw) * sideP + Math.sin(b.yaw) * (0.05 + sw * 0.08),
              0.08 + bob,
              b.z - Math.sin(b.yaw) * sideP + Math.cos(b.yaw) * (0.05 + sw * 0.08),
            ),
            q2.setFromEuler(e.set(0.6 + sw * 0.4, b.yaw, sideP * 3, "YXZ")),
            sv.set(0.012, 0.28, 0.012),
          );
          spear.current.setMatrixAt(ns++, m);
        }
      }
    }
    const pm = personMesh.current;
    if (pm) {
      pm.count = np;
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
      for (const attr of Object.values(personAttrs)) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, np * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    for (const [mesh, n] of [
      [body.current, nb],
      [head.current, nb],
      [spear.current, ns],
      [canoe.current, nc],
      [canoeInner.current, nc],
    ] as const) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      {skin && personGeo && (
        <instancedMesh
          ref={(r) => {
            personMesh.current = r;
            if (r && !r.userData.ready) {
              r.userData.ready = true;
              r.setColorAt(0, cc.set("#ffffff"));
              r.count = 0;
              r.customDepthMaterial = skin.depth;
            }
          }}
          args={[personGeo, skin.materials, PEOPLE_CAP]}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      )}
      <instancedMesh ref={body} args={[undefined, undefined, 120]} frustumCulled={false} castShadow>
        <capsuleGeometry args={[0.5, 0.6, 2, 6]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, 120]} frustumCulled={false}>
        <sphereGeometry args={[0.5, 6, 5]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={spear} args={[undefined, undefined, 60]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, 1, 4]} />
        <meshStandardMaterial color="#5a4029" roughness={0.9} />
      </instancedMesh>
      {/* Dugout hulls: the lower half of a long, narrow shell. */}
      <instancedMesh ref={canoe} args={[undefined, undefined, 16]} frustumCulled={false} castShadow>
        <sphereGeometry args={[0.5, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshStandardMaterial color="#5e4029" roughness={0.85} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={canoeInner} args={[undefined, undefined, 16]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, 1, 14]} />
        <meshStandardMaterial color="#2c1e14" roughness={0.95} />
      </instancedMesh>
    </group>
  );
}
