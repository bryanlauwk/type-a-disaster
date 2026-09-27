import { around, generateIsland, ring } from "./worldgen";
import {
  LAKE,
  REGIONS,
  RIVER,
  SEA,
  SIZE,
  idx,
  tx,
  ty,
  type RegionId,
  type Tile,
  type WorldState,
} from "./types";

export { around, ring };

/** Tiles of each region, and a representative tile near its middle. */
export interface Geography {
  tiles: Record<RegionId, number[]>;
  centre: Record<RegionId, number>;
  /** Regions that share a border (by land). */
  neighbours: Record<RegionId, RegionId[]>;
}

const cache = new Map<number, Geography>();

/**
 * Region geography. Regions never change shape, so it's computed once per
 * island seed and shared.
 */
export function geography(s: WorldState): Geography {
  const key = s.seed;
  const hit = cache.get(key);
  if (hit) return hit;
  // Always from the island as generated, so it never depends on what the god did.
  s = generateIsland(s.seed);
  const tiles = Object.fromEntries(REGIONS.map((r) => [r, [] as number[]])) as Record<
    RegionId,
    number[]
  >;
  s.tiles.forEach((t, i) => tiles[t.region].push(i));
  const centre = {} as Record<RegionId, number>;
  for (const r of REGIONS) {
    const list = tiles[r];
    if (!list.length) {
      centre[r] = 0;
      continue;
    }
    const mx = list.reduce((a, i) => a + tx(i), 0) / list.length;
    const my = list.reduce((a, i) => a + ty(i), 0) / list.length;
    // The dry tile of the region nearest its middle.
    let best = list[0];
    let bestD = Infinity;
    for (const i of list) {
      const t = s.tiles[i];
      const d = Math.hypot(tx(i) - mx, ty(i) - my) + (t.water === SEA ? 50 : t.water ? 5 : 0);
      if (d < bestD) [best, bestD] = [i, d];
    }
    centre[r] = best;
  }
  const links = Object.fromEntries(REGIONS.map((r) => [r, new Set<RegionId>()])) as Record<
    RegionId,
    Set<RegionId>
  >;
  s.tiles.forEach((t, i) => {
    if (t.water === SEA) return;
    for (const n of around(i)) {
      const o = s.tiles[n];
      if (o.water === SEA || o.region === t.region) continue;
      links[t.region].add(o.region);
    }
  });
  // The sea connects the coast with the islets.
  links.coast.add("offshore");
  links.offshore.add("coast");
  const neighbours = Object.fromEntries(REGIONS.map((r) => [r, [...links[r]].sort()])) as Record<
    RegionId,
    RegionId[]
  >;
  const g = { tiles, centre, neighbours };
  cache.set(key, g);
  return g;
}

/** How hard a tile is for a herd to cross. Infinity = impassable. */
export function stepCost(t: Tile, from: Tile, walkers = true): number {
  if (walkers && t.water === SEA) return Infinity;
  let c = 1 + Math.abs(t.h - from.h) * 2.5;
  if (t.water === LAKE) c += 6;
  if (t.water === RIVER) c += 1.5;
  if (t.fire > 0 || t.lava > 0) c += 40;
  if (t.build === "fence") c += 120;
  else if (t.build) c += 25;
  if (t.biome === "cliff" || t.biome === "rock") c += 4;
  return c;
}

/**
 * The cheapest walking route between two tiles (A*), or null. Herds use it,
 * so fences and villages bend migration routes around themselves.
 */
export function route(s: WorldState, from: number, to: number, limit = 6000): number[] | null {
  const n = SIZE * SIZE;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const open: number[] = [from];
  const f = new Float64Array(n).fill(Infinity);
  const h = (i: number) => Math.hypot(tx(i) - tx(to), ty(i) - ty(to));
  g[from] = 0;
  f[from] = h(from);
  const closed = new Uint8Array(n);
  let steps = 0;
  while (open.length && steps++ < limit) {
    // Small open lists: a linear scan is fine.
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) {
      const path = [cur];
      let c = cur;
      while (came[c] >= 0) path.push((c = came[c]));
      return path.reverse();
    }
    closed[cur] = 1;
    for (const nb of around(cur)) {
      if (closed[nb]) continue;
      const cost = stepCost(s.tiles[nb], s.tiles[cur]);
      if (!Number.isFinite(cost)) continue;
      const diag = tx(nb) !== tx(cur) && ty(nb) !== ty(cur) ? 1.41 : 1;
      const ng = g[cur] + cost * diag;
      if (ng < g[nb]) {
        g[nb] = ng;
        f[nb] = ng + h(nb);
        came[nb] = cur;
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  return null;
}

/** Sum of a route's crossing costs (how much of a detour or barrier it is). */
export function routeCost(s: WorldState, path: number[]): number {
  let c = 0;
  for (let k = 1; k < path.length; k++) c += stepCost(s.tiles[path[k]], s.tiles[path[k - 1]]);
  return c;
}

/** Whether a tile has water next to it (for drinking). */
export const nearWater = (s: WorldState, i: number) =>
  s.tiles[i].water > 0 || around(i).some((n) => s.tiles[n].water > 0 && s.tiles[n].water !== SEA);

/** Tile index for tile coordinates, clamped. */
export const clampIdx = (x: number, y: number) =>
  idx(Math.max(0, Math.min(SIZE - 1, x)), Math.max(0, Math.min(SIZE - 1, y)));
