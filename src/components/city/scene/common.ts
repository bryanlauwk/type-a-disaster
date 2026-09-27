import { GRID_SIZE, type Tile } from "@/lib/city/types";
import type { Surge } from "@/lib/city/surge";
import type { WaterField } from "./water";

export const N = GRID_SIZE;
export const CENTER = (N - 1) / 2;

/** Tile index → world x/z of the tile centre. */
export const tileX = (i: number) => (i % N) - CENTER;
export const tileZ = (i: number) => Math.floor(i / N) - CENTER;
export const worldToTile = (x: number, z: number) => {
  const tx = Math.round(x + CENTER);
  const ty = Math.round(z + CENTER);
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return -1;
  return ty * N + tx;
};

/** Small deterministic hash → [0, 1). Used for decoration placement. */
export function hash(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const WALKABLE = new Set([
  "empty",
  "road",
  "house",
  "shop",
  "tower",
  "park",
  "landmark",
  "rubble",
]);
export const isWalkable = (t: Tile | undefined) => !!t && WALKABLE.has(t.kind) && t.fire === 0;

export type DisturbanceMode = "flee" | "gather" | "celebrate";

export interface Disturbance {
  x: number;
  z: number;
  radius: number;
  mode: DisturbanceMode;
  start: number;
  until: number;
}

export interface SpawnRequest {
  color: string;
  count: number;
  size: number;
  flashing: boolean;
  x: number;
  z: number;
  until: number;
}

/**
 * Mutable scratchpad shared by every animated system in the scene. Updated
 * inside useFrame, so it never triggers React renders.
 */
export interface WorldBus {
  disturbances: Disturbance[];
  spawns: SpawnRequest[];
  shake: number;
  /** Clock time until which a storm forces rain. */
  stormUntil: number;
  /** Brief lightning flash, 0–1. */
  flash: number;
  /** Seconds of clock time, mirrored for non-frame code. */
  now: number;
  /** Clock time until which a haze event thickens the air. */
  hazeUntil: number;
  /** Clock time until which the power is out. */
  blackoutUntil: number;
  /** Clock time until which trains are halted. */
  railStopUntil: number;
  /** Clock time until which red lightning crackles over the town. */
  redStormUntil: number;
  // --- Forces the town feels (written by actors, read by buildings and life) ---
  /** The shared water level (owned by the water surface). */
  water?: WaterField;
  /** A surge of water rolling in right now. */
  surge: Surge | null;
  /** The ground shaking: epicentre, strength and when it stops (clock time). */
  quake: { x: number; z: number; amp: number; until: number } | null;
  /** A vortex of wind (a tornado), updated every frame while it lasts. */
  wind: { x: number; z: number; radius: number; strength: number } | null;
}

export const createBus = (): WorldBus => ({
  disturbances: [],
  spawns: [],
  shake: 0,
  stormUntil: 0,
  flash: 0,
  now: 0,
  hazeUntil: 0,
  blackoutUntil: 0,
  railStopUntil: 0,
  redStormUntil: 0,
  surge: null,
  quake: null,
  wind: null,
});

/**
 * Time of day in hours for a phase 0..1 of a sim day. Daylight (06:00–20:00)
 * takes 80% of the day so the city is mostly seen in the sun; night flies by.
 */
export const hourOf = (phase: number) =>
  phase < 0.8 ? 6 + (phase / 0.8) * 14 : (20 + ((phase - 0.8) / 0.2) * 10) % 24;
export const isNight = (hour: number) => hour < 6.2 || hour > 19.6;
