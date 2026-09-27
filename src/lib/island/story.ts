import { totalOf } from "./ecology";
import { POWER_DEFS } from "./powers";
import { REGION_NAMES, seasonOf } from "./sim";
import { SPECIES_DEFS, TRAIT_EFFECTS } from "./species";
import { STAGES } from "./tribe";
import {
  SPECIES,
  tx,
  ty,
  type ActionRecord,
  type Chronicle,
  type SpeciesId,
  type WorldState,
} from "./types";
import type { ChronicleInput } from "./chronicle.schema";

const GLYPH: Partial<Record<ActionRecord["power"], string>> = {
  eruption: "🌋",
  meteor: "☄️",
  tsunami: "🌊",
  earthquake: "🪨",
  wildfire: "🔥",
  storm: "⛈️",
  flood: "💧",
  plague: "🦴",
  stampede: "🦕",
  raid: "🦖",
  rain: "🌧️",
  drought: "☀️",
  introduce: "🥚",
  evolve: "🌀",
  protect: "🌿",
  bless: "🌾",
  river: "〰️",
  raise: "⛰️",
  lower: "🕳️",
  grow: "🌱",
  guide: "✋",
};

const round = (n: number) => Math.round(n);

/** One line on each animal's numbers, for the storyteller. */
export function animalSummary(s: WorldState): string {
  return SPECIES.map((sp) => `${SPECIES_DEFS[sp].plural}: ${round(totalOf(s, sp))}`).join(", ");
}

export function tribeSummary(s: WorldState): string {
  const t = s.tribe;
  return `${round(t.pop)} people in a ${STAGES[t.stage].toLowerCase()} at Settler's Bay, focused on ${t.focus}, knowing ${t.techs.join(", ")}.`;
}

/** What the storyteller is told about an act. */
export function describeAct(
  before: WorldState,
  after: WorldState,
  a: ActionRecord,
): ChronicleInput {
  const def = POWER_DEFS[a.power];
  const where = REGION_NAMES[before.tiles[a.tile].region];
  const facts: string[] = [];
  const impact = a.impact;
  let act = `The god sent a ${def.name.toLowerCase()} on ${where}. ${def.blurb}`;
  if (a.power === "introduce" && a.species)
    act = `The god set a new herd of ${SPECIES_DEFS[a.species].plural} down in ${where}.`;
  if (a.power === "evolve" && a.species && a.trait)
    act = `The god changed the ${SPECIES_DEFS[a.species].plural}: they are becoming ${TRAIT_EFFECTS[a.trait].label.toLowerCase()}. ${TRAIT_EFFECTS[a.trait].blurb}`;
  if (a.power === "eruption")
    act = "The Great Volcano erupted. Lava ran down its flanks and ash darkened the sky.";
  if (a.power === "raid") act = "A raptor pack came for the settlement at night.";
  if (impact?.people) facts.push(`${impact.people} of the tribe were lost.`);
  if (impact?.deaths) {
    const worst = (Object.entries(impact.deaths) as [SpeciesId, number][])
      .filter(([, n]) => n >= 1)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);
    for (const [sp, n] of worst) facts.push(`About ${round(n)} ${SPECIES_DEFS[sp].plural} died.`);
  }
  const lostBuildings = before.tiles.filter((t, i) => t.build && !after.tiles[i].build).length;
  if (lostBuildings) facts.push(`${lostBuildings} of the tribe's buildings were destroyed.`);
  if (impact?.tiles.length)
    facts.push(`It reached across ${impact.tiles.length} stretches of land.`);
  const fires = after.tiles.filter((t) => t.fire > 0).length;
  if (fires > 3) facts.push(`${fires} patches of forest are burning.`);
  const tribeNear = Math.hypot(
    tx(a.tile) - tx(before.tribe.home),
    ty(a.tile) - ty(before.tribe.home),
  );
  if (tribeNear < 8) facts.push("It happened close to the tribe's home.");
  if (!facts.length) facts.push("The tribe watched from the bay.");
  return {
    act,
    facts,
    island: {
      day: after.day,
      season: seasonOf(after.day),
      tribe: tribeSummary(after),
      animals: animalSummary(after),
      recent: after.chronicle.slice(-4).map((c) => c.title),
    },
  };
}

/** The island's own record of an act, when no storyteller is available. */
export function plainEntry(after: WorldState, a: ActionRecord, input: ChronicleInput): Chronicle {
  const def = POWER_DEFS[a.power];
  return {
    day: after.day,
    title: def.name,
    lines: [input.act, ...input.facts.slice(0, 2)],
    voices: [],
    glyph: GLYPH[a.power] ?? "✦",
    told: false,
  };
}

/** A milestone for the tribe (a new stage), told without the storyteller. */
export function milestoneEntry(s: WorldState, text: string, glyph: string): Chronicle {
  return { day: s.day, title: text, lines: [], voices: [], glyph, told: false };
}

export { GLYPH };
