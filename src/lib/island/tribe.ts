import { addPop, popIn, seasonOf, type regionFacts } from "./ecology";
import { rand, randInt } from "./rng";
import { HERBIVORES, PREDATORS, SPECIES_DEFS, tuned } from "./species";
import { around, geography, ring } from "./terrain";
import {
  SEA,
  SPECIES,
  TECHS,
  tx,
  ty,
  type RegionId,
  type SpeciesId,
  type StructureKind,
  type Tech,
  type WorldState,
} from "./types";

export const STAGES = ["Camp", "Village", "Town", "City"] as const;
const STAGE_POP = [0, 30, 90, 200];

/** Knowledge each discovery needs. */
export const TECH_COST: Record<Tech, number> = {
  fire: 0,
  spears: 6,
  palisade: 14,
  farming: 20,
  boats: 28,
  stonework: 38,
  watchtowers: 48,
  domestication: 60,
};

export const TECH_LABEL: Record<Tech, string> = {
  fire: "Fire",
  spears: "Spears",
  palisade: "Palisades",
  farming: "Farming",
  boats: "Boats",
  stonework: "Stonework",
  watchtowers: "Watchtowers",
  domestication: "Taming",
};

/** How far the settlement reaches from its first fire. */
export const reach = (s: WorldState) => 3 + s.tribe.stage * 2;

const dist = (a: number, b: number) => Math.hypot(tx(a) - tx(b), ty(a) - ty(b));

/** Regions the tribe works in: its own and those next to it. */
export function tribeRegions(s: WorldState): RegionId[] {
  const geo = geography(s);
  const home = s.tiles[s.tribe.home].region;
  return [home, ...geo.neighbours[home].filter((r) => r !== "coast" && r !== "offshore")];
}

function count(s: WorldState, kind: StructureKind): number {
  let n = 0;
  for (const t of s.tiles) if (t.build === kind) n++;
  return n;
}

function place(s: WorldState, i: number, kind: StructureKind) {
  const t = s.tiles[i];
  t.build = kind;
  t.builtDay = s.day;
  t.forest = 0;
  if (kind === "farm") {
    t.biome = "farm";
    t.veg = Math.max(t.veg, 0.5);
  } else t.veg *= 0.5;
}

/** Can the tribe build here? */
function buildable(s: WorldState, i: number) {
  const t = s.tiles[i];
  return (
    !t.water &&
    !t.build &&
    !t.landmark &&
    t.lava === 0 &&
    t.fire === 0 &&
    t.h < 3.2 &&
    t.biome !== "cliff" &&
    t.biome !== "rock"
  );
}

const coastal = (s: WorldState, i: number) => around(i).some((n) => s.tiles[n].water === SEA);

