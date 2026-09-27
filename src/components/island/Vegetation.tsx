import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hash } from "@/lib/island/rng";
import { wx, wz, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";

type Kind = "fern" | "cycad" | "conifer" | "giant" | "palm" | "tuft" | "dead";

/** Bakes a colour into a geometry so a whole plant can be one instanced mesh. */
function painted(src: THREE.BufferGeometry, color: string) {
  // Mixed primitives merge only when none of them is indexed.
  const g = src.index ? src.toNonIndexed() : src;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    arr[k * 3] = c.r;
    arr[k * 3 + 1] = c.g;
    arr[k * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  // Merged geometries must share attributes: drop uvs.
  g.deleteAttribute("uv");
  return g;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Low-poly plant models, 1 unit ≈ one tile. */
function plantGeometry(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (kind) {
    case "fern":
      // A fan of fronds.
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const frond = painted(new THREE.ConeGeometry(0.07, 0.42, 4), k % 2 ? "#5f9a34" : "#6fae3c");
        parts.push(
          at(frond, Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12, Math.PI / 2 - 0.6, 0, 0).rotateY(
            -a,
          ),
        );
      }
      break;
    case "cycad": {
      parts.push(
        painted(at(new THREE.CylinderGeometry(0.06, 0.09, 0.45, 6), 0, 0.22, 0), "#6b5236"),
      );
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const leaf = painted(new THREE.ConeGeometry(0.06, 0.55, 4), "#4f8a2c");
        parts.push(
          at(leaf, 0, 0, 0, Math.PI / 2 + 0.5, 0, 0)
            .rotateY(-a)
            .translate(Math.cos(a) * 0.18, 0.5, Math.sin(a) * 0.18),
        );
      }
      break;
    }
    case "conifer":
      parts.push(
        painted(at(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5), 0, 0.25, 0), "#5a4128"),
      );
      parts.push(painted(at(new THREE.ConeGeometry(0.42, 0.8, 7), 0, 0.75, 0), "#355c30"));
      parts.push(painted(at(new THREE.ConeGeometry(0.33, 0.7, 7), 0, 1.15, 0), "#3c6834"));
      parts.push(painted(at(new THREE.ConeGeometry(0.22, 0.55, 7), 0, 1.5, 0), "#44743a"));
      break;
    case "giant":
      // The jungle's giants: a tall trunk and billowing crowns.
      parts.push(painted(at(new THREE.CylinderGeometry(0.1, 0.18, 2.2, 6), 0, 1.1, 0), "#5d4a33"));
      parts.push(painted(at(new THREE.IcosahedronGeometry(0.75, 1), 0, 2.4, 0), "#2f6a2c"));
      parts.push(painted(at(new THREE.IcosahedronGeometry(0.55, 1), 0.45, 2.1, 0.2), "#377833"));
      parts.push(painted(at(new THREE.IcosahedronGeometry(0.5, 1), -0.4, 2.2, -0.25), "#2a5f28"));
      break;
    case "palm":
      parts.push(
        painted(
          at(new THREE.CylinderGeometry(0.04, 0.07, 1.1, 5), 0.08, 0.55, 0, 0, 0, -0.15),
          "#7a6344",
        ),
      );
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const leaf = painted(new THREE.ConeGeometry(0.05, 0.6, 3), "#4f8f36");
        parts.push(
          at(leaf, 0, 0, 0, Math.PI / 2 + 0.35, 0, 0)
            .rotateY(-a)
            .translate(0.16 + Math.cos(a) * 0.2, 1.08, Math.sin(a) * 0.2),
        );
      }
      break;
    case "tuft":
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.3;
        parts.push(
          painted(
            at(
              new THREE.ConeGeometry(0.035, 0.22, 3),
              Math.cos(a) * 0.05,
              0.1,
              Math.sin(a) * 0.05,
              Math.cos(a) * 0.25,
              0,
              Math.sin(a) * 0.25,
            ),
            "#8fb24e",
          ),
        );
      }
      break;
    case "dead":
      parts.push(painted(at(new THREE.CylinderGeometry(0.04, 0.08, 1, 5), 0, 0.5, 0), "#2b2521"));
      parts.push(
        painted(
          at(new THREE.CylinderGeometry(0.02, 0.03, 0.4, 4), 0.1, 0.8, 0, 0, 0, -0.8),
          "#2b2521",
        ),
      );
      break;
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

const KINDS: Kind[] = ["fern", "cycad", "conifer", "giant", "palm", "tuft", "dead"];
const MAX: Record<Kind, number> = {
  fern: 5000,
  cycad: 1600,
  conifer: 3000,
  giant: 1400,
  palm: 500,
  tuft: 4000,
  dead: 800,
};

