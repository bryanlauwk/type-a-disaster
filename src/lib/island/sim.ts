import {
  feedAndBreed,
  geography,
  growPlants,
  moveHerds,
  popIn,
  addPop,
  regionFacts,
  seasonOf,
  wander,
} from "./ecology";
import { FAVOUR_MAX, POWER_DEFS, applyPower } from "./powers";
import { rand, randInt } from "./rng";
import { HERBIVORES, SPECIES_DEFS } from "./species";
import { STAGES, TECH_LABEL, foundCamp, tribeDay, wreck } from "./tribe";
import { generateIsland } from "./worldgen";
import {
  RIVER,
  SPECIES,
  type Action,
  type Chronicle,
  type Notice,
  type RegionId,
  type WorldState,
} from "./types";

export { seasonOf };

export const REGION_NAMES: Record<RegionId, string> = {
  volcano: "the Great Volcano",
  fern_basin: "the Fern Basin",
  titan_highlands: "the Titan Highlands",
  predator_ridge: "Predator Ridge",
  misty_wetlands: "the Misty Wetlands",
  emerald_grasslands: "the Emerald Grasslands",
  settlers_bay: "Settler's Bay",
  fertile_plains: "the Fertile Plains",
  sunken_jungle: "the Sunken Jungle",
  fossil_canyon: "Fossil Canyon",
  coast: "the coast",
  offshore: "the offshore islands",
};

export function createWorld(seed: number): WorldState {
  const s = generateIsland(seed);
  foundCamp(s);
  geography(s);
  return s;
}

export function cloneWorld(p: WorldState): WorldState {
  return {
    ...p,
    tiles: p.tiles.map((t) => ({ ...t })),
    pop: Object.fromEntries(
      Object.entries(p.pop).map(([k, v]) => [k, { ...v }]),
    ) as WorldState["pop"],
    herds: p.herds.map((h) => ({ ...h })),
    traits: Object.fromEntries(
      Object.entries(p.traits).map(([k, v]) => [k, [...v]]),
    ) as WorldState["traits"],
    sanctuaries: [...p.sanctuaries],
    tribe: { ...p.tribe, techs: [...p.tribe.techs] },
    weather: { ...p.weather },
    known: [...p.known],
    actions: [...p.actions],
    chronicle: [...p.chronicle],
    notices: [...p.notices],
  };
}

function notice(s: WorldState, text: string, kind: Notice["kind"]) {
  s.notices.push({ day: s.day, text, kind });
  if (s.notices.length > 80) s.notices.splice(0, s.notices.length - 80);
}

const plural = (n: number, one: string, many: string) =>
  `${Math.round(n)} ${Math.round(n) === 1 ? one : many}`;

