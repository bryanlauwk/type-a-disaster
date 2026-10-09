import { CHALLENGES, challengeProgress } from "@/lib/island/challenges";
import type { WorldState } from "@/lib/island/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Pick-a-challenge sheet. */
export function ChallengePicker({
  open,
  onOpenChange,
  onStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onStart: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-none border-2 border-ink bg-paper sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif-d text-xl">Ecology challenges</DialogTitle>
          <DialogDescription>
            Each one raises a new island with a twist. Survive to the end to win. Your current
            island will be replaced.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHALLENGES.map((c) => (
            <div key={c.id} className="flex flex-col gap-1.5 border-2 border-ink p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-serif-d text-base font-bold">
                  <span className="mr-1.5">{c.glyph}</span>
                  {c.name}
                </p>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {"●".repeat(c.difficulty)}
                  {"○".repeat(3 - c.difficulty)}
                </span>
              </div>
              <p className="text-xs">
                <b>Start:</b> {c.setup}
              </p>
              <p className="text-xs">
                <b>Goal:</b> {c.goal}
              </p>
              <p className="text-[11px] italic text-ink/60">{c.hint}</p>
              <Button
                size="sm"
                className="mt-auto rounded-none bg-stamp text-paper hover:bg-stamp/90"
                onClick={() => onStart(c.id)}
              >
                Begin
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Progress strip shown while a challenge runs. */
export function ChallengeBadge({ world, onOpen }: { world: WorldState; onOpen: () => void }) {
  const p = challengeProgress(world);
  if (!p) return null;
  const { def, run, elapsed, frac } = p;
  return (
    <button
      onClick={onOpen}
      className="absolute bottom-[10.5rem] right-2 z-10 w-56 border-2 border-ink bg-paper/95 p-2 text-left text-xs shadow-[3px_3px_0_0_var(--ink)] sm:bottom-auto sm:right-16 sm:top-20"
    >
      <p className="font-serif-d text-sm font-bold">
        {def.glyph} {def.name}
      </p>
      <p className="text-[11px] text-ink/70">{def.goal}</p>
      <div className="mt-1.5 h-1.5 w-full bg-ink/15">
        <div
          className={cn(
            "h-full",
            run.result === "lost" ? "bg-stamp" : run.result === "won" ? "bg-moss" : "bg-ink",
          )}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-widest">
        {run.result === "won"
          ? "Won"
          : run.result === "lost"
            ? "Lost"
            : `Day ${elapsed} / ${def.days}`}
      </p>
    </button>
  );
}

/** Verdict when the challenge is decided. */
export function ChallengeVerdict({
  world,
  open,
  onClose,
  onRetry,
  onPick,
}: {
  world: WorldState;
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  onPick: () => void;
}) {
  const p = challengeProgress(world);
  if (!p || !p.run.result) return null;
  const won = p.run.result === "won";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-none border-2 border-ink bg-paper">
        <DialogHeader>
          <DialogTitle className="font-serif-d text-xl">
            {p.def.glyph} {won ? "The island endured" : "The island faltered"}
          </DialogTitle>
          <DialogDescription>
            {p.def.name}: {won ? `survived all ${p.def.days} days.` : `${p.run.reason} (day ${p.elapsed})`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={onClose}>
            Keep watching
          </Button>
          <Button variant="outline" className="rounded-none" onClick={onPick}>
            Other challenges
          </Button>
          <Button className="rounded-none bg-stamp text-paper hover:bg-stamp/90" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
