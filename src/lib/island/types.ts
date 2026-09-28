/**
 * Primordia: a Jurassic island where a young human tribe tries to build a
 * civilisation inside an ecosystem still run by dinosaurs. Everything here is
 * plain data, so the whole island can be rebuilt from a seed and the list of
 * things the player (the island's god) has done.
 */

/** Tiles per side. One tile is one world unit. */
export const SIZE = 128;
export const HALF = SIZE / 2;

export const REGIONS = [
  "volcano",
  "fern_basin",
  "titan_highlands",
  "predator_ridge",
  "misty_wetlands",
  "emerald_grasslands",
  "settlers_bay",
  "fertile_plains",
  "sunken_jungle",
  "fossil_canyon",
  "coast",
  "offshore",
] as const;
export type RegionId = (typeof REGIONS)[number];

export const BIOMES = [
  "sea",
  "shallows",
  "beach",
  "cliff",
  "lagoon",
  "mangrove",
  "rock",
  "ash",
  "lava",
  "fern",
  "highland",
  "conifer",
  "ridge",
  "wetland",
  "grass",
  "plains",
  "jungle",
  "canyon",
  "tar",
  "springs",
  "farm",
] as const;
export type Biome = (typeof BIOMES)[number];

/** Water on a tile: none, a river, a lake or pond, or the sea. */
export type Water = 0 | 1 | 2 | 3;
export const RIVER = 1;
export const LAKE = 2;
export const SEA = 3;

export const LANDMARKS = [
  "great_volcano",
  "titan_valley",
  "migration_pass",
  "predator_ridge",
  "fern_sea",
  "misty_wetlands",
  "thunder_falls",
  "fossil_canyon",
  "sunken_jungle",
  "settlers_bay",
  "skeleton_field",
  "crystal_caves",
  "geothermal_springs",
  "crater_lake",
  "nesting_grounds",
  "sacred_mountain",
  "coastal_lagoon",
  "dinosaur_island",
] as const;
export type LandmarkId = (typeof LANDMARKS)[number];

export const STRUCTURES = [
  "hut",
  "fire_pit",
  "dock",
  "lookout",
  "fence",
  "farm",
  "workshop",
  "granary",
  "market",
  "walkway",
  "stone_hall",
  "watchtower",
  "pen",
  "totem",
] as const;
export type StructureKind = (typeof STRUCTURES)[number];

export interface Tile {
  /** Ground height in world units; the sea surface is at 0. */
  h: number;
  biome: Biome;
  water: Water;
  region: RegionId;
  /** 0–1: ground cover the herbivores eat. */
  veg: number;
  /** 0–1: tree cover (habitat, wood for the tribe). */
  forest: number;
  /** Days left burning; 0 = not. */
  fire: number;
  /** Days left under floodwater. */
  flood: number;
  /** Days left of molten lava. */
  lava: number;
  /** 0–1: how worn the ground is by herds passing (visible trails). */
  trail: number;
  /** A human structure standing here. */
  build?: StructureKind;
  /** Day it was built (for pop-in). */
  builtDay?: number;
  landmark?: LandmarkId;
  /** A pond that dries up in a drought. */
  seasonal?: boolean;
  /** A waterfall drops from this river tile. */
  falls?: boolean;
}

// ---------------------------------------------------------------------------
// Dinosaurs
// ---------------------------------------------------------------------------

export const SPECIES = [
  "titan",
  "hornface",
  "duckbill",
  "plateback",
  "snapper",
  "tyrant",
  "raptor",
  "skywing",
  "leviathan",
] as const;
export type SpeciesId = (typeof SPECIES)[number];

/** Heritable traits the island's god can push a species towards. */
export const TRAITS = ["giant", "swift", "hardy", "fertile", "cunning", "armoured"] as const;
export type Trait = (typeof TRAITS)[number];

/** A herd, pack or flock on the move between regions. */
export interface Herd {
  id: number;
  species: SpeciesId;
  count: number;
  from: RegionId;
  to: RegionId;
  /** Tiles along the route, in order. */
  path: number[];
  /** Index along the path (fractional). */
  at: number;
  /** Why it's moving, for the almanac. */
  reason: "season" | "hunger" | "thirst" | "fear" | "introduced";
}

export type Pop = Record<SpeciesId, Partial<Record<RegionId, number>>>;

// ---------------------------------------------------------------------------
// The tribe
// ---------------------------------------------------------------------------

