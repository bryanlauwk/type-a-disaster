import {
  LAKE,
  RESTRICTED,
  RIVER,
  SEA,
  SIZE,
  idx,
  inBounds,
  tx,
  ty,
  wx,
  wz,
  type Tile,
} from "./types";

/**
 * The old park: a fenced compound left to the jungle long before the tribe
 * came, and the trails that link the tribe's home to it and to the island's
 * sights, with rough plank bridges where they cross the rivers. Pure data
 * from the tiles, so the world generator and the renderer agree.
 */

export interface RuinSite {
  /** The compound's centre tile, and in world units. */
  tile: number;
  x: number;
  z: number;
  /** The way the gate faces (towards the tribe's home), radians about y. */
  yaw: number;
  /** Half-size of the fenced yard, in world units. */
  w: number;
  d: number;
}

export function ruinSite(tiles: Tile[]): RuinSite | null {
  const tile = tiles.findIndex((t) => t.landmark === "sunken_jungle");
  if (tile < 0) return null;
  const home = tiles.findIndex((t) => t.landmark === "settlers_bay");
  const x = wx(tile);
  const z = wz(tile);
  const yaw = home >= 0 ? Math.atan2(wx(home) - x, wz(home) - z) : 0;
  return { tile, x, z, yaw, w: 3.2, d: 2.4 };
}

/** Where the gate stands, and a step out in front of it for the trail to end. */
export function gateOf(s: RuinSite, out = 0) {
  const f = s.d + out;
  return { x: s.x + Math.sin(s.yaw) * f, z: s.z + Math.cos(s.yaw) * f };
}

/** The flattest dry spot near a point, well clear of water: for the compound. */
export function flatSpot(tiles: Tile[], near: number, reach = 7): number {
  const cx = tx(near);
  const cy = ty(near);
  let best = near;
  let bestScore = Infinity;
  for (let dy = -reach; dy <= reach; dy++)
    for (let dx = -reach; dx <= reach; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x - 5, y - 5) || !inBounds(x + 5, y + 5)) continue;
      let lo = Infinity;
      let hi = -Infinity;
      let wet = false;
      for (let v = -4; v <= 4 && !wet; v++)
        for (let u = -4; u <= 4; u++) {
          const t = tiles[idx(x + u, y + v)];
          if (t.water) {
            wet = true;
            break;
          }
          lo = Math.min(lo, t.h);
          hi = Math.max(hi, t.h);
        }
      if (wet) continue;
      const score = hi - lo + Math.hypot(dx, dy) * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = idx(x, y);
      }
    }
  return best;
}

/** Levels the ground under the compound, blending into the land around it. */
export function levelSite(tiles: Tile[], centre: number, r = 4.5) {
  const cx = tx(centre);
  const cy = ty(centre);
  const R = Math.ceil(r + 2);
  let sum = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      sum += tiles[idx(cx + dx, cy + dy)].h;
      n++;
    }
  const level = sum / n;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (!inBounds(cx + dx, cy + dy)) continue;
      const t = tiles[idx(cx + dx, cy + dy)];
      if (t.water) continue;
      const d = Math.hypot(dx, dy);
      const k = d <= r ? 1 : Math.max(0, 1 - (d - r) / 2);
      t.h = t.h + (level - t.h) * k;
      // The jungle has grown over it, but the yard is still open ground.
      if (d <= r) t.forest *= 0.1;
    }
}

// --- Trails ------------------------------------------------------------------

export interface Trail {
  /** Tiles in order. */
  tiles: number[];
}

export interface Crossing {
  /** The dry tiles either side of the river. */
  from: number;
  to: number;
  /** The river tiles between them. */
  span: number[];
}

/** Places the trails lead to from the tribe's home, besides the old park. */
const SIGHTS = [
  "thunder_falls",
  "crater_lake",
  "fern_sea",
  "skeleton_field",
  "titan_valley",
  "misty_wetlands",
  "fossil_canyon",
  "coastal_lagoon",
];

