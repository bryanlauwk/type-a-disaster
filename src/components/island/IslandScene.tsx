import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { seasonOf } from "@/lib/island/sim";
import { geography } from "@/lib/island/terrain";
import { LANDMARK_NAMES, REGION_TITLES } from "@/lib/island/names";
import {
  HALF,
  wx,
  wz,
  type RegionId,
  type SpeciesId,
  type Tile,
  type WorldState,
} from "@/lib/island/types";
import { IslandSky } from "./IslandSky";
import { Terrain } from "./Terrain";
import { FreshWater, Lava, Sea, Waterfalls } from "./Waters";
import { Vegetation } from "./Vegetation";
import { Landmarks } from "./Landmarks";
import { lifeBus } from "./lifeBus";
import { Dinos } from "./Dinos";
import { People, Structures } from "./Settlement";
import {
  ActCamera,
  ActLight,
  ActSpectacle,
  Shaker,
  TileFires,
  flash,
  type ActRun,
  type TileReveal,
} from "./Acts";
import { heightAt } from "./palette";
import { PhotoSky } from "./fx/PhotoSky";
import { eruptBus } from "./Eruption";
import { FORMS } from "./dinoForms";
import { Zones, restrictedMarker } from "./Zones";
import { Surroundings } from "./Surroundings";
import { Park, parkLayout } from "./Park";
import { PropField, naturePlacements } from "./Props";
import { DustPool } from "./fx/dust";
import { env } from "./fx/env";
import { PostFX } from "./fx/PostFX";
import { LabelOverlay, LabelProjector, type LabelRegistry, type LabelSpec } from "./fx/Labels";

export type { ActRun, TileReveal };

export interface SimClock {
  tickAt: number;
  dayMs: number;
  paused: boolean;
}

const OPENING_CAMERA: [number, number, number] = [34, 104, 104];

/** Tall phone screens need to stand further back to see the whole island. */
function openingCamera(): [number, number, number] {
  if (typeof window === "undefined") return OPENING_CAMERA;
  const k = Math.min(1.9, Math.max(1, 1.2 / (window.innerWidth / window.innerHeight)));
  return OPENING_CAMERA.map((v) => v * k) as [number, number, number];
}

/** Where the god's hand would land, and how wide. */
export interface Cursor {
  tile: number;
  radius: number;
  color: string;
}

export interface IslandSceneProps {
  world: WorldState;
  clock: SimClock;
  onPick?: (tile: number, e: ThreeEvent<MouseEvent>) => void;
  onHover?: (tile: number) => void;
  cursor?: Cursor | null;
  showLabels?: boolean;
  act?: ActRun | null;
  reveal?: TileReveal[];
  onReveal?: (tiles: number[]) => void;
  onActDone?: () => void;
  /** Show the island as the park map: dark blue, contours, glowing zones. */
  mapView?: boolean;
  /** Keep the camera locked on one living animal (the Follow button). */
  follow?: number | null;
  /** Fly the camera to a tile; changing `stamp` triggers the flight. */
  focus?: { tile: number; stamp: number } | null;
}

/**
 * Fades the park map in and out, and flies the camera up to take in the
 * whole island (and back to where it was) when it's switched.
 */
function MapMode({ on }: { on: boolean }) {
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const saved = useRef<{ p: THREE.Vector3; t: THREE.Vector3 } | null>(null);
  const fly = useRef<{
    k: number;
    fromP: THREE.Vector3;
    fromT: THREE.Vector3;
    toP: THREE.Vector3;
    toT: THREE.Vector3;
  } | null>(null);
  useEffect(() => {
    if (!controls) return;
    if (on) {
      saved.current = { p: camera.position.clone(), t: controls.target.clone() };
      fly.current = {
        k: 0,
        fromP: camera.position.clone(),
        fromT: controls.target.clone(),
        toP: new THREE.Vector3(0, 185, 88),
        toT: new THREE.Vector3(0, 0, -2),
      };
    } else if (saved.current) {
      fly.current = {
        k: 0,
        fromP: camera.position.clone(),
        fromT: controls.target.clone(),
        toP: saved.current.p,
        toT: saved.current.t,
      };
      saved.current = null;
    }
  }, [on, controls]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((_, dt) => {
    env.blueprint += ((on ? 1 : 0) - env.blueprint) * Math.min(1, dt * 2.5);
    if (Math.abs(env.blueprint - (on ? 1 : 0)) < 0.002) env.blueprint = on ? 1 : 0;
    const f = fly.current;
    if (!f || !controls) return;
    f.k = Math.min(1, f.k + dt / 1.4);
    const e = f.k * f.k * (3 - 2 * f.k);
    camera.position.lerpVectors(f.fromP, f.toP, e);
    controls.target.lerpVectors(f.fromT, f.toT, e);
    controls.update();
    if (f.k >= 1) fly.current = null;
  });
  return null;
}

/** Keeps the camera over the island. */
function CameraBounds() {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  useFrame(() => {
    if (!controls) return;
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > HALF - 4) t.multiplyScalar((HALF - 4) / r);
    // An eruption's column needs the camera to look up.
    t.y = Math.max(0, Math.min(eruptBus.active ? 30 : 8, t.y));
  });
  return null;
}