/** One day on the island. */
export function tick(prev: WorldState): WorldState {
  const s = cloneWorld(prev);
  s.day += 1;
  const geo = geography(s);
  const season = seasonOf(s.day);
  const w = s.weather;

  // --- Weather and the island's own moods -----------------------------------
  for (const k of ["rain", "drought", "storm", "ash"] as const) if (w[k] > 0) w[k] -= 1;
  if (s.day % 40 === 0) notice(s, "The rains have come. The rivers are rising.", "nature");
  if (s.day % 40 === 14) notice(s, "The dry season begins.", "nature");
  if (season === "wet" && !w.storm && rand(s) < 0.02) {
    w.storm = 2;
    notice(s, "A storm rolls in off the sea.", "nature");
  }
  if (season === "dry" && !w.drought && rand(s) < 0.012) {
    w.drought = 8;
    notice(s, "No rain for weeks. The ponds are shrinking.", "nature");
  }
  // Lightning in the dry forests.
  if ((season === "dry" || w.storm) && rand(s) < (w.drought ? 0.08 : 0.025)) {
    const i = randInt(s, s.tiles.length);
    if (s.tiles[i].forest > 0.5 && !s.tiles[i].water) {
      s.tiles[i].fire = 3;
      notice(s, `Lightning sets ${REGION_NAMES[s.tiles[i].region]} alight.`, "danger");
    }
  }
  // Lowland floods in heavy rain.
  const floodOdds =
    (season === "wet" ? 0.012 : 0) + (w.rain > 0 ? 0.06 : 0) + (w.storm > 0 ? 0.05 : 0);
  if (floodOdds > 0)
    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      if (t.water || t.h > 0.9 || t.flood) continue;
      if (rand(s) >= floodOdds) continue;
      // Only near the rivers and in the marshes.
      if (t.region !== "misty_wetlands" && !neighboursWater(s, i)) continue;
      t.flood = 2 + randInt(s, 2);
    }
  // Sickness now and then.
  if (rand(s) < 0.006) {
    const sp = HERBIVORES[randInt(s, HERBIVORES.length)];
    const regions = Object.keys(s.pop[sp]) as RegionId[];
    if (regions.length) {
      const r = regions[randInt(s, regions.length)];
      if (!s.sanctuaries.includes(r)) {
        const lost = popIn(s, sp, r) * 0.3;
        addPop(s, sp, r, -lost);
        if (lost >= 1)
          notice(
            s,
            `A sickness runs through the ${SPECIES_DEFS[sp].plural} of ${REGION_NAMES[r]}.`,
            "nature",
          );
      }
    }
  }
  // Pressure builds under the volcano.
  s.volcano += 0.003 + rand(s) * 0.004;
  if (s.volcano >= 1) {
    const crater = s.tiles.findIndex((t) => t.landmark === "great_volcano");
    applyPower(s, { power: "eruption", tile: crater });
    notice(s, "The Great Volcano erupts on its own. Lava runs down its flanks.", "danger");
  }

  // --- Life -------------------------------------------------------------------
  growPlants(s);
  const facts = regionFacts(s, geo);
  feedAndBreed(s, geo, facts);

  const stage = s.tribe.stage;
  const techs = s.tribe.techs.length;
  const report = tribeDay(s, facts);
  if (report.raid)
    notice(
      s,
      `${SPECIES_DEFS[report.raid.species].plural} got into the settlement. ${plural(report.raid.lost, "person", "people")} lost.`,
      "danger",
    );
  if (report.found.fossil)
    notice(
      s,
      report.found.species
        ? `Explorers dig up the bones of a ${SPECIES_DEFS[report.found.species].name}. Now the tribe knows it.`
        : "Explorers bring back fossils from the canyon.",
      "discovery",
    );
  if (s.tribe.techs.length > techs)
    notice(s, `The tribe learns ${TECH_LABEL[s.tribe.techs.at(-1)!]}.`, "discovery");
  if (s.tribe.stage > stage)
    notice(
      s,
      `The ${STAGES[stage].toLowerCase()} has grown into a ${STAGES[s.tribe.stage].toLowerCase()}.`,
      "tribe",
    );
  if (report.built.length && s.day % 5 === 0)
    notice(s, `The tribe builds: ${report.built.join(", ").replace(/_/g, " ")}.`, "tribe");

  const before = new Set(s.herds.map((h) => h.id));
  wander(s, geo, facts);
  for (const h of s.herds)
    if (!before.has(h.id) && h.count >= 3)
      notice(
        s,
        `${plural(h.count, SPECIES_DEFS[h.species].name, SPECIES_DEFS[h.species].plural)} set off for ${REGION_NAMES[h.to]}${
          h.reason === "season"
            ? " with the season"
            : h.reason === "fear"
              ? ", fleeing"
              : h.reason === "thirst"
                ? " in search of water"
                : ""
        }.`,
        "herd",
      );
  let trampled = 0;
  moveHerds(s, (i) => {
    if (wreck(s, i)) trampled += 1;
  });
  if (trampled)
    notice(
      s,
      `A herd tramples ${plural(trampled, "building", "buildings")} in the settlement.`,
      "danger",
    );

  // Extinctions.
  for (const sp of SPECIES) {
    const total = Object.values(prev.pop[sp]).reduce((a, b) => a + (b ?? 0), 0);
    const now = Object.values(s.pop[sp]).reduce((a, b) => a + (b ?? 0), 0);
    if (total >= 0.5 && now < 0.5 && !s.herds.some((h) => h.species === sp))
      notice(s, `The last ${SPECIES_DEFS[sp].plural} are gone from the island.`, "nature");
  }

  s.favour = Math.min(FAVOUR_MAX, s.favour + 1);
  return s;
}

function neighboursWater(s: WorldState, i: number) {
  const x = i % 64;
  const y = Math.floor(i / 64);
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const j = (y + dy) * 64 + (x + dx);
      if (x + dx < 0 || x + dx > 63 || y + dy < 0 || y + dy > 63) continue;
      if (s.tiles[j].water === RIVER) return true;
    }
  return false;
}

/** Can the god afford this? */
export const affordable = (s: WorldState, a: Action) =>
  s.favour >= POWER_DEFS[a.power].cost && (a.power !== "evolve" || s.evo >= 1);

/** The god acts. */
export function act(prev: WorldState, a: Action): WorldState {
  const s = cloneWorld(prev);
  if (!affordable(s, a)) return prev;
  s.favour -= POWER_DEFS[a.power].cost;
  const impact = applyPower(s, a);
  s.actions.push({ ...a, day: s.day, impact });
  return s;
}

/** Rebuilds an island from its seed and what its god has done. */
export function replay(
  seed: number,
  actions: Action[] & { day: number }[],
  chronicle: Chronicle[],
  day: number,
): WorldState {
  let s = createWorld(seed);
  for (const a of actions as (Action & { day: number })[]) {
    while (s.day < a.day) s = tick(s);
    const { day: _d, ...action } = a;
    s = act(s, action);
  }
  while (s.day < day) s = tick(s);
  s.chronicle = [...chronicle];
  return s;
}
