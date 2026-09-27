import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  SURGE_IMPACT,
  surgeAt,
  surgeHalfWidth,
  type SurgeKind,
  type SurgeShape,
} from "@/lib/city/surge";
import { hash } from "./common";
import { AFTERMATH, type ActorProps } from "./actorParts";

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Things the water picks up and carries: planks, cars, fence posts, trunks. */
const FLOTSAM = [
  { size: [0.42, 0.05, 0.12], colors: ["#8a6a45", "#6f5337", "#a58157"] },
  { size: [0.34, 0.16, 0.18], colors: ["#b8342c", "#2f5f9a", "#d9c07a", "#e8e4d8", "#3d6b3a"] },
  { size: [0.5, 0.09, 0.09], colors: ["#5b4632", "#4a3a2a"] },
  { size: [0.2, 0.2, 0.2], colors: ["#c9b28f", "#9aa2a8"] },
] as const;

/** A fallback path for events recorded before surges had one. */
function defaultShape(kind: SurgeKind, focus: { x: number; z: number }, size: number): SurgeShape {
  return {
    kind,
    ox: focus.x - 12,
    oz: focus.z,
    dx: 1,
    dz: 0,
    reach: 12,
    runout: 3,
    height: kind === "tsunami" ? 0.9 + size * 0.08 : 0.4 + size * 0.03,
  };
}

/**
 * A tsunami out of Mirror Lake, or a flash flood out of Kettle Creek. The
 * actor doesn't draw the water itself: it drives the town's shared water
 * level (so the surface, the buildings and the people all feel it), and adds
 * the spray at the crest and the wreckage the water carries.
 */
export function SurgeActor({
  a,
  focus,
  getT,
  bus,
  seed,
  surge,
}: ActorProps & { surge?: SurgeShape }) {
  const kind: SurgeKind = a.kind === "flood" ? "flash" : "tsunami";
  const shape = useMemo(
    () => surge ?? defaultShape(kind, focus, a.size),
    [surge, kind, focus, a.size],
  );
  const impact = SURGE_IMPACT[kind];
  const tsunami = kind === "tsunami";
  const spray = useRef<THREE.InstancedMesh>(null);
  const flotsam = useRef<THREE.InstancedMesh>(null);
  const lastPanic = useRef(-1);
  useEffect(() => {
    // A flash flood comes with the rain that caused it.
    if (!tsunami) bus.stormUntil = Math.max(bus.stormUntil, bus.now + impact + AFTERMATH);
    return () => {
      bus.surge = null;
    };
  }, [bus, tsunami, impact]);
  const landed = useRef(false);

  const drops = useMemo(
    () =>
      Array.from({ length: tsunami ? 90 : 40 }, (_, i) => ({
        side: hash(seed * 7 + i, 11) * 2 - 1,
        phase: hash(seed * 7 + i, 13),
        rise: 0.8 + hash(seed * 7 + i, 17) * 1.2,
      })),
    [seed, tsunami],
  );
  const pieces = useMemo(
    () =>
      Array.from({ length: tsunami ? 26 : 14 }, (_, i) => {
        const type = FLOTSAM[Math.floor(hash(seed * 5 + i, 3) * FLOTSAM.length)];
        return {
          side: hash(seed * 5 + i, 5) * 2 - 1,
          lag: 0.3 + hash(seed * 5 + i, 7) * 2.2,
          spin: (hash(seed * 5 + i, 9) - 0.5) * 3,
          size: type.size,
          color: type.colors[Math.floor(hash(seed * 5 + i, 19) * type.colors.length)],
        };
      }),
    [seed, tsunami],
  );

  useFrame(() => {
    const t = getT();
    const st = surgeAt(shape, t);
    const live = t < impact + AFTERMATH - 0.3;
    bus.surge = live ? { ...shape, ...st } : null;
    const px = -shape.dz;
    const pz = shape.dx;

    // Rumble as it comes ashore; a thump when it hits.
    if (tsunami && t > 1 && t < impact) bus.shake = Math.max(bus.shake, 0.02 + (t / impact) * 0.05);
    if (!landed.current && t >= impact) {
      landed.current = true;
      bus.shake = Math.max(bus.shake, tsunami ? 0.22 : 0.08);
    }
    // People run from the front of the water.
    if (live && st.front > 0.5 && t - lastPanic.current > 0.4 && t < impact + 2) {
      lastPanic.current = t;
      const fx = shape.ox + shape.dx * st.front;
      const fz = shape.oz + shape.dz * st.front;
      bus.disturbances.push({
        x: fx,
        z: fz,
        radius: 3.5,
        mode: "flee",
        start: bus.now,
        until: bus.now + 3,
      });
    }

    // Spray thrown off the breaking crest.
    const m = spray.current;
    if (m) {
      const half = surgeHalfWidth(shape, st.front);
      drops.forEach((d, i) => {
        if (st.crest < 0.08 || !live) {
          m.setMatrixAt(i, HIDDEN);
          return;
        }
        const age = (t * 1.3 + d.phase) % 1;
        const along = st.front - 0.3 + age * 0.7;
        const x = shape.ox + shape.dx * along + px * d.side * half;
        const z = shape.oz + shape.dz * along + pz * d.side * half;
        const y = st.crest * 0.95 + age * d.rise * st.crest - age * age * 2.2 * st.crest;
        const s = 0.1 * (1 - age) * Math.min(1, st.crest * 1.5) * (tsunami ? 1.4 : 1);
        tmpM.compose(tmpP.set(x, Math.max(0.02, y), z), tmpQ.identity(), tmpS.setScalar(s));
        m.setMatrixAt(i, tmpM);
      });
      m.instanceMatrix.needsUpdate = true;
    }

    // Wreckage riding the water, then left where it runs aground.
    const f = flotsam.current;
    const water = bus.water;
    if (f) {
      const half = surgeHalfWidth(shape, st.front) * 0.8;
      const limit = shape.reach + shape.runout;
      pieces.forEach((p, i) => {
        const along = Math.min(limit - p.lag * 0.4, st.front - p.lag);
        if (along < 0.5 || t < 1) {
          f.setMatrixAt(i, HIDDEN);
          return;
        }
        const x = shape.ox + shape.dx * along + px * p.side * half;
        const z = shape.oz + shape.dz * along + pz * p.side * half;
        const depth = water ? water.sample(x, z) : 0;
        const floating = depth > 0.05;
        const bob = floating ? Math.sin(t * 3 + i) * 0.03 : 0;
        const y = Math.max(p.size[1] / 2, depth + 0.02 + bob);
        const roll = floating ? t * p.spin : p.spin * 2;
        tmpE.set(Math.sin(roll) * 0.4, Math.atan2(shape.dx, shape.dz) + roll, Math.cos(roll) * 0.3);
        tmpM.compose(
          tmpP.set(x, y, z),
          tmpQ.setFromEuler(tmpE),
          tmpS.set(p.size[0], p.size[1], p.size[2]),
        );
        f.setMatrixAt(i, tmpM);
        f.setColorAt(i, tmpC.set(p.color));
      });
      f.instanceMatrix.needsUpdate = true;
      if (f.instanceColor) f.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={spray} args={[undefined, undefined, drops.length]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#f1f6f5" roughness={0.4} transparent opacity={0.85} />
      </instancedMesh>
      <instancedMesh
        ref={flotsam}
        args={[undefined, undefined, pieces.length]}
        castShadow
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </>
  );
}
