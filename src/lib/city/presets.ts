import type {
  Actor,
  ActorKind,
  CrowdReaction,
  DistrictId,
  EventResult,
  EventScale,
  Responder,
  TileOp,
} from "./types";

/** Places a disaster can be aimed at. */
export interface Place {
  id: DistrictId;
  label: string;
  /** How the paper says it. */
  phrase: string;
}

export const PLACES: Place[] = [
  { id: "downtown", label: "Main St", phrase: "Main Street" },
  { id: "elm_street", label: "Elm St", phrase: "Elm Street" },
  { id: "oak_hill", label: "Oak Hill", phrase: "Oak Hill" },
  { id: "high_school", label: "High school", phrase: "Maple Hollow High" },
  { id: "mall", label: "Mall", phrase: "the Sunbeam Mall" },
  { id: "pine_acres", label: "Trailer park", phrase: "the Pine Acres trailer park" },
  { id: "lab", label: "The lab", phrase: "Hollow Point Lab" },
];

export type PresetIcon =
  | "waves"
  | "droplets"
  | "rocket"
  | "footprints"
  | "tornado"
  | "activity"
  | "cloud-lightning"
  | "flame"
  | "circle-dot"
  | "orbit"
  | "door-open"
  | "fish"
  | "zap-off"
  | "biohazard"
  | "eye";

export interface DisasterPreset {
  id: string;
  name: string;
  /** One line on what you'll see. */
  blurb: string;
  icon: PresetIcon;
  scale: EventScale;
  where: DistrictId;
  actors: Actor[];
  crowd: CrowdReaction;
  responders: Responder[];
  /** The dispatch sent to the newsroom, for a place. */
  text: (place: string) => string;
  /** Doesn't knock anything down by itself. */
  harmless?: true;
}

const actor = (kind: ActorKind, label: string, color: string, size: number, count = 1): Actor => ({
  kind,
  label,
  color,
  size,
  count,
  shape: "blob",
});

