import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { LabelSpec } from "./Labels";
import * as THREE from "three";
import type { Landmark, Tile } from "@/lib/city/types";
import { tileX, tileZ } from "./common";
import { Puffs } from "./vfx";
import { LandmarkMesh, Mat } from "./Landmarks";
import { UpsideContext } from "./upside";

/** A burning building: flickering flames and a column of smoke, as soft particles. */
function Fire({ seed, y }: { seed: number; y: number }) {
  const clock = useRef(0);
  useFrame((state) => {
    clock.current = state.clock.elapsedTime;
  });
  const now = () => clock.current + seed;
  return (
    <group position={[0, y, 0]}>
      <Puffs
        getT={now}
        origin={[0, 0.05, 0]}
        count={22}
        duration={0.85}
        spread={0.35}
        rise={1.1}
        size={[0.55, 0.14]}
        color="#ff8a2e"
        additive
        loop
        seed={seed}
      />
      <Puffs
        getT={now}
        origin={[0, 0.1, 0]}
        count={10}
        duration={0.6}
        spread={0.2}
        rise={0.6}
        size={[0.35, 0.1]}
        color="#ffd36a"
        additive
        loop
        seed={seed + 7}
      />
      <Puffs
        getT={now}
        origin={[0, 0.7, 0]}
        count={26}
        duration={5}
        spread={0.9}
        rise={3.6}
        size={[0.45, 2.2]}
        color="#403a36"
        opacity={0.7}
        loop
        seed={seed + 13}
      />
    </group>
  );
}

function Rubble({ seed }: { seed: number }) {
  const bits = useMemo(() => {
    let r = seed * 9301 + 49297;
    const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
    return Array.from({ length: 5 }, () => ({
      p: [rnd() * 0.6 - 0.3, 0.06, rnd() * 0.6 - 0.3] as [number, number, number],
      s: 0.08 + rnd() * 0.14,
      r: rnd() * Math.PI,
    }));
  }, [seed]);
  return (
    <group>
      {bits.map((b, i) => (
        <mesh key={i} position={b.p} rotation={[b.r, b.r, 0]} castShadow>
          <boxGeometry args={[b.s, b.s, b.s]} />
          <Mat color={i % 2 ? "#6e655b" : "#9a9084"} roughness={0.94} />
        </mesh>
      ))}
    </group>
  );
}

function roofHeight(tile: Tile): number {
  if (tile.kind === "landmark") return Math.min(2, (tile.landmark?.height ?? 1) * 0.6);
  return (
    { house: 0.45, shop: 0.45, tower: 0.75, park: 0.3, forest: 0.35 }[tile.kind as string] ?? 0.1
  );
}

function PopIn({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (g && g.scale.x < 1) g.scale.setScalar(Math.min(1, g.scale.x + dt * 2.5));
  });
  return (
    <group ref={ref} scale={0.01}>
      {children}
    </group>
  );
}

/** How high a landmark's label floats, as a share of its height. */
const LABEL_HEIGHT: Partial<Record<Landmark["shape"], number>> = {
  radio_tower: 1.02,
  water_tower: 1.05,
  town_hall: 1.05,
  church: 1,
};

/** Label anchors over the landmarks, one per name. */
export function landmarkLabelSpecs(grid: Tile[]): LabelSpec[] {
  const seen = new Set<string>();
  const out: LabelSpec[] = [];
  grid.forEach((t, i) => {
    const lm = t.landmark;
    if (t.kind !== "landmark" || !lm?.name || seen.has(lm.name)) return;
    seen.add(lm.name);
    out.push({
      key: `lm-${lm.name}`,
      x: tileX(i),
      y: lm.height * (LABEL_HEIGHT[lm.shape] ?? 0.9) + 0.35,
      z: tileZ(i),
      text: lm.name,
      variant: "landmark",
    });
  });
  return out;
}

/**
 * Landmarks, fires, rubble and floods — the few tiles that need their own
 * meshes. In the Upside Down (`upside`) there is no fire and no flood, only
 * the dead copies of the landmarks and the rubble.
 */
export function TileFx({ grid, upside = false }: { grid: Tile[]; upside?: boolean }) {
  return (
    <UpsideContext.Provider value={upside}>
      {grid.map((t, i) => {
        const special = t.kind === "landmark" || t.kind === "rubble" || (!upside && t.fire > 0);
        if (!special) return null;
        return (
          <group key={i} position={[tileX(i), 0, tileZ(i)]}>
            {t.kind === "landmark" && t.landmark && (
              <PopIn key={`lm-${t.builtDay}`}>
                <group scale={[t.landmark.span ?? 1, 1, t.landmark.span ?? 1]}>
                  <LandmarkMesh lm={t.landmark} />
                </group>
              </PopIn>
            )}
            {t.kind === "rubble" && <Rubble seed={i + t.builtDay} />}
            {!upside && t.fire > 0 && <Fire seed={i} y={roofHeight(t)} />}
            {/* Floodwater is drawn by the shared water surface. */}
          </group>
        );
      })}
    </UpsideContext.Provider>
  );
}
