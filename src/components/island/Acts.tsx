import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { tx, ty, wx, wz, type ActionRecord, type Tile, type WorldState } from "@/lib/island/types";
import { heightAt } from "./palette";
import { lifeBus } from "./Dinos";
import { Puffs } from "./fx/vfx";

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
  const order = new Map<number, number>();
  (impact?.tiles ?? []).forEach((i, k) => order.set(i, k));
  const at = (i: number): number => {
    const k = order.get(i);
    switch (record.power) {
      case "eruption":
        return 1.8 + (k ?? 20) * 0.05;
      case "meteor":
        return 2.1 + dist(i, record.tile) * 0.08;
      case "tsunami": {
        const o = impact?.origin ?? record.tile;
        const along =
          (tx(i) - tx(o)) * Math.cos(impact?.angle ?? 0) +
          (ty(i) - ty(o)) * Math.sin(impact?.angle ?? 0);
        return 1 + Math.max(0, along) / 6;
      }
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

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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

/** The volcano throws out burning rocks while the lava runs. */
function Eruption({ tiles, getT }: { tiles: Tile[]; getT: () => number }) {
  const crater = tiles.findIndex((t) => t.landmark === "great_volcano");
  const x = wx(crater);
  const z = wz(crater);
  const y = tiles[crater].h;
  const bombs = useRef<THREE.InstancedMesh>(null);
  const shots = useMemo(
    () =>
      Array.from({ length: 36 }, (_, k) => ({
        a: hash(k, 1) * Math.PI * 2,
        v: 4 + hash(k, 2) * 6,
        up: 9 + hash(k, 3) * 7,
        t0: 1 + hash(k, 4) * 4,
      })),
    [],
  );
  useFrame(() => {
    const t = getT();
    const m = bombs.current;
    if (!m) return;
    shots.forEach((s, k) => {
      const lt = t - s.t0;
      if (lt < 0 || lt > 2.2) {
        m.setMatrixAt(k, HIDDEN);
        return;
      }
      tmpP.set(
        x + Math.cos(s.a) * s.v * lt,
        y + s.up * lt - 9.8 * lt * lt * 0.5,
        z + Math.sin(s.a) * s.v * lt,
      );
      tmpM.compose(tmpP, tmpQ.setFromEuler(tmpE.set(lt * 3, lt * 2, 0)), tmpS.setScalar(0.25));
      m.setMatrixAt(k, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={bombs} args={[undefined, undefined, shots.length]} frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#2a1a14" emissive="#ff5a1a" emissiveIntensity={2} />
      </instancedMesh>
      <Puffs
        getT={getT}
        origin={[x, y + 0.5, z]}
        count={120}
        duration={8}
        stagger={4}
        spread={4}
        rise={16}
        size={[2, 6]}
        color="#2f2926"
        opacity={0.85}
        seed={7}
      />
      <Puffs
        getT={getT}
        origin={[x, y, z]}
        count={50}
        duration={1.4}
        stagger={4}
        spread={1.6}
        rise={4}
        size={[0.8, 2.4]}
        color="#ff6a1a"
        opacity={0.9}
        additive
        seed={8}
      />
    </>
  );
}

/** The wall of water: a foaming crest running inland. */
function Tsunami({ run, getT }: { run: ActRun; getT: () => number }) {
  const impact = run.record.impact!;
  const origin = impact.origin ?? run.record.tile;
  const angle = impact.angle;
  const crest = useRef<THREE.Group>(null);
  const len = dist(origin, run.record.tile) + 4;
  useFrame(() => {
    const t = getT();
    const g = crest.current;
    if (!g) return;
    const along = Math.max(0, (t - 1) * 6);
    g.visible = t > 0.2 && along < len + 1;
    const x = wx(origin) + Math.cos(angle) * along;
    const z = wz(origin) + Math.sin(angle) * along;
    g.position.set(x, 0, z);
    g.rotation.y = -angle;
    const width = 6 + along * 0.7;
    g.scale.set(1, Math.max(0.2, 1.6 - along / (len + 2)), width);
  });
  return (
    <group ref={crest}>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.8, 1.2, 1]} />
        <meshStandardMaterial color="#3f8c96" transparent opacity={0.85} roughness={0.2} />
      </mesh>
      <mesh position={[0.25, 1.15, 0]}>
        <boxGeometry args={[0.4, 0.25, 1.02]} />
        <meshStandardMaterial color="#f3f8f6" roughness={0.6} />
      </mesh>
      <Puffs
        getT={getT}
        origin={[0.2, 1.1, 0]}
        count={50}
        duration={1}
        spread={0.5}
        rise={1.2}
        fall={2}
        size={[0.2, 0.7]}
        color="#f4fafa"
        opacity={0.85}
        loop
        seed={9}
      />
    </group>
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
  const total = actLength(reveal);
  const power = run.record.power;
  const x = wx(run.record.tile);
  const z = wz(run.record.tile);
  const y = heightAt(run.before.tiles, x, z);

  useFrame((_, dt) => {
    if (t0.current === null) t0.current = 0;
    else elapsed.current += Math.min(dt, 0.1);
    const t = elapsed.current;
    // Ground shaking for the violent ones.
    if (power === "earthquake" && t < 4) shake.current = Math.max(shake.current, 0.25);
    if (power === "eruption" && t > 0.5 && t < 5) shake.current = Math.max(shake.current, 0.12);
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
      return <Eruption tiles={run.before.tiles} getT={getT} />;
    case "tsunami":
      return <Tsunami run={run} getT={getT} />;
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
    const focus =
      p === "eruption"
        ? run.before.tiles.findIndex((t) => t.landmark === "great_volcano")
        : p === "raid"
          ? run.before.tribe.home
          : run.record.tile;
    const x = wx(focus);
    const z = wz(focus);
    const y = heightAt(run.before.tiles, x, z);
    const far = p === "eruption" ? 34 : p === "tsunami" || p === "storm" ? 26 : 18;
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
