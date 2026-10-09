import { rand, randInt } from "./rng";
import { HERBIVORES, PREDATORS, SPECIES_DEFS, tuned } from "./species";
import { around, geography, route, routeCost, type Geography } from "./terrain";
import {
  LAKE,
  RIVER,
  SEA,
  SIZE,
  SPECIES,
  type Biome,
  type Herd,
  type Outbreak,
  type RegionId,
  type SpeciesId,
  type Trait,
  type WorldState,
} from "./types";

export const YEAR = 40;
/** How much bigger the island is than the original 64×64 one (territories scale with it). */
export const AREA = (SIZE * SIZE) / (64 * 64);
export const WET_DAYS = 14;
export const seasonOf = (day: number) => (day % YEAR < WET_DAYS ? "wet" : "dry");

/** How much ground cover each biome grows at best. */
const VEG_CAP: Record<Biome, number> = {
  sea: 0,
  shallows: 0,
  beach: 0.12,
  cliff: 0.2,
  lagoon: 0,
  mangrove: 0.55,
  rock: 0.08,
  ash: 0.3,
  lava: 0,
  fern: 1,
  highland: 0.7,
  conifer: 0.55,
  ridge: 0.4,
  wetland: 0.85,
  grass: 0.85,
  plains: 0.8,
  jungle: 0.9,
  canyon: 0.15,
  tar: 0.05,
  springs: 0.6,
  farm: 0.9,
};
/** Tree cover each biome grows back to. */
const FOREST_CAP: Partial<Record<Biome, number>> = {
  fern: 0.3,
  highland: 0.25,
  conifer: 0.85,
  ridge: 0.6,
  wetland: 0.25,
  grass: 0.15,
  plains: 0.15,
  jungle: 1,
  mangrove: 0.75,
  springs: 0.15,
};

/** Wet-season births and dry-season hardship. */
const BREED: Record<"wet" | "dry", number> = { wet: 1.35, dry: 0.75 };

/** Walking species travel as herds you can see; flyers and swimmers just go. */
const WALKS = new Set<SpeciesId>([
  "titan",
  "hornface",
  "duckbill",
  "plateback",
  "tyrant",
  "raptor",
  "snapper",
]);
const HERD_SPEED: Record<SpeciesId, number> = {
  titan: 3,
  hornface: 4,
  duckbill: 4,
  plateback: 3,
  snapper: 5,
  tyrant: 5,
  raptor: 6,
  skywing: 10,
  leviathan: 6,
};

export const popIn = (s: WorldState, sp: SpeciesId, r: RegionId) => s.pop[sp][r] ?? 0;
const setPop = (s: WorldState, sp: SpeciesId, r: RegionId, n: number) => {
  if (n < 0.35) delete s.pop[sp][r];
  else s.pop[sp][r] = n;
};
export const addPop = (s: WorldState, sp: SpeciesId, r: RegionId, n: number) =>
  setPop(s, sp, r, popIn(s, sp, r) + n);

export const totalOf = (s: WorldState, sp: SpeciesId) =>
  Object.values(s.pop[sp]).reduce((a, b) => a + (b ?? 0), 0) +
  s.herds.filter((h) => h.species === sp).reduce((a, h) => a + h.count, 0);

// ---------------------------------------------------------------------------
// Plants, fire, water
// ---------------------------------------------------------------------------

