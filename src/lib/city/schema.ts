import { z } from "zod";
import {
  ACTOR_KINDS,
  ACTOR_SHAPES,
  BUILD_KINDS,
  CROWD_REACTIONS,
  LANDMARK_SHAPES,
  RECIPE_MOTIONS,
  RECIPE_SHAPES,
  RESPONDERS,
  TILE_OPS,
  TILE_TARGETS,
  type EventResult,
  type Spectacle,
} from "./types";

const clampNum = (lo: number, hi: number) =>
  z.number().transform((v) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0));
const text = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

const statDeltas = z.object({
  population: clampNum(-2_000_000, 2_000_000),
  happiness: clampNum(-60, 60),
  money: clampNum(-50_000_000, 50_000_000),
  pollution: clampNum(-60, 60),
  rift: clampNum(-60, 60),
});

const landmark = z.object({
  name: text(40),
  shape: z.enum(LANDMARK_SHAPES).catch("statue"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .catch("#c9a227"),
  height: clampNum(0.3, 4),
});

const hexColor = (fallback: string) =>
  z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .catch(fallback);

const tileOp = z.object({
  op: z.enum(TILE_OPS),
  target: z.enum(TILE_TARGETS).catch("random"),
  count: clampNum(1, 30),
  build_kind: z.enum(BUILD_KINDS).nullable().catch(null),
  landmark: landmark.nullable().catch(null),
});

const coord = (lo: number, hi: number) => clampNum(lo, hi).catch(0);

/** A Claude-designed model: up to 40 primitives, clamped to a sane box. */
export const recipe = z.object({
  motion: z.enum(RECIPE_MOTIONS).catch("fall"),
  parts: z
    .array(
      z.object({
        shape: z.enum(RECIPE_SHAPES).catch("box"),
        x: coord(-2, 2),
        y: coord(-0.5, 4),
        z: coord(-2, 2),
        sx: clampNum(0.02, 3).catch(0.2),
        sy: clampNum(0.02, 4).catch(0.2),
        sz: clampNum(0.02, 3).catch(0.2),
        rx: coord(-360, 360),
        ry: coord(-360, 360),
        rz: coord(-360, 360),
        color: hexColor("#999999"),
      }),
    )
    .transform((p) => p.slice(0, 40)),
});

const NO_SPECTACLE: Spectacle = { actors: [], crowd: "ignore", responders: [] };

const spectacle = z
  .object({
    actors: z
      .array(
        z.object({
          kind: z.enum(ACTOR_KINDS),
          label: text(40),
          color: hexColor("#888888"),
          size: clampNum(1, 8),
          count: clampNum(1, 60),
          shape: z.enum(ACTOR_SHAPES).catch("blob"),
          model_key: z
            .string()
            .transform((v) =>
              v
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 48),
            )
            .optional()
            .catch(undefined),
          search_terms: text(60).optional().catch(undefined),
          recipe: recipe.optional().catch(undefined),
          // Only the Objaverse mirror: share links are untrusted input.
          model_url: z
            .string()
            .regex(/^https:\/\/huggingface\.co\/datasets\/allenai\/objaverse\/resolve\//)
            .max(300)
            .optional()
            .catch(undefined),
          attribution: text(200).optional().catch(undefined),
          attribution_url: z
            .string()
            .regex(/^https:\/\/sketchfab\.com\//)
            .max(300)
            .optional()
            .catch(undefined),
          fresh: z.boolean().optional().catch(undefined),
        }),
      )
      .transform((a) => a.slice(0, 3)),
    crowd: z.enum(CROWD_REACTIONS).catch("ignore"),
    responders: z
      .array(z.enum(RESPONDERS))
      .transform((r) => [...new Set(r)].slice(0, 3))
      .catch([]),
  })
  .catch(NO_SPECTACLE);

/**
 * Validates (and clamps) an event result, whether it came from Claude or
 * from a share link someone pasted.
 */
export const eventResultSchema = z.object({
  scale: z.enum(["minor", "citywide", "apocalyptic"]).catch("minor"),
  headline: text(140),
  subhead: text(240),
  quotes: z
    .array(z.object({ name: text(40), role: text(60), text: text(240) }))
    .transform((q) => q.slice(0, 3)),
  stat_changes: statDeltas,
  tile_ops: z.array(tileOp).transform((ops) => ops.slice(0, 6)),
  ongoing: z
    .object({ label: text(60), duration_days: clampNum(1, 30), per_day: statDeltas })
    .nullable()
    .catch(null),
  spectacle: spectacle.default(NO_SPECTACLE),
  followups: z
    .array(
      z.object({
        delay_days: clampNum(1, 10),
        note: text(160),
        stat_changes: statDeltas,
        tile_ops: z.array(tileOp).transform((ops) => ops.slice(0, 4)),
      }),
    )
    .transform((f) => f.slice(0, 3))
    .catch([])
    .default([]),
}) satisfies z.ZodType<EventResult, z.ZodTypeDef, unknown>;

// ---------------------------------------------------------------------------
// What Claude fills in. Kept deliberately flat and enum-light: structured
// outputs compile the schema into a grammar with a size limit, so most choices
// are plain strings (the prompt lists the allowed values) and fromClaude()
// maps anything unexpected to a safe default.
// ---------------------------------------------------------------------------

const statsJson = {
  type: "object",
  properties: {
    population: { type: "integer" },
    happiness: { type: "integer" },
    money: { type: "integer" },
    pollution: { type: "integer" },
    rift: { type: "integer" },
  },
  required: ["population", "happiness", "money", "pollution", "rift"],
  additionalProperties: false,
} as const;

const opJson = {
  type: "object",
  properties: {
    op: { type: "string", enum: [...TILE_OPS] },
    target: { type: "string" },
    count: { type: "integer" },
    build: { type: "string" },
    landmark_name: { type: "string" },
    landmark_shape: { type: "string" },
    landmark_color: { type: "string" },
    landmark_height: { type: "number" },
  },
  required: [
    "op",
    "target",
    "count",
    "build",
    "landmark_name",
    "landmark_shape",
    "landmark_color",
    "landmark_height",
  ],
  additionalProperties: false,
} as const;

const followupOpJson = {
  type: "object",
  properties: {
    op: { type: "string", enum: [...TILE_OPS] },
    target: { type: "string" },
    count: { type: "integer" },
    build: { type: "string" },
  },
  required: ["op", "target", "count", "build"],
  additionalProperties: false,
} as const;

/** JSON Schema handed to Claude's structured outputs. */
export const claudeOutputJsonSchema = {
  type: "object",
  properties: {
    scale: { type: "string", enum: ["minor", "citywide", "apocalyptic"] },
    headline: { type: "string" },
    subhead: { type: "string" },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          text: { type: "string" },
        },
        required: ["name", "role", "text"],
        additionalProperties: false,
      },
    },
    stats: statsJson,
    tile_ops: { type: "array", items: opJson },
    ongoing_label: { type: "string" },
    ongoing_days: { type: "integer" },
    ongoing_per_day: statsJson,
    actors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          label: { type: "string" },
          color: { type: "string" },
          size: { type: "integer" },
          count: { type: "integer" },
          shape: { type: "string" },
          model_key: { type: "string" },
          search_terms: { type: "string" },
          motion: { type: "string" },
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                shape: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                z: { type: "number" },
                sx: { type: "number" },
                sy: { type: "number" },
                sz: { type: "number" },
                rx: { type: "number" },
                ry: { type: "number" },
                rz: { type: "number" },
                color: { type: "string" },
              },
              required: ["shape", "x", "y", "z", "sx", "sy", "sz", "rx", "ry", "rz", "color"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "kind",
          "label",
          "color",
          "size",
          "count",
          "shape",
          "model_key",
          "search_terms",
          "motion",
          "parts",
        ],
        additionalProperties: false,
      },
    },
    crowd: { type: "string" },
    responders: { type: "array", items: { type: "string" } },
    followups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          delay_days: { type: "integer" },
          note: { type: "string" },
          stats: statsJson,
          tile_ops: { type: "array", items: followupOpJson },
        },
        required: ["delay_days", "note", "stats", "tile_ops"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "scale",
    "headline",
    "subhead",
    "quotes",
    "stats",
    "tile_ops",
    "ongoing_label",
    "ongoing_days",
    "ongoing_per_day",
    "actors",
    "crowd",
    "responders",
    "followups",
  ],
  additionalProperties: false,
} as const;

