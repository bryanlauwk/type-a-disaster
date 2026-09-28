import type { SpeciesId } from "@/lib/island/types";

/**
 * The looks each kind of animal comes in. The simulation knows nine kinds;
 * on screen each can be one of a few real animals that fill the same place
 * (a Triceratops or a spike-frilled Styracosaurus, a Parasaurolophus or a little
 * Dryosaurus), and every individual gets its own colouring on top: a shift in
 * hue, a darker back and paler belly, and stripes, spots or blotches.
 */

export interface Form {
  /** Model file (public/dinos/<key>.glb) and its baked animation. */
  key: string;
  /** What the animal is, for the almanac. */
  name: string;
  /** Body length relative to the species' usual. */
  size: number;
  /** How common this look is. */
  weight: number;
}

export const FORMS: Record<SpeciesId, Form[]> = {
  titan: [{ key: "titan", name: "Brachiosaurus", size: 1, weight: 1 }],
  hornface: [
    { key: "hornface", name: "Triceratops", size: 1, weight: 1 },
    { key: "hornface_2", name: "Styracosaurus", size: 1, weight: 0.6 },
  ],
  duckbill: [
    { key: "duckbill", name: "Parasaurolophus", size: 1, weight: 1 },
    { key: "duckbill_2", name: "Dryosaurus", size: 0.62, weight: 0.7 },
  ],
  plateback: [{ key: "plateback", name: "Ankylosaurus", size: 1, weight: 1 }],
  snapper: [{ key: "snapper", name: "Compsognathus", size: 1, weight: 1 }],
  tyrant: [
    { key: "tyrant", name: "Tyrannosaurus", size: 1, weight: 1 },
    { key: "tyrant_2", name: "Tyrannosaurus (tiger-striped)", size: 1.05, weight: 0.7 },
  ],
  raptor: [
    { key: "raptor", name: "Velociraptor", size: 1, weight: 1 },
    { key: "raptor_2", name: "Velociraptor (dark morph)", size: 1, weight: 0.8 },
  ],
  skywing: [
    { key: "skywing", name: "Pteranodon", size: 1, weight: 1 },
    { key: "skywing_2", name: "Pteranodon (grey)", size: 1, weight: 0.6 },
  ],
  leviathan: [{ key: "leviathan", name: "Mosasaurus", size: 1, weight: 1 }],
};

/** How much each kind varies from one animal to the next. */
interface LookRange {
  /** Hue swing either way (radians in YIQ). */
  hue: number;
  /** Colour richness range. */
  sat: [number, number];
  /** Marking kinds to pick from: 0 plain, 1 bands, 2 spots, 3 blotches. */
  marks: number[];
  /** Marking strength range. */
  strength: [number, number];
  /** Dark back / pale belly. */
  counter: number;
}

const LOOKS: Record<SpeciesId, LookRange> = {
  titan: { hue: 0.14, sat: [0.75, 1.1], marks: [0, 3, 3], strength: [0.25, 0.5], counter: 0.8 },
  hornface: { hue: 0.16, sat: [0.7, 1.1], marks: [3, 1, 0], strength: [0.35, 0.6], counter: 0.6 },
  duckbill: {
    hue: 0.22,
    sat: [0.8, 1.2],
    marks: [1, 3, 0, 1],
    strength: [0.35, 0.65],
    counter: 0.7,
  },
  plateback: { hue: 0.12, sat: [0.7, 1.05], marks: [3, 0], strength: [0.3, 0.5], counter: 0.45 },
  snapper: { hue: 0.28, sat: [0.8, 1.25], marks: [1, 2], strength: [0.5, 0.8], counter: 0.7 },
  tyrant: { hue: 0.16, sat: [0.75, 1.1], marks: [1, 3, 0], strength: [0.3, 0.55], counter: 0.7 },
  raptor: { hue: 0.26, sat: [0.8, 1.2], marks: [1, 2, 2], strength: [0.45, 0.8], counter: 0.75 },
  skywing: { hue: 0.2, sat: [0.8, 1.15], marks: [0, 3], strength: [0.2, 0.45], counter: 1 },
  leviathan: { hue: 0.1, sat: [0.8, 1.1], marks: [0, 2], strength: [0.3, 0.55], counter: 1.2 },
};

const h = (a: number, b: number, c: number) => {
  let x = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const strHash = (s: string) => {
  let x = 7;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return x;
};

/**
 * Picks an animal's look. Animals of one place tend to share a look and a
 * colouring (a local population), with each one a little different.
 */
export function pickLook(sp: SpeciesId, region: string, id: number, young: boolean) {
  const forms = FORMS[sp];
  const r = strHash(region + sp);
  // The local population's usual form, weighted by how common each is.
  const pickForm = (u: number) => {
    const total = forms.reduce((n, f) => n + f.weight, 0);
    let acc = 0;
    for (let k = 0; k < forms.length; k++) {
      acc += forms[k].weight / total;
      if (u < acc) return k;
    }
    return forms.length - 1;
  };
  const local = pickForm(h(r, 1, 3));
  const form = h(id, 2, 5) < 0.72 ? local : pickForm(h(id, 3, 5));
  const L = LOOKS[sp];
  // Population colouring, then the individual's own.
  const popHue = (h(r, form, 7) - 0.5) * 2 * L.hue;
  const hue = popHue + (h(id, 4, 7) - 0.5) * L.hue * 0.6;
  const sat = L.sat[0] + (L.sat[1] - L.sat[0]) * (h(r, 5, 7) * 0.6 + h(id, 5, 7) * 0.4);
  const marks = L.marks[Math.floor(h(r, form, 11) * L.marks.length)];
  const mk = h(id, 6, 7) < 0.8 ? marks : L.marks[Math.floor(h(id, 7, 7) * L.marks.length)];
  let strength = L.strength[0] + (L.strength[1] - L.strength[0]) * h(id, 8, 7);
  // Youngsters are paler with bolder markings, as in many living reptiles and birds.
  const bright = young ? 1.1 : 0.92 + h(id, 9, 7) * 0.16;
  if (young) strength = Math.min(1, strength + 0.25);
  return {
    form,
    look: [hue, sat, young && mk === 0 ? 2 : mk, strength] as [number, number, number, number],
    look2: [L.counter * (0.8 + h(id, 10, 7) * 0.4), h(r, id, 12), h(id, 11, 7), bright] as [
      number,
      number,
      number,
      number,
    ],
    // Build: some animals are stockier, some rangier.
    build: [0.92 + h(id, 12, 7) * 0.18, 0.95 + h(id, 13, 7) * 0.1] as [number, number],
  };
}