/**
 * ?look=<species> in the URL keeps the camera on one animal of that kind:
 * handy for checking how the animals look and move up close.
 */
function DebugCamera({ spec }: { spec: string }) {
  const controls = useThree((st) => st.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((st) => st.camera);
  const done = useRef(0);
  useFrame(() => {
    if (!controls || done.current > 3) return;
    const [x, y, z, tx, ty, tz] = spec.split(",").map(Number);
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    controls.update();
    done.current++;
  });
  return null;
}

function LookAt({ sp, id }: { sp?: string; id?: number }) {
  const controls = useThree((st) => st.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((st) => st.camera);
  const dist = Number(new URLSearchParams(window.location.search).get("dist") || 0);
  useFrame(() => {
    const a = lifeBus.agents.find((o) =>
      id !== undefined
        ? o.id === id && o.state !== "dead"
        : (o.sp === sp || FORMS[o.sp][o.form].key === sp) && o.state !== "dead" && !o.young,
    );
    if (!a || !controls) return;
    const d = dist || 6;
    controls.target.set(a.x, a.y + Math.min(0.6, d * 0.08), a.z);
    const h = Number(new URLSearchParams(window.location.search).get("h") || 0.45);
    camera.position.set(a.x + d * 0.8, a.y + d * h, a.z + d * 0.6);
    controls.update();
  });
  return null;
}

/** Flies the camera over to a tile when a notice or an almanac entry is tapped. */
function FocusOn({ focus }: { focus: IslandSceneProps["focus"] }) {
  const controls = useThree((st) => st.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((st) => st.camera);
  const fly = useRef<{
    k: number;
    fromP: THREE.Vector3;
    fromT: THREE.Vector3;
    toP: THREE.Vector3;
    toT: THREE.Vector3;
  } | null>(null);
  const seen = useRef(-1);
  useEffect(() => {
    if (!controls || !focus || focus.stamp === seen.current) return;
    seen.current = focus.stamp;
    const toT = new THREE.Vector3(wx(focus.tile), 1.5, wz(focus.tile));
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.min(offset.length(), 55));
    fly.current = {
      k: 0,
      fromP: camera.position.clone(),
      fromT: controls.target.clone(),
      toP: toT.clone().add(offset),
      toT,
    };
  }, [focus, controls, camera]);
  useFrame((_, dt) => {
    const f = fly.current;
    if (!f || !controls) return;
    f.k = Math.min(1, f.k + dt / 1.2);
    const e = f.k * f.k * (3 - 2 * f.k);
    camera.position.lerpVectors(f.fromP, f.toP, e);
    controls.target.lerpVectors(f.fromT, f.toT, e);
    controls.update();
    if (f.k >= 1) fly.current = null;
  });
  return null;
}

/** Bones on tiles where kills or disasters left a carcass. */
function Carcasses({ tiles }: { tiles: Tile[] }) {
  const list = useMemo(() => {
    const out: { x: number; y: number; z: number; s: number; r: number }[] = [];
    tiles.forEach((t, i) => {
      if (!t.carcass || t.water) return;
      const x = wx(i);
      const z = wz(i);
      out.push({
        x,
        y: Math.max(0, heightAt(tiles, x, z)) + 0.1,
        z,
        s: Math.min(1.8, 0.7 + t.carcass * 0.4),
        r: i,
      });
    });
    return out;
  }, [tiles]);
  if (!list.length) return null;
  return (
    <group>
      {list.map((c, i) => (
        <mesh
          key={i}
          position={[c.x, c.y, c.z]}
          rotation={[-Math.PI / 2.2, (c.r % 7) * 0.9, (c.r % 5) * 1.1]}
          scale={[c.s, c.s * 0.35, c.s * 0.55]}
        >
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color="#cfc5ab" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** A glowing ring on the ground where a power would land. */
function CursorRing({ cursor, world }: { cursor: Cursor; world: WorldState }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const x = wx(cursor.tile);
    const z = wz(cursor.tile);
    m.position.set(x, Math.max(0, heightAt(world.tiles, x, z)) + 0.25, z);
    m.scale.setScalar(cursor.radius * (1 + Math.sin(clock.elapsedTime * 4) * 0.04));
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} renderOrder={5}>
      <ringGeometry args={[0.88, 1, 48]} />
      <meshBasicMaterial
        color={cursor.color}
        transparent
        opacity={0.85}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function IslandScene({
  world,
  clock,
  onPick,
  onHover,
  cursor,
  showLabels = true,
  act,
  reveal,
  onReveal,
  onActDone,
  mapView = false,
  follow = null,
  focus = null,
}: IslandSceneProps) {
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  const [fx, setFx] = useState(
    () => !small && typeof window !== "undefined" && !/[?&]fx=0\b/.test(window.location.search),
  );
  const [watchFps, setWatchFps] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWatchFps(true), 6000);
    return () => clearTimeout(id);
  }, []);
  const clockRef = useRef(clock);
  // Before the first day starts (and while paused from the start) it is late morning.
  const frozen = useRef(0.3);
  if (clock.paused && !clockRef.current.paused)
    frozen.current = Math.min(
      1,
      (performance.now() - clockRef.current.tickAt) / clockRef.current.dayMs,
    );
  clockRef.current = clock;
  const getPhase = () => {
    const c = clockRef.current;
    if (c.paused) return frozen.current;
    return Math.min(1, Math.max(0, (performance.now() - c.tickAt) / c.dayMs));
  };
  const shake = useRef(0);
  const [noVeg] = useState(
    () => typeof window !== "undefined" && /[?&]veg=0\b/.test(window.location.search),
  );
  const [camSpec] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("cam"),
  );
  const [lookAt] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("look"),
  );
  const w = world.weather;
  const weather = useMemo(
    () => ({
      raining: w.rain > 0 || (seasonOf(world.day) === "wet" && world.day % 3 === 0),
      storm: w.storm > 0 || act?.record.power === "storm",
      ash: w.ash > 0,
      drought: w.drought > 0,
    }),
    [w.rain, w.storm, w.ash, w.drought, world.day, act],
  );
  const dry = seasonOf(world.day) === "dry" && world.day % 40 > 24;
  // While a tsunami plays, its own surge is drawn by the act.
  const floodShown = useMemo(
    () => (act?.record.power === "tsunami" ? new Set(act.record.impact?.tiles ?? []) : undefined),
    [act],
  );
  // While an eruption plays, its own lava is drawn by the act.
  const lavaShown = useMemo(
    () => (act?.record.power === "eruption" ? new Set(act.record.impact?.tiles ?? []) : undefined),
    [act],
  );

  const registry = useRef<LabelRegistry>(new Map());
  const baseLabels = useMemo<LabelSpec[]>(() => {
    const geo = geography(world);
    const out: LabelSpec[] = [];
    for (const [r, title] of Object.entries(REGION_TITLES) as [RegionId, string][]) {
      const i = geo.centre[r];
      out.push({
        key: `r-${r}`,
        x: wx(i),
        y: heightAt(world.tiles, wx(i), wz(i)) + 2.5,
        z: wz(i),
        text: title,
        variant: "region",
        near: 60,
      });
    }
    world.tiles.forEach((t, i) => {
      if (!t.landmark) return;
      out.push({
        key: `l-${t.landmark}`,
        x: wx(i),
        y: heightAt(world.tiles, wx(i), wz(i)) + (t.landmark === "great_volcano" ? 2 : 1.4),
        z: wz(i),
        text: LANDMARK_NAMES[t.landmark],
        variant: "landmark",
        far: 60,
      });
    });
    const warn = restrictedMarker(world.tiles);
    if (warn)
      out.push({
        key: "restricted",
        ...warn,
        text: "⚠ Restricted area",
        variant: "landmark",
        far: 90,
      });
    return out;
    // Landmarks don't move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.seed]);

  // The trails, the old park and the rocks only change when the ground itself does.
  let groundKey = world.seed;
  for (let i = 0; i < world.tiles.length; i += 7)
    groundKey =
      (groundKey * 31 + Math.round(world.tiles[i].h * 20) + (world.tiles[i].lava ? 7 : 0)) | 0;
  const park = useMemo(() => parkLayout(world.tiles), [groundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const nature = useMemo(
    () => naturePlacements(world.tiles, world.seed, park.clear),
    [park], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={small ? false : "percentage"}
        dpr={[1, small || fx ? 1.5 : 2]}
        camera={{ position: openingCamera(), fov: 40, near: 0.1, far: 800 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          powerPreference: "high-performance",
        }}
      >
        <IslandSky
          seed={world.seed}
          getPhase={getPhase}
          weather={weather}
          shadows={!small}
          flashRef={flash}
        />
        <Suspense fallback={null}>
          <PhotoSky />
        </Suspense>
        <Shaker shake={shake}>
          <Terrain tiles={world.tiles} onPick={onPick} onHover={onHover} dry={dry} />
          <Sea tiles={world.tiles} />
          <FreshWater tiles={world.tiles} except={floodShown} />
          <Lava tiles={world.tiles} except={lavaShown} />
          <Waterfalls tiles={world.tiles} />
          {!noVeg && <Vegetation tiles={world.tiles} dry={dry} clear={park.clear} />}
          <Landmarks tiles={world.tiles} day={world.day} ash={w.ash > 0} />
          <Structures world={world} />
          <People world={world} />
          <Dinos world={world} getPhase={getPhase} />
          <TileFires tiles={world.tiles} />
          <Carcasses tiles={world.tiles} />
          <Zones tiles={world.tiles} show={showLabels} />
          <Surroundings tiles={world.tiles} seed={world.seed} />
          <PropField placements={nature} />
          <Park tiles={world.tiles} layout={park} />
          <DustPool />
          <ActLight />
          {act && reveal && (
            <ActSpectacle
              key={act.id}
              run={act}
              reveal={reveal}
              onReveal={(tiles) => onReveal?.(tiles)}
              onDone={() => onActDone?.()}
              shake={shake}
            />
          )}
        </Shaker>
        {cursor && <CursorRing cursor={cursor} world={world} />}
        <ActCamera run={act ?? null} />
        {lookAt && <LookAt sp={lookAt} />}
        {follow !== null && <LookAt id={follow} />}
        {camSpec && <DebugCamera spec={camSpec} />}
        <OrbitControls
          makeDefault
          enablePan
          screenSpacePanning={false}
          minDistance={3}
          maxDistance={230}
          maxPolarAngle={1.35}
          minPolarAngle={0.2}
          target={[0, 0, -6]}
        />
        <CameraBounds />
        <MapMode on={mapView} />
        <FocusOn focus={focus} />
        <LabelProjector specs={baseLabels} registry={registry} />
        {fx && <PostFX />}
        {fx && watchFps && (
          <PerformanceMonitor
            bounds={() => [28, 55]}
            flipflops={1}
            onDecline={() => setFx(false)}
          />
        )}
      </Canvas>
      <LabelOverlay specs={baseLabels} registry={registry} show={showLabels} />
      {mapView && (
        <div className="pointer-events-none absolute left-3 top-24 z-10 w-52 border border-[#6fe3ff]/40 bg-[#030a16]/80 p-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#9fefff] shadow-[0_0_24px_rgba(111,227,255,0.15)] sm:top-24">
          <p className="text-[11px] text-[#d8fbff]">Primordia · park map</p>
          <p className="mt-0.5 text-[#6fe3ff]/60">Survey grid 8 × 8 · contours 0.5</p>
          <ul className="mt-2 space-y-1 normal-case tracking-normal">
            <li className="flex items-center gap-2">
              <span className="inline-block w-6 border-t-2 border-dashed border-[#6fe3ff]" />
              Zone border
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-6 border-t-2 border-[#ff5a3c]" />
              Restricted: no settling
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block w-6 border-t border-[#6fe3ff]/50" />
              Coast and contours
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default memo(IslandScene);
