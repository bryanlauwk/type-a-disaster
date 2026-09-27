import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type {
  Actor,
  ActorKind,
  CityState,
  ActorShape,
  CrowdReaction,
  Recipe,
  RecipeShape,
  Responder,
} from "@/lib/city/types";
import { hash, type WorldBus } from "./common";

import {
  AFTERMATH,
  Faller,
  Mat,
  ShapeGeometry,
  Stomper,
  ease,
  useNormalMap,
  useSurfaceMap,
  type ActorProps,
} from "./actorParts";
import { ACTOR_LIBRARY, LIBRARY_IMPACT } from "./ActorLibrary";
import { REAL_MODELS, type RealModel } from "./realModels";
import { withSpecGloss } from "./specGloss";
import { Puffs } from "./vfx";
import { RippleFx } from "./RippleFx";
import { SurgeActor } from "./SurgeActor";
import { Wildfire, WILDFIRE_IMPACT } from "./Wildfire";
import { SURGE_IMPACT, type SurgeShape } from "@/lib/city/surge";
import { planHits, type TileHit } from "./ripple";

export { AFTERMATH };
export interface SpectacleRun {
  id: number;
  actors: Actor[];
  crowd: CrowdReaction;
  responders: Responder[];
  focus: { x: number; z: number };
  radius: number;
  /** Heading of travellers, shared with the simulation's trail. */
  heading?: number;
  /** The water's path for a tsunami or flash flood. */
  surge?: SurgeShape;
  /** The town before and after the event, to play the damage tile by tile. */
  before?: CityState;
  after?: CityState;
}

/** Seconds after start when each kind of actor makes contact. */
const IMPACT_AT: Record<ActorKind, number> = {
  ...LIBRARY_IMPACT,
  whale: 2.6,
  meteor: 2.0,
  giant_object: 2.6,
  kaiju: 4.2,
  creature: 4.2,
  ufo: 3.0,
  tornado: 3.5,
  swarm: 3.0,
  convoy: 3.2,
  rain_of: 1.8,
  wave: SURGE_IMPACT.tsunami,
  flood: SURGE_IMPACT.flash,
  wildfire: WILDFIRE_IMPACT,
  storm: 2.2,
  fireworks: 1.2,
  earthquake: LIBRARY_IMPACT.earthquake,
  aurora: LIBRARY_IMPACT.aurora,
  phantom_train: LIBRARY_IMPACT.phantom_train,
  radio_burst: LIBRARY_IMPACT.radio_burst,
};
export const impactTime = (actors: Actor[]) => (actors.length ? IMPACT_AT[actors[0].kind] : 0.4);

const RESPONDER_COLOR: Record<Responder, string> = {
  fire: "#c62f22",
  police: "#1d3f94",
  ambulance: "#f4f4f4",
  agents: "#15161a",
  cleanup: "#e6801f",
};

/** Stable random-looking details make an event replay keep the same shape. */
const detail = (seed: number, index: number, salt = 0) => hash(seed * 104729 + index, salt);

// ---------------------------------------------------------------------------
// Falling things: whale and giant objects
// ---------------------------------------------------------------------------

