import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { env } from "./fx/env";

const DAY = new THREE.Color("#b8d6e8");
const DUSK = new THREE.Color("#f0a266");
const NIGHT = new THREE.Color("#15223c");
const RAIN = new THREE.Color("#7f8c93");
const ASH = new THREE.Color("#8a7563");
const DRY = new THREE.Color("#d8c9a2");
const WHITE = new THREE.Color("#ffffff");

const DROPS = 1400;

/** Hour of day (0–24) for a phase 0..1 of a sim day; daylight takes most of it. */
export const hourOf = (phase: number) =>
  phase < 0.78 ? 6 + (phase / 0.78) * 14 : (20 + ((phase - 0.78) / 0.22) * 10) % 24;
const isNight = (h: number) => h < 6.2 || h > 19.6;

export interface SkyWeather {
  raining: boolean;
  storm: boolean;
  ash: boolean;
  drought: boolean;
}

/**
 * Sun, moon and sky for the island: the day turns, the wet season greys the
 * sky with rain, droughts bleach it, and volcanic ash browns it over. Storms
 * bring lightning.
 */
export function IslandSky({
  seed,
  getPhase,
  weather,
  shadows,
  flashRef,
}: {
  seed: number;
  getPhase: () => number;
  weather: SkyWeather;
  shadows: boolean;
  /** Set to 1 to fire a flash (lightning, a meteor); it fades by itself. */
  flashRef: { current: number };
}) {
  const { scene, gl, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const rain = useRef<THREE.InstancedMesh>(null);
  const clouds = useRef<THREE.InstancedMesh>(null);
  const sky = useMemo(() => new THREE.Color(DAY), []);
  const target = useMemo(() => new THREE.Color(), []);
  const drops = useMemo(
    () =>
      Array.from({ length: DROPS }, (_, k) => ({
        x: (hash(seed, k, 1) - 0.5) * 60,
        y: hash(seed, k, 2) * 22,
        z: (hash(seed, k, 3) - 0.5) * 60,
        cycle: 0,
      })),
    [seed],
  );
  const cloudSpots = useMemo(
    () =>
      Array.from({ length: 22 }, (_, k) => ({
        a: (k / 22) * Math.PI * 2 + hash(seed, k, 11) * 0.5,
        // Clouds frame the island from out over the sea, rather than hide it.
        r: 40 + hash(seed, k, 12) * 40,
        y: 16 + hash(seed, k, 13) * 10,
        s: 3 + hash(seed, k, 14) * 4,
        speed: 0.004 + hash(seed, k, 15) * 0.008,
      })),
    [seed],
  );
  const cloudMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 1,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
    [],
  );
  const m = useMemo(() => new THREE.Matrix4(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  const bolt = useRef(0);
  const nextBolt = useRef(0);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    const w = weatherRef.current;
    const hour = hourOf(getPhase());
    const elev = Math.sin(((hour - 6) / 14) * Math.PI);
    const daylight = Math.max(0, elev);
    const raining = w.raining || w.storm;
    env.hour = hour;
    env.night = isNight(hour);
    env.raining = raining;
    env.daylight = daylight;
    env.dusk = Math.max(0, 1 - Math.abs(elev) * 4);
    env.hazy = w.ash;

    // Lightning in storms.
    if (w.storm && now > nextBolt.current) {
      bolt.current = 1;
      nextBolt.current = now + 0.8 + hash(seed, Math.floor(now * 7)) * 2.4;
    }
    bolt.current = Math.max(0, bolt.current - dt * 4, 0);
    const flash = Math.max(bolt.current, flashRef.current);
    flashRef.current = Math.max(0, flashRef.current - dt * 2.5);
    env.flash = flash;

    target.copy(NIGHT).lerp(DAY, Math.min(1, daylight * 2.4));
    target.lerp(DUSK, env.dusk * 0.6);
    if (raining) target.lerp(RAIN, 0.6 * Math.max(0.3, daylight));
    if (w.drought) target.lerp(DRY, 0.35 * daylight);
    if (w.ash) target.lerp(ASH, 0.6);
    if (flash > 0) target.lerp(WHITE, flash * 0.5);
    sky.lerp(target, Math.min(1, dt * 3));
    scene.background = sky;
    gl.toneMappingExposure +=
      (0.92 + daylight * 0.2 + flash * 0.15 - gl.toneMappingExposure) * Math.min(1, dt * 2);
    if (scene.fog) {
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(sky);
      fog.far = (w.ash ? 70 : raining ? 110 : 170) + camera.position.length() * 0.3;
      fog.near = fog.far * 0.45;
    }

    // The sun crosses from east to west over the island.
    const az = ((hour - 6) / 14) * Math.PI;
    if (sun.current) {
      sun.current.position.set(Math.cos(az) * 40, 6 + daylight * 44, 18 + Math.sin(az) * 8);
      sun.current.intensity =
        (0.05 + daylight * 2.3) * (raining ? 0.4 : 1) * (w.ash ? 0.55 : 1) + flash * 2;
      sun.current.color.setHSL(0.08, 0.75, 0.6 + daylight * 0.33);
      if (w.ash) sun.current.color.lerp(new THREE.Color("#ff9a5a"), 0.4);
    }
    if (hemi.current) {
      hemi.current.intensity = (0.45 + daylight * 0.35) * (raining ? 0.8 : 1) + flash * 1.2;
      hemi.current.color.setHSL(env.night ? 0.62 : 0.12, 0.45, env.night ? 0.5 : 0.9);
    }

    // Rain around the camera's view.
    const r = rain.current;
    if (r) {
      if (raining) {
        const cx = camera.position.x * 0.5;
        const cz = camera.position.z * 0.5;
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.15 + (w.storm ? 0.25 : 0));
        drops.forEach((d, k) => {
          d.y -= dt * 20;
          if (d.y < 0) {
            d.cycle++;
            d.y = 20 + hash(seed + d.cycle, k, 7) * 3;
            d.x = (hash(seed + d.cycle, k, 8) - 0.5) * 60;
            d.z = (hash(seed + d.cycle, k, 9) - 0.5) * 60;
          }
          p.set(cx + d.x, d.y, cz + d.z);
          m.compose(p, q, sc.set(1, 1, 1));
          r.setMatrixAt(k, m);
        });
        r.count = w.storm ? DROPS : DROPS / 2;
        r.instanceMatrix.needsUpdate = true;
      } else r.count = 0;
    }

    const c = clouds.current;
    if (c) {
      cloudMat.color.set(
        w.ash ? "#6b5a4f" : raining ? "#79828a" : env.night ? "#39445c" : "#ffffff",
      );
      cloudMat.opacity = raining || w.ash ? 0.92 : 0.78;
      cloudSpots.forEach((s, k) => {
        s.a += dt * s.speed;
        for (let lobe = 0; lobe < 4; lobe++) {
          const o = lobe - 1.5;
          p.set(
            Math.cos(s.a) * s.r + o * s.s * 0.7,
            (raining ? s.y - 4 : s.y) + Math.sin(k * 2.1 + lobe) * s.s * 0.12,
            Math.sin(s.a) * s.r + Math.cos(k + lobe) * s.s * 0.3,
          );
          m.compose(p, q.identity(), sc.set(s.s * 0.9, s.s * 0.32, s.s * 0.65));
          c.setMatrixAt(k * 4 + lobe, m);
        }
      });
      c.count = raining || w.ash ? cloudSpots.length * 4 : 14 * 4;
      c.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <fog attach="fog" args={["#b8d6e8", 80, 170]} />
      <hemisphereLight ref={hemi} args={["#fff8e7", "#4d6340", 0.8]} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        position={[20, 40, 10]}
        intensity={2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-camera-far={140}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      <instancedMesh ref={rain} args={[undefined, undefined, DROPS]} frustumCulled={false}>
        <boxGeometry args={[0.015, 0.5, 0.015]} />
        <meshBasicMaterial color="#cbdce7" transparent opacity={0.45} />
      </instancedMesh>
      <instancedMesh ref={clouds} args={[undefined, cloudMat, 22 * 4]} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
      </instancedMesh>
    </>
  );
}
