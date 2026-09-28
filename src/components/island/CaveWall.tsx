import { useState } from "react";
import { totalOf } from "@/lib/island/ecology";
import { SPECIES_DEFS, TRAIT_EFFECTS } from "@/lib/island/species";
import { STAGES, TECH_COST, TECH_LABEL } from "@/lib/island/tribe";
import { SPECIES, TECHS, type Chronicle, type Notice, type WorldState } from "@/lib/island/types";
import { cn } from "@/lib/utils";
import { FORM_CREDITS, SKIN_CREDITS } from "./dinoCredits";
import { FORMS } from "./dinoForms";

const NOTICE_TONE: Record<Notice["kind"], string> = {
  herd: "text-moss",
  tribe: "text-ochre",
  nature: "text-[#8fb7c9]",
  danger: "text-stamp",
  discovery: "text-[#e8d38a]",
};

function Entry({ c, fresh }: { c: Chronicle; fresh: boolean }) {
  return (
    <article
      className={cn(
        "relative border-b border-dashed border-ochre/25 pb-4 pl-11 pt-4",
        fresh && "animate-in fade-in slide-in-from-top-2 duration-700",
      )}
    >
      <span
        aria-hidden
        className="absolute left-0 top-3.5 flex size-9 items-center justify-center rounded-full border border-ochre/40 bg-black/25 text-lg"
      >
        {c.glyph}
      </span>
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-ochre/70">
        Day {c.day}
        {!c.told && c.lines.length > 0 && " · the island's own record"}
      </p>
      <h3 className="mt-0.5 font-serif-d text-lg font-bold leading-snug text-[#f1e4c8]">
        {c.title}
      </h3>
      {c.lines.map((l, i) => (
        <p key={i} className="mt-1.5 text-[13px] leading-relaxed text-[#e6d7b8]/90">
          {l}
        </p>
      ))}
      {c.voices.map((v, i) => (
        <blockquote
          key={i}
          className="mt-2 border-l-2 border-ochre/50 pl-2.5 text-[13px] italic leading-snug text-[#f1e4c8]"
        >
          “{v.text}”
          <footer className="mt-0.5 font-mono text-[9px] not-italic uppercase tracking-wider text-ochre/80">
            {v.name}, {v.role}
          </footer>
        </blockquote>
      ))}
    </article>
  );
}

