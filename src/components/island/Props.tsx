import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hash } from "@/lib/island/rng";
import { around } from "@/lib/island/terrain";
import { SEA, wx, wz, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";
import PROP_META from "./props.meta.json";

/**
 * Photoscanned props (Poly Haven, CC0): boulders and mossy rocks, rock faces
 * and crags on the steep ground, rocks along the shore, fallen trunks and
 * stumps in the woods, and whatever else is placed through `placements`.
 * Each prop draws all its copies in one instanced call per material.
 */

export type PropKey = keyof typeof PROP_META;

/** Metres to world units (a tile is about five metres). */
export const METRE = 0.19;

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const cache = new Map<string, Promise<Part[]>>();

export function loadProp(key: string): Promise<Part[]> {
  let p = cache.get(key);
  if (!p) {
    p = new GLTFLoader().loadAsync(`/props/${key}.glb`).then((gltf) => {
      const parts: Part[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        // Instanced copies can't morph; drop any shape keys the source kept.
        g.morphAttributes = {};
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.roughness = Math.max(0.75, mat.roughness);
        mat.metalness = 0;
        mat.envMapIntensity = 0.5;
        // Fence wire and the like are cut-outs. The wire's colour map lost its
        // alpha in compression, but the wire is bright on black: use that.
        if (/wire/.test(mat.name) && mat.map) {
          mat.alphaMap = mat.map;
          mat.alphaTest = 0.2;
          mat.color.setScalar(2.2);
        }
        if (mat.transparent || mat.alphaTest > 0) {
          mat.transparent = false;
          mat.alphaTest = Math.min(mat.alphaTest || 0.5, 0.5);
          mat.side = THREE.DoubleSide;
        }
        parts.push({ geometry: g, material: mat });
      });
      return parts;
    });
    cache.set(key, p);
  }
  return p;
}

export interface Placement {
  key: PropKey;
  m: THREE.Matrix4;
  /** Brightness (and a tint for, say, volcanic rock). */
  color: THREE.Color;
}

const e = new THREE.Euler();
const q = new THREE.Quaternion();
const qt = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const n = new THREE.Vector3();

/** A prop set into the ground at (x, z): turned, scaled, tilted to the slope and sunk a little. */
export function place(
  tiles: Tile[],
  key: PropKey,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  opts: { sink?: number; tilt?: number; y?: number; shade?: number; tint?: string } = {},
): Placement {
  const size = PROP_META[key].size;
  const s = scale * METRE;
  const y = opts.y ?? heightAt(tiles, x, z);
  // Lean with the ground under it.
  const d = 0.5;
  n.set(
    heightAt(tiles, x - d, z) - heightAt(tiles, x + d, z),
    2 * d,
    heightAt(tiles, x, z - d) - heightAt(tiles, x, z + d),
  ).normalize();
  qt.setFromUnitVectors(up, n);
  q.setFromEuler(e.set(0, yaw, 0));
  if (opts.tilt !== 0) q.premultiply(qt.slerp(new THREE.Quaternion(), 1 - (opts.tilt ?? 0.7)));
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y - size[1] * s * (opts.sink ?? 0.2), z),
    q.clone(),
    new THREE.Vector3(s, s, s),
  );
  const c = new THREE.Color(opts.tint ?? "#ffffff").multiplyScalar(opts.shade ?? 1);
  return { key, m, color: c };
}

const ROCKS: PropKey[] = [
  "boulder",
  "moss_rock_1",
  "moss_rock_2",
  "moss_rock_3",
  "moss_rock_4",
  "moss_rock_5",
  "moss_rock_6",
  "slab",
];
const FACES: PropKey[] = ["rock_face_1", "rock_face_2", "crag"];
const WOOD: PropKey[] = ["dead_trunk", "stump", "roots"];

const pick = <T,>(list: T[], h: number) => list[Math.floor(h * list.length) % list.length];