function Whale(p: ActorProps) {
  const tail = useRef<THREE.Group>(null);
  const fins = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const spray = useRef<THREE.InstancedMesh>(null);
  const skin = useSurfaceMap("/textures/whale-skin.webp");
  const skinNormal = useNormalMap("/textures/whale-skin.normal.webp");
  const droplets = useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => ({
        angle: detail(p.seed, i, 401) * Math.PI * 2,
        drift: 0.05 + detail(p.seed, i, 409) * 0.12,
        lift: 0.5 + detail(p.seed, i, 419) * 0.65,
        delay: detail(p.seed, i, 421) * 2.2,
      })),
    [p.seed],
  );
  useFrame(() => {
    const t = p.getT();
    const since = t - p.impact;
    const settle = since < 0 ? 1 : Math.exp(-Math.max(0, since) * 0.4);
    if (tail.current) {
      tail.current.rotation.x = Math.sin(t * 4) * 0.28 * settle;
      tail.current.rotation.y = Math.sin(t * 2.6) * 0.1 * settle;
    }
    fins.current?.children.forEach((fin, i) => {
      fin.rotation.z = (i ? -1 : 1) * Math.sin(t * 3.2) * 0.12 * settle;
    });
    if (body.current) body.current.scale.y = 0.45 * (1 + Math.sin(t * 1.4) * 0.012);
    const m = spray.current;
    if (!m) return;
    droplets.forEach((drop, i) => {
      const age = since - 0.3 - drop.delay;
      if (age < 0 || age > 1.6) {
        m.setMatrixAt(i, HIDDEN);
        return;
      }
      const radius = drop.drift * age;
      const y = 0.25 + drop.lift * age - 0.32 * age * age;
      tmpP.set(Math.cos(drop.angle) * radius, y, -0.04 + Math.sin(drop.angle) * radius);
      tmpM.compose(tmpP, tmpQ.identity(), tmpS.setScalar(0.008 + (1 - age / 1.6) * 0.013));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  const c = p.a.color;
  return (
    <Faller {...p}>
      <mesh ref={body} castShadow scale={[0.55, 0.45, 1.1]}>
        <sphereGeometry args={[0.5, 32, 24]} />
        <Mat
          color="#ffffff"
          map={skin}
          normalMap={skinNormal}
          normalStrength={0.22}
          roughness={0.42}
        />
      </mesh>
      <mesh position={[0, -0.1, 0.05]} scale={[0.45, 0.3, 0.95]}>
        <sphereGeometry args={[0.5, 12, 8]} />
        <Mat color="#e8eef2" />
      </mesh>
      <group ref={fins}>
        {[-1, 1].map((sgn) => (
          <group key={sgn}>
            <mesh
              castShadow
              position={[sgn * 0.35, -0.1, 0.18]}
              rotation={[0, sgn * 0.45, sgn * -0.25]}
              scale={[0.68, 0.07, 0.22]}
            >
              <sphereGeometry args={[0.5, 18, 12]} />
              <Mat color={c} roughness={0.45} />
            </mesh>
          </group>
        ))}
      </group>
      {[-1, 1].map((sgn) => (
        <group key={sgn}>
          <mesh position={[sgn * 0.2, 0.04, 0.42]}>
            <sphereGeometry args={[0.035, 6, 6]} />
            <Mat color="#111111" />
          </mesh>
          <mesh position={[sgn * 0.34, 0.12, 0.31]}>
            <sphereGeometry args={[0.024, 10, 8]} />
            <Mat color="#101417" />
          </mesh>
          <mesh position={[sgn * 0.35, 0.135, 0.325]}>
            <sphereGeometry args={[0.008, 8, 6]} />
            <Mat color="#f1eee0" emissive="#e7e1c9" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.23, -0.04]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.055, 12]} />
        <Mat color="#243b49" />
      </mesh>
      {[0.1, 0.24, 0.38, 0.52].map((z) => (
        <mesh key={z} position={[0, -0.245, z]} scale={[0.35, 0.015, 0.012]}>
          <sphereGeometry args={[0.5, 12, 8]} />
          <Mat color="#bfd0d3" />
        </mesh>
      ))}
      <group ref={tail} position={[0, 0, -0.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.25]}>
          <coneGeometry args={[0.16, 0.55, 8]} />
          <Mat color={c} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            castShadow
            position={[side * 0.2, 0, -0.58]}
            rotation={[0, side * 0.25, side * 0.08]}
            scale={[0.46, 0.05, 0.22]}
          >
            <sphereGeometry args={[0.5, 18, 12]} />
            <Mat color={c} roughness={0.48} />
          </mesh>
        ))}
      </group>
      <instancedMesh
        ref={spray}
        args={[undefined, undefined, droplets.length]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial
          color="#e5f4f7"
          roughness={0.08}
          clearcoat={1}
          transparent
          opacity={0.75}
        />
      </instancedMesh>
    </Faller>
  );
}

function GiantObject(p: ActorProps) {
  return (
    <Faller {...p}>
      <mesh castShadow>
        <ShapeGeometry shape={p.a.shape} />
        <Mat color={p.a.color} />
      </mesh>
    </Faller>
  );
}

// ---------------------------------------------------------------------------
// Meteor
// ---------------------------------------------------------------------------

function Meteor({ a, focus, getT, impact, seed, body }: ActorProps & { body?: RealModel }) {
  const rock = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Group>(null);
  const s = 0.25 + a.size * 0.15;
  const rockMap = useSurfaceMap("/textures/wet-asphalt.webp");
  const rockNormal = useNormalMap("/textures/wet-asphalt.normal.webp");
  const rockGeometry = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i);
      const radius = 0.86 + detail(seed, i, 71) * 0.26;
      positions.setXYZ(i, p.x * radius, p.y * radius, p.z * radius);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }, [seed]);
  const proceduralRock = (
    <mesh castShadow>
      <primitive object={rockGeometry} attach="geometry" />
      <Mat
        color="#776151"
        map={rockMap}
        normalMap={rockNormal}
        normalStrength={0.5}
        roughness={0.94}
        emissive="#6a2410"
      />
    </mesh>
  );
  const start = useMemo(() => new THREE.Vector3(focus.x - 16, 24, focus.z - 9), [focus]);
  const end = useMemo(() => new THREE.Vector3(focus.x, 0.3, focus.z), [focus]);
  useFrame(() => {
    const t = getT();
    const k = ease(t / impact);
    const pos = start.clone().lerp(end, k * k);
    if (rock.current) {
      rock.current.position.copy(pos);
      rock.current.rotation.set(t * 3, t * 2, 0);
      rock.current.visible = t < impact;
    }
    if (trail.current) {
      trail.current.visible = t < impact;
      trail.current.children.forEach((c, i) => {
        const kk = Math.max(0, k - (i + 1) * 0.025);
        c.position.copy(start.clone().lerp(end, kk * kk));
        c.scale.setScalar(s * (1 - i / 12));
      });
    }
  });
  return (
    <>
      <group ref={rock} scale={s}>
        {body ? (
          // A real scanned asteroid, centred where the procedural rock would be.
          <ModelBoundary key={a.model_url} fallback={proceduralRock}>
            <Suspense fallback={proceduralRock}>
              <group position={[0, -0.85, 0]} scale={1.45}>
                <ModelMesh url={a.model_url!} />
              </group>
            </Suspense>
          </ModelBoundary>
        ) : (
          proceduralRock
        )}
        <mesh scale={1.035}>
          <primitive object={rockGeometry} attach="geometry" />
          <meshBasicMaterial color="#ff6e28" transparent opacity={0.16} side={THREE.BackSide} />
        </mesh>
      </group>
      <group ref={trail}>
        {Array.from({ length: 10 }, (_, i) => (
          <mesh key={i}>
            <sphereGeometry args={[0.8, 8, 6]} />
            <meshBasicMaterial
              color={i < 3 ? "#ffe07a" : "#ff7a2a"}
              transparent
              opacity={0.5 - i * 0.04}
            />
          </mesh>
        ))}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Walkers: kaiju and creatures stomp in from the edge and out the other side
// ---------------------------------------------------------------------------

function Kaiju(p: ActorProps) {
  const tail = useRef<THREE.Group>(null);
  const limbs = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const jaw = useRef<THREE.Mesh>(null);
  const chest = useRef<THREE.Mesh>(null);
  const mouthGlow = useRef<THREE.MeshStandardMaterial>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const scales = useSurfaceMap("/textures/kaiju-scales.webp");
  const scaleNormal = useNormalMap("/textures/kaiju-scales.normal.webp");
  useFrame(() => {
    const t = p.getT();
    const since = t - p.impact;
    const roar = since > 0.25 && since < 4 ? Math.max(0, Math.sin((since - 0.25) * 3.2)) ** 2 : 0;
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * 2.2) * 0.18;
      tail.current.children.forEach((segment, i) => {
        segment.rotation.y = Math.sin(t * 2.2 - i * 0.55) * (0.08 + i * 0.035);
      });
    }
    if (head.current) {
      head.current.rotation.y = Math.sin(t * 1.15) * 0.085;
      head.current.position.y = Math.sin(t * 1.2) * 0.018;
    }
    if (jaw.current) jaw.current.position.y = 1.76 - roar * 0.13;
    if (mouthGlow.current) mouthGlow.current.emissiveIntensity = roar * 0.95;
    if (chest.current) chest.current.scale.y = 0.62 * (1 + Math.sin(t * 1.2) * 0.025);
    legs.current.forEach((leg, i) => {
      if (leg) leg.rotation.x = Math.sin(t * 4.4 + i * Math.PI) * 0.14;
    });
    limbs.current?.children.forEach((limb, i) => {
      limb.rotation.x = Math.sin(t * 4 + (i % 2) * Math.PI) * 0.16;
      limb.rotation.z = Math.sin(t * 2.2 + i) * 0.035;
    });
  });
  return (
    <Stomper {...p}>
      <mesh castShadow position={[0, 0.96, -0.08]} scale={[0.62, 0.52, 0.46]}>
        <sphereGeometry args={[1, 24, 18]} />
        <Mat
          color="#ffffff"
          map={scales}
          normalMap={scaleNormal}
          normalStrength={0.52}
          roughness={0.82}
        />
      </mesh>
      <mesh ref={chest} castShadow position={[0, 1.48, 0.06]} scale={[0.58, 0.62, 0.4]}>
        <sphereGeometry args={[1, 24, 18]} />
        <Mat
          color="#ffffff"
          map={scales}
          normalMap={scaleNormal}
          normalStrength={0.52}
          roughness={0.8}
        />
      </mesh>
      <group ref={head}>
        <mesh castShadow position={[0, 1.91, 0.28]} scale={[0.34, 0.3, 0.4]}>
          <sphereGeometry args={[1, 20, 16]} />
          <Mat
            color="#ffffff"
            map={scales}
            normalMap={scaleNormal}
            normalStrength={0.52}
            roughness={0.78}
          />
        </mesh>
        <mesh position={[0, 1.79, 0.66]} scale={[0.17, 0.045, 0.07]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial
            ref={mouthGlow}
            color="#1c0d0a"
            emissive="#c74320"
            emissiveIntensity={0}
          />
        </mesh>
        <mesh ref={jaw} castShadow position={[0, 1.76, 0.52]} scale={[0.25, 0.13, 0.28]}>
          <sphereGeometry args={[1, 18, 12]} />
          <Mat color="#30352e" />
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh position={[side * 0.23, 1.98, 0.51]}>
              <sphereGeometry args={[0.065, 16, 12]} />
              <Mat color="#efb731" emissive="#714816" />
            </mesh>
            <mesh position={[side * 0.25, 1.98, 0.565]} scale={[0.3, 1, 0.35]}>
              <sphereGeometry args={[0.028, 12, 10]} />
              <Mat color="#131815" />
            </mesh>
          </group>
        ))}
      </group>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.26, 1.15, 0.32]} rotation={[0, 0, side * 0.12]}>
            <capsuleGeometry args={[0.12, 0.36, 5, 12]} />
            <Mat
              color="#ffffff"
              map={scales}
              normalMap={scaleNormal}
              normalStrength={0.52}
              roughness={0.82}
            />
          </mesh>
          <group
            ref={(node) => {
              legs.current[side > 0 ? 1 : 0] = node;
            }}
          >
            <mesh castShadow position={[side * 0.26, 0.48, 0.02]} scale={[0.2, 0.5, 0.2]}>
              <sphereGeometry args={[0.5, 18, 14]} />
              <Mat
                color="#ffffff"
                map={scales}
                normalMap={scaleNormal}
                normalStrength={0.52}
                roughness={0.82}
              />
            </mesh>
            <mesh castShadow position={[side * 0.26, 0.12, 0.18]} scale={[0.2, 0.12, 0.3]}>
              <sphereGeometry args={[0.5, 16, 12]} />
              <Mat color="#394139" />
            </mesh>
            {[-0.12, 0, 0.12].map((toe) => (
              <mesh key={toe} position={[side * 0.26 + toe, 0.1, 0.39]} rotation={[0.18, 0, 0]}>
                <coneGeometry args={[0.04, 0.16, 8]} />
                <Mat color="#ded8c4" />
              </mesh>
            ))}
          </group>
        </group>
      ))}
      <group ref={limbs}>
        {[-0.46, 0.46].map((x) => (
          <group key={x}>
            <mesh position={[x, 1.3, 0.24]} rotation={[0, 0, x * 0.3]}>
              <capsuleGeometry args={[0.095, 0.38, 5, 10]} />
              <Mat color="#ffffff" map={scales} normalMap={scaleNormal} normalStrength={0.5} />
            </mesh>
            <mesh position={[x * 1.13, 1.06, 0.38]} rotation={[0.25, 0, x * 0.2]}>
              <capsuleGeometry args={[0.075, 0.28, 5, 10]} />
              <Mat color="#ffffff" map={scales} normalMap={scaleNormal} normalStrength={0.5} />
            </mesh>
            {[-1, 0, 1].map((claw) => (
              <mesh
                key={claw}
                position={[x * 1.13 + claw * 0.07, 0.89, 0.57]}
                rotation={[0.3, 0, 0]}
              >
                <coneGeometry args={[0.025, 0.11, 6]} />
                <Mat color="#d7d0bd" />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      {Array.from({ length: 9 }, (_, i) => {
        const y = 0.88 + i * 0.14;
        const z = -0.3 - i * 0.1;
        const size = 0.17 - i * 0.01;
        return (
          <mesh key={i} castShadow position={[0, y, z]} rotation={[-0.55, 0, 0]}>
            <coneGeometry args={[size, size * 1.5, 7]} />
            <Mat color={i % 2 ? "#4c5449" : "#747969"} roughness={0.9} />
          </mesh>
        );
      })}
      <group ref={tail} position={[0, 0.91, -0.42]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0, -0.025 * i, -0.23 * i]} rotation={[-0.15, 0, 0]}>
            <capsuleGeometry args={[0.22 - i * 0.045, 0.34, 5, 10]} />
            <Mat
              color="#ffffff"
              map={scales}
              normalMap={scaleNormal}
              normalStrength={0.52}
              roughness={0.84}
            />
          </mesh>
        ))}
      </group>
    </Stomper>
  );
}