export function growPlants(s: WorldState) {
  const season = seasonOf(s.day);
  const w = s.weather;
  const drought = w.drought > 0;
  const lateDry = season === "dry" && s.day % YEAR > YEAR - 10;
  const burning: number[] = [];
  // How much water the rivers carried into today, region by region.
  const flowSum: Partial<Record<RegionId, number>> = {};
  const flowN: Partial<Record<RegionId, number>> = {};
  for (const t of s.tiles)
    if (t.water === RIVER) {
      flowSum[t.region] = (flowSum[t.region] ?? 0) + (t.flow ?? 1);
      flowN[t.region] = (flowN[t.region] ?? 0) + 1;
    }
  const regionFlow: Partial<Record<RegionId, number>> = {};
  for (const k of Object.keys(flowSum) as RegionId[])
    regionFlow[k] = (flowSum[k] ?? 0) / (flowN[k] ?? 1);
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i];
    // Carcasses rot away.
    if (t.carcass) {
      t.carcass -= 0.07;
      if (t.carcass <= 0.05) delete t.carcass;
    }
    // Rivers run low through a dry spell and swell again with the rain.
    if (t.water === RIVER) {
      const target =
        w.rain > 0 || w.storm > 0
          ? 1
          : drought
            ? 0.15
            : season === "wet"
              ? 1
              : lateDry
                ? 0.4
                : 0.75;
      t.flow = (t.flow ?? 1) + (target - (t.flow ?? 1)) * 0.12;
    }
    // Ponds shrink away in a drought or at the end of the dry season.
    if (t.seasonal) t.water = drought || lateDry ? 0 : LAKE;
    if (t.water) {
      t.veg = 0;
      continue;
    }
    if (t.lava > 0) {
      t.lava -= 1;
      t.veg = 0;
      t.forest = 0;
      t.fire = 0;
      if (t.lava === 0) {
        // Cooled into fresh black rock, which slowly greens over.
        t.biome = t.region === "volcano" ? "rock" : "ash";
      }
      continue;
    }
    if (t.fire > 0) {
      burning.push(i);
      continue;
    }
    let cap = VEG_CAP[t.biome];
    if (season === "wet") cap *= 1.1;
    else cap *= 0.85;
    if (drought) cap *= t.water || around(i).some((n) => s.tiles[n].water === RIVER) ? 0.8 : 0.45;
    if (w.ash > 0) cap *= 0.6;
    // The marshes thin out when the rivers that feed them run low.
    if (t.biome === "wetland" || t.biome === "mangrove")
      cap *= 0.55 + 0.45 * (regionFlow[t.region] ?? 1);
    if (t.flood > 0) {
      t.flood -= 1;
      cap *= 0.5;
      if (t.build === "farm" && t.flood > 0) t.veg *= 0.7;
    }
    t.veg += (cap - t.veg) * 0.07;
    const fcap = t.build ? 0 : (FOREST_CAP[t.biome] ?? 0);
    if (t.forest < fcap) t.forest = Math.min(fcap, t.forest + 0.004);
    else if (t.forest > fcap + 0.05 && t.build) t.forest *= 0.9;
    // Ash and burnt ground are fertile: they green back into what they were.
    if (t.biome === "ash" && t.region !== "volcano" && t.veg > 0.25)
      t.biome = regionBiome(t.region);
    t.trail = Math.max(0, t.trail - 0.004);
  }
  // Fire spreads through dry forest, faster in a drought or a storm.
  const spread =
    0.1 +
    (drought ? 0.18 : 0) +
    (season === "dry" ? 0.06 : 0) +
    (w.storm > 0 ? 0.08 : 0) -
    (w.rain > 0 || season === "wet" ? 0.08 : 0);
  for (const i of burning) {
    const t = s.tiles[i];
    for (const n of around(i)) {
      const o = s.tiles[n];
      if (o.fire > 0 || o.water || o.lava) continue;
      if (o.forest + o.veg * 0.4 > 0.35 && rand(s) < spread * (o.forest + 0.3))
        o.fire = 2 + randInt(s, 3);
    }
    t.fire -= 1;
    t.veg = Math.max(0.05, t.veg * 0.4);
    t.forest *= 0.55;
    if (t.fire === 0 && t.build && t.build !== "fire_pit") {
      delete t.build;
      delete t.builtDay;
    }
  }
}

/** The biome a region's ground grows back to after a fire or ash fall. */
export function regionBiome(r: RegionId): Biome {
  switch (r) {
    case "fern_basin":
      return "fern";
    case "titan_highlands":
      return "highland";
    case "predator_ridge":
      return "ridge";
    case "misty_wetlands":
      return "wetland";
    case "sunken_jungle":
      return "jungle";
    case "fossil_canyon":
      return "canyon";
    case "settlers_bay":
    case "fertile_plains":
      return "plains";
    default:
      return "grass";
  }
}

// ---------------------------------------------------------------------------
// Who eats whom
// ---------------------------------------------------------------------------

interface RegionFacts {
  food: number;
  /** How well-fed the plant eaters are (0–1). */
  fed: number;
  /** Share of land on fire or under lava. */
  burning: number;
  water: number;
  farms: number;
  pits: number;
  fences: number;
  /** Tribe buildings in the region. */
  built: number;
  fish: number;
  nests: boolean;
  /** Food lying on carcasses in the region. */
  carcass: number;
  /** Average river flow (0–1); regions without rivers read 1. */
  flow: number;
  /** How hungry each hunter species is here (0 fed – 1 starving). */
  hunger: Partial<Record<SpeciesId, number>>;
}

