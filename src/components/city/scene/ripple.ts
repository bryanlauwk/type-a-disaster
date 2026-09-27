import { GRID_SIZE, type Actor, type ChainKind, type CityState, type Tile } from "@/lib/city/types";
import { AFTERMATH } from "./actorParts";
import { surgeArrival, surgeCoords } from "@/lib/city/surge";
import { wildfireArrival } from "./Wildfire";

const N = GRID_SIZE;
const C = (N - 1) / 2;

/** How a tile reacts on screen when the damage reaches it. */
export type HitFx =
  | "collapse"
  | "ignite"
  | "flood"
  | "rise"
  | "abduct"
  | "whirl"
  | "crater"
  | Exclude<ChainKind, "topple">;

export interface TileHit {
  tile: number;
  /** Spectacle seconds when the tile changes. */
  at: number;
  fx: HitFx;
  x: number;
  z: number;
  /** What stood there before, for the collapsing ghost. */
  height: number;
  color: string;
  /** Which way a toppling building falls, in radians. */
  fall: number;
  /** Chain reactions get a line in the news ticker. */
  label?: string;
}

const tx = (i: number) => (i % N) - C;
const tz = (i: number) => Math.floor(i / N) - C;

const GHOST: Partial<Record<Tile["kind"], [number, string]>> = {
  house: [0.55, "#c9b28f"],
  shop: [0.5, "#b98a6a"],
  tower: [1.4, "#8f5a44"],
  forest: [0.6, "#3f6b3a"],
  park: [0.1, "#6f9a55"],
};

function ghostOf(t: Tile): [number, string] {
  if (t.kind === "landmark" && t.landmark)
    return [Math.min(4.2, Math.max(0.3, t.landmark.height)), t.landmark.color];
  return GHOST[t.kind] ?? [0, "#b3a58e"];
}

const occupied = (t: Tile) => t.kind === "house" || t.kind === "shop" || t.kind === "tower";

/** The ordinary on-screen reaction for a tile that changed. */
function fxFor(a: Tile, b: Tile, ufo: boolean): HitFx {
  if (b.kind === "landmark" && b.landmark?.shape === "crater" && a.kind !== "landmark")
    return "crater";
  if (b.kind === "rubble" && a.kind !== "rubble") return "collapse";
  if (ufo && occupied(a) && b.kind === "empty") return "abduct";
  if (b.fire > 0 && a.fire === 0) return "ignite";
  if (b.flood > 0 && a.flood === 0) return "flood";
  return "rise";
}

/** Seconds into the spectacle when each travelling actor is `off` tiles along its heading. */
function travelTime(kind: string, off: number, impact: number, dx: number): number | null {
  const pause = 2.5;
  if (kind === "kaiju")
    return off > 0 ? impact * (1 - off / 16) : impact + pause + (-off / 16) * (AFTERMATH - pause);
  if (kind === "tornado") return (impact * (12 - off)) / 12;
  if (kind === "wave") return (impact * (dx + 18)) / 18;
  return null;
}

/**
 * When and how every changed tile reacts: the damage ripples out from the
 * epicentre, travellers wreck their trail as they pass, and chain reactions
 * go off a beat after whatever set them off.
 */
export function planHits(
  before: CityState,
  after: CityState,
  actors: Actor[],
  impactT: number,
): TileHit[] {
  const record = after.log[after.log.length - 1];
  const impact = record?.impact;
  const latest = impactT + AFTERMATH - 0.6;
  const ufo = actors.some((a) => a.kind === "ufo");
  const epi = impact?.tile ?? -1;
  const ex = epi >= 0 ? tx(epi) : 0;
  const ez = epi >= 0 ? tz(epi) : 0;

  const hits = new Map<number, TileHit>();
  const put = (tile: number, at: number, fx?: HitFx, extra: Partial<TileHit> = {}) => {
    const a = before.grid[tile];
    const b = after.grid[tile];
    const [height, color] = ghostOf(a);
    hits.set(tile, {
      tile,
      at: Math.min(latest, Math.max(0, at)),
      fx: fx ?? fxFor(a, b, ufo),
      x: tx(tile),
      z: tz(tile),
      height,
      color,
      fall: ((tile * 2654435761) % 628) / 100,
      ...extra,
    });
  };

  // Everything that changed ripples outwards from the epicentre.
  for (let i = 0; i < after.grid.length; i++) {
    const a = before.grid[i];
    const b = after.grid[i];
    if (a.kind === b.kind && a.fire === b.fire && a.flood === b.flood && a.builtDay === b.builtDay)
      continue;
    const dist = Math.hypot(tx(i) - ex, tz(i) - ez);
    put(i, impactT + Math.min(3, dist * 0.18));
  }
  if (!impact) return [...hits.values()].sort((p, q) => p.at - q.at);

  // Blasts throw buildings outwards; holes in the ground pull them in.
  const inward = actors.some((a) => a.kind === "sinkhole" || a.kind === "landslide");
  for (const i of impact.blast) {
    const h = hits.get(i);
    if (!h || (h.x === ex && h.z === ez)) continue;
    h.fall = Math.atan2(h.z - ez, h.x - ex) + (inward ? Math.PI : 0);
  }

  // A traveller wrecks its trail as it reaches each tile.
  const traveller = actors.find((a) =>
    ["kaiju", "tornado", "wave", "flood", "wildfire"].includes(a.kind),
  );
  if (impact.surge) {
    // Each tile goes under the moment the water front reaches it.
    const shape = impact.surge;
    for (const i of impact.trail) {
      const [along] = surgeCoords(shape, tx(i), tz(i));
      if (hits.has(i)) put(i, surgeArrival(shape, along));
    }
  } else if (traveller?.kind === "wildfire") {
    const dirX = Math.cos(impact.angle);
    const dirZ = Math.sin(impact.angle);
    for (const i of impact.trail) {
      const off = (tx(i) - ex) * dirX + (tz(i) - ez) * dirZ;
      if (hits.has(i)) put(i, wildfireArrival(off));
    }
  } else if (traveller) {
    const dirX = Math.cos(impact.angle);
    const dirZ = Math.sin(impact.angle);
    for (const i of impact.trail) {
      const off = (tx(i) - ex) * dirX + (tz(i) - ez) * dirZ;
      const at = travelTime(traveller.kind, off, impactT, tx(i) - ex);
      if (at !== null && hits.has(i))
        put(i, at, traveller.kind === "tornado" ? "whirl" : undefined);
    }
  }

  // Chain reactions, a beat after whatever set them off.
  for (const link of impact.chain) {
    const trigger = hits.get(link.from)?.at ?? impactT;
    const at = trigger + (link.kind === "topple" ? 0.5 : 1.1);
    if (link.kind === "topple") {
      // The tower leans over onto its neighbour.
      const n = link.tiles[0];
      const fall = Math.atan2(tz(n) - tz(link.tile), tx(n) - tx(link.tile));
      put(n, at, "collapse", { fall });
      continue;
    }
    put(link.tile, at, link.kind, { label: link.label });
    for (const j of link.tiles.slice(1)) {
      const dist = Math.hypot(tx(j) - tx(link.tile), tz(j) - tz(link.tile));
      put(j, at + 0.25 + dist * 0.15);
    }
  }
  return [...hits.values()].sort((p, q) => p.at - q.at);
}
