import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldBus } from "./common";
import { Puffs } from "./vfx";
import type { TileHit } from "./ripple";

/** Hits beyond this many just change quietly, to keep the frame rate up. */
const MAX_FX = 36;

interface HitProps {
  hit: TileHit;
  getT: () => number;
  bus: WorldBus;
  seed: number;
}

/** The building that stood there, leaning over, sinking and fading into its own dust. */
function Ghost({
  hit,
  getT,
  rise = false,
  whirl = false,
}: HitProps & { rise?: boolean; whirl?: boolean }) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const h = hit.height;
  useFrame(() => {
    const since = getT() - hit.at;
    const g = inner.current;
    if (!g || !outer.current || !mat.current) return;
    const life = rise ? 3.2 : whirl ? 2.2 : 1.6;
    outer.current.visible = since >= 0 && since < life;
    if (!outer.current.visible) return;
    if (whirl) {
      // Torn off its footing and spun up into the funnel.
      const k = since / life;
      const r = 0.2 + k * 1.2;
      const a = since * 7;
      g.position.set(Math.cos(a) * r - 0.32, since * since * 1.6, Math.sin(a) * r);
      g.rotation.set(since * 4, since * 6, since * 3);
      g.scale.setScalar(Math.max(0.05, 1 - k * 0.8));
      mat.current.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      return;
    }
    if (rise) {
      // Carried up into the beam, turning slowly.
      const k = since / life;
      g.position.y = since * since * 1.1 + Math.sin(since * 3) * 0.05;
      g.rotation.set(Math.sin(since * 2) * 0.2, since * 1.4, 0);
      g.scale.setScalar(1 - k * 0.7);
      mat.current.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      return;
    }
    // Tips over its footing, then crumples down.
    const k = Math.min(1, since / 0.9);
    const tip = k * k * 1.2;
    g.rotation.z = -tip;
    g.position.y = -h * 0.55 * Math.max(0, since - 0.4);
    g.scale.set(1, Math.max(0.15, 1 - Math.max(0, since - 0.3) * 0.9), 1);
    mat.current.opacity = since < 0.9 ? 1 : Math.max(0, 1 - (since - 0.9) / 0.7);
  });
  if (h < 0.2) return null;
  return (
    <group ref={outer} position={[hit.x, 0, hit.z]} rotation-y={-hit.fall} visible={false}>
      {/* Pivot on the edge it falls towards. */}
      <group position={[0.32, 0, 0]}>
        <group ref={inner}>
          <mesh position={[-0.32, h / 2, 0]} castShadow>
            <boxGeometry args={[0.62, h, 0.62]} />
            <meshStandardMaterial
              ref={mat}
              color={hit.color}
              roughness={0.9}
              transparent
              depthWrite
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

/** A dull whump of dust where a building came down. */
function Dust({ hit, getT, seed }: HitProps) {
  const since = () => getT() - hit.at;
  return (
    <Puffs
      getT={since}
      origin={[hit.x, 0.15, hit.z]}
      count={16}
      duration={2.8}
      stagger={0.35}
      spread={0.7}
      rise={0.6 + hit.height * 0.5}
      size={[0.35, 1.2 + hit.height * 0.3]}
      color="#b3a58e"
      opacity={0.8}
      seed={seed}
    />
  );
}

function Flare({ hit, getT, seed }: HitProps) {
  const since = () => getT() - hit.at;
  return (
    <Puffs
      getT={since}
      origin={[hit.x, 0.3, hit.z]}
      count={12}
      duration={1}
      stagger={0.2}
      spread={0.45}
      rise={1.6}
      size={[0.3, 1]}
      color="#ff8a3a"
      opacity={0.8}
      additive
      seed={seed}
    />
  );
}

function Splash({ hit, getT, seed }: HitProps) {
  const since = () => getT() - hit.at;
  return (
    <Puffs
      getT={since}
      origin={[hit.x, 0.1, hit.z]}
      count={12}
      duration={1.3}
      stagger={0.2}
      spread={0.6}
      rise={1.8}
      fall={4}
      size={[0.2, 0.6]}
      color="#eaf7ff"
      opacity={0.9}
      seed={seed}
    />
  );
}

function Sparkle({ hit, getT, seed }: HitProps) {
  const since = () => getT() - hit.at;
  return (
    <Puffs
      getT={since}
      origin={[hit.x, 0.2, hit.z]}
      count={8}
      duration={1.1}
      stagger={0.2}
      spread={0.4}
      rise={1.4}
      size={[0.1, 0.3]}
      color="#fff4c8"
      opacity={0.9}
      additive
      seed={seed}
    />
  );
}

/** An expanding ring on the ground. */
function Shockwave({ hit, getT, color, reach }: HitProps & { color: string; reach: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const since = getT() - hit.at;
    m.visible = since > 0 && since < 1.2;
    if (!m.visible) return;
    m.scale.setScalar(0.3 + (since / 1.2) * reach);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - since / 1.2);
  });
  return (
    <mesh ref={ref} position={[hit.x, 0.08, hit.z]} rotation-x={-Math.PI / 2} visible={false}>
      <ringGeometry args={[0.85, 1, 40]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Runs once when the chain reaction goes off: shake, flash, panic, sirens. */
function useTrigger(hit: TileHit, getT: () => number, fire: () => void) {
  const done = useRef(false);
  useFrame(() => {
    if (!done.current && getT() >= hit.at) {
      done.current = true;
      fire();
    }
  });
}

function panic(bus: WorldBus, hit: TileHit, radius: number, responder?: string) {
  const now = bus.now;
  bus.disturbances.push({ x: hit.x, z: hit.z, radius, mode: "flee", start: now, until: now + 5 });
  bus.disturbances.push({
    x: hit.x,
    z: hit.z,
    radius,
    mode: "gather",
    start: now + 5,
    until: now + 14,
  });
  if (responder)
    bus.spawns.push({
      color: responder,
      count: 2,
      size: 1.3,
      flashing: true,
      x: hit.x,
      z: hit.z,
      until: now + 18,
    });
}

/** A gas station going up: fireball, shockwave, a column of black smoke, fire engines. */
function Explosion(p: HitProps) {
  const { hit, getT, bus, seed } = p;
  const since = () => getT() - hit.at;
  useTrigger(hit, getT, () => {
    bus.quake = { x: hit.x, z: hit.z, amp: 0.7, until: bus.now + 1 };
    bus.shake = Math.max(bus.shake, 0.32);
    bus.flash = Math.max(bus.flash, 0.9);
    panic(bus, hit, 4, "#c62f22");
  });
  return (
    <>
      <Shockwave {...p} color="#ffd29a" reach={4.5} />
      <Puffs
        getT={since}
        origin={[hit.x, 0.4, hit.z]}
        count={40}
        duration={1.5}
        stagger={0.15}
        spread={1.2}
        rise={3.2}
        size={[0.8, 2.8]}
        color="#ff8a3a"
        opacity={0.85}
        additive
        seed={seed}
      />
      <Puffs
        getT={since}
        origin={[hit.x, 0.8, hit.z]}
        count={46}
        duration={6.5}
        stagger={3}
        spread={0.8}
        rise={6}
        size={[0.7, 2.8]}
        color="#2f2a27"
        opacity={0.8}
        seed={seed + 1}
      />
    </>
  );
}

/** The water tower splits and a wall of water drops onto the street. */
function Burst(p: HitProps) {
  const { hit, getT, bus, seed } = p;
  const since = () => getT() - hit.at;
  useTrigger(hit, getT, () => {
    bus.shake = Math.max(bus.shake, 0.15);
    panic(bus, hit, 3);
  });
  return (
    <>
      <Shockwave {...p} color="#d8f0ff" reach={3.5} />
      <Puffs
        getT={since}
        origin={[hit.x, hit.height, hit.z]}
        count={60}
        duration={2.2}
        stagger={0.4}
        spread={1.3}
        rise={1.5}
        fall={5}
        size={[0.3, 1.1]}
        color="#eaf7ff"
        opacity={0.95}
        seed={seed}
      />
      <Puffs
        getT={since}
        origin={[hit.x, 0.2, hit.z]}
        count={30}
        duration={4}
        stagger={0.8}
        spread={2.4}
        rise={0.5}
        size={[0.8, 2.2]}
        color="#e6f3f7"
        opacity={0.45}
        seed={seed + 1}
      />
    </>
  );
}

/** The radio mast comes down across the lines: sparks, then darkness. */
function Blackout(p: HitProps) {
  const { hit, getT, bus, seed } = p;
  const since = () => getT() - hit.at;
  useTrigger(hit, getT, () => {
    bus.shake = Math.max(bus.shake, 0.18);
    bus.flash = Math.max(bus.flash, 0.7);
    bus.blackoutUntil = Math.max(bus.blackoutUntil, bus.now + 25);
    panic(bus, hit, 3, "#1d3f94");
  });
  return (
    <Puffs
      getT={since}
      origin={[hit.x, 0.6, hit.z]}
      count={30}
      duration={0.8}
      stagger={1.2}
      spread={1.4}
      rise={2}
      fall={3}
      size={[0.08, 0.25]}
      color="#9fd4ff"
      opacity={1}
      additive
      seed={seed}
    />
  );
}

/** Something at the lab slips out: red light and the sky turning. */
function Breach(p: HitProps) {
  const { hit, getT, bus, seed } = p;
  const since = () => getT() - hit.at;
  useTrigger(hit, getT, () => {
    bus.flash = 1;
    bus.redStormUntil = Math.max(bus.redStormUntil, bus.now + 10);
    panic(bus, hit, 4, "#15161a");
  });
  return (
    <>
      <Shockwave {...p} color="#ff3a3a" reach={5} />
      <Puffs
        getT={since}
        origin={[hit.x, 0.5, hit.z]}
        count={36}
        duration={3}
        stagger={1.5}
        spread={1.2}
        rise={3.5}
        size={[0.3, 1.2]}
        color="#ff3140"
        opacity={0.7}
        additive
        seed={seed}
      />
    </>
  );
}

/** A tyre fire: low flames and a lot of black smoke. */
function Blaze(p: HitProps) {
  const { hit, getT, bus, seed } = p;
  const since = () => getT() - hit.at;
  useTrigger(hit, getT, () => panic(bus, hit, 3, "#c62f22"));
  return (
    <>
      <Flare {...p} />
      <Puffs
        getT={since}
        origin={[hit.x, 0.5, hit.z]}
        count={40}
        duration={7}
        stagger={3.5}
        spread={0.9}
        rise={5}
        size={[0.8, 3]}
        color="#1f1c1a"
        opacity={0.85}
        seed={seed + 1}
      />
    </>
  );
}

function HitFx(p: HitProps) {
  switch (p.hit.fx) {
    case "collapse":
      return (
        <>
          <Ghost {...p} />
          <Dust {...p} />
        </>
      );
    case "crater":
      return (
        <>
          <Shockwave {...p} color="#c9b89c" reach={3} />
          <Dust {...p} hit={{ ...p.hit, height: 1.2 }} />
        </>
      );
    case "abduct":
      return <Ghost {...p} rise />;
    case "whirl":
      return (
        <>
          <Ghost {...p} whirl />
          <Dust {...p} />
        </>
      );
    case "ignite":
      return <Flare {...p} />;
    case "flood":
      return <Splash {...p} />;
    case "rise":
      return <Sparkle {...p} />;
    case "explosion":
      return (
        <>
          <Ghost {...p} />
          <Explosion {...p} />
        </>
      );
    case "burst":
      return (
        <>
          <Ghost {...p} />
          <Burst {...p} />
        </>
      );
    case "blackout":
      return (
        <>
          <Ghost {...p} />
          <Dust {...p} />
          <Blackout {...p} />
        </>
      );
    case "breach":
      return <Breach {...p} />;
    case "blaze":
      return <Blaze {...p} />;
  }
}

/**
 * Plays every tile's reaction as the damage reaches it. Chain reactions
 * always play; ordinary hits are capped so a huge event stays smooth.
 */
export function RippleFx({
  hits,
  getT,
  bus,
  seed,
}: {
  hits: TileHit[];
  getT: () => number;
  bus: WorldBus;
  seed: number;
}) {
  const shown = useMemo(() => {
    const chains = hits.filter((h) => h.label !== undefined);
    const rest = hits.filter((h) => h.label === undefined && h.fx !== "rise");
    const quiet = hits.filter((h) => h.fx === "rise");
    return [...chains, ...rest, ...quiet].slice(0, MAX_FX);
  }, [hits]);
  return (
    <group>
      {shown.map((hit) => (
        <HitFx key={hit.tile} hit={hit} getT={getT} bus={bus} seed={seed * 131 + hit.tile} />
      ))}
    </group>
  );
}