export const FOCI = ["balanced", "farm", "hunt", "fish", "explore", "defend", "expand"] as const;
export type Focus = (typeof FOCI)[number];

export const TECHS = [
  "fire",
  "spears",
  "palisade",
  "farming",
  "stonework",
  "domestication",
  "watchtowers",
  "boats",
] as const;
export type Tech = (typeof TECHS)[number];

export interface Tribe {
  pop: number;
  food: number;
  wood: number;
  stone: number;
  /** Knowledge from fossils and experience. */
  knowledge: number;
  morale: number;
  focus: Focus;
  techs: Tech[];
  /** 0 camp, 1 village, 2 town, 3 city. */
  stage: number;
  /** Where the settlement grows from. */
  home: number;
  /** Tamed dinosaurs in pens. */
  tamed: number;
  /** Fossils the explorers have dug up. */
  fossils: number;
}

// ---------------------------------------------------------------------------
// The world and what the god does to it
// ---------------------------------------------------------------------------

export type Season = "wet" | "dry";

export interface Weather {
  /** Days of forced heavy rain left. */
  rain: number;
  /** Days of drought left. */
  drought: number;
  /** Days of storm left. */
  storm: number;
  /** Days of ash in the air left. */
  ash: number;
}

export interface Chronicle {
  day: number;
  /** The god's act (or the island's) that this records. */
  title: string;
  lines: string[];
  voices: { name: string; role: string; text: string }[];
  /** A pictogram for the cave wall. */
  glyph: string;
  /** Whether a storyteller (Claude) wrote it, or the island's own record. */
  told: boolean;
}

/** Small news the island reports on its own (herds arriving, huts going up). */
export interface Notice {
  day: number;
  text: string;
  kind: "herd" | "tribe" | "nature" | "danger" | "discovery";
}

export interface WorldState {
  version: 3;
  name: string;
  seed: number;
  rng: number;
  day: number;
  tiles: Tile[];
  pop: Pop;
  herds: Herd[];
  nextHerd: number;
  traits: Record<SpeciesId, Trait[]>;
  /** Regions the god has placed under protection. */
  sanctuaries: RegionId[];
  tribe: Tribe;
  weather: Weather;
  /** 0–1: pressure building under the volcano. */
  volcano: number;
  /** Favour: the god's power, refilled a little each day. */
  favour: number;
  /** Evolution points, earned when the tribe digs up fossils. */
  evo: number;
  /** Species the tribe has learned about from fossils and sightings. */
  known: SpeciesId[];
  actions: ActionRecord[];
  chronicle: Chronicle[];
  notices: Notice[];
  /** Migration corridor per herd route key, for trails (recomputed). */
  routesDirty: boolean;
}

// ---------------------------------------------------------------------------
// God powers
// ---------------------------------------------------------------------------

export const POWERS = [
  // Shape
  "raise",
  "lower",
  "river",
  // Nature
  "grow",
  "rain",
  "drought",
  // Life
  "introduce",
  "evolve",
  "protect",
  // Tribe
  "guide",
  "bless",
  // Wrath
  "eruption",
  "meteor",
  "tsunami",
  "earthquake",
  "wildfire",
  "storm",
  "flood",
  "plague",
  "stampede",
  "raid",
] as const;
export type PowerId = (typeof POWERS)[number];

export interface Action {
  power: PowerId;
  /** Target tile. */
  tile: number;
  species?: SpeciesId;
  trait?: Trait;
  focus?: Focus;
}

export interface ActionRecord extends Action {
  day: number;
  /** Physical effects recorded for the on-screen set piece (recomputed on replay). */
  impact?: ActionImpact;
}

/** What an act did, so the screen can play it out tile by tile. */
export interface ActionImpact {
  /** Tiles changed, in the order the effect reached them. */
  tiles: number[];
  /** Heading of travelling effects (radians, in tile space). */
  angle: number;
  /** Where a surge of water starts, for tsunamis and floods. */
  origin?: number;
  /** Deaths by species, for the chronicle. */
  deaths?: Partial<Record<SpeciesId, number>>;
  /** Tribe members lost. */
  people?: number;
}

export const idx = (x: number, y: number) => y * SIZE + x;
export const tx = (i: number) => i % SIZE;
export const ty = (i: number) => Math.floor(i / SIZE);
export const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
/** World x/z of a tile centre. */
export const wx = (i: number) => tx(i) - HALF + 0.5;
export const wz = (i: number) => ty(i) - HALF + 0.5;
