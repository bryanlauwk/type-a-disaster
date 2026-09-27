/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { eventResultSchema } from "./schema";
import { applyEvent, createCity, replay, tick } from "./simulation";
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
    expect(rubble(next)).toBeGreaterThan(rubble(applyEvent(s, "x", kaiju, false)));
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
    s = applyEvent(s, "old quake", quake, false);
    for (let d = 0; d < 3; d++) s = tick(s);
    s = applyEvent(s, "new quake", quake);
    for (let d = 0; d < 3; d++) s = tick(s);
    const again = replay(9, s.log, s.day);
    expect(again.grid).toEqual(s.grid);
    expect(again.stats).toEqual(s.stats);
    expect(again.log[0].physics).toBeUndefined();
    expect(again.log[1].physics).toBe(1);
  });
});
