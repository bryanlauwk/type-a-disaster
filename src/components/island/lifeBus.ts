import type { RegionId, SpeciesId } from "@/lib/island/types";

/**
 * One animal on screen, as the scene and the UI both see it. The renderer's
 * richer Agent (Dinos.tsx) is assignable to this, so the bus can carry the
 * real agents without either module importing the other.
 */
export interface BusAgent {
  id: number;
  sp: SpeciesId;
  region: RegionId;
  herd: number;
  x: number;
  y: number;
  z: number;
  state: string;
  form: number;
  young: boolean;
  /** Live movement and condition shown by the animal inspector. */
  speed: number;
  fatigue: number;
  intent: string;
  alertness: "calm" | "watchful" | "alarmed";
  /** Seconds since death (the renderer uses it to sink the body away). */
  deadFor?: number;
}

/**
 * Shared with the rest of the scene: where the dangerous animals are right
 * now, and every living animal the renderer keeps on screen.
 */
export const lifeBus = {
  hunters: [] as { x: number; z: number; danger: number }[],
  agents: [] as BusAgent[],
  /** Individual currently held by follow camera; the UI owns this value. */
  followedId: null as number | null,
  /** Scripted runs for acts: a stampeding herd, a raiding pack. */
  runs: [] as {
    sp: SpeciesId;
    points: { x: number; z: number }[];
    speed: number;
    count: number;
  }[],
};
