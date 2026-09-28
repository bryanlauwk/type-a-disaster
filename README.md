# Primordia

A god-game on a Jurassic island. Primordia is a huge volcanic island ruled by dinosaurs, with a small tribe of primitive humans, the People of the Bay, trying to make a life at its southern tip. The island runs itself: plants grow and burn, herds graze and migrate, hunters follow them, and the tribe fishes, farms, hunts, digs up fossils and grows from a camp into a town. You're its god. You can shape the land, send rain or drought, introduce and evolve species, guide the tribe, or unleash the volcano. The tribe's storyteller (Claude) paints what you do on the cave wall.

## The island

A 128×128 map generated from a seed (`src/lib/island/worldgen.ts`): one big island filling the map, broad, rugged and wild in the north, with open valleys, rivers and a great lake through the middle, narrowing to a harbour at the southern tip. Rivers run from the volcano and the highlands to the sea:

- **The Great Volcano** in the north, with the **Fern Basin** around its foot.
- **Predator Ridge** (the wild north-west), home of the Tyrants and Raptors.
- **Titan Highlands** (north-east), with Titan Valley and the Sauropod Migration Pass.
- **Emerald Grasslands**, the open valley at the island's heart, around the Ancient Crater Lake.
- **Misty Wetlands** (east coast), **Fossil Canyon** (west) with bones and tar pits, and the **Sunken Jungle** (south-west) with its forgotten ruins.
- **Fertile Plains** running south to **Settler's Bay**, the tribe's harbour at the southern tip.
- The coast, the Coastal Lagoon, and offshore islets, including Dinosaur Island.
- 18 named landmarks, among them Thunder Falls, the Crystal Caves, the Geothermal Springs and the Sacred Mountain.

## How it plays

- **One day every 10 seconds** (2.5 on fast-forward). A year is 40 days: a wet season, then a dry one.
- **The ecosystem** (`ecology.ts`, `species.ts`): nine species (Titans, Hornfaces, Duckbills, Platebacks, Snappers, Tyrants, Raptors, Skywings, Leviathans). Plants feed grazers, grazers feed hunters, and the numbers rise and fall with food. Herds migrate with the seasons and spread out when a region gets crowded, and they wear trails as they go. Fires spread through dry forest, floods and seasonal ponds come and go, and pressure builds under the volcano until it blows by itself.
- **The tribe** (`tribe.ts`): fishes, farms, hunts, gathers and builds huts, fire pits, docks, lookouts, fences, farms, workshops, markets, walkways, stone houses and watchtowers. Fossils teach them about the animals and unlock new skills, all the way to taming Duckbills. The tribe and the wild push on each other: cleared forest is lost habitat, farms draw grazers, fences turn herds aside, and hunters raid the edge of town.
- **God powers** (`powers.ts`), paid for with favour that refills a day at a time:
  - **Shape:** raise land, dig, carve a river.
  - **Nature:** grow forest, rain, drought.
  - **Life:** introduce a species, evolve one (costs an evolution point from fossils), protect a region.
  - **Tribe:** guide their focus, bless the harvest.
  - **Wrath:** eruption, meteor, tsunami, earthquake, wildfire, storm, flood, plague, stampede, raptor raid. Each plays out as a set piece, and the damage spreads tile by tile.
- **The cave wall** (`chronicle.server.ts`): after every big act, Claude writes a short story in the storyteller's voice, with a couple of lines from the tribe. Without an API key the island keeps its own plain record instead. The Almanac tab tracks the animals, their traits and the tribe's skills.
- **Saved and shareable** (`persistence.ts`): the island is saved in the browser. The sim is deterministic, so a seed plus the list of acts rebuilds the island exactly, and the share button packs that into a link.

## Setup: Anthropic API key (for the storyteller)

