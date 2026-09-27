/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { districtAt, RAILROAD } from "./hollow";
import { eventResultSchema } from "./schema";
import { applyEvent, countKinds, createCity, replay, tick } from "./simulation";
import type { EventResult } from "./types";

const meteor: EventResult = eventResultSchema.parse({
  scale: "citywide",
  headline: "Meteor lands downtown, parking still available",
  subhead: "Officials describe the crater as 'roomy'.",
  quotes: [{ name: "Gus", role: "Parking warden", text: "Still a two-hour zone." }],
  stat_changes: { population: -40, happiness: -10, money: -500, pollution: 10, rift: 20 },
  tile_ops: [
    { op: "destroy", target: "center", count: 4, build_kind: null, landmark: null },
    {
      op: "landmark",
      target: "center",
      count: 1,
      build_kind: null,
      landmark: { name: "The Crater", shape: "crater", color: "#553322", height: 0.4 },
    },
    { op: "burn", target: "commercial", count: 3, build_kind: null, landmark: null },
  ],
  ongoing: {
    label: "Crater tourism",
    duration_days: 5,
    per_day: { population: 0, happiness: 1, money: 20, pollution: 0, rift: 0 },
  },
  spectacle: {
    actors: [
      { kind: "meteor", label: "Meteor", color: "#553322", size: 4, count: 1, shape: "blob" },
    ],
    crowd: "flee",
    responders: ["fire", "ambulance"],
  },
  followups: [
    {
      delay_days: 2,
      note: "Crater declared a historic site; a hot dog stand moves in.",
      stat_changes: { population: 0, happiness: 3, money: 500, pollution: 0, rift: 0 },
      tile_ops: [{ op: "build", target: "center", count: 2, build_kind: "shop", landmark: null }],
    },
  ],
});

