import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WILDFIRE_RUN } from "@/lib/city/simulation";
import { hash } from "./common";
import { AFTERMATH, type ActorProps } from "./actorParts";
import { Puffs } from "./vfx";

/** Seconds into the spectacle when the fire front reaches the epicentre. */
export const WILDFIRE_IMPACT = 3.8;
/** How long the front keeps running before it stalls just past the epicentre. */
const RUN_TIME = WILDFIRE_IMPACT + 1.2;

/** Offset of the front along its heading at time t (negative: still coming). */
export function wildfireFront(t: number): number {
  return -WILDFIRE_RUN + (WILDFIRE_RUN + 2) * Math.min(1, Math.max(0, t / RUN_TIME));
}

/** When the front reaches a point `off` tiles along its heading from the epicentre. */
export function wildfireArrival(off: number): number {
  return ((off + WILDFIRE_RUN) / (WILDFIRE_RUN + 2)) * RUN_TIME;
}

/**
 * A wall of fire sweeping out of Blackpine Woods. The front itself is a band
 * of flame and a towering smoke plume that moves with it; each tree and house
 * it reaches catches fire on its own (and keeps burning after it passes).
 */
export function Wildfire({ a, focus, getT, bus, seed, heading }: ActorProps) {
  const front = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  const angle = heading ?? hash(seed, 5) * Math.PI * 2;
  const dir = useMemo(() => new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), [angle]);
  const width = 1.6 + a.size * 0.25;
  const flames = useMemo(() => [-1, -0.5, 0, 0.5, 1].map((k) => k * width), [width]);
  const lastPanic = useRef(-1);
  // The loops never end on their own; the clock they read just runs.
  const clock = () => getT();

  useEffect(() => {
    // The sky goes brown and hazy with smoke.
    bus.hazeUntil = Math.max(bus.hazeUntil, bus.now + AFTERMATH + 14);
  }, [bus]);

  useFrame(() => {
    const t = getT();
    const off = wildfireFront(t);
    const g = front.current;
    if (!g) return;
    const x = focus.x + dir.x * off;
    const z = focus.z + dir.z * off;
    g.position.set(x, 0, z);
    g.rotation.y = -angle;
    // The front burns down once it has nothing left to eat.
    const fade = Math.max(0, 1 - Math.max(0, t - RUN_TIME - 3) / 3);
    g.scale.setScalar(Math.max(0.001, fade));
    if (glow.current) {
      glow.current.position.set(x, 1.5, z);
      glow.current.intensity = (4 + Math.sin(t * 13) * 1.2 + Math.sin(t * 7.3) * 0.8) * fade;
    }
    if (t - lastPanic.current > 0.5 && fade > 0.2) {
      lastPanic.current = t;
      bus.disturbances.push({ x, z, radius: 4, mode: "flee", start: bus.now, until: bus.now + 3 });
    }
  });

  return (
    <>
      <pointLight ref={glow} color="#ff8a3a" intensity={0} distance={9} decay={1.6} />
      {/* In the front's own frame: x across it, z along its heading. */}
      <group ref={front}>
        <group rotation-y={Math.PI / 2}>
          {flames.map((lat, i) => (
            <Puffs
              key={`f${i}`}
              getT={clock}
              origin={[lat, 0.2, 0]}
              count={22}
              duration={0.9}
              spread={0.55}
              rise={1.6 + (i % 2) * 0.5}
              size={[0.35, 1.1]}
              color={i % 2 ? "#ff7a1f" : "#ffb347"}
              opacity={0.85}
              additive
              loop
              seed={seed * 13 + i}
            />
          ))}
          <Puffs
            getT={clock}
            origin={[0, 0.8, -0.6]}
            count={60}
            duration={4.5}
            spread={width * 0.9}
            rise={6}
            size={[0.8, 3.2]}
            color="#35302b"
            opacity={0.7}
            loop
            seed={seed * 17}
          />
          <Puffs
            getT={clock}
            origin={[0, 0.5, 0]}
            count={40}
            duration={1.6}
            spread={width}
            rise={3}
            fall={0.6}
            size={[0.04, 0.1]}
            color="#ffd27a"
            opacity={1}
            additive
            loop
            seed={seed * 19}
          />
        </group>
      </group>
    </>
  );
}
