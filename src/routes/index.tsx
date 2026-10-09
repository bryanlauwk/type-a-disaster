import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronUp,
  FastForward,
  Map as MapIcon,
  Pause,
  Play,
  RotateCcw,
  Share2,
  Tag,
  Trophy,
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
import { GodPanel, POWER_RADIUS, WHOLE_ISLAND, type Armed } from "@/components/island/GodPanel";
import { CaveWall } from "@/components/island/CaveWall";
import { ChallengeBadge, ChallengePicker, ChallengeVerdict } from "@/components/island/Challenges";
import { createChallengeWorld } from "@/lib/island/challenges";
import { planReveal, type ActRun, type TileReveal } from "@/components/island/Acts";
import type { Cursor, SimClock } from "@/components/island/IslandScene";
import { lifeBus, type BusAgent } from "@/components/island/lifeBus";
import { act, affordable, createWorld, REGION_NAMES, seasonOf, tick } from "@/lib/island/sim";
import { totalOf } from "@/lib/island/ecology";
import { POWER_DEFS, type PowerGroup } from "@/lib/island/powers";
import { HERBIVORES, PREDATORS, SPECIES_DEFS } from "@/lib/island/species";
import { STAGES } from "@/lib/island/tribe";
import { LANDMARK_NAMES } from "@/lib/island/names";
import {
  clearIsland,
  decodeShare,
  encodeShare,
  loadIsland,
  saveIsland,
} from "@/lib/island/persistence";
import { describeAct, milestoneEntry, plainEntry } from "@/lib/island/story";
import { tellStory } from "@/lib/island/chronicle.functions";
import {
  RIVER,
  SPECIES,
  wx,
  wz,
  type Chronicle,
  type RegionId,
  type SpeciesId,
  type WorldState,
} from "@/lib/island/types";
import { cn } from "@/lib/utils";

const IslandScene = lazy(() => import("@/components/island/IslandScene"));

export const Route = createFileRoute("/")({
  component: Index,
});

const DAY_MS = 10_000;
const FAST_MS = 2_500;
/** Acts worth a story on the cave wall. */
const STORIED = (p: Armed["power"]) =>
  POWER_DEFS[p].dramatic || p === "introduce" || p === "evolve";

/** What an animal's live state reads as on its card. */
const STATE_TEXT: Record<string, string> = {
  idle: "Standing about",
  graze: "Grazing",
  walk: "On the move",
  run: "Running",
  drink: "Drinking at the water",
  flee: "Fleeing",
  hunt: "Hunting",
  eat: "Feeding",
  nest: "Nesting",
  dead: "Fallen",
};