export function regionFacts(s: WorldState, geo: Geography): Record<RegionId, RegionFacts> {
  const out = {} as Record<RegionId, RegionFacts>;
  for (const r of Object.keys(geo.tiles) as RegionId[]) {
    let food = 0;
    let burning = 0;
    let water = 0;
    let farms = 0;
    let pits = 0;
    let fences = 0;
    let built = 0;
    let fish = 0;
    let land = 0;
    let nests = false;
    let carcass = 0;
    let flowSum = 0;
    let flowN = 0;
    for (const i of geo.tiles[r]) {
      const t = s.tiles[i];
      if (t.landmark === "nesting_grounds") nests = true;
      if (t.water === SEA) {
        fish += t.biome === "shallows" ? 1 : 0.4;
        continue;
      }
      if (t.water) water += 1;
      else {
        land += 1;
        food += t.veg;
      }
      carcass += t.carcass ?? 0;
      if (t.water === RIVER) {
        flowSum += t.flow ?? 1;
        flowN += 1;
      }
      if (t.fire > 0 || t.lava > 0) burning += 1;
      if (t.build) {
        built += 1;
        if (t.build === "farm") farms += 1;
        if (t.build === "fire_pit") pits += 1;
        if (t.build === "fence" || t.build === "watchtower") fences += 1;
      }
    }
    out[r] = {
      food,
      fed: 1,
      burning: land ? burning / land : 0,
      water: land ? water / (land + water) : 0,
      farms,
      pits,
      fences,
      built,
      fish,
      nests,
      carcass,
      flow: flowN ? flowSum / flowN : 1,
      hunger: {},
    };
  }
  return out;
}

