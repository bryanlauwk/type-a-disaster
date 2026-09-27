import type { SpeciesId } from "@/lib/island/types";

/** Primitive shapes a dinosaur is built from. */
export type Geo = "sphere" | "capsule" | "cone" | "box" | "cyl";
export type Role = "body" | "belly" | "accent" | "dark";
/** Which way a part moves when the animal does. */
export type Anim =
  | "legFL"
  | "legFR"
  | "legBL"
  | "legBR"
  | "neck"
  | "head"
  | "tail"
  | "jaw"
  | "wingL"
  | "wingR";

export interface Part {
  geo: Geo;
  /** Centre, in body lengths (the model faces +z, feet at y = 0). */
  p: [number, number, number];
  /** Size along each axis. */
  s: [number, number, number];
  /** Rotation in radians. */
  r?: [number, number, number];
  role: Role;
  anim?: Anim;
  /** The joint it swings around (defaults to its top for legs). */
  pivot?: [number, number, number];
}

export interface Model {
  parts: Part[];
  colors: Record<Role, string>;
  /** How the body moves: walking on four legs, two, flying or swimming. */
  gait: "quad" | "biped" | "fly" | "swim";
}

const PI = Math.PI;

const quadLegs = (x: number, zf: number, zb: number, h: number, w: number, hb = h): Part[] => [
  { geo: "cyl", p: [x, h / 2, zf], s: [w, h, w], role: "dark", anim: "legFL", pivot: [x, h, zf] },
  { geo: "cyl", p: [-x, h / 2, zf], s: [w, h, w], role: "dark", anim: "legFR", pivot: [-x, h, zf] },
  {
    geo: "cyl",
    p: [x, hb / 2, zb],
    s: [w * 1.1, hb, w * 1.1],
    role: "dark",
    anim: "legBL",
    pivot: [x, hb, zb],
  },
  {
    geo: "cyl",
    p: [-x, hb / 2, zb],
    s: [w * 1.1, hb, w * 1.1],
    role: "dark",
    anim: "legBR",
    pivot: [-x, hb, zb],
  },
];

const bipedLegs = (x: number, z: number, h: number, w: number): Part[] => [
  {
    geo: "capsule",
    p: [x, h * 0.62, z],
    s: [w * 1.5, h * 0.55, w * 1.5],
    role: "body",
    anim: "legBL",
    pivot: [x, h, z],
  },
  {
    geo: "cyl",
    p: [x, h * 0.22, z + w * 0.3],
    s: [w, h * 0.45, w],
    role: "dark",
    anim: "legBL",
    pivot: [x, h, z],
  },
  {
    geo: "capsule",
    p: [-x, h * 0.62, z],
    s: [w * 1.5, h * 0.55, w * 1.5],
    role: "body",
    anim: "legBR",
    pivot: [-x, h, z],
  },
  {
    geo: "cyl",
    p: [-x, h * 0.22, z + w * 0.3],
    s: [w, h * 0.45, w],
    role: "dark",
    anim: "legBR",
    pivot: [-x, h, z],
  },
];

