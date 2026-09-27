import { DISTRICTS, districtAt, hollowTerrain, RAILROAD } from "./hollow";
import { surgeCoords, surgeHalfWidth, surgeShapeFor, type SurgeShape } from "./surge";
import {
  GRID_SIZE,
  SCALE_COST,
  type ActorKind,
  type BuildKind,
  type ChainKind,
  type ChainLink,
  type CityState,
  type EventRecord,
  type EventResult,
  type ImpactInfo,
  type Landmark,
  type Stats,
  type Tile,
  type TileKind,
  type TileOp,
  type TileTarget,
} from "./types";

const N = GRID_SIZE;
const CENTER = (N - 1) / 2;

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32). The state lives on CityState so a city can
// be replayed exactly from its seed and event log.
// ---------------------------------------------------------------------------

function rand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(s: { rng: number }, max: number): number {
  return Math.floor(rand(s) * max);
}

function pick<T>(s: { rng: number }, items: readonly T[]): T {
  return items[randInt(s, items.length)];
}

function shuffle<T>(s: { rng: number }, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

export const idx = (x: number, y: number) => y * N + x;
export const xy = (i: number) => ({ x: i % N, y: Math.floor(i / N) });

const NEIGHBORS: number[][] = Array.from({ length: N * N }, (_, i) => {
  const { x, y } = xy(i);
  const out: number[] = [];
  if (x > 0) out.push(idx(x - 1, y));
  if (x < N - 1) out.push(idx(x + 1, y));
  if (y > 0) out.push(idx(x, y - 1));
  if (y < N - 1) out.push(idx(x, y + 1));
  return out;
});
export const neighbors = (i: number) => NEIGHBORS[i];

function distToCenter(i: number): number {
  const { x, y } = xy(i);
  return Math.hypot(x - CENTER, y - CENTER);
}

const BUILDINGS: TileKind[] = ["house", "shop", "tower", "park", "landmark"];
export const isBuilding = (t: Tile) => BUILDINGS.includes(t.kind);
const isOccupied = (t: Tile) => t.kind === "house" || t.kind === "shop" || t.kind === "tower";

const VARIANTS: Partial<Record<TileKind, number>> = {
  house: 8,
  shop: 8,
  tower: 5,
  park: 4,
  forest: 4,
  rubble: 3,
};

function setKind(s: CityState, i: number, kind: TileKind, landmark?: Landmark) {
  s.grid[i] = {
    kind,
    variant: randInt(s, VARIANTS[kind] ?? 1),
    fire: 0,
    flood: 0,
    builtDay: s.day,
    ...(landmark ? { landmark } : {}),
  };
}

export function countKinds(grid: Tile[]): Record<TileKind, number> {
  const c: Record<TileKind, number> = {
    empty: 0,
    road: 0,
    house: 0,
    shop: 0,
    tower: 0,
    park: 0,
    forest: 0,
    rubble: 0,
    water: 0,
    rail: 0,
    landmark: 0,
  };
  for (const t of grid) c[t.kind]++;
  return c;
}

/** 0–100: how green and alive the city is. Derived, not stored. */
export function natureScore(grid: Tile[], pollution: number): number {
  const c = countKinds(grid);
  const land = grid.length - c.water;
  const green = (c.forest + c.park * 0.7) / Math.max(1, land);
  return Math.round(Math.min(100, Math.max(0, green * 750 - pollution * 0.3)));
}

const nearRoad = (s: CityState, i: number) => NEIGHBORS[i].some((n) => s.grid[n].kind === "road");
const nearBuilt = (s: CityState, i: number) => NEIGHBORS[i].some((n) => isOccupied(s.grid[n]));

/** Residents per tile: a family house, flats over a shop, a brick apartment block. */
function capacity(c: Record<TileKind, number>): number {
  return c.house * 14 + c.shop * 3 + c.tower * 60;
}

/** Cleared ground on the railroad's row goes back to track (bar the crossings). */
function clearedKind(i: number): TileKind {
  return Math.floor(i / N) === RAILROAD.row ? "rail" : "empty";
}

function pickKind(s: CityState, i: number): TileKind {
  const { mix } = districtAt(i);
  const total = mix.house + mix.shop + mix.tower || 1;
  const r = rand(s) * total;
  if (r < mix.tower) return "tower";
  if (r < mix.tower + mix.shop) return "shop";
  return "house";
}

// ---------------------------------------------------------------------------
// City creation
// ---------------------------------------------------------------------------

export function createCity(seed: number): CityState {
  const { kinds, landmarks } = hollowTerrain();
  const s: CityState = {
    version: 2,
    name: "Maple Hollow",
    seed,
    rng: seed | 0,
    day: 0,
    grid: kinds.map((kind, i) => ({
      kind,
      variant: 0,
      fire: 0,
      flood: 0,
      builtDay: 0,
      ...(landmarks.has(i) ? { landmark: landmarks.get(i) } : {}),
    })),
    stats: { population: 0, happiness: 65, money: 2_000_000, pollution: 10, rift: 0 },
    ongoing: [],
    scheduled: [],
    bulletins: [],
    log: [],
    collapsed: false,
  };

  for (let i = 0; i < s.grid.length; i++) {
    const t = s.grid[i];
    if (VARIANTS[t.kind]) t.variant = randInt(s, VARIANTS[t.kind]!);
    if (t.kind !== "empty") continue;
    const d = districtAt(i);
    if (d.protected) {
      t.kind = "forest";
      t.variant = randInt(s, 4);
      continue;
    }
    const road = nearRoad(s, i);
    if (rand(s) < d.density * (road ? 1 : 0.55)) setKind(s, i, pickKind(s, i));
    else if (d.id === "outskirts" && !road && rand(s) < 0.12) setKind(s, i, "forest");
  }

  s.stats.population = capacity(countKinds(s.grid));
  return s;
}

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function clampStats(st: Stats) {
  st.population = Math.max(0, Math.round(st.population));
  st.money = Math.round(st.money);
  st.happiness = clamp(st.happiness, 0, 100);
  st.pollution = clamp(st.pollution, 0, 100);
  st.rift = clamp(st.rift, 0, 100);
}

function addStats(st: Stats, d: Stats) {
  for (const k of Object.keys(st) as (keyof Stats)[]) st[k] += d[k];
}

function cloneState(prev: CityState): CityState {
  return {
    ...prev,
    grid: prev.grid.map((t) => ({ ...t })),
    stats: { ...prev.stats },
    ongoing: prev.ongoing.map((o) => ({ ...o })),
    scheduled: [...prev.scheduled],
    bulletins: [...prev.bulletins],
    log: [...prev.log],
  };
}

export function tick(prev: CityState): CityState {
  if (prev.collapsed) return prev;
  const s = cloneState(prev);
  s.day += 1;
  const st = s.stats;

  // Ongoing effects from earlier events.
  for (const eff of s.ongoing) {
    addStats(st, eff.perDay);
    eff.daysLeft -= 1;
  }
  s.ongoing = s.ongoing.filter((e) => e.daysLeft > 0);

  // Chain reactions scheduled by earlier events.
  const due = s.scheduled.filter((f) => f.day <= s.day);
  if (due.length) {
    s.scheduled = s.scheduled.filter((f) => f.day > s.day);
    for (const f of due) {
      addStats(st, f.stat_changes);
      for (const op of f.tile_ops.slice(0, 4)) applyOp(s, op);
      s.bulletins.push({ day: s.day, text: f.note, source: f.source });
    }
  }

  // Fire spreads more readily through polluted, supernatural, low-green towns.
  const greenCover = natureScore(s.grid, st.pollution);
  const fireSpreadChance = clamp(
    0.12 + st.pollution / 500 + st.rift / 500 + (40 - greenCover) / 1400,
    0.04,
    0.42,
  );
  const burning = s.grid.map((t, i) => (t.fire > 0 ? i : -1)).filter((i) => i >= 0);
  for (const i of burning) {
    const t = s.grid[i];
    const fuel = NEIGHBORS[i].filter((n) => {
      const neighbor = s.grid[n];
      return (isBuilding(neighbor) || neighbor.kind === "forest") && neighbor.fire === 0;
    });
    if (fuel.length && rand(s) < fireSpreadChance) {
      const n = pick(s, fuel);
      s.grid[n].fire = 3 + randInt(s, 2);
    }
    t.fire -= 1;
    if (t.fire === 0) setKind(s, i, "rubble");
  }

  // A fire that reaches the gas station, the water tower or the lab sets off
  // its own chain reaction, reported in the next edition.
  if (s.log.some((e) => (e.physics ?? 0) >= 1)) {
    for (const i of specialLandmarks(s.grid)) {
      if (s.grid[i].fire === 0) continue;
      const link = setOff(s, i, i, s.grid[i].landmark!);
      if (link)
        s.bulletins.push({
          day: s.day,
          text: CHAIN_NOTE[link.kind](link.name),
          // Filed under the latest story, which is usually what started the fire.
          source: s.log[s.log.length - 1]?.result.headline ?? "",
        });
    }
  }

  // Floods recede, occasionally damage buildings, and can spill into nearby
  // low ground. Green cover slows the spread; proximity to water speeds it up.
  const floodSpreadChance = clamp(
    0.025 + st.pollution / 2000 + (40 - greenCover) / 2000,
    0.015,
    0.16,
  );
  const flooded = s.grid.map((t, i) => (t.flood > 0 ? i : -1)).filter((i) => i >= 0);
  for (const i of flooded) {
    const t = s.grid[i];
    const waterEdge = NEIGHBORS[i].some((n) => s.grid[n].kind === "water");
    const floodable = NEIGHBORS[i].filter((n) => {
      const neighbor = s.grid[n];
      return neighbor.kind !== "water" && neighbor.flood === 0 && neighbor.fire === 0;
    });
    const spreadChance = Math.min(0.24, floodSpreadChance + (waterEdge ? 0.08 : 0));
    if (floodable.length && rand(s) < spreadChance) {
      const n = pick(s, floodable);
      s.grid[n].flood = 2 + randInt(s, 2);
    }
    t.flood -= 1;
    if (isOccupied(t) && rand(s) < 0.06) setKind(s, i, "rubble");
  }

  // Rubble gets cleared; abandoned land slowly turns back into forest.
  for (let i = 0; i < s.grid.length; i++) {
    const t = s.grid[i];
    if (t.kind === "rubble" && s.day - t.builtDay >= 5 && rand(s) < 0.3)
      setKind(s, i, clearedKind(i));
    else if (t.kind === "empty" && s.day - t.builtDay > 30 && rand(s) < 0.004 && !nearRoad(s, i))
      setKind(s, i, "forest");
  }

  // Growth: the city builds itself when people are happy and it isn't broke.
  const lots: number[] = [];
  for (let i = 0; i < s.grid.length; i++) {
    const t = s.grid[i];
    if (t.kind === "empty" && t.flood === 0 && (nearRoad(s, i) || nearBuilt(s, i))) lots.push(i);
  }
  const attempts = 2 + Math.floor(st.happiness / 20);
  const growthChance = ((0.6 * st.happiness) / 60) * (st.money > -2_000_000 ? 1 : 0.3);
  for (let a = 0; a < attempts && lots.length; a++) {
    if (rand(s) >= growthChance) continue;
    // Prefer busy districts and lots on a road.
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < 6; k++) {
      const i = lots[randInt(s, lots.length)];
      const score = districtAt(i).density + (nearRoad(s, i) ? 0.3 : 0) + rand(s) * 0.4;
      if (score > bestScore) [best, bestScore] = [i, score];
    }
    lots.splice(lots.indexOf(best), 1);
    const kind: TileKind = st.pollution > 55 && rand(s) < 0.25 ? "park" : pickKind(s, best);
    setKind(s, best, kind);
  }

  // Sprawl: when land runs short, forest at the edge of town gets cleared.
  if (lots.length < 25 && st.happiness > 35 && rand(s) < 0.5) {
    const edge = s.grid
      .map((t, i) => i)
      .filter(
        (i) =>
          s.grid[i].kind === "forest" &&
          !districtAt(i).protected &&
          (nearRoad(s, i) || nearBuilt(s, i)),
      );
    if (edge.length) setKind(s, pick(s, edge), "empty");
  }

  // Redevelopment: old low-rise gets replaced by denser buildings.
  if (st.happiness > 35 && rand(s) < 0.35) {
    const i = randInt(s, s.grid.length);
    const t = s.grid[i];
    const { mix } = districtAt(i);
    if (t.kind === "house" && mix.shop + mix.tower > 0.3)
      setKind(s, i, rand(s) < mix.tower ? "tower" : "shop");
    else if (t.kind === "shop" && rand(s) < mix.tower) setKind(s, i, "tower");
  }

  // Greening: when the air gets bad, the council turns a block into a park.
  if (st.pollution > 45 && rand(s) < 0.2) {
    const i = randInt(s, s.grid.length);
    if (isOccupied(s.grid[i]) || s.grid[i].kind === "empty") setKind(s, i, "park");
  }

  // Misery: people abandon homes.
  if (st.happiness < 25 && rand(s) < 0.4) {
    const homes = s.grid.map((t, i) => i).filter((i) => isOccupied(s.grid[i]));
    if (homes.length) setKind(s, pick(s, homes), "rubble");
  }

  // Economy & mood.
  const c = countKinds(s.grid);
  const fires = s.grid.filter((t) => t.fire > 0).length;
  const floods = s.grid.filter((t) => t.flood > 0).length;
  const targetPop = capacity(c) * (0.5 + st.happiness / 200);
  st.population += (targetPop - st.population) * 0.12;

  const taxes = st.population * 2 + c.shop * 150 + c.tower * 300;
  const upkeep = c.road * 40 + c.park * 60 + c.landmark * 250;
  st.money += taxes - upkeep;

  const targetPollution =
    c.tower * 0.22 + c.shop * 0.08 + c.road * 0.04 + fires * 3 - c.park * 0.4 - c.forest * 0.15;
  st.pollution += (targetPollution - st.pollution) * 0.1;

  const nature = natureScore(s.grid, st.pollution);
  const targetHappiness =
    52 +
    nature * 0.2 +
    Math.min(c.landmark, 10) * 0.6 -
    st.pollution * 0.35 -
    st.rift * 0.3 -
    fires * 2 -
    floods * 0.5 -
    (st.money < 0 ? 12 : 0);
  st.happiness += (targetHappiness - st.happiness) * 0.08;
  // The gate closes slowly on its own.
  st.rift *= 0.97;
  clampStats(st);

  if (s.day > 5 && (c.house + c.shop + c.tower === 0 || st.population < 1)) s.collapsed = true;
  return s;
}