const newSeed = () => {
  // ?seed=N in the URL starts a fresh island from that seed (for testing).
  const fixed =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("seed");
  return fixed && /^\d+$/.test(fixed) ? Number(fixed) : Math.floor(Math.random() * 2 ** 31);
};
const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`;

function Index() {
  const [world, setWorld] = useState<WorldState | null>(null);
  const [shared, setShared] = useState(false);
  const [paused, setPaused] = useState(false);
  // ?paused=1 starts with the clock stopped (handy for looking at a set moment).
  useEffect(() => {
    if (/[?&]paused=1\b/.test(window.location.search)) setPaused(true);
  }, []);
  const [fast, setFast] = useState(false);
  const [labels, setLabels] = useState(true);
  const [mapView, setMapView] = useState(false);
  // ?map=1 opens on the park map (handy for checking it).
  useEffect(() => {
    if (/[?&]map=1\b/.test(window.location.search)) setMapView(true);
  }, []);
  const [tickAt, setTickAt] = useState(() => performance.now() - 0.3 * DAY_MS);
  const [group, setGroup] = useState<PowerGroup>("wrath");
  const [armed, setArmed] = useState<Armed | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  /** The animal (by live id) being inspected. */
  const [animal, setAnimal] = useState<number | null>(null);
  const [follow, setFollow] = useState<SpeciesId | null>(null);
  const [focus, setFocus] = useState<{ tile: number; stamp: number } | null>(null);
  const [run, setRun] = useState<ActRun | null>(null);
  const [reveal, setReveal] = useState<TileReveal[]>([]);
  const [display, setDisplay] = useState<WorldState | null>(null);
  const [telling, setTelling] = useState(0);
  const [wallOpen, setWallOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pickChallenge, setPickChallenge] = useState(false);
  const [verdictSeen, setVerdictSeen] = useState<string | null>(null);
  const runId = useRef(0);
  const dramatic = !!run && !!display;
  const dayMs = fast ? FAST_MS : DAY_MS;

  // A shared island from the link, else your saved one, else a new one.
  useEffect(() => {
    const m = window.location.hash.match(/[#&]i=([\w-]+)/);
    if (m) {
      decodeShare(m[1])
        .then((w) => {
          setWorld(w);
          setShared(true);
        })
        .catch(() => {
          toast.error("That island's map is smudged beyond reading. Here's your own instead.");
          setWorld(loadIsland() ?? createWorld(newSeed()));
        });
      return;
    }
    setWorld(loadIsland() ?? createWorld(newSeed()));
  }, []);

  // Keep your own island. A shared one becomes yours once you touch it.
  useEffect(() => {
    if (world && !shared) saveIsland(world);
  }, [world, shared]);

  const adopt = useCallback(() => {
    if (!shared) return;
    setShared(false);
    history.replaceState(null, "", window.location.pathname);
  }, [shared]);

  // The island lives on by itself: one day per tick.
  const halted = paused || dramatic || !world;
  useEffect(() => {
    if (halted) return;
    const wait = Math.max(0, tickAt + dayMs - performance.now());
    const id = setTimeout(() => {
      setTickAt(performance.now());
      setWorld((w) => {
        if (!w) return w;
        const n = tick(w);
        if (n.tribe.stage > w.tribe.stage) {
          const e = milestoneEntry(
            n,
            `The camp becomes a ${STAGES[n.tribe.stage].toLowerCase()}`,
            "🏕️",
          );
          e.lines = [`${Math.round(n.tribe.pop)} people now live by the bay.`];
          n.chronicle = [...n.chronicle, e];
          toast(`The tribe's home is now a ${STAGES[n.tribe.stage].toLowerCase()}.`);
        }
        return n;
      });
    }, wait);
    return () => clearTimeout(id);
  }, [halted, tickAt, dayMs, world]);

  // Resume the clock where it stopped rather than skipping a day.
  const haltedAt = useRef<number | null>(null);
  useEffect(() => {
    if (halted) haltedAt.current = performance.now();
    else if (haltedAt.current !== null) {
      const lost = performance.now() - haltedAt.current;
      haltedAt.current = null;
      setTickAt((t) => t + lost);
    }
  }, [halted]);

  const clock = useMemo<SimClock>(
    () => ({ tickAt, dayMs, paused: halted }),
    [tickAt, dayMs, halted],
  );

  const addEntry = useCallback((c: Chronicle) => {
    setWorld((w) => (w ? { ...w, chronicle: [...w.chronicle, c].slice(-60) } : w));
  }, []);

  const cast = useCallback(
    (a: Armed, tile: number) => {
      if (!world || dramatic) return;
      const action = { ...a, tile };
      if (!affordable(world, action)) {
        toast(
          world.favour < POWER_DEFS[a.power].cost
            ? "Not enough favour yet. It refills a little each day."
            : "Needs an evolution point.",
        );
        return;
      }
      adopt();
      const before = world;
      const after = act(world, action);
      const record = after.actions[after.actions.length - 1];
      const id = ++runId.current;
      const r: ActRun = { id, record, before, after };
      const big = !!POWER_DEFS[a.power].dramatic;
      setWorld(after);
      setRun(r);
      if (big) {
        setReveal(planReveal(r));
        setDisplay(before);
        setArmed(null);
      } else {
        setReveal([]);
        setDisplay(null);
        if (a.power === "guide") setArmed(null);
        else if (WHOLE_ISLAND.has(a.power)) setArmed(null);
      }
      if (a.power === "guide")
        toast(`The tribe turns to ${a.focus === "balanced" ? "a bit of everything" : a.focus}.`);
      if (a.power === "bless") toast("A good harvest. The tribe's stores fill.");
      if (a.power === "rain") toast("Rain sweeps in off the sea.");
      if (a.power === "drought") toast("The sky clears and stays clear.");

      if (!STORIED(a.power)) return;
      const input = describeAct(before, after, record);
      setTelling((n) => n + 1);
      tellStory({ data: input })
        .then((res) => {
          if (res.ok) addEntry({ day: after.day, ...res.entry, told: true });
          else {
            addEntry(plainEntry(after, record, input));
            toast(res.error);
          }
        })
        .catch(() => addEntry(plainEntry(after, record, input)))
        .finally(() => setTelling((n) => n - 1));
    },
    [world, dramatic, adopt, addEntry],
  );

  const onReveal = useCallback(
    (tiles: number[]) => {
      if (!run) return;
      setDisplay((d) => {
        if (!d) return d;
        const next = d.tiles.slice();
        for (const i of tiles) next[i] = run.after.tiles[i];
        return { ...d, tiles: next };
      });
    },
    [run],
  );

  const onActDone = useCallback(() => {
    setRun(null);
    setDisplay(null);
    setReveal([]);
  }, []);

  const needsTarget = !!armed && !WHOLE_ISLAND.has(armed.power);
  const targetReady = needsTarget && (armed.power !== "introduce" || !!armed.species);

  const onPick = useCallback(
    (tile: number) => {
      if (!world) return;
      if (targetReady && armed) {
        cast(armed, tile);
        return;
      }
      // An animal first, if one stands where the god pointed.
      const x = wx(tile);
      const z = wz(tile);
      let best: BusAgent | null = null;
      let bd = 3;
      for (const a of lifeBus.agents) {
        if (a.state === "dead") continue;
        const d = Math.hypot(a.x - x, a.z - z);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best) {
        setAnimal((cur) => (cur === best.id ? null : best.id));
        setInspect(null);
        return;
      }
      setInspect((cur) => (cur === tile ? null : tile));
      setAnimal(null);
    },
    [world, targetReady, armed, cast],
  );

  /** Fly the camera over a region (from a notice or the almanac). */
  const locateRegion = useCallback(
    (region: RegionId) => {
      if (!world) return;
      const tile = world.tiles.findIndex((t) => t.region === region);
      if (tile < 0) return;
      setAnimal(null);
      setInspect(null);
      setFocus({ tile, stamp: performance.now() });
    },
    [world],
  );

  // ?cast=<power> (or <power>:<tile>) fires a power once the island is up: for
  // checking how an act looks without clicking through the panel.
  const autoCast = useRef(false);
  const castRef = useRef(cast);
  castRef.current = cast;
  useEffect(() => {
    if (!world || autoCast.current) return;
    const m = window.location.search.match(/[?&]cast=([a-z]+)(?::(\d+))?/);
    if (!m) return;
    autoCast.current = true;
    const power = m[1] as Armed["power"];
    if (!POWER_DEFS[power]) return;
    const tile = m[2] ? Number(m[2]) : world.tribe.home;
    setTimeout(() => castRef.current({ power }, tile), 1200);
  }, [world]);

  const castWhole = useCallback(
    (a: Armed) => {
      if (!world) return;
      const tile =
        a.power === "eruption"
          ? world.tiles.findIndex((t) => t.landmark === "great_volcano")
          : world.tribe.home;
      cast(a, tile);
    },
    [world, cast],
  );

  const cursor = useMemo<Cursor | null>(() => {
    if (!targetReady || !armed || hover === null) return null;
    const wrath = POWER_DEFS[armed.power].group === "wrath";
    return {
      tile: hover,
      radius: POWER_RADIUS[armed.power] ?? 2,
      color: wrath ? "#ff6a3d" : "#fff1b8",
    };
  }, [targetReady, armed, hover]);

  const share = async () => {
    if (!world) return;
    const url = `${window.location.origin}/#i=${await encodeShare(world)}`;
    try {
      if (navigator.share) await navigator.share({ title: "My island on Primordia", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied. Anyone who opens it gets your island, as it is today.");
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const newIsland = (challengeId?: string) => {
    clearIsland();
    setShared(false);
    history.replaceState(null, "", window.location.pathname);
    setRun(null);
    setDisplay(null);
    setArmed(null);
    setInspect(null);
    setAnimal(null);
    setFollow(null);
    setFocus(null);
    setWorld(challengeId ? createChallengeWorld(challengeId, newSeed()) : createWorld(newSeed()));
    setVerdictSeen(null);
    setPickChallenge(false);
    setTickAt(performance.now() - 0.3 * DAY_MS);
  };

  const herb = world ? HERBIVORES.reduce((n, sp) => n + totalOf(world, sp), 0) : 0;
  const pred = world ? PREDATORS.reduce((n, sp) => n + totalOf(world, sp), 0) : 0;
  const latest = world?.chronicle[world.chronicle.length - 1];

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink lg:flex-row">
      <Toaster position="top-center" />
      <main className="relative min-h-[30dvh] flex-1 overflow-hidden lg:min-h-0">
        <div className={cn("absolute inset-0", targetReady && "cursor-crosshair")}>
          <ClientOnly fallback={<SceneFallback />}>
            <Suspense fallback={<SceneFallback />}>
              {world ? (
                <IslandScene
                  world={display ?? world}
                  clock={clock}
                  onPick={onPick}
                  onHover={setHover}
                  cursor={cursor}
                  showLabels={labels}
                  act={run}
                  reveal={reveal}
                  onReveal={onReveal}
                  onActDone={onActDone}
                  mapView={mapView && !run}
                  follow={follow}
                  focus={focus}
                />
              ) : (
                <SceneFallback />
              )}
            </Suspense>
          </ClientOnly>
        </div>

        {/* Masthead + stats */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-1.5 p-2 sm:gap-2 sm:p-3">
          <div className="pointer-events-auto border-2 border-ink bg-paper/90 px-2 py-1 backdrop-blur-sm sm:px-3 sm:py-1.5">
            <h1 className="font-serif-d text-base font-black leading-tight sm:text-lg">
              Primordia
            </h1>
            <p className="font-mono text-[10px] text-muted-foreground">
              Day {world?.day ?? 0} ·{" "}
              {world ? (seasonOf(world.day) === "wet" ? "wet season" : "dry season") : "…"}
            </p>
          </div>
          {world && (
            <div className="pointer-events-auto grid w-full grid-cols-5 gap-1 sm:w-auto">
              <Stat
                label={STAGES[world.tribe.stage]}
                value={`${Math.round(world.tribe.pop)}`}
                hint="people"
              />
              <Stat
                label="Food"
                value={compact(world.tribe.food)}
                tone={world.tribe.food < world.tribe.pop ? "bad" : undefined}
              />
              <Stat label="Grazers" value={compact(herb)} tone={herb < 40 ? "bad" : undefined} />
              <Stat label="Hunters" value={compact(pred)} tone={pred < 3 ? "bad" : undefined} />
              <Stat
                label="Volcano"
                value={`${Math.round(world.volcano * 100)}%`}
                tone={world.volcano > 0.75 ? "bad" : undefined}
              />
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="absolute right-2 top-[6.25rem] z-10 flex flex-col gap-1 sm:right-3 sm:top-20 [&_button]:size-8 sm:[&_button]:size-9">
          <IconButton
            on={paused}
            onClick={() => setPaused((p) => !p)}
            label={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play /> : <Pause />}
          </IconButton>
          <IconButton on={fast} onClick={() => setFast((f) => !f)} label="Fast forward">
            <FastForward />
          </IconButton>
          <IconButton on={labels} onClick={() => setLabels((l) => !l)} label="Place names">
            <Tag />
          </IconButton>
          <IconButton on={mapView} onClick={() => setMapView((m) => !m)} label="Park map">
            <MapIcon />
          </IconButton>
          <IconButton onClick={share} label="Share island">
            <Share2 />
          </IconButton>
          <IconButton onClick={() => setPickChallenge(true)} label="Challenges">
            <Trophy />
          </IconButton>
          <IconButton onClick={() => setConfirmReset(true)} label="New island">
            <RotateCcw />
          </IconButton>
        </div>

        {world && !mapView && (
          <ChallengeBadge world={world} onOpen={() => setPickChallenge(true)} />
        )}

        {shared && (
          <div className="absolute left-2 right-14 top-[6.25rem] z-10 border-2 border-ink bg-paper/95 p-2 text-sm sm:left-3 sm:right-16 sm:top-20 sm:max-w-sm">
            You're visiting someone else's island. Use a power to make it yours, or{" "}
            <button className="underline" onClick={() => newIsland()}>
              start your own
            </button>
            .
          </div>
        )}

        {world && animal !== null && !armed && (
          <AnimalCard
            id={animal}
            onClose={() => setAnimal(null)}
            onFollow={(sp) => setFollow((f) => (f === sp ? null : sp))}
            following={follow === lifeBus.agents.find((a) => a.id === animal)?.sp}
          />
        )}
        {world && animal === null && inspect !== null && !armed && (
          <TileCard world={world} tile={inspect} onClose={() => setInspect(null)} />
        )}
        {follow && !animal && (
          <div className="absolute bottom-[10.5rem] left-2 z-10 flex items-center gap-2 border-2 border-ink bg-paper/95 px-2 py-1 text-xs shadow-[3px_3px_0_0_var(--ink)] sm:bottom-auto sm:left-3 sm:top-[3.75rem]">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-stamp" />
            Following the {SPECIES_DEFS[follow].plural.toLowerCase()}
            <button
              onClick={() => setFollow(null)}
              className="font-mono text-[10px] text-ink/50 hover:text-ink"
              aria-label="Stop following"
            >
              stop
            </button>
          </div>
        )}

        {/* God powers */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-2 sm:p-4">
          {world && (
            <GodPanel
              group={group}
              onGroup={setGroup}
              armed={armed}
              onArm={(a) => {
                setArmed(a);
                setInspect(null);
              }}
              onCast={castWhole}
              favour={world.favour}
              evo={world.evo}
              known={world.known}
              busy={dramatic}
              focus={world.tribe.focus}
            />
          )}
        </div>
      </main>

      <aside
        className={cn(
          "border-t-2 border-ink bg-cave lg:max-h-none lg:w-[380px] lg:overflow-y-auto lg:border-l-2 lg:border-t-0",
          wallOpen && "max-h-[70dvh] overflow-y-auto",
        )}
      >
        {/* Phones: the latest story, folded. */}
        <button
          type="button"
          onClick={() => setWallOpen((o) => !o)}
          aria-expanded={wallOpen}
          className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-ochre/25 bg-cave px-3 py-2 text-left text-[#f1e4c8] lg:hidden"
        >
          <span className="shrink-0 text-base">{latest?.glyph ?? "🔥"}</span>
          <span className="min-w-0 flex-1 truncate font-serif-d text-sm font-bold">
            {telling
              ? "The storyteller is painting…"
              : (latest?.title ?? "The cave wall is bare. For now.")}
          </span>
          <ChevronUp
            className={cn("size-4 shrink-0 transition-transform", wallOpen && "rotate-180")}
          />
        </button>
        <div className={cn(!wallOpen && "hidden", "lg:block lg:h-full")}>
          {world && <CaveWall world={world} telling={telling > 0} onLocate={locateRegion} />}
        </div>
      </aside>

      <ChallengePicker
        open={pickChallenge}
        onOpenChange={setPickChallenge}
        onStart={(id) => newIsland(id)}
      />
      {world?.challenge?.result && (
        <ChallengeVerdict
          world={world}
          open={verdictSeen !== `${world.seed}:${world.challenge.id}`}
          onClose={() => setVerdictSeen(`${world.seed}:${world.challenge!.id}`)}
          onRetry={() => newIsland(world.challenge!.id)}
          onPick={() => {
            setVerdictSeen(`${world.seed}:${world.challenge!.id}`);
            setPickChallenge(true);
          }}
        />
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent className="rounded-none border-2 border-ink bg-paper">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif-d">
              Sink this island and raise a new one?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The tribe, the herds and everything on the cave wall will be gone. Share it first if
              you want to keep a copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-none bg-stamp text-paper hover:bg-stamp/90"
              onClick={() => newIsland()}
            >
              New island
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What's on a tapped spot. */
function TileCard({
  world,
  tile,
  onClose,
}: {
  world: WorldState;
  tile: number;
  onClose: () => void;
}) {
  const t = world.tiles[tile];
  const animals = SPECIES.map((sp) => [sp, world.pop[sp][t.region] ?? 0] as const)
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  return (
    <div className="absolute bottom-[10.5rem] left-2 z-10 w-60 border-2 border-ink bg-paper/95 p-2.5 text-xs shadow-[3px_3px_0_0_var(--ink)] backdrop-blur-sm sm:bottom-auto sm:left-3 sm:top-24">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {t.biome.replace(/_/g, " ")}
          </p>
          <p className="font-serif-d text-sm font-bold leading-tight">
            {t.landmark ? LANDMARK_NAMES[t.landmark] : REGION_NAMES[t.region]}
          </p>
          {t.landmark && <p className="text-[11px] text-ink/60">{REGION_NAMES[t.region]}</p>}
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[10px] text-ink/50 hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mt-1.5 text-ink/75">
        {t.fire > 0 ? "Burning. " : ""}
        {t.lava > 0 ? "Molten lava. " : ""}
        {t.flood > 0 ? "Under floodwater. " : ""}
        {t.carcass ? "A carcass lies here, feeding the scavengers. " : ""}
        {t.build ? `The tribe's ${t.build.replace(/_/g, " ")}. ` : ""}
        {t.water === RIVER && `River flowing at ${Math.round((t.flow ?? 1) * 100)}%. `}
        Plants {Math.round(t.veg * 100)}% · trees {Math.round(t.forest * 100)}%
      </p>
      {animals.length > 0 && (
        <p className="mt-1 text-ink/75">
          Here:{" "}
          {animals
            .map(([sp, n]) => `${Math.round(n)} ${SPECIES_DEFS[sp].plural.toLowerCase()}`)
            .join(", ")}
        </p>
      )}
      {world.sanctuaries.includes(t.region) && (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-moss">Sanctuary</p>
      )}
    </div>
  );
}

/** What one tapped animal is up to, live. */
function AnimalCard({
  id,
  onClose,
  onFollow,
  following,
}: {
  id: number;
  onClose: () => void;
  onFollow: (sp: SpeciesId) => void;
  following: boolean;
}) {
  const a = lifeBus.agents.find((o) => o.id === id);
  if (!a) return null;
  const d = SPECIES_DEFS[a.sp];
  return (
    <div className="absolute bottom-[10.5rem] left-2 z-10 w-60 border-2 border-ink bg-paper/95 p-2.5 text-xs shadow-[3px_3px_0_0_var(--ink)] backdrop-blur-sm sm:bottom-auto sm:left-3 sm:top-24">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {a.young ? "young" : "adult"} · {REGION_NAMES[a.region]}
          </p>
          <p className="font-serif-d text-sm font-bold leading-tight">
            {a.state === "dead" ? `a fallen ${d.name}` : d.name}
          </p>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-[10px] text-ink/50 hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <p className="mt-1.5 text-ink/75">
        Right now: {STATE_TEXT[a.state] ?? a.state}.
        {a.young && " Still growing, keeping close to the herd."}
      </p>
      <p className="mt-1 text-ink/60">{d.blurb}</p>
      {a.state !== "dead" && (
        <button
          onClick={() => onFollow(a.sp)}
          className={cn(
            "mt-2 border-2 border-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
            following ? "bg-ink text-paper" : "bg-paper hover:bg-ink/10",
          )}
        >
          {following ? "Following" : "Follow the herd"}
        </button>
      )}
    </div>
  );
}

function IconButton({
  on,
  onClick,
  label,
  children,
}: {
  on?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="outline"
      className={cn(
        "rounded-none border-ink bg-paper/90",
        on && "bg-ink text-paper hover:bg-ink/90 hover:text-paper",
      )}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
    >
      {children}
    </Button>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "bad" | "good";
  hint?: string;
}) {
  return (
    <div
      className="border-2 border-ink bg-paper/90 px-1.5 py-0.5 text-center backdrop-blur-sm sm:min-w-16 sm:px-2 sm:py-1"
      title={hint}
    >
      <p className="truncate font-mono text-[8px] uppercase tracking-wider text-muted-foreground sm:text-[9px]">
        {label}
      </p>
      <p
        className={cn(
          "font-serif-d text-sm font-bold tabular-nums sm:text-base",
          tone === "bad" && "text-stamp",
          tone === "good" && "text-moss",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SceneFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-[#9fc3cf] font-mono text-xs uppercase tracking-widest text-ink/60">
      Raising the island…
    </div>
  );
}
