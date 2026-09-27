import type { RegionId, SpeciesId, Trait } from "./types";

export type Diet = "plants" | "meat" | "fish" | "omnivore";

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  plural: string;
  diet: Diet;
  /** How well each region suits it, 0–1 (missing = can't live there). */
  habitat: Partial<Record<RegionId, number>>;
  /** Plant food eaten per animal per day. */
  appetite: number;
  birth: number;
  death: number;
  /** For hunters: kills per animal per day at best. */
  attack?: number;
  /** For hunters: new young per kill. */
  convert?: number;
  /** Prey, and how easy each is to bring down. */
  prey?: Partial<Record<SpeciesId, number>>;
  /** How dangerous it is to the tribe, 0–1. */
  danger: number;
  /** Can be kept in pens once the tribe knows how. */
  tamable?: boolean;
  /** Group size on the move. */
  group: [number, number];
  /** Rough body length in world units, for the screen. */
  size: number;
  /** The tribe's name for it, and what the codex says. */
  blurb: string;
}

export const SPECIES_DEFS: Record<SpeciesId, SpeciesDef> = {
  titan: {
    id: "titan",
    name: "Titan",
    plural: "Titans",
    diet: "plants",
    habitat: {
      titan_highlands: 0.9,
      fern_basin: 1,
      emerald_grasslands: 0.5,
      fertile_plains: 0.3,
      misty_wetlands: 0.3,
    },
    appetite: 0.09,
    birth: 0.035,
    death: 0.012,
    danger: 0.05,
    group: [4, 9],
    size: 4.2,
    blurb:
      "Long-necked giants that walk the same roads their grandmothers walked. The ground shakes when a herd goes by.",
  },
  hornface: {
    id: "hornface",
    name: "Hornface",
    plural: "Hornfaces",
    diet: "plants",
    habitat: {
      fern_basin: 0.8,
      emerald_grasslands: 1,
      fertile_plains: 0.8,
      offshore: 0.7,
      settlers_bay: 0.3,
    },
    appetite: 0.03,
    birth: 0.07,
    death: 0.025,
    danger: 0.2,
    group: [5, 12],
    size: 1.6,
    blurb:
      "Three horns and a bony frill. Grazes in herds and charges anything that comes too close.",
  },
  duckbill: {
    id: "duckbill",
    name: "Duckbill",
    plural: "Duckbills",
    diet: "plants",
    habitat: {
      misty_wetlands: 1,
      emerald_grasslands: 0.8,
      fern_basin: 0.8,
      fertile_plains: 0.6,
      settlers_bay: 0.3,
    },
    appetite: 0.025,
    birth: 0.08,
    death: 0.03,
    danger: 0.05,
    tamable: true,
    group: [6, 14],
    size: 1.5,
    blurb:
      "Gentle, loud and always hungry. Honks warnings to the whole marsh. The tribe thinks it could be tamed.",
  },
  plateback: {
    id: "plateback",
    name: "Plateback",
    plural: "Platebacks",
    diet: "plants",
    habitat: {
      fern_basin: 0.9,
      titan_highlands: 0.7,
      fossil_canyon: 0.5,
      predator_ridge: 0.4,
    },
    appetite: 0.03,
    birth: 0.05,
    death: 0.02,
    danger: 0.25,
    group: [3, 7],
    size: 1.6,
    blurb:
      "Armour plates from snout to tail, and a bone club on the end of it. Slow, and it stands its ground: most hunters give up.",
  },
  snapper: {
    id: "snapper",
    name: "Snapper",
    plural: "Snappers",
    diet: "omnivore",
    habitat: { misty_wetlands: 1, sunken_jungle: 0.9, settlers_bay: 0.4, coast: 0.2 },
    appetite: 0.004,
    birth: 0.14,
    death: 0.08,
    danger: 0.05,
    group: [8, 20],
    size: 0.35,
    blurb: "Chicken-sized, quick and everywhere. Steals fish off the drying racks.",
  },
  tyrant: {
    id: "tyrant",
    name: "Tyrant",
    plural: "Tyrants",
    diet: "meat",
    habitat: {
      predator_ridge: 1,
      sunken_jungle: 0.7,
      fern_basin: 0.4,
      emerald_grasslands: 0.35,
      titan_highlands: 0.3,
    },
    appetite: 0,
    birth: 0.03,
    death: 0.016,
    attack: 0.22,
    convert: 0.2,
    prey: { titan: 0.3, hornface: 0.8, duckbill: 1, plateback: 0.5 },
    danger: 1,
    group: [1, 2],
    size: 2.8,
    blurb:
      "The king of Predator Ridge. Holds a territory the size of a valley and comes down when the ridge runs out of food.",
  },
  raptor: {
    id: "raptor",
    name: "Raptor",
    plural: "Raptors",
    diet: "meat",
    habitat: {
      predator_ridge: 0.9,
      sunken_jungle: 1,
      fossil_canyon: 0.8,
      emerald_grasslands: 0.4,
      fertile_plains: 0.35,
    },
    appetite: 0,
    birth: 0.07,
    death: 0.03,
    attack: 0.12,
    convert: 0.6,
    prey: { hornface: 0.5, duckbill: 0.9, snapper: 1, plateback: 0.2 },
    danger: 0.7,
    group: [3, 6],
    size: 0.8,
    blurb: "Hunts in packs and learns fast. Watches the fences, looking for the gap.",
  },
  skywing: {
    id: "skywing",
    name: "Skywing",
    plural: "Skywings",
    diet: "fish",
    habitat: { coast: 1, predator_ridge: 0.7, offshore: 1, misty_wetlands: 0.5 },
    appetite: 0,
    birth: 0.08,
    death: 0.05,
    danger: 0.1,
    group: [6, 16],
    size: 0.9,
    blurb:
      "Leather-winged fishers that nest on the sea cliffs. Where they circle, the fish are running.",
  },
  leviathan: {
    id: "leviathan",
    name: "Leviathan",
    plural: "Leviathans",
    diet: "fish",
    habitat: { coast: 0.7, offshore: 1 },
    appetite: 0,
    birth: 0.02,
    death: 0.014,
    danger: 0.4,
    group: [1, 2],
    size: 7,
    blurb:
      "A shadow under the swell, longer than the tribe's biggest canoe ten times over. Sometimes it takes the nets.",
  },
};