// ---------------------------------------------------------------------------
// Applying a typed event
// ---------------------------------------------------------------------------

const TARGET_KIND: Partial<Record<TileTarget, TileKind>> = {
  residential: "house",
  commercial: "shop",
  towers: "tower",
  parks: "park",
  forest: "forest",
  roads: "road",
  empty: "empty",
  landmarks: "landmark",
};

/** Tiles in the targeted area, best matches first. */
function targetTiles(s: CityState, target: TileTarget): number[] {
  const all = s.grid.map((_, i) => i).filter((i) => s.grid[i].kind !== "water");
  const kind = TARGET_KIND[target];
  if (kind)
    return shuffle(
      s,
      all.filter((i) => s.grid[i].kind === kind),
    );
  if (target === "center")
    return all
      .map((i) => [i, distToCenter(i) + rand(s) * 3] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([i]) => i);
  // The map has no tiles of its own for "outskirts": it means the city's edge.
  if (target === "edge" || target === "outskirts")
    return shuffle(
      s,
      all.filter((i) => {
        const { x, y } = xy(i);
        return Math.min(x, y, N - 1 - x, N - 1 - y) <= 2;
      }),
    );
  if (target === "river")
    return shuffle(
      s,
      all.filter((i) => NEIGHBORS[i].some((n) => s.grid[n].kind === "water")),
    );
  if (target === "railroad")
    return shuffle(
      s,
      all.filter((i) => Math.abs(xy(i).y - RAILROAD.row) <= 1),
    );
  if (target === "random") return shuffle(s, all);
  // A district name.
  const inDistrict = all.filter((i) => districtAt(i).id === target);
  return shuffle(s, inDistrict);
}

