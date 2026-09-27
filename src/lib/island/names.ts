import type { LandmarkId, RegionId } from "./types";

export const LANDMARK_NAMES: Record<LandmarkId, string> = {
  great_volcano: "The Great Volcano",
  titan_valley: "Titan Valley",
  migration_pass: "Sauropod Migration Pass",
  predator_ridge: "Predator Ridge",
  fern_sea: "Fern Sea",
  misty_wetlands: "Misty Wetlands",
  thunder_falls: "Thunder Falls",
  fossil_canyon: "Fossil Canyon",
  sunken_jungle: "Sunken Jungle ruins",
  settlers_bay: "Settler's Bay",
  skeleton_field: "Giant Skeleton Field",
  crystal_caves: "Crystal Caves",
  geothermal_springs: "Geothermal Springs",
  crater_lake: "Ancient Crater Lake",
  nesting_grounds: "Dinosaur Nesting Grounds",
  sacred_mountain: "Sacred Mountain",
  coastal_lagoon: "Coastal Lagoon",
  dinosaur_island: "Dinosaur Island",
};

/** Region names for the map (short), and whether they get a big label. */
export const REGION_TITLES: Partial<Record<RegionId, string>> = {
  fern_basin: "Fern Basin",
  titan_highlands: "Titan Highlands",
  predator_ridge: "Predator Ridge",
  misty_wetlands: "Misty Wetlands",
  emerald_grasslands: "Emerald Grasslands",
  settlers_bay: "Settler's Bay",
  fertile_plains: "Fertile Plains",
  sunken_jungle: "Sunken Jungle",
  fossil_canyon: "Fossil Canyon",
};
