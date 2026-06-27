"use client";

import { useState, useEffect } from "react";
import { loadAbilities, loadMoves, type MovesData } from "@/lib/pokedex";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const moveTitle = (mv: string, info?: { t: string; p: number | null; c: string; d: string }) =>
  info ? [cap(info.t), cap(info.c), info.p ? `${info.p} BP` : null].filter(Boolean).join(" · ") + (info.d ? ` — ${info.d}` : "") : mv;
import {
  COACHES,
  QUEUE,
  spriteUrl,
  TYPE_COLORS,
  COLOR_HEX,
  type Coach,
  type Mon,
} from "@/lib/mock";

type BidLog = { coachId: string; amount: number; key: number };

// Every Pokémon opens at 1. Coaches raise by whatever step they like.
const OPENING = 1;
const INCREMENTS = [1, 2, 3, 5, 10, 20];

export default function AuctionDemo() {
  const [coaches, setCoaches] = useState<Coach[]>(COACHES);
  const [queue, setQueue] = useState<Mon[]>(QUEUE);
  const [bids, setBids] = useState<BidLog[]>([]);
  const [sold, setSold] = useState<{ coach: Coach; amount: number } | null>(null);
  const [abilities, setAbilities] = useState<Record<string, string>>({});
  const [moves, setMoves] = useState<MovesData>({ byMon: {}, info: {} });

  useEffect(() => { loadAbilities().then(setAbilities); loadMoves().then(setMoves); }, []);
  const [increment, setIncrement] = useState(1);
  const [adminPlays, setAdminPlays] = useState(false);

  // The admin only sits at the table (bids + gets a roster) when they opt in.
  const activeCoaches = adminPlays ? coaches : coaches.filter((c) => !c.isAdmin);

  const current = queue[0];
  const highBid = bids[0];
  const highCoach = highBid ? coaches.find((c) => c.id === highBid.coachId)! : null;
  // No bids yet → first bid lands at the opening price (1). Otherwise raise by the chosen step.
  const nextBid = highBid ? highBid.amount + increment : OPENING;

  const spent = (c: Coach) => c.roster.reduce((s, p) => s + p.paid, 0);
  const remaining = (c: Coach) => c.budget - spent(c);

  function placeBid(coach: Coach) {
    if (sold || !current) return;
    if (remaining(coach) < nextBid) return; // can't afford
    setBids((prev) => [{ coachId: coach.id, amount: nextBid, key: prev.length }, ...prev]);
  }

  function hammer() {
    if (!current || !highCoach || sold) return;
    setSold({ coach: highCoach, amount: highBid!.amount });
  }

  function nextLot() {
    if (sold) {
      // commit the pick to the winner's roster
      setCoaches((prev) =>
        prev.map((c) =>
          c.id === sold.coach.id
            ? { ...c, roster: [...c.roster, { mon: current!, paid: sold.amount }] }
            : c
        )
      );
    }
    setQueue((prev) => prev.slice(1));
    setBids([]);
    setSold(null);
    setIncrement(1);
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      {/* header bar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-black">
            Poké<span className="text-coral">Draft</span>{" "}
            <span className="hand text-coral text-2xl font-normal">live auction</span>
          </h1>
          <p className="text-sm text-ink-soft">
            League code <span className="font-mono font-bold tracking-widest">FOLD-742</span> ·{" "}
            {queue.length} left in the queue
          </p>
        </div>
        <button
          onClick={() => setAdminPlays((v) => !v)}
          className="chip"
          style={{ background: adminPlays ? "var(--plum)" : "var(--ink)", cursor: "pointer" }}
          title="Toggle whether you also field a team"
        >
          {adminPlays ? "Admin + playing" : "Admin only — tap to also play"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* ── Stage: the Pokémon currently up ──────────────────── */}
        <div className="paper creased p-6 relative">
          <span className="tape" style={{ top: -10, left: "50%", marginLeft: -37, transform: "rotate(-3deg)" }} />
          {current ? (
            <>
              <div className="flex items-start gap-5">
                <div className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={spriteUrl(current.id)}
                    alt={current.name}
                    width={150}
                    height={150}
                    className="drop-shadow-md"
                  />
                  {sold && (
                    <div className="stamp absolute -bottom-1 left-1/2 -translate-x-1/2 text-2xl">
                      Sold!
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display text-3xl font-black">{current.name}</h2>
                    {current.isMega && (
                      <span className="chip" style={{ background: "var(--indigo)" }}>
                        Mega
                      </span>
                    )}
                    <span className="chip" style={{ background: "var(--ink)" }}>
                      Tier {current.tier}
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {current.types.map((t) => (
                      <span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>
                        {t}
                      </span>
                    ))}
                  </div>

                  {/* Abilities — for a mega this is its mega ability */}
                  <div className="mt-2.5 text-sm">
                    <span className="font-semibold text-ink">{current.isMega ? "Mega ability" : "Abilities"}</span>
                    <ul className="mt-1 space-y-1">
                      {current.abilities.map((a) => (
                        <li key={a} className="text-ink-soft leading-snug">
                          <span className="font-semibold text-ink">{a}</span>
                          {abilities[a] ? ` — ${abilities[a]}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {(moves.byMon[current.id]?.length ?? 0) > 0 && (
                    <div className="mt-2.5 text-sm">
                      <span className="font-semibold text-ink">Notable moves</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {moves.byMon[current.id].map((mv) => (
                          <span key={mv} title={moveTitle(mv, moves.info[mv])}
                            className="cursor-help text-xs font-semibold rounded px-2 py-0.5 text-white"
                            style={{ background: TYPE_COLORS[moves.info[mv]?.t ?? ""] ?? "var(--ink-soft)" }}>
                            {mv}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    {highCoach ? (
                      <p className="text-ink-soft">
                        High bid{" "}
                        <span
                          className="font-display text-2xl font-black"
                          style={{ color: COLOR_HEX[highCoach.color] }}
                        >
                          {highBid!.amount}
                        </span>{" "}
                        by <span className="font-bold">{highCoach.name}</span>
                      </p>
                    ) : (
                      <p className="text-ink-soft">
                        Opening at{" "}
                        <span className="font-display text-2xl font-black text-ink">{OPENING}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* admin hammer controls */}
              <div className="mt-6 flex gap-3 border-t border-dashed border-paper-edge pt-4">
                {!sold ? (
                  <button className="btn btn-coral" onClick={hammer} disabled={!highCoach}>
                    Sold!
                  </button>
                ) : (
                  <button className="btn btn-teal" onClick={nextLot}>
                    Next Pokémon →
                  </button>
                )}
                {!sold && (
                  <button className="btn btn-ghost" onClick={nextLot}>
                    Pass / skip
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-16">
              <p className="hand text-4xl text-coral">queue&apos;s empty</p>
              <p className="text-ink-soft mt-2">Rosters are below.</p>
            </div>
          )}
        </div>

        {/* ── Live bid feed ────────────────────────────────────── */}
        <div className="paper p-5">
          <h3 className="font-display text-lg font-bold mb-3">Live bids</h3>
          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {bids.length === 0 && (
              <p className="text-sm text-ink-soft italic">No bids yet — tap a coach below to bid.</p>
            )}
            {bids.map((b) => {
              const c = coaches.find((x) => x.id === b.coachId)!;
              return (
                <div
                  key={b.key}
                  className="flex items-center justify-between rounded bg-white/40 px-3 py-1.5"
                  style={{ borderLeft: `4px solid ${COLOR_HEX[c.color]}` }}
                >
                  <span className="font-bold">{c.name}</span>
                  <span className="font-display font-black">{b.amount}</span>
                </div>
              );
            })}
          </div>

          {/* tap-to-bid (stands in for each coach's own screen) */}
          {current && !sold && (
            <div className="mt-4 border-t border-dashed border-paper-edge pt-3">
              {/* raise-amount selector */}
              <p className="text-xs text-ink-soft mb-1.5">Raise by:</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {INCREMENTS.map((step) => (
                  <button
                    key={step}
                    onClick={() => setIncrement(step)}
                    className={`btn text-sm px-3 py-1.5 ${
                      increment === step ? "btn-coral" : "btn-ghost"
                    }`}
                    disabled={!highBid && step !== 1}
                    title={!highBid && step !== 1 ? "First bid is the opening price (1)" : undefined}
                  >
                    +{step}
                  </button>
                ))}
              </div>

              <p className="text-xs text-ink-soft mb-2">
                Tap a coach to bid <span className="font-bold">{nextBid}</span> (each plays from their
                own screen in the real app):
              </p>
              <div className="grid grid-cols-2 gap-2">
                {activeCoaches.map((c) => (
                  <button
                    key={c.id}
                    className="btn text-sm py-2"
                    style={{ background: COLOR_HEX[c.color] }}
                    onClick={() => placeBid(c)}
                    disabled={remaining(c) < nextBid}
                  >
                    {c.name} · {remaining(c)} left
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Rosters ────────────────────────────────────────────── */}
      <h3 className="font-display text-xl font-bold mt-9 mb-3">Teams</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activeCoaches.map((c) => (
          <div key={c.id} className="paper p-4" style={{ borderTop: `5px solid ${COLOR_HEX[c.color]}` }}>
            <div className="flex items-baseline justify-between">
              <span className="font-display font-bold text-lg">{c.name}</span>
              <span className="text-sm text-ink-soft">{remaining(c)} pts</span>
            </div>
            <div className="mt-3 space-y-2 min-h-12">
              {c.roster.length === 0 && (
                <p className="text-sm text-ink-soft italic">No picks yet</p>
              )}
              {c.roster.map((p) => (
                <div key={p.mon.id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={spriteUrl(p.mon.id)} alt={p.mon.name} width={34} height={34} />
                  <span className="text-sm flex-1">{p.mon.name}</span>
                  <span className="text-xs text-ink-soft font-mono">{p.paid}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