/** What each kind of tile can be redeveloped into when its area is full. */
const REDEVELOP: Partial<Record<BuildKind, TileKind[]>> = {
  tower: ["house", "shop"],
  shop: ["house"],
  park: ["house", "shop"],
  forest: ["house", "shop"],
};

const isFree = (s: CityState, i: number) =>
  s.grid[i].kind === "empty" || s.grid[i].kind === "rubble";

/** The targeted area: the tiles themselves, or those next to a targeted kind. */
function targetArea(s: CityState, target: TileTarget): number[] {
  const kind = TARGET_KIND[target];
  if (!kind || kind === "empty") return targetTiles(s, target);
  const near = new Set<number>();
  s.grid.forEach((t, i) => {
    if (t.kind === kind) NEIGHBORS[i].forEach((n) => near.add(n));
  });
  return shuffle(s, [...near]);
}

/** Free lots within a few tiles of an area, nearest first (no RNG draws). */
function lotsAround(s: CityState, area: number[], reach = 3): number[] {
  const inArea = new Set(area);
  const found: [number, number][] = [];
  s.grid.forEach((_, i) => {
    if (inArea.has(i) || !isFree(s, i)) return;
    const { x, y } = xy(i);
    let best = Infinity;
    for (const a of area) {
      const p = xy(a);
      best = Math.min(best, Math.max(Math.abs(p.x - x), Math.abs(p.y - y)));
      if (best === 1) break;
    }
    // Ties broken by a fixed per-tile order, so replays don't shift the RNG.
    if (best <= reach) found.push([i, best + ((i * 2654435761) % 997) / 2000]);
  });
  return found.sort((a, b) => a[1] - b[1]).map(([i]) => i);
}

