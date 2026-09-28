import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hash } from "@/lib/island/rng";
import { wx, wz, type Tile } from "@/lib/island/types";
import { heightAt } from "./palette";
import { IMPOSTOR_META, impostorUniforms, loadImpostor, type Impostor } from "./impostors";
import { env } from "./fx/env";

/**
 * The island's plants: real scanned and modelled plants (see impostors.ts),
 * placed tile by tile from each biome, its cover and a stable hash, so the
 * same island always grows the same forest. Conifers crown the highlands,
 * banyan-like giants roof the jungle, tree ferns and cycads fill the basin,
 * bald cypress stand in the swamps, palms lean over the beaches, and burnt
 * ground is left with fallen trunks.
 */

type Kind =
  | "conifer"
  | "sapling"
  | "jungle"
  | "broadleaf"
  | "palm"
  | "cycad"
  | "cypress"
  | "treefern"
  | "fern"
  | "shrub"
  | "pachira"
  | "dead";

/** Which photographed plant each kind uses, and how tall it stands (world units). */
const LOOK: Record<
  Kind,
  { atlas: string; height: number; shadow: boolean; max: number; bright?: number }
> = {
  conifer: { atlas: "conifer", height: 2.8, shadow: true, max: 7000, bright: 1.15 },
  sapling: { atlas: "sapling", height: 1.1, shadow: true, max: 5000, bright: 1.35 },
  jungle: { atlas: "jungle", height: 2.5, shadow: true, max: 4000 },
  broadleaf: { atlas: "broadleaf", height: 1.3, shadow: true, max: 3000, bright: 1.5 },
  palm: { atlas: "palm", height: 1.5, shadow: true, max: 2500 },
  cycad: { atlas: "palm", height: 0.45, shadow: false, max: 5000 },
  cypress: { atlas: "cypress", height: 2.0, shadow: true, max: 3000 },
  treefern: { atlas: "ponga", height: 0.75, shadow: true, max: 5000 },
  fern: { atlas: "fern", height: 0.13, shadow: false, max: 16000 },
  shrub: { atlas: "shrub", height: 0.11, shadow: false, max: 12000 },
  pachira: { atlas: "pachira", height: 0.4, shadow: false, max: 6000 },
  dead: { atlas: "dead", height: 0.12, shadow: false, max: 3000 },
};
const KINDS = Object.keys(LOOK) as Kind[];

interface Plant {
  kind: Kind;
  x: number;
  z: number;
  s: number;
  r: number;
  tint: number;
}

/** What grows on a tile, decided by its biome, cover and a stable hash. */
/** Low plants that may grow on trails and in the old park's yard, where trees don't. */
const LOW = new Set(["fern", "shrub", "cycad"]);

