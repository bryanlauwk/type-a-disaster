import { hash } from "@/lib/island/rng";
import { LAKE, RIVER, SEA, SIZE, idx, inBounds, type Tile } from "@/lib/island/types";
import { tileAtWorld } from "./palette";

/**
 * How plant-eaters live together on screen. The animals of one kind in one
 * place form a herd with a shared centre and a shared mind: it grazes slowly
 * across the land in a loose spread with the young inside, walks together
 * to water, moves on to fresh ground, rests in the heat of the day, bolts
 * as one when a hunter comes close, then stops, turns and watches.
 */

export type HerdMode = "graze" | "move" | "drink" | "water" | "rest" | "flee" | "alert";

export interface HerdGroup {
  key: string;
  /** A number from the key, so each herd keeps its own rhythm. */
  seed: number;
  region: string;
  /** Where the herd is centred, and where that centre is heading. */
  cx: number;
  cz: number;
  tx: number;
  tz: number;
  heading: number;
  mode: HerdMode;
  until: number;
  /** The hunter it last ran from. */
  threat: { x: number; z: number } | null;
  /** Members this frame, and their body length (for spacing). */
  n: number;
  len: number;
  sumX: number;
  sumZ: number;
  seen: number;
}

export function newGroup(key: string, region: string, x: number, z: number, t: number): HerdGroup {
  let seed = 7;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  return {
    key,
    seed,
    region,
    cx: x,
    cz: z,
    tx: x,
    tz: z,
    heading: hash(seed, Math.floor(t)) * Math.PI * 2,
    mode: "graze",
    until: t + 20 + hash(seed, 3) * 20,
    threat: null,
    n: 0,
    len: 1,
    sumX: 0,
    sumZ: 0,
    seen: 0,
  };
}

/** The nearest fresh water to a point (river or lake), within reach. */
function nearestWater(tiles: Tile[], x: number, z: number, reach: number) {
  const c = tileAtWorld(x, z);
  if (c < 0) return null;
  const cx = c % SIZE;
  const cz = Math.floor(c / SIZE);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let dz = -reach; dz <= reach; dz++)
    for (let dx = -reach; dx <= reach; dx++) {
      if (!inBounds(cx + dx, cz + dz)) continue;
      const t = tiles[idx(cx + dx, cz + dz)];
      if (t.water !== RIVER && t.water !== LAKE) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = [dx, dz];
      }
    }
  return best ? { x: x + best[0], z: z + best[1] } : null;
}

const walkable = (tiles: Tile[], region: string, x: number, z: number) => {
  const i = tileAtWorld(x, z);
  if (i < 0) return false;
  const t = tiles[i];
  return t.water !== SEA && !t.lava && !t.fire && t.region === region;
};

