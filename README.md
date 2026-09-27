# Type-a-Disaster: Maple Hollow

Maple Hollow, October 1985: a sleepy small town with a lab on the hill that nobody talks about, and something underneath. You type what happens to it ("a gate tears open under the lab", "the Christmas lights on Elm Street start blinking"). Claude decides the consequences and choreographs what you see: the gate rips open in a red glow, vines creep out across the lawns, the lab's black vans roll in, kids on bikes pedal out to investigate, and the chain reaction keeps unfolding over the next few days. _The Maple Hollow Courier_ reports all of it with a straight face, while the kids on channel 9 know better.

Everything in Maple Hollow is original. It's a Goosebumps-spooky homage to 1980s small-town mysteries: no names, characters or creatures from existing shows.

## What's on screen

- **Maple Hollow** on a 32×32 map (`src/lib/city/hollow.ts`):
  - **North:** Blackpine Woods with the WHOL radio tower and a hunter's cabin, Mirror Lake and Kettle Creek, and Hollow Point Lab fenced off on the hill.
  - **The middle:** Elm Street's houses, the water tower and the boarded-up Hawthorne House; Pine Acres trailer park to the east.
  - **Main Street:** the Hollow Cinema, Town Hall and its clock tower, Rewind Video, the Starlight Arcade, Dot's Diner, the police station, Route 9 Gas and First Church.
  - **South:** the freight railroad with its level crossings, Maple Hollow High and Bulldogs Field, Oak Hill, Sunbeam Mall, Kettle Farm's pumpkin fields and Kettle's Junkyard.
- **The 1985 building kit** (`scene/kit.ts`): colonials, ranches with garages, cape cods with dormers, split-levels, farmhouses and trailers; brick Main Street storefronts with awnings and neon; brick apartments, the savings & loan, a motel and a saw-tooth factory. Bricks, clapboard and shingles are laid out in world space (`scene/facade.ts`, textures painted by `scripts/paint_town_textures.py`); windows and signs light up after dark.
- **Street life:** station wagons and sedans in 80s colours (keeping to the right), yellow school buses, kids on BMX bikes, a freight train with its headlight on after dark and flashing crossing signals, deer in the woods, ducks on the lake and crows overhead. October trees in reds and golds, jack-o'-lanterns on the porches and leaf piles on the lawns.
- **Time and weather:** day and night, autumn showers, and lightning.

## The Upside Down

Beneath the town hangs its mirror (`scene/UpsideDown.tsx`): the same streets and houses, drained of colour and overgrown with pulsing red vines, spores drifting up through cold fog, the gate glowing under the lab, and something colossal standing over the woods.

- **Flip** (the button under the labels toggle): the screen goes dark, the world turns over, and the camera drops to a low view across the Upside Down. The town's layout, including every building you've destroyed, is mirrored exactly. Flip back to return.
- **The Rift** (0–100) replaces the old Chaos stat. Only supernatural events raise it, and it closes slowly by itself. As it widens the Upside Down leaks into the town: past 25 vines creep out from the lab, past 40 the lights flicker, and past 70 red lightning cracks over Maple Hollow.

## Rendering

