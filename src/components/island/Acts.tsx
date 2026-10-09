import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { tx, ty, wx, wz, type ActionRecord, type Tile, type WorldState } from "@/lib/island/types";
import { heightAt } from "./palette";
import { lifeBus } from "./lifeBus";
import { Puffs } from "./fx/vfx";
import { TsunamiSpectacle, tsunamiPlan } from "./Tsunami";
import { EruptionSpectacle, eruptionPlan } from "./Eruption";
import { env } from "./fx/env";
import { around } from "@/lib/island/terrain";

/** A god's act being played out on screen. */
export interface ActRun {
  id: number;
  record: ActionRecord;
  before: WorldState;
  after: WorldState;
}

export interface TileReveal {
  tile: number;
  at: number;
}

/** How long each act's show lasts after its last tile changes. */
const TAIL = 3.5;

const dist = (a: number, b: number) => Math.hypot(tx(a) - tx(b), ty(a) - ty(b));

/** When each changed tile changes, so the damage spreads the way the act does. */
export function planReveal(run: ActRun): TileReveal[] {
  const { before, after, record } = run;
  const impact = record.impact;
  const changed: number[] = [];
  for (let i = 0; i < after.tiles.length; i++) {
    const a = before.tiles[i];
    const b = after.tiles[i];
    if (
      a.h !== b.h ||
      a.water !== b.water ||
      a.fire !== b.fire ||
      a.lava !== b.lava ||
      a.flood !== b.flood ||
      a.build !== b.build ||
      a.biome !== b.biome ||
      a.forest !== b.forest
    )
      changed.push(i);
  }
  const tsu = record.power === "tsunami" && impact ? tsunamiPlan(before, record) : null;
  const lava = record.power === "eruption" ? eruptionPlan(before, record) : null;
  const order = new Map<number, number>();
  (impact?.tiles ?? []).forEach((i, k) => order.set(i, k));
  const at = (i: number): number => {
    const k = order.get(i);
    switch (record.power) {
      case "eruption": {
        const a = lava?.arrival.get(i);
        if (a !== undefined) return a;
        // Forest catching fire beside the lava goes up just after it arrives.
        let near = Infinity;
        for (const n of around(i)) near = Math.min(near, lava?.arrival.get(n) ?? Infinity);
        return Number.isFinite(near) ? near + 0.6 : 3;
      }
      case "meteor":
        return 2.1 + dist(i, record.tile) * 0.08;
      case "tsunami":
        return tsu ? tsu.arrival(tsu.alongOf(i)) : 1;
      case "wildfire":
      case "stampede":
        return 0.6 + (k ?? 0) * 0.08;
      case "storm":
        return 1 + (k ?? 0) * 0.8;
      case "flood":
        return 0.5 + (k ?? 0) * 0.03;
      case "earthquake":
        return 0.6 + hash(i, 3) * 2.5;
      case "raid":
        return 2.5 + hash(i, 4);
      default:
        return 0.2 + dist(i, record.tile) * 0.05;
    }
  };
  return changed
    .map((tile) => ({ tile, at: at(tile) }))
    .sort((p, q) => p.at - q.at || p.tile - q.tile);
}

export const actLength = (reveal: TileReveal[]) => (reveal.at(-1)?.at ?? 1) + TAIL;

/** A fireball out of the sky. */
function Meteor({ x, z, y, getT }: { x: number; z: number; y: number; getT: () => number }) {
  const rock = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = getT();
    const k = Math.min(1, t / 2.1);
    const px = x - 18 * (1 - k);
    const py = y + 40 * (1 - k * k);
    const pz = z - 8 * (1 - k);
    rock.current?.position.set(px, py, pz);
    if (rock.current) rock.current.visible = t < 2.1;
    trail.current?.position.set(px, py, pz);
    if (trail.current) trail.current.visible = t < 2.2;
  });
  const since = () => getT() - 2.1;
  return (
    <>
      <mesh ref={rock}>
        <icosahedronGeometry args={[0.9, 1]} />
        <meshStandardMaterial color="#3a2a22" emissive="#ff6a1a" emissiveIntensity={2.5} />
      </mesh>
      <group ref={trail}>
        <Puffs
          getT={getT}
          origin={[0, 0, 0]}
          count={40}
          duration={0.5}
          spread={0.8}
          rise={0.5}
          size={[0.8, 2.4]}
          color="#ff9a3a"
          opacity={0.85}
          additive
          loop
          seed={3}
        />
      </group>
      <Puffs
        getT={since}
        origin={[x, y + 0.5, z]}
        count={60}
        duration={1.6}
        stagger={0.2}
        spread={3.5}
        rise={4}
        size={[1, 3.4]}
        color="#ffb060"
        opacity={0.85}
        additive
        seed={4}
      />
      <Puffs
        getT={since}
        origin={[x, y + 0.5, z]}
        count={80}
        duration={7}
        stagger={1.5}
        spread={4}
        rise={7}
        size={[1.2, 4]}
        color="#5a4f48"
        opacity={0.8}
        seed={5}
      />
      <Shock x={x} y={y} z={z} getT={since} reach={9} color="#ffd6a0" />
    </>
  );
}