class Heap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: number) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0][1];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** The cheapest walk from a tile to any tile in `goal`, keeping to gentle, dry ground. */
function walk(
  tiles: Tile[],
  from: number,
  goal: Set<number>,
  onTrail: Set<number>,
): number[] | null {
  const cost = new Float32Array(SIZE * SIZE).fill(Infinity);
  const prev = new Int32Array(SIZE * SIZE).fill(-1);
  const heap = new Heap();
  cost[from] = 0;
  heap.push(0, from);
  const gx = [...goal].map((g) => [tx(g), ty(g)]);
  const guess = (i: number) => {
    let m = Infinity;
    for (const [x, y] of gx) m = Math.min(m, Math.hypot(tx(i) - x, ty(i) - y));
    return m * 0.35;
  };
  let found = -1;
  let budget = 40000;
  while (heap.size && budget-- > 0) {
    const i = heap.pop();
    if (goal.has(i)) {
      found = i;
      break;
    }
    const x = tx(i);
    const y = ty(i);
    const a = tiles[i];
    for (const [dx, dy, len] of STEPS) {
      if (!inBounds(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      const b = tiles[j];
      if (b.water === SEA || b.water === LAKE || b.lava || b.falls) continue;
      if (b.build && b.build !== "hut" && !goal.has(j)) continue;
      // Never cut across a river on the diagonal: bridges run straight.
      if (b.water === RIVER && dx && dy) continue;
      if (a.water === RIVER && dx && dy) continue;
      // Nor slip through a river's diagonal between two dry corners.
      if (
        dx &&
        dy &&
        (tiles[idx(x + dx, y)].water === RIVER || tiles[idx(x, y + dy)].water === RIVER)
      )
        continue;
      const climb = Math.abs(b.h - a.h);
      if (climb > 0.9 && !b.water) continue;
      let c = len * (1 + climb * climb * 12);
      if (b.water === RIVER) c += 1.5;
      if (RESTRICTED.includes(b.region)) c += 4;
      if (b.biome === "wetland" || b.biome === "mangrove") c += 1.5;
      // Once a trail is there, others join it rather than beat their own.
      if (onTrail.has(j)) c *= 0.35;
      const nc = cost[i] + c;
      if (nc < cost[j]) {
        cost[j] = nc;
        prev[j] = i;
        heap.push(nc + guess(j), j);
      }
    }
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let i = found; i >= 0; i = prev[i]) path.push(i);
  return path.reverse();
}

/** The trails out from the tribe's home, and the bridges where they cross rivers. */
export function trailNetwork(tiles: Tile[]): { trails: Trail[]; crossings: Crossing[] } {
  const home = tiles.findIndex((t) => t.landmark === "settlers_bay");
  if (home < 0) return { trails: [], crossings: [] };
  const targets: number[] = [];
  const site = ruinSite(tiles);
  if (site) {
    const g = gateOf(site, 0.9);
    targets.push(idx(Math.floor(g.x + SIZE / 2), Math.floor(g.z + SIZE / 2)));
  }
  for (const id of SIGHTS) {
    const i = tiles.findIndex((t) => t.landmark === id);
    if (i < 0) continue;
    // Stop at dry ground beside a sight that is itself on the water.
    let t = i;
    if (tiles[t].water || tiles[t].falls) {
      let best = -1;
      let bd = Infinity;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          if (!inBounds(tx(i) + dx, ty(i) + dy)) continue;
          const j = idx(tx(i) + dx, ty(i) + dy);
          if (tiles[j].water) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) [best, bd] = [j, d];
        }
      if (best < 0) continue;
      t = best;
    }
    targets.push(t);
  }
  // Nearest first, so the far trails branch off the near ones.
  targets.sort(
    (a, b) =>
      Math.hypot(tx(a) - tx(home), ty(a) - ty(home)) -
      Math.hypot(tx(b) - tx(home), ty(b) - ty(home)),
  );
  const onTrail = new Set<number>([home]);
  const trails: Trail[] = [];
  for (const target of targets) {
    // Walk back from the sight to the nearest point of the network.
    const path = walk(tiles, target, onTrail, onTrail);
    if (!path || path.length < 3) continue;
    path.reverse();
    trails.push({ tiles: path });
    for (const i of path) onTrail.add(i);
  }
  const crossings: Crossing[] = [];
  const seen = new Set<number>();
  for (const tr of trails) {
    const p = tr.tiles;
    for (let k = 1; k < p.length - 1; k++) {
      if (tiles[p[k]].water !== RIVER || tiles[p[k - 1]].water || seen.has(p[k])) continue;
      let e = k;
      while (e < p.length - 1 && tiles[p[e]].water === RIVER) e++;
      if (tiles[p[e]].water) continue;
      const span = p.slice(k, e);
      span.forEach((i) => seen.add(i));
      crossings.push({ from: p[k - 1], to: p[e], span });
    }
  }
  const gorge = gorgeCrossing(tiles);
  if (gorge && !gorge.span.some((i) => seen.has(i))) crossings.push(gorge);
  return { trails, crossings };
}

/** A rope bridge slung across the gorge a little below Thunder Falls. */
export function gorgeCrossing(tiles: Tile[]): Crossing | null {
  let i = tiles.findIndex((t) => t.landmark === "thunder_falls");
  if (i < 0) return null;
  let prev = i;
  // Follow the river down a few steps from the lip.
  for (let k = 0; k < 3; k++) {
    const next = around8(i)
      .filter((n) => tiles[n].water === RIVER && tiles[n].h < tiles[i].h - 0.01)
      .sort((a, b) => tiles[a].h - tiles[b].h)[0];
    if (next === undefined) break;
    prev = i;
    i = next;
  }
  if (i === prev) return null;
  // Across the flow, out to dry ground on both sides.
  const fx = tx(i) - tx(prev);
  const fy = ty(i) - ty(prev);
  const px = -Math.sign(fy);
  const py = Math.sign(fx);
  const reach = (s: number) => {
    const span: number[] = [];
    for (let k = 1; k < 5; k++) {
      const x = tx(i) + px * k * s;
      const y = ty(i) + py * k * s;
      if (!inBounds(x, y)) return null;
      const j = idx(x, y);
      if (!tiles[j].water) return { end: j, span };
      if (tiles[j].water !== RIVER) return null;
      span.push(j);
    }
    return null;
  };
  const a = reach(-1);
  const b = reach(1);
  if (!a || !b) return null;
  return { from: a.end, to: b.end, span: [...a.span.reverse(), i, ...b.span] };
}

function around8(i: number) {
  const out: number[] = [];
  for (const [dx, dy] of STEPS)
    if (inBounds(tx(i) + dx, ty(i) + dy)) out.push(idx(tx(i) + dx, ty(i) + dy));
  return out;
}
