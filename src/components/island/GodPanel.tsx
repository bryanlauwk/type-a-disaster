import {
  Activity,
  CloudLightning,
  CloudRain,
  Dna,
  Droplets,
  Egg,
  Flame,
  Footprints,
  Hand,
  Mountain,
  MountainSnow,
  Rocket,
  Shovel,
  ShieldCheck,
  Skull,
  Sprout,
  Sun,
  Swords,
  Waves,
  Wheat,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAVOUR_MAX, POWER_DEFS, type PowerGroup } from "@/lib/island/powers";
import { SPECIES_DEFS, TRAIT_EFFECTS } from "@/lib/island/species";
import {
  FOCI,
  SPECIES,
  TRAITS,
  type Focus,
  type PowerId,
  type SpeciesId,
  type Trait,
} from "@/lib/island/types";
import { cn } from "@/lib/utils";

const ICON: Record<PowerId, LucideIcon> = {
  raise: Mountain,
  lower: Shovel,
  river: Waves,
  grow: Sprout,
  rain: CloudRain,
  drought: Sun,
  introduce: Egg,
  evolve: Dna,
  protect: ShieldCheck,
  guide: Hand,
  bless: Wheat,
  eruption: MountainSnow,
  meteor: Rocket,
  tsunami: Waves,
  earthquake: Activity,
  wildfire: Flame,
  storm: CloudLightning,
  flood: Droplets,
  plague: Skull,
  stampede: Footprints,
  raid: Swords,
};

const GROUPS: { id: PowerGroup; label: string }[] = [
  { id: "shape", label: "Shape" },
  { id: "nature", label: "Nature" },
  { id: "life", label: "Life" },
  { id: "tribe", label: "Tribe" },
  { id: "wrath", label: "Wrath" },
];

/** Powers that act on the whole island rather than a spot you tap. */
export const WHOLE_ISLAND = new Set<PowerId>([
  "rain",
  "drought",
  "evolve",
  "guide",
  "bless",
  "eruption",
  "raid",
]);

/** How wide each targeted power's hand is, in tiles (for the ring on the ground). */
export const POWER_RADIUS: Partial<Record<PowerId, number>> = {
  raise: 2.5,
  lower: 2.5,
  river: 0.8,
  grow: 3.5,
  introduce: 1.5,
  protect: 6,
  meteor: 3.5,
  tsunami: 5,
  earthquake: 5.5,
  wildfire: 3,
  storm: 8,
  flood: 6,
  plague: 6,
  stampede: 3,
};

const FOCUS_LABEL: Record<Focus, string> = {
  balanced: "Balanced",
  farm: "Farm",
  hunt: "Hunt",
  fish: "Fish",
  explore: "Explore",
  defend: "Defend",
  expand: "Expand",
};

export interface Armed {
  power: PowerId;
  species?: SpeciesId;
  trait?: Trait;
  focus?: Focus;
}

function Pips({ n, className }: { n: number; className?: string }) {
  if (!n) return <span className={cn("font-mono text-[9px]", className)}>free</span>;
  return (
    <span className={cn("font-mono text-[10px] font-semibold tabular-nums", className)}>
      {n}
      <span aria-hidden>✦</span>
    </span>
  );
}