1. Create a key at [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys, and set a monthly spend limit under Settings → Limits.
2. Add it as a secret named `ANTHROPIC_API_KEY` (Lovable: Project settings → Secrets; Wrangler: `npx wrangler secret put ANTHROPIC_API_KEY`; local: copy `.dev.vars.example` to `.dev.vars`).
3. For an organization-level key not scoped to a workspace, also add `ANTHROPIC_WORKSPACE_ID`.
4. Optional: `CITY_MODEL` picks a different Claude model (default `claude-opus-5-5`, at low effort).

## Code map

| Path                                    | What it does                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/lib/island/types.ts`               | Regions, biomes, landmarks, species, powers, the world state                           |
| `src/lib/island/worldgen.ts`            | Generates the island from a seed                                                       |
| `src/lib/island/ecology.ts`             | Plants, fire, feeding, breeding, hunting, migration                                    |
| `src/lib/island/tribe.ts`               | The tribe's day: food, building, knowledge, raids                                      |
| `src/lib/island/powers.ts`              | The 21 god powers                                                                      |
| `src/lib/island/sim.ts`                 | The daily tick, acts, and replay                                                       |
| `src/lib/island/story.ts`               | What the storyteller is told, and the plain fallback record                            |
| `src/lib/island/chronicle.*`            | The server-side Claude call and its server function                                    |
| `src/components/island/IslandScene.tsx` | The three.js scene: terrain, water, plants, landmarks, dinosaurs, the settlement, acts |
| `src/components/island/GodPanel.tsx`    | The power picker                                                                       |
| `src/components/island/CaveWall.tsx`    | The chronicle and almanac sidebar                                                      |
| `src/routes/index.tsx`                  | The game page                                                                          |

Run `npm run test` (uses Bun) for the simulation tests.

## Credits

The dinosaurs are real 3D models, all CC BY 4.0 via Sketchfab (from the Objaverse mirror), recoloured and with their animations baked for the island (`public/dinos`, `src/components/island/dinoSkins.ts`):

- Titans: "Braquiossauro 3 Topologia" by pro_alba
- Hornfaces: "Triceratops - dinosaur - low poly" by Legendary Claws
- Duckbills: "Parasaurolofo ark" by Dodogamer
- Platebacks: "Ankylosaurus" by rushanwasim
- Snappers: "Compsognathus" by Dodogamer
- Tyrants: "Tyrannosaurus Rex With Fixed Colour" by dinomaster
- Raptors: "Velociraptor With Fixed Colour" by dinomaster
- Skywings: "Pteranodon (with Fixed Colour)" by dinomaster
- Second looks: "Triceratops occultatum" by Miguelangelo Rosario (Styracosaurus), "Dryosauro the isle" by Dodogamer (Dryosaurus), "Animated Tyrannosaurus Rex Dinosaur Running Loop" by LasquetiSpice (striped tyrant), "Velociraptor 1+motions" and "Pteranodon+motions" by Kapi777 (dark raptors, grey pteranodons)
- Leviathans: "mosasaurus" by Epic_devolepment

Plants are real models too, photographed from 16 angles into impostor atlases (`public/plants`, `src/components/island/impostors.ts`): Poly Haven's CC0 fir, fir sapling, island tree, fern, shrub, pachira and dead-trunk scans, plus CC BY 4.0 models from Sketchfab: "Ponga" (tree fern) by toAflame, "Realistic Palm Tree Model vol.1" by aliyeredon, "Bald Cypress" by BaptisteBerard and "Jungle Tree" by kobaltsecond6c7d6150917a4267.

The ground is eight CC0 Poly Haven photo surfaces (aerial grass, forest litter, earth, coastal sand, mossy rock, cliff strata, basalt, burnt ground) blended per tile (`src/components/island/ground.ts`). The water ripple normal map comes from the three.js examples (MIT).

Everything else on the island is generated in code. The sky is Poly Haven's [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) by Greg Zaal and Jarod Guest (CC0). Primordia, its tribe and its animals are fictional.

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fa28baec-2265-42cd-8918-0aecb8e6e1cf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