/** One day of eating, breeding, hunting and dying, region by region. */
export function feedAndBreed(s: WorldState, geo: Geography, facts: Record<RegionId, RegionFacts>) {
  const season = seasonOf(s.day);
  for (const r of Object.keys(geo.tiles) as RegionId[]) {
    const f = facts[r];
    // Plant eaters graze the region down.
    let demand = 0;
    for (const sp of [...HERBIVORES, "snapper" as const]) {
      const t = tuned(SPECIES_DEFS[sp], s.traits[sp]);
      demand += popIn(s, sp, r) * t.appetite;
    }
    const eat = Math.min(demand, f.food * 0.08);
    f.fed = demand > 0 ? eat / demand : 1;
    if (eat > 0 && f.food > 0) {
      const keep = 1 - eat / f.food;
      for (const i of geo.tiles[r]) if (!s.tiles[i].water) s.tiles[i].veg *= keep;
    }
    const sanctuary = s.sanctuaries.includes(r);

    for (const sp of HERBIVORES) {
      const n = popIn(s, sp, r);
      if (!n) continue;
      const def = SPECIES_DEFS[sp];
      const t = tuned(def, s.traits[sp]);
      const suit = def.habitat[r] ?? 0.05;
      const cap = t.appetite > 0 ? ((f.food * 0.04) / t.appetite) * suit : 0;
      const room = cap > 0 ? Math.max(0, 1 - n / cap) : 0;
      const nest = f.nests && season === "wet" ? 1.5 : 1;
      const births = t.birth * n * f.fed * suit * BREED[season] * nest * room;
      const deaths =
        t.death * n * (sanctuary ? 0.8 : 1) +
        (1 - f.fed) * 0.07 * n * t.starve +
        (suit < 0.1 ? 0.04 * n : 0) +
        f.burning * 0.3 * n;
      setPop(s, sp, r, n + births - deaths);
    }

    // Snappers: small, quick, living on scraps and whatever the hunters leave.
    {
      const n = popIn(s, "snapper", r);
      if (n) {
        const def = SPECIES_DEFS.snapper;
        const t = tuned(def, s.traits.snapper);
        const suit = def.habitat[r] ?? 0.05;
        const cap = suit * 45 * (f.food / (f.food + 40)) + f.carcass * 12;
        const wellFed = 1 + Math.min(1.2, f.carcass * 0.4);
        setPop(
          s,
          "snapper",
          r,
          n +
            t.birth * wellFed * n * Math.max(0, 1 - n / Math.max(1, cap)) * BREED[season] -
            t.death * n,
        );
      }
    }

    // Hunters range over their region and the ones next to it.
    for (const sp of PREDATORS) {
      const n = popIn(s, sp, r);
      if (!n) continue;
      const def = SPECIES_DEFS[sp];
      const t = tuned(def, s.traits[sp]);
      const grounds: [RegionId, number][] = [
        [r, 1],
        ...geo.neighbours[r].map((nb) => [nb, 0.5] as [RegionId, number]),
      ];
      const targets: [SpeciesId, RegionId, number][] = [];
      for (const [g, reachW] of grounds) {
        if (s.sanctuaries.includes(g) && g !== r) continue;
        for (const [p, v] of Object.entries(def.prey!) as [SpeciesId, number][]) {
          const w = popIn(s, p, g) * v * reachW * tuned(SPECIES_DEFS[p], s.traits[p]).guard;
          if (w > 0) targets.push([p, g, w]);
        }
      }
      const avail = targets.reduce((a, x) => a + x[2], 0);
      const kills = t.attack * n * (avail / (avail + 6)) * (sanctuary ? 0.7 : 1);
      for (const [p, g, w] of targets) {
        const share = kills * (w / avail);
        addPop(s, p, g, -share);
        // What the pack doesn't eat stays behind for the scavengers.
        const at = geo.centre[g];
        s.tiles[at].carcass = Math.min(4, (s.tiles[at].carcass ?? 0) + share * 0.45);
      }
      const suit = def.habitat[r] ?? 0.05;
      const need = n * t.attack * 0.45;
      const starving = need > 0 ? Math.max(0, 1 - kills / need) : 0;
      // A carcass to squabble over takes the edge off.
      const hungry = Math.max(0, starving - Math.min(0.8, f.carcass * 0.25));
      f.hunger[sp] = hungry;
      // Hunters hold territories: a region only has room for so many.
      const room = Math.max(
        0,
        1 - n / ((sp === "tyrant" ? 3 * AREA * 0.6 : 14 * AREA * 0.7) * suit + 0.5),
      );
      const births = (def.convert ?? 0) * kills * suit * BREED[season] * room;
      const deaths = t.death * n + hungry * 0.035 * n * t.starve + f.burning * 0.3 * n;
      setPop(s, sp, r, n + births - deaths);
    }

    // Fishers: the sea's catch, shared with the tribe's canoes.
    for (const sp of ["skywing", "leviathan"] as const) {
      const n = popIn(s, sp, r);
      if (!n) continue;
      const def = SPECIES_DEFS[sp];
      const t = tuned(def, s.traits[sp]);
      const suit = def.habitat[r] ?? 0.05;
      const cap = sp === "skywing" ? suit * (18 + f.fish * 0.06) : suit * (2 + f.fish * 0.01);
      const room = Math.max(0, 1 - n / Math.max(0.5, cap));
      setPop(s, sp, r, n + t.birth * n * room * BREED[season] - t.death * n);
    }
  }
}

// ---------------------------------------------------------------------------
// Moving on: hunger, fear, thirst, fire and the seasons
// ---------------------------------------------------------------------------

function newHerd(
  s: WorldState,
  geo: Geography,
  sp: SpeciesId,
  from: RegionId,
  to: RegionId,
  count: number,
  reason: Herd["reason"],
): boolean {
  if (count < 0.8) return false;
  const path = route(s, geo.centre[from], geo.centre[to]);
  if (!path) return false;
  // Walled-off routes are too costly: the herd goes elsewhere instead.
  if (routeCost(s, path) > path.length * 9) return false;
  addPop(s, sp, from, -count);
  s.herds.push({ id: s.nextHerd++, species: sp, count, from, to, path, at: 0, reason });
  return true;
}

