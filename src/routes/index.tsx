import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  FastForward,
  FlipVertical2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Send,
  Share2,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Newspaper } from "@/components/city/Newspaper";
import {
  MAX_CREDITS,
  REFILL_MS,
  clearCity,
  currentCredits,
  decodeShare,
  encodeShare,
  loadCity,
  loadCredits,
  saveCity,
  saveCredits,
  spendCredits,
  type Credits,
} from "@/lib/city/persistence";
import {
  applyEvent,
  changedTiles,
  countKinds,
  createCity,
  natureScore,
  tick,
} from "@/lib/city/simulation";
import { districtAt, DISTRICTS } from "@/lib/city/hollow";
import type { SimClock, SpectacleRun } from "@/components/city/CityScene";
import { hourOf } from "@/components/city/scene/common";
import { withRealModels } from "@/components/city/scene/realModels";
import { simulateEvent } from "@/lib/city/simulate.functions";
import { applyModels, findModel, warmModelIndex, type FoundModel } from "@/lib/city/modelSearch";
import {
  GRID_SIZE,
  SCALE_COST,
  type Actor,
  type CityState,
  type EventResult,
} from "@/lib/city/types";
import { cn } from "@/lib/utils";

const CityScene = lazy(() => import("@/components/city/CityScene"));

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Type-a-Disaster: Maple Hollow" },
      {
        name: "description",
        content:
          "Maple Hollow, 1985: a sleepy small town with something underneath. Type what happens to it, watch it unfold, flip to the Upside Down, and read the Courier's straight-faced report.",
      },
    ],
  }),
});

const DAY_MS = 12000;
const SUGGESTIONS = [
  { tag: "A strange sign", text: "The Christmas lights on Elm Street blink out a name" },
  {
    tag: "A close call",
    text: "Kids on bikes follow a trail of glowing footprints into Blackpine Woods",
  },
  { tag: "A town mystery", text: "Every clock in Maple Hollow stops at 8:15" },
  { tag: "A big arrival", text: "A giant waffle lands on Dot's Diner during the lunch rush" },
];
const C = (GRID_SIZE - 1) / 2;

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  return Math.round(n).toLocaleString();
};

