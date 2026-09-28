import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { seasonOf } from "@/lib/island/sim";
import { wx, wz, type LandmarkId, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";
import { env } from "./fx/env";
import { eruptBus } from "./Eruption";
import { Puffs } from "./fx/vfx";

const clock0 = typeof performance !== "undefined" ? performance.now() : 0;
const loop = () => (performance.now() - clock0) / 1000;

const BONE = "#e9e0c8";
const STONE = "#8d877c";

function Bone({
  p,
  s,
  r = [0, 0, 0],
}: {
  p: [number, number, number];
  s: [number, number, number];
  r?: [number, number, number];
}) {
  return (
    <mesh position={p} rotation={r} scale={s} castShadow>
      <capsuleGeometry args={[0.5, 1, 3, 6]} />
      <meshStandardMaterial color={BONE} roughness={0.7} />
    </mesh>
  );
}

/** A long-dead titan lying in the grass: spine, ribs and a skull. */
function Skeleton({ seed }: { seed: number }) {
  const ribs = Array.from({ length: 9 }, (_, k) => k);
  return (
    <group rotation-y={hash(seed, 1) * Math.PI * 2}>
      {Array.from({ length: 16 }, (_, k) => (
        <Bone
          key={`v${k}`}
          p={[-1.6 + k * 0.22, 0.12 + Math.sin(k / 3) * 0.05, 0]}
          s={[0.12, 0.1, 0.12]}
          r={[0, 0, Math.PI / 2]}
        />
      ))}
      {ribs.map((k) => (
        <group key={`r${k}`} position={[-0.8 + k * 0.18, 0.1, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <torusGeometry args={[0.38 - Math.abs(k - 4) * 0.03, 0.035, 5, 12, Math.PI]} />
            <meshStandardMaterial color={BONE} roughness={0.7} />
          </mesh>
        </group>
      ))}
      <Bone p={[1.95, 0.22, 0]} s={[0.26, 0.2, 0.2]} r={[0, 0, Math.PI / 2]} />
      <Bone p={[-1.5, 0.08, 0.35]} s={[0.1, 0.5, 0.1]} r={[0.4, 0, Math.PI / 2 - 0.2]} />
      <Bone p={[-1.3, 0.08, -0.4]} s={[0.1, 0.45, 0.1]} r={[-0.3, 0, Math.PI / 2 + 0.3]} />
    </group>
  );
}

/** Mossy ruins in the jungle that nobody on the island remembers building. */
function Ruins({ seed }: { seed: number }) {
  return (
    <group rotation-y={hash(seed, 2) * Math.PI}>
      {[1.2, 0.95, 0.7, 0.45].map((w, k) => (
        <mesh key={k} position={[0, 0.12 + k * 0.22, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.22, w]} />
          <meshStandardMaterial color={k % 2 ? "#7c7a66" : "#6f6f5a"} roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[0.28, 0.3, 0.28]} />
        <meshStandardMaterial color="#5c6a4a" roughness={0.95} />
      </mesh>
      {Array.from({ length: 5 }, (_, k) => {
        const a = (k / 5) * Math.PI * 2;
        const h = 0.3 + hash(seed, k, 3) * 0.5;
        return (
          <mesh
            key={`c${k}`}
            position={[Math.cos(a) * 1.3, h / 2, Math.sin(a) * 1.3]}
            rotation-z={(hash(seed, k, 4) - 0.5) * 0.4}
            castShadow
          >
            <cylinderGeometry args={[0.09, 0.11, h, 7]} />
            <meshStandardMaterial color="#8b8a74" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Glowing crystal clusters at the mouth of a cave. */
function Crystals({ seed }: { seed: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const glow = env.night ? 2.2 : 0.8;
    ref.current?.children.forEach((c, k) => {
      const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (m?.emissiveIntensity !== undefined)
        m.emissiveIntensity = glow * (0.8 + Math.sin(loop() * 1.3 + k) * 0.2);
    });
  });
  return (
    <group>
      <mesh position={[0, 0.25, -0.3]} scale={[0.8, 0.55, 0.5]}>
        <sphereGeometry args={[0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#141214" roughness={1} />
      </mesh>
      <group ref={ref}>
        {Array.from({ length: 9 }, (_, k) => {
          const a = hash(seed, k, 5) * Math.PI * 2;
          const r = 0.2 + hash(seed, k, 6) * 0.5;
          const h = 0.25 + hash(seed, k, 7) * 0.5;
          const purple = k % 3 === 0;
          return (
            <mesh
              key={k}
              position={[Math.cos(a) * r, h / 2, Math.sin(a) * r + 0.2]}
              rotation={[(hash(seed, k, 8) - 0.5) * 0.8, 0, (hash(seed, k, 9) - 0.5) * 0.8]}
            >
              <octahedronGeometry args={[h * 0.35, 0]} />
              <meshStandardMaterial
                color={purple ? "#c9a2ff" : "#9ef2ff"}
                emissive={purple ? "#8a4dff" : "#39d7ff"}
                emissiveIntensity={1}
                roughness={0.2}
                metalness={0.1}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Steaming turquoise pools. */
function Springs({ seed }: { seed: number }) {
  return (
    <group>
      {Array.from({ length: 4 }, (_, k) => {
        const a = hash(seed, k, 10) * Math.PI * 2;
        const r = 0.3 + hash(seed, k, 11) * 0.9;
        return (
          <group key={k} position={[Math.cos(a) * r, 0.04, Math.sin(a) * r]}>
            <mesh rotation-x={-Math.PI / 2}>
              <circleGeometry args={[0.28 + hash(seed, k, 12) * 0.2, 16]} />
              <meshStandardMaterial
                color="#5fd6d0"
                emissive="#1c7c7a"
                emissiveIntensity={0.4}
                roughness={0.15}
              />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
              <ringGeometry args={[0.28, 0.4, 16]} />
              <meshStandardMaterial color="#e6d7a2" roughness={0.8} />
            </mesh>
          </group>
        );
      })}
      <Puffs
        getT={loop}
        origin={[0, 0.1, 0]}
        count={30}
        duration={4}
        spread={1.2}
        rise={1.8}
        size={[0.3, 1.2]}
        color="#f4f6f6"
        opacity={0.5}
        loop
        seed={seed}
      />
    </group>
  );
}

/** Nest mounds, with eggs in the wet season. */
function Nests({ seed, eggs }: { seed: number; eggs: boolean }) {
  return (
    <group>
      {Array.from({ length: 7 }, (_, k) => {
        const a = hash(seed, k, 13) * Math.PI * 2;
        const r = 0.4 + hash(seed, k, 14) * 1.4;
        return (
          <group key={k} position={[Math.cos(a) * r, 0.02, Math.sin(a) * r]}>
            <mesh rotation-x={-Math.PI / 2} castShadow>
              <torusGeometry args={[0.2, 0.08, 5, 10]} />
              <meshStandardMaterial color="#7a5d3a" roughness={1} />
            </mesh>
            {eggs &&
              [0, 1, 2].map((e) => (
                <mesh
                  key={e}
                  position={[Math.cos(e * 2.1) * 0.07, 0.07, Math.sin(e * 2.1) * 0.07]}
                  scale={[0.06, 0.08, 0.06]}
                >
                  <sphereGeometry args={[1, 8, 6]} />
                  <meshStandardMaterial color={e === 1 ? "#d9d0b8" : "#c6d1b2"} roughness={0.6} />
                </mesh>
              ))}
          </group>
        );
      })}
    </group>
  );
}

/** Standing stones: a gateway on the migration pass, a ring on the Sacred Mountain. */
function Stones({ seed, ring }: { seed: number; ring: boolean }) {
  const n = ring ? 8 : 2;
  return (
    <group>
      {Array.from({ length: n }, (_, k) => {
        const a = ring ? (k / n) * Math.PI * 2 : k * Math.PI;
        const r = ring ? 0.8 : 0.7;
        const h = 0.5 + hash(seed, k, 15) * 0.4;
        return (
          <mesh
            key={k}
            position={[Math.cos(a) * r, h / 2, Math.sin(a) * r]}
            rotation-y={-a}
            castShadow
          >
            <boxGeometry args={[0.18, h, 0.1]} />
            <meshStandardMaterial color={STONE} roughness={0.95} />
          </mesh>
        );
      })}
      {!ring && (
        <mesh position={[0, 0.95, 0]} castShadow>
          <boxGeometry args={[1.7, 0.12, 0.12]} />
          <meshStandardMaterial color={STONE} roughness={0.95} />
        </mesh>
      )}
    </group>
  );
}

/** Predator Ridge's lair: a cave mouth with bones scattered outside. */
function Lair({ seed }: { seed: number }) {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} scale={[1, 0.7, 0.6]}>
        <sphereGeometry args={[0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#0f0d0c" roughness={1} />
      </mesh>
      {Array.from({ length: 6 }, (_, k) => (
        <Bone
          key={k}
          p={[(hash(seed, k, 16) - 0.5) * 1.4, 0.04, 0.5 + hash(seed, k, 17) * 0.6]}
          s={[0.05, 0.18, 0.05]}
          r={[Math.PI / 2, hash(seed, k, 18) * 3, 0]}
        />
      ))}
    </group>
  );
}

/** The volcano's plume, and the glow of the crater at night. */
function Plume({ ash }: { ash: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    // While the eruption plays, its own column takes over.
    if (group.current) group.current.visible = !eruptBus.active;
    if (light.current)
      light.current.intensity = (env.night ? 30 : 8) * (0.85 + Math.sin(loop() * 3) * 0.15);
  });
  return (
    <group>
      <pointLight ref={light} color="#ff6a2a" distance={14} decay={1.5} position={[0, 1, 0]} />
      <group ref={group}>
        <Puffs
          getT={loop}
          origin={[0, 0.5, 0]}
          count={ash ? 90 : 45}
          duration={ash ? 9 : 7}
          spread={ash ? 3 : 1.4}
          rise={ash ? 14 : 8}
          size={ash ? [1.4, 5] : [0.8, 3]}
          color={ash ? "#3e3733" : "#8c8680"}
          opacity={ash ? 0.85 : 0.55}
          loop
          seed={11}
        />
        <Puffs
          getT={loop}
          origin={[0, 0.2, 0]}
          count={16}
          duration={1.2}
          spread={0.6}
          rise={1.2}
          size={[0.3, 0.8]}
          color="#ff7a2a"
          opacity={0.7}
          additive
          loop
          seed={12}
        />
      </group>
    </group>
  );
}

/** Low mist hanging over the wetlands. */
function Mist({ seed }: { seed: number }) {
  return (
    <group>
      {Array.from({ length: 5 }, (_, k) => (
        <Puffs
          key={k}
          getT={loop}
          origin={[(hash(seed, k, 19) - 0.5) * 10, 0.3, (hash(seed, k, 20) - 0.5) * 8]}
          count={18}
          duration={9}
          spread={3}
          rise={0.4}
          size={[1.5, 3.5]}
          color="#e7eee9"
          opacity={0.32}
          loop
          seed={seed + k}
        />
      ))}
    </group>
  );
}

/** A rainbow in the spray of Thunder Falls. */
function Rainbow() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current)
      (ref.current.material as THREE.MeshBasicMaterial).opacity =
        env.daylight * 0.22 * (env.raining ? 0.3 : 1);
  });
  return (
    <mesh ref={ref} position={[0, 0, 0]} rotation-y={0.4}>
      <torusGeometry args={[2.2, 0.12, 6, 32, Math.PI]} />
      <meshBasicMaterial color="#ffd8f0" transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

/** Black tar pits with the odd bubble. */
function Tar({ seed }: { seed: number }) {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <circleGeometry args={[0.42, 14]} />
        <meshStandardMaterial color="#0c0a09" roughness={0.12} metalness={0.3} />
      </mesh>
      <Puffs
        getT={loop}
        origin={[0, 0.05, 0]}
        count={4}
        duration={2}
        spread={0.2}
        rise={0.2}
        size={[0.05, 0.12]}
        color="#1a1614"
        opacity={0.9}
        loop
        seed={seed}
      />
    </group>
  );
}

export function Landmarks({ tiles, day, ash }: { tiles: Tile[]; day: number; ash: boolean }) {
  const spots = useMemo(() => {
    const out: { id: LandmarkId; i: number }[] = [];
    tiles.forEach((t, i) => t.landmark && out.push({ id: t.landmark, i }));
    return out;
  }, [tiles]);
  const tarPits = useMemo(() => {
    const out: number[] = [];
    tiles.forEach((t, i) => t.biome === "tar" && hash(i, 31) < 0.35 && out.push(i));
    return out.slice(0, 18);
  }, [tiles]);
  const eggs = seasonOf(day) === "wet";
  return (
    <group>
      {spots.map(({ id, i }) => {
        const x = wx(i);
        const z = wz(i);
        const y = heightAt(tiles, x, z);
        let node: React.ReactNode = null;
        switch (id) {
          case "great_volcano":
            node = <Plume ash={ash} />;
            break;
          case "skeleton_field":
            node = <Skeleton seed={i} />;
            break;
          case "sunken_jungle":
            node = <Ruins seed={i} />;
            break;
          case "crystal_caves":
            node = <Crystals seed={i} />;
            break;
          case "geothermal_springs":
            node = <Springs seed={i} />;
            break;
          case "nesting_grounds":
            node = <Nests seed={i} eggs={eggs} />;
            break;
          case "migration_pass":
            node = <Stones seed={i} ring={false} />;
            break;
          case "sacred_mountain":
            node = <Stones seed={i} ring />;
            break;
          case "predator_ridge":
            node = <Lair seed={i} />;
            break;
          case "misty_wetlands":
            node = <Mist seed={i} />;
            break;
          case "thunder_falls":
            node = <Rainbow />;
            break;
          case "fossil_canyon":
            node = <Skeleton seed={i + 7} />;
            break;
        }
        return node ? (
          <group key={id} position={[x, y, z]}>
            {node}
          </group>
        ) : null;
      })}
      {tarPits.map((i) => (
        <group key={`tar${i}`} position={[wx(i), heightAt(tiles, wx(i), wz(i)), wz(i)]}>
          <Tar seed={i} />
        </group>
      ))}
    </group>
  );
}
