# Primordia simulation & interaction overhaul

A big pass on the island's ecosystem depth and the ways the player can see and touch it. Everything stays a plain-data, deterministic tick (`WorldState` + `rand(s)`), so seeds + action lists still replay exactly.

## 1. Simulation: carcasses & scavenging

- New `Tile.carcass?: number` (food value, decays each day).
- Predator kills that exceed what the pack converts into young leave a carcass on the target tile; meteor, wildfire, stampede and eruption deaths leave them too.
- Snappers get a new food path: they gain birth rate from nearby carcasses (their "scraps and insects" diet becomes real).
- Skywings and raptors occasionally feed at carcasses (small `hunger` relief, visible gathering).
- Carcasses show on the ground as small bone picks (instanced, cheap).

## 2. Simulation: water as a living resource

- Rivers shrink in drought: river tiles get a `flow` value (0–1) that drops through the dry season and drought, and refills with rain.
- Low flow dries the seasonal ponds earlier and cuts the wetland veg cap — droughts now visibly brown the river valleys.
- Thirst-driven migration (already hinted in `Herd.reason`) keys off flow, not just the drought flag.

## 3. Simulation: natural selection

- While a species is starving or heavily hunted, each day has a small chance it organically gains one of its traits (`giant`, `swift`, `hardy`…), weighted by the pressure that is killing it.
- The island reports it as a notice ("Hardier calves survive the lean season…"); the god's `evolve` power stays the deliberate, expensive shortcut.
- New test: pressure-driven trait emergence is deterministic and bounded (max 3 traits per species, same as today).

## 4. Simulation: disease that travels

- Sickness (currently a single random region event) becomes a small outbreak object: it holds a region, lasts a few days, spreads along herd routes to neighbouring regions, and burns out.
- `hardy` slows it, sanctuaries don't, big crowded herds fuel it. `plague` power seeds an outbreak on purpose.

## 5. Simulation: population history

- `WorldState.history: Record<SpeciesId, number[]>` (ring buffer, ~180 days) plus tribe pop — recorded every tick, cloned in `cloneWorld`, replay-safe (rebuilt from actions like everything else).

## 6. Interaction: click to inspect

- Clicking an animal opens an inspector card: species, region, herd, and live state (grazing / hungry / migrating / hunting / fleeing), with a "follow" button that tracks it with the camera (the `?look=` debug rig becomes a real feature).
- Clicking a region tile shows the same card with region stats: veg, water flow, populations, carcasses, fire/flood.

## 7. Interaction: Almanac graphs & alerts

- Population sparklines per species from the new history buffer, with trait badges and tribe stage on one panel.
- Notices become tappable: clicking "A herd set off for the wetlands" flies the camera to the event region.

## 8. Interaction: the wild made visible

- Scavenger spirals over carcasses, ducks drinking at low-flow rivers, and a brief chase flourish when a hunt lands nearby — small, instanced, no new heavy assets.

## Files touched

- `src/lib/island/types.ts` — tile `carcass`/`flow`, outbreak + history state, version bump.
- `src/lib/island/ecology.ts` — carcass creation/decay, flow-driven veg, selection, outbreak ticks.
- `src/lib/island/sim.ts`, `tribe.ts`, `powers.ts` — wire the new state through tick, tribe day, and `plague`.
- `src/components/island/Dinos.tsx` / `Props.tsx` — carcass + scavenger visuals, pick targets.
- `src/routes/index.tsx`, `CaveWall.tsx` / Almanac — inspector card, sparklines, tappable notices.

## Tests

Extend `src/lib/island/island.test.ts`: carcass creation and decay determinism, drought flow shrinking and refill, organic trait emergence bounds, outbreak spread/burnout, history ring buffer length. All assert from the pure tick, no rendering.

## Order of work

1. State + ecology core (carcasses, flow, selection, disease, history) with tests passing.
2. Inspector card and camera follow.
3. Almanac graphs and tappable notices.
4. Ground visuals (carcass picks, scavengers, drinking, chase flourish).
5. Full-page Playwright check and sim test run.