/**
 * Where a build lands: free lots in the targeted area, then (for things that
 * can replace older buildings) redevelopment inside the area, then the nearest
 * free lots around it. A full district still gets what the event promised.
 */
function buildLots(s: CityState, target: TileTarget, build: BuildKind): number[] {
  const area = targetArea(s, target);
  const replaceable = REDEVELOP[build] ?? [];
  return [
    ...area.filter((i) => isFree(s, i)),
    ...area.filter((i) => replaceable.includes(s.grid[i].kind)),
    ...lotsAround(s, area),
  ];
}

/** A landmark goes where it was aimed, over ordinary buildings if need be. */
function landmarkLots(s: CityState, target: TileTarget): number[] {
  const area = targetArea(s, target);
  const ordinary = (i: number) => !["road", "landmark", "water"].includes(s.grid[i].kind);
  return [
    ...area.filter((i) => isFree(s, i)),
    ...area.filter((i) => ordinary(i) && !isFree(s, i)),
    ...lotsAround(s, area),
    ...area.filter((i) => s.grid[i].kind === "landmark"),
  ];
}

const DEFAULT_LANDMARK: Landmark = {
  name: "Monument",
  shape: "statue",
  color: "#c9a227",
  height: 1.5,
};

function applyOp(s: CityState, op: TileOp) {
  const max = op.op === "landmark" ? 2 : 30;
  const count = clamp(Math.round(op.count), 1, max);
  let tiles: number[] = [];

  switch (op.op) {
    case "destroy":
      tiles = targetTiles(s, op.target).filter(
        (i) => !["empty", "rubble"].includes(s.grid[i].kind),
      );
      tiles.slice(0, count).forEach((i) => setKind(s, i, "rubble"));
      break;
    case "burn":
      tiles = targetTiles(s, op.target).filter(
        (i) => (isBuilding(s.grid[i]) || s.grid[i].kind === "forest") && s.grid[i].fire === 0,
      );
      tiles.slice(0, count).forEach((i) => (s.grid[i].fire = 3 + randInt(s, 3)));
      break;
    case "flood":
      tiles = targetTiles(s, op.target);
      tiles.slice(0, count).forEach((i) => (s.grid[i].flood = 3 + randInt(s, 3)));
      break;
    case "clear":
      tiles = targetTiles(s, op.target).filter((i) => {
        const t = s.grid[i];
        return t.kind === "rubble" || t.fire > 0 || t.flood > 0;
      });
      tiles.slice(0, count).forEach((i) => {
        if (s.grid[i].kind === "rubble") setKind(s, i, clearedKind(i));
        s.grid[i].fire = 0;
        s.grid[i].flood = 0;
      });
      break;
    case "build": {
      const kind: BuildKind = op.build_kind ?? "house";
      buildLots(s, op.target, kind)
        .slice(0, count)
        .forEach((i) => setKind(s, i, kind));
      break;
    }
    case "landmark": {
      const lm = op.landmark ?? DEFAULT_LANDMARK;
      landmarkLots(s, op.target)
        .slice(0, count)
        .forEach((i) => setKind(s, i, "landmark", lm));
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Impact physics: what an event does to what's around it. Everything here is
// drawn from the city's RNG, so a replay lands every brick in the same place.
// ---------------------------------------------------------------------------

const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;

/** Chebyshev distance in tiles. */
function cheb(a: number, b: number): number {
  const p = xy(a);
  const q = xy(b);
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
}

/** Tiles within r of c (Chebyshev), nearest rings first. */
function ring(c: number, r: number, from = 0): number[] {
  const { x, y } = xy(c);
  const out: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < from || !inBounds(x + dx, y + dy)) continue;
      out.push([idx(x + dx, y + dy), d]);
    }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([i]) => i);
}