export const HERBIVORES: SpeciesId[] = ["titan", "hornface", "duckbill", "plateback"];
export const PREDATORS: SpeciesId[] = ["tyrant", "raptor"];

/** What each trait does to a species' numbers. */
export const TRAIT_EFFECTS: Record<Trait, { label: string; blurb: string }> = {
  giant: { label: "Giant", blurb: "Bigger bodies: harder to hunt, but they eat more." },
  swift: { label: "Swift", blurb: "Faster: escapes predators, catches prey, travels further." },
  hardy: { label: "Hardy", blurb: "Shrugs off drought, disease and hunger." },
  fertile: { label: "Fertile", blurb: "More young each season." },
  cunning: { label: "Cunning", blurb: "Smarter: hunters get past fences; prey avoids traps." },
  armoured: { label: "Armoured", blurb: "Thick hide and plates: predators give up sooner." },
};

/** A species' numbers with its evolved traits applied. */
export function tuned(def: SpeciesDef, traits: Trait[]) {
  const has = (t: Trait) => traits.includes(t);
  return {
    appetite: def.appetite * (has("giant") ? 1.4 : 1),
    birth: def.birth * (has("fertile") ? 1.35 : 1),
    death: def.death * (has("hardy") ? 0.75 : 1),
    attack: (def.attack ?? 0) * (has("swift") ? 1.3 : 1) * (has("cunning") ? 1.15 : 1),
    /** How hard it is to catch, as prey. */
    guard: (has("giant") ? 0.6 : 1) * (has("armoured") ? 0.55 : 1) * (has("swift") ? 0.75 : 1),
    starve: has("hardy") ? 0.5 : 1,
    size: def.size * (has("giant") ? 1.35 : 1),
    fenceLeap: has("cunning") ? 0.5 : 0,
  };
}
