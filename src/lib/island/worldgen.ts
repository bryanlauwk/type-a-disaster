import { flatSpot, levelSite, trailNetwork } from "./park";
import { fbm, hash, noise, ridged } from "./rng";
import {
  HALF,
  LAKE,
  RIVER,
  SEA,
  SIZE,
  SPECIES,
  idx,
  inBounds,
  tx,
  ty,
  type Biome,
  type LandmarkId,
  type Pop,
  type RegionId,
  type SpeciesId,
  type Tile,
  type Tribe,
  type WorldState,
} from "./types";

/** Normalised map coordinates: (0, 0) is the map's centre, ±1 its edge; -v is north. */
const uOf = (x: number) => ((x + 0.5) / SIZE) * 2 - 1;
const vOf = (y: number) => ((y + 0.5) / SIZE) * 2 - 1;
const tileAt = (u: number, v: number) =>
  idx(
    Math.max(0, Math.min(SIZE - 1, Math.round(((u + 1) / 2) * SIZE - 0.5))),
    Math.max(0, Math.min(SIZE - 1, Math.round(((v + 1) / 2) * SIZE - 0.5))),
  );

interface RegionSpec {
  id: RegionId;
  u: number;
  v: number;
  height: (seed: number, u: number, v: number) => number;
}

/**
 * One big island filling the map: broad, rugged and wild in the north, where
 * the volcano stands; open valleys, rivers and a great lake through the
 * middle; narrowing to the south, where the tribe's harbour sits at the tip.
 * The regions around the Fern Basin, from the north-west clockwise.
 */
const OUTER: RegionSpec[] = [
  {
    // The wild north-west: crags and deep forest, no place for people.
    id: "predator_ridge",
    u: -0.52,
    v: -0.58,
    height: (s, u, v) => 1.8 + ridged(s + 9, u * 3.5, v * 3.5) * 4.2,
  },
  {
    id: "titan_highlands",
    u: 0.5,
    v: -0.56,
    height: (s, u, v) => 2.7 + fbm(s + 1, u * 4, v * 4) * 0.7,
  },
  {
    id: "misty_wetlands",
    u: 0.66,
    v: -0.1,
    height: (s, u, v) => 0.16 + fbm(s + 2, u * 6, v * 6) * 0.22,
  },
  {
    // The great open valley at the island's heart.
    id: "emerald_grasslands",
    u: 0.2,
    v: 0.06,
    height: (s, u, v) => 0.55 + fbm(s + 3, u * 3, v * 3) * 0.6,
  },
  {
    id: "fertile_plains",
    u: 0.12,
    v: 0.42,
    height: (s, u, v) => 0.5 + fbm(s + 5, u * 3, v * 3) * 0.3,
  },
  {
    id: "settlers_bay",
    u: 0.2,
    v: 0.74,
    height: (s, u, v) => 0.3 + fbm(s + 4, u * 4, v * 4) * 0.25,
  },
  {
    id: "sunken_jungle",
    u: -0.3,
    v: 0.34,
    height: (s, u, v) => 0.35 + fbm(s + 6, u * 5, v * 5) * 0.9,
  },
  {
    id: "fossil_canyon",
    u: -0.58,
    v: -0.04,
    height: (s, u, v) => {
      // A high mesa cut by deep winding gorges.
      const gorge = Math.abs(noise(s + 7, u * 5, v * 5) - 0.5) * 2;
      return 2.1 + fbm(s + 8, u * 3, v * 3) * 0.4 - (1 - Math.min(1, gorge * 3.2)) * 1.7;
    },
  },
];

/** Where the volcano stands: in the north of the island. */
const VC: [number, number] = [0.02, -0.46];
const fromVolcano = (u: number, v: number) => Math.hypot(u - VC[0], v - VC[1]);

const BASIN_R = 0.3;
const VOLCANO_R = 0.13;

/** Where the landmarks sit, in normalised coordinates (a few are found, not placed). */
const PLACED: Partial<Record<LandmarkId, [number, number]>> = {
  great_volcano: VC,
  titan_valley: [0.46, -0.42],
  migration_pass: [0.36, -0.16],
  fern_sea: [-0.22, -0.38],
  misty_wetlands: [0.66, -0.1],
  fossil_canyon: [-0.58, -0.04],
  sunken_jungle: [-0.3, 0.34],
  skeleton_field: [-0.4, -0.26],
  crystal_caves: [-0.7, -0.4],
  geothermal_springs: [0.2, -0.34],
  crater_lake: [0.06, 0.1],
  nesting_grounds: [0.36, 0.1],
  sacred_mountain: [-0.1, 0.6],
  coastal_lagoon: [0.58, 0.34],
};

