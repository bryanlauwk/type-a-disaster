import {
  Activity,
  Biohazard,
  CircleDot,
  CloudLightning,
  DoorOpen,
  Droplets,
  Eye,
  Fish,
  Flame,
  Footprints,
  Loader2,
  Orbit,
  Rocket,
  Tornado,
  Waves,
  ZapOff,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_CREDITS } from "@/lib/city/persistence";
import {
  PLACES,
  PRESETS,
  type DisasterPreset,
  type Place,
  type PresetIcon,
} from "@/lib/city/presets";
import { SCALE_COST } from "@/lib/city/types";
import { cn } from "@/lib/utils";

const ICONS: Record<PresetIcon, LucideIcon> = {
  waves: Waves,
  droplets: Droplets,
  rocket: Rocket,
  footprints: Footprints,
  tornado: Tornado,
  activity: Activity,
  "cloud-lightning": CloudLightning,
  flame: Flame,
  "circle-dot": CircleDot,
  orbit: Orbit,
  "door-open": DoorOpen,
  fish: Fish,
  "zap-off": ZapOff,
  biohazard: Biohazard,
  eye: Eye,
};

function Pips({ n, filled = n, className }: { n: number; filled?: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1", className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={cn("size-1.5 rotate-45 border border-current", i < filled && "bg-current")}
        />
      ))}
    </span>
  );
}

export interface DisasterPickerProps {
  picked: { preset: DisasterPreset; place: Place } | null;
  onPick: (preset: DisasterPreset) => void;
  onPlace: (place: Place) => void;
  onFire: () => void;
  credits: number;
  /** Minutes until the next credit. */
  nextIn: number;
  busy: boolean;
  busyFor: number;
  holding: boolean;
  ready: boolean;
}

/**
 * The dispatch desk: fifteen disasters to pick from, where to aim it, and
 * the button that sends it to press. While an event plays it shrinks to a
 * single status line, out of the way of the view.
 */
export function DisasterPicker({
  picked,
  onPick,
  onPlace,
  onFire,
  credits,
  nextIn,
  busy,
  busyFor,
  holding,
  ready,
}: DisasterPickerProps) {
  const cost = picked ? SCALE_COST[picked.preset.scale] : 0;
  const short = picked && credits < cost;
  const working = busy || holding;

  return (
    <div className="mx-auto max-w-3xl border-2 border-ink bg-paper/95 shadow-[4px_4px_0_0_var(--ink)] backdrop-blur-md sm:shadow-[5px_5px_0_0_var(--ink)]">
      {working ? (
        <p
          aria-live="polite"
          className="flex items-center gap-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-stamp"
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {busyFor < 4
                ? "The newsroom is calling around…"
                : busyFor < 12
                  ? "The Courier is checking the facts…"
                  : "The presses are warming up…"}
            </>
          ) : (
            <>
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-stamp" />
              Breaking · {picked?.preset.name ?? "Watch it unfold"}
            </>
          )}
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-2.5 pt-2 sm:px-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-stamp">
              Pick a disaster
            </p>
            <span
              className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"
              title="Event credits: local events cost 1, citywide 2, apocalyptic 3"
            >
              <Pips n={MAX_CREDITS} filled={credits} className="text-ink" />
              {credits}/{MAX_CREDITS}
              {credits < MAX_CREDITS ? ` · +1 in ${nextIn}m` : ""}
            </span>
          </div>

          {/* Two scrolling rows on a phone, a 5×3 board on a wider screen. */}
          <div
            role="listbox"
            aria-label="Disasters"
            className="grid auto-cols-[5.4rem] grid-flow-col grid-rows-2 gap-1.5 overflow-x-auto px-2.5 py-2 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-5 sm:grid-rows-none sm:overflow-visible sm:px-3"
          >
            {PRESETS.map((p) => {
              const Icon = ICONS[p.icon];
              const on = picked?.preset.id === p.id;
              const price = SCALE_COST[p.scale];
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onPick(p)}
                  title={p.blurb}
                  className={cn(
                    "flex min-w-0 flex-col items-start gap-1 border px-2 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stamp",
                    on
                      ? "border-ink bg-ink text-paper"
                      : "border-ink/25 bg-white/50 hover:border-ink",
                    credits < price && !on && "opacity-55",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Icon className="size-4" />
                    <Pips n={price} className={on ? "text-paper" : "text-stamp"} />
                  </span>
                  <span className="w-full truncate font-serif-d text-xs font-bold leading-tight">
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>

          {picked && (
            <div className="border-t border-dashed border-ink/25 px-2.5 pb-2.5 pt-2 sm:px-3">
              <p className="line-clamp-2 text-xs leading-snug text-ink/80">
                <span className="font-serif-d font-bold text-ink">{picked.preset.name}.</span>{" "}
                {picked.preset.blurb}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div
                  role="radiogroup"
                  aria-label="Where"
                  className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5"
                >
                  {PLACES.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      role="radio"
                      aria-checked={picked.place.id === pl.id}
                      onClick={() => onPlace(pl)}
                      className={cn(
                        "shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition",
                        picked.place.id === pl.id
                          ? "border-stamp bg-stamp text-paper"
                          : "border-ink/25 bg-white/50 hover:border-ink",
                      )}
                    >
                      {pl.label}
                    </button>
                  ))}
                </div>
                <Button
                  type="button"
                  onClick={onFire}
                  disabled={!ready || !!short}
                  className="h-9 shrink-0 rounded-none bg-stamp px-3 text-paper shadow-[2px_2px_0_0_var(--ink)] hover:bg-stamp/90 active:translate-x-px active:translate-y-px active:shadow-none"
                >
                  {short ? `Needs ${cost}` : "Make it happen"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