export const MODELS: Record<SpeciesId, Model> = {
  // A sauropod: a hill of a body, a crane of a neck, a whip of a tail.
  titan: {
    gait: "quad",
    colors: { body: "#6f6a58", belly: "#9c9580", accent: "#8a6e4a", dark: "#4d4839" },
    parts: [
      { geo: "sphere", p: [0, 0.3, 0], s: [0.2, 0.17, 0.34], role: "body" },
      { geo: "sphere", p: [0, 0.25, 0.02], s: [0.17, 0.12, 0.3], role: "belly" },
      ...quadLegs(0.08, 0.12, -0.11, 0.26, 0.055),
      {
        geo: "capsule",
        p: [0, 0.47, 0.24],
        s: [0.05, 0.3, 0.05],
        r: [0.75, 0, 0],
        role: "body",
        anim: "neck",
        pivot: [0, 0.34, 0.14],
      },
      {
        geo: "capsule",
        p: [0, 0.64, 0.36],
        s: [0.035, 0.16, 0.035],
        r: [0.4, 0, 0],
        role: "body",
        anim: "neck",
        pivot: [0, 0.34, 0.14],
      },
      {
        geo: "sphere",
        p: [0, 0.71, 0.42],
        s: [0.04, 0.035, 0.065],
        role: "body",
        anim: "head",
        pivot: [0, 0.34, 0.14],
      },
      {
        geo: "cone",
        p: [0, 0.28, -0.36],
        s: [0.1, 0.42, 0.1],
        r: [-PI / 2 - 0.12, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.3, -0.18],
      },
    ],
  },
  // Three horns and a frill.
  hornface: {
    gait: "quad",
    colors: { body: "#8f7b52", belly: "#b5a275", accent: "#d4702a", dark: "#4e4030" },
    parts: [
      { geo: "sphere", p: [0, 0.3, 0], s: [0.24, 0.21, 0.42], role: "body" },
      ...quadLegs(0.12, 0.16, -0.14, 0.18, 0.07),
      {
        geo: "sphere",
        p: [0, 0.27, 0.33],
        s: [0.14, 0.13, 0.2],
        role: "body",
        anim: "head",
        pivot: [0, 0.3, 0.22],
      },
      {
        geo: "cyl",
        p: [0, 0.37, 0.25],
        s: [0.34, 0.03, 0.34],
        r: [PI / 2 - 0.5, 0, 0],
        role: "accent",
        anim: "head",
        pivot: [0, 0.3, 0.22],
      },
      {
        geo: "cone",
        p: [0.05, 0.36, 0.41],
        s: [0.035, 0.2, 0.035],
        r: [1.1, 0, 0],
        role: "belly",
        anim: "head",
        pivot: [0, 0.3, 0.22],
      },
      {
        geo: "cone",
        p: [-0.05, 0.36, 0.41],
        s: [0.035, 0.2, 0.035],
        r: [1.1, 0, 0],
        role: "belly",
        anim: "head",
        pivot: [0, 0.3, 0.22],
      },
      {
        geo: "cone",
        p: [0, 0.28, 0.47],
        s: [0.03, 0.09, 0.03],
        r: [0.8, 0, 0],
        role: "belly",
        anim: "head",
        pivot: [0, 0.3, 0.22],
      },
      {
        geo: "cone",
        p: [0, 0.28, -0.33],
        s: [0.1, 0.24, 0.1],
        r: [-PI / 2 - 0.2, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.3, -0.2],
      },
    ],
  },
  // Crested, beaked, honking.
  duckbill: {
    gait: "biped",
    colors: { body: "#6f8a4a", belly: "#b7b48a", accent: "#d59a3a", dark: "#3f4d2c" },
    parts: [
      { geo: "sphere", p: [0, 0.42, 0], s: [0.16, 0.2, 0.36], r: [-0.25, 0, 0], role: "body" },
      ...bipedLegs(0.08, -0.04, 0.34, 0.05),
      {
        geo: "capsule",
        p: [0.06, 0.34, 0.15],
        s: [0.025, 0.14, 0.025],
        r: [0.5, 0, 0],
        role: "dark",
        anim: "legFL",
        pivot: [0.06, 0.4, 0.14],
      },
      {
        geo: "capsule",
        p: [-0.06, 0.34, 0.15],
        s: [0.025, 0.14, 0.025],
        r: [0.5, 0, 0],
        role: "dark",
        anim: "legFR",
        pivot: [-0.06, 0.4, 0.14],
      },
      {
        geo: "capsule",
        p: [0, 0.56, 0.2],
        s: [0.05, 0.18, 0.05],
        r: [0.5, 0, 0],
        role: "body",
        anim: "neck",
        pivot: [0, 0.48, 0.14],
      },
      {
        geo: "sphere",
        p: [0, 0.65, 0.3],
        s: [0.05, 0.05, 0.1],
        role: "body",
        anim: "head",
        pivot: [0, 0.48, 0.14],
      },
      {
        geo: "box",
        p: [0, 0.62, 0.38],
        s: [0.06, 0.02, 0.07],
        role: "belly",
        anim: "head",
        pivot: [0, 0.48, 0.14],
      },
      {
        geo: "cyl",
        p: [0, 0.72, 0.24],
        s: [0.025, 0.16, 0.025],
        r: [-0.9, 0, 0],
        role: "accent",
        anim: "head",
        pivot: [0, 0.48, 0.14],
      },
      {
        geo: "cone",
        p: [0, 0.4, -0.36],
        s: [0.1, 0.46, 0.1],
        r: [-PI / 2 - 0.05, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.42, -0.16],
      },
    ],
  },
  // Plates down the back and a spiked tail.
  plateback: {
    gait: "quad",
    colors: { body: "#6d6a3c", belly: "#a09a6a", accent: "#b5452d", dark: "#403e24" },
    parts: [
      { geo: "sphere", p: [0, 0.3, 0], s: [0.19, 0.2, 0.38], role: "body" },
      ...quadLegs(0.1, 0.16, -0.12, 0.16, 0.06, 0.22),
      {
        geo: "sphere",
        p: [0, 0.16, 0.38],
        s: [0.06, 0.055, 0.1],
        role: "body",
        anim: "head",
        pivot: [0, 0.24, 0.24],
      },
      ...[-0.22, -0.12, -0.02, 0.08, 0.18].map(
        (z, k): Part => ({
          geo: "cone",
          p: [k % 2 ? 0.025 : -0.025, 0.46 - Math.abs(z) * 0.3, z],
          s: [0.12 - Math.abs(z) * 0.2, 0.14 - Math.abs(z) * 0.2, 0.025],
          role: "accent",
        }),
      ),
      {
        geo: "cone",
        p: [0, 0.26, -0.38],
        s: [0.09, 0.3, 0.09],
        r: [-PI / 2 - 0.15, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.3, -0.22],
      },
      {
        geo: "cone",
        p: [0.05, 0.25, -0.48],
        s: [0.02, 0.1, 0.02],
        r: [0, 0, -1.2],
        role: "belly",
        anim: "tail",
        pivot: [0, 0.3, -0.22],
      },
      {
        geo: "cone",
        p: [-0.05, 0.25, -0.48],
        s: [0.02, 0.1, 0.02],
        r: [0, 0, 1.2],
        role: "belly",
        anim: "tail",
        pivot: [0, 0.3, -0.22],
      },
    ],
  },
  // Chicken-sized, quick, everywhere.
  snapper: {
    gait: "biped",
    colors: { body: "#7a8a4a", belly: "#c2b98a", accent: "#d6b24a", dark: "#33391f" },
    parts: [
      { geo: "sphere", p: [0, 0.36, 0], s: [0.12, 0.13, 0.3], role: "body" },
      ...bipedLegs(0.05, 0, 0.3, 0.035),
      {
        geo: "sphere",
        p: [0, 0.5, 0.22],
        s: [0.07, 0.07, 0.13],
        role: "body",
        anim: "head",
        pivot: [0, 0.4, 0.12],
      },
      {
        geo: "cone",
        p: [0, 0.36, -0.32],
        s: [0.06, 0.42, 0.06],
        r: [-PI / 2, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.36, -0.12],
      },
    ],
  },
  // A head like a boulder and legs like tree trunks.
  tyrant: {
    gait: "biped",
    colors: { body: "#4f4a3a", belly: "#8c8266", accent: "#7a2f22", dark: "#2a241c" },
    parts: [
      { geo: "sphere", p: [0, 0.45, 0], s: [0.14, 0.18, 0.3], r: [-0.1, 0, 0], role: "body" },
      { geo: "sphere", p: [0, 0.41, 0.02], s: [0.11, 0.13, 0.24], role: "belly" },
      ...bipedLegs(0.08, -0.03, 0.4, 0.05),
      { geo: "capsule", p: [0.05, 0.43, 0.2], s: [0.012, 0.06, 0.012], r: [1, 0, 0], role: "dark" },
      {
        geo: "capsule",
        p: [-0.05, 0.43, 0.2],
        s: [0.012, 0.06, 0.012],
        r: [1, 0, 0],
        role: "dark",
      },
      {
        geo: "box",
        p: [0, 0.58, 0.29],
        s: [0.11, 0.11, 0.2],
        role: "body",
        anim: "head",
        pivot: [0, 0.55, 0.17],
      },
      {
        geo: "box",
        p: [0, 0.51, 0.3],
        s: [0.09, 0.04, 0.17],
        role: "belly",
        anim: "jaw",
        pivot: [0, 0.53, 0.2],
      },
      {
        geo: "box",
        p: [0, 0.62, 0.3],
        s: [0.115, 0.02, 0.05],
        role: "accent",
        anim: "head",
        pivot: [0, 0.55, 0.17],
      },
      {
        geo: "cone",
        p: [0, 0.45, -0.38],
        s: [0.1, 0.52, 0.1],
        r: [-PI / 2 + 0.05, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.45, -0.14],
      },
    ],
  },
  // Lean, feathered, clever.
  raptor: {
    gait: "biped",
    colors: { body: "#a88a55", belly: "#d8c79a", accent: "#c4462a", dark: "#3a2c1c" },
    parts: [
      { geo: "sphere", p: [0, 0.38, 0], s: [0.1, 0.12, 0.26], role: "body" },
      ...bipedLegs(0.05, -0.02, 0.33, 0.035),
      {
        geo: "capsule",
        p: [0, 0.48, 0.15],
        s: [0.03, 0.12, 0.03],
        r: [0.9, 0, 0],
        role: "body",
        anim: "head",
        pivot: [0, 0.42, 0.1],
      },
      {
        geo: "sphere",
        p: [0, 0.53, 0.25],
        s: [0.045, 0.045, 0.11],
        role: "body",
        anim: "head",
        pivot: [0, 0.42, 0.1],
      },
      { geo: "cone", p: [0, 0.47, 0.03], s: [0.05, 0.12, 0.02], r: [-0.7, 0, 0], role: "accent" },
      {
        geo: "cone",
        p: [0, 0.4, -0.36],
        s: [0.05, 0.5, 0.05],
        r: [-PI / 2 + 0.1, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0.39, -0.12],
      },
    ],
  },
  // Leather wings over the sea cliffs.
  skywing: {
    gait: "fly",
    colors: { body: "#8a6a52", belly: "#c9b48f", accent: "#d44a2a", dark: "#5a4230" },
    parts: [
      { geo: "sphere", p: [0, 0, 0], s: [0.06, 0.06, 0.22], role: "body" },
      { geo: "cone", p: [0, 0.02, 0.19], s: [0.03, 0.18, 0.03], r: [PI / 2, 0, 0], role: "belly" },
      {
        geo: "cone",
        p: [0, 0.05, 0.1],
        s: [0.02, 0.14, 0.05],
        r: [-PI / 2 + 0.3, 0, 0],
        role: "accent",
      },
      {
        geo: "box",
        p: [0.25, 0, 0.02],
        s: [0.46, 0.012, 0.16],
        role: "dark",
        anim: "wingL",
        pivot: [0.03, 0, 0.02],
      },
      {
        geo: "box",
        p: [-0.25, 0, 0.02],
        s: [0.46, 0.012, 0.16],
        role: "dark",
        anim: "wingR",
        pivot: [-0.03, 0, 0.02],
      },
    ],
  },
  // A shadow under the swell.
  leviathan: {
    gait: "swim",
    colors: { body: "#3c5560", belly: "#9fb3b3", accent: "#2c3e46", dark: "#1d2a30" },
    parts: [
      { geo: "sphere", p: [0, 0, 0], s: [0.08, 0.07, 0.36], role: "body" },
      {
        geo: "sphere",
        p: [0, -0.02, 0.3],
        s: [0.05, 0.04, 0.14],
        role: "body",
        anim: "head",
        pivot: [0, 0, 0.2],
      },
      {
        geo: "box",
        p: [0.08, -0.03, 0.12],
        s: [0.14, 0.01, 0.05],
        r: [0, -0.4, -0.2],
        role: "accent",
        anim: "legFL",
        pivot: [0.04, -0.03, 0.12],
      },
      {
        geo: "box",
        p: [-0.08, -0.03, 0.12],
        s: [0.14, 0.01, 0.05],
        r: [0, 0.4, 0.2],
        role: "accent",
        anim: "legFR",
        pivot: [-0.04, -0.03, 0.12],
      },
      {
        geo: "cone",
        p: [0, 0, -0.38],
        s: [0.06, 0.3, 0.06],
        r: [-PI / 2, 0, 0],
        role: "body",
        anim: "tail",
        pivot: [0, 0, -0.24],
      },
      {
        geo: "box",
        p: [0, 0.04, -0.52],
        s: [0.02, 0.12, 0.08],
        role: "accent",
        anim: "tail",
        pivot: [0, 0, -0.24],
      },
    ],
  },
};