/** Moves a herd's centre and decides what it does next. */
export function stepGroup(g: HerdGroup, tiles: Tile[], t: number, dt: number, hot: boolean) {
  const walk = 0.35 + g.len * 0.08;
  switch (g.mode) {
    case "graze": {
      // Drifting slowly across the pasture, wandering as it goes.
      g.heading += (hash(g.seed, Math.floor(t / 6)) - 0.5) * dt * 0.5;
      const nx = g.cx + Math.sin(g.heading) * walk * 0.08 * dt;
      const nz = g.cz + Math.cos(g.heading) * walk * 0.08 * dt;
      if (walkable(tiles, g.region, nx, nz)) {
        g.cx = nx;
        g.cz = nz;
      } else g.heading += Math.PI * 0.6;
      if (t > g.until) {
        const roll = hash(g.seed, Math.floor(t), 9);
        const water = roll < 0.35 ? nearestWater(tiles, g.cx, g.cz, 18) : null;
        if (water) {
          g.mode = "drink";
          g.tx = water.x;
          g.tz = water.z;
        } else if (hot && roll < 0.55) {
          g.mode = "rest";
          g.until = t + 18 + hash(g.seed, 5) * 12;
        } else {
          // On to fresh ground somewhere else in the region.
          for (let k = 0; k < 6; k++) {
            const a = hash(g.seed, Math.floor(t), k) * Math.PI * 2;
            const r = 8 + hash(g.seed, Math.floor(t), k + 7) * 12;
            const x = g.cx + Math.sin(a) * r;
            const z = g.cz + Math.cos(a) * r;
            if (walkable(tiles, g.region, x, z)) {
              g.mode = "move";
              g.tx = x;
              g.tz = z;
              break;
            }
          }
          if (g.mode === "graze") g.until = t + 20;
        }
      }
      break;
    }
    case "move":
    case "drink":
    case "flee": {
      const dx = g.tx - g.cx;
      const dz = g.tz - g.cz;
      const d = Math.hypot(dx, dz);
      // The centre runs ahead only as fast as the herd keeps up.
      const lag = Math.hypot(g.sumX / Math.max(1, g.n) - g.cx, g.sumZ / Math.max(1, g.n) - g.cz);
      const speed = (g.mode === "flee" ? walk * 3 : walk) * (lag > 3 + g.len ? 0.3 : 1);
      if (d > 0.3) {
        g.heading = Math.atan2(dx, dz);
        const step = Math.min(d, speed * dt);
        g.cx += (dx / d) * step;
        g.cz += (dz / d) * step;
      } else if (g.mode === "flee") {
        g.mode = "alert";
        g.until = t + 5 + hash(g.seed, Math.floor(t)) * 3;
      } else if (g.mode === "drink") {
        // Arrived: drink a while at the water's edge.
        g.mode = "water";
        g.until = t + 12 + hash(g.seed, 6) * 8;
      } else if (g.mode === "move") {
        g.mode = "graze";
        g.until = t + 25 + hash(g.seed, Math.floor(t)) * 25;
      }
      break;
    }
    case "water":
    case "rest":
    case "alert":
      if (t > g.until) {
        if (g.mode === "water") g.heading += Math.PI;
        g.mode = "graze";
        g.until = t + 20 + hash(g.seed, Math.floor(t)) * 20;
      }
      break;
  }
}

/** Sends a herd running from a hunter. */
export function panic(g: HerdGroup, hx: number, hz: number, t: number) {
  if (g.mode === "flee") return;
  const away = Math.atan2(g.cx - hx, g.cz - hz);
  g.threat = { x: hx, z: hz };
  g.mode = "flee";
  g.tx = g.cx + Math.sin(away) * (10 + g.len * 2);
  g.tz = g.cz + Math.cos(away) * (10 + g.len * 2);
  g.until = t + 8;
}

/**
 * Where one animal belongs in its herd: a stable place in a loose spread,
 * the young nearer the middle, that shifts now and then as it moves on to
 * the next mouthful.
 */
export function slotOf(g: HerdGroup, id: number, young: boolean, t: number) {
  const moving = g.mode === "move" || g.mode === "drink" || g.mode === "flee";
  const R = g.len * (0.7 + Math.sqrt(Math.max(1, g.n)) * 0.55) * (g.mode === "flee" ? 0.8 : 1);
  const shuffle = moving ? 0 : Math.floor(t / (9 + hash(id, 81) * 8));
  const u = hash(id, 82, shuffle);
  const a = hash(id, 83, shuffle) * Math.PI * 2;
  let r = Math.sqrt(u) * R * (young ? 0.45 : 1);
  let ox = Math.sin(a) * r;
  let oz = Math.cos(a) * r;
  if (moving) {
    // On the move they stream out behind the leaders.
    const back = -Math.abs(oz) * 1.4;
    const side = ox * 0.7;
    r = 0;
    ox = Math.sin(g.heading) * back + Math.cos(g.heading) * side;
    oz = Math.cos(g.heading) * back - Math.sin(g.heading) * side;
  }
  return { x: g.cx + ox, z: g.cz + oz };
}
