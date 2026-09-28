import type { SpeciesId } from "@/lib/island/types";

/** Who made each model (all CC BY 4.0). */
export const SKIN_CREDITS: Record<SpeciesId, { name: string; author: string; uid: string }> = {
  titan: {
    name: "Braquiossauro 3 Topologia",
    author: "pro_alba",
    uid: "cba596d2146542c8b28e7c1b7d265f57",
  },
  hornface: {
    name: "Triceratops - dinosaur - low poly",
    author: "Legendary Claws",
    uid: "d5658e6fe77d40bda00d59bb840cd856",
  },
  duckbill: {
    name: "Parasaurolofo ark",
    author: "Dodogamer",
    uid: "07e496bdb07246a6ae5c7264f81dfb37",
  },
  plateback: {
    name: "Ankylosaurus",
    author: "rushanwasim",
    uid: "53d3dcc8395649d295b3591b9496ee0f",
  },
  snapper: { name: "Compsognathus", author: "Dodogamer", uid: "5be349174ed14285a18d3517e6eded5e" },
  tyrant: {
    name: "Tyrannosaurus Rex With Fixed Colour",
    author: "dinomaster",
    uid: "c924da45e35d437fa1e44bc110f5cb3a",
  },
  raptor: {
    name: "Velociraptor With Fixed Colour",
    author: "dinomaster",
    uid: "45a25c6886f84786a4959d419ecbd004",
  },
  skywing: {
    name: "Pteranodon (with Fixed Colour)",
    author: "dinomaster",
    uid: "6349f561e70a4cd1aa7e76879f93a9fe",
  },
  leviathan: {
    name: "mosasaurus",
    author: "Epic_devolepment",
    uid: "6c343575d0df414aba162c69ac1f0105",
  },
};

/** The second looks some kinds come in (see dinoForms.ts), also CC BY 4.0. */
export const FORM_CREDITS: Record<string, { name: string; author: string; uid: string }> = {
  hornface_2: {
    name: "Triceratops occultatum",
    author: "Miguelangelo Rosario",
    uid: "d8b6a381f36c46f8b1d59ed6e0b57c65",
  },
  duckbill_2: {
    name: "Dryosauro the isle",
    author: "Dodogamer",
    uid: "0e078b56671d4a59b4935a67577bfcdc",
  },
  tyrant_2: {
    name: "Animated Tyrannosaurus Rex Dinosaur Running Loop",
    author: "LasquetiSpice",
    uid: "38007d947ae74dea83988cb0b08ee053",
  },
  raptor_2: {
    name: "Velociraptor 1+motions",
    author: "Kapi777",
    uid: "9d72445803604cdca5bd965dc8d16f46",
  },
  skywing_2: {
    name: "Pteranodon+motions",
    author: "Kapi777",
    uid: "6802359bdc16486083301bea24f1f3f5",
  },
};
