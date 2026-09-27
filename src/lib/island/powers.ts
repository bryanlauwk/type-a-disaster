import { addPop, popIn, regionBiome } from "./ecology";
import { rand, randInt } from "./rng";
import { HERBIVORES, SPECIES_DEFS } from "./species";
import { around, geography, ring } from "./terrain";
import { wreck } from "./tribe";
import {
  LAKE,
  RIVER,
  SEA,
  SIZE,
  SPECIES,
  idx,
  inBounds,
  tx,
  ty,
  type Action,
  type ActionImpact,
  type PowerId,
  type SpeciesId,
  type WorldState,
} from "./types";

export type PowerGroup = "shape" | "nature" | "life" | "tribe" | "wrath";

export interface PowerDef {
  id: PowerId;
  group: PowerGroup;
  name: string;
  /** What happens, in a line. */
  blurb: string;
  cost: number;
  /** Needs a species, a trait, or a focus picked first. */
  needs?: "species" | "trait" | "focus";
  /** Plays out on screen as a set piece and gets written into the chronicle. */
  dramatic?: boolean;
}

export const POWER_DEFS: Record<PowerId, PowerDef> = {
  raise: {
    id: "raise",
    group: "shape",
    name: "Raise land",
    blurb: "Push the ground up into hills, or raise new land out of the sea.",
    cost: 1,
  },
  lower: {
    id: "lower",
    group: "shape",
    name: "Lower land",
    blurb: "Sink the ground into hollows, lakes or new bays.",
    cost: 1,
  },
  river: {
    id: "river",
    group: "shape",
    name: "Carve a river",
    blurb: "A spring rises here and cuts its way down to the sea.",
    cost: 3,
  },
  grow: {
    id: "grow",
    group: "nature",
    name: "Green the land",
    blurb: "Ferns and forest spring up around the spot.",
    cost: 2,
  },
  rain: {
    id: "rain",
    group: "nature",
    name: "Send rain",
    blurb: "A long wet spell: plants flourish, rivers rise, the lowlands flood.",
    cost: 3,
  },
  drought: {
    id: "drought",
    group: "nature",
    name: "Send drought",
    blurb: "The ponds dry up and every animal goes looking for water.",
    cost: 3,
  },
  introduce: {
    id: "introduce",
    group: "life",
    name: "Introduce species",
    blurb: "Set a new herd or pack down here.",
    cost: 4,
    needs: "species",
  },
  evolve: {
    id: "evolve",
    group: "life",
    name: "Guide evolution",
    blurb: "Push a species towards a new trait. Costs an evolution point from fossils.",
    cost: 3,
    needs: "trait",
  },
  protect: {
    id: "protect",
    group: "life",
    name: "Sanctuary",
    blurb: "Make this region sacred: no hunting, felling or building. Tap again to lift it.",
    cost: 2,
  },
  guide: {
    id: "guide",
    group: "tribe",
    name: "Guide the tribe",
    blurb: "Set what the tribe puts its effort into.",
    cost: 0,
    needs: "focus",
  },
  bless: {
    id: "bless",
    group: "tribe",
    name: "Bless the harvest",
    blurb: "Full baskets and full hearts: food and spirit for the tribe.",
    cost: 3,
  },
  eruption: {
    id: "eruption",
    group: "wrath",
    name: "Eruption",
    blurb: "The Great Volcano wakes: lava runs down its flanks and ash fills the sky.",
    cost: 8,
    dramatic: true,
  },
  meteor: {
    id: "meteor",
    group: "wrath",
    name: "Meteor",
    blurb: "A fireball from the sky flattens everything around the impact.",
    cost: 7,
    dramatic: true,
  },
  tsunami: {
    id: "tsunami",
    group: "wrath",
    name: "Tsunami",
    blurb: "The sea draws back, then a wall of water crashes ashore.",
    cost: 8,
    dramatic: true,
  },
  earthquake: {
    id: "earthquake",
    group: "wrath",
    name: "Earthquake",
    blurb: "The ground splits; cliffs fall and huts come down.",
    cost: 6,
    dramatic: true,
  },
  wildfire: {
    id: "wildfire",
    group: "wrath",
    name: "Wildfire",
    blurb: "A wall of flame sweeps through the forest with the wind.",
    cost: 5,
    dramatic: true,
  },
  storm: {
    id: "storm",
    group: "wrath",
    name: "Great storm",
    blurb: "Days of wind, lightning and flooding rain.",
    cost: 5,
    dramatic: true,
  },
  flood: {
    id: "flood",
    group: "wrath",
    name: "River flood",
    blurb: "The rivers burst their banks across the lowlands.",
    cost: 5,
    dramatic: true,
  },
  plague: {
    id: "plague",
    group: "wrath",
    name: "Plague",
    blurb: "A sickness runs through the biggest herd nearby.",
    cost: 6,
    dramatic: true,
  },
  stampede: {
    id: "stampede",
    group: "wrath",
    name: "Stampede",
    blurb: "A panicked herd charges straight through whatever's in its way.",
    cost: 5,
    dramatic: true,
  },
  raid: {
    id: "raid",
    group: "wrath",
    name: "Raptor raid",
    blurb: "A raptor pack comes for the settlement at night.",
    cost: 5,
    dramatic: true,
  },
};