describe("city simulation", () => {
  test("seeded town has Maple Hollow's streets, lake, woods, railroad and landmarks", () => {
    const s = createCity(42);
    const c = countKinds(s.grid);
    expect(s.name).toBe("Maple Hollow");
    expect(c.road).toBeGreaterThan(150);
    expect(c.water).toBeGreaterThan(10);
    expect(c.forest).toBeGreaterThan(60);
    expect(c.rail).toBeGreaterThan(20);
    for (const name of ["Hollow Point Lab", "Maple Hollow water tower", "Hawthorne House"])
      expect(s.grid.some((t) => t.landmark?.name === name)).toBe(true);
    // Nothing gets built on the tracks.
    const row = s.grid.slice(RAILROAD.row * 32, RAILROAD.row * 32 + 32);
    expect(row.every((t) => t.kind === "rail" || t.kind === "road")).toBe(true);
    expect(c.house + c.shop + c.tower).toBeGreaterThan(10);
    expect(s.stats.population).toBeGreaterThan(0);
    expect(s.name.length).toBeGreaterThan(3);
  });

  test("city grows over time without events", () => {
    let s = createCity(7);
    const before = countKinds(s.grid);
    for (let i = 0; i < 60; i++) s = tick(s);
    const after = countKinds(s.grid);
    expect(after.house + after.shop + after.tower).toBeGreaterThan(
      before.house + before.shop + before.tower,
    );
    expect(s.collapsed).toBe(false);
  });

  test("events change the map and are logged", () => {
    let s = createCity(3);
    for (let i = 0; i < 5; i++) s = tick(s);
    const next = applyEvent(s, "a meteor hits downtown", meteor);
    expect(next.grid.some((t) => t.landmark?.name === "The Crater")).toBe(true);
    expect(next.grid.some((t) => t.fire > 0)).toBe(true);
    expect(next.log).toHaveLength(1);
    expect(next.ongoing).toHaveLength(1);
    expect(next.scheduled).toHaveLength(1);
  });

  test("chain reactions fire as bulletins on schedule", () => {
    let s = applyEvent(createCity(5), "meteor", meteor);
    const shops = countKinds(s.grid).shop;
    s = tick(s);
    expect(s.bulletins).toHaveLength(0);
    s = tick(s);
    expect(s.bulletins).toHaveLength(1);
    expect(s.bulletins[0].text).toContain("historic");
    expect(s.scheduled).toHaveLength(0);
    expect(countKinds(s.grid).shop).toBeGreaterThanOrEqual(shops);
  });

  test("district targets land in that district", () => {
    const s = createCity(8);
    const next = applyEvent(
      s,
      "fire on Elm Street",
      {
        ...meteor,
        tile_ops: [
          { op: "burn", target: "elm_street", count: 4, build_kind: null, landmark: null },
        ],
        followups: [],
      },
      false,
    );
    const burning = next.grid.map((t, i) => (t.fire > 0 ? i : -1)).filter((i) => i >= 0);
    expect(burning.length).toBe(4);
    for (const i of burning) expect(districtAt(i).id).toBe("elm_street");
  });

  test("the railroad target hits the tracks, and wrecked track is relaid", () => {
    let s = createCity(4);
    s = applyEvent(
      s,
      "the freight train derails",
      {
        ...meteor,
        tile_ops: [
          { op: "destroy", target: "railroad", count: 5, build_kind: null, landmark: null },
        ],
        followups: [],
        ongoing: null,
      },
      false,
    );
    const onRow = (i: number) => Math.abs(Math.floor(i / 32) - RAILROAD.row) <= 1;
    const wrecked = s.grid.map((t, i) => (t.kind === "rubble" ? i : -1)).filter((i) => i >= 0);
    expect(wrecked.length).toBe(5);
    for (const i of wrecked) expect(onRow(i)).toBe(true);
    for (let d = 0; d < 60; d++) s = tick(s);
    const row = s.grid.slice(RAILROAD.row * 32, RAILROAD.row * 32 + 32);
    expect(row.every((t) => ["rail", "road", "rubble"].includes(t.kind))).toBe(true);
  });

  test("the rift closes slowly on its own", () => {
    let s = applyEvent(createCity(6), "the gate opens", {
      ...meteor,
      stat_changes: { ...meteor.stat_changes, rift: 60 },
      tile_ops: [],
      followups: [],
      ongoing: null,
    });
    const opened = s.stats.rift;
    expect(opened).toBeGreaterThan(60);
    for (let d = 0; d < 10; d++) s = tick(s);
    expect(s.stats.rift).toBeLessThan(opened);
    expect(s.stats.rift).toBeGreaterThan(opened * 0.6);
  });

  test("builds still land when the targeted district is full", () => {
    let s = createCity(12345);
    while (s.day < 300) s = tick(s);
    const inElm = (i: number) => districtAt(i).id === "elm_street";
    const parks = (st: typeof s) => st.grid.filter((t, i) => inElm(i) && t.kind === "park").length;
    const next = applyEvent(
      s,
      "The council opens pocket parks on Elm Street",
      {
        ...meteor,
        tile_ops: [
          { op: "build", target: "elm_street", count: 3, build_kind: "park", landmark: null },
        ],
        followups: [],
        ongoing: null,
      },
      false,
    );
    expect(parks(next) - parks(s)).toBe(3);
    // Landmarks aimed at a full district replace ordinary buildings, never icons.
    const icons = s.grid.filter((t) => t.kind === "landmark").map((t) => t.landmark?.name);
    const withWhale = applyEvent(
      s,
      "A whale lands on Elm Street",
      {
        ...meteor,
        tile_ops: [
          {
            op: "landmark",
            target: "elm_street",
            count: 1,
            build_kind: null,
            landmark: { name: "Beached whale", shape: "blob", color: "#445566", height: 1 },
          },
        ],
        followups: [],
        ongoing: null,
      },
      false,
    );
    const whale = withWhale.grid.findIndex((t) => t.landmark?.name === "Beached whale");
    expect(inElm(whale)).toBe(true);
    for (const name of icons)
      expect(withWhale.grid.some((t) => t.landmark?.name === name)).toBe(true);
  });

  test("outskirts means the edge of the map", () => {
    const s = createCity(7);
    const next = applyEvent(
      s,
      "Floods on the outskirts",
      {
        ...meteor,
        tile_ops: [
          { op: "flood", target: "outskirts", count: 6, build_kind: null, landmark: null },
        ],
        followups: [],
        ongoing: null,
      },
      false,
    );
    const flooded = next.grid.map((t, i) => [t, i] as const).filter(([t]) => t.flood > 0);
    expect(flooded.length).toBe(6);
    for (const [, i] of flooded) {
      const x = i % 32;
      const y = Math.floor(i / 32);
      expect(Math.min(x, y, 31 - x, 31 - y)).toBeLessThanOrEqual(2);
    }
  });

  test("replay reproduces the exact city", () => {
    let s = createCity(99);
    for (let i = 0; i < 8; i++) s = tick(s);
    s = applyEvent(s, "meteor", meteor);
    for (let i = 0; i < 12; i++) s = tick(s);
    s = applyEvent(s, "meteor again", meteor);
    for (let i = 0; i < 4; i++) s = tick(s);
    const r = replay(99, s.log, s.day);
    expect(r).toEqual(s);
  });

  test("schema clamps absurd values", () => {
    const r = eventResultSchema.parse({
      ...meteor,
      stat_changes: { ...meteor.stat_changes, happiness: 9999 },
      tile_ops: Array(20).fill(meteor.tile_ops[0]),
    });
    expect(r.stat_changes.happiness).toBe(60);
    expect(r.tile_ops).toHaveLength(6);
  });
});

describe("share links", () => {
  test("round-trip a city through a share code", async () => {
    const { encodeShare, decodeShare } = await import("./persistence");
    let s = createCity(2024);
    for (let i = 0; i < 6; i++) s = tick(s);
    s = applyEvent(s, "meteor", meteor);
    for (let i = 0; i < 3; i++) s = tick(s);
    const code = await encodeShare(s);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShare(code)).toEqual(s);
  });

  test("rejects garbage codes", async () => {
    const { decodeShare } = await import("./persistence");
    expect(decodeShare("not-a-real-code")).rejects.toThrow();
  });
});