- **A photographed sky** (`scene/PhotoSky.tsx`). Poly Haven's CC0 "Kloofendal 48d Partly Cloudy" HDRI lights the scene. A photo of the same sky shows by day, fading into dusk, storms, night, the Rift's red and the Upside Down's grey.
- **Film-like finishing on larger screens** (`scene/PostFX.tsx`): ambient occlusion, bloom (stronger at night), ACES tone mapping and a light vignette. If the frame rate drops below about 28 fps, it switches itself off. `?fx=0` in the URL turns it off from the start.
- **Real models for built-in actors** (`scene/realModels.ts`): a humpback whale, an animated running T-Rex (the kaiju), a UFO, a hot-air balloon and a scanned asteroid (the meteor's rock). They're CC BY models from Objaverse, loaded from Hugging Face when an event needs them and credited in the Courier. The procedural actor stands in while one loads, and stays if it can't. Phones get only the models under 4 MB.
- **Soft particle effects** (`scene/vfx.tsx`): dust at impacts, spray for whales and waves, meteor fireballs, smoke and flames from burning buildings, and spores pouring out of gates.

## How it plays

- **The town grows on its own.** One day passes every 12 seconds, or 3 seconds on fast-forward. Happy, solvent districts build new houses, shops and brick blocks in their own character: family homes on Elm Street and Oak Hill, storefronts on Main Street, trailers in Pine Acres, sheds and annexes at the lab. The woods and Mirror Lake are protected; nothing is built on the railroad.
- **You type events.** Claude returns map effects (destroy, burn, flood, build, landmark, clear; aimed at a district, the railroad or an area), a spectacle (actors, how the crowd reacts, who responds), and up to three follow-ups that arrive as bulletins on later days.
- **Town memory shapes the next event.** The newsroom sees active fires, floods, rubble, lingering effects and already scheduled bulletins, so a new event can react to what is already happening. Ordinary events leave the Rift alone; only a supernatural event can widen it.
- **Hazards move through the map.** Fires spread through adjacent buildings and woods faster in polluted, low-green or high-Rift conditions. Flooding can spill into nearby tiles, with green cover slowing it and water edges speeding it up.
- **The actor & effect library** (`scene/ActorLibrary.tsx` and `scene/Spectacle.tsx`):
  - **The Upside Down:** a gate that tears open in mid-air, vines that grow over the ground and up the houses, a spore storm, and a colossal shadow that rises over the horizon in a red storm.
  - **Small-town life:** kids on BMX bikes with flashlights, the lab's black vans and men in hazmat suits, Christmas lights that blink one bulb at a time as if spelling something out, and the homecoming parade with its marching band and pumpkin float.
  - **Set pieces:** a whale, meteor, giant falling object, creature or kaiju, UFO, tornado, flood wave, storm, fireworks and a hot-air balloon.
  - **New phenomena:** earthquakes send shock rings and debris across the ground; auroras ripple above the rooftops; phantom freight trains cross the actual railroad and pause its traffic; radio bursts expand into visible signal rings and sparks.
  - **Mishaps:** a blackout, a sinkhole and a landslide.
- **The Courier** prints each event with quotes from the townsfolk (a sheriff blaming swamp gas, a lab spokesman denying everything). Walkie-talkie messages from the kids show up as intercepted transmissions.
- **Event credits.** You get 5, and one refills every 10 minutes. Minor events cost 1 credit, citywide 2, apocalyptic 3.
- **Your town, shareable.** The town is saved in the browser. The share button makes a link that replays the whole history. The simulation is deterministic, so a seed plus the event log rebuilds the town exactly.

## Setup: Anthropic API key

Events need an Anthropic API key, which stays on the server (a TanStack Start server function running on the Cloudflare Worker).

1. Create a key at [console.anthropic.com](https://console.anthropic.com) → Settings → API Keys. Also set a monthly spend limit under Settings → Limits.
2. Add it as a secret named `ANTHROPIC_API_KEY`:
   - **Lovable:** Project settings → Secrets.
   - **Wrangler:** `npx wrangler secret put ANTHROPIC_API_KEY`
   - **Local dev:** copy `.dev.vars.example` to `.dev.vars` (it's git-ignored), or export the variable in your shell before running `npm run dev`.
3. If the key is an organization-level key that isn't scoped to a workspace, also add an `ANTHROPIC_WORKSPACE_ID` secret. The workspace ID is under Console → Settings → Workspaces. Alternatively, create the key inside a workspace.
4. Optional: set `CITY_MODEL` to use a different Claude model. The default is `claude-opus-5-5`, run at low effort.

Without a key the game still runs, but typed events show a "newsroom is closed" message.

## New actors on demand (free, no keys)

When an event names something the built-in library can't show ("a giant walkie-talkie lands on Dot's Diner"), Claude picks a stand-in actor and also returns, in the same reply:

- `search_terms`: the thing's everyday name ("walkie talkie", "station wagon").
- a **recipe**: its own design of the thing from 10–40 primitives, with a motion (fall, walk, hover, spin).

The recipe appears at once. Meanwhile the browser looks for a **ready-made model** in a free library, with no API key or account:

1. [`public/objaverse/index-v1.json.gz`](public/objaverse) lists about 47,000 CC BY and CC0 models from [Objaverse](https://huggingface.co/datasets/allenai/objaverse), a public mirror of downloadable Sketchfab models on Hugging Face. They're filtered with the [Objaverse++](https://huggingface.co/datasets/cindyxl/ObjaversePlusPlus) quality labels for single, well-made objects, with realistic and scanned models ranked first. The 2.3 MB index is fetched once, while the newsroom writes the first event.
2. The search ranks names against the terms. The main noun must match, so "monitor lizard" never returns a computer monitor, and skulls, toys and statues are ranked below the real thing.
3. One batched Hugging Face request checks file sizes (up to 8 MB, or 4 MB on phones). The GLB then loads straight from Hugging Face's CDN with its own PBR materials, replacing the recipe. If nothing fits or the download fails, the recipe stays.
4. The Courier credits each model's author and licence, linked to its Sketchfab page.

To rebuild the index (it downloads ~820 MB of public metadata and needs no account), run `python3 scripts/build_objaverse_index.py`.

### Optional: shared recipes (Supabase)

With Supabase configured, the first recipe for each `model_key` is saved and reused, so every visitor sees the same giant walkie-talkie, and Claude is shown the saved keys so it reuses them.

1. In a Supabase project, run [`supabase/actor_library.sql`](supabase/actor_library.sql) in the SQL editor.
2. Add these secrets (Lovable → Secrets):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - optionally `LIBRARY_PER_VISITOR_CAP` (default: 10 new recipes per visitor a day)

## Surface map pipeline

The surface images are in `public/textures`. The town's brick, clapboard and shingles are painted by `python3 scripts/paint_town_textures.py` (needs Pillow). The road and actor textures have `.normal.webp` maps for relief; if one of those images changes, run `python3 scripts/derive_normal_maps.py` to regenerate its normal map.

## Code map

| Path                                  | What it does                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/city/hollow.ts`              | The town map: districts, streets, lake and creek, railroad, landmarks                       |
| `src/lib/city/simulation.ts`          | Deterministic sim: growth, sprawl, redevelopment, events, chain reactions, replay           |
| `src/lib/city/schema.ts`              | Zod validation and clamping of event results, plus the JSON schema sent to Claude           |
| `src/lib/city/newsroom.server.ts`     | Server-only Claude call (structured output, refusal fallback)                               |
| `src/lib/city/simulate.functions.ts`  | Server function the page calls for events, with a per-IP throttle                           |
| `src/lib/city/actorLibrary.server.ts` | Optional shared library of Claude's actor recipes (Supabase)                                |
| `src/lib/city/modelSearch.ts`         | Free model search in the browser: static Objaverse index, Hub size check, credits           |
| `src/lib/city/persistence.ts`         | localStorage save, credits, share-link encoding                                             |
| `src/components/city/CityScene.tsx`   | three.js / react-three-fiber scene and camera director                                      |
| `src/components/city/scene/*`         | Buildings, landmarks, ground and trees, railroad, street life, sky, the Upside Down, events |
| `src/components/city/Newspaper.tsx`   | The Courier sidebar                                                                         |
| `src/routes/index.tsx`                | The game page                                                                               |

Run `npm run test` (uses Bun) for the simulation tests.

## Credits

The town itself is generated in code: buildings, landmarks, trees, vehicles, people, the Upside Down and its effects. Maple Hollow and everyone in it are fictional.

The sky is Poly Haven's [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) by Greg Zaal and Jarod Guest (CC0).

Real models for built-in actors (all CC BY 4.0, via Sketchfab and Objaverse): "Game-ready Humpback Whale" by Allie2k, "Animated Tyrannosaurus Rex Dinosaur Running Loop" by LasquetiSpice, "UfoV2" by Batuhan13, "The Getaway BALLOON2" by KevinAz61 and "Asteroid with minerals" by PeterMikielewicz.

Ready-made models for custom actors come from [Objaverse](https://huggingface.co/datasets/allenai/objaverse) (ODC-BY; Deitke et al., 2023), selected with [Objaverse++](https://huggingface.co/datasets/cindyxl/ObjaversePlusPlus) labels (ODC-BY). Each model keeps its own CC BY or CC0 licence, and its author is credited in the Courier whenever it appears.

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
