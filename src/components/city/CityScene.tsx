import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { CityState } from "@/lib/city/types";
import { TownBuildings } from "./scene/Buildings";
import { createBus, hash, type WorldBus } from "./scene/common";
import { env } from "./scene/env";
import { Crossings, Ground, StreetLamps, Trees } from "./scene/Ground";
import { TownProps } from "./scene/TownProps";
import { preloadActorTextures } from "./scene/textures";
import { Life } from "./scene/Life";
import { PhotoSky } from "./scene/PhotoSky";
import { PostFX } from "./scene/PostFX";
import { Railroad } from "./scene/Railroad";
import { Sky } from "./scene/Sky";
import { SpectacleView, impactTime, type SpectacleRun } from "./scene/Spectacle";
import { TileFx, landmarkLabelSpecs } from "./scene/TileFx";
import type { TileHit } from "./scene/ripple";
import { LabelOverlay, LabelProjector, type LabelRegistry, type LabelSpec } from "./scene/Labels";
import { RiftLeak, UpsideDownWorld } from "./scene/UpsideDown";

export type { SpectacleRun, TileHit };

/** Vertical gap between the town and the Upside Down hanging beneath it. */
const GAP = 0.3;
/** How long the screen stays dark while the world turns over. */
const FLIP_MS = 700;

export interface SimClock {
  /** performance.now() of the last daily tick. */
  tickAt: number;
  dayMs: number;
  paused: boolean;
}

/** Shakes everything inside it; any system can add to bus.shake. */
function Shaker({ bus, children }: { bus: WorldBus; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const phase = useRef(0);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const a = bus.shake;
    if (a <= 0.002) {
      g.position.set(0, 0, 0);
      g.rotation.z = 0;
      bus.shake = 0;
      return;
    }
    phase.current += Math.min(dt, 0.05) * 34;
    g.position.set(
      Math.sin(phase.current * 1.7) * a * 0.46,
      Math.cos(phase.current * 2.1) * a * 0.16,
      Math.sin(phase.current * 1.3 + 1) * a * 0.38,
    );
    g.rotation.z = Math.sin(phase.current * 1.2) * a * 0.006;
    bus.shake *= Math.exp(-Math.min(dt, 0.05) * 7);
  });
  return <group ref={ref}>{children}</group>;
}

// Opening shot: looking north over Main Street towards Elm Street and the lab.
const OPENING_TARGET = [0, 0, -1] as const;
const OPENING_CAMERA: [number, number, number] = [-5, 14, 20];

/**
 * Key and rim light on the action. They stay mounted at zero brightness
 * between events: adding or removing a light changes the scene's light count,
 * which makes three.js recompile every lit material right as an event starts.
 */
function ActionLights({ run }: { run: SpectacleRun | null }) {
  const key = useRef<THREE.PointLight>(null);
  const rim = useRef<THREE.PointLight>(null);
  useFrame((_, dt) => {
    const blend = Math.min(1, dt * 4);
    const on = run ? 1 : 0;
    if (run) {
      key.current?.position.set(run.focus.x + 3, 7, run.focus.z + 4);
      rim.current?.position.set(run.focus.x - 4, 6, run.focus.z - 3);
    }
    if (key.current)
      key.current.intensity += (on * (env.night ? 45 : 17) - key.current.intensity) * blend;
    if (rim.current)
      rim.current.intensity += (on * (env.night ? 28 : 10) - rim.current.intensity) * blend;
  });
  return (
    <>
      <pointLight ref={key} color="#ffe4bd" intensity={0} distance={16} decay={2} />
      <pointLight ref={rim} color="#a4c9f3" intensity={0} distance={14} decay={2} />
    </>
  );
}

// Looking north across the Upside Down to the woods, where something stands in the fog.
const UPSIDE_TARGET = new THREE.Vector3(0, 1.5, -6);
const UPSIDE_CAMERA = new THREE.Vector3(-3, 5.5, 15);