/** The tribe's story painted on the cave wall, plus the island almanac. */
export function CaveWall({ world, telling }: { world: WorldState; telling: boolean }) {
  const [tab, setTab] = useState<"wall" | "almanac">("wall");
  const entries = [...world.chronicle].reverse();
  const t = world.tribe;
  return (
    <div className="min-h-full bg-cave text-[#e6d7b8] [background-image:radial-gradient(ellipse_at_top,rgba(214,150,80,0.13),transparent_60%)]">
      <div className="sticky top-0 z-[1] flex border-b border-ochre/25 bg-cave/95 backdrop-blur-sm lg:top-0">
        {(["wall", "almanac"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 border-b-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] transition",
              tab === k
                ? "border-ochre text-[#f1e4c8]"
                : "border-transparent text-[#e6d7b8]/50 hover:text-[#f1e4c8]",
            )}
          >
            {k === "wall" ? "The cave wall" : "Almanac"}
          </button>
        ))}
      </div>

      {tab === "wall" ? (
        <div className="px-4 pb-8">
          {telling && (
            <p
              aria-live="polite"
              className="flex items-center gap-2 border-b border-dashed border-ochre/25 py-3 font-mono text-[10px] uppercase tracking-wider text-ochre"
            >
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-ochre" />
              The storyteller is painting…
            </p>
          )}
          {entries.map((c, i) => (
            <Entry key={`${c.day}-${entries.length - i}`} c={c} fresh={i === 0} />
          ))}
          {!entries.length && !telling && (
            <div className="py-8 text-center">
              <p className="font-serif-d text-lg text-[#f1e4c8]">The wall is bare.</p>
              <p className="mx-auto mt-2 max-w-xs text-[13px] leading-relaxed text-[#e6d7b8]/70">
                The People of the Bay paint what the god does. Shake the island and they'll have a
                story to tell.
              </p>
            </div>
          )}
          {world.notices.length > 0 && (
            <section className="mt-5">
              <h4 className="font-mono text-[9px] uppercase tracking-[0.25em] text-ochre/70">
                Word around the fire
              </h4>
              <ul className="mt-2 space-y-1.5">
                {world.notices
                  .slice(-14)
                  .reverse()
                  .map((n, i) => (
                    <li key={`${n.day}-${i}`} className="flex gap-2 text-[12px] leading-snug">
                      <span className="w-9 shrink-0 font-mono text-[10px] text-[#e6d7b8]/40">
                        d{n.day}
                      </span>
                      <span className={NOTICE_TONE[n.kind]}>{n.text}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-6 px-4 pb-8 pt-4">
          <section>
            <h4 className="font-mono text-[9px] uppercase tracking-[0.25em] text-ochre/70">
              The animals
            </h4>
            <ul className="mt-2 space-y-2">
              {SPECIES.map((sp) => {
                const d = SPECIES_DEFS[sp];
                const n = Math.round(totalOf(world, sp));
                const known = world.known.includes(sp);
                const traits = world.traits[sp] ?? [];
                return (
                  <li key={sp} className={cn("text-[13px]", !n && "opacity-45")}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-serif-d font-bold text-[#f1e4c8]">
                        {d.plural}
                        {!known && (
                          <span className="ml-1.5 font-mono text-[9px] font-normal uppercase tracking-wider text-[#e6d7b8]/40">
                            unstudied
                          </span>
                        )}
                      </span>
                      <span className="font-mono tabular-nums">{n ? n : "gone"}</span>
                    </div>
                    <p className="text-[12px] leading-snug text-[#e6d7b8]/65">{d.blurb}</p>
                    {traits.length > 0 && (
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-moss">
                        {traits.map((tr) => TRAIT_EFFECTS[tr].label).join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h4 className="font-mono text-[9px] uppercase tracking-[0.25em] text-ochre/70">
              The People of the Bay
            </h4>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-[#e6d7b8]/60">Home</dt>
              <dd className="text-right">{STAGES[t.stage]}</dd>
              <dt className="text-[#e6d7b8]/60">People</dt>
              <dd className="text-right tabular-nums">{Math.round(t.pop)}</dd>
              <dt className="text-[#e6d7b8]/60">Food store</dt>
              <dd className="text-right tabular-nums">{Math.round(t.food)}</dd>
              <dt className="text-[#e6d7b8]/60">Wood · stone</dt>
              <dd className="text-right tabular-nums">
                {Math.round(t.wood)} · {Math.round(t.stone)}
              </dd>
              <dt className="text-[#e6d7b8]/60">Fossils dug</dt>
              <dd className="text-right tabular-nums">{t.fossils}</dd>
              <dt className="text-[#e6d7b8]/60">Tamed</dt>
              <dd className="text-right tabular-nums">{Math.round(t.tamed)}</dd>
              <dt className="text-[#e6d7b8]/60">Spirits</dt>
              <dd className="text-right">
                {t.morale > 0.66 ? "High" : t.morale > 0.33 ? "Steady" : "Low"}
              </dd>
            </dl>
            <ul className="mt-3 flex flex-wrap gap-1">
              {TECHS.map((k) => (
                <li
                  key={k}
                  title={t.techs.includes(k) ? "Known" : `Needs ${TECH_COST[k]} knowledge`}
                  className={cn(
                    "border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                    t.techs.includes(k)
                      ? "border-ochre/60 text-[#f1e4c8]"
                      : "border-[#e6d7b8]/15 text-[#e6d7b8]/35",
                  )}
                >
                  {TECH_LABEL[k]}
                </li>
              ))}
            </ul>
          </section>
          <p className="text-[12px] leading-relaxed text-[#e6d7b8]/55">
            Favour refills a little every day. Fossils the tribe digs up teach them about the
            animals and give you evolution points to spend on Life → Evolve.
          </p>
          <section>
            <h4 className="font-mono text-[9px] uppercase tracking-[0.25em] text-ochre/70">
              The animals' models
            </h4>
            <ul className="mt-2 space-y-1 text-[11px] leading-snug text-[#e6d7b8]/55">
              {SPECIES.flatMap((sp) =>
                FORMS[sp].map((f, k) => {
                  const cr = k === 0 ? SKIN_CREDITS[sp] : FORM_CREDITS[f.key];
                  if (!cr) return null;
                  return (
                    <li key={f.key}>
                      {SPECIES_DEFS[sp].plural} ({f.name}):{" "}
                      <a
                        className="underline decoration-ochre/40 hover:text-[#f1e4c8]"
                        href={`https://sketchfab.com/3d-models/${cr.uid}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        “{cr.name}”
                      </a>{" "}
                      by {cr.author}, CC BY 4.0
                    </li>
                  );
                }),
              )}
            </ul>
            <p className="mt-2 text-[11px] leading-snug text-[#e6d7b8]/45">
              Recoloured, reposed and reanimated for the island. Plants: Poly Haven (CC0); “Ponga”
              by toAflame, “Realistic Palm Tree Model vol.1” by aliyeredon, “Bald Cypress” by
              BaptisteBerard, “Jungle Tree” by kobaltsecond (CC BY 4.0). Ground: Poly Haven (CC0).
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