export const FAVOUR_MAX = 30;

const dist = (a: number, b: number) => Math.hypot(tx(a) - tx(b), ty(a) - ty(b));

/** Kills a share of every animal in a region; returns deaths by species. */
function cull(
  s: WorldState,
  region: WorldState["tiles"][number]["region"],
  share: number,
  only?: SpeciesId[],
) {
  const deaths: Partial<Record<SpeciesId, number>> = {};
  for (const sp of only ?? SPECIES) {
    const n = popIn(s, sp, region);
    if (n < 0.5) continue;
    const d = n * share;
    addPop(s, sp, region, -d);
    deaths[sp] = (deaths[sp] ?? 0) + d;
  }
  return deaths;
}

function merge(a: Partial<Record<SpeciesId, number>>, b: Partial<Record<SpeciesId, number>>) {
  for (const [k, v] of Object.entries(b)) a[k as SpeciesId] = (a[k as SpeciesId] ?? 0) + (v ?? 0);
  return a;
}

/** People at the settlement hit by damage to these tiles. */
function casualties(s: WorldState, tiles: number[], rate: number) {
  const hit = tiles.filter((i) => s.tiles[i].build).length;
  const lost = Math.min(s.tribe.pop, Math.round(hit * rate));
  s.tribe.pop -= lost;
  return lost;
}

