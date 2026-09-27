/**
 * Surges of water rolling across town: a tsunami out of Mirror Lake, or a
 * flash flood spilling out of Kettle Creek. The same pure timeline drives the
 * water surface, the moment each tile goes under, and the actor's foam.
 */

export type SurgeKind = "tsunami" | "flash";

export interface SurgeShape {
  kind: SurgeKind;
  /** Where the water starts, in world units. */
  ox: number;
  oz: number;
  /** Unit direction of travel. */
  dx: number;
  dz: number;
  /** Distance from the origin to the epicentre. */
  reach: number;
  /** How much further the water runs past the epicentre. */
  runout: number;
  /** Crest height in world units. */
  height: number;
}

/** The water at one moment. */
export interface SurgeState {
  /** Distance the front has travelled from the origin. */
  front: number;
  /** Height of the breaking crest just behind the front. */
  crest: number;
  /** Depth of the water left standing behind the crest. */
  plateau: number;
}

export interface Surge extends SurgeShape, SurgeState {}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Seconds into the spectacle when each surge makes landfall at the epicentre. */
export const SURGE_IMPACT: Record<SurgeKind, number> = { tsunami: 4.4, flash: 3.6 };

/** When the water sets off from its origin. */
const LAUNCH: Record<SurgeKind, number> = { tsunami: 1.4, flash: 0.6 };

/** How long it keeps running out past the epicentre. */
const RUNOUT_TIME = 1.8;

/**
 * The surge's timeline. A tsunami gathers into a hump on the lake, races in
 * (slowing as it climbs the streets), runs out past the epicentre, then
 * drains; a flash flood swells from the creek and spreads more slowly.
 */
export function surgeAt(shape: SurgeShape, t: number): SurgeState {
  const impact = SURGE_IMPACT[shape.kind];
  const launch = LAUNCH[shape.kind];
  const peak = shape.height;
  const tsunami = shape.kind === "tsunami";
  if (t < launch) {
    // Gathering: a hump swells over the water.
    const k = smooth(0, launch, t);
    return { front: 0, crest: peak * k * (tsunami ? 0.8 : 0.5), plateau: 0 };
  }
  if (t < impact) {
    const u = (t - launch) / (impact - launch);
    // Fast off the water, slowing as it runs uphill into town.
    const eased = 1 - Math.pow(1 - u, tsunami ? 1.7 : 1.3);
    return {
      front: shape.reach * eased,
      crest: peak * (tsunami ? 1 - u * 0.15 : 0.7),
      plateau: peak * (tsunami ? 0.35 : 0.45) * smooth(0, 0.35, u),
    };
  }
  const since = t - impact;
  const u = Math.min(1, since / RUNOUT_TIME);
  const front = shape.reach + shape.runout * (1 - Math.pow(1 - u, 2));
  // The crest collapses into a spreading sheet, which then drains away.
  const crest = peak * (tsunami ? 0.85 : 0.7) * Math.exp(-since * 1.6);
  const plateau =
    peak *
    (tsunami ? 0.35 : 0.45) *
    (since < RUNOUT_TIME ? 1 : Math.exp(-(since - RUNOUT_TIME) * 0.45));
  return { front, crest, plateau };
}

/** Seconds into the spectacle when the front reaches `dist` from the origin. */
export function surgeArrival(shape: SurgeShape, dist: number): number {
  const impact = SURGE_IMPACT[shape.kind];
  const end = impact + RUNOUT_TIME;
  if (dist <= 0) return LAUNCH[shape.kind];
  if (dist >= shape.reach + shape.runout) return end;
  let lo = LAUNCH[shape.kind];
  let hi = end;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (surgeAt(shape, mid).front < dist) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Distance along the surge's path and sideways from it, for a world point. */
export function surgeCoords(shape: SurgeShape, x: number, z: number): [number, number] {
  const rx = x - shape.ox;
  const rz = z - shape.oz;
  return [rx * shape.dx + rz * shape.dz, Math.abs(-rx * shape.dz + rz * shape.dx)];
}

/** Half-width of the tsunami's path at a distance along it: it fans out. */
export const surgeHalfWidth = (shape: SurgeShape, along: number) =>
  shape.kind === "flash"
    ? Math.min(3.5, 1.4 + Math.max(0, along) * 0.25)
    : Math.min(4.5, 2.2 + Math.max(0, along) * 0.32);

/**
 * Lays out a surge for an epicentre. A tsunami comes out of the nearest part
 * of Mirror Lake (or any open water if the lake is gone); a flash flood
 * spills out of the nearest water. `water(x, y)` says whether a tile is water.
 */
export function surgeShapeFor(
  kind: SurgeKind,
  epi: { x: number; y: number },
  n: number,
  water: (x: number, y: number) => boolean,
  lake: (x: number, y: number) => boolean,
  size: number,
  step: number,
): SurgeShape {
  const centre = (n - 1) / 2;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const pass of kind === "tsunami" ? [lake, water] : [water]) {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!pass(x, y)) continue;
        const d = Math.hypot(x - epi.x, y - epi.y);
        if (d < bestD) [best, bestD] = [[x, y], d];
      }
    if (best) break;
  }
  // No water anywhere: it comes in from the west edge of the map.
  const [wx, wy] = best ?? [-2, epi.y];
  let dx = epi.x - wx;
  let dz = epi.y - wy;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  // Start a little way out over the water, so the hump forms offshore.
  const back = kind === "tsunami" ? 2 : 0.3;
  const ox = wx - dx * back - centre;
  const oz = wy - dz * back - centre;
  return {
    kind,
    ox,
    oz,
    dx,
    dz,
    reach: len + back,
    runout: 2 + step,
    height: kind === "tsunami" ? 0.9 + size * 0.08 : 0.4 + size * 0.03,
  };
}

/** Water depth and foam at a world point: [depth, foam]. */
export function surgeDepth(s: Surge, x: number, z: number): [number, number] {
  const [along, lat] = surgeCoords(s, x, z);
  if (along < -1.5) return [0, 0];
  const half = surgeHalfWidth(s, along);
  const side = 1 - smooth(half - 1.2, half + 0.6, lat);
  if (side <= 0) return [0, 0];
  const d = along - s.front; // > 0 ahead of the front
  if (d > 0.7) return [0, 0];
  const lip = d > 0 ? 1 - d / 0.7 : 1;
  const crest = s.crest * Math.exp(-((d + 0.55) ** 2) / 0.9) * lip;
  const behind = s.plateau * smooth(0, 2, -d);
  const depth = Math.max(crest, behind) * side;
  const foam = Math.max(0, 1 - Math.abs(d + 0.35) / 1.1) * side * Math.min(1, s.crest * 2);
  return [depth, foam];
}