/** Tiles on a straight line through c, from offset `from` down to `to`. */
function line(c: number, angle: number, from: number, to: number): number[] {
  const { x, y } = xy(c);
  const out: number[] = [];
  for (let o = from; o >= to; o -= 0.5) {
    const tx = Math.round(x + Math.cos(angle) * o);
    const ty = Math.round(y + Math.sin(angle) * o);
    if (!inBounds(tx, ty)) continue;
    const i = idx(tx, ty);
    if (out[out.length - 1] !== i && !out.includes(i)) out.push(i);
  }
  return out;
}

function tileChanged(a: Tile, b: Tile) {
  return a.kind !== b.kind || a.fire !== b.fire || a.flood !== b.flood || a.builtDay !== b.builtDay;
}

/** Where the event lands: the heart of the biggest cluster of changes. */
function findEpicentre(before: Tile[], s: CityState, result: EventResult): number {
  const changed: number[] = [];
  for (let i = 0; i < before.length; i++) if (tileChanged(before[i], s.grid[i])) changed.push(i);
  if (!changed.length) {
    // Nothing changed on the map: the street nearest the targeted district.
    const target = result.tile_ops[0]?.target;
    const d = DISTRICTS.find((dd) => dd.id === target);
    const [cx, cy] = d
      ? [(d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2]
      : [CENTER, CENTER];
    let best = idx(Math.round(cx), Math.round(cy));
    let bestD = Infinity;
    s.grid.forEach((t, i) => {
      if (t.kind !== "road") return;
      const { x, y } = xy(i);
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < bestD) [best, bestD] = [i, dist];
    });
    return best;
  }
  let mx = 0;
  let my = 0;
  for (const i of changed) {
    mx += xy(i).x;
    my += xy(i).y;
  }
  mx /= changed.length;
  my /= changed.length;
  const d = (i: number) => Math.hypot(xy(i).x - mx, xy(i).y - my);
  const core = [...changed].sort((a, b) => d(a) - d(b) || a - b);
  core.length = Math.max(1, Math.ceil(core.length / 2));
  const cx = core.reduce((acc, i) => acc + xy(i).x, 0) / core.length;
  const cy = core.reduce((acc, i) => acc + xy(i).y, 0) / core.length;
  return core.reduce((best, i) =>
    Math.hypot(xy(i).x - cx, xy(i).y - cy) < Math.hypot(xy(best).x - cx, xy(best).y - cy)
      ? i
      : best,
  );
}

/** Damage an event may add on top of what the newsroom asked for. */
const COLLATERAL_BUDGET = { minor: 3, citywide: 7, apocalyptic: 16 };

interface Damage {
  s: CityState;
  budget: number;
  hit: number[];
}

/** Knock a building down. */
function wreck(d: Damage, i: number): boolean {
  if (d.budget <= 0 || !isOccupied(d.s.grid[i])) return false;
  setKind(d.s, i, "rubble");
  d.budget -= 1;
  d.hit.push(i);
  return true;
}

/** Set a building or a stand of trees alight. */
function ignite(s: CityState, i: number, days = 3): boolean {
  const t = s.grid[i];
  if (t.fire > 0 || !(isBuilding(t) || t.kind === "forest")) return false;
  if (t.landmark?.shape === "plaza" || t.landmark?.shape === "crater") return false;
  t.fire = days + randInt(s, 2);
  return true;
}

/** Put a tile under water. */
function drench(s: CityState, i: number): boolean {
  const t = s.grid[i];
  if (t.kind === "water" || t.flood > 0) return false;
  t.flood = 2 + randInt(s, 2);
  t.fire = 0;
  return true;
}

/** Actors whose arrival physically shoves the town around. */
const PHYSICAL = new Set<ActorKind>([
  "meteor",
  "giant_object",
  "whale",
  "kaiju",
  "tornado",
  "wave",
  "earthquake",
  "sinkhole",
  "landslide",
  "storm",
  "ufo",
  "flood",
  "wildfire",
]);

/** Kinds that only get physics from version 2 on. */
const V2_KINDS = new Set<ActorKind>(["flood", "wildfire"]);

/** The current impact physics version, recorded on each new event. */
export const PHYSICS = 2 as const;

/** Where a wildfire comes from: deep in Blackpine Woods. */
const WOODS = { x: 6, y: 3 };
/** How far behind the epicentre a wildfire starts, in tiles. */
export const WILDFIRE_RUN = 8;

/**
 * The water runs along the surge's path: every tile it reaches goes under,
 * and the crest knocks buildings down on the way (a flash flood mostly just
 * floods). Tiles are listed in the order the water gets there.
 */
function surgeCollateral(
  s: CityState,
  d: Damage,
  trail: number[],
  epi: number,
  kind: "wave" | "flood",
  size: number,
  scale: EventResult["scale"],
): SurgeShape {
  const step = SCALE_STEP[scale];
  const lakeTile = (x: number, y: number) =>
    s.grid[idx(x, y)].kind === "water" && districtAt(idx(x, y)).id === "mirror_lake";
  const shape = surgeShapeFor(
    kind === "wave" ? "tsunami" : "flash",
    xy(epi),
    N,
    (x, y) => s.grid[idx(x, y)].kind === "water",
    lakeTile,
    size,
    step,
  );
  const reached: [number, number][] = [];
  for (let i = 0; i < s.grid.length; i++) {
    if (s.grid[i].kind === "water") continue;
    const { x, y } = xy(i);
    const [along, lat] = surgeCoords(shape, x - CENTER, y - CENTER);
    if (along < 0 || along > shape.reach + shape.runout) continue;
    if (lat > surgeHalfWidth(shape, along)) continue;
    // A flash flood races down the channel but only pools around the epicentre.
    if (kind === "flood" && Math.hypot(x - xy(epi).x, y - xy(epi).y) > 2.5 + step) continue;
    reached.push([i, along]);
  }
  reached.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const odds = kind === "wave" ? 0.45 : 0.1;
  for (const [i, along] of reached) {
    // Near the shore the water is still gathering speed.
    const hard = kind === "flood" || along > shape.reach * 0.25;
    if (hard && rand(s) < odds && wreck(d, i)) trail.push(i);
    else if (drench(s, i)) trail.push(i);
  }
  return shape;
}

