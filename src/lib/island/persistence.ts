import { z } from "zod";
import { replay } from "./sim";
import { FOCI, POWERS, SIZE, SPECIES, TRAITS, type Chronicle, type WorldState } from "./types";

// v2: the island doubled in size (128×128); older saves start afresh.
const ISLAND_KEY = "primordia:island:v2";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the island just isn't kept */
  }
}

const actionSchema = z.object({
  day: z.number().int().min(0),
  power: z.enum(POWERS),
  tile: z
    .number()
    .int()
    .min(0)
    .max(SIZE * SIZE - 1),
  species: z.enum(SPECIES).optional(),
  trait: z.enum(TRAITS).optional(),
  focus: z.enum(FOCI).optional(),
});

const chronicleSchema = z.object({
  day: z.number().int().min(0),
  title: z.string().max(120),
  lines: z.array(z.string().max(300)).max(6),
  voices: z
    .array(
      z.object({ name: z.string().max(40), role: z.string().max(60), text: z.string().max(240) }),
    )
    .max(3),
  glyph: z.string().max(16),
  told: z.boolean(),
});

const savedSchema = z.object({
  v: z.literal(2),
  seed: z.number().int(),
  day: z.number().int().min(0).max(100000),
  actions: z.array(actionSchema).max(1000),
  chronicle: z.array(chronicleSchema).max(300),
});
type Saved = z.input<typeof savedSchema>;

function toSaved(s: WorldState): Saved {
  return {
    v: 2,
    seed: s.seed,
    day: s.day,
    // Effects are recomputed on replay; only what the god chose is kept.
    actions: s.actions.map(({ impact: _i, ...a }) => a),
    chronicle: s.chronicle.slice(-300) as Chronicle[],
  };
}

function fromSaved(data: unknown): WorldState {
  const p = savedSchema.parse(data);
  return replay(p.seed, p.actions, p.chronicle, p.day);
}

/**
 * Saves the island: the replayable history, plus a snapshot so a long-lived
 * island opens instantly instead of replaying every day since it began.
 */
export function saveIsland(s: WorldState) {
  const { actions: _a, ...rest } = s;
  write(ISLAND_KEY, JSON.stringify({ saved: toSaved(s), snapshot: rest }));
}

export function loadIsland(): WorldState | null {
  const raw = read(ISLAND_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { saved: unknown; snapshot?: Omit<WorldState, "actions"> };
    const saved = savedSchema.parse(data.saved);
    const snap = data.snapshot;
    if (
      snap &&
      snap.version === 2 &&
      snap.seed === saved.seed &&
      snap.day === saved.day &&
      Array.isArray(snap.tiles)
    )
      return { ...snap, actions: saved.actions } as WorldState;
    return fromSaved(saved);
  } catch {
    return null;
  }
}

export function clearIsland() {
  write(ISLAND_KEY, null);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A share code: the seed and everything the god did, deflated into the URL. */
export async function encodeShare(s: WorldState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toSaved(s)));
  return toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

export async function decodeShare(code: string): Promise<WorldState> {
  const bytes = await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw"));
  return fromSaved(JSON.parse(new TextDecoder().decode(bytes)));
}

export { toSaved, fromSaved };