/** Maple Hollow's fifteen disasters, roughly from wettest to strangest. */
export const PRESETS: DisasterPreset[] = [
  {
    id: "tsunami",
    name: "Tsunami",
    blurb: "A wave rises on Mirror Lake and a wall of water floods the streets.",
    icon: "waves",
    scale: "apocalyptic",
    where: "elm_street",
    actors: [actor("wave", "Tsunami", "#3d6f7a", 6)],
    crowd: "flee",
    responders: ["ambulance", "police", "cleanup"],
    text: (p) => `A tsunami rises out of Mirror Lake and crashes into ${p}.`,
  },
  {
    id: "flash-flood",
    name: "Flash flood",
    blurb: "Kettle Creek bursts its banks in a downpour and fills the low streets.",
    icon: "droplets",
    scale: "citywide",
    where: "oak_hill",
    actors: [actor("flood", "Flash flood", "#6b6a4a", 5)],
    crowd: "flee",
    responders: ["police", "cleanup"],
    text: (p) => `Kettle Creek bursts its banks in a cloudburst and floods ${p}.`,
  },
  {
    id: "meteor",
    name: "Meteor",
    blurb: "A fireball falls, flattens a block, and leaves a smoking crater.",
    icon: "rocket",
    scale: "citywide",
    where: "downtown",
    actors: [actor("meteor", "Meteor", "#5a4636", 5)],
    crowd: "flee",
    responders: ["fire", "ambulance"],
    text: (p) => `A meteor streaks out of the sky and slams into ${p}.`,
  },
  {
    id: "kaiju",
    name: "Kaiju",
    blurb: "A giant lizard walks straight through town, flattening its path.",
    icon: "footprints",
    scale: "apocalyptic",
    where: "downtown",
    actors: [actor("kaiju", "Giant lizard", "#4f6b4a", 6)],
    crowd: "flee",
    responders: ["police", "agents"],
    text: (p) => `A giant lizard climbs out of the woods and stomps straight through ${p}.`,
  },
  {
    id: "tornado",
    name: "Tornado",
    blurb: "A twister cuts a path of wreckage, sucking up whatever it hits.",
    icon: "tornado",
    scale: "citywide",
    where: "pine_acres",
    actors: [actor("tornado", "Tornado", "#7b7d80", 5)],
    crowd: "flee",
    responders: ["ambulance", "cleanup"],
    text: (p) => `A tornado drops out of a green sky and tears through ${p}.`,
  },
  {
    id: "earthquake",
    name: "Earthquake",
    blurb: "The ground rolls, buildings sway and the tall ones come down.",
    icon: "activity",
    scale: "citywide",
    where: "downtown",
    actors: [actor("earthquake", "Earthquake", "#c9a98a", 6)],
    crowd: "flee",
    responders: ["fire", "ambulance"],
    text: (p) => `An earthquake splits the ground under ${p}.`,
  },
  {
    id: "lightning",
    name: "Lightning storm",
    blurb: "Black clouds park overhead and lightning sets the rooftops alight.",
    icon: "cloud-lightning",
    scale: "citywide",
    where: "mall",
    actors: [actor("storm", "Lightning storm", "#454e59", 5)],
    crowd: "flee",
    responders: ["fire"],
    text: (p) => `A freak lightning storm parks itself over ${p} and won't leave.`,
  },
  {
    id: "wildfire",
    name: "Wildfire",
    blurb: "A wall of flame sweeps out of Blackpine Woods, house by house.",
    icon: "flame",
    scale: "citywide",
    where: "elm_street",
    actors: [actor("wildfire", "Wildfire", "#ff7a1f", 5)],
    crowd: "flee",
    responders: ["fire", "police"],
    text: (p) => `A wildfire roars out of Blackpine Woods and sweeps towards ${p}.`,
  },
  {
    id: "sinkhole",
    name: "Sinkhole",
    blurb: "The road caves in and the houses beside it tip into the pit.",
    icon: "circle-dot",
    scale: "minor",
    where: "downtown",
    actors: [actor("sinkhole", "Sinkhole", "#2b241f", 4)],
    crowd: "gather",
    responders: ["police", "cleanup"],
    text: (p) => `A sinkhole opens up and swallows the street in ${p}.`,
  },
  {
    id: "ufo",
    name: "UFO",
    blurb: "A saucer hovers over a house and beams the whole thing up.",
    icon: "orbit",
    scale: "minor",
    where: "oak_hill",
    actors: [actor("ufo", "UFO", "#9aa4ad", 4)],
    crowd: "gather",
    responders: ["police", "agents"],
    harmless: true,
    text: (p) => `A flying saucer hovers over ${p} and beams a house up into the sky.`,
  },
  {
    id: "gate",
    name: "The gate opens",
    blurb: "A red gate tears open and the Upside Down's vines crawl out.",
    icon: "door-open",
    scale: "citywide",
    where: "lab",
    actors: [actor("rift", "The gate", "#c0182a", 5), actor("vines", "Vines", "#3a1f2b", 4)],
    crowd: "flee",
    responders: ["agents"],
    harmless: true,
    text: (p) => `A gate to the Upside Down tears open in mid-air over ${p}.`,
  },
  {
    id: "whale",
    name: "Falling whale",
    blurb: "A whale drops out of a clear blue sky. Nobody knows why.",
    icon: "fish",
    scale: "minor",
    where: "mall",
    actors: [actor("whale", "Whale", "#4f6f8f", 4)],
    crowd: "gather",
    responders: ["fire", "cleanup"],
    text: (p) => `A whale falls out of a clear blue sky onto ${p}.`,
  },
  {
    id: "blackout",
    name: "Blackout",
    blurb: "A substation blows in a shower of sparks and the lights go out.",
    icon: "zap-off",
    scale: "minor",
    where: "downtown",
    actors: [actor("blackout", "Blackout", "#8b8f94", 3)],
    crowd: "gather",
    responders: ["police"],
    harmless: true,
    text: (p) => `The substation blows and ${p} goes dark.`,
  },
  {
    id: "lab-leak",
    name: "Lab leak",
    blurb: "Grey spores drift out of the lab and the black vans roll in.",
    icon: "biohazard",
    scale: "minor",
    where: "lab",
    actors: [
      actor("spores", "Spores", "#8a8a80", 4),
      actor("black_vans", "The lab's vans", "#121316", 3, 5),
    ],
    crowd: "flee",
    responders: ["agents"],
    harmless: true,
    text: (p) => `Something leaks out of Hollow Point Lab and drifts over ${p}.`,
  },
  {
    id: "shadow",
    name: "The shadow",
    blurb: "Something enormous rises over the horizon in a red storm.",
    icon: "eye",
    scale: "apocalyptic",
    where: "downtown",
    actors: [actor("shadow", "Something enormous", "#1a0d12", 7)],
    crowd: "flee",
    responders: ["agents", "police"],
    harmless: true,
    text: (p) => `Something enormous rises over the horizon and stands there, watching ${p}.`,
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/**
 * Makes the newsroom's story fit the chosen disaster: its fixed cost, its
 * hand-tuned actors, and damage that lands where the player aimed it.
 */
export function shapeResult(
  result: EventResult,
  preset: DisasterPreset,
  where: Place,
): EventResult {
  const aimed = result.tile_ops.some((op) => op.target === where.id);
  const anchor: TileOp = {
    op: preset.harmless ? "clear" : "destroy",
    target: where.id,
    count: preset.scale === "apocalyptic" ? 3 : 1,
    build_kind: null,
    landmark: null,
  };
  return {
    ...result,
    scale: preset.scale,
    // The epicentre comes from where the damage lands: make sure it's there.
    tile_ops: aimed ? result.tile_ops : [anchor, ...result.tile_ops].slice(0, 6),
    spectacle: {
      actors: preset.actors.map((a) => ({ ...a })),
      crowd: preset.crowd,
      responders: [...preset.responders],
    },
  };
}