/** A plain-text description of the same shape, for requests without structured outputs. */
export const CLAUDE_OUTPUT_EXAMPLE = `{"scale":"minor|citywide|apocalyptic","headline":"","subhead":"","quotes":[{"name":"","role":"","text":""}],"stats":{"population":0,"happiness":0,"money":0,"pollution":0,"rift":0},"tile_ops":[{"op":"destroy|burn|flood|build|landmark|clear","target":"","count":1,"build":"","landmark_name":"","landmark_shape":"","landmark_color":"#rrggbb","landmark_height":1}],"ongoing_label":"","ongoing_days":0,"ongoing_per_day":{"population":0,"happiness":0,"money":0,"pollution":0,"rift":0},"actors":[{"kind":"","label":"","color":"#rrggbb","size":1,"count":1,"shape":"","model_key":"","search_terms":"","motion":"fall|walk|hover|spin","parts":[{"shape":"box|sphere|cylinder|cone|torus|capsule","x":0,"y":0.5,"z":0,"sx":1,"sy":1,"sz":1,"rx":0,"ry":0,"rz":0,"color":"#rrggbb"}]}],"crowd":"flee|gather|celebrate|ignore","responders":[""],"followups":[{"delay_days":1,"note":"","stats":{"population":0,"happiness":0,"money":0,"pollution":0,"rift":0},"tile_ops":[{"op":"build","target":"","count":1,"build":""}]}]}`;

