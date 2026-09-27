import type { SurgeShape } from "./surge";

export const GRID_SIZE = 32;

export type TileKind =
  | "empty"
  | "road"
  | "house"
  | "shop"
  | "tower"
  | "park"
  | "forest"
  | "rubble"
  | "water"
  | "rail"
  | "landmark";

export const LANDMARK_SHAPES = [
  // Generic structures an event can put up.
  "tower",
  "dome",
  "pyramid",
  "statue",
  "crater",
  "blob",
  "spire",
  "arch",
  "stadium",
  "flagpole",
  "plaza",
  // Small-town buildings.
  "lab",
  "radio_tower",
  "cabin",
  "water_tower",
  "victorian",
  "church",
  "cinema",
  "town_hall",
  "video_store",
  "arcade",
  "police",
  "diner",
  "gas_station",
  "school",
  "mall",
  "junkyard",
  "barn",
  "billboard",
] as const;
export type LandmarkShape = (typeof LANDMARK_SHAPES)[number];

export interface Landmark {
  name: string;
  shape: LandmarkShape;
  /** Hex colour, e.g. "#ff8800". */
  color: string;
  /** Relative height in tiles. */
  height: number;
  /** Visual footprint in tiles for buildings bigger than one lot (default 1). */
  span?: number;
}

export interface Tile {
  kind: TileKind;
  /** Picks which model variant to render for buildings. */
  variant: number;
  /** Days of fire remaining; 0 = not burning. */
  fire: number;
  /** Days of flooding remaining; 0 = dry. */
  flood: number;
  /** Day the tile last changed — used for pop-in animations. */
  builtDay: number;
  landmark?: Landmark;
}

export interface Stats {
  population: number;
  /** 0 – 100 */
  happiness: number;
  money: number;
  /** 0 – 100 */
  pollution: number;
  /** 0 – 100: how far the Upside Down has broken through. */
  rift: number;
}

export type StatKey = keyof Stats;

export interface OngoingEffect {
  label: string;
  daysLeft: number;
  perDay: Stats;
}

export type EventScale = "minor" | "citywide" | "apocalyptic";

export const DISTRICT_IDS = [
  "downtown",
  "elm_street",
  "oak_hill",
  "high_school",
  "mall",
  "lab",
  "woods",
  "mirror_lake",
  "pine_acres",
  "farms",
  "junkyard",
  "outskirts",
] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

export const TILE_TARGETS = [
  "random",
  "center",
  "edge",
  "river",
  "railroad",
  "residential",
  "commercial",
  "towers",
  "parks",
  "forest",
  "roads",
  "empty",
  "landmarks",
  ...DISTRICT_IDS,
] as const;
export type TileTarget = (typeof TILE_TARGETS)[number];

export const TILE_OPS = ["destroy", "burn", "flood", "build", "landmark", "clear"] as const;
export type TileOpKind = (typeof TILE_OPS)[number];

export const BUILD_KINDS = ["house", "shop", "tower", "park", "road", "forest"] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];

export interface TileOp {
  op: TileOpKind;
  target: TileTarget;
  count: number;
  build_kind: BuildKind | null;
  landmark: Landmark | null;
}

export interface Quote {
  name: string;
  role: string;
  text: string;
}

// --- Spectacle: purely visual choreography for an event ---------------------

export const ACTOR_KINDS = [
  // Set pieces
  "whale",
  "meteor",
  "giant_object",
  "kaiju",
  "creature",
  "ufo",
  "tornado",
  "swarm",
  "convoy",
  "rain_of",
  "wave",
  "flood",
  "wildfire",
  "storm",
  "fireworks",
  "hot_air_balloon",
  "earthquake",
  "aurora",
  "phantom_train",
  "radio_burst",
  // Small-town life
  "parade",
  "kids_on_bikes",
  "black_vans",
  "christmas_lights",
  // The Upside Down
  "rift",
  "vines",
  "spores",
  "shadow",
  // Mishaps
  "blackout",
  "sinkhole",
  "landslide",
] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ACTOR_SHAPES = ["sphere", "box", "cone", "spiky", "ring", "blob"] as const;
export type ActorShape = (typeof ACTOR_SHAPES)[number];

export const CROWD_REACTIONS = ["flee", "gather", "celebrate", "ignore"] as const;
export type CrowdReaction = (typeof CROWD_REACTIONS)[number];