function Shock({
  x,
  y,
  z,
  getT,
  reach,
  color,
}: {
  x: number;
  y: number;
  z: number;
  getT: () => number;
  reach: number;
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = getT();
    const m = ref.current;
    if (!m) return;
    m.visible = t > 0 && t < 1.4;
    m.scale.setScalar(0.5 + (t / 1.4) * reach);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t / 1.4);
  });
  return (
    <mesh ref={ref} position={[x, y + 0.15, z]} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.85, 1, 48]} />
      <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** Lightning strikes where the forest catches. */
function Storm({ run, reveal, getT }: { run: ActRun; reveal: TileReveal[]; getT: () => number }) {
  const bolt = useRef<THREE.Group>(null);
  const tiles = run.after.tiles;
  useFrame(() => {
    const t = getT();
    const g = bolt.current;
    if (!g) return;
    const hit = reveal.find((r) => t >= r.at - 0.05 && t < r.at + 0.2);
    g.visible = !!hit;
    if (hit) {
      g.position.set(wx(hit.tile), heightAt(tiles, wx(hit.tile), wz(hit.tile)), wz(hit.tile));
      flash.current = 1;
    }
  });
  return (
    <group ref={bolt} visible={false}>
      <mesh position={[0, 7, 0]} rotation-z={0.05}>
        <cylinderGeometry args={[0.05, 0.1, 14, 5]} />
        <meshBasicMaterial color="#fffbe0" />
      </mesh>
      <mesh position={[-0.8, 9, 0]} rotation-z={-0.5}>
        <cylinderGeometry args={[0.03, 0.05, 4, 4]} />
        <meshBasicMaterial color="#d8f4ff" />
      </mesh>
    </group>
  );
}

/** Set by acts; read by the sky for a white flash. */
export const flash = { current: 0 };

/** A sickly mist over the region where the plague runs. */
function Plague({ run, getT }: { run: ActRun; getT: () => number }) {
  const region = run.before.tiles[run.record.tile].region;
  const spots = useMemo(
    () => (run.record.impact?.tiles ?? []).filter((_, k) => k % 6 === 0).slice(0, 7),
    [run],
  );
  const sickened = useRef(false);
  useFrame(() => {
    if (sickened.current || getT() < 1.5) return;
    sickened.current = true;
    // Some of the animals in view fall where they stand.
    for (const a of lifeBus.agents)
      if (
        a.region === region &&
        a.state !== "dead" &&
        hash(a.id, 77) < 0.4 &&
        ["titan", "hornface", "duckbill", "plateback"].includes(a.sp)
      ) {
        a.state = "dead";
        a.deadFor = -hash(a.id, 78) * 3;
      }
  });
  return (
    <>
      {spots.map((i) => (
        <Puffs
          key={i}
          getT={getT}
          origin={[wx(i), run.before.tiles[i].h + 0.4, wz(i)]}
          count={24}
          duration={4}
          stagger={3}
          spread={2.5}
          rise={0.8}
          size={[1, 3]}
          color="#9bb07a"
          opacity={0.4}
          seed={i}
        />
      ))}
    </>
  );
}

/** Dust along the path of a stampede or raid, and runners for the dinosaurs to show. */
function Runners({
  run,
  getT,
  kind,
}: {
  run: ActRun;
  getT: () => number;
  kind: "stampede" | "raid";
}) {
  const sent = useRef(false);
  const impact = run.record.impact!;
  const tiles = impact.tiles;
  useFrame(() => {
    if (sent.current) return;
    sent.current = true;
    const home = run.before.tribe.home;
    const points =
      kind === "stampede"
        ? tiles.map((i) => ({ x: wx(i), z: wz(i) }))
        : [
            {
              x: wx(home) + Math.cos(impact.angle) * 12,
              z: wz(home) + Math.sin(impact.angle) * 12,
            },
            { x: wx(home), z: wz(home) },
            { x: wx(home) - Math.cos(impact.angle) * 4, z: wz(home) - Math.sin(impact.angle) * 4 },
          ];
    lifeBus.runs.push({
      sp: kind === "stampede" ? "hornface" : "raptor",
      points,
      speed: kind === "stampede" ? 5 : 6,
      count: kind === "stampede" ? 14 : 6,
    });
  });
  return (
    <>
      {tiles
        .filter((_, k) => k % 3 === 0)
        .slice(0, 8)
        .map((i, k) => (
          <Puffs
            key={i}
            getT={() => getT() - 0.6 - k * 0.24}
            origin={[wx(i), run.before.tiles[i].h + 0.1, wz(i)]}
            count={18}
            duration={3}
            stagger={0.6}
            spread={1.4}
            rise={0.8}
            size={[0.6, 1.8]}
            color="#b3a58e"
            opacity={0.7}
            seed={i}
          />
        ))}
    </>
  );
}