/**
 * A wall of fire sweeps out of the woods towards the epicentre, setting light
 * to trees and houses in its way. Returns its heading.
 */
function wildfireCollateral(
  s: CityState,
  d: Damage,
  trail: number[],
  epi: number,
  angle: number,
  scale: EventResult["scale"],
): number {
  const { x, y } = xy(epi);
  const dx = x - WOODS.x;
  const dy = y - WOODS.y;
  const heading = Math.hypot(dx, dy) > 2 ? Math.atan2(dy, dx) : angle;
  const width = 1 + SCALE_STEP[scale];
  // Walk the line from the woods side up to just past the epicentre.
  const spine = line(epi, heading + Math.PI, WILDFIRE_RUN, -2);
  const seen = new Set<number>();
  for (const c of spine) {
    for (const i of ring(c, width)) {
      if (seen.has(i)) continue;
      seen.add(i);
      const odds = cheb(i, c) === 0 ? 0.9 : 0.45;
      if (rand(s) < odds && ignite(s, i)) {
        trail.push(i);
        d.hit.push(i);
      }
    }
  }
  return heading;
}

const SCALE_STEP = { minor: 0, citywide: 1, apocalyptic: 2 };

function collateral(
  s: CityState,
  result: EventResult,
  epi: number,
  angle: number,
  version: 1 | 2,
): { trail: number[]; blast: number[]; surge?: SurgeShape; heading?: number } {
  const actor = result.spectacle.actors.find(
    (a) => PHYSICAL.has(a.kind) && (version >= 2 || !V2_KINDS.has(a.kind)),
  );
  const d: Damage = { s, budget: COLLATERAL_BUDGET[result.scale], hit: [] };
  const trail: number[] = [];
  if (!actor) return { trail, blast: d.hit };
  if (version >= 2 && (actor.kind === "wave" || actor.kind === "flood")) {
    const surge = surgeCollateral(s, d, trail, epi, actor.kind, actor.size, result.scale);
    return { trail, blast: d.hit, surge, heading: Math.atan2(surge.dz, surge.dx) };
  }
  if (actor.kind === "wildfire") {
    const heading = wildfireCollateral(s, d, trail, epi, angle, result.scale);
    return { trail, blast: d.hit, heading };
  }
  const step = SCALE_STEP[result.scale];
  const big = actor.size >= 5 ? 1 : 0;

  switch (actor.kind) {
    case "meteor":
    case "giant_object":
    case "whale": {
      // A blast ring: the closer to the epicentre, the likelier to go down.
      const r = 1 + big + (step === 2 ? 1 : 0);
      wreck(d, epi);
      for (const i of ring(epi, r, 1)) {
        const odds = [1, 0.7, 0.4, 0.2][cheb(i, epi)] ?? 0;
        if (rand(s) < odds) wreck(d, i);
      }
      if (actor.kind === "meteor") {
        // Burning fragments land beyond the blast.
        let lit = 0;
        for (const i of ring(epi, r + 1, r + 1))
          if (lit < 1 + step && rand(s) < 0.3 && ignite(s, i)) {
            lit += 1;
            d.hit.push(i);
          }
        // The crater stays.
        const t = s.grid[epi];
        const craterNear = ring(epi, 2).some((i) => s.grid[i].landmark?.shape === "crater");
        if (!craterNear && (t.kind === "rubble" || t.kind === "empty")) {
          setKind(s, epi, "landmark", {
            name: "The impact crater",
            shape: "crater",
            color: "#4a3a2e",
            height: 0.35,
          });
          d.hit.push(epi);
        }
      }
      if (actor.kind === "whale")
        for (const i of ring(epi, 1, 1)) if (rand(s) < 0.6 && drench(s, i)) d.hit.push(i);
      break;
    }
    case "kaiju":
    case "tornado": {
      // Whatever it walks (or spins) through comes down, in the order it gets there.
      const reach = actor.kind === "kaiju" ? 5 + 2 * step : 6 + 3 * step;
      const odds = actor.kind === "kaiju" ? 0.75 : 0.55;
      for (const i of line(epi, angle, reach, -reach))
        if (rand(s) < odds && wreck(d, i)) trail.push(i);
      break;
    }
    case "wave": {
      // (Version 1) The surge rolls in from the west and floods a band of streets.
      const { x, y } = xy(epi);
      const half = step;
      const back = [3, 6, 8][step];
      for (let dx = -back; dx <= 2; dx++)
        for (let dy = -half; dy <= half; dy++) {
          if (!inBounds(x + dx, y + dy)) continue;
          const i = idx(x + dx, y + dy);
          if (dx >= -2 && rand(s) < 0.2 && wreck(d, i)) trail.push(i);
          else if (drench(s, i)) trail.push(i);
        }
      break;
    }
    case "earthquake": {
      // Cracks run out from the epicentre; tall buildings go first.
      const odds: Partial<Record<TileKind, number>> = { tower: 0.45, shop: 0.25, house: 0.2 };
      for (const i of ring(epi, 3 + step)) if (rand(s) < (odds[s.grid[i].kind] ?? 0)) wreck(d, i);
      break;
    }
    case "sinkhole":
    case "landslide": {
      const r = actor.kind === "sinkhole" ? 1 : 2;
      for (const i of ring(epi, r))
        if (rand(s) < (actor.kind === "sinkhole" ? 0.6 : 0.5)) wreck(d, i);
      break;
    }
    case "storm": {
      // Lightning finds the tallest things around.
      const strikes = [1, 2, 4][step];
      const targets = ring(epi, 5).filter((i) => {
        const t = s.grid[i];
        return (
          t.kind === "tower" || t.kind === "landmark" || (t.kind === "forest" && rand(s) < 0.2)
        );
      });
      for (let k = 0; k < strikes && targets.length; k++) {
        const i = targets.splice(randInt(s, targets.length), 1)[0];
        if (ignite(s, i)) d.hit.push(i);
      }
      break;
    }
    case "ufo": {
      // The beam takes a house with it.
      const home = ring(epi, 1).find((i) => isOccupied(s.grid[i]));
      if (home !== undefined) {
        setKind(s, home, "empty");
        d.hit.push(home);
      }
      break;
    }
  }
  return { trail, blast: d.hit };
}