/** How appealing a region is to a species right now (0 = not at all). */
function appeal(
  s: WorldState,
  sp: SpeciesId,
  r: RegionId,
  facts: Record<RegionId, RegionFacts>,
): number {
  const def = SPECIES_DEFS[sp];
  const suit = def.habitat[r] ?? 0;
  if (!suit) return 0;
  const f = facts[r];
  let a = suit * (1 - f.burning * 2);
  if (def.diet === "plants" || def.diet === "omnivore") {
    const crowd = HERBIVORES.reduce(
      (acc, h) => acc + popIn(s, h, r) * SPECIES_DEFS[h].appetite,
      0.5,
    );
    a *= Math.min(2, f.food / (crowd * 40 + 5));
    // Fear of hunters.
    const hunters = PREDATORS.reduce((acc, p) => acc + popIn(s, p, r) * SPECIES_DEFS[p].danger, 0);
    a *= 1 / (1 + hunters * 0.25);
    // Crops draw grazers in; fires and palisades keep them out.
    if (sp === "duckbill" || sp === "hornface") a *= 1 + Math.min(1, f.farms * 0.08);
  } else if (def.diet === "meat") {
    const prey = Object.entries(def.prey!).reduce(
      (acc, [p, v]) => acc + popIn(s, p as SpeciesId, r) * v,
      0,
    );
    a *= Math.min(2, prey / 20);
  }
  if (s.weather.drought > 0 || f.flow < 0.35) a *= 0.4 + f.water * 3;
  // The tribe's fires and walls.
  a *= 1 / (1 + f.pits * 0.35 + f.fences * 0.05 + f.built * 0.02);
  return a;
}

export function wander(s: WorldState, geo: Geography, facts: Record<RegionId, RegionFacts>) {
  const day = s.day % YEAR;
  // The great seasonal migrations.
  if (day === 0) {
    newHerd(
      s,
      geo,
      "titan",
      "titan_highlands",
      "fern_basin",
      popIn(s, "titan", "titan_highlands") * 0.6,
      "season",
    );
    newHerd(
      s,
      geo,
      "duckbill",
      "emerald_grasslands",
      "misty_wetlands",
      popIn(s, "duckbill", "emerald_grasslands") * 0.5,
      "season",
    );
  }
  if (day === WET_DAYS) {
    newHerd(
      s,
      geo,
      "titan",
      "fern_basin",
      "titan_highlands",
      popIn(s, "titan", "fern_basin") * 0.6,
      "season",
    );
    newHerd(
      s,
      geo,
      "duckbill",
      "misty_wetlands",
      "emerald_grasslands",
      popIn(s, "duckbill", "misty_wetlands") * 0.4,
      "season",
    );
  }
  // Everyone else moves when a region stops working for them.
  for (const sp of SPECIES) {
    for (const r of Object.keys(s.pop[sp]) as RegionId[]) {
      const n = popIn(s, sp, r);
      if (n < 2) continue;
      const here = appeal(s, sp, r, facts);
      const f = facts[r];
      const diet = SPECIES_DEFS[sp].diet;
      const hungry = diet === "plants" ? 1 - f.fed : diet === "meat" ? (f.hunger[sp] ?? 0) : 0;
      const thirsty = s.weather.drought > 0 || f.flow < 0.35;
      const pressure =
        hungry +
        f.burning * 3 +
        (here < 0.15 ? 0.4 : 0) +
        (thirsty && f.water < 0.02 ? 0.35 : 0);
      if (pressure < 0.3 || rand(s) > 0.5) continue;
      // The best neighbouring region, if it's clearly better.
      let best: RegionId | null = null;
      let bestA = here * 1.15;
      for (const nb of geo.neighbours[r]) {
        const a = appeal(s, sp, nb, facts);
        if (a > bestA) [best, bestA] = [nb, a];
      }
      if (!best) continue;
      const count = n * Math.min(0.5, pressure * 0.35);
      const reason: Herd["reason"] =
        f.burning > 0.05
          ? "fear"
          : hungry > 0.3
            ? "hunger"
            : s.weather.drought > 0
              ? "thirst"
              : "hunger";
      if (WALKS.has(sp) && best !== "offshore" && r !== "offshore") {
        if (!newHerd(s, geo, sp, r, best, count, reason)) {
          // Blocked (by walls, fire or sea): try the next best way round.
          const others = geo.neighbours[r].filter(
            (o) => o !== best && appeal(s, sp, o, facts) > here,
          );
          if (others.length)
            newHerd(s, geo, sp, r, others[randInt(s, others.length)], count, reason);
        }
      } else {
        addPop(s, sp, r, -count);
        addPop(s, sp, best, count);
      }
    }
  }
}