function plantsOn(t: Tile, i: number, out: Plant[], open = false) {
  if (t.water || t.build || t.lava > 0 || t.biome === "lava" || t.biome === "farm") return;
  const burnt =
    t.fire > 0 ||
    (t.forest < 0.15 &&
      (t.biome === "ash" || t.biome === "rock") &&
      t.region !== "volcano" &&
      hash(i, 91) < 0.1);
  let k = 0;
  const put = (kind: Kind, n: number, scale = 1) => {
    if (open && !LOW.has(kind)) return;
    // Fractional counts become a chance of one more.
    const whole = Math.floor(n) + (hash(i, 97, k) < n % 1 ? 1 : 0);
    for (let m = 0; m < whole; m++, k++) {
      out.push({
        kind,
        x: wx(i) + (hash(i, k, 1) - 0.5) * 0.95,
        z: wz(i) + (hash(i, k, 2) - 0.5) * 0.95,
        s: scale * (0.7 + hash(i, k, 3) * 0.6),
        r: hash(i, k, 4) * Math.PI * 2,
        tint: hash(i, k, 5),
      });
    }
  };
  const f = t.forest;
  const v = t.veg;
  if (burnt || (t.fire > 0 && f > 0.2)) {
    put("dead", f * 2 + (t.fire > 0 ? 1 : 0.3));
    return;
  }
  switch (t.biome) {
    case "fern":
      put("fern", v * 3.5);
      put("treefern", f * 1.4);
      put("cycad", f * 1.2 + v * 0.3);
      break;
    case "jungle":
      put("jungle", f * 0.7);
      put("treefern", f * 0.9);
      put("pachira", v * 1.6);
      put("fern", v * 2.5);
      break;
    case "conifer":
      put("conifer", f * 1.6);
      put("sapling", f * 0.8);
      put("fern", v * 0.8);
      break;
    case "ridge":
    case "highland":
      put("conifer", f * 1.1);
      put("sapling", f * 0.6);
      put("shrub", v * 1.5);
      break;
    case "grass":
    case "plains":
    case "springs":
      put("shrub", v * 2.2);
      put(f > 0.3 ? "broadleaf" : "cycad", f * (f > 0.3 ? 0.9 : 1.2));
      break;
    case "wetland":
      put("cypress", f * 1.1 + 0.08);
      put("fern", v * 2);
      put("shrub", v * 1.2);
      break;
    case "mangrove":
      put("cypress", f * 1.0 + 0.3, 0.8);
      put("palm", 0.2);
      break;
    case "beach":
      put("palm", hash(i, 77) < 0.35 ? 1 : 0);
      break;
    case "canyon":
      put("dead", hash(i, 78) < 0.12 ? 1 : 0, 0.8);
      put("shrub", v * 0.6);
      break;
    case "cliff":
      put("shrub", v * 0.8);
      break;
    case "ash":
    case "rock":
      if (t.region !== "volcano" && v > 0.2) put("fern", 0.6);
      break;
  }
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const DRY = new THREE.Color("#c9a95a");

export function Vegetation({
  tiles,
  dry,
  clear,
}: {
  tiles: Tile[];
  dry: boolean;
  /** Tiles kept clear of trees (trails, the old park). */
  clear?: Set<number>;
}) {
  const [looks, setLooks] = useState<Partial<Record<string, Impostor>>>({});
  useEffect(() => {
    let live = true;
    const atlases = [...new Set(KINDS.map((k) => LOOK[k].atlas))].filter((a) => IMPOSTOR_META[a]);
    for (const a of atlases)
      loadImpostor(a)
        .then((imp) => live && setLooks((cur) => ({ ...cur, [a]: imp })))
        .catch((err) => console.warn(`No ${a} plants:`, err));
    return () => {
      live = false;
    };
  }, []);
  const refs = useRef<Partial<Record<Kind, THREE.InstancedMesh | null>>>({});

  useFrame(({ clock }) => {
    impostorUniforms.uTime.value = clock.elapsedTime;
    impostorUniforms.uWind.value = env.raining ? 2.4 : 1;
  });

  const plants = useMemo(() => {
    const out: Plant[] = [];
    tiles.forEach((t, i) => plantsOn(t, i, out, clear?.has(i)));
    return out;
  }, [tiles, clear]);

  useLayoutEffect(() => {
    const n: Partial<Record<Kind, number>> = {};
    for (const p of plants) {
      const mesh = refs.current[p.kind];
      const look = LOOK[p.kind];
      const meta = IMPOSTOR_META[look.atlas];
      if (!mesh || !meta) continue;
      const k = n[p.kind] ?? 0;
      if (k >= look.max) continue;
      n[p.kind] = k + 1;
      tmpP.set(p.x, heightAt(tiles, p.x, p.z) - 0.02, p.z);
      tmpQ.setFromAxisAngle(UP, p.r);
      tmpS.setScalar((look.height / meta.height) * p.s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(k, tmpM);
      // A little variety; the dry season browns the leaves.
      const shade = (0.82 + p.tint * 0.3) * (look.bright ?? 1);
      tmpC.setRGB(shade, shade, shade);
      if (dry && p.kind !== "dead" && p.kind !== "conifer" && p.kind !== "sapling")
        tmpC.lerp(DRY, 0.25 + p.tint * 0.2);
      mesh.setColorAt(k, tmpC);
    }
    for (const kind of KINDS) {
      const mesh = refs.current[kind];
      if (!mesh) continue;
      mesh.count = n[kind] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [plants, tiles, dry, looks]);

  // The park map leaves the trees off (forest shows as stipple on the ground).
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.visible = env.blueprint < 0.5;
  });
  return (
    <group ref={group}>
      {KINDS.map((k) => {
        const look = looks[LOOK[k].atlas];
        if (!look) return null;
        return (
          <instancedMesh
            key={k}
            ref={(r) => {
              refs.current[k] = r;
              // Ref callbacks run again on every render: only set up a mesh once,
              // or its placed plants would be wiped until the next placement.
              if (r && !r.userData.ready) {
                r.userData.ready = true;
                r.setColorAt(0, tmpC.set("#ffffff"));
                r.count = 0;
                r.customDepthMaterial = look.depth;
              }
            }}
            args={[look.geometry, look.material, LOOK[k].max]}
            castShadow={LOOK[k].shadow}
            // A billboard would shadow itself: plants cast shadows but don't take them.
            receiveShadow={false}
            frustumCulled={false}
          />
        );
      })}
    </group>
  );
}
