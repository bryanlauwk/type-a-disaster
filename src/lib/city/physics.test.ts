/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { eventResultSchema } from "./schema";
import { applyEvent, createCity, replay, tick } from "./simulation";
import { SURGE_IMPACT, surgeArrival, surgeAt, surgeCoords, surgeDepth } from "./surge";
import type { Actor, ActorKind, CityState, EventResult } from "./types";

const GAS = 17 * 32 + 22; // Route 9 Gas
const WATER_TOWER = 10 * 32 + 16;

function event(over: Partial<EventResult> & Pick<EventResult, "tile_ops" | "spectacle">) {
  return eventResultSchema.parse({
    scale: "citywide",
    headline: "Something happened",
    subhead: "Officials are looking into it.",
    quotes: [],
    stat_changes: { population: 0, happiness: 0, money: 0, pollution: 0, rift: 0 },
    ongoing: null,
    followups: [],
    ...over,
  });
}

const actor = (kind: ActorKind, size = 5): Actor => ({
  kind,
  label: kind,
  color: "#555555",
  size,
  count: 1,
  shape: "blob",
});

const rubble = (s: CityState) => s.grid.filter((t) => t.kind === "rubble").length;

describe("impact physics", () => {
  test("a kaiju wrecks a trail of buildings through the epicentre, in walking order", () => {
    const s = createCity(11);
    const kaiju = event({
      tile_ops: [{ op: "destroy", target: "downtown", count: 1, build_kind: null, landmark: null }],
      spectacle: { actors: [actor("kaiju", 6)], crowd: "flee", responders: [] },
    });
    const next = applyEvent(s, "a kaiju stomps down Main Street", kaiju);
    const impact = next.log.at(-1)!.impact!;
    expect(impact.trail.length).toBeGreaterThan(0);
    for (const i of impact.trail) expect(next.grid[i].kind).toBe("rubble");
    expect(rubble(next)).toBeGreaterThan(rubble(applyEvent(s, "x", kaiju, 0)));
  });

  test("a burning gas station explodes and spreads the fire", () => {
    const s = createCity(3);
    // Every landmark catches fire, the gas station among them.
    const fire = event({
      tile_ops: [{ op: "burn", target: "landmarks", count: 30, build_kind: null, landmark: null }],
      spectacle: { actors: [], crowd: "flee", responders: [] },
    });
    const next = applyEvent(s, "fireworks go wrong", fire);
    const chain = next.log.at(-1)!.impact!.chain;
    const boom = chain.find((l) => l.kind === "explosion");
    expect(boom?.label).toContain("Route 9 Gas");
    expect(next.grid[GAS].kind).toBe("rubble");
    expect(boom!.tiles.slice(1).every((i) => next.grid[i].fire > 0)).toBe(true);
  });

  test("a fire that reaches the water tower later bursts it and floods the street", () => {
    let s = applyEvent(
      createCity(4),
      "quiet day",
      event({ tile_ops: [], spectacle: { actors: [], crowd: "ignore", responders: [] } }),
    );
    s = { ...s, grid: s.grid.map((t) => ({ ...t })) };
    s.grid[WATER_TOWER].fire = 3;
    const next = tick(s);
    expect(next.grid[WATER_TOWER].kind).toBe("rubble");
    expect(next.grid.some((t) => t.flood > 0)).toBe(true);
    expect(next.bulletins.at(-1)?.text).toMatch(/water tower burst/i);
  });

  test("older events replay without physics, newer ones with it, exactly", () => {
    const quake = event({
      tile_ops: [{ op: "destroy", target: "center", count: 2, build_kind: null, landmark: null }],
      spectacle: { actors: [actor("earthquake", 5)], crowd: "flee", responders: [] },
    });
    let s = createCity(9);
    s = applyEvent(s, "old quake", quake, 0);
    for (let d = 0; d < 3; d++) s = tick(s);
    s = applyEvent(s, "new quake", quake);
    for (let d = 0; d < 3; d++) s = tick(s);
    const again = replay(9, s.log, s.day);
    expect(again.grid).toEqual(s.grid);
    expect(again.stats).toEqual(s.stats);
    expect(again.log[0].physics).toBeUndefined();
    expect(again.log[1].physics).toBe(2);
  });

  test("a tsunami comes out of Mirror Lake and floods its path in the order the water arrives", () => {
    const s = createCity(12);
    const wave = event({
      scale: "apocalyptic",
      tile_ops: [
        { op: "destroy", target: "elm_street", count: 2, build_kind: null, landmark: null },
      ],
      spectacle: { actors: [actor("wave", 6)], crowd: "flee", responders: [] },
    });
    const next = applyEvent(s, "tsunami", wave);
    const impact = next.log.at(-1)!.impact!;
    const shape = impact.surge!;
    expect(shape.kind).toBe("tsunami");
    // It starts over the lake (west side of town) and heads inland.
    expect(shape.ox).toBeLessThan(-8);
    expect(impact.trail.length).toBeGreaterThan(10);
    const C = 15.5;
    const times = impact.trail.map((i) =>
      surgeArrival(shape, surgeCoords(shape, (i % 32) - C, Math.floor(i / 32) - C)[0]),
    );
    for (let k = 1; k < times.length; k++) expect(times[k]).toBeGreaterThanOrEqual(times[k - 1]);
    for (const i of impact.trail)
      expect(next.grid[i].kind === "rubble" || next.grid[i].flood > 0).toBe(true);
  });

  test("a wildfire sets a trail of trees and houses alight, starting from the woods side", () => {
    const s = createCity(13);
    const fire = event({
      tile_ops: [{ op: "burn", target: "elm_street", count: 1, build_kind: null, landmark: null }],
      spectacle: { actors: [actor("wildfire", 5)], crowd: "flee", responders: [] },
    });
    const next = applyEvent(s, "wildfire", fire);
    const impact = next.log.at(-1)!.impact!;
    expect(impact.trail.length).toBeGreaterThan(3);
    // Alight, unless a chain reaction got there first (the water tower bursting).
    for (const i of impact.trail) {
      const t = next.grid[i];
      expect(t.fire > 0 || t.flood > 0 || t.kind === "rubble").toBe(true);
    }
    expect(impact.trail.filter((i) => next.grid[i].fire > 0).length).toBeGreaterThan(3);
    // The first tiles to catch are further towards the woods than the last.
    const toWoods = (i: number) => Math.hypot((i % 32) - 6, Math.floor(i / 32) - 3);
    expect(toWoods(impact.trail[0])).toBeLessThan(toWoods(impact.trail.at(-1)!));
  });

  test("events played with version 1 physics replay the same after the upgrade", () => {
    const wave = event({
      tile_ops: [{ op: "destroy", target: "downtown", count: 2, build_kind: null, landmark: null }],
      spectacle: { actors: [actor("wave", 5)], crowd: "flee", responders: [] },
    });
    let s = applyEvent(createCity(21), "old wave", wave, 1);
    for (let d = 0; d < 2; d++) s = tick(s);
    const again = replay(21, s.log, s.day);
    expect(again.grid).toEqual(s.grid);
    expect(again.log[0].impact?.surge).toBeUndefined();
  });

  test("both kinds of surge put water over the epicentre once they land", () => {
    for (const kind of ["wave", "flood"] as const) {
      const s = createCity(8);
      const next = applyEvent(
        s,
        kind,
        event({
          tile_ops: [
            { op: "destroy", target: "oak_hill", count: 1, build_kind: null, landmark: null },
          ],
          spectacle: { actors: [actor(kind, 5)], crowd: "flee", responders: [] },
        }),
      );
      const impact = next.log.at(-1)!.impact!;
      const shape = impact.surge!;
      const t = SURGE_IMPACT[shape.kind] + 1;
      const [depth] = surgeDepth(
        { ...shape, ...surgeAt(shape, t) },
        (impact.tile % 32) - 15.5,
        Math.floor(impact.tile / 32) - 15.5,
      );
      expect(depth).toBeGreaterThan(0.1);
    }
  });
});