function Creature(p: ActorProps) {
  const legs = useRef<THREE.Group>(null);
  const scales = useSurfaceMap("/textures/kaiju-scales.webp");
  const scaleNormal = useNormalMap("/textures/kaiju-scales.normal.webp");
  useFrame(() => {
    const t = p.getT();
    legs.current?.children.forEach(
      (l, i) => (l.rotation.x = Math.sin(t * 9 + (i % 2) * Math.PI) * 0.5),
    );
  });
  return (
    <Stomper {...p}>
      <mesh castShadow position={[0, 0.73, -0.04]} scale={[0.4, 0.32, 0.63]}>
        <sphereGeometry args={[1, 24, 18]} />
        <Mat
          color={p.a.color}
          map={scales}
          normalMap={scaleNormal}
          normalStrength={0.48}
          roughness={0.84}
        />
      </mesh>
      <mesh castShadow position={[0, 0.97, 0.54]} scale={[0.26, 0.24, 0.33]}>
        <sphereGeometry args={[1, 20, 16]} />
        <Mat
          color={p.a.color}
          map={scales}
          normalMap={scaleNormal}
          normalStrength={0.48}
          roughness={0.82}
        />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.2, 1.05, 0.67]}>
            <sphereGeometry args={[0.052, 12, 10]} />
            <Mat color="#d9ac49" />
          </mesh>
          <mesh position={[side * 0.207, 1.055, 0.713]} scale={[0.45, 1, 0.4]}>
            <sphereGeometry args={[0.03, 12, 10]} />
            <Mat color="#111512" />
          </mesh>
          <mesh position={[side * 0.07, 1.14, 0.53]} rotation={[0.1, 0, side * -0.2]}>
            <coneGeometry args={[0.065, 0.2, 8]} />
            <Mat
              color="#79806b"
              map={scales}
              normalMap={scaleNormal}
              normalStrength={0.48}
              roughness={0.88}
            />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.9, 0.81]} scale={[0.15, 0.07, 0.04]}>
        <sphereGeometry args={[1, 16, 10]} />
        <Mat color="#211c1a" />
      </mesh>
      <group ref={legs}>
        {[
          [-0.22, 0.4],
          [0.22, 0.4],
          [-0.22, -0.4],
          [0.22, -0.4],
        ].map(([x, z], i) => (
          <mesh key={i} castShadow position={[x, 0.3, z]}>
            <capsuleGeometry args={[0.07, 0.32, 4, 10]} />
            <Mat
              color={p.a.color}
              map={scales}
              normalMap={scaleNormal}
              normalStrength={0.48}
              roughness={0.86}
            />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 0.9, -0.7]} rotation={[-0.8, 0, 0]}>
        <coneGeometry args={[0.055, 0.72, 10]} />
        <Mat
          color={p.a.color}
          map={scales}
          normalMap={scaleNormal}
          normalStrength={0.48}
          roughness={0.88}
        />
      </mesh>
    </Stomper>
  );
}