/** Landmarks that go off when damage reaches them. */
const SPECIAL: Partial<Record<Landmark["shape"], ChainKind>> = {
  gas_station: "explosion",
  water_tower: "burst",
  radio_tower: "blackout",
  lab: "breach",
  junkyard: "blaze",
};

function specialLandmarks(grid: Tile[]): number[] {
  const out: number[] = [];
  grid.forEach((t, i) => {
    if (t.kind === "landmark" && t.landmark && SPECIAL[t.landmark.shape]) out.push(i);
  });
  return out;
}

const CHAIN_STATS: Record<ChainKind, Partial<Stats>> = {
  explosion: { happiness: -3, pollution: 4, money: -3000 },
  burst: { happiness: -1, money: -1500 },
  blackout: { happiness: -2, money: -1000 },
  breach: { happiness: -2, rift: 8 },
  blaze: { happiness: -1, pollution: 8 },
  topple: {},
};

const cap = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const CHAIN_LABEL: Record<ChainKind, (name: string) => string> = {
  explosion: (n) => `${cap(n)} explodes`,
  burst: (n) => `${cap(n)} bursts`,
  blackout: (n) => `${cap(n)} comes down; the lights go out`,
  breach: (n) => `Alarms at ${n}`,
  blaze: (n) => `${cap(n)} catches fire`,
  topple: () => "",
};

/** The Courier's line when a chain reaction goes off between events. */
export const CHAIN_NOTE: Record<ChainKind, (name: string) => string> = {
  explosion: (n) =>
    `${cap(n)} went up with a bang heard three counties over. The fire chief blames "a dropped cigarette."`,
  burst: (n) =>
    `${cap(n)} burst and sent a wall of water down the street. The council calls it "an unscheduled flushing."`,
  blackout: (n) =>
    `${cap(n)} came down across the power lines. The lights are out until further notice.`,
  breach: (n) => `Alarms sounded all night at ${n}. A spokesman says the new fence is "for deer."`,
  blaze: (n) =>
    `The tyre pile at ${n} caught fire. Residents are asked to keep their windows shut.`,
  topple: () => "",
};

/** One landmark going off. Returns what it did, with the landmark's name. */
function setOff(
  s: CityState,
  i: number,
  from: number,
  lm: Landmark,
): (ChainLink & { name: string }) | null {
  const kind = SPECIAL[lm.shape];
  if (!kind) return null;
  const tiles = [i];
  const add = (j: number, ok: boolean) => ok && !tiles.includes(j) && tiles.push(j);
  switch (kind) {
    case "explosion":
      setKind(s, i, "rubble");
      for (const j of ring(i, 2, 1))
        if (tiles.length < 8 && (cheb(i, j) === 1 || rand(s) < 0.35)) add(j, ignite(s, j));
      break;
    case "burst":
      setKind(s, i, "rubble");
      // The water puts out any fire it reaches.
      for (const j of ring(i, 2, 1)) if (tiles.length < 14) add(j, drench(s, j));
      break;
    case "blackout": {
      // The mast falls across whatever is beside it.
      setKind(s, i, "rubble");
      const fall = rand(s) * Math.PI * 2;
      for (const j of line(i, fall, 3, 1)) {
        if (!isOccupied(s.grid[j])) continue;
        setKind(s, j, "rubble");
        add(j, true);
      }
      break;
    }
    case "breach":
      s.grid[i].fire = 0;
      break;
    case "blaze":
      s.grid[i].fire = Math.max(s.grid[i].fire, 5);
      for (const j of ring(i, 1, 1)) if (tiles.length < 4) add(j, ignite(s, j));
      break;
  }
  addStats(s.stats, {
    population: 0,
    happiness: 0,
    money: 0,
    pollution: 0,
    rift: 0,
    ...CHAIN_STATS[kind],
  });
  return { kind, tile: i, from, tiles, label: CHAIN_LABEL[kind](lm.name), name: lm.name };
}

/**
 * Knock-on reactions spreading out from the damage: apartment blocks topple
 * onto their neighbours, and landmarks caught in it go off, which can set
 * off others in turn.
 */