export function GodPanel({
  group,
  onGroup,
  armed,
  onArm,
  onCast,
  favour,
  evo,
  known,
  busy,
  focus,
}: {
  group: PowerGroup;
  onGroup: (g: PowerGroup) => void;
  armed: Armed | null;
  onArm: (a: Armed | null) => void;
  /** Cast a whole-island power. */
  onCast: (a: Armed) => void;
  favour: number;
  evo: number;
  known: SpeciesId[];
  busy: boolean;
  focus: Focus;
}) {
  const powers = (Object.values(POWER_DEFS) as (typeof POWER_DEFS)[PowerId][]).filter(
    (p) => p.group === group,
  );
  const def = armed ? POWER_DEFS[armed.power] : null;
  const short = def ? favour < def.cost : false;
  const needsSpecies = armed?.power === "introduce" || armed?.power === "evolve";
  const ready =
    !!armed &&
    !short &&
    (!needsSpecies || !!armed.species) &&
    (armed.power !== "evolve" || (!!armed.trait && evo >= 1)) &&
    (armed.power !== "guide" || !!armed.focus);

  return (
    <div className="mx-auto max-w-3xl border-2 border-ink bg-paper/95 shadow-[4px_4px_0_0_var(--ink)] backdrop-blur-md sm:shadow-[5px_5px_0_0_var(--ink)]">
      {busy ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-stamp"
        >
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-stamp" />
          The island is changing…
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-ink/15 px-2 pt-1.5 sm:px-3">
            <div role="tablist" className="flex gap-0.5 overflow-x-auto">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  role="tab"
                  aria-selected={group === g.id}
                  onClick={() => onGroup(g.id)}
                  className={cn(
                    "shrink-0 border-b-2 px-1.5 pb-1.5 pt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition sm:px-2.5 sm:tracking-[0.16em]",
                    group === g.id
                      ? "border-stamp text-ink"
                      : "border-transparent text-ink/50 hover:text-ink",
                    g.id === "wrath" && "text-stamp/80",
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <span
              className="flex shrink-0 items-center gap-1.5 pb-1 font-mono text-[10px] text-ink/70"
              title="Favour refills by one each day. Evolution points come from the fossils the tribe digs up."
            >
              <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-ink/15 sm:w-20">
                <span
                  className="absolute inset-y-0 left-0 bg-ochre"
                  style={{ width: `${(favour / FAVOUR_MAX) * 100}%` }}
                />
              </span>
              {Math.floor(favour)}✦{evo > 0 && <span className="text-moss">· {evo} 🧬</span>}
            </span>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-2 py-2 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-3">
            {powers.map((p) => {
              const Icon = ICON[p.id];
              const on = armed?.power === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onArm(on ? null : { power: p.id, focus: p.id === "guide" ? focus : undefined })
                  }
                  title={p.blurb}
                  className={cn(
                    "flex w-[5.6rem] shrink-0 flex-col items-start gap-1 border px-2 py-1.5 text-left transition sm:w-auto",
                    on
                      ? "border-ink bg-ink text-paper"
                      : "border-ink/25 bg-white/50 hover:border-ink",
                    favour < p.cost && !on && "opacity-50",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Icon className={cn("size-4", p.group === "wrath" && !on && "text-stamp")} />
                    <Pips n={p.cost} className={on ? "text-ochre" : "text-stamp"} />
                  </span>
                  <span className="w-full truncate font-serif-d text-xs font-bold leading-tight">
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>

          {armed && def && (
            <div className="border-t border-dashed border-ink/25 px-2.5 pb-2.5 pt-2 sm:px-3">
              <p className="line-clamp-2 text-xs leading-snug text-ink/80">
                <span className="font-serif-d font-bold text-ink">{def.name}.</span> {def.blurb}
              </p>
              {needsSpecies && (
                <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
                  {SPECIES.filter((sp) => armed.power === "introduce" || known.includes(sp)).map(
                    (sp) => (
                      <Chip
                        key={sp}
                        on={armed.species === sp}
                        onClick={() => onArm({ ...armed, species: sp })}
                      >
                        {SPECIES_DEFS[sp].name}
                      </Chip>
                    ),
                  )}
                </div>
              )}
              {armed.power === "evolve" && (
                <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
                  {TRAITS.map((tr) => (
                    <Chip
                      key={tr}
                      on={armed.trait === tr}
                      onClick={() => onArm({ ...armed, trait: tr })}
                      title={TRAIT_EFFECTS[tr].blurb}
                    >
                      {TRAIT_EFFECTS[tr].label}
                    </Chip>
                  ))}
                </div>
              )}
              {armed.power === "guide" && (
                <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
                  {FOCI.map((f) => (
                    <Chip
                      key={f}
                      on={armed.focus === f}
                      onClick={() => onArm({ ...armed, focus: f })}
                    >
                      {FOCUS_LABEL[f]}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-wider text-stamp">
                  {short
                    ? `Needs ${def.cost} favour`
                    : armed.power === "evolve" && evo < 1
                      ? "Needs an evolution point: dig up fossils"
                      : WHOLE_ISLAND.has(armed.power)
                        ? ready
                          ? "Ready"
                          : "Pick above"
                        : needsSpecies && !armed.species
                          ? "Pick a species, then tap the island"
                          : "Tap the island to aim"}
                </p>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    variant="outline"
                    className="h-8 rounded-none border-ink/40 px-2.5 text-xs"
                    onClick={() => onArm(null)}
                  >
                    Cancel
                  </Button>
                  {WHOLE_ISLAND.has(armed.power) && (
                    <Button
                      className="h-8 rounded-none bg-stamp px-3 text-xs text-paper shadow-[2px_2px_0_0_var(--ink)] hover:bg-stamp/90"
                      disabled={!ready}
                      onClick={() => onCast(armed)}
                    >
                      {armed.power === "guide" ? "Guide them" : "Do it"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition",
        on ? "border-stamp bg-stamp text-paper" : "border-ink/25 bg-white/50 hover:border-ink",
      )}
    >
      {children}
    </button>
  );
}
