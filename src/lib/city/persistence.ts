import { z } from "zod";
import { eventResultSchema } from "./schema";
import { replay } from "./simulation";
import type { CityState, EventRecord } from "./types";

const CITY_KEY = "type-a-disaster:maple-hollow";
const CREDITS_KEY = "type-a-disaster:credits";

export const MAX_CREDITS = 5;
export const REFILL_MS = 10 * 60 * 1000;

// Browser storage can throw (private mode, blocked site data) — never let
// that break the game.
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
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export function loadCity(): CityState | null {
  const raw = read(CITY_KEY);
  if (!raw) return null;
  try {
    return fromShared(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * The event log without custom model data: spectacles aren't replayed, so
 * recipes and model links would only bloat saves and share links. Credits stay.
 */
function lean(log: EventRecord[]): EventRecord[] {
  // Impacts are recomputed on replay.
  return log.map(({ impact: _i, ...e }) => ({
    ...e,
    result: {
      ...e.result,
      spectacle: {
        ...e.result.spectacle,
        actors: e.result.spectacle.actors.map(
          ({ recipe: _r, model_url: _u, search_terms: _s, fresh: _f, ...a }) => a,
        ),
      },
    },
  }));
}

/** Only the seed + event log are stored; the city is rebuilt by replay. */
export function saveCity(s: CityState) {
  write(CITY_KEY, JSON.stringify({ v: 4, seed: s.seed, day: s.day, log: lean(s.log) }));
}

export function clearCity() {
  write(CITY_KEY, null);
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export interface Credits {
  credits: number;
  /** Timestamp the refill clock last advanced. */
  since: number;
}

export function currentCredits(c: Credits, now = Date.now()): Credits {
  if (c.credits >= MAX_CREDITS) return { credits: MAX_CREDITS, since: now };
  const earned = Math.floor((now - c.since) / REFILL_MS);
  if (earned <= 0) return c;
  const credits = Math.min(MAX_CREDITS, c.credits + earned);
  return { credits, since: credits >= MAX_CREDITS ? now : c.since + earned * REFILL_MS };
}

export function loadCredits(): Credits {
  try {
    const c = JSON.parse(read(CREDITS_KEY) ?? "null") as Credits | null;
    if (c && Number.isFinite(c.credits) && Number.isFinite(c.since)) return currentCredits(c);
  } catch {
    /* fall through */
  }
  return { credits: MAX_CREDITS, since: Date.now() };
}

export function saveCredits(c: Credits) {
  write(CREDITS_KEY, JSON.stringify(c));
}

export function spendCredits(c: Credits, amount: number): Credits {
  const now = currentCredits(c);
  const credits = Math.max(0, now.credits - amount);
  // Start the refill clock when dropping below the cap.
  return { credits, since: now.credits >= MAX_CREDITS ? Date.now() : now.since };
}

// ---------------------------------------------------------------------------
// Share links: deflated JSON of seed + event log, in the URL hash.
// ---------------------------------------------------------------------------

const sharedSchema = z.object({
  // Earlier versions used different maps and can't be replayed on this one.
  v: z.literal(4),
  seed: z.number().int(),
  day: z.number().int().min(0).max(100000),
  log: z
    .array(
      z.object({
        day: z.number().int().min(0),
        input: z.string().max(200),
        result: eventResultSchema,
        // Newer events get impact physics; older ones replay as they were.
        physics: z.union([z.literal(1), z.literal(2)]).optional(),
      }),
    )
    .max(200),
});
type Shared = z.input<typeof sharedSchema>;

function fromShared(data: unknown): CityState {
  const parsed = sharedSchema.parse(data);
  return replay(parsed.seed, parsed.log, parsed.day);
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

export async function encodeShare(s: CityState): Promise<string> {
  const payload: Shared = { v: 4, seed: s.seed, day: s.day, log: lean(s.log) };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

export async function decodeShare(code: string): Promise<CityState> {
  const bytes = await pipe(fromBase64Url(code), new DecompressionStream("deflate-raw"));
  return fromShared(JSON.parse(new TextDecoder().decode(bytes)));
}