/** Herds walk their routes, wearing trails and trampling what's in the way. */
export function moveHerds(s: WorldState, onTrample: (tile: number, sp: SpeciesId) => void) {
  const still: Herd[] = [];
  for (const h of s.herds) {
    const from = Math.floor(h.at);
    h.at = Math.min(h.path.length - 1, h.at + HERD_SPEED[h.species]);
    const to = Math.floor(h.at);
    const wear = Math.min(0.2, 0.03 + h.count * 0.01 * (SPECIES_DEFS[h.species].size / 2));
    for (let k = from; k <= to; k++) {
      const t = s.tiles[h.path[k]];
      t.trail = Math.min(1, t.trail + wear);
      // Big herds flatten crops and huts in their way.
      if (t.build && t.build !== "fence" && SPECIES_DEFS[h.species].size > 1.2 && h.count >= 4)
        onTrample(h.path[k], h.species);
    }
    if (h.at >= h.path.length - 1) addPop(s, h.species, h.to, h.count);
    else still.push(h);
  }
  s.herds = still;
}

// ---------------------------------------------------------------------------
// Pressure, sickness and the slow work of selection
// ---------------------------------------------------------------------------

export interface Evolution {
  species: SpeciesId;
  trait: Trait;
  pressure: "starvation" | "hunting";
}

/**
 * Life under pressure changes: a species that goes hungry or is hunted day
 * after day slowly drifts towards traits that answer that pressure.
 */
export function naturalSelection(
  s: WorldState,
  facts: Record<RegionId, RegionFacts>,
): Evolution[] {
  const out: Evolution[] = [];
  for (const sp of SPECIES) {
    if (s.traits[sp].length >= 3) continue;
    const def = SPECIES_DEFS[sp];
    if (totalOf(s, sp) < 6) continue;
    let pressure = 0;
    let regions = 0;
    for (const r of Object.keys(s.pop[sp]) as RegionId[]) {
      const f = facts[r];
      if (!f) continue;
      pressure += def.diet === "plants" || def.diet === "omnivore" ? 1 - f.fed : (f.hunger[sp] ?? 0);
      regions++;
    }
    if (!regions) continue;
    pressure /= regions;
    if (pressure < 0.45 || rand(s) > 0.012 * pressure) continue;
    // The hungry harden or breed faster; the hunted get swift or armoured.
    const pool: Trait[] =
      def.diet === "meat"
        ? ["swift", "cunning", "fertile", "hardy"]
        : ["hardy", "fertile", "giant", "swift", "armoured"];
    const fresh = pool.filter((t) => !s.traits[sp].includes(t));
    if (!fresh.length) continue;
    const trait = fresh[randInt(s, fresh.length)];
    s.traits[sp].push(trait);
    out.push({ species: sp, trait, pressure: def.diet === "meat" ? "hunting" : "starvation" });
  }
  return out;
}

export interface OutbreakEvent {
  kind: "start" | "spread" | "end";
  region: RegionId;
  species: SpeciesId;
}

/** A sickness takes hold in a region. */
export function seedOutbreak(s: WorldState, region: RegionId, species: SpeciesId): OutbreakEvent {
  s.outbreaks.push({ region, days: 5 + randInt(s, 4), species });
  return { kind: "start", region, species };
}

/** One day of sickness: losses, carcasses, and spread along the herd routes. */
export function tickOutbreaks(s: WorldState, geo: Geography): OutbreakEvent[] {
  const events: OutbreakEvent[] = [];
  const fresh: Outbreak[] = [];
  const active = new Set(s.outbreaks.map((o) => `${o.region}:${o.species}`));
  const still: Outbreak[] = [];
  for (const o of s.outbreaks) {
    const n = popIn(s, o.species, o.region);
    if (n > 0.5 && o.days > 0) {
      // Hardy animals shrug it off sooner.
      const starve = tuned(SPECIES_DEFS[o.species], s.traits[o.species]).starve;
      const lost = n * 0.11 * starve;
      addPop(s, o.species, o.region, -lost);
      const at = geo.centre[o.region];
      s.tiles[at].carcass = Math.min(4, (s.tiles[at].carcass ?? 0) + lost * 0.3);
      // Crowded herds carry it to the neighbours.
      if (rand(s) < 0.1 + Math.min(0.1, n / 80))
        for (const nb of geo.neighbours[o.region]) {
          if (active.has(`${nb}:${o.species}`)) continue;
          if (popIn(s, o.species, nb) < 3) continue;
          active.add(`${nb}:${o.species}`);
          fresh.push({ region: nb, days: 4 + randInt(s, 4), species: o.species });
          events.push({ kind: "spread", region: nb, species: o.species });
          break;
        }
      o.days -= 1;
      still.push(o);
    } else events.push({ kind: "end", region: o.region, species: o.species });
  }
  s.outbreaks = [...still, ...fresh];
  return events;
}

export { geography };