/**
 * Swoops the camera toward the action when a spectacle starts, and down to a
 * low, eerie angle (and back) when the world flips.
 */
function CameraDirector({ run, flipped }: { run: SpectacleRun | null; flipped: boolean }) {
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const camera = useThree((s) => s.camera);
  const clock = useThree((s) => s.clock);
  const move = useRef<{
    start: number;
    fromTarget: THREE.Vector3;
    fromPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    offset: THREE.Vector3;
  } | null>(null);
  const follow = useRef<{
    /** Seconds into the spectacle, stepped like its own clock. */
    t: number;
    x: number;
    z: number;
    impact: number;
    focus: { x: number; z: number };
  } | null>(null);
  const subject = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);

  const framed = useRef(false);
  useEffect(() => {
    if (!controls || framed.current) return;
    framed.current = true;
    controls.target.set(OPENING_TARGET[0], 0, OPENING_TARGET[2]);
    controls.update();
  }, [controls]);

  const firstFlip = useRef(true);
  useEffect(() => {
    if (!controls) return;
    // Skip the first render: only an actual flip moves the camera.
    if (firstFlip.current) {
      firstFlip.current = false;
      if (!flipped) return;
    }
    move.current = {
      start: clock.elapsedTime,
      fromTarget: controls.target.clone(),
      fromPos: camera.position.clone(),
      toTarget: flipped
        ? UPSIDE_TARGET.clone()
        : new THREE.Vector3(OPENING_TARGET[0], 0, OPENING_TARGET[2]),
      toPos: flipped ? UPSIDE_CAMERA.clone() : new THREE.Vector3(...OPENING_CAMERA),
      offset: new THREE.Vector3(),
    };
  }, [flipped, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!run || !controls) {
      follow.current = null;
      return;
    }
    const size = Math.max(1, run.actors[0]?.size ?? 1);
    const toTarget = new THREE.Vector3(run.focus.x, Math.min(1.5, size * 0.3), run.focus.z);
    // Come in close and fairly steep, from the south-east, so towers don't
    // hide the action.
    const offset = new THREE.Vector3(4 + size * 0.15, 6 + size * 0.25, 5 + size * 0.15);
    const toPos = toTarget.clone().add(offset);
    move.current = {
      start: clock.elapsedTime,
      fromTarget: controls.target.clone(),
      fromPos: camera.position.clone(),
      toTarget,
      toPos,
      offset,
    };
    const kind = run.actors[0]?.kind;
    if (kind === "shadow") {
      // Get down low and look past the focus to where it rises (the same
      // direction the Shadow actor picks for itself).
      const angle = hash(run.id * 31, 23) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      move.current.toTarget = new THREE.Vector3(run.focus.x, 3, run.focus.z).addScaledVector(
        dir,
        6,
      );
      move.current.toPos = new THREE.Vector3(run.focus.x, 3.5, run.focus.z).addScaledVector(
        dir,
        -10,
      );
      follow.current = null;
      return;
    }
    if (kind === "kaiju" || kind === "creature") {
      const angle = run.heading ?? hash(run.id * 31, 7) * Math.PI * 2;
      follow.current = {
        t: 0,
        x: Math.cos(angle),
        z: Math.sin(angle),
        impact: impactTime(run.actors),
        focus: run.focus,
      };
    } else follow.current = null;
  }, [run?.id, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock: c }, dt) => {
    const m = move.current;
    if (!controls) return;
    const tracking = follow.current;
    if (tracking) {
      // Same stepped clock as the spectacle, so a slow frame can't leave the
      // camera ahead of the kaiju it's following.
      tracking.t += Math.min(dt, 0.1);
      const t = tracking.t;
      const pause = 2.5;
      const off =
        t < tracking.impact
          ? 16 * (1 - t / tracking.impact)
          : t < tracking.impact + pause
            ? 0
            : -16 * ((t - tracking.impact - pause) / (10 - pause));
      const limited = Math.max(-12, Math.min(12, off));
      subject.set(
        tracking.focus.x + tracking.x * limited,
        controls.target.y,
        tracking.focus.z + tracking.z * limited,
      );
      if (m) {
        m.toTarget.x = subject.x;
        m.toTarget.z = subject.z;
        m.toPos.copy(m.toTarget).add(m.offset);
      } else {
        delta.subVectors(subject, controls.target).multiplyScalar(1 - Math.exp(-dt * 2.5));
        controls.target.add(delta);
        camera.position.add(delta);
        controls.update();
      }
    }
    if (!m) return;
    const k = Math.min(1, (c.elapsedTime - m.start) / 2.4);
    const e = k * k * k * (k * (k * 6 - 15) + 10);
    controls.target.lerpVectors(m.fromTarget, m.toTarget, e);
    camera.position.lerpVectors(m.fromPos, m.toPos, e);
    controls.update();
    if (k >= 1) move.current = null;
  });
  return null;
}

