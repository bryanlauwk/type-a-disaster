/**
 * The shared library of Claude-designed actors (optional).
 *
 * When Claude casts something the built-in library can't show, it names a
 * model_key, gives search_terms for a ready-made model, and designs a recipe
 * of primitives as a stand-in. With Supabase configured, the first recipe for
 * each key is kept, so every visitor sees the same giant walkie-talkie, and Claude is
 * shown the saved keys so it reuses them.
 *
 * Ready-made models are found separately, in the browser, from the static
 * Objaverse index (see modelSearch.ts); that needs no key and no server.
 *
 * Optional secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * LIBRARY_PER_VISITOR_CAP. Without them, recipes still work per event.
 */
import { recipe as recipeSchema } from "./schema";
import type { Actor, Recipe } from "./types";
import { serverEnv } from "../serverEnv.server";

const TABLE = "actor_library";

interface Row {
  key: string;
  name: string;
  recipe: Recipe | null;
  requested_by: string | null;
  uses: number;
  created_at: string;
}

function supabase() {
  const url = serverEnv("SUPABASE_URL")?.replace(/\/+$/, "");
  const service = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  return url && service ? { url, service } : null;
}
type Sb = NonNullable<ReturnType<typeof supabase>>;

const perVisitorCap = () => Number(serverEnv("LIBRARY_PER_VISITOR_CAP")) || 10;

// ---------------------------------------------------------------------------
// Supabase (PostgREST over plain fetch)
// ---------------------------------------------------------------------------

function sbHeaders(c: Sb, extra: Record<string, string> = {}) {
  return { apikey: c.service, Authorization: `Bearer ${c.service}`, ...extra };
}

async function getRow(c: Sb, key: string): Promise<Row | null> {
  const res = await fetch(`${c.url}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(key)}&select=*`, {
    headers: sbHeaders(c),
  });
  if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
  const rows = (await res.json()) as Row[];
  return rows[0] ?? null;
}

async function bumpUses(c: Sb, row: Row) {
  await fetch(`${c.url}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(row.key)}`, {
    method: "PATCH",
    headers: sbHeaders(c, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ uses: row.uses + 1 }),
  });
}

let indexCache: { at: number; entries: { key: string; name: string }[] } | null = null;

async function insertRow(c: Sb, row: Partial<Row>) {
  const res = await fetch(`${c.url}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: sbHeaders(c, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  // 409: someone saved this key a moment ago — theirs wins, which is fine.
  if (!res.ok && res.status !== 409) throw new Error(`Supabase insert failed: ${res.status}`);
  indexCache = null;
}

async function countToday(c: Sb, requestedBy: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const res = await fetch(
    `${c.url}/rest/v1/${TABLE}?select=key&created_at=gte.${encodeURIComponent(since.toISOString())}&requested_by=eq.${encodeURIComponent(requestedBy)}`,
    { method: "HEAD", headers: sbHeaders(c, { Prefer: "count=exact", Range: "0-0" }) },
  );
  return Number((res.headers.get("content-range") ?? "").split("/")[1]) || 0;
}

/** Existing keys, so Claude can reuse them instead of inventing duplicates. */
export async function libraryIndex(): Promise<{ key: string; name: string }[]> {
  const c = supabase();
  if (!c) return [];
  if (indexCache && Date.now() - indexCache.at < 60_000) return indexCache.entries;
  try {
    const res = await fetch(`${c.url}/rest/v1/${TABLE}?select=key,name&order=uses.desc&limit=80`, {
      headers: sbHeaders(c),
    });
    const entries = res.ok ? ((await res.json()) as { key: string; name: string }[]) : [];
    indexCache = { at: Date.now(), entries };
    return entries;
  } catch {
    return [];
  }
}

async function hashVisitor(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`type-a-disaster:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Gives every custom actor its shared recipe (or saves Claude's new one for
 * everyone). An actor with neither a recipe nor search terms falls back to
 * its built-in stand-in.
 */
export async function resolveCustomActors(actors: Actor[], ip: string): Promise<Actor[]> {
  const sb = supabase();
  let canSave: Promise<boolean> | null = null;
  const allowed = async () => {
    if (!sb) return false;
    canSave ??= hashVisitor(ip).then(async (v) => (await countToday(sb, v)) < perVisitorCap());
    return canSave;
  };
  const out: Actor[] = [];
  for (const actor of actors) {
    const key = actor.model_key;
    if (!key) {
      out.push(actor);
      continue;
    }
    try {
      const row = sb ? await getRow(sb, key) : null;
      const saved = row && recipeSchema.safeParse(row.recipe);
      if (row && saved?.success && saved.data.parts.length) {
        if (sb) await bumpUses(sb, row);
        out.push({ ...actor, recipe: saved.data });
        continue;
      }
      if (actor.recipe?.parts.length && sb && (await allowed())) {
        await insertRow(sb, {
          key,
          name: actor.label || key,
          recipe: actor.recipe,
          requested_by: await hashVisitor(ip),
        });
        out.push({ ...actor, fresh: true });
        continue;
      }
    } catch (error) {
      console.error("Actor library lookup failed", error);
    }
    out.push(
      actor.recipe?.parts.length || actor.search_terms ? actor : { ...actor, model_key: undefined },
    );
  }
  return out;
}