/** Picks the best spot for a new structure. */
function spotFor(s: WorldState, kind: StructureKind): number | null {
  const home = s.tribe.home;
  const r = reach(s);
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const i of ring(home, r + 1)) {
    if (!buildable(s, i)) continue;
    if (s.sanctuaries.includes(s.tiles[i].region)) continue;
    const t = s.tiles[i];
    const d = dist(i, home);
    let score = -d;
    switch (kind) {
      case "dock":
        if (!coastal(s, i)) continue;
        score = -d * 0.5;
        break;
      case "farm":
        if (t.biome !== "plains" && t.biome !== "grass" && t.biome !== "fern") continue;
        score =
          t.veg * 4 - d * 0.4 + (around(i).some((n) => s.tiles[n].build === "farm") ? 1.5 : 0);
        break;
      case "fence":
        // A ring at the edge of the settlement.
        if (Math.abs(d - r) > 0.8) continue;
        score = -Math.abs(d - r);
        break;
      case "watchtower":
      case "lookout":
        if (Math.abs(d - r) > 1.5) continue;
        score = t.h - around(i).filter((n) => s.tiles[n].build === "watchtower").length * 5;
        break;
      case "walkway":
        if (!around(i).some((n) => s.tiles[n].water && s.tiles[n].water !== SEA)) continue;
        break;
      case "pen":
        score = -d * 0.6 + (around(i).some((n) => s.tiles[n].build === "farm") ? 1 : 0);
        break;
      default:
        // Homes and workshops huddle close to the fire.
        if (d > r - 0.5) continue;
    }
    // Deterministic tie-break.
    score += ((i * 2654435761) % 1000) / 100000;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

const COST: Partial<Record<StructureKind, { wood: number; stone?: number }>> = {
  hut: { wood: 4 },
  fire_pit: { wood: 1 },
  dock: { wood: 5 },
  lookout: { wood: 4 },
  fence: { wood: 1 },
  farm: { wood: 2 },
  workshop: { wood: 6 },
  granary: { wood: 6 },
  market: { wood: 8, stone: 4 },
  walkway: { wood: 2 },
  stone_hall: { wood: 4, stone: 12 },
  watchtower: { wood: 6, stone: 2 },
  pen: { wood: 5 },
  totem: { wood: 3, stone: 3 },
};

/** What the tribe wants to build next, in order of need. */
function wishList(s: WorldState): StructureKind[] {
  const tr = s.tribe;
  const has = (t: Tech) => tr.techs.includes(t);
  const want: StructureKind[] = [];
  const huts = count(s, "hut");
  if (huts < Math.ceil(tr.pop / 5)) want.push("hut");
  if (count(s, "fire_pit") < 1 + Math.floor(tr.pop / 30)) want.push("fire_pit");
  if (
    count(s, "dock") <
    Math.min(3 + tr.stage * 3, 1 + Math.floor(tr.pop / (tr.focus === "fish" ? 12 : 25)))
  )
    want.push("dock");
  if (count(s, "lookout") < 1) want.push("lookout");
  if (has("farming") && count(s, "farm") < Math.floor(tr.pop / (tr.focus === "farm" ? 5 : 8)))
    want.push("farm");
  if (
    has("palisade") &&
    (tr.focus === "defend" || tr.stage >= 1) &&
    count(s, "fence") < reach(s) * 6
  )
    want.push("fence");
  if (tr.stage >= 1 && count(s, "workshop") < tr.stage) want.push("workshop");
  if (tr.stage >= 1 && count(s, "granary") < tr.stage) want.push("granary");
  if (tr.stage >= 1 && count(s, "walkway") < tr.stage * 3) want.push("walkway");
  if (has("watchtowers") && count(s, "watchtower") < 2 + tr.stage * 2) want.push("watchtower");
  if (tr.stage >= 2 && count(s, "market") < 1) want.push("market");
  if (has("stonework") && tr.stage >= 2 && count(s, "stone_hall") < tr.stage - 1)
    want.push("stone_hall");
  if (has("domestication") && count(s, "pen") < 1 + Math.floor(tr.pop / 50)) want.push("pen");
  if (tr.stage >= 1 && count(s, "totem") < 1) want.push("totem");
  return want;
}

export interface TribeReport {
  /** People lost to raids, for the island's notices. */
  lost: number;
  /** Dinosaurs the hunters brought home, by species. */
  hunted: Partial<Record<SpeciesId, number>>;
  built: StructureKind[];
  found: { fossil: boolean; species?: SpeciesId; tech?: Tech };
  raid?: { species: SpeciesId; lost: number; tile: number };
  trampled: number;
}

/** One day in the life of the tribe. */
export function tribeDay(s: WorldState, facts: ReturnType<typeof regionFacts>): TribeReport {
  const tr = s.tribe;
  const report: TribeReport = {
    lost: 0,
    hunted: {},
    built: [],
    found: { fossil: false },
    trampled: 0,
  };
  if (tr.pop < 1) return report;
  const has = (t: Tech) => tr.techs.includes(t);
  const season = seasonOf(s.day);
  const focus = tr.focus;
  const regions = tribeRegions(s).filter((r) => !s.sanctuaries.includes(r));
  const home = s.tiles[tr.home].region;

  // --- Food ---------------------------------------------------------------
  const docks = count(s, "dock");
  const farms: number[] = [];
  s.tiles.forEach((t, i) => t.build === "farm" && farms.push(i));
  const fish =
    Math.min(docks, 3 + tr.stage * 3) *
    2.2 *
    (has("boats") ? 1.5 : 1) *
    (focus === "fish" ? 1.4 : 1) *
    (s.weather.storm > 0 ? 0.3 : 1);
  const crop =
    farms.reduce((a, i) => a + s.tiles[i].veg * (s.tiles[i].flood > 0 ? 0.2 : 1), 0) *
    0.55 *
    (season === "wet" ? 1.15 : 0.85) *
    (s.weather.drought > 0 ? 0.5 : 1) *
    (focus === "farm" ? 1.3 : 1);
  // Hunting: plant eaters for meat; predators when defending or hunting.
  const hunters =
    tr.pop *
    (focus === "hunt" ? 0.18 : focus === "defend" ? 0.06 : 0.07) *
    (has("spears") ? 1.5 : 1);
  let meat = 0;
  for (const r of regions) {
    for (const sp of [...HERBIVORES, "snapper" as const]) {
      const n = popIn(s, sp, r);
      if (n < 1) continue;
      const take = Math.min(n * 0.03, hunters * 0.03 * tuned(SPECIES_DEFS[sp], s.traits[sp]).guard);
      addPop(s, sp, r, -take);
      report.hunted[sp] = (report.hunted[sp] ?? 0) + take;
      meat += take * SPECIES_DEFS[sp].size * 7;
    }
    if (focus === "hunt" || focus === "defend") {
      for (const sp of PREDATORS) {
        const n = popIn(s, sp, r);
        if (n < 0.5) continue;
        const take = Math.min(n * 0.05, hunters * 0.004);
        addPop(s, sp, r, -take);
        report.hunted[sp] = (report.hunted[sp] ?? 0) + take;
        // Hunting tyrants is dangerous work.
        if (sp === "tyrant" && rand(s) < take * 0.6) report.lost += 1;
      }
    }
  }
  // Gathering from the woods around (which thins them).
  let gather = 0;
  let wood = 0;
  const r = reach(s);
  for (const i of ring(tr.home, r + 2)) {
    const t = s.tiles[i];
    if (t.forest < 0.1 || t.water || s.sanctuaries.includes(t.region)) continue;
    gather += t.veg * 0.05 + t.forest * 0.04;
    const cut = Math.min(t.forest, 0.012 * (1 + tr.stage));
    t.forest -= cut;
    wood += cut * 6;
  }
  const pens = count(s, "pen");
  const tamedFood = tr.tamed * 0.6;
  // Everyone forages a little: shellfish, eggs, roots, fruit.
  const forage = tr.pop * 0.14 * (season === "wet" ? 1.1 : 0.9);
  tr.food += fish + crop + meat + gather + tamedFood + forage;
  tr.wood = Math.min(60 + tr.stage * 120, tr.wood + wood);
  if (has("stonework")) tr.stone += 0.15 * (1 + tr.stage);

  // --- Mouths to feed -------------------------------------------------------
  tr.food -= tr.pop * 0.28;
  const granaries = count(s, "granary");
  tr.food = Math.min(tr.food, 40 + tr.pop * 2 + granaries * 40);
  if (tr.food < 0) {
    tr.pop += tr.food / 3;
    tr.food = 0;
    tr.morale = Math.max(0, tr.morale - 0.05);
  } else {
    const plenty = Math.min(1, tr.food / (tr.pop * 3));
    // Growth slows as the land around fills up.
    const room = Math.max(0, 1 - tr.pop / (60 + tr.stage * 90 + count(s, "stone_hall") * 40));
    tr.pop +=
      tr.pop * 0.012 * plenty * tr.morale * room * (count(s, "hut") * 5 >= tr.pop ? 1 : 0.2);
    tr.morale = Math.min(1, tr.morale + 0.01 * plenty);
  }

  // --- Dangers --------------------------------------------------------------
  const fences = count(s, "fence");
  const towers = count(s, "watchtower") + count(s, "lookout") * 0.5;
  const pits = count(s, "fire_pit");
  const defence = 1 + fences * 0.12 + towers * 0.4 + pits * 0.2 + (focus === "defend" ? 1 : 0);
  for (const rr of [home, ...regions]) {
    for (const sp of PREDATORS) {
      const n = popIn(s, sp, rr);
      if (n < 0.5) continue;
      const def = SPECIES_DEFS[sp];
      const leap = tuned(def, s.traits[sp]).fenceLeap;
      const odds =
        ((n * def.danger * 0.03) / (defence * (1 - leap * 0.6))) * (rr === home ? 1 : 0.4);
      if (rand(s) < odds) {
        const lost = Math.max(1, Math.round(rand(s) * def.danger * 3));
        report.lost += lost;
        report.raid = { species: sp, lost, tile: tr.home };
        tr.food = Math.max(0, tr.food - 5);
      }
    }
  }
  // Grazers raid the fields unless they're fenced.
  if (farms.length) {
    for (const sp of ["duckbill", "hornface"] as const) {
      const n = popIn(s, sp, home) + regions.reduce((a, rr) => a + popIn(s, sp, rr) * 0.2, 0);
      const loss = n * 0.05 * (fences > 0 ? 0.3 : 1);
      tr.food = Math.max(0, tr.food - loss);
    }
  }
  tr.pop = Math.max(0, tr.pop - report.lost);

  // --- Learning -------------------------------------------------------------
  tr.knowledge += 0.06 + tr.stage * 0.04 + (focus === "explore" ? 0.25 : 0);
  // Explorers dig in Fossil Canyon and the Skeleton Field.
  const digging = (focus === "explore" ? 0.18 : 0.03) * (tr.stage >= 1 ? 1.5 : 1);
  if (rand(s) < digging) {
    tr.fossils += 1;
    tr.knowledge += 4;
    s.evo += 1;
    report.found.fossil = true;
    const unknown = SPECIES.filter((sp) => !s.known.includes(sp));
    if (unknown.length) {
      const sp = unknown[randInt(s, unknown.length)];
      s.known.push(sp);
      report.found.species = sp;
    }
  }
  for (const t of TECHS)
    if (!has(t) && tr.knowledge >= TECH_COST[t]) {
      tr.techs.push(t);
      report.found.tech = t;
      break;
    }
  // Taming: duckbills brought into the pens.
  if (has("domestication") && pens > tr.tamed / 4) {
    const wild = regions.reduce((a, rr) => a + popIn(s, "duckbill", rr), 0);
    if (wild > 3 && rand(s) < 0.15) {
      const from = regions.find((rr) => popIn(s, "duckbill", rr) > 2);
      if (from) {
        addPop(s, "duckbill", from, -1);
        tr.tamed += 1;
      }
    }
  }

  // --- Building -------------------------------------------------------------
  for (const kind of wishList(s).slice(0, 1 + tr.stage)) {
    const cost = COST[kind]!;
    if (tr.wood < cost.wood || tr.stone < (cost.stone ?? 0)) continue;
    const at = kind === "totem" ? sacredSpot(s) : spotFor(s, kind);
    if (at === null) continue;
    tr.wood -= cost.wood;
    tr.stone -= cost.stone ?? 0;
    place(s, at, kind);
    report.built.push(kind);
  }
  const stage = STAGE_POP.filter((p) => tr.pop >= p).length - 1;
  tr.stage = Math.max(tr.stage, stage);
  return report;
}

/** The totem goes up on the Sacred Mountain (or as near as they can get). */
function sacredSpot(s: WorldState): number | null {
  const peak = s.tiles.findIndex((t) => t.landmark === "sacred_mountain");
  if (peak < 0) return null;
  for (const i of ring(peak, 2))
    if (buildable(s, i) || i === peak) return i === peak ? nearestBuildable(s, peak) : i;
  return null;
}
function nearestBuildable(s: WorldState, from: number): number | null {
  for (const i of ring(from, 3)) if (buildable(s, i)) return i;
  return null;
}

/** The tribe's first camp, set on the shore of the bay. */
export function foundCamp(s: WorldState) {
  const home = s.tribe.home;
  place(s, home, "fire_pit");
  for (const kind of ["hut", "hut", "hut", "dock", "lookout"] as StructureKind[]) {
    const at = spotFor(s, kind);
    if (at !== null) place(s, at, kind);
  }
}

export function wreck(s: WorldState, i: number) {
  const t = s.tiles[i];
  if (!t.build) return false;
  delete t.build;
  delete t.builtDay;
  if (t.biome === "farm") t.biome = "plains";
  return true;
}