export interface CitySceneProps {
  city: CityState;
  clock: SimClock;
  spectacle: SpectacleRun | null;
  onImpact: (id: number) => void;
  onReveal?: (id: number, hits: TileHit[]) => void;
  onSpectacleDone: (id: number) => void;
  /** Bumped when a chain-reaction bulletin fires, for a small tremor. */
  tremor: number;
  showLabels: boolean;
  /** Show the Upside Down instead of the town. */
  upsideDown: boolean;
}

function CityScene({
  city,
  clock,
  spectacle,
  onImpact,
  onReveal,
  onSpectacleDone,
  tremor,
  showLabels,
  upsideDown,
}: CitySceneProps) {
  const small = typeof window !== "undefined" && window.innerWidth < 640;
  // Post-processing is for larger screens; "?fx=0" turns it off on slow GPUs.
  const [fx, setFx] = useState(
    () => !small && typeof window !== "undefined" && !/[?&]fx=0\b/.test(window.location.search),
  );
  // Watch the frame rate once loading has settled; a GPU that can't keep up
  // drops the post-processing rather than the whole experience.
  const [watchFps, setWatchFps] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setWatchFps(true), 6000);
    return () => clearTimeout(id);
  }, []);
  const bus = useMemo(createBus, []);
  // Flipping to the Upside Down: the screen goes dark, the world turns over
  // underneath, and it fades back in on the other side.
  const [flipped, setFlipped] = useState(upsideDown);
  const flippedRef = useRef(upsideDown);
  const [everFlipped, setEverFlipped] = useState(upsideDown);
  const [curtain, setCurtain] = useState(false);
  useEffect(() => {
    // Toggled back before the turn: just lift the curtain again.
    if (upsideDown === flippedRef.current) {
      setCurtain(false);
      return;
    }
    setCurtain(true);
    bus.shake = Math.max(bus.shake, 0.08);
    const turn = setTimeout(() => {
      flippedRef.current = upsideDown;
      setFlipped(upsideDown);
      if (upsideDown) setEverFlipped(true);
    }, FLIP_MS / 2);
    const open = setTimeout(() => setCurtain(false), FLIP_MS);
    return () => {
      clearTimeout(turn);
      clearTimeout(open);
    };
  }, [upsideDown, bus]);
  // Fetch actor textures in the background once the city is up, so the
  // first whale or kaiju of the session doesn't wait on a download.
  useEffect(() => {
    const id = setTimeout(preloadActorTextures, 2500);
    return () => clearTimeout(id);
  }, []);
  const registry = useRef<LabelRegistry>(new Map());
  const landmarkLabels = useMemo(() => landmarkLabelSpecs(city.grid), [city.grid]);
  const labels = useMemo<LabelSpec[]>(() => {
    const text = spectacle?.actors
      .map((a) => a.label)
      .filter(Boolean)
      .join(" · ");
    if (!spectacle || !text) return landmarkLabels;
    return [
      ...landmarkLabels,
      {
        key: `action-${spectacle.id}`,
        x: spectacle.focus.x,
        y: 3.2,
        z: spectacle.focus.z,
        text,
        variant: "action",
      },
    ];
  }, [landmarkLabels, spectacle]);
  const clockRef = useRef(clock);
  const frozen = useRef(0);
  if (clock.paused && !clockRef.current.paused) {
    frozen.current = Math.min(
      1,
      (performance.now() - clockRef.current.tickAt) / clockRef.current.dayMs,
    );
  }
  clockRef.current = clock;
  const getPhase = () => {
    const c = clockRef.current;
    if (c.paused) return frozen.current;
    return Math.min(1, Math.max(0, (performance.now() - c.tickAt) / c.dayMs));
  };

  useEffect(() => {
    if (tremor) bus.shake = Math.max(bus.shake, 0.06);
  }, [tremor, bus]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows={small ? false : "percentage"}
        dpr={[1, small || fx ? 1.5 : 2]}
        camera={{ position: OPENING_CAMERA, fov: 40, far: 200 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          powerPreference: "high-performance",
        }}
      >
        <Sky
          seed={city.seed}
          day={city.day}
          rift={city.stats.rift}
          upside={flipped}
          pollution={city.stats.pollution}
          getPhase={getPhase}
          bus={bus}
          shadows={!small}
        />
        <ActionLights run={spectacle} />
        {/* The photographed sky streams in after the city; until then <Sky>'s colour shows. */}
        <Suspense fallback={null}>
          <PhotoSky />
        </Suspense>
        <Shaker bus={bus}>
          {/* The world turns over about a line just under the ground. */}
          <group position-y={-GAP / 2}>
            <group rotation-x={flipped ? Math.PI : 0}>
              <group position-y={GAP / 2}>
                <group visible={!flipped}>
                  <Ground grid={city.grid} />
                  <Trees grid={city.grid} />
                  <Crossings grid={city.grid} />
                  <StreetLamps grid={city.grid} />
                  <TownProps grid={city.grid} />
                  <TownBuildings grid={city.grid} />
                  <TileFx grid={city.grid} />
                  <Railroad grid={city.grid} bus={bus} />
                  <Life city={city} bus={bus} />
                  <RiftLeak grid={city.grid} rift={city.stats.rift} />
                </group>
                {everFlipped && (
                  <group position-y={-GAP} rotation-x={Math.PI} visible={flipped}>
                    <UpsideDownWorld grid={city.grid} />
                  </group>
                )}
              </group>
            </group>
          </group>
          {spectacle && (
            <SpectacleView
              key={spectacle.id}
              run={spectacle}
              bus={bus}
              onImpact={onImpact}
              onReveal={onReveal}
              onDone={onSpectacleDone}
            />
          )}
        </Shaker>
        <CameraDirector run={spectacle} flipped={flipped} />
        <OrbitControls
          makeDefault
          enablePan
          screenSpacePanning={false}
          minDistance={5}
          maxDistance={55}
          maxPolarAngle={1.42}
          minPolarAngle={0.3}
        />
        <LabelProjector specs={labels} registry={registry} />
        {fx && <PostFX />}
        {fx && watchFps && (
          <PerformanceMonitor
            bounds={() => [28, 55]}
            flipflops={1}
            onDecline={() => setFx(false)}
          />
        )}
      </Canvas>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle,#3a0508_0%,#000_70%)] transition-opacity ${
          curtain ? "opacity-100" : "opacity-0"
        }`}
        style={{ transitionDuration: `${FLIP_MS / 2}ms` }}
      />
      <LabelOverlay specs={labels} registry={registry} showLandmarks={showLabels && !spectacle} />
    </div>
  );
}

export default memo(CityScene);