/** Where on the map an event lands, in world coordinates. */
function eventFocus(before: CityState, after: CityState, result: EventResult) {
  const tiles = changedTiles(before, after);
  if (!tiles.length) {
    // Nothing on the map changed: play it out on the street nearest the
    // targeted district (or the middle of town), where it can be seen.
    const target = result.tile_ops[0]?.target;
    const d = DISTRICTS.find((dd) => dd.id === target);
    const [cx, cy] = d ? [(d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2] : [C, C];
    let best = -1;
    after.grid.forEach((t, i) => {
      if (t.kind !== "road") return;
      const dist = Math.hypot((i % GRID_SIZE) - cx, Math.floor(i / GRID_SIZE) - cy);
      if (best < 0 || dist < Math.hypot((best % GRID_SIZE) - cx, Math.floor(best / GRID_SIZE) - cy))
        best = i;
    });
    if (best < 0) return { x: cx - C, z: cy - C, radius: 2.5 };
    return { x: (best % GRID_SIZE) - C, z: Math.floor(best / GRID_SIZE) - C, radius: 2.5 };
  }
  // Centre on the biggest cluster: the mean, then the changed tile nearest it.
  let mx = 0;
  let mz = 0;
  for (const i of tiles) {
    mx += (i % GRID_SIZE) - C;
    mz += Math.floor(i / GRID_SIZE) - C;
  }
  mx /= tiles.length;
  mz /= tiles.length;
  const near = tiles
    .map((i) => ({ x: (i % GRID_SIZE) - C, z: Math.floor(i / GRID_SIZE) - C }))
    .sort((p, q) => Math.hypot(p.x - mx, p.z - mz) - Math.hypot(q.x - mx, q.z - mz));
  const core = near.slice(0, Math.max(1, Math.ceil(near.length / 2)));
  const x = core.reduce((acc, p) => acc + p.x, 0) / core.length;
  const z = core.reduce((acc, p) => acc + p.z, 0) / core.length;
  const spread = Math.max(...core.map((p) => Math.hypot(p.x - x, p.z - z)));
  return { x, z, radius: Math.min(6, Math.max(1.5, spread + 1)) };
}

function GameClock({ clock }: { clock: SimClock }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  const phase = clock.paused
    ? null
    : Math.min(1, Math.max(0, (performance.now() - clock.tickAt) / clock.dayMs));
  if (phase === null) return <span>paused</span>;
  const h = hourOf(phase);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 6) * 10;
  return (
    <span>
      {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
    </span>
  );
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div className="border border-ink/25 bg-paper/85 px-2 py-1 backdrop-blur-sm">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          tone === "bad" && "text-stamp",
          tone === "good" && "text-leaf",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Index() {
  const [city, setCity] = useState<CityState | null>(null);
  const [shared, setShared] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fast, setFast] = useState(false);
  const [labels, setLabels] = useState(true);
  // Looking at the Upside Down instead of the town.
  const [upsideDown, setUpsideDown] = useState(false);
  const [credits, setCredits] = useState<Credits>({ credits: MAX_CREDITS, since: 0 });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyFor, setBusyFor] = useState(0);
  const [run, setRun] = useState<SpectacleRun | null>(null);
  const [holding, setHolding] = useState(false);
  const [tickAt, setTickAt] = useState(() => performance.now());
  const [tremor, setTremor] = useState(0);
  const cityRef = useRef<CityState | null>(null);
  cityRef.current = city;
  const tickAtRef = useRef(tickAt);
  // The day starts (and resumes) from here: a morning city, not a dark one.
  const pausedPhase = useRef<number | null>(0.1);
  const pending = useRef<{ id: number; next: CityState } | null>(null);
  const runId = useRef(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dismissedCollapse, setDismissedCollapse] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Load a shared city from the URL hash, else the saved city, else a fresh one.
  useEffect(() => {
    setCredits(loadCredits());
    const hash = window.location.hash;
    if (hash.startsWith("#c=")) {
      decodeShare(hash.slice(3))
        .then((c) => {
          setCity(c);
          setShared(true);
        })
        .catch(() => {
          toast.error("That share link is smudged beyond reading. Here's your own town instead.");
          setCity(loadCity() ?? createCity(newSeed()));
        });
    } else {
      setCity(loadCity() ?? createCity(newSeed()));
    }
  }, []);

  // Simulation clock. Each tick is one day; the scene reads the phase in
  // between to drive the sun. Time holds still while a spectacle lands.
  const loaded = city !== null;
  const collapsed = city?.collapsed ?? false;
  const running = loaded && !paused && !collapsed && !holding;
  const dayMs = fast ? DAY_MS / 4 : DAY_MS;
  useEffect(() => {
    if (!running) return;
    if (pausedPhase.current !== null) {
      tickAtRef.current = performance.now() - pausedPhase.current * dayMs;
      setTickAt(tickAtRef.current);
      pausedPhase.current = null;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const wait = Math.max(0, dayMs - (performance.now() - tickAtRef.current));
      timer = setTimeout(() => {
        tickAtRef.current = performance.now();
        setTickAt(tickAtRef.current);
        setCity((c) => (c ? tick(c) : c));
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      pausedPhase.current = Math.min(1, (performance.now() - tickAtRef.current) / dayMs);
    };
  }, [running, dayMs]);
  const clock: SimClock = { tickAt, dayMs, paused: !running };

  // Chain reactions arrive as bulletins; flash them as news alerts.
  const seenBulletins = useRef<number | null>(null);
  useEffect(() => {
    if (!city) return;
    const n = city.bulletins.length;
    if (seenBulletins.current !== null && n > seenBulletins.current) {
      for (const b of city.bulletins.slice(seenBulletins.current)) {
        toast(`Update · Day ${b.day}`, { description: b.text, duration: 8000 });
      }
      setTremor((t) => t + 1);
    }
    seenBulletins.current = n;
  }, [city]);

  const commit = useCallback((id: number) => {
    const p = pending.current;
    if (!p || p.id !== id) return;
    pending.current = null;
    setCity(p.next);
    setHolding(false);
  }, []);
  // A free model found after the spectacle started: swap it in, and credit
  // its author on the event's front page.
  const lateModels = useCallback((id: number, event: string, models: (FoundModel | null)[]) => {
    if (!models.some(Boolean)) return;
    setRun((r) => (r && r.id === id ? { ...r, actors: applyModels(r.actors, models) } : r));
    const credit = (s: CityState): CityState => {
      const last = s.log[s.log.length - 1];
      if (!last || last.input !== event) return s;
      const actors = applyModels(last.result.spectacle.actors, models);
      const result = { ...last.result, spectacle: { ...last.result.spectacle, actors } };
      return { ...s, log: [...s.log.slice(0, -1), { ...last, result }] };
    };
    const p = pending.current;
    if (p && p.id === id) p.next = credit(p.next);
    else setCity((c) => (c ? credit(c) : c));
  }, []);
  const endSpectacle = useCallback((id: number) => {
    setRun((r) => (r && r.id === id ? null : r));
  }, []);

  // Persist your own city. A shared one only becomes yours once you act on it.
  useEffect(() => {
    if (city && !shared) saveCity(city);
  }, [city, shared]);

  // Credit refill clock.
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setCredits((c) => currentCredits(c));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!busy) {
      setBusyFor(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setBusyFor(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const adoptShared = useCallback(() => {
    if (!shared) return;
    setShared(false);
    history.replaceState(null, "", window.location.pathname);
  }, [shared]);

  const submit = async (text: string) => {
    const event = text.trim();
    if (!city || busy || holding) return;
    if (event.length < 3) {
      promptRef.current?.focus();
      return;
    }
    const available = currentCredits(credits);
    if (available.credits < 1) {
      const mins = Math.ceil((available.since + REFILL_MS - Date.now()) / 60000);
      toast("Out of event credits", { description: `The presses reopen in about ${mins} min.` });
      return;
    }
    setBusy(true);
    // The free-model index is only needed for custom actors; fetch it while
    // the newsroom writes.
    warmModelIndex();
    try {
      const kinds = countKinds(city.grid);
      const districts: Record<string, number> = {};
      city.grid.forEach((t, i) => {
        if (t.kind === "house" || t.kind === "shop" || t.kind === "tower") {
          const id = districtAt(i).id;
          districts[id] = (districts[id] ?? 0) + 1;
        }
      });
      const hazards = city.grid.reduce(
        (totals, tile) => {
          if (tile.fire > 0) totals.burning++;
          if (tile.flood > 0) totals.flooded++;
          if (tile.kind === "rubble") totals.rubble++;
          return totals;
        },
        { burning: 0, flooded: 0, rubble: 0 },
      );
      const res = await simulateEvent({
        data: {
          event,
          city: {
            name: city.name,
            day: city.day,
            stats: city.stats,
            tiles: Object.fromEntries(Object.entries(kinds).filter(([, n]) => n > 0)),
            nature: natureScore(city.grid, city.stats.pollution),
            districts,
            hazards,
            ongoingEffects: city.ongoing
              .slice(-8)
              .map(({ label, daysLeft }) => ({ label, daysLeft })),
            scheduledUpdates: city.scheduled.slice(0, 6).map((update) => ({
              daysUntil: Math.max(0, update.day - city.day),
              note: update.note,
            })),
            recentHeadlines: city.log.slice(-5).map((e) => e.result.headline),
          },
        },
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 12000 });
        return;
      }
      const { result, refused } = res;
      // Free ready-made models for custom actors, looked up in the browser.
      // Wait briefly so a model can make the entrance; slower ones swap in.
      const lookups = Promise.all(
        result.spectacle.actors.map((a) =>
          a.search_terms && !a.model_url ? findModel(a.search_terms) : null,
        ),
      );
      const early = refused
        ? null
        : await Promise.race([lookups, new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
      if (early) result.spectacle.actors = applyModels(result.spectacle.actors, early);
      // Built-in actors are played by real, credited models where one exists.
      const phone =
        window.innerWidth < 640 ||
        !!(navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
      result.spectacle.actors = withRealModels(result.spectacle.actors, phone);
      adoptShared();
      setDismissedCollapse(false);
      setInput("");
      const before = cityRef.current;
      if (!before) return;
      const next = applyEvent(before, event, result);
      if (refused) {
        setCity(next);
        toast("No charge", { description: "The council refused to print that one." });
        return;
      }
      const spent = spendCredits(available, SCALE_COST[result.scale]);
      setCredits(spent);
      saveCredits(spent);
      // Hold time, play the spectacle, and apply the damage on impact.
      const id = ++runId.current;
      const focus = eventFocus(before, next, result);
      pending.current = { id, next };
      setHolding(true);
      setRun({
        id,
        actors: result.spectacle.actors,
        crowd: result.spectacle.crowd,
        responders: result.spectacle.responders,
        focus: { x: focus.x, z: focus.z },
        radius: focus.radius,
      });
      // If the 3D scene isn't running (e.g. no WebGL), don't wait for it.
      setTimeout(() => commit(id), 7000);
      if (!early) void lookups.then((models) => lateModels(id, event, models));
      for (const a of result.spectacle.actors)
        if (a.fresh)
          toast.success(`New in the Maple Hollow library: ${a.label || a.model_key}`, {
            description: "Designed on the spot by the newsroom, saved for everyone.",
            duration: 8000,
          });
    } catch (error) {
      console.error(error);
      toast.error("Couldn't reach the newsroom. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!city) return;
    const url = `${window.location.origin}/#c=${await encodeShare(city)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `The ${city.name} Courier`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied", {
          description: "Anyone with it can replay your town's history.",
        });
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const newCity = () => {
    clearCity();
    setShared(false);
    history.replaceState(null, "", window.location.pathname);
    setCity(createCity(newSeed()));
    setDismissedCollapse(false);
  };

  const c = currentCredits(credits, now);
  const nextIn = Math.max(1, Math.ceil((c.since + REFILL_MS - now) / 60000));
  const st = city?.stats;

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink lg:flex-row">
      <Toaster position="top-center" />
      <main className="relative min-h-[56dvh] flex-1 overflow-hidden lg:min-h-0">
        <div className="absolute inset-0">
          <ClientOnly fallback={<SceneFallback />}>
            <Suspense fallback={<SceneFallback />}>
              {city ? (
                <CityScene
                  city={city}
                  clock={clock}
                  spectacle={run}
                  onImpact={commit}
                  onSpectacleDone={endSpectacle}
                  tremor={tremor}
                  showLabels={labels}
                  upsideDown={upsideDown}
                />
              ) : (
                <SceneFallback />
              )}
            </Suspense>
          </ClientOnly>
        </div>

        {/* Masthead + stats */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto border-2 border-ink bg-paper/90 px-3 py-1.5 backdrop-blur-sm">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              Type-a-Disaster
            </p>
            <h1 className="font-serif-d text-lg font-black leading-tight">
              {city?.name ?? "Loading…"}
            </h1>
            <p className="font-mono text-[10px] text-muted-foreground">
              Day {city?.day ?? 0} · <GameClock clock={clock} />
            </p>
            {upsideDown && (
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.25em] text-stamp">
                The Upside Down
              </p>
            )}
          </div>
          {st && (
            <div className="pointer-events-auto grid grid-cols-3 gap-1 sm:grid-cols-6">
              <Stat label="Pop." value={compact(st.population)} />
              <Stat
                label="Mood"
                value={`${Math.round(st.happiness)}`}
                tone={st.happiness < 35 ? "bad" : st.happiness > 65 ? "good" : undefined}
              />
              <Stat
                label="Budget"
                value={`$${compact(st.money)}`}
                tone={st.money < 0 ? "bad" : undefined}
              />
              <Stat
                label="Smog"
                value={`${Math.round(st.pollution)}`}
                tone={st.pollution > 60 ? "bad" : undefined}
              />
              <Stat
                label="Nature"
                value={`${natureScore(city!.grid, st.pollution)}`}
                tone={natureScore(city!.grid, st.pollution) < 25 ? "bad" : undefined}
              />
              <Stat
                label="Rift"
                value={`${Math.round(st.rift)}`}
                tone={st.rift > 40 ? "bad" : undefined}
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="absolute right-3 top-44 flex flex-col gap-1 sm:top-20">
          <Button
            size="icon"
            variant="outline"
            className="rounded-none border-ink bg-paper/90"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume" : "Pause"}
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className={cn(
              "rounded-none border-ink bg-paper/90",
              fast && "bg-ink text-paper hover:bg-ink/90 hover:text-paper",
            )}
            onClick={() => setFast((f) => !f)}
            aria-label="Fast forward"
            aria-pressed={fast}
            title="Fast forward"
          >
            <FastForward />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className={cn(
              "rounded-none border-ink bg-paper/90",
              labels && "bg-ink text-paper hover:bg-ink/90 hover:text-paper",
            )}
            onClick={() => setLabels((l) => !l)}
            aria-label="Landmark labels"
            aria-pressed={labels}
            title="Landmark labels"
          >
            <Tag />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className={cn(
              "rounded-none border-ink bg-paper/90",
              upsideDown && "bg-stamp text-paper hover:bg-stamp/90 hover:text-paper",
            )}
            onClick={() => setUpsideDown((u) => !u)}
            aria-label="Flip to the Upside Down"
            aria-pressed={upsideDown}
            title={upsideDown ? "Back to Maple Hollow" : "Flip to the Upside Down"}
          >
            <FlipVertical2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="rounded-none border-ink bg-paper/90"
            onClick={share}
            aria-label="Share town"
            title="Share town"
          >
            <Share2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="rounded-none border-ink bg-paper/90"
            onClick={() => setConfirmReset(true)}
            aria-label="New town"
            title="New town"
          >
            <RotateCcw />
          </Button>
        </div>

        {shared && (
          <div className="absolute left-3 right-16 top-44 border-2 border-ink bg-paper/95 p-2 text-sm sm:top-20 sm:max-w-sm">
            You're reading someone else's town. Type an event to take it over, or{" "}
            <button className="underline" onClick={newCity}>
              start your own
            </button>
            .
          </div>
        )}

        {/* Event input */}
        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
          <div className="mx-auto max-w-2xl border-2 border-ink bg-paper/95 p-3 shadow-[5px_5px_0_0_var(--ink)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-stamp">
                  Your dispatch · Maple Hollow, October ’85
                </p>
                <p className="mt-0.5 font-serif-d text-sm font-bold">What happens next?</p>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">{input.length}/200</span>
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
            >
              <textarea
                ref={promptRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={200}
                disabled={busy || holding}
                aria-label="Event"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
                rows={2}
                placeholder="A strange thing happens somewhere in town…"
                className="min-h-12 min-w-0 flex-1 resize-none bg-white/55 px-3 py-2 font-serif-d text-base leading-snug outline-none ring-1 ring-inset ring-ink/20 transition focus:ring-2 focus:ring-stamp placeholder:text-ink/40 disabled:opacity-60"
              />
              <Button
                type="submit"
                disabled={busy || holding || !city || input.trim().length < 3}
                className="h-12 shrink-0 rounded-none bg-stamp px-3 text-paper shadow-[2px_2px_0_0_var(--ink)] hover:bg-stamp/90 active:translate-x-px active:translate-y-px active:shadow-none sm:px-4"
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />}
                <span>{busy ? "On deadline…" : holding ? "Live…" : "Make it happen"}</span>
              </Button>
            </form>
            {busy ? (
              <p
                aria-live="polite"
                className="mt-2 flex items-center gap-2 font-mono text-[10px] text-stamp"
              >
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-stamp" />
                {busyFor < 4
                  ? "The newsroom is calling around…"
                  : busyFor < 12
                    ? "The Courier is checking the facts…"
                    : "The presses are warming up. Maple Hollow is on the line…"}
              </p>
            ) : holding ? (
              <p
                aria-live="polite"
                className="mt-2 font-mono text-[10px] uppercase tracking-wider text-stamp"
              >
                Breaking · Watch the event unfold above
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-dashed border-ink/25 pt-2">
              <div
                className="flex items-center gap-1.5"
                title="Event credits: minor events cost 1, citywide 2, apocalyptic 3"
              >
                {Array.from({ length: MAX_CREDITS }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "size-2.5 rotate-45 border border-ink",
                      i < c.credits && "bg-ink",
                    )}
                  />
                ))}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {c.credits}/{MAX_CREDITS} dispatch credits
                  {c.credits < MAX_CREDITS ? ` · +1 in ${nextIn}m` : " · full"}
                </span>
              </div>
              <span className="hidden font-mono text-[9px] text-muted-foreground sm:inline">
                Need a spark?
              </span>
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
                {SUGGESTIONS.map(({ tag, text }) => (
                  <button
                    key={tag}
                    type="button"
                    disabled={busy || holding}
                    onClick={() => {
                      setInput(text);
                      promptRef.current?.focus();
                    }}
                    className="shrink-0 border border-ink/30 bg-white/45 px-2 py-1 text-left transition hover:border-stamp hover:bg-stamp hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stamp disabled:opacity-50"
                  >
                    <span className="block font-mono text-[8px] uppercase tracking-wider opacity-65">
                      {tag}
                    </span>
                    <span className="block max-w-48 truncate font-serif-d text-xs">{text}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 px-0.5 font-mono text-[9px] text-muted-foreground">
              Be specific about where it happens. Big events can use up to 3 credits. Enter to file
              · Shift+Enter for a new line.
            </p>
          </div>
        </div>
      </main>

      <aside className="max-h-[44dvh] overflow-y-auto border-t-2 border-ink bg-newsprint lg:max-h-none lg:w-[400px] lg:border-l-2 lg:border-t-0">
        {city && <Newspaper city={city} />}
      </aside>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="rounded-none border-2 border-ink bg-paper">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif-d">Bulldoze and start over?</AlertDialogTitle>
            <AlertDialogDescription>
              {city?.name} and its whole archive will be gone. Share it first if you want to keep a
              copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none bg-stamp text-paper hover:bg-stamp/90"
              onClick={newCity}
            >
              New town
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={collapsed && !dismissedCollapse && !shared}>
        <AlertDialogContent className="rounded-none border-2 border-ink bg-paper">
          <AlertDialogHeader>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Obituaries · Day {city?.day}
            </p>
            <AlertDialogTitle className="font-serif-d text-2xl">
              {city?.name}, day 0 – {city?.day}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-ink/80">
              The town is survived by {city ? countKinds(city.grid).rubble : 0} piles of rubble and{" "}
              {city?.log.length ?? 0} front pages. In lieu of flowers, the family asks that you
              found another town, or type something that brings this one back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none" onClick={() => setDismissedCollapse(true)}>
              Try to revive it
            </AlertDialogCancel>
            <AlertDialogAction className="rounded-none bg-ink text-paper" onClick={newCity}>
              Found a new town
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SceneFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-sky font-mono text-xs uppercase tracking-widest text-ink/60">
      Surveying the land…
    </div>
  );
}
