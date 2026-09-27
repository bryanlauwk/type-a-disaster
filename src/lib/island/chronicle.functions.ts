import { createServerFn } from "@tanstack/react-start";
import { chronicleInputSchema } from "./chronicle.schema";
import type { ChronicleOutput } from "./chronicle.server";

export type ChronicleResponse = { ok: true; entry: ChronicleOutput } | { ok: false; error: string };

// Best-effort per-IP throttle; the Anthropic console spend limit is the real safety net.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

export const tellStory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chronicleInputSchema.parse(data))
  .handler(async ({ data }): Promise<ChronicleResponse> => {
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip =
      getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "local";
    if (throttled(ip)) return { ok: false, error: "The storyteller needs to catch their breath." };
    const { tellChronicle, ChronicleError } = await import("./chronicle.server");
    try {
      return { ok: true, entry: await tellChronicle(data) };
    } catch (error) {
      if (error instanceof ChronicleError) return { ok: false, error: error.message };
      console.error(error);
      return { ok: false, error: "The storyteller lost the thread." };
    }
  });