/** Dust bursting off the ground where the quake breaks things. */
function Quake({ reveal, run, getT }: { reveal: TileReveal[]; run: ActRun; getT: () => number }) {
  return (
    <>
      {reveal.slice(0, 16).map((r) => (
        <Puffs
          key={r.tile}
          getT={() => getT() - r.at}
          origin={[wx(r.tile), run.after.tiles[r.tile].h + 0.1, wz(r.tile)]}
          count={14}
          duration={2.4}
          stagger={0.3}
          spread={0.9}
          rise={1}
          size={[0.4, 1.4]}
          color="#a8977e"
          opacity={0.75}
          seed={r.tile}
        />
      ))}
    </>
  );
}

/**
 * Plays a god's act: the set piece for it, and the damage spreading tile by
 * tile (reported back through onReveal so the island updates as it goes).
 */
export function ActSpectacle({
  run,
  reveal,
  onReveal,
  onDone,
  shake,
}: {
  run: ActRun;
  reveal: TileReveal[];
  onReveal: (tiles: number[]) => void;
  onDone: () => void;
  shake: { current: number };
}) {
  const t0 = useRef<number | null>(null);
  const elapsed = useRef(0);
  const next = useRef(0);
  const last = useRef(-1);
  const done = useRef(false);
  const getT = () => elapsed.current;
  const total =
    run.record.power === "tsunami" && run.record.impact
      ? Math.max(actLength(reveal), tsunamiPlan(run.before, run.record).end)
      : run.record.power === "eruption"
        ? Math.max(actLength(reveal), eruptionPlan(run.before, run.record).end)
        : actLength(reveal);
  const power = run.record.power;
  const x = wx(run.record.tile);
  const z = wz(run.record.tile);
  const y = heightAt(run.before.tiles, x, z);

  useFrame((_, dt) => {
    if (t0.current === null) t0.current = 0;
    else elapsed.current += Math.min(dt, 0.1);
    // Tests can hold the act at a chosen moment.
    const pin = typeof window !== "undefined" ? (window as { __actT?: number }).__actT : undefined;
    if (typeof pin === "number") elapsed.current = pin;
    if (typeof window !== "undefined")
      (window as { __act?: { t: number; power: string } }).__act = {
        t: elapsed.current,
        power: run.record.power,
      };
    const t = elapsed.current;
    // Ground shaking for the violent ones.
    if (power === "earthquake" && t < 4) shake.current = Math.max(shake.current, 0.25);
    if (power === "meteor" && t > 2.1 && t < 2.4) {
      shake.current = 0.5;
      flash.current = 1;
    }
    if (power === "tsunami" && t > 1 && t < 4) shake.current = Math.max(shake.current, 0.06);
    if (next.current < reveal.length && t - last.current > 0.12) {
      const due: number[] = [];
      while (next.current < reveal.length && reveal[next.current].at <= t)
        due.push(reveal[next.current++].tile);
      if (due.length) {
        last.current = t;
        onReveal(due);
      }
    }
    if (!done.current && t >= total) {
      done.current = true;
      onDone();
    }
  });

  switch (power) {
    case "meteor":
      return <Meteor x={x} y={y} z={z} getT={getT} />;
    case "eruption":
      return (
        <EruptionSpectacle
          before={run.before}
          record={run.record}
          getT={getT}
          shake={shake}
          flashRef={flash}
        />
      );
    case "tsunami":
      return (
        <TsunamiSpectacle
          before={run.before}
          after={run.after}
          record={run.record}
          getT={getT}
          shake={shake}
        />
      );
    case "storm":
      return <Storm run={run} reveal={reveal} getT={getT} />;
    case "plague":
      return <Plague run={run} getT={getT} />;
    case "stampede":
      return <Runners run={run} getT={getT} kind="stampede" />;
    case "raid":
      return <Runners run={run} getT={getT} kind="raid" />;
    case "earthquake":
      return <Quake reveal={reveal} run={run} getT={getT} />;
    default:
      // Gentler acts: a shimmer where the god's hand touches the island.
      return (
        <Puffs
          getT={getT}
          origin={[x, y + 0.3, z]}
          count={30}
          duration={1.8}
          stagger={0.5}
          spread={2.2}
          rise={1.8}
          size={[0.15, 0.5]}
          color={power === "grow" || power === "introduce" ? "#d9ffb0" : "#fff2c8"}
          opacity={0.9}
          additive
          seed={run.id}
        />
      );
  }
}