/** Rocks, crags and fallen wood over the island, from its own ground. */
export function naturePlacements(tiles: Tile[], seed: number, skip?: Set<number>): Placement[] {
  const out: Placement[] = [];
  const slopeOf = (i: number) =>
    Math.max(...around(i).map((j) => Math.abs(tiles[j].h - tiles[i].h)));
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.water || t.build || t.lava || skip?.has(i)) continue;
    const h = (k: number) => hash(seed, i, k);
    const x = wx(i) + (h(1) - 0.5) * 0.8;
    const z = wz(i) + (h(2) - 0.5) * 0.8;
    const slope = slopeOf(i);
    const coast = around(i).some((j) => tiles[j].water === SEA);
    const volcanic = t.region === "volcano";
    const shade = 0.8 + h(3) * 0.3;
    const tint = volcanic ? "#8f8a84" : t.biome === "canyon" ? "#d6b08a" : "#ffffff";
    // Outcrops and rock faces break out of the steep ground.
    if (slope > 0.8 && h(4) < 0.1 + Math.min(0.25, (slope - 0.8) * 0.25)) {
      out.push(
        place(tiles, pick(FACES, h(5)), x, z, h(6) * Math.PI * 2, 1.4 + h(7) * 1.6, {
          sink: 0.35,
          tilt: 0.4,
          shade,
          tint,
        }),
      );
      continue;
    }
    // Rocks tumbled along the shore.
    if (coast && h(8) < (t.biome === "cliff" ? 0.3 : 0.12)) {
      const sea = around(i).find((j) => tiles[j].water === SEA)!;
      const f = 0.35 + h(9) * 0.3;
      out.push(
        place(
          tiles,
          h(10) < 0.5 ? "coast_rock" : pick(ROCKS, h(11)),
          wx(i) * (1 - f) + wx(sea) * f,
          wz(i) * (1 - f) + wz(sea) * f,
          h(12) * Math.PI * 2,
          0.7 + h(13) * 1.1,
          { sink: 0.3, shade, tint },
        ),
      );
      continue;
    }
    // Boulders out in the country; more on rough and high ground.
    const rough =
      t.biome === "highland" || t.biome === "ridge" || t.biome === "canyon" || t.biome === "rock"
        ? 0.1
        : volcanic
          ? 0.12
          : t.biome === "jungle" || t.biome === "conifer"
            ? 0.035
            : 0.018;
    if (h(14) < rough) {
      out.push(
        place(tiles, pick(ROCKS, h(15)), x, z, h(16) * Math.PI * 2, 0.8 + h(17) * 1.5, {
          sink: 0.25,
          shade,
          tint,
        }),
      );
      continue;
    }
    // Fallen trunks, stumps and roots in the woods.
    if (t.forest > 0.45 && h(18) < 0.03) {
      out.push(
        place(tiles, pick(WOOD, h(19)), x, z, h(20) * Math.PI * 2, 0.9 + h(21) * 0.5, {
          sink: 0.1,
          tilt: 0.9,
          shade: 0.85 + h(22) * 0.2,
        }),
      );
    }
  }
  return out;
}

/** Draws a list of placements, a few instanced meshes per prop. */
export function PropField({ placements }: { placements: Placement[] }) {
  const keys = useMemo(() => [...new Set(placements.map((p) => p.key))], [placements]);
  const [parts, setParts] = useState<Record<string, Part[]>>({});
  useEffect(() => {
    let live = true;
    for (const k of keys)
      if (!parts[k])
        loadProp(k)
          .then((p) => live && setParts((cur) => ({ ...cur, [k]: p })))
          .catch((err) => console.warn(`No prop ${k}:`, err));
    return () => {
      live = false;
    };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  const byKey = useMemo(() => {
    const m = new Map<string, Placement[]>();
    for (const p of placements) {
      if (!m.has(p.key)) m.set(p.key, []);
      m.get(p.key)!.push(p);
    }
    return m;
  }, [placements]);
  return (
    <group>
      {[...byKey.entries()].flatMap(([key, list]) =>
        (parts[key] ?? []).map((part, k) => (
          <instancedMesh
            key={`${key}-${k}-${list.length}`}
            args={[part.geometry, part.material, list.length]}
            ref={(r) => {
              if (!r || r.userData.ready) return;
              r.userData.ready = true;
              list.forEach((p, j) => {
                r.setMatrixAt(j, p.m);
                r.setColorAt(j, p.color);
              });
              r.instanceMatrix.needsUpdate = true;
              if (r.instanceColor) r.instanceColor.needsUpdate = true;
              r.computeBoundingSphere();
            }}
            castShadow
            receiveShadow
          />
        )),
      )}
    </group>
  );
}