const norm = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => {
  const n = norm(v);
  return (list as readonly string[]).includes(n) ? (n as T) : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const statsFrom = (v: unknown) => {
  const o = obj(v);
  const n = (k: string) => (Number.isFinite(Number(o[k])) ? Number(o[k]) : 0);
  return {
    population: n("population"),
    happiness: n("happiness"),
    money: n("money"),
    pollution: n("pollution"),
    rift: n("rift"),
  };
};

function opFromClaude(raw: unknown) {
  const o = obj(raw);
  const op = oneOf(TILE_OPS, o.op);
  if (!op) return null;
  const hasLandmark = op === "landmark";
  return {
    op,
    target: oneOf(TILE_TARGETS, o.target) ?? "random",
    count: Number(o.count) || 1,
    build_kind: oneOf(BUILD_KINDS, o.build),
    landmark: hasLandmark
      ? {
          name: o.landmark_name || "Monument",
          shape: oneOf(LANDMARK_SHAPES, o.landmark_shape) ?? "statue",
          color: o.landmark_color,
          height: typeof o.landmark_height === "number" ? o.landmark_height : 1.5,
        }
      : null,
  };
}

/** Converts Claude's flat output into a validated, clamped EventResult. */
export function fromClaude(raw: unknown) {
  const o = obj(raw);
  const ongoingDays = Number(o.ongoing_days) || 0;
  return eventResultSchema.safeParse({
    scale: o.scale,
    headline: o.headline ?? "",
    subhead: o.subhead ?? "",
    quotes: arr(o.quotes),
    stat_changes: statsFrom(o.stats),
    tile_ops: arr(o.tile_ops).map(opFromClaude).filter(Boolean),
    ongoing:
      ongoingDays > 0 && o.ongoing_label
        ? {
            label: o.ongoing_label,
            duration_days: ongoingDays,
            per_day: statsFrom(o.ongoing_per_day),
          }
        : null,
    spectacle: {
      actors: arr(o.actors)
        .map((a) => {
          const x = obj(a);
          const kind = oneOf(ACTOR_KINDS, x.kind);
          return kind
            ? {
                kind,
                label: x.label ?? "",
                color: x.color,
                size: Number(x.size) || 3,
                count: Number(x.count) || 1,
                shape: oneOf(ACTOR_SHAPES, x.shape) ?? "blob",
                ...(x.model_key
                  ? {
                      model_key: String(x.model_key),
                      ...(x.search_terms ? { search_terms: String(x.search_terms) } : {}),
                      ...(arr(x.parts).length
                        ? {
                            recipe: {
                              motion: oneOf(RECIPE_MOTIONS, x.motion) ?? "fall",
                              parts: arr(x.parts).map((part) => {
                                const q = obj(part);
                                return { ...q, shape: oneOf(RECIPE_SHAPES, q.shape) ?? "box" };
                              }),
                            },
                          }
                        : {}),
                    }
                  : {}),
              }
            : null;
        })
        .filter(Boolean),
      crowd: oneOf(CROWD_REACTIONS, o.crowd) ?? "ignore",
      responders: arr(o.responders)
        .map((r) => oneOf(RESPONDERS, r))
        .filter(Boolean),
    },
    followups: arr(o.followups).map((f) => {
      const x = obj(f);
      return {
        delay_days: Number(x.delay_days) || 1,
        note: x.note ?? "",
        stat_changes: statsFrom(x.stats),
        tile_ops: arr(x.tile_ops).map(opFromClaude).filter(Boolean),
      };
    }),
  });
}

/** Compact city snapshot sent to the server with each event. */
export const citySummarySchema = z.object({
  name: z.string().max(60),
  day: z.number().int().min(0).max(100000),
  stats: z.object({
    population: z.number(),
    happiness: z.number(),
    money: z.number(),
    pollution: z.number(),
    rift: z.number(),
  }),
  tiles: z.record(z.string(), z.number()),
  nature: z.number().min(0).max(100),
  districts: z.record(z.string(), z.number()),
  hazards: z.object({
    burning: z.number().int().min(0),
    flooded: z.number().int().min(0),
    rubble: z.number().int().min(0),
  }),
  ongoingEffects: z
    .array(z.object({ label: z.string().max(60), daysLeft: z.number().int().min(0).max(30) }))
    .max(8),
  scheduledUpdates: z
    .array(z.object({ daysUntil: z.number().int().min(0).max(10), note: z.string().max(160) }))
    .max(6),
  recentHeadlines: z.array(z.string().max(160)).max(5),
});
export type CitySummary = z.infer<typeof citySummarySchema>;

export const simulateInputSchema = z.object({
  event: z.string().trim().min(3).max(200),
  city: citySummarySchema,
  /** The event is a stock disaster whose spectacle is already choreographed. */
  staged: z.boolean().optional(),
});
export type SimulateInput = z.infer<typeof simulateInputSchema>;
