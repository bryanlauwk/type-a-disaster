import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { seasonOf } from "@/lib/island/sim";
import { geography } from "@/lib/island/terrain";
import { LANDMARK_NAMES, REGION_TITLES } from "@/lib/island/names";
import { wx, wz, type RegionId, type WorldState } from "@/lib/island/types";
import { IslandSky } from "./IslandSky";
import { Terrain } from "./Terrain";
import { FreshWater, Lava, Sea, Waterfalls } from "./Waters";
import { Vegetation } from "./Vegetation";
import { Landmarks } from "./Landmarks";
import { Dinos, lifeBus } from "./Dinos";
import { People, Structures } from "./Settlement";
import {
  ActCamera,
  ActSpectacle,
  Shaker,
  TileFires,
  flash,
  type ActRun,
  type TileReveal,
} from "./Acts";
import { heightAt } from "./palette";
import { PhotoSky } from "./fx/PhotoSky";
import { PostFX } from "./fx/PostFX";
import { LabelOverlay, LabelProjector, type LabelRegistry, type LabelSpec } from "./fx/Labels";

export type { ActRun, TileReveal };

export interface SimClock {
  tickAt: number;
  dayMs: number;
  paused: boolean;
}

const OPENING_CAMERA: [number, number, number] = [26, 44, 50];

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
}

/** Keeps the camera over the island. */
function CameraBounds() {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  useFrame(() => {
    if (!controls) return;
    const t = controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > 30) t.multiplyScalar(30 / r);
    t.y = Math.max(0, Math.min(6, t.y));
  });
  return null;
}

/**
 * ?look=<species> in the URL keeps the camera on one animal of that kind:
 * handy for checking how the animals look and move up close.
 */
function LookAt({ sp }: { sp: string }) {
  const controls = useThree((st) => st.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((st) => st.camera);
  const dist = Number(new URLSearchParams(window.location.search).get("dist") || 0);
  useFrame(() => {
    const a = lifeBus.agents.find((o) => o.sp === sp && o.state !== "dead" && !o.young);
    if (!a || !controls) return;
    const d = dist || 6;
    controls.target.set(a.x, a.y + 0.6, a.z);
    const h = Number(new URLSearchParams(window.location.search).get("h") || 0.45);
    camera.position.set(a.x + d * 0.8, a.y + d * h, a.z + d * 0.6);
    controls.update();
  });
  return null;
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
  const frozen = useRef(0);
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
        near: 34,
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
        far: 36,
      });
    });
    return out;
    // Landmarks don't move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.seed]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={small ? false : "percentage"}
        dpr={[1, small || fx ? 1.5 : 2]}
        camera={{ position: openingCamera(), fov: 40, near: 0.1, far: 400 }}
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
          <Terrain tiles={world.tiles} onPick={onPick} onHover={onHover} />
          <Sea tiles={world.tiles} />
          <FreshWater tiles={world.tiles} />
          <Lava tiles={world.tiles} />
          <Waterfalls tiles={world.tiles} />
          {!noVeg && <Vegetation tiles={world.tiles} dry={dry} />}
          <Landmarks tiles={world.tiles} day={world.day} ash={w.ash > 0} />
          <Structures world={world} />
          <People world={world} />
          <Dinos world={world} getPhase={getPhase} />
          <TileFires tiles={world.tiles} />
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
        <OrbitControls
          makeDefault
          enablePan
          screenSpacePanning={false}
          minDistance={3}
          maxDistance={140}
          maxPolarAngle={1.35}
          minPolarAngle={0.2}
          target={[0, 0, 2]}
        />
        <CameraBounds />
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
    </div>
  );
}

export default memo(IslandScene);