interface Plant {
  kind: Kind;
  x: number;
  z: number;
  s: number;
  r: number;
  tint: number;
}

/** What grows on a tile, decided by its biome, cover and a stable hash. */
function plantsOn(t: Tile, i: number, out: Plant[], dry: boolean) {
  if (t.water || t.build || t.lava > 0 || t.biome === "lava" || t.biome === "farm") return;
  const burnt =
    t.fire > 0 ||
    (t.forest < 0.15 &&
      (t.biome === "ash" || t.biome === "rock") &&
      t.region !== "volcano" &&
      hash(i, 91) < 0.1);
  const put = (kind: Kind, n: number, scale: number) => {
    for (let k = 0; k < n; k++) {
      const hx = hash(i, k, 1);
      const hz = hash(i, k, 2);
      out.push({
        kind,
        x: wx(i) + (hx - 0.5) * 0.9,
        z: wz(i) + (hz - 0.5) * 0.9,
        s: scale * (0.75 + hash(i, k, 3) * 0.5),
        r: hash(i, k, 4) * Math.PI * 2,
        tint: hash(i, k, 5) + (dry ? 0.6 : 0),
      });
    }
  };
  const f = t.forest;
  const v = t.veg;
  if (burnt || (t.fire > 0 && f > 0.2)) {
    put("dead", Math.round(f * 3) + (t.fire > 0 ? 1 : 0), 1);
    return;
  }
  switch (t.biome) {
    case "fern":
      put("fern", Math.round(v * 4), 1.1);
      put("cycad", Math.round(f * 3), 1.1);
      break;
    case "jungle":
      put("giant", Math.round(f * 2.2), 1);
      put("fern", Math.round(v * 3), 1.4);
      put("cycad", Math.round(f * 1.5), 1.2);
      break;
    case "conifer":
    case "ridge":
    case "highland":
      put("conifer", Math.round(f * 3.2), 1);
      put("tuft", Math.round(v * 2), 1);
      break;
    case "grass":
    case "plains":
    case "springs":
      put("tuft", Math.round(v * 3), 1);
      put(f > 0.3 ? "giant" : "cycad", Math.round(f * 1.6), f > 0.3 ? 0.7 : 1);
      break;
    case "wetland":
      put("tuft", Math.round(v * 4), 1.3);
      put("cycad", Math.round(f * 2), 1);
      break;
    case "mangrove":
      put("palm", Math.round(f * 2) + 1, 0.9);
      break;
    case "beach":
      if (hash(i, 77) < 0.25) put("palm", 1, 1);
      break;
    case "canyon":
      if (hash(i, 78) < 0.15) put("dead", 1, 0.7);
      break;
    case "ash":
    case "rock":
      if (t.region !== "volcano" && v > 0.2) put("fern", 1, 0.8);
      break;
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const DRY = new THREE.Color("#c9b25a");

export function Vegetation({ tiles, dry }: { tiles: Tile[]; dry: boolean }) {
  const geos = useMemo(
    () =>
      Object.fromEntries(KINDS.map((k) => [k, plantGeometry(k)])) as Record<
        Kind,
        THREE.BufferGeometry
      >,
    [],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }),
    [],
  );
  const refs = useRef<Partial<Record<Kind, THREE.InstancedMesh | null>>>({});

  useLayoutEffect(() => {
    const plants: Plant[] = [];
    tiles.forEach((t, i) => plantsOn(t, i, plants, dry));
    const n: Record<string, number> = {};
    for (const p of plants) {
      const mesh = refs.current[p.kind];
      if (!mesh) continue;
      const k = n[p.kind] ?? 0;
      if (k >= MAX[p.kind]) continue;
      n[p.kind] = k + 1;
      tmpP.set(p.x, heightAt(tiles, p.x, p.z) - 0.02, p.z);
      tmpQ.setFromAxisAngle(UP, p.r);
      tmpS.setScalar(p.s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(k, tmpM);
      // A little variety; the dry season browns the leaves.
      const shade = 0.85 + (p.tint % 1) * 0.3;
      tmpC.setRGB(shade, shade, shade);
      if (p.tint > 1 && p.kind !== "dead" && p.kind !== "conifer") tmpC.lerp(DRY, 0.35);
      mesh.setColorAt(k, tmpC);
    }
    for (const kind of KINDS) {
      const mesh = refs.current[kind];
      if (!mesh) continue;
      mesh.count = n[kind] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [tiles, dry]);

  return (
    <group>
      {KINDS.map((k) => (
        <instancedMesh
          key={k}
          ref={(r) => {
            refs.current[k] = r;
          }}
          args={[geos[k], material, MAX[k]]}
          castShadow={k === "giant" || k === "conifer"}
          receiveShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
