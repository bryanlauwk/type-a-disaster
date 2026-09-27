/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { act, createWorld, replay, tick } from "./sim";
import { totalOf } from "./ecology";
import { POWER_DEFS } from "./powers";
import { fromSaved, toSaved } from "./persistence";
import { describeAct, plainEntry } from "./story";
import { LANDMARKS, POWERS, REGIONS, SPECIES, type WorldState } from "./types";

const run = (s: WorldState, days: number) => {
  for (let d = 0; d < days; d++) s = tick(s);
  return s;
};

describe("world generation", () => {
  const s = createWorld(7);

  test("every landmark and region is on the map", () => {
    for (const l of LANDMARKS) expect(s.tiles.some((t) => t.landmark === l)).toBe(true);
    for (const r of REGIONS) expect(s.tiles.some((t) => t.region === r)).toBe(true);
  });

  test("there are rivers, sea and a tribe", () => {
    expect(s.tiles.filter((t) => t.water === 1).length).toBeGreaterThan(40);
    expect(s.tiles.filter((t) => t.water === 3).length).toBeGreaterThan(500);
    expect(s.tribe.pop).toBeGreaterThan(5);
    expect(s.tiles.some((t) => t.build)).toBe(true);
  });

  test("the same seed makes the same island; another seed another", () => {
    expect(JSON.stringify(createWorld(7).tiles)).toBe(JSON.stringify(s.tiles));
    expect(JSON.stringify(createWorld(8).tiles)).not.toBe(JSON.stringify(s.tiles));
  });
});

describe("the living island", () => {
  const s = run(createWorld(11), 200);

  test("the food chain holds for 200 days", () => {
    expect(totalOf(s, "titan") + totalOf(s, "hornface") + totalOf(s, "duckbill")).toBeGreaterThan(
      20,
    );
    expect(totalOf(s, "tyrant") + totalOf(s, "raptor")).toBeGreaterThan(1);
    expect(s.tribe.pop).toBeGreaterThan(10);
    for (const sp of SPECIES) expect(Number.isFinite(totalOf(s, sp))).toBe(true);
  });

  test("the tribe learns and builds", () => {
    expect(s.tribe.techs.length).toBeGreaterThan(1);
    expect(s.tiles.filter((t) => t.build).length).toBeGreaterThan(5);
  });
});

describe("god powers", () => {
  const base = run(createWorld(3), 5);
  const land = base.tiles.findIndex((t, i) => t.region === "fern_basin" && !t.landmark && i > 0);

  test("every power runs and costs favour", () => {
    for (const p of POWERS) {
      const s = { ...base, favour: 30, evo: 2 };
      const a = {
        power: p,
        tile: p === "eruption" ? s.tiles.findIndex((t) => t.landmark === "great_volcano") : land,
        species: p === "introduce" || p === "evolve" ? ("hornface" as const) : undefined,
        trait: p === "evolve" ? ("hardy" as const) : undefined,
        focus: p === "guide" ? ("farm" as const) : undefined,
      };
      const after = act(s, a);
      expect(after).not.toBe(s);
      expect(after.favour).toBe(30 - POWER_DEFS[p].cost);
      expect(after.actions.at(-1)?.power).toBe(p);
      // Every act can be told, with or without the storyteller.
      const rec = after.actions.at(-1)!;
      const input = describeAct(s, after, rec);
      expect(input.act.length).toBeGreaterThan(5);
      expect(plainEntry(after, rec, input).title).toBe(POWER_DEFS[p].name);
      // The island carries on afterwards.
      run(after, 3);
    }
  });

  test("a god without favour can't act", () => {
    const s = { ...base, favour: 0 };
    expect(act(s, { power: "meteor", tile: land })).toBe(s);
  });

  test("the eruption spills lava", () => {
    const s = { ...base, favour: 30 };
    const after = act(s, { power: "eruption", tile: 0 });
    expect(after.tiles.filter((t) => t.lava > 0).length).toBeGreaterThan(5);
  });
});

describe("replay and saving", () => {
  let s = createWorld(21);
  s = run(s, 4);
  s = act(
    { ...s, favour: 30 },
    { power: "meteor", tile: s.tiles.findIndex((t) => t.region === "emerald_grasslands") },
  );
  s = run(s, 6);
  s = act(s, { power: "rain", tile: s.tribe.home });
  s = run(s, 5);

  test("a seed and the acts rebuild the island exactly", () => {
    const r = replay(s.seed, s.actions, s.chronicle, s.day);
    expect(r.day).toBe(s.day);
    expect(JSON.stringify(r.tiles)).toBe(JSON.stringify(s.tiles));
    expect(JSON.stringify(r.pop)).toBe(JSON.stringify(s.pop));
    expect(r.tribe.pop).toBe(s.tribe.pop);
  });

  test("save round trip", () => {
    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(s))));
    expect(back.day).toBe(s.day);
    expect(back.actions.length).toBe(2);
    expect(JSON.stringify(back.tiles)).toBe(JSON.stringify(s.tiles));
  });
});
