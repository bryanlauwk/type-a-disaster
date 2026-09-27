import { createServerFn } from "@tanstack/react-start";
import { simulateInputSchema } from "./schema";
import type { EventResult } from "./types";

export type SimulateResponse =
  | { ok: true; result: EventResult; refused: boolean }
  | { ok: false; error: string };

// Best-effort per-IP throttle. Worker isolates don't share memory, so this is a
// speed bump rather than a guarantee; the Anthropic console spend limit is the
// real safety net.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

function throttled(ip: string, bucket = hits, max = MAX_PER_WINDOW): boolean {
  const now = Date.now();
  const recent = (bucket.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  bucket.set(ip, recent);
  if (bucket.size > 5000) bucket.clear();
  return recent.length > max;
}

async function requestIp() {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  return getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "local";
}

export const simulateEvent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => simulateInputSchema.parse(data))
  .handler(async ({ data }): Promise<SimulateResponse> => {
    const ip = await requestIp();
    if (throttled(ip))
      return { ok: false, error: "Slow down, the presses are still warm. Try again in a minute." };

    const { runNewsroom, NewsroomError } = await import("./newsroom.server");
    try {
      const { libraryIndex, resolveCustomActors } = await import("./actorLibrary.server");
      // Stock disasters bring their own actors: skip the shared model library.
      const { result, refused } = await runNewsroom(data, data.staged ? [] : await libraryIndex());
      // Custom actors get their shared recipe, or save Claude's new one (optional Supabase).
      if (!data.staged)
        result.spectacle.actors = await resolveCustomActors(result.spectacle.actors, ip);
      return { ok: true, result, refused };
    } catch (error) {
      if (error instanceof NewsroomError) return { ok: false, error: error.message };
      console.error(error);
      return { ok: false, error: "Something went wrong in the newsroom." };
    }
  });
