import { SCALE_COST, type Bulletin, type CityState, type EventRecord } from "@/lib/city/types";
import { cn } from "@/lib/utils";

const SCALE_LABEL = { minor: "Local", citywide: "Citywide", apocalyptic: "Apocalyptic" } as const;

function Story({
  ev,
  lead,
  updates,
  pending,
}: {
  ev: EventRecord;
  lead?: boolean;
  updates: Bulletin[];
  pending: number;
}) {
  const r = ev.result;
  // Credit every ready-made model once, linked to its page when known.
  const credits = [
    ...new Map(
      r.spectacle.actors
        .filter((a): a is typeof a & { attribution: string } => !!a.attribution)
        .map((a) => [a.attribution, a.attribution_url] as const),
    ),
  ];
  return (
    <article className={cn("border-b border-ink/20 pb-4", lead ? "pt-1" : "pt-3")}>
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Day {ev.day}</span>
        <span aria-hidden>·</span>
        <span className={cn(r.scale === "apocalyptic" && "text-stamp font-semibold")}>
          {SCALE_LABEL[r.scale]}
        </span>
        <span aria-hidden>·</span>
        <span>
          {SCALE_COST[r.scale]} credit{SCALE_COST[r.scale] > 1 ? "s" : ""}
        </span>
      </div>
      <h3
        className={cn(
          "font-serif-d font-bold leading-tight text-balance",
          lead ? "text-2xl sm:text-3xl" : "text-lg",
        )}
      >
        {r.headline}
      </h3>
      {lead && <p className="mt-2 text-sm leading-snug text-ink/80">{r.subhead}</p>}
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        Reader submission: “{ev.input}”
      </p>
      {lead && r.quotes.length > 0 && (
        <div className="mt-3 space-y-2">
          {r.quotes.map((q, i) =>
            /walkie/i.test(q.role) ? (
              // A transmission the paper picked up on its scanner.
              <div
                key={i}
                className="border border-dashed border-ink/50 bg-ink/[0.03] px-3 py-2 font-mono text-xs"
              >
                <p className="text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
                  ▮▮ Intercepted · {q.role}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">{q.name}:</span> {q.text}{" "}
                  <span className="text-muted-foreground">*kkhht*</span>
                </p>
              </div>
            ) : (
              <blockquote key={i} className="border-l-2 border-ink/60 pl-3 text-sm">
                <p className="italic">“{q.text}”</p>
                <footer className="mt-0.5 text-xs text-muted-foreground">
                  — {q.name}, {q.role}
                </footer>
              </blockquote>
            ),
          )}
        </div>
      )}
      {credits.length > 0 && (
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          3D model{credits.length > 1 ? "s" : ""}:{" "}
          {credits.map(([text, url], i) => (
            <span key={text}>
              {i > 0 && " · "}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="underline">
                  {text}
                </a>
              ) : (
                text
              )}
            </span>
          ))}
        </p>
      )}
      {updates.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-dashed border-ink/30 pt-2">
          {updates.map((u, i) => (
            <li key={i} className="text-sm leading-snug">
              <span className="mr-1.5 bg-stamp px-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-paper">
                Day {u.day}
              </span>
              {u.text}
            </li>
          ))}
        </ul>
      )}
      {pending > 0 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-stamp">
          Developing story · {pending} more {pending > 1 ? "updates" : "update"} expected
        </p>
      )}
    </article>
  );
}

export function Newspaper({ city }: { city: CityState }) {
  const stories = [...city.log].reverse();
  const [lead, ...archive] = stories;
  const updatesFor = (ev: EventRecord) =>
    city.bulletins.filter((b) => b.source === ev.result.headline && b.day >= ev.day);
  const pendingFor = (ev: EventRecord) =>
    city.scheduled.filter((f) => f.source === ev.result.headline).length;

  return (
    <div className="px-5 py-4">
      <header className="border-y-4 border-double border-ink py-2 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Est. 1985 · Price: one event credit
        </p>
        <h2 className="font-serif-d text-3xl font-black tracking-tight">The {city.name} Courier</h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Day {city.day} · Pop. {city.stats.population.toLocaleString()}
        </p>
      </header>

      {city.ongoing.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {city.ongoing.map((o, i) => (
            <span
              key={i}
              className="border border-ink/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            >
              Ongoing: {o.label} ({o.daysLeft}d)
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        {lead ? (
          <Story ev={lead} lead updates={updatesFor(lead)} pending={pendingFor(lead)} />
        ) : (
          <div className="py-6 text-center">
            <h3 className="font-serif-d text-2xl font-bold">Nothing has happened yet</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm text-ink/70">
              Residents report a quiet, suspiciously normal October. Pick a disaster to give the
              paper something to print.
            </p>
          </div>
        )}
        {archive.length > 0 && (
          <>
            <h4 className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Archive
            </h4>
            {archive.map((ev, i) => (
              <Story key={i} ev={ev} updates={updatesFor(ev)} pending={pendingFor(ev)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