/** A line of tiles from `from` in a direction, `len` long. */
function lineFrom(from: number, angle: number, len: number): number[] {
  const out: number[] = [];
  for (let o = 0; o <= len; o += 0.5) {
    const x = Math.round(tx(from) + Math.cos(angle) * o);
    const y = Math.round(ty(from) + Math.sin(angle) * o);
    if (!inBounds(x, y)) break;
    const i = idx(x, y);
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/** Runs lava (or water) downhill from a tile. */
function downhill(s: WorldState, start: number, len: number, jitter: number): number[] {
  const path = [start];
  let cur = start;
  for (let k = 0; k < len; k++) {
    // Jitter drawn once per candidate, in a fixed order, so every engine agrees.
    const options = around(cur)
      .filter((n) => !path.includes(n) && s.tiles[n].water !== SEA)
      .map((n) => [n, s.tiles[n].h + rand(s) * jitter] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const next = options[0]?.[0];
    if (next === undefined || s.tiles[next].h > s.tiles[cur].h + 0.3) break;
    path.push(next);
    cur = next;
  }
  return path;
}

/** Carves a river from a spring down to the sea. */
function carveRiver(s: WorldState, start: number): number[] {
  const path = [start];
  let cur = start;
  for (let k = 0; k < 90; k++) {
    if (s.tiles[cur].water === SEA || (k > 2 && s.tiles[cur].water)) break;
    const next = around(cur)
      .filter((n) => !path.includes(n))
      .sort((a, b) => s.tiles[a].h - s.tiles[b].h || a - b)[0];
    if (next === undefined) break;
    if (s.tiles[next].h > s.tiles[cur].h) s.tiles[next].h = s.tiles[cur].h - 0.03;
    path.push(next);
    cur = next;
  }
  for (const i of path) {
    const t = s.tiles[i];
    if (t.water) continue;
    t.water = RIVER;
    t.veg = 0;
    t.forest = 0;
    if (t.build) wreck(s, i);
  }
  return path;
}

function reshape(s: WorldState, at: number, amount: number): number[] {
  const out: number[] = [];
  for (const i of ring(at, 2)) {
    const t = s.tiles[i];
    const k = 1 - dist(i, at) / 3;
    if (k <= 0) continue;
    t.h += amount * k;
    out.push(i);
    if (t.h > 0.05 && t.water === SEA) {
      // New land out of the sea.
      t.water = 0;
      t.biome = "beach";
      t.veg = 0.1;
    } else if (t.h <= 0.02 && !t.water) {
      const bySea = around(i).some((n) => s.tiles[n].water === SEA);
      t.water = bySea ? SEA : LAKE;
      t.biome = bySea ? "shallows" : t.biome;
      if (t.build) wreck(s, i);
    }
  }
  s.routesDirty = true;
  return out;
}

/** Applies a god's act. Returns what it did for the screen and the chronicle. */
export function applyPower(s: WorldState, a: Action): ActionImpact {
  const at = a.tile;
  const t = s.tiles[at];
  const region = t.region;
  const impact: ActionImpact = { tiles: [], angle: 0 };
  switch (a.power) {
    case "raise":
      impact.tiles = reshape(s, at, 0.8);
      break;
    case "lower":
      impact.tiles = reshape(s, at, -0.8);
      break;
    case "river":
      impact.tiles = carveRiver(s, at);
      s.routesDirty = true;
      break;
    case "grow":
      for (const i of ring(at, 3)) {
        const o = s.tiles[i];
        if (o.water || o.build || o.lava) continue;
        if (o.biome === "ash" || o.biome === "rock" || o.biome === "canyon")
          o.biome = regionBiome(o.region);
        o.veg = Math.min(1, o.veg + 0.5);
        o.forest = Math.min(1, o.forest + 0.45 * (1 - dist(i, at) / 4));
        impact.tiles.push(i);
      }
      break;
    case "rain":
      s.weather.rain = 7;
      s.weather.drought = 0;
      break;
    case "drought":
      s.weather.drought = 9;
      s.weather.rain = 0;
      break;
    case "introduce": {
      const sp = a.species ?? "hornface";
      const def = SPECIES_DEFS[sp];
      const n = def.group[1];
      const home = def.habitat[region] ? region : region;
      addPop(s, sp, home, n);
      if (!s.known.includes(sp)) s.known.push(sp);
      impact.tiles = [at];
      break;
    }
    case "evolve": {
      const sp = a.species ?? "hornface";
      if (a.trait && !s.traits[sp].includes(a.trait)) s.traits[sp].push(a.trait);
      s.evo = Math.max(0, s.evo - 1);
      break;
    }
    case "protect": {
      const i = s.sanctuaries.indexOf(region);
      if (i >= 0) s.sanctuaries.splice(i, 1);
      else s.sanctuaries.push(region);
      break;
    }
    case "guide":
      if (a.focus) s.tribe.focus = a.focus;
      break;
    case "bless":
      s.tribe.food += 30 + s.tribe.pop;
      s.tribe.morale = Math.min(1, s.tribe.morale + 0.25);
      break;

    // --- Wrath ------------------------------------------------------------
    case "eruption": {
      const crater = s.tiles.findIndex((o) => o.landmark === "great_volcano");
      const streams = 4 + randInt(s, 3);
      const flows: number[][] = [];
      for (let k = 0; k < streams; k++) {
        const ang = (k / streams) * Math.PI * 2 + rand(s) * 0.8;
        const lip = idx(
          Math.round(tx(crater) + Math.cos(ang) * 3),
          Math.round(ty(crater) + Math.sin(ang) * 3),
        );
        flows.push([crater, ...downhill(s, lip, 10 + randInt(s, 8), 0.4)]);
      }
      // Interleave the streams so they all advance together.
      const seen = new Set<number>();
      for (let step = 0; step < 30; step++)
        for (const f of flows) {
          const i = f[step];
          if (i === undefined || seen.has(i)) continue;
          seen.add(i);
          impact.tiles.push(i);
        }
      const deaths: Partial<Record<SpeciesId, number>> = {};
      for (const i of impact.tiles) {
        const o = s.tiles[i];
        o.lava = 6 + randInt(s, 4);
        if (o.water === RIVER || o.water === LAKE) o.water = 0;
        o.biome = "lava";
        o.veg = 0;
        o.forest = 0;
        o.h += 0.12;
        if (o.build) wreck(s, i);
        for (const n of around(i))
          if (s.tiles[n].forest > 0.3 && !s.tiles[n].lava) s.tiles[n].fire = 3;
      }
      const regions = new Set(impact.tiles.map((i) => s.tiles[i].region));
      for (const r of regions) merge(deaths, cull(s, r, 0.12));
      impact.deaths = deaths;
      s.weather.ash = 8;
      s.volcano = 0.05;
      s.routesDirty = true;
      break;
    }
    case "meteor": {
      const blast = ring(at, 3);
      impact.tiles = blast;
      for (const i of blast) {
        const o = s.tiles[i];
        const d = dist(i, at);
        if (o.water === SEA) continue;
        if (d <= 1.5) {
          o.biome = "ash";
          o.veg = 0;
          o.forest = 0;
          o.h -= d < 0.5 ? 0.6 : 0.25;
          if (o.water) o.water = 0;
        } else if (o.forest > 0.2 && rand(s) < 0.6) o.fire = 3 + randInt(s, 3);
        else o.forest *= 0.4;
      }
      impact.people = casualties(s, blast, 1.2);
      for (const i of blast) if (s.tiles[i].build && dist(i, at) <= 2.5) wreck(s, i);
      impact.deaths = cull(s, region, 0.25);
      s.weather.ash = Math.max(s.weather.ash, 3);
      s.routesDirty = true;
      break;
    }
    case "tsunami": {
      // From the nearest open sea towards the target.
      let sea = at;
      let best = Infinity;
      s.tiles.forEach((o, i) => {
        if (o.water !== SEA || o.biome !== "sea") return;
        const d = dist(i, at);
        if (d < best) [sea, best] = [i, d];
      });
      impact.origin = sea;
      impact.angle = Math.atan2(ty(at) - ty(sea), tx(at) - tx(sea));
      const len = best + 4;
      const reached: [number, number][] = [];
      for (let i = 0; i < s.tiles.length; i++) {
        const o = s.tiles[i];
        if (o.water === SEA || o.h > 2.2) continue;
        const rx = tx(i) - tx(sea);
        const ry = ty(i) - ty(sea);
        const along = rx * Math.cos(impact.angle) + ry * Math.sin(impact.angle);
        const lat = Math.abs(-rx * Math.sin(impact.angle) + ry * Math.cos(impact.angle));
        if (along < 0 || along > len || lat > 3 + along * 0.35) continue;
        reached.push([i, along]);
      }
      reached.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      impact.tiles = reached.map(([i]) => i);
      for (const [i, along] of reached) {
        const o = s.tiles[i];
        o.flood = 3 + randInt(s, 2);
        o.fire = 0;
        o.forest *= 0.6;
        o.veg *= 0.5;
        if (o.build && (o.h < 1.2 || along < len * 0.7) && rand(s) < 0.7) wreck(s, i);
      }
      impact.people = casualties(s, impact.tiles, 0.5);
      impact.deaths = cull(s, region, 0.15);
      merge(impact.deaths, cull(s, "coast", 0.1, ["skywing"]));
      break;
    }
    case "earthquake": {
      const zone = ring(at, 5);
      impact.tiles = zone.filter(
        (i) => s.tiles[i].build || s.tiles[i].biome === "cliff" || rand(s) < 0.12,
      );
      for (const i of impact.tiles) {
        const o = s.tiles[i];
        if (o.build && rand(s) < (o.build === "stone_hall" ? 0.2 : 0.45)) wreck(s, i);
        if (o.biome === "cliff" || o.h > 2) {
          o.biome = "rock";
          o.forest *= 0.5;
        }
      }
      impact.people = casualties(s, impact.tiles, 0.3);
      impact.deaths = cull(s, region, 0.05);
      break;
    }
    case "wildfire": {
      impact.angle = rand(s) * Math.PI * 2;
      const spine = lineFrom(at, impact.angle, 9);
      const lit = new Set<number>();
      for (const c of spine)
        for (const i of ring(c, 1)) {
          const o = s.tiles[i];
          if (lit.has(i) || o.water) continue;
          if (o.forest + o.veg > 0.35) {
            o.fire = 3 + randInt(s, 3);
            lit.add(i);
            impact.tiles.push(i);
          }
        }
      impact.deaths = cull(s, region, 0.08);
      break;
    }
    case "storm": {
      s.weather.storm = 4;
      s.weather.rain = Math.max(s.weather.rain, 4);
      const forest = ring(at, 8).filter((i) => s.tiles[i].forest > 0.5);
      for (let k = 0; k < 4 && forest.length; k++) {
        const i = forest.splice(randInt(s, forest.length), 1)[0];
        s.tiles[i].fire = 3;
        impact.tiles.push(i);
      }
      for (const i of ring(at, 6)) if (s.tiles[i].build === "dock" && rand(s) < 0.5) wreck(s, i);
      break;
    }
    case "flood": {
      const zone = ring(at, 6).filter((i) => {
        const o = s.tiles[i];
        return (
          !o.water &&
          o.h < 1.4 &&
          ring(i, 2).some((n) => s.tiles[n].water === RIVER || s.tiles[n].water === LAKE)
        );
      });
      zone.sort((p, q) => s.tiles[p].h - s.tiles[q].h || p - q);
      impact.tiles = zone;
      for (const i of zone) {
        const o = s.tiles[i];
        o.flood = 4 + randInt(s, 3);
        if (o.build === "farm" || (o.build && rand(s) < 0.25)) wreck(s, i);
      }
      impact.people = casualties(s, zone, 0.15);
      impact.deaths = cull(s, region, 0.04);
      break;
    }
    case "plague": {
      // The biggest herd nearby sickens; the sickness spreads to neighbours.
      const geo = geography(s);
      let sp: SpeciesId = "duckbill";
      let most = 0;
      for (const h of HERBIVORES)
        if (popIn(s, h, region) > most) [sp, most] = [h, popIn(s, h, region)];
      impact.deaths = cull(s, region, 0.5, [sp]);
      for (const nb of geo.neighbours[region]) merge(impact.deaths, cull(s, nb, 0.2, [sp]));
      impact.tiles = geo.tiles[region].filter((i) => !s.tiles[i].water).slice(0, 40);
      break;
    }
    case "stampede": {
      impact.angle = rand(s) * Math.PI * 2;
      // They come from beyond the target and run straight through it.
      const start = idx(
        Math.max(0, Math.min(SIZE - 1, Math.round(tx(at) - Math.cos(impact.angle) * 7))),
        Math.max(0, Math.min(SIZE - 1, Math.round(ty(at) - Math.sin(impact.angle) * 7))),
      );
      const path = lineFrom(start, impact.angle, 14).filter((i) => s.tiles[i].water !== SEA);
      impact.tiles = path;
      for (const i of path) {
        const o = s.tiles[i];
        o.trail = 1;
        o.veg *= 0.4;
        if (o.build && o.build !== "stone_hall") wreck(s, i);
        for (const n of around(i)) if (s.tiles[n].build === "farm" && rand(s) < 0.5) wreck(s, n);
      }
      impact.people = casualties(s, path, 0.6);
      impact.deaths = cull(s, region, 0.05, ["hornface", "duckbill"]);
      break;
    }
    case "raid": {
      const home = s.tribe.home;
      impact.angle = rand(s) * Math.PI * 2;
      impact.tiles = ring(home, 4).filter((i) => s.tiles[i].build);
      const fences = s.tiles.filter((o) => o.build === "fence").length;
      const towers = s.tiles.filter((o) => o.build === "watchtower").length;
      const lost = Math.max(1, Math.round(6 / (1 + fences * 0.08 + towers * 0.4)));
      s.tribe.pop = Math.max(0, s.tribe.pop - lost);
      s.tribe.food = Math.max(0, s.tribe.food - 20);
      impact.people = lost;
      addPop(s, "raptor", s.tiles[home].region, 5);
      break;
    }
  }
  return impact;
}