function chainReactions(s: CityState, before: Tile[], damaged: number[]): ChainLink[] {
  const chain: ChainLink[] = [];
  // Towers fall onto the house next door.
  let topples = 0;
  for (const i of damaged) {
    if (topples >= 3) break;
    if (before[i].kind !== "tower" || s.grid[i].kind !== "rubble" || rand(s) >= 0.4) continue;
    const next = NEIGHBORS[i].filter((n) => {
      const { x, y } = xy(n);
      const p = xy(i);
      return (x === p.x || y === p.y) && isOccupied(s.grid[n]);
    });
    if (!next.length) continue;
    const n = pick(s, next);
    setKind(s, n, "rubble");
    chain.push({ kind: "topple", tile: i, from: i, tiles: [n], label: "" });
    topples += 1;
  }

  // Landmarks, as they were before the event (a flattened one still counts).
  const specials: [number, Landmark][] = [];
  before.forEach((t, i) => {
    if (t.kind === "landmark" && t.landmark && SPECIAL[t.landmark.shape])
      specials.push([i, t.landmark]);
  });
  s.grid.forEach((t, i) => {
    if (
      t.kind === "landmark" &&
      t.landmark &&
      SPECIAL[t.landmark.shape] &&
      !specials.some(([j]) => j === i)
    )
      specials.push([i, t.landmark]);
  });
  const spent = new Set<number>();
  let frontier = [...damaged, ...chain.flatMap((l) => l.tiles)];
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const reached: number[] = [];
    for (const [i, lm] of specials) {
      if (spent.has(i)) continue;
      const trigger = frontier.find((j) => cheb(i, j) <= 1);
      if (trigger === undefined) continue;
      // Caught by the edge of it: a fair chance it holds.
      if (trigger !== i && rand(s) >= 0.6) continue;
      spent.add(i);
      const link = setOff(s, i, trigger, lm);
      if (!link) continue;
      const { name: _n, ...rest } = link;
      chain.push(rest);
      reached.push(...link.tiles);
    }
    frontier = reached;
  }
  return chain;
}

/** Adds the physical consequences of an event and returns where it hit. */
function applyPhysics(
  s: CityState,
  before: Tile[],
  result: EventResult,
  version: 1 | 2,
): ImpactInfo {
  const tile = findEpicentre(before, s, result);
  let angle = rand(s) * Math.PI * 2;
  const { trail, blast, surge, heading } = collateral(s, result, tile, angle, version);
  if (heading !== undefined) angle = heading;
  const damaged: number[] = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = s.grid[i];
    if ((b.kind === "rubble" && a.kind !== "rubble") || (b.fire > 0 && a.fire === 0))
      damaged.push(i);
  }
  // Nearest the epicentre first, so reactions spread outwards.
  damaged.sort((a, b) => cheb(a, tile) - cheb(b, tile) || a - b);
  const chain = chainReactions(s, before, damaged);
  return surge ? { tile, angle, trail, blast, chain, surge } : { tile, angle, trail, blast, chain };
}

const SUPERNATURAL_RIFT_BONUS = { minor: 1, citywide: 3, apocalyptic: 8 };

export function applyEvent(
  prev: CityState,
  input: string,
  result: EventResult,
  /** Impact physics version; lower only when replaying older events. */
  physics: 0 | 1 | 2 = PHYSICS,
): CityState {
  const s = cloneState(prev);
  const st = s.stats;
  addStats(st, result.stat_changes);
  // Scale alone is not supernatural. Add a size bonus only when the newsroom
  // has already identified a positive rift effect.
  if (result.stat_changes.rift > 0) st.rift += SUPERNATURAL_RIFT_BONUS[result.scale];
  for (const op of result.tile_ops.slice(0, 6)) applyOp(s, op);
  const impact = physics ? applyPhysics(s, prev.grid, result, physics) : undefined;
  if (result.ongoing) {
    s.ongoing.push({
      label: result.ongoing.label,
      daysLeft: clamp(Math.round(result.ongoing.duration_days), 1, 30),
      perDay: { ...result.ongoing.per_day },
    });
  }
  for (const f of result.followups.slice(0, 3)) {
    s.scheduled.push({
      ...f,
      day: s.day + clamp(Math.round(f.delay_days), 1, 10),
      source: result.headline,
    });
  }
  clampStats(st);
  s.log.push(
    physics ? { day: s.day, input, result, physics, impact } : { day: s.day, input, result },
  );
  // An event can revive a collapsed city (e.g. "a thousand settlers arrive").
  const c = countKinds(s.grid);
  if (c.house + c.shop + c.tower > 0 && st.population >= 1) s.collapsed = false;
  return s;
}

/** Tiles whose look changed between two states — where the action is. */
export function changedTiles(a: CityState, b: CityState): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.grid.length; i++) {
    const p = a.grid[i];
    const q = b.grid[i];
    if (p.kind !== q.kind || p.fire !== q.fire || p.flood !== q.flood || p.builtDay !== q.builtDay)
      out.push(i);
  }
  return out;
}

/** Rebuilds a city exactly from its seed and event history. */
export function replay(seed: number, log: EventRecord[], finalDay: number): CityState {
  let s = createCity(seed);
  for (const ev of log) {
    while (s.day < ev.day && !s.collapsed) s = tick(s);
    s = applyEvent(s, ev.input, ev.result, ev.physics ?? 0);
  }
  while (s.day < finalDay && !s.collapsed) s = tick(s);
  return s;
}

export const eventCost = (r: EventResult) => SCALE_COST[r.scale];