/** Offshore islets: [u, v, radius, height]. The first is Dinosaur Island. */
const ISLETS: [number, number, number, number][] = [
  [0.78, 0.66, 0.075, 1.4],
  [-0.62, 0.78, 0.04, 0.6],
  [0.9, -0.62, 0.035, 0.5],
  [-0.9, 0.3, 0.035, 0.8],
];

/** Where the rivers rise on the volcano's flanks, in degrees (0 = east, 90 = south). */
const SPRINGS = [-120, -40, 18, 62, 95, 128, 170];

/**
 * The island's outline as a field: below 1 is land. Three overlapping
 * ovals, blended smoothly: the broad northern mass, the middle, and the
 * narrowing south. A ragged coast comes from noise.
 */
function shapeField(seed: number, u: number, v: number) {
  const oval = (cx: number, cy: number, rx: number, ry: number) =>
    Math.hypot((u - cx) / rx, (v - cy) / ry);
  const k = 0.35;
  const smin = (a: number, b: number) => {
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  let f = smin(oval(-0.02, -0.36, 0.82, 0.45), oval(0.04, 0.1, 0.72, 0.42));
  f = smin(f, oval(0.12, 0.56, 0.34, 0.3));
  // A long ragged coast with headlands and coves.
  const a = Math.atan2(v, u);
  f += (fbm(seed + 20, Math.cos(a) * 1.8 + 5, Math.sin(a) * 1.8 + 5, 3) - 0.5) * 0.3;
  f += (fbm(seed + 21, u * 7, v * 7) - 0.5) * 0.1;
  // The harbour: a sheltered bay bitten out of the southern tip.
  f += 0.5 * Math.exp(-((Math.hypot(u - 0.36, v - 0.72) / 0.12) ** 2));
  return f;
}

/** Region borders wander, like real ones, instead of running dead straight. */
function warp(seed: number, u: number, v: number): [number, number] {
  return [
    u + (fbm(seed + 70, u * 3, v * 3) - 0.5) * 0.26,
    v + (fbm(seed + 71, u * 3, v * 3) - 0.5) * 0.26,
  ];
}

function regionFor(seed: number, u0: number, v0: number): RegionId {
  const [u, v] = warp(seed, u0, v0);
  const r = fromVolcano(u, v);
  if (r < VOLCANO_R) return "volcano";
  if (r < BASIN_R) return "fern_basin";
  let best = OUTER[0];
  let bestD = Infinity;
  for (const o of OUTER) {
    const d = Math.hypot(u - o.u, v - o.v);
    if (d < bestD) [best, bestD] = [o, d];
  }
  return best.id;
}

function baseHeight(seed: number, u: number, v: number): number {
  const r = fromVolcano(u, v);
  // Outer regions blend smoothly into each other.
  let sum = 0;
  let wsum = 0;
  for (const o of OUTER) {
    const w = Math.exp(-(Math.hypot(u - o.u, v - o.v) ** 2) / 0.07);
    sum += o.height(seed, u, v) * w;
    wsum += w;
  }
  const outer = wsum > 0 ? sum / wsum : 0.5;
  const basin = 0.7 + fbm(seed + 10, u * 5, v * 5) * 0.35;
  const [wu, wv] = warp(seed, u, v);
  const b = Math.min(1, Math.max(0, (BASIN_R + 0.06 - fromVolcano(wu, wv)) / 0.14));
  let h = outer * (1 - b) + basin * b;
  // The Great Volcano, with a crater at the top.
  h +=
    9.5 * Math.exp(-((r / 0.15) ** 2)) +
    (fbm(seed + 11, u * 9, v * 9) - 0.5) * 1.2 * Math.exp(-((r / 0.2) ** 2));
  h -= 2.4 * Math.exp(-((r / 0.045) ** 2));
  // Fine relief: knolls, gullies and ridgelines, stronger on high ground.
  h += (fbm(seed + 12, u * 16, v * 16) - 0.5) * (0.25 + Math.min(1, h / 4) * 0.5);
  h += (ridged(seed + 13, u * 11, v * 11) - 0.5) * Math.min(1, Math.max(0, (h - 1.2) / 3)) * 0.8;
  // Titan Valley: a long trough through the highlands down to the pass.
  const valley = Math.exp(-(((u - 0.46) / 0.07) ** 2)) * (v < -0.14 && v > -0.8 ? 1 : 0);
  h -= valley * 1.6;
  // The Sacred Mountain rises behind the bay.
  const sm = PLACED.sacred_mountain!;
  h += 2.6 * Math.exp(-((Math.hypot(u - sm[0], v - sm[1]) / 0.06) ** 2));
  // The ancient crater: a rim around a sunken bowl.
  const cl = PLACED.crater_lake!;
  const dc = Math.hypot(u - cl[0], v - cl[1]);
  h += 0.9 * Math.exp(-(((dc - 0.075) / 0.025) ** 2)) - 1.1 * Math.exp(-((dc / 0.06) ** 2));
  return h;
}

/** Tiles next to this one (8-way). */
function around(i: number): number[] {
  const x = tx(i);
  const y = ty(i);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && inBounds(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
  return out;
}

/**
 * Runs a river from a spring towards the coast in its direction, taking the
 * lowest ground on the way and cutting a valley where the land rises.
 */
function traceRiver(tiles: Tile[], start: number, angle: number, seed = 0): number[] {
  // Where it wants to reach the sea.
  let target = start;
  const [ou, ov] = tiles[start] ? [uOf(tx(start)), vOf(ty(start))] : [0, 0];
  for (let r = 0.05; r < 2; r += 0.01) {
    const i = tileAt(ou + Math.cos(angle) * r, ov + Math.sin(angle) * r);
    target = i;
    if (tiles[i].water === SEA) break;
  }
  const gx = tx(target);
  const gy = ty(target);
  const path = [start];
  const seen = new Set(path);
  let cur = start;
  for (let step = 0; step < SIZE * 3; step++) {
    const t = tiles[cur];
    if (t.water === SEA || (t.water === LAKE && step > 3)) break;
    // Downhill and seaward, wandering through a noise field so it meanders.
    const score = (n: number) =>
      tiles[n].h +
      ((0.32 * 64) / SIZE) * Math.hypot(tx(n) - gx, ty(n) - gy) +
      noise(seed + start, tx(n) * 0.16, ty(n) * 0.16) * 0.4 +
      hash(start, n) * 0.08;
    const next = around(cur)
      .filter((n) => !seen.has(n))
      .sort((a, b) => score(a) - score(b) || a - b)[0];
    if (next === undefined) break;
    // Never flow uphill: cut a valley through the rise instead.
    if (tiles[next].h > t.h - 0.02 && tiles[next].water !== SEA) tiles[next].h = t.h - 0.03;
    seen.add(next);
    path.push(next);
    cur = next;
  }
  return path;
}

const BIOME_COVER: Record<Biome, [number, number]> = {
  sea: [0, 0],
  shallows: [0, 0],
  beach: [0.1, 0],
  cliff: [0.15, 0.1],
  lagoon: [0, 0],
  mangrove: [0.5, 0.7],
  rock: [0.05, 0],
  ash: [0.1, 0],
  lava: [0, 0],
  fern: [0.9, 0.25],
  highland: [0.6, 0.2],
  conifer: [0.5, 0.8],
  ridge: [0.35, 0.55],
  wetland: [0.8, 0.2],
  grass: [0.75, 0.08],
  plains: [0.7, 0.1],
  jungle: [0.85, 0.95],
  canyon: [0.12, 0.03],
  tar: [0.05, 0],
  springs: [0.5, 0.1],
  farm: [0.6, 0],
};

/** The dinosaurs the island starts with, by region. */
const START_POP: Record<SpeciesId, Partial<Record<RegionId, number>>> = {
  titan: { titan_highlands: 26, fern_basin: 14 },
  hornface: { fern_basin: 26, emerald_grasslands: 34, fertile_plains: 10, offshore: 8 },
  duckbill: { misty_wetlands: 36, emerald_grasslands: 18, fern_basin: 18 },
  plateback: { fern_basin: 14, titan_highlands: 10, fossil_canyon: 8 },
  snapper: { misty_wetlands: 50, sunken_jungle: 40 },
  tyrant: { predator_ridge: 5, sunken_jungle: 2 },
  raptor: { predator_ridge: 14, sunken_jungle: 12, fossil_canyon: 6 },
  skywing: { coast: 36, predator_ridge: 16, offshore: 12 },
  leviathan: { coast: 5, offshore: 3 },
};

export const ISLAND_NAME = "Primordia";

/** Builds the island from its seed. */
export function generateIsland(seed: number): WorldState {
  const tiles: Tile[] = [];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = uOf(x);
      const v = vOf(y);
      const f = shapeField(seed, u, v);
      const land = Math.min(1, Math.max(0, (1 - f) / 0.09));
      let h =
        baseHeight(seed, u, v) * land - (1 - land) * Math.min(7, 0.4 + Math.max(0, f - 1) * 12);
      let region = regionFor(seed, u, v);
      // Offshore islets.
      for (const [iu, iv, ir, ih] of ISLETS) {
        const d = Math.hypot(u - iu, v - iv);
        if (d < ir * 1.6) {
          const bump = ih * (1 - (d / ir) ** 2) + (fbm(seed + 30, u * 12, v * 12) - 0.5) * 0.3;
          if (bump > h) {
            h = bump;
            region = "offshore";
          }
        }
      }
      tiles.push({
        h,
        biome: "grass",
        water: 0,
        region,
        veg: 0,
        forest: 0,
        fire: 0,
        flood: 0,
        lava: 0,
        trail: 0,
      });
    }

  // Sea, and the region the sea belongs to (the coast for sea life).
  for (const t of tiles)
    if (t.h <= 0.02) {
      t.water = SEA;
      t.region = t.region === "offshore" ? "offshore" : "coast";
    }

  // The Coastal Lagoon: a sheltered pool behind a sand bar.
  const lag = PLACED.coastal_lagoon!;
  for (let i = 0; i < tiles.length; i++) {
    const d = Math.hypot(uOf(tx(i)) - lag[0], vOf(ty(i)) - lag[1]);
    if (d < 0.07 && tiles[i].water !== SEA) {
      tiles[i].water = LAKE;
      tiles[i].biome = "lagoon";
      tiles[i].h = Math.min(tiles[i].h, 0.05);
    }
  }
  // The ancient crater lake.
  const cl = PLACED.crater_lake!;
  for (let i = 0; i < tiles.length; i++)
    if (Math.hypot(uOf(tx(i)) - cl[0], vOf(ty(i)) - cl[1]) < 0.07) tiles[i].water = LAKE;
  // Ponds: many in the wetlands, a few in the basin. They shrink in droughts.
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.water) continue;
    const n = fbm(seed + 40, uOf(tx(i)) * 9, vOf(ty(i)) * 9);
    if ((t.region === "misty_wetlands" && n > 0.57) || (t.region === "fern_basin" && n > 0.72)) {
      t.water = LAKE;
      t.seasonal = true;
    }
  }

  // Rivers from the volcano's flanks to the sea.
  const rivers: number[][] = [];
  const sources: [number, number][] = SPRINGS.map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [tileAt(VC[0] + Math.cos(a) * 0.17, VC[1] + Math.sin(a) * 0.17), a];
  });
  // Highland streams that tumble off the plateau.
  sources.push([tileAt(0.52, -0.66), (-60 * Math.PI) / 180]);
  sources.push([tileAt(0.62, -0.42), (20 * Math.PI) / 180]);
  for (const [start, a] of sources) {
    const path = traceRiver(tiles, start, a, seed);
    rivers.push(path);
    for (const i of path) if (!tiles[i].water) tiles[i].water = RIVER;
    // Rivers widen as they near the sea.
    for (let k = Math.floor(path.length * 0.45); k < path.length; k++) {
      const i = path[k];
      const bank = around(i)
        .filter((n) => !tiles[n].water && Math.abs(tiles[n].h - tiles[i].h) < 0.5)
        .sort((p, q) => tiles[p].h - tiles[q].h || p - q)[0];
      if (bank !== undefined) {
        tiles[bank].water = RIVER;
        tiles[bank].h = Math.min(tiles[bank].h, tiles[i].h + 0.02);
      }
    }
  }
  // Rivers sit a little below their banks, and waterfalls mark the big drops.
  let falls = -1;
  let fallsDrop = 0;
  let fallsPath: number[] = [];
  let fallsAt = 0;
  for (const path of rivers)
    for (let k = 0; k < path.length - 1; k++) {
      const a = tiles[path[k]];
      const b = tiles[path[k + 1]];
      const drop = a.h - b.h;
      const r = fromVolcano(uOf(tx(path[k])), vOf(ty(path[k])));
      if (drop > 0.3 && r > 0.3 && a.water === RIVER) {
        a.falls = true;
        // Thunder Falls drops off the northern highlands.
        const high =
          tiles[path[k]].region === "titan_highlands" || tiles[path[k]].region === "predator_ridge";
        const score = drop + (high ? 2 : 0);
        if (score > fallsDrop) {
          [falls, fallsDrop] = [path[k], score];
          fallsPath = path;
          fallsAt = k;
        }
      }
    }
  // Below Thunder Falls the river has cut a deep gorge, down to near sea level.
  if (falls >= 0) {
    const cut = 1.5;
    const lowered = new Map<number, number>();
    for (let k = fallsAt + 1; k < fallsPath.length; k++) {
      const t = tiles[fallsPath[k]];
      if (t.water !== RIVER) break;
      const h = Math.max(Math.min(t.h, 0.08), t.h - cut);
      if (h >= t.h) break;
      t.h = h;
      lowered.set(fallsPath[k], h);
    }
    const above = new Set(fallsPath.slice(0, fallsAt + 1));
    // And the lip stands high on a rocky tableland: the river runs across it
    // to the edge and drops the full height of the cliff.
    const lip = tiles[falls].h + 2.1;
    const fx = tx(falls);
    const fy = ty(falls);
    const R = 6;
    const upstream = new Set(fallsPath.slice(Math.max(0, fallsAt - 8), fallsAt + 1));
    const downstream = new Set(fallsPath.slice(fallsAt + 1));
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
        const i = idx(x, y);
        const t = tiles[i];
        const d = Math.hypot(dx, dy);
        if (d > R || t.water === SEA || t.water === LAKE || lowered.has(i) || downstream.has(i))
          continue;
        if (upstream.has(i)) {
          // The river climbs gently back from the lip, so it still flows to it.
          t.h = Math.max(t.h, lip + d * 0.04);
          continue;
        }
        const k = Math.min(1, Math.max(0, (R - d) / (R - 2)));
        const top = lip + 0.2 - d * 0.12;
        if (t.water === RIVER) t.h = Math.max(t.h, t.h + (lip - t.h) * k);
        else t.h = Math.max(t.h, t.h + (top - t.h) * k);
      }
    for (const [i, h] of lowered)
      for (const n of around(i))
        if (tiles[n].water === RIVER && !lowered.has(n) && !above.has(n))
          tiles[n].h = Math.min(tiles[n].h, h + 0.02);
  }

  // Biomes and cover.
  const nearSea = (i: number) => around(i).some((n) => tiles[n].water === SEA);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const u = uOf(tx(i));
    const v = vOf(ty(i));
    const r = fromVolcano(u, v);
    const n = fbm(seed + 50, u * 8, v * 8);
    const slope = Math.max(...around(i).map((j) => Math.abs(tiles[j].h - t.h)));
    let biome: Biome;
    if (t.water === SEA) biome = t.h > -0.35 ? "shallows" : "sea";
    else if (t.biome === "lagoon") biome = "lagoon";
    else if (r < 0.035) biome = "lava";
    else if (t.region === "volcano") biome = n > 0.5 ? "ash" : "rock";
    else if (nearSea(i) && t.h > 1.1) biome = "cliff";
    else if (
      nearSea(i) &&
      (t.region === "misty_wetlands" || t.region === "sunken_jungle") &&
      t.h < 0.6
    )
      biome = "mangrove";
    else if (nearSea(i) && t.h < 0.6) biome = "beach";
    else if (slope > 1.3) biome = "rock";
    else
      switch (t.region) {
        case "fern_basin":
          biome = "fern";
          break;
        case "titan_highlands":
          biome = n > 0.56 ? "conifer" : "highland";
          break;
        case "predator_ridge":
          biome = n > 0.5 ? "conifer" : "ridge";
          break;
        case "misty_wetlands":
          biome = "wetland";
          break;
        case "emerald_grasslands":
          biome = "grass";
          break;
        case "settlers_bay":
        case "fertile_plains":
          biome = "plains";
          break;
        case "sunken_jungle":
          biome = "jungle";
          break;
        case "fossil_canyon":
          biome = n > 0.72 ? "tar" : "canyon";
          break;
        case "offshore":
          biome = n > 0.45 ? "jungle" : "grass";
          break;
        default:
          biome = "grass";
      }
    t.biome = biome;
    const [veg, forest] = BIOME_COVER[biome];
    t.veg = t.water ? 0 : veg * (0.8 + hash(seed, i, 3) * 0.4);
    // Trees clump in groves.
    t.forest = t.water ? 0 : Math.min(1, forest * (0.4 + fbm(seed + 60, u * 10, v * 10) * 1.2));
    if (t.region === "emerald_grasslands" && fbm(seed + 61, u * 7, v * 7) > 0.64) t.forest = 0.6;
  }
  // The geothermal springs steam on the volcano's flank.
  const gs = PLACED.geothermal_springs!;
  for (let i = 0; i < tiles.length; i++)
    if (Math.hypot(uOf(tx(i)) - gs[0], vOf(ty(i)) - gs[1]) < 0.045 && !tiles[i].water)
      tiles[i].biome = "springs";

  // Landmarks.
  const mark = (id: LandmarkId, i: number) => {
    tiles[i].landmark = id;
  };
  for (const [id, [u, v]] of Object.entries(PLACED) as [LandmarkId, [number, number]][]) {
    mark(id, landTileNear(tiles, tileAt(u, v), id === "coastal_lagoon" || id === "crater_lake"));
  }
  // Predator Ridge: the highest crag of the ridge.
  let crag = -1;
  tiles.forEach((t, i) => {
    if (t.region === "predator_ridge" && !t.water && (crag < 0 || t.h > tiles[crag].h)) crag = i;
  });
  if (crag >= 0) mark("predator_ridge", crag);
  if (falls >= 0) mark("thunder_falls", falls);
  // Dinosaur Island: the top of the big islet.
  const [du, dv] = ISLETS[0];
  mark("dinosaur_island", landTileNear(tiles, tileAt(du, dv), false));

  // Settler's Bay: the tribe's first camp on the shore of the bay.
  const bayCentre = tileAt(0.3, 0.7);
  const home = landTileNear(tiles, bayCentre, false, (t) => t.h < 1 && t.biome !== "cliff");
  mark("settlers_bay", home);

  // The old park: its yard on the flattest dry ground near the heart of the jungle.
  const sj = tiles.findIndex((t) => t.landmark === "sunken_jungle");
  if (sj >= 0) {
    delete tiles[sj].landmark;
    const site = flatSpot(tiles, sj);
    mark("sunken_jungle", site);
    levelSite(tiles, site);
  }
  // Trails worn through the trees from the tribe's home.
  for (const tr of trailNetwork(tiles).trails) for (const i of tr.tiles) tiles[i].forest *= 0.35;

  const pop = Object.fromEntries(SPECIES.map((s) => [s, { ...START_POP[s] }])) as Pop;

  const tribe: Tribe = {
    pop: 14,
    food: 40,
    wood: 12,
    stone: 0,
    knowledge: 0,
    morale: 0.7,
    focus: "balanced",
    techs: ["fire"],
    stage: 0,
    home,
    tamed: 0,
    fossils: 0,
  };

  const state: WorldState = {
    version: 4,
    name: ISLAND_NAME,
    seed,
    rng: seed ^ 0x5bd1e995,
    day: 0,
    tiles,
    pop,
    herds: [],
    nextHerd: 1,
    traits: Object.fromEntries(SPECIES.map((s) => [s, []])) as unknown as WorldState["traits"],
    sanctuaries: [],
    tribe,
    weather: { rain: 0, drought: 0, storm: 0, ash: 0 },
    volcano: 0.2,
    favour: 12,
    evo: 0,
    known: ["titan", "hornface", "duckbill", "skywing"],
    actions: [],
    chronicle: [],
    notices: [],
    outbreaks: [],
    history: {
      herds: Object.fromEntries(SPECIES.map((s) => [s, []])) as unknown as WorldState["history"]["herds"],
      tribe: [],
    },
    routesDirty: true,
  };
  return state;
}

/** The nearest dry, open tile to i (or the nearest water tile, when asked). */
function landTileNear(
  tiles: Tile[],
  i: number,
  water: boolean,
  ok: (t: Tile) => boolean = () => true,
): number {
  let best = i;
  let bestD = Infinity;
  const x0 = tx(i);
  const y0 = ty(i);
  for (let j = 0; j < tiles.length; j++) {
    const t = tiles[j];
    const good = water ? t.water === LAKE : !t.water && !t.landmark && ok(t);
    if (!good) continue;
    const d = Math.hypot(tx(j) - x0, ty(j) - y0);
    if (d < bestD) [best, bestD] = [j, d];
  }
  return best;
}

/** Tiles around i within r (Chebyshev), nearest first. */
export function ring(i: number, r: number, from = 0): number[] {
  const x = tx(i);
  const y = ty(i);
  const out: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < from || !inBounds(x + dx, y + dy)) continue;
      out.push([idx(x + dx, y + dy), d]);
    }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([j]) => j);
}

export { around };
/** Normalised position helpers, for renderers and labels. */
export const norm = { u: uOf, v: vOf, HALF };