// ---------------------------------------------------------------------------
// UFO, tornado, wave, storm
// ---------------------------------------------------------------------------

function Ufo({ a, focus: epicentre, getT, impact, hits }: ActorProps) {
  // Hover right over the house it takes.
  const taken = hits?.find((h) => h.fx === "abduct");
  const focus = taken ? { x: taken.x, z: taken.z } : epicentre;
  const ref = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh>(null);
  const lights = useRef<THREE.Group>(null);
  const s = 0.5 + a.size * 0.25;
  const hover = 4 + s;
  useFrame(() => {
    const t = getT();
    const g = ref.current;
    if (!g) return;
    let y: number;
    if (t < impact) y = 20 - (20 - hover) * ease(t / impact);
    else if (t < impact + 6) y = hover + Math.sin(t * 2) * 0.2;
    else y = hover + (t - impact - 6) ** 2 * 6;
    g.position.set(focus.x + Math.sin(t * 1.3) * 0.3, y, focus.z + Math.cos(t) * 0.3);
    g.rotation.z = Math.sin(t * 2.2) * 0.08;
    if (lights.current) lights.current.rotation.y = t * 3;
    if (beam.current) {
      const on = t > impact - 0.3 && t < impact + 5.5;
      beam.current.visible = on;
      beam.current.scale.set(1, y, 1);
      beam.current.position.set(0, -y / 2, 0);
      (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(t * 8) * 0.08;
    }
  });
  return (
    <group ref={ref} scale={s}>
      <mesh castShadow scale={[1.25, 0.18, 1.25]}>
        <sphereGeometry args={[0.9, 40, 24]} />
        <meshPhysicalMaterial color={a.color} metalness={0.82} roughness={0.24} clearcoat={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.4, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          color="#93dff0"
          roughness={0.12}
          metalness={0.18}
          clearcoat={1}
          transparent
          opacity={0.66}
        />
      </mesh>
      <mesh position={[0, -0.075, 0]}>
        <torusGeometry args={[0.91, 0.035, 12, 64]} />
        <meshStandardMaterial color="#c8d3d6" metalness={0.9} roughness={0.2} />
      </mesh>
      <group ref={lights}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh
            key={i}
            position={[
              Math.cos((i / 8) * Math.PI * 2) * 0.8,
              -0.05,
              Math.sin((i / 8) * Math.PI * 2) * 0.8,
            ]}
          >
            <sphereGeometry args={[0.06, 6, 6]} />
            <Mat color="#fffb9a" emissive="#fff27a" />
          </mesh>
        ))}
      </group>
      <mesh ref={beam}>
        <cylinderGeometry args={[0.25, 1.4, 1, 16, 1, true]} />
        <meshBasicMaterial
          color="#b6ffcf"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Tornado({ a, focus, getT, impact, seed, heading, bus }: ActorProps) {
  // The wind pulls on every building near the funnel.
  useEffect(
    () => () => {
      bus.wind = null;
    },
    [bus],
  );
  const ref = useRef<THREE.Group>(null);
  const funnel = useRef<THREE.Mesh>(null);
  const debris = useRef<THREE.InstancedMesh>(null);
  const s = 0.4 + a.size * 0.2;
  const dir = useMemo(() => {
    const ang = heading ?? hash(seed, 3) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
  }, [seed, heading]);
  const funnelGeometry = useMemo(
    () =>
      new THREE.LatheGeometry(
        [
          [0.04, 0],
          [0.35, 0.08],
          [0.72, 0.5],
          [0.92, 1.25],
          [0.78, 2.15],
          [0.63, 3.05],
          [0.86, 4.05],
          [1.35, 4.8],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        40,
      ),
    [],
  );
  const particles = useMemo(
    () =>
      Array.from({ length: 52 }, (_, i) => ({
        y: 0.12 + detail(seed, i, 79) * 4.5,
        phase: detail(seed, i, 83) * Math.PI * 2,
        radius: 0.35 + detail(seed, i, 89) * 0.85,
      })),
    [seed],
  );
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = getT();
    const total = impact + AFTERMATH * 0.7;
    const off = 12 - (24 * t) / (impact * 2);
    g.position.set(focus.x + dir.x * off, 0, focus.z + dir.z * off);
    g.visible = t < total;
    bus.wind = g.visible
      ? { x: g.position.x, z: g.position.z, radius: 2.5 + s * 1.5, strength: 0.6 + a.size * 0.08 }
      : null;
    if (funnel.current) funnel.current.rotation.y = t * 1.8;
    const m = debris.current;
    if (m) {
      particles.forEach((p, i) => {
        const angle = t * (6.2 - p.y * 0.32) + p.phase;
        tmpP.set(Math.cos(angle) * p.radius, p.y, Math.sin(angle) * p.radius);
        tmpQ.setFromEuler(new THREE.Euler(angle, angle * 0.5, 0));
        tmpM.compose(tmpP, tmpQ, tmpS.setScalar(0.055 + (i % 4) * 0.012));
        m.setMatrixAt(i, tmpM);
      });
      m.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group ref={ref} scale={s}>
      <mesh ref={funnel} geometry={funnelGeometry}>
        <meshPhysicalMaterial
          color={a.color}
          roughness={0.85}
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <instancedMesh
        ref={debris}
        args={[undefined, undefined, particles.length]}
        frustumCulled={false}
      >
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#625c53" roughness={0.96} />
      </instancedMesh>
    </group>
  );
}

function Storm({ focus, getT, impact, bus, seed, hits }: ActorProps) {
  const clouds = useRef<THREE.Group>(null);
  const bolt = useRef<THREE.Group>(null);
  const nextBolt = useRef(0);
  // Lightning lands exactly where (and when) the buildings catch fire.
  const strikes = useMemo(() => (hits ?? []).filter((h) => h.fx === "ignite"), [hits]);
  const struck = useRef(0);
  useEffect(() => {
    bus.stormUntil = bus.now + impact + AFTERMATH + 4;
  }, [bus, impact]);
  useFrame(() => {
    const t = getT();
    const k = ease(t / impact);
    clouds.current?.children.forEach((c, i) => {
      const ang = (i / 7) * Math.PI * 2 + t * 0.1;
      const r = 9 - 6 * k;
      c.position.set(focus.x + Math.cos(ang) * r, 7, focus.z + Math.sin(ang) * r);
    });
    const b = bolt.current;
    if (!b) return;
    const aimed = strikes[struck.current];
    if (aimed && t >= aimed.at - 0.05) {
      struck.current += 1;
      b.position.set(aimed.x, 0, aimed.z);
      b.userData.until = t + 0.22;
      bus.flash = 1;
      bus.shake = Math.max(bus.shake, 0.08);
      bus.quake = { x: aimed.x, z: aimed.z, amp: 0.3, until: bus.now + 0.4 };
      nextBolt.current = t + 0.4;
    } else if (t > impact - 0.4 && t > nextBolt.current) {
      const strike = Math.round(t * 10);
      nextBolt.current = t + 0.5 + detail(seed, strike, 97) * 0.8;
      b.position.set(
        focus.x + (detail(seed, strike, 101) - 0.5) * 5,
        0,
        focus.z + (detail(seed, strike, 103) - 0.5) * 5,
      );
      b.userData.until = t + 0.15;
      bus.flash = 1;
      bus.shake = Math.max(bus.shake, 0.05);
    }
    b.visible = t < (b.userData.until ?? 0);
  });
  return (
    <>
      <group ref={clouds}>
        {Array.from({ length: 7 }, (_, i) => (
          <group key={i}>
            {[
              [-1.1, 0, 0, 1.8, 0.75, 1.3],
              [0, 0.24, 0.24, 1.9, 0.95, 1.55],
              [1.12, -0.08, -0.12, 1.65, 0.78, 1.2],
              [-0.3, 0.45, -0.55, 1.25, 0.72, 1.15],
            ].map(([x, y, z, sx, sy, sz], j) => (
              <mesh key={j} position={[x, y, z]} scale={[sx, sy, sz]}>
                <sphereGeometry args={[1, 24, 16]} />
                <meshStandardMaterial color={j % 2 ? "#454e59" : "#505965"} roughness={0.97} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <group ref={bolt} visible={false}>
        <mesh position={[0.1, 2.8, 0]} rotation={[0.08, 0, 0.04]}>
          <cylinderGeometry args={[0.026, 0.045, 5.2, 6]} />
          <meshBasicMaterial color="#fffbe0" />
        </mesh>
        <mesh position={[-0.42, 3.25, 0.04]} rotation={[0.02, 0, -0.52]}>
          <cylinderGeometry args={[0.012, 0.02, 1.55, 5]} />
          <meshBasicMaterial color="#d8f4ff" />
        </mesh>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Instanced crowds of things: swarm, rain of objects, fireworks
// ---------------------------------------------------------------------------

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function Swarm({ a, focus, getT, impact, seed }: ActorProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = Math.round(a.count);
  const s = 0.1 + a.size * 0.03;
  const boids = useMemo(() => {
    const ang = hash(seed, 5) * Math.PI * 2;
    const ox = focus.x + Math.cos(ang) * 17;
    const oz = focus.z + Math.sin(ang) * 17;
    return Array.from({ length: n }, (_, i) => ({
      p: new THREE.Vector3(
        ox + (detail(seed, i, 107) - 0.5) * 3,
        2 + detail(seed, i, 109) * 3,
        oz + (detail(seed, i, 113) - 0.5) * 3,
      ),
      v: new THREE.Vector3(),
      o: detail(seed, i, 127) * 10,
    }));
  }, [n, focus, seed]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = getT();
    const m = ref.current;
    if (!m) return;
    const leaving = t > impact + AFTERMATH - 2;
    boids.forEach((b, i) => {
      const goal = new THREE.Vector3(
        focus.x + Math.cos(t * 1.5 + b.o) * (t > impact ? 1.5 + (i % 5) * 0.3 : 0),
        1 + (i % 7) * 0.35 + Math.sin(t * 3 + b.o) * 0.3,
        focus.z + Math.sin(t * 1.5 + b.o) * (t > impact ? 1.5 + (i % 5) * 0.3 : 0),
      );
      if (leaving) goal.set(b.p.x * 3, 8, b.p.z * 3);
      const steer = goal.sub(b.p).multiplyScalar(1.4);
      b.v.addScaledVector(steer, dt).multiplyScalar(0.97);
      const sp = b.v.length();
      if (sp > 7) b.v.multiplyScalar(7 / sp);
      b.p.addScaledVector(b.v, dt);
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.v.clone().normalize());
      tmpM.compose(b.p, tmpQ, tmpS.set(s, s, s));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
      <ShapeGeometry shape={a.shape === "blob" ? "cone" : a.shape} />
      <Mat color={a.color} />
    </instancedMesh>
  );
}

function RainOf({ a, focus, getT, radius, seed }: ActorProps & { radius: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = Math.round(a.count);
  const s = 0.12 + a.size * 0.05;
  const items = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const r = Math.sqrt(detail(seed, i, 131)) * (radius + 1.5);
        const ang = detail(seed, i, 137) * Math.PI * 2;
        return {
          x: focus.x + Math.cos(ang) * r,
          z: focus.z + Math.sin(ang) * r,
          delay: detail(seed, i, 139) * 2.4,
          spin: detail(seed, i, 149) * 6,
        };
      }),
    [n, focus, radius, seed],
  );
  useFrame(() => {
    const t = getT();
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      const lt = t - it.delay;
      if (lt < 0) {
        m.setMatrixAt(i, HIDDEN);
        return;
      }
      const y = Math.max(s * 0.5, 14 - lt * lt * 9);
      const landed = y <= s * 0.5;
      const fade = Math.max(0, Math.min(1, (AFTERMATH + 2 - lt) / 2));
      tmpQ.setFromEuler(new THREE.Euler(landed ? 0.3 : lt * it.spin, lt * it.spin, 0));
      tmpM.compose(new THREE.Vector3(it.x, y, it.z), tmpQ, tmpS.setScalar(s * fade));
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow frustumCulled={false}>
      <ShapeGeometry shape={a.shape} />
      <Mat color={a.color} />
    </instancedMesh>
  );
}

function Fireworks({ a, focus, getT, seed }: ActorProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const BURSTS = 8;
  const PER = 36;
  const bursts = useMemo(
    () =>
      Array.from({ length: BURSTS }, (_, b) => ({
        at: 0.4 + b * 0.9,
        x: focus.x + (detail(seed, b, 151) - 0.5) * 6,
        y: 6 + detail(seed, b, 157) * 3,
        z: focus.z + (detail(seed, b, 163) - 0.5) * 6,
        hue:
          b % 2 && a.color
            ? new THREE.Color(a.color).getHSL({ h: 0, s: 0, l: 0 }).h
            : detail(seed, b, 167),
        dirs: Array.from({ length: PER }, (_, i) => {
          const y = detail(seed, b * PER + i, 173) * 2 - 1;
          const angle = detail(seed, b * PER + i, 179) * Math.PI * 2;
          const ring = Math.sqrt(1 - y * y);
          return new THREE.Vector3(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
        }),
      })),
    [focus, a.color, seed],
  );
  useFrame(() => {
    const t = getT();
    const m = ref.current;
    if (!m) return;
    let k = 0;
    for (const b of bursts) {
      const lt = t - b.at;
      for (const d of b.dirs) {
        if (lt < 0 || lt > 1.8) m.setMatrixAt(k, HIDDEN);
        else {
          const r = lt * 2.2;
          tmpM.makeTranslation(b.x + d.x * r, b.y + d.y * r - lt * lt * 0.8, b.z + d.z * r);
          m.setMatrixAt(
            k,
            tmpM.multiply(new THREE.Matrix4().makeScale(1 - lt / 1.8, 1 - lt / 1.8, 1 - lt / 1.8)),
          );
          m.setColorAt(k, tmpC.setHSL(b.hue, 1, 0.6));
        }
        k++;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, BURSTS * PER]} frustumCulled={false}>
      <sphereGeometry args={[0.07, 5, 4]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Impact: dust ring and flying debris
// ---------------------------------------------------------------------------

function ImpactBurst({
  focus,
  getT,
  impact,
  size,
  color,
  seed,
  fiery = false,
}: {
  focus: { x: number; z: number };
  getT: () => number;
  impact: number;
  size: number;
  color: string;
  seed: number;
  /** A meteor: a fireball and a column of smoke as well. */
  fiery?: boolean;
}) {
  const since = () => getT() - impact;
  const ring = useRef<THREE.Mesh>(null);
  const debris = useRef<THREE.InstancedMesh>(null);
  const watery = color === "#d8f0ff";
  const parts = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        v: new THREE.Vector3(
          (detail(seed, i, 181) - 0.5) * 6,
          3 + detail(seed, i, 191) * 5,
          (detail(seed, i, 193) - 0.5) * 6,
        ).multiplyScalar(0.4 + size * 0.1),
        r: detail(seed, i, 197) * 6,
      })),
    [size, seed],
  );
  useFrame(() => {
    const lt = getT() - impact;
    if (ring.current) {
      ring.current.visible = lt > 0 && lt < 1.6;
      ring.current.scale.setScalar(0.5 + lt * (2 + size));
      (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        0.6 * (1 - lt / 1.6),
      );
    }
    const m = debris.current;
    if (!m) return;
    parts.forEach((p, i) => {
      if (lt < 0 || lt > 2.5) {
        m.setMatrixAt(i, HIDDEN);
        return;
      }
      const y = Math.max(0.05, p.v.y * lt - 4.9 * lt * lt);
      tmpQ.setFromEuler(new THREE.Euler(lt * p.r, lt * p.r, 0));
      tmpM.compose(
        new THREE.Vector3(focus.x + p.v.x * lt, y, focus.z + p.v.z * lt),
        tmpQ,
        tmpS.setScalar(0.12),
      );
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <mesh ref={ring} position={[focus.x, 0.1, focus.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={debris} args={[undefined, undefined, parts.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </instancedMesh>
      {watery ? (
        <>
          {/* Spray thrown up and falling back, then a drifting mist. */}
          <Puffs
            getT={since}
            origin={[focus.x, 0.2, focus.z]}
            count={70}
            duration={1.9}
            stagger={0.25}
            spread={1.4 + size * 0.35}
            rise={5.5 + size * 0.5}
            fall={5}
            size={[0.25, 0.9]}
            color="#f2fbff"
            opacity={0.95}
            seed={seed}
          />
          <Puffs
            getT={since}
            origin={[focus.x, 0.3, focus.z]}
            count={34}
            duration={5}
            stagger={0.8}
            spread={2 + size * 0.4}
            rise={0.8}
            size={[0.8, 2.6 + size * 0.3]}
            color="#e6f3f7"
            opacity={0.45}
            seed={seed + 1}
          />
        </>
      ) : (
        // A billowing dust cloud rolling out from the impact.
        <Puffs
          getT={since}
          origin={[focus.x, 0.15, focus.z]}
          count={80}
          duration={5.5}
          stagger={0.5}
          spread={1.6 + size * 0.45}
          rise={1.2 + size * 0.25}
          size={[0.5 + size * 0.08, 1.9 + size * 0.35]}
          color="#b3a58e"
          opacity={0.85}
          seed={seed}
        />
      )}
      {fiery && (
        <>
          <Puffs
            getT={since}
            origin={[focus.x, 0.4, focus.z]}
            count={40}
            duration={1.3}
            stagger={0.12}
            spread={1.4 + size * 0.25}
            rise={2.2}
            size={[0.6, 2.1]}
            color="#ff8a3a"
            opacity={0.75}
            additive
            seed={seed + 2}
          />
          <Puffs
            getT={since}
            origin={[focus.x, 0.6, focus.z]}
            count={70}
            duration={7}
            stagger={3.5}
            spread={0.9}
            rise={5.5}
            size={[0.7, 3]}
            color="#3a3430"
            opacity={0.8}
            seed={seed + 3}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Custom actors: a ready-made model (kept exactly as authored, with its own
// PBR materials) or Claude's own recipe of primitives. Both move like their
// built-in stand-in.
// ---------------------------------------------------------------------------

const WALKERS = new Set<ActorKind>(["kaiju", "creature"]);
const FLYERS = new Set<ActorKind>(["ufo", "hot_air_balloon", "swarm", "storm", "fireworks"]);

type Fit = "max" | "width" | "height";

/** Scale an object so one dimension spans `span` units, resting on the ground. */
function normalise(o: THREE.Object3D, fit: Fit = "max", span = 1.2) {
  const box = new THREE.Box3().setFromObject(o);
  const size = box.getSize(new THREE.Vector3());
  const measured =
    fit === "height"
      ? size.y
      : fit === "width"
        ? Math.max(size.x, size.z)
        : Math.max(size.x, size.y, size.z);
  const k = span / Math.max(measured, 0.001);
  const centre = box.getCenter(new THREE.Vector3());
  o.scale.setScalar(k);
  o.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
}

/**
 * A ready-made model, kept as authored with its own PBR materials and sized
 * to the actor. Animated models loop a clip (the first, unless named).
 */
function ModelMesh({
  url,
  turn = 0,
  fit = "max",
  span = 1.2,
  clip,
}: {
  url: string;
  turn?: number;
  fit?: Fit;
  span?: number;
  clip?: string;
}) {
  const { scene, animations } = useGLTF(url, true, true, withSpecGloss);
  const object = useMemo(() => {
    // SkeletonUtils keeps skinned (animated) meshes bound to their own bones.
    const o = cloneSkinned(scene);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // Skinned meshes move away from their bind-pose bounds.
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
    });
    normalise(o, fit, span);
    const turned = new THREE.Group();
    turned.rotation.y = turn;
    turned.add(o);
    return turned;
  }, [scene, turn, fit, span]);
  const mixer = useMemo(
    () => (animations.length ? new THREE.AnimationMixer(object) : null),
    [object, animations],
  );
  useEffect(() => {
    if (!mixer) return;
    const chosen = (clip && animations.find((a) => a.name === clip)) || animations[0];
    mixer.clipAction(chosen).play();
    return () => void mixer.stopAllAction();
  }, [mixer, animations, clip]);
  useFrame((_, dt) => mixer?.update(Math.min(dt, 0.05)));
  return <primitive object={object} />;
}

const RECIPE_GEOMETRY: Record<RecipeShape, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 12, 8),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  cone: () => new THREE.ConeGeometry(0.5, 1, 12),
  torus: () => new THREE.TorusGeometry(0.4, 0.1, 8, 20),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 4, 10).scale(1, 0.5, 1),
};

/** Claude's design, built from primitives in the city's flat-shaded style. */
function RecipeMesh({ recipe }: { recipe: Recipe }) {
  const object = useMemo(() => {
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    const geos = new Map<RecipeShape, THREE.BufferGeometry>();
    const mats = new Map<string, THREE.Material>();
    const d = THREE.MathUtils.degToRad;
    for (const p of recipe.parts) {
      if (!geos.has(p.shape)) geos.set(p.shape, RECIPE_GEOMETRY[p.shape]());
      if (!mats.has(p.color))
        mats.set(
          p.color,
          new THREE.MeshStandardMaterial({ color: p.color, flatShading: true, roughness: 0.7 }),
        );
      const m = new THREE.Mesh(geos.get(p.shape), mats.get(p.color));
      m.position.set(p.x, p.y, p.z);
      m.scale.set(p.sx, p.sy, p.sz);
      m.rotation.set(d(p.rx), d(p.ry), d(p.rz));
      m.castShadow = true;
      inner.add(m);
    }
    normalise(inner);
    return root;
  }, [recipe]);
  useEffect(
    () => () =>
      object.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }),
    [object],
  );
  return <primitive object={object} />;
}

function Spin({ getT, children }: { getT: () => number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = getT() * 3;
  });
  return <group ref={ref}>{children}</group>;
}

/** Sparkles to announce a model fresh from the studio. */
function StudioSparkle({ getT }: { getT: () => number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = getT();
    ref.current?.children.forEach((c, i) => {
      const a = t * 2 + (i / 10) * Math.PI * 2;
      c.position.set(Math.cos(a) * 1.1, 0.3 + ((t * 0.8 + i * 0.13) % 1.6), Math.sin(a) * 1.1);
      c.visible = t < 6;
    });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i}>
          <octahedronGeometry args={[0.06, 0]} />
          <meshBasicMaterial color="#fff27a" />
        </mesh>
      ))}
    </group>
  );
}

function Hover({ a, focus, getT, impact, children }: ActorProps & { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const s = 0.5 + a.size * 0.3;
  useFrame(() => {
    const t = getT();
    const g = ref.current;
    if (!g) return;
    const y = t < impact ? 14 - (14 - 3) * ease(t / impact) : 3 + Math.sin(t * 1.5) * 0.25;
    g.position.set(focus.x, y, focus.z);
    g.rotation.y = t * 0.4;
    g.scale.setScalar(s);
  });
  return <group ref={ref}>{children}</group>;
}

/** Falls back to the stand-in if a model can't be loaded (gone, bad file, offline). */
class ModelBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("Custom actor model failed to load", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function CustomActor(p: ActorProps) {
  const { a } = p;
  const motion = a.recipe?.motion;
  // Claude's recipe stands in while a ready-made model downloads, and stays
  // if the download fails.
  const standIn = a.recipe?.parts.length ? <RecipeMesh recipe={a.recipe} /> : null;
  const body = (
    <>
      {a.model_url ? (
        <ModelBoundary key={a.model_url} fallback={standIn}>
          <Suspense fallback={standIn}>
            <ModelMesh url={a.model_url} />
          </Suspense>
        </ModelBoundary>
      ) : (
        standIn
      )}
      {a.fresh && <StudioSparkle getT={p.getT} />}
    </>
  );
  if (motion === "walk" || (!motion && WALKERS.has(a.kind)))
    return <Stomper {...p}>{body}</Stomper>;
  if (motion === "hover" || (!motion && FLYERS.has(a.kind))) return <Hover {...p}>{body}</Hover>;
  if (motion === "spin")
    return (
      <Faller {...p}>
        <Spin getT={p.getT}>{body}</Spin>
      </Faller>
    );
  return <Faller {...p}>{body}</Faller>;
}

const HITS_GROUND = new Set<ActorKind>([
  "sinkhole",
  "landslide",
  "whale",
  "meteor",
  "giant_object",
  "kaiju",
  "creature",
  "tornado",
  "rift",
  "earthquake",
]);

/** The component that plays one actor. */
/** The hand-built actor for a kind. */
function proceduralActor(p: ActorProps, radius: number): React.ReactNode {
  switch (p.a.kind) {
    case "whale":
      return <Whale {...p} />;
    case "giant_object":
      return <GiantObject {...p} />;
    case "meteor":
      return <Meteor {...p} />;
    case "kaiju":
      return <Kaiju {...p} />;
    case "creature":
      return <Creature {...p} />;
    case "ufo":
      return <Ufo {...p} />;
    case "tornado":
      return <Tornado {...p} />;
    case "wave":
    case "flood":
      return <SurgeActor {...p} />;
    case "wildfire":
      return <Wildfire {...p} />;
    case "storm":
      return <Storm {...p} />;
    case "swarm":
      return <Swarm {...p} />;
    case "rain_of":
      return <RainOf {...p} radius={radius} />;
    case "fireworks":
      return <Fireworks {...p} />;
    default: {
      const Lib = ACTOR_LIBRARY[p.a.kind as keyof typeof ACTOR_LIBRARY];
      return Lib ? <Lib {...p} /> : null;
    }
  }
}

/**
 * A built-in actor played by its real model (see realModels.ts), moving the
 * way its kind moves. The procedural actor stands in while the model loads,
 * and stays if it can't be loaded.
 */
function RealActor({
  p,
  model,
  fallback,
}: {
  p: ActorProps;
  model: RealModel;
  fallback: React.ReactNode;
}) {
  const body = (
    <ModelMesh
      url={p.a.model_url!}
      turn={model.turn}
      fit={model.fit}
      span={model.span}
      clip={model.clip}
    />
  );
  const moving = WALKERS.has(p.a.kind) ? (
    <Stomper {...p}>{body}</Stomper>
  ) : FLYERS.has(p.a.kind) ? (
    <Hover {...p}>{body}</Hover>
  ) : (
    <Faller {...p}>{body}</Faller>
  );
  return (
    <ModelBoundary key={p.a.model_url} fallback={fallback}>
      <Suspense fallback={fallback}>{moving}</Suspense>
    </ModelBoundary>
  );
}

/** The component that plays one actor. */
function ActorFor({ p, radius }: { p: ActorProps; radius: number }) {
  const { a } = p;
  const real = !a.model_key && a.model_url ? REAL_MODELS[a.kind] : undefined;
  // The meteor keeps its fiery fall and trail; only its rock becomes real.
  if (real && a.kind === "meteor") return <Meteor {...p} body={real} />;
  if (real) return <RealActor p={p} model={real} fallback={proceduralActor(p, radius)} />;
  if (a.model_url || a.recipe?.parts.length) return <CustomActor {...p} />;
  return proceduralActor(p, radius);
}

export function SpectacleView({
  run,
  bus,
  onImpact,
  onReveal,
  onDone,
}: {
  run: SpectacleRun;
  bus: WorldBus;
  /** Called once every tile has changed: the event's full result can land. */
  onImpact: (id: number) => void;
  /** Tiles whose damage has just arrived. */
  onReveal?: (id: number, hits: TileHit[]) => void;
  onDone: (id: number) => void;
}) {
  const start = useRef<number | null>(null);
  const fired = useRef(false);
  const committed = useRef(false);
  const revealed = useRef(0);
  const lastReveal = useRef(-1);
  const impact = impactTime(run.actors);
  const hits = useMemo(
    () => (run.before && run.after ? planHits(run.before, run.after, run.actors, impact) : []),
    // The plan depends on the kinds of actors, not on models swapped in later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.before, run.after, impact],
  );
  const done = useRef(false);
  // Spectacle time advances at most 0.1 s a frame: a stalled frame (say,
  // compiling a new model's shaders) pauses the show instead of skipping it.
  const elapsed = useRef(0);
  const getT = () => elapsed.current;
  const primary = run.actors[0];

  useFrame(({ clock }, delta) => {
    if (start.current === null) {
      start.current = clock.elapsedTime;
      // Tell the page the scene is running, so it waits for the show.
      onReveal?.(run.id, []);
    } else elapsed.current += Math.min(delta, 0.1);
    const t = getT();
    const now = clock.elapsedTime;
    // Damage arrives tile by tile, batched so the town redraws a few times a second.
    if (revealed.current < hits.length && t - lastReveal.current >= 0.12) {
      const due: TileHit[] = [];
      while (revealed.current < hits.length && hits[revealed.current].at <= t)
        due.push(hits[revealed.current++]);
      if (due.length) {
        lastReveal.current = t;
        onReveal?.(run.id, due);
      }
    }
    if (!committed.current && t >= impact && (revealed.current >= hits.length || !onReveal)) {
      committed.current = true;
      onImpact(run.id);
    }
    if (!fired.current && t >= impact) {
      fired.current = true;
      const big = primary ? primary.size : 2;
      if (primary && HITS_GROUND.has(primary.kind) && primary.kind !== "earthquake")
        bus.quake = { x: run.focus.x, z: run.focus.z, amp: 0.4 + big * 0.08, until: bus.now + 1.2 };
      bus.shake = Math.max(
        bus.shake,
        primary && HITS_GROUND.has(primary.kind) ? 0.08 + big * 0.04 : 0.05,
      );
      const { x, z } = run.focus;
      const r = run.radius;
      if (run.crowd === "flee") {
        bus.disturbances.push({ x, z, radius: r, mode: "flee", start: now, until: now + 5 });
        // Once the danger passes, onlookers drift back to gawk.
        bus.disturbances.push({ x, z, radius: r, mode: "gather", start: now + 5, until: now + 12 });
      } else if (run.crowd === "gather") {
        bus.disturbances.push({ x, z, radius: r, mode: "gather", start: now, until: now + 12 });
      } else if (run.crowd === "celebrate") {
        bus.disturbances.push({ x, z, radius: r, mode: "celebrate", start: now, until: now + 12 });
        bus.disturbances.push({ x, z, radius: r, mode: "gather", start: now, until: now + 12 });
      }
      for (const resp of run.responders) {
        bus.spawns.push({
          color: RESPONDER_COLOR[resp],
          count: 3,
          size: resp === "fire" || resp === "agents" ? 1.3 : 1,
          flashing: resp !== "cleanup" && resp !== "agents",
          x,
          z,
          until: now + 16,
        });
      }
      for (const a of run.actors.filter(
        (act) => act.kind === "convoy" || act.kind === "black_vans",
      )) {
        bus.spawns.push({
          // The lab's vans are always black.
          color: a.kind === "black_vans" ? "#121316" : a.color,
          count: Math.min(12, Math.round(a.count)),
          size: 0.8 + a.size * 0.15,
          flashing: false,
          x,
          z,
          until: now + AFTERMATH + 4,
        });
      }
    }
    if (!done.current && t >= impact + AFTERMATH) {
      done.current = true;
      onDone(run.id);
    }
  });

  return (
    <group>
      {run.actors.map((a, i) => (
        // An actor whose texture is still downloading must not take the whole
        // city down with it: it simply appears once its texture arrives.
        <Suspense key={i} fallback={null}>
          <ActorFor
            p={{
              a,
              focus: run.focus,
              getT,
              impact: i === 0 ? impact : IMPACT_AT[a.kind],
              bus,
              seed: run.id * 31 + i,
              heading: run.heading,
              surge: run.surge,
              hits,
            }}
            radius={run.radius}
          />
        </Suspense>
      ))}
      {primary && HITS_GROUND.has(primary.kind) && (
        <ImpactBurst
          focus={run.focus}
          getT={getT}
          impact={impact}
          size={primary.size}
          seed={run.id}
          color={primary.kind === "whale" || primary.kind === "wave" ? "#d8f0ff" : "#c9b89c"}
          fiery={primary.kind === "meteor"}
        />
      )}
      {hits.length > 0 && <RippleFx hits={hits} getT={getT} bus={bus} seed={run.id} />}
    </group>
  );
}
