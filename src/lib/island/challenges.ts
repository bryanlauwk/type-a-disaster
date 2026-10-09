/**
 * Ecology challenges: a fresh island with a twisted starting condition and a
 * survival goal. Setup is deterministic (no RNG), and the verdict is judged at
 * the end of every simulated day.
 */
import { totalOf } from "./ecology";
import { HERBIVORES, PREDATORS } from "./species";
import { createWorld } from "./sim";
import { REGIONS, SPECIES, type RegionId, type SpeciesId, type WorldState } from "./types";

export interface ChallengeDef {
  id: string;
  name: string;
  glyph: string;
  /** The starting condition, in a sentence. */
  setup: string;
  /** The goal, in a sentence. */
  goal: string;
  /** Hint at a strategy worth trying. */
  hint: string;
  difficulty: 1 | 2 | 3;
  /** Days that must pass for the win. */
  days: number;
  apply: (s: WorldState) => void;
  /** A reason to fail right now, or null. */
  fails: (s: WorldState) => string | null;
  /** Extra condition that must hold on the final day (beyond not failing). */
  winsAtEnd?: (s: WorldState) => string | null;
}

const herbTotal = (s: WorldState) => HERBIVORES.reduce((n, sp) => n + totalOf(s, sp), 0);
const extinct = (s: WorldState, list: readonly SpeciesId[]) =>
  list.find((sp) => totalOf(s, sp) < 1) ?? null;
const scale = (s: WorldState, list: readonly SpeciesId[], k: number) => {
  for (const sp of list)
    for (const r of Object.keys(s.pop[sp]) as RegionId[])
      s.pop[sp][r] = (s.pop[sp][r] ?? 0) * k;
  for (const h of s.herds) if (list.includes(h.species)) h.count *= k;
};
const tribeGone = (s: WorldState, min: number) =>
  s.tribe.pop < min ? `The tribe dwindled below ${min}.` : null;
const lost = (sp: SpeciesId | null) => (sp ? `The last ${sp} died out.` : null);

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "long_drought",
    name: "The Long Drought",
    glyph: "☀️",
    setup: "Sixty days of drought are already underway and the ground cover is half gone.",
    goal: "Reach day 120 with the tribe at 8 or more and no grazer species extinct.",
    hint: "Rain is costly. Protect the wetlands and grow where the rivers still run.",
    difficulty: 2,
    days: 120,
    apply: (s) => {
      s.weather.drought = 60;
      for (const t of s.tiles) t.veg *= 0.5;
    },
    fails: (s) => tribeGone(s, 8) ?? lost(extinct(s, HERBIVORES)),
  },
  {
    id: "predator_bloom",
    name: "Predator Bloom",
    glyph: "🦖",
    setup: "Tyrants and raptors have tripled; the grazing herds are at half strength.",
    goal: "Reach day 150 with every grazer species alive and 300+ grazers in total.",
    hint: "Sanctuaries and evolving 'armoured' or 'swift' grazers buy time.",
    difficulty: 3,
    days: 150,
    apply: (s) => {
      scale(s, PREDATORS, 3);
      scale(s, HERBIVORES, 0.5);
    },
    fails: (s) => lost(extinct(s, HERBIVORES)),
    winsAtEnd: (s) =>
      herbTotal(s) >= 300 ? null : `Only ${Math.round(herbTotal(s))} grazers were left.`,
  },
  {
    id: "ashfall",
    name: "Ashfall",
    glyph: "🌋",
    setup: "The volcano is about to blow and ash already hangs in the sky for a month.",
    goal: "Keep the tribe at 10 or more through 200 days.",
    hint: "Guide the tribe toward farming and stores; the ash will choke the wild food.",
    difficulty: 2,
    days: 200,
    apply: (s) => {
      s.volcano = 0.92;
      s.weather.ash = 30;
    },
    fails: (s) => tribeGone(s, 10),
  },
  {
    id: "plague_years",
    name: "Plague Years",
    glyph: "🦠",
    setup: "Sickness is already spreading through three grazer herds in different regions.",
    goal: "Reach day 120 with no species on the island extinct.",
    hint: "Outbreaks travel with herds. Isolating regions can matter more than numbers.",
    difficulty: 3,
    days: 120,
    apply: (s) => {
      const picks: [RegionId, SpeciesId][] = [
        ["emerald_grasslands", "hornface"],
        ["misty_wetlands", "duckbill"],
        ["titan_highlands", "titan"],
      ];
      for (const [region, species] of picks) s.outbreaks.push({ region, species, days: 40 });
    },
    fails: (s) =>
      lost(extinct(s, SPECIES.filter((sp) => totalOf(s, sp) > 0 || sp !== "leviathan"))),
  },
  {
    id: "lean_start",
    name: "Lean Start",
    glyph: "🪨",
    setup: "No favour, no food in store, and the tribe has just made camp.",
    goal: "Grow the camp into a village before day 200, keeping 5+ people alive.",
    hint: "Spend your first favour on guiding the tribe, not on wonders.",
    difficulty: 1,
    days: 200,
    apply: (s) => {
      s.favour = 0;
      s.tribe.food = 0;
    },
    fails: (s) => tribeGone(s, 5),
    winsAtEnd: (s) => (s.tribe.stage >= 1 ? null : "The camp never became a village."),
  },
];

export const challengeById = (id: string) => CHALLENGES.find((c) => c.id === id);

/** A fresh island set up for a challenge. */
export function createChallengeWorld(id: string, seed: number): WorldState {
  const def = challengeById(id);
  const s = createWorld(seed);
  if (!def) return s;
  def.apply(s);
  s.challenge = { id, startDay: s.day };
  // Species that start absent (or are absent on this seed) don't count as losses.
  return s;
}

/** Called at the end of each day: decide the challenge if it's over. */
export function judgeChallenge(s: WorldState) {
  const c = s.challenge;
  if (!c || c.result) return;
  const def = challengeById(c.id);
  if (!def) return;
  const reason = def.fails(s);
  if (reason) {
    s.challenge = { ...c, result: "lost", endDay: s.day, reason };
    return;
  }
  if (s.day - c.startDay >= def.days) {
    const miss = def.winsAtEnd?.(s) ?? null;
    s.challenge = miss
      ? { ...c, result: "lost", endDay: s.day, reason: miss }
      : { ...c, result: "won", endDay: s.day };
  }
}

/** Days survived so far, for the progress bar. */
export const challengeProgress = (s: WorldState) => {
  const c = s.challenge;
  const def = c && challengeById(c.id);
  if (!c || !def) return null;
  const elapsed = (c.endDay ?? s.day) - c.startDay;
  return { def, run: c, elapsed, frac: Math.min(1, elapsed / def.days) };
};

export { REGIONS };