describe("Claude output", () => {
  test("flat output converts, and unknown values fall back safely", async () => {
    const { fromClaude } = await import("./schema");
    const r = fromClaude({
      scale: "citywide",
      headline: "Whale lands",
      subhead: "Yes.",
      quotes: [{ name: "A", role: "B", text: "C" }],
      stats: { population: -10, happiness: 5, money: 0, pollution: 1, rift: 20 },
      tile_ops: [
        {
          op: "landmark",
          target: "Elm Street",
          count: 1,
          build: "",
          landmark_name: "Whale",
          landmark_shape: "blob",
          landmark_color: "#445566",
          landmark_height: 1,
        },
        {
          op: "build",
          target: "high school",
          count: 2,
          build: "Shop",
          landmark_name: "",
          landmark_shape: "",
          landmark_color: "",
          landmark_height: 0,
        },
        {
          op: "teleport",
          target: "x",
          count: 1,
          build: "",
          landmark_name: "",
          landmark_shape: "",
          landmark_color: "",
          landmark_height: 0,
        },
      ],
      ongoing_label: "",
      ongoing_days: 0,
      ongoing_per_day: { population: 0, happiness: 0, money: 0, pollution: 0, rift: 0 },
      actors: [
        { kind: "Whale", label: "Blue whale", color: "#4f6f8f", size: 4, count: 1, shape: "blob" },
        { kind: "dragon", label: "?", color: "red", size: 3, count: 1, shape: "wing" },
      ],
      crowd: "Flee",
      responders: ["fire", "coastguard"],
      followups: [{ delay_days: 2, note: "Hot dog stand.", stats: {}, tile_ops: [] }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tile_ops).toHaveLength(2);
    expect(r.data.tile_ops[0].target).toBe("elm_street");
    expect(r.data.tile_ops[0].landmark?.name).toBe("Whale");
    expect(r.data.tile_ops[1]).toMatchObject({
      target: "high_school",
      build_kind: "shop",
      landmark: null,
    });
    expect(r.data.ongoing).toBeNull();
    expect(r.data.spectacle.actors.map((a) => a.kind)).toEqual(["whale"]);
    expect(r.data.spectacle.crowd).toBe("flee");
    expect(r.data.spectacle.responders).toEqual(["fire"]);
    expect(r.data.followups[0].stat_changes.happiness).toBe(0);
  });

  test("custom model keys are normalised into slugs", async () => {
    const { fromClaude } = await import("./schema");
    const r = fromClaude({
      scale: "minor",
      headline: "Walkie-talkie",
      subhead: "",
      quotes: [],
      stats: {},
      tile_ops: [],
      actors: [
        {
          kind: "giant_object",
          label: "Walkie-talkie",
          color: "#c8894a",
          size: 4,
          count: 1,
          shape: "cone",
          model_key: "Walkie Talkie  Radio!!",
          search_terms: "walkie talkie",
          motion: "levitate",
          parts: [
            {
              shape: "cylinder",
              x: 0,
              y: 0.8,
              z: 0,
              sx: 0.8,
              sy: 1.6,
              sz: 0.8,
              rx: 0,
              ry: 0,
              rz: 0,
              color: "#c8894a",
            },
            {
              shape: "sphere",
              x: 9,
              y: 1.7,
              z: 0,
              sx: 0.8,
              sy: 0.3,
              sz: 0.8,
              rx: 0,
              ry: 0,
              rz: 900,
              color: "froth",
            },
            {
              shape: "teapot",
              x: 0,
              y: 0,
              z: 0,
              sx: 1,
              sy: 1,
              sz: 1,
              rx: 0,
              ry: 0,
              rz: 0,
              color: "#ffffff",
            },
          ],
        },
        {
          kind: "whale",
          label: "Whale",
          color: "#445566",
          size: 4,
          count: 1,
          shape: "blob",
          model_key: "",
          search_terms: "",
          motion: "fall",
          parts: [],
        },
      ],
      crowd: "gather",
      responders: [],
      followups: [],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.spectacle.actors[0].model_key).toBe("walkie-talkie-radio");
    const tea = r.data.spectacle.actors[0];
    expect(tea.search_terms).toBe("walkie talkie");
    expect(tea.recipe?.motion).toBe("fall");
    expect(tea.recipe?.parts).toHaveLength(3);
    expect(tea.recipe?.parts[2].shape).toBe("box");
    expect(tea.recipe?.parts[1]).toMatchObject({ x: 2, rz: 360 });
    expect(tea.recipe?.parts[1].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(r.data.spectacle.actors[1].model_key).toBeUndefined();
  });

  test("schema sent to Claude stays small", async () => {
    const { claudeOutputJsonSchema } = await import("./schema");
    const json = JSON.stringify(claudeOutputJsonSchema);
    expect(json.length).toBeLessThan(5200);
    expect((json.match(/"enum"/g) ?? []).length).toBeLessThanOrEqual(3);
  });
});
