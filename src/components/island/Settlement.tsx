import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { seasonOf } from "@/lib/island/sim";
import { around } from "@/lib/island/terrain";
import {
  SEA,
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
    case "dock":
      return [
        { geo: "box", p: [0, 0.05, 0.35], s: [0.14, 0.025, 0.75], color: WOOD },
        { geo: "cyl", p: [0.07, 0.0, 0.6], s: [0.025, 0.2, 0.025], color: DARK_WOOD },
        { geo: "cyl", p: [-0.07, 0.0, 0.6], s: [0.025, 0.2, 0.025], color: DARK_WOOD },
        { geo: "sphere", p: [0.16, 0.02, 0.55], s: [0.07, 0.04, 0.34], color: "#6b4a2a" },
        { geo: "box", p: [-0.2, 0.08, 0.05], s: [0.2, 0.12, 0.02], color: HIDE },
      ];
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
function facingOf(kind: StructureKind, i: number, tiles: Tile[], home: number) {
  if (kind === "dock") {
    const sea = around(i).find((n) => tiles[n].water === SEA);
    if (sea !== undefined) return Math.atan2(wx(sea) - wx(i), wz(sea) - wz(i));
  }
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
const e = new THREE.Euler();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();
const cc = new THREE.Color();
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
      const ox =
        t.build === "farm" || t.build === "fence" || t.build === "walkway"
          ? 0
          : (hash(i, 1) - 0.5) * 0.3;
      const oz =
        t.build === "farm" || t.build === "fence" || t.build === "walkway"
          ? 0
          : (hash(i, 2) - 0.5) * 0.3;
      q.setFromEuler(e.set(0, face, 0));
      base.compose(pv.set(x + ox, y, z + oz), q, sv.set(1, grow, 1));
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
}

const SKIN = ["#8a5a3a", "#a4704a", "#6f4428", "#b98458"];
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
      });
    }
    list.length = want;
  }, [world.tribe.pop, world.tribe.home]);

  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const spear = useRef<THREE.InstancedMesh>(null);
  const canoe = useRef<THREE.InstancedMesh>(null);

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
        switch (task) {
          case "fish":
            target = choose(pl.dock);
            spread = 0.2;
            break;
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
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const speed = p.fleeing > 0 ? 1.1 : 0.35;
      const moving = d > 0.05;
      if (moving) {
        const step = Math.min(d, speed * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
      }
      p.phase += dt * (moving ? 14 : 2);
      const ground = heightAt(w.tiles, p.x, p.z);
      const onSea = p.task === "fish" && d < 0.3 && ground < 0.05;
      const y = Math.max(ground, 0) + (moving ? Math.abs(Math.sin(p.phase)) * 0.012 : 0);
      const lean = p.task === "farm" && !moving ? 0.5 : 0;
      q.setFromEuler(e.set(lean, Math.atan2(dx, dz), 0));
      if (body.current && nb < 120) {
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
        m.compose(
          pv.set(p.x + 0.02, y + 0.07, p.z),
          q.setFromEuler(e.set(0.2, 0, 0.1)),
          sv.set(0.006, 0.16, 0.006),
        );
        spear.current.setMatrixAt(ns++, m);
      }
      if (canoe.current && onSea && nc < 20) {
        m.compose(
          pv.set(p.x, 0.01, p.z),
          q.setFromEuler(e.set(0, Math.atan2(dx, dz) + t * 0.05, 0)),
          sv.set(0.06, 0.03, 0.28),
        );
        canoe.current.setMatrixAt(nc++, m);
      }
    }
    for (const [mesh, n] of [
      [body.current, nb],
      [head.current, nb],
      [spear.current, ns],
      [canoe.current, nc],
    ] as const) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
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
      <instancedMesh ref={canoe} args={[undefined, undefined, 20]} frustumCulled={false}>
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
