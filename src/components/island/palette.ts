import * as THREE from "three";
import { HALF, LAKE, RIVER, SEA, SIZE, type Biome, type Tile } from "@/lib/island/types";

/** Ground colours: a slightly exaggerated nature-documentary palette. */
export const BIOME_COLOR: Record<Biome, string> = {
  sea: "#2a4f5f",
  shallows: "#6fa89a",
  beach: "#e2cf9b",
  cliff: "#8a7b69",
  lagoon: "#7fc6b9",
  mangrove: "#4f6e3c",
  rock: "#7b716a",
  ash: "#4a4442",
  lava: "#3a2622",
  fern: "#6d9a3b",
  highland: "#98a257",
  conifer: "#46643a",
  ridge: "#86806a",
  wetland: "#6c8a55",
  grass: "#9fbd52",
  plains: "#c2bb68",
  jungle: "#3f7a33",
  canyon: "#c07a4c",
  tar: "#231d1b",
  springs: "#b4c9a4",
  farm: "#a98b4b",
};

const tmp = new THREE.Color();
const mix = new THREE.Color();
const BARE = new THREE.Color("#8b7b5c");
const TRAIL = new THREE.Color("#b9a27a");
const BURNT = new THREE.Color("#2a2522");
const WET = new THREE.Color("#5f6b4a");
const SAND_WET = new THREE.Color("#b8a47a");
const STRATA = [
  new THREE.Color("#c98a5a"),
  new THREE.Color("#a8623e"),
  new THREE.Color("#dcae7a"),
  new THREE.Color("#8f5236"),
];

/** A tile's ground colour right now: its biome, greener or barer with its cover, worn by herds. */
export function tileColor(t: Tile, out: THREE.Color, slope: number): THREE.Color {
  out.set(BIOME_COLOR[t.biome]);
  if (t.water === SEA) {
    // The sea floor: sand in the shallows, darker further out.
    out.set(t.h > -0.3 ? "#cdb98a" : t.h > -0.9 ? "#7da596" : "#355a66");
    return out;
  }
  if (t.water === RIVER || t.water === LAKE)
    return out.set(t.biome === "lagoon" ? "#d8c89a" : "#6b6a48");
  if (t.biome === "canyon") {
    // Layered rock: bands by height.
    out.copy(STRATA[Math.floor(t.h * 2.2) % STRATA.length]);
  }
  // Grazed-down ground goes brown; lush ground deepens.
  const lush = t.veg;
  if (
    t.biome !== "beach" &&
    t.biome !== "rock" &&
    t.biome !== "canyon" &&
    t.biome !== "ash" &&
    t.biome !== "tar"
  )
    out.lerp(BARE, Math.max(0, 0.55 - lush) * 0.9);
  if (t.forest > 0.4) out.multiplyScalar(0.92);
  if (t.trail > 0.05) out.lerp(TRAIL, Math.min(0.75, t.trail * 0.9));
  if (slope > 1.1 && t.biome !== "beach")
    out.lerp(tmp.set("#7d746c"), Math.min(0.8, (slope - 1.1) * 0.8));
  if (t.fire > 0) out.lerp(BURNT, 0.7);
  if (t.flood > 0) out.lerp(WET, 0.6);
  if (t.biome === "beach" && t.h < 0.15) out.lerp(SAND_WET, 0.5);
  return out;
}

/** Tile under a world point. */
export const tileAtWorld = (x: number, z: number) => {
  const cx = Math.floor(x + HALF);
  const cz = Math.floor(z + HALF);
  if (cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE) return -1;
  return cz * SIZE + cx;
};

/** Ground height at a world point, blending the tile centres. */
export function heightAt(tiles: Tile[], x: number, z: number): number {
  const fx = x + HALF - 0.5;
  const fz = z + HALF - 0.5;
  const x0 = Math.max(0, Math.min(SIZE - 1, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(SIZE - 1, Math.floor(fz)));
  const x1 = Math.min(SIZE - 1, x0 + 1);
  const z1 = Math.min(SIZE - 1, z0 + 1);
  const u = Math.min(1, Math.max(0, fx - x0));
  const v = Math.min(1, Math.max(0, fz - z0));
  const h = (xx: number, zz: number) => tiles[zz * SIZE + xx].h;
  return (
    (h(x0, z0) * (1 - u) + h(x1, z0) * u) * (1 - v) + (h(x0, z1) * (1 - u) + h(x1, z1) * u) * v
  );
}

export { mix };