export const RESPONDERS = ["fire", "police", "ambulance", "agents", "cleanup"] as const;
export type Responder = (typeof RESPONDERS)[number];

export interface Actor {
  kind: ActorKind;
  label: string;
  color: string;
  /** 1 – 8 */
  size: number;
  /** For swarms, convoys and rain: how many. */
  count: number;
  shape: ActorShape;
  /** Shared-library key for a custom model of this actor (absent for built-ins). */
  model_key?: string;
  /** Keywords to find a ready-made model in the free Objaverse library. */
  search_terms?: string;
  /** Claude's own design: the stand-in while a model loads, or when none fits. */
  recipe?: Recipe;
  /** A ready-made GLB (an Objaverse model on Hugging Face's CDN). */
  model_url?: string;
  /** Credit line for the model's author and licence. */
  attribution?: string;
  /** Where the credited model lives. */
  attribution_url?: string;
  /** True the first time this model enters the shared library. */
  fresh?: boolean;
}

export const RECIPE_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "capsule"] as const;
export type RecipeShape = (typeof RECIPE_SHAPES)[number];

export const RECIPE_MOTIONS = ["fall", "walk", "hover", "spin"] as const;
export type RecipeMotion = (typeof RECIPE_MOTIONS)[number];

/** One primitive in a recipe: centre, size and rotation (degrees) in model units. */
export interface RecipePart {
  shape: RecipeShape;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  color: string;
}

export interface Recipe {
  motion: RecipeMotion;
  parts: RecipePart[];
}

export interface Spectacle {
  actors: Actor[];
  crowd: CrowdReaction;
  responders: Responder[];
}

export interface Followup {
  delay_days: number;
  note: string;
  stat_changes: Stats;
  tile_ops: TileOp[];
}

/** What the newsroom (Claude) decides happened. Validated before use. */
export interface EventResult {
  scale: EventScale;
  headline: string;
  subhead: string;
  quotes: Quote[];
  stat_changes: Stats;
  tile_ops: TileOp[];
  ongoing: { label: string; duration_days: number; per_day: Stats } | null;
  spectacle: Spectacle;
  followups: Followup[];
}

/**
 * Knock-on reactions the engine adds after an event: a gas station that goes
 * up, a water tower that bursts, an apartment block that topples onto the
 * house next door.
 */
export const CHAIN_KINDS = ["explosion", "burst", "blackout", "breach", "blaze", "topple"] as const;
export type ChainKind = (typeof CHAIN_KINDS)[number];

export interface ChainLink {
  kind: ChainKind;
  /** The tile that set it off (the landmark itself). */
  tile: number;
  /** The damaged tile that triggered it, or -1 for the epicentre. */
  from: number;
  /** Tiles it changed, the trigger first. */
  tiles: number[];
  /** Headline-style line for the news ticker ("" for small ones). */
  label: string;
}

/** Where and how an event physically hit the town (recomputed on replay). */
export interface ImpactInfo {
  /** Epicentre tile. */
  tile: number;
  /** Heading in radians for things that travel (kaiju, tornado). */
  angle: number;
  /** Tiles the traveller wrecked, in the order it reached them. */
  trail: number[];
  /** Tiles the blast, quake or storm damaged around the epicentre. */
  blast: number[];
  chain: ChainLink[];
  /** The water's path, for a tsunami or flash flood. */
  surge?: SurgeShape;
}

export interface EventRecord {
  day: number;
  input: string;
  result: EventResult;
  /**
   * Which version of impact physics the event was played with, so a replay
   * matches: absent = none, 1 = first version, 2 = water surges and wildfires.
   */
  physics?: 1 | 2;
  /** Filled in by the engine; not saved. */
  impact?: ImpactInfo;
}

export interface ScheduledFollowup extends Followup {
  day: number;
  source: string;
}

export interface Bulletin {
  day: number;
  text: string;
  source: string;
}

export interface CityState {
  version: 2;
  name: string;
  seed: number;
  /** Current RNG state; the sim is fully deterministic from seed + events. */
  rng: number;
  day: number;
  grid: Tile[];
  stats: Stats;
  ongoing: OngoingEffect[];
  scheduled: ScheduledFollowup[];
  bulletins: Bulletin[];
  log: EventRecord[];
  collapsed: boolean;
}

export const SCALE_COST: Record<EventScale, number> = {
  minor: 1,
  citywide: 2,
  apocalyptic: 3,
};