/** Flames and smoke on every burning tile. */
export function TileFires({ tiles }: { tiles: Tile[] }) {
  const burning = useMemo(() => {
    const out: number[] = [];
    tiles.forEach((t, i) => t.fire > 0 && out.push(i));
    return out.slice(0, 40);
  }, [tiles]);
  const clock = useMemo(() => {
    const s = performance.now();
    return () => (performance.now() - s) / 1000;
  }, []);
  return (
    <group>
      {burning.map((i) => {
        const h = heightAt(tiles, wx(i), wz(i)) + tiles[i].forest * 0.8;
        return (
          <group key={i} position={[wx(i), h, wz(i)]}>
            <Puffs
              getT={clock}
              origin={[0, 0, 0]}
              count={14}
              duration={0.9}
              spread={0.4}
              rise={1.2}
              size={[0.3, 0.9]}
              color="#ff8a2a"
              opacity={0.85}
              additive
              loop
              seed={i}
            />
            <Puffs
              getT={clock}
              origin={[0, 0.6, 0]}
              count={12}
              duration={4}
              spread={0.6}
              rise={3}
              size={[0.5, 1.8]}
              color="#3a3430"
              opacity={0.6}
              loop
              seed={i + 1}
            />
          </group>
        );
      })}
    </group>
  );
}

/** Flies the camera to where the god acts, then leaves it be. */
export function ActCamera({ run }: { run: ActRun | null }) {
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const move = useRef<{
    t: number;
    fromT: THREE.Vector3;
    fromP: THREE.Vector3;
    toT: THREE.Vector3;
    toP: THREE.Vector3;
  } | null>(null);
  useEffect(() => {
    if (!run || !controls) return;
    const p = run.record.power;
    // The tsunami and the eruption direct their own camera.
    if (p === "tsunami" || p === "eruption") return;
    const focus = p === "raid" ? run.before.tribe.home : run.record.tile;
    const x = wx(focus);
    const z = wz(focus);
    const y = heightAt(run.before.tiles, x, z);
    const far = p === "storm" ? 34 : 22;
    const toT = new THREE.Vector3(x, Math.max(0, y * 0.5), z);
    const off = camera.position.clone().sub(controls.target).normalize().multiplyScalar(far);
    off.y = Math.max(off.y, far * 0.55);
    move.current = {
      t: 0,
      fromT: controls.target.clone(),
      fromP: camera.position.clone(),
      toT,
      toP: toT.clone().add(off),
    };
  }, [run?.id, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    const m = move.current;
    if (!m || !controls) return;
    m.t = Math.min(1, m.t + dt / 2);
    const e = m.t * m.t * (3 - 2 * m.t);
    controls.target.lerpVectors(m.fromT, m.toT, e);
    camera.position.lerpVectors(m.fromP, m.toP, e);
    controls.update();
    if (m.t >= 1) move.current = null;
  });
  return null;
}

/** Shakes the world group when something big happens. */
export function Shaker({
  shake,
  children,
}: {
  shake: { current: number };
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const a = shake.current;
    if (a < 0.002) {
      g.position.set(0, 0, 0);
      shake.current = 0;
      return;
    }
    const t = performance.now() / 1000;
    g.position.set(
      Math.sin(t * 57) * a * 0.3,
      Math.cos(t * 43) * a * 0.1,
      Math.sin(t * 51 + 1) * a * 0.25,
    );
    shake.current *= Math.exp(-Math.min(dt, 0.05) * 5);
  });
  return <group ref={ref}>{children}</group>;
}

/** Firelight from a big blaze (an erupting crater), always present so lights never change count. */
export function ActLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const l = ref.current;
    if (!l) return;
    l.intensity = env.actLight * 60;
    l.position.set(...env.actLightPos);
  });
  return <pointLight ref={ref} color="#ff6a28" distance={60} decay={1.2} intensity={0} />;
}
