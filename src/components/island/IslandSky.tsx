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
const CLOUDS = 26;
const ORIGIN = new THREE.Vector3();
const sunDir = new THREE.Vector3(0.5, 0.75, 0.3).normalize();

/** A soft, lumpy cloud: layered noise blobs, bright on top and grey underneath. */
function cloudTexture(seed: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  for (let k = 0; k < 70; k++) {
    const t = hash(seed, k, 41);
    const x = size * (0.18 + hash(seed, k, 42) * 0.64);
    const y = size * (0.35 + hash(seed, k, 43) * 0.35 - t * 0.1);
    const r = size * (0.06 + hash(seed, k, 44) * 0.14);
    const shade = Math.round(215 + (1 - y / size) * 40);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 6)},0.55)`);
    grad.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

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
  const controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3 } | null;
  const cloudTex = useMemo(() => cloudTexture(seed), [seed]);
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
      Array.from({ length: CLOUDS }, (_, k) => ({
        a: (k / CLOUDS) * Math.PI * 2 + hash(seed, k, 11) * 0.5,
        // Clouds frame the island from out over the sea, rather than hide it.
        r: 85 + hash(seed, k, 12) * 90,
        y: 34 + hash(seed, k, 13) * 16,
        s: 14 + hash(seed, k, 14) * 16,
        speed: 0.002 + hash(seed, k, 15) * 0.004,
      })),
    [seed],
  );
  const cloudMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        map: cloudTex,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        fog: false,
      }),
    [cloudTex],
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
      // Aerial haze: distant ground fades into the sky, warmer towards dusk.
      const camDist = controls ? camera.position.distanceTo(controls.target) : 80;
      // Haze starts past what you're looking at and thickens towards the horizon.
      fog.near = camDist * (w.ash ? 0.3 : raining ? 0.6 : 0.95);
      fog.far = fog.near + (w.ash ? 60 : raining ? 110 : 230) + camDist * 1.2;
    }

    // The sun crosses from east to west over the island.
    const az = ((hour - 6) / 14) * Math.PI;
    if (sun.current) {
      // The sun (and its shadow camera) follow what you're looking at, so
      // shadows stay crisp wherever you are on the island.
      const tgt = controls?.target ?? ORIGIN;
      const camDist = camera.position.distanceTo(tgt);
      sun.current.position.set(
        tgt.x + Math.cos(az) * 70,
        tgt.y + 10 + daylight * 80,
        tgt.z + 30 + Math.sin(az) * 14,
      );
      sun.current.target.position.copy(tgt);
      sunDir.copy(sun.current.position).sub(tgt).normalize();
      env.sunDir = sunDir;
      sun.current.target.updateMatrixWorld();
      const ext = Math.round(Math.min(110, Math.max(20, camDist * 0.8)) / 4) * 4;
      const sc2 = sun.current.shadow.camera;
      if (sc2.right !== ext) {
        sc2.left = sc2.bottom = -ext;
        sc2.right = sc2.top = ext;
        sc2.far = 400;
        sc2.updateProjectionMatrix();
      }
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
      // Soft cloud banks: billboards turned to face the camera.
      q.copy(camera.quaternion);
      cloudSpots.forEach((s, k) => {
        s.a += dt * s.speed;
        for (let lobe = 0; lobe < 3; lobe++) {
          const o = lobe - 1;
          p.set(
            Math.cos(s.a) * s.r + o * s.s * 0.55,
            (raining ? s.y - 8 : s.y) + Math.sin(k * 2.1 + lobe) * s.s * 0.08,
            Math.sin(s.a) * s.r + Math.cos(k + lobe) * s.s * 0.25,
          );
          m.compose(p, q, sc.set(s.s * (1.1 - Math.abs(o) * 0.25), s.s * 0.55, 1));
          c.setMatrixAt(k * 3 + lobe, m);
        }
      });
      // The photographed sky carries the clouds; these banks only roll in with ash.
      c.count = w.ash ? cloudSpots.length * 3 : 0;
      c.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <fog attach="fog" args={["#b8d6e8", 90, 320]} />
      <hemisphereLight ref={hemi} args={["#fff8e7", "#4d6340", 0.8]} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        position={[20, 40, 10]}
        intensity={2}
        shadow-mapSize={shadows ? [4096, 4096] : [1024, 1024]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={260}
        shadow-bias={-0.0008}
        shadow-normalBias={0.06}
      />
      <instancedMesh ref={rain} args={[undefined, undefined, DROPS]} frustumCulled={false}>
        <boxGeometry args={[0.006, 0.35, 0.006]} />
        <meshBasicMaterial color="#cbdce7" transparent opacity={0.3} />
      </instancedMesh>
      <instancedMesh ref={clouds} args={[undefined, cloudMat, CLOUDS * 3]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </instancedMesh>
    </>
  );
}
