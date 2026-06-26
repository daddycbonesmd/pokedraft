"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  loadPokedex,
  spriteUrl,
  spriteSmall,
  TYPE_COLORS,
  TIER_COLORS,
  type PokeMon,
} from "@/lib/pokedex";
import {
  getLeagueByCode,
  getRoomState,
  getIdentity,
  subscribeRoom,
  nominate,
  placeBid,
  pickDirect,
  sellLot,
  passLot,
  type RoomState,
  type Coach,
  type Bid,
} from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";
import { EnvNotice } from "./HostLeague";

const OPENING = 1;
const INCREMENTS = [1, 2, 3, 5, 10, 20];

// Apply a single bid to the room state without refetching (amounts are unique per lot).
function applyBidToState(s: RoomState, row: Bid): RoomState {
  if (!s.activeLot || row.lot_id !== s.activeLot.id) return s;
  if (s.bids.some((b) => b.id === row.id)) return s; // already have this exact row
  const others = s.bids.filter((b) => b.amount !== row.amount); // replaces any optimistic stand-in
  return { ...s, bids: [row, ...others].sort((a, b) => b.amount - a.amount) };
}

export default function Room({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<RoomState | null>(null);
  const [monMap, setMonMap] = useState<Map<number, PokeMon> | null>(null);
  const [increment, setIncrement] = useState(1);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState(false);
  const leagueIdRef = useRef<string | null>(null);
  const broadcastRef = useRef<((row: Record<string, unknown>) => void) | null>(null);

  const identity = useMemo(() => getIdentity(code), [code]);

  const refresh = useCallback(async () => {
    if (leagueIdRef.current) setState(await getRoomState(leagueIdRef.current));
  }, []);

  useEffect(() => {
    if (!supabaseReady) return;
    let cleanup = () => {};
    (async () => {
      const league = await getLeagueByCode(code);
      if (!league) return setFatal("That league code doesn't exist.");
      if (!identity) return router.push(`/join?code=${code}`);
      leagueIdRef.current = league.id;
      const dex = await loadPokedex();
      setMonMap(new Map(dex.map((m) => [m.id, m])));
      await refresh();
      const sub = subscribeRoom(league.id, (evt) => {
        // Bids are the high-frequency path — apply them instantly from the payload.
        if (evt.table === "bids" && evt.eventType === "INSERT") {
          setState((s) => (s ? applyBidToState(s, evt.row as unknown as Bid) : s));
        } else {
          // Nominations / sales / joins are infrequent — a full resync keeps it simple.
          refresh();
        }
      });
      broadcastRef.current = sub.broadcastBid;
      cleanup = sub.unsubscribe;
    })();
    return () => cleanup();
  }, [code, identity, router, refresh]);

  if (!supabaseReady) return <EnvNotice />;
  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!state || !monMap) return <Centered><span className="hand text-3xl text-coral">opening the room…</span></Centered>;

  const { league, coaches, activeLot, bids, wonLots, finishedCount } = state;
  const me = coaches.find((c) => c.id === identity?.coachId) ?? null;
  const isAdmin = Boolean(identity?.adminToken && identity.adminToken === league.admin_token);

  const currentMon = activeLot ? monMap.get(activeLot.mon_id) ?? null : null;
  const highBid = bids[0] ?? null;
  const highCoach = highBid ? coaches.find((c) => c.id === highBid.coach_id) ?? null : null;
  const nextBid = highBid ? highBid.amount + increment : OPENING;

  const spent = (c: Coach) => wonLots.filter((l) => l.winner_coach_id === c.id).reduce((s, l) => s + (l.final_price ?? 0), 0);
  const remaining = (c: Coach) => league.budget - spent(c);

  const iAmHigh = Boolean(me && highCoach && me.id === highCoach.id);
  const canBid = Boolean(me && activeLot && !iAmHigh && remaining(me!) >= nextBid);

  async function act(fn: () => Promise<void>) {
    setError("");
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
  }

  // Bidding: show it on my own screen immediately, then persist. The realtime echo
  // replaces the optimistic row; if the write fails, resync to the truth.
  function submitBid() {
    if (!me || !activeLot || !canBid) return;
    const amount = nextBid;
    const optimistic: Bid = {
      id: `temp-${amount}`, league_id: league.id, lot_id: activeLot.id,
      coach_id: me.id, amount, created_at: new Date().toISOString(),
    };
    setState((s) => (s ? applyBidToState(s, optimistic) : s));
    broadcastRef.current?.(optimistic); // let everyone else see it immediately
    setError("");
    placeBid({ leagueId: league.id, lotId: activeLot.id, coachId: me.id, amount })
      .catch((e) => { setError(e instanceof Error ? e.message : "Bid failed."); refresh(); });
  }

  const soldIds = new Set(wonLots.map((l) => l.mon_id));
  const poolMons = Object.keys(league.pool)
    .map((id) => monMap!.get(Number(id)))
    .filter((m): m is PokeMon => Boolean(m) && !soldIds.has(m!.id));

  // ── Whose turn is it to nominate? Derived from history, so it's race-proof. ──
  const players = coaches; // ordered by join time
  const nPlayers = players.length || 1;
  const snakeIdx = (turn: number) => {
    const round = Math.floor(turn / nPlayers);
    const pos = turn % nPlayers;
    return round % 2 === 0 ? pos : nPlayers - 1 - pos; // forward, then back, then forward…
  };
  const mode = league.nomination_mode;
  const MODE_LABEL: Record<string, string> = {
    admin: "admin choice", snake: "snake nomination", one_random: "one nominated, one random",
    snake_draft: "snake draft",
  };
  let nominatorId: string | null = null;
  let isRandomTurn = false;
  if (mode === "admin") {
    nominatorId = players.find((p) => p.is_admin)?.id ?? null;
  } else if (mode === "snake") {
    nominatorId = players[snakeIdx(finishedCount)]?.id ?? null;
  } else {
    // one_random: even turns are a coach nomination, odd turns are a random reveal
    if (finishedCount % 2 === 0) nominatorId = players[snakeIdx(finishedCount / 2)]?.id ?? null;
    else isRandomTurn = true;
  }
  const nominator = players.find((p) => p.id === nominatorId) ?? null;
  const iNominate = Boolean(me && nominatorId && me.id === nominatorId);
  const iRevealRandom = isRandomTurn && isAdmin;

  function revealRandom() {
    if (!poolMons.length) return;
    const m = poolMons[Math.floor(Math.random() * poolMons.length)];
    act(() => nominate(league.id, m.id));
  }

  // Snake draft (no auction): take turns picking directly, in snake order.
  const isSnake = mode === "snake_draft";
  const currentPicker = isSnake ? players[snakeIdx(finishedCount)] ?? null : null;
  const iPick = Boolean(isSnake && me && currentPicker && me.id === currentPicker.id);

  async function pickMon(monId: number) {
    if (!me || busy) return;
    setBusy(true);
    setError("");
    try { await pickDirect(league.id, me.id, monId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Pick failed."); }
    finally { setBusy(false); }
  }

  if (isSnake) {
    const draftDone = poolMons.length === 0;
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div>
            <h1 className="font-display text-3xl font-black">
              {league.name} <span className="hand text-coral text-2xl font-normal">snake draft</span>
              {league.ruleset && (
                <span className="chip ml-2 align-middle" style={{ background: "var(--mustard)" }}>{league.ruleset}</span>
              )}
            </h1>
            <p className="text-sm text-ink-soft">
              Code <span className="font-mono font-bold tracking-widest">{league.code}</span> ·{" "}
              {coaches.length} coaches · you are <b style={{ color: me?.color }}>{me?.name ?? "a spectator"}</b>
              {isAdmin && " (admin)"}
            </p>
          </div>
          <Link href="/" className="btn btn-ghost text-sm py-2">Leave</Link>
        </div>

        {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

        <div className="paper p-5 mb-6 text-center">
          {draftDone ? (
            <p className="hand text-3xl text-coral">draft complete</p>
          ) : (
            <>
              <p className="hand text-3xl text-coral">{iPick ? "your pick" : `${currentPicker?.name ?? "…"}'s turn`}</p>
              <p className="text-ink-soft mt-1">Pick {wonLots.length + 1} · {poolMons.length} Pokémon left</p>
            </>
          )}
          {iPick && !draftDone && (
            <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 mt-4">
              {poolMons.map((m) => (
                <button key={m.id} disabled={busy} onClick={() => pickMon(m.id)}
                  className="paper p-2 text-center hover:-translate-y-0.5 transition disabled:opacity-50" title={m.display}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={spriteSmall(m.id)} alt={m.display} width={56} height={56} loading="lazy" className="mx-auto"
                    onError={(e) => { (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                  <span className="block text-xs truncate">{m.display}</span>
                </button>
              ))}
            </div>
          )}
          {!iPick && !draftDone && (
            <p className="text-ink-soft text-sm mt-2">Waiting for {currentPicker?.name ?? "the next picker"} to choose.</p>
          )}
        </div>

        <h3 className="font-display text-xl font-bold mb-3">Teams</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coaches.map((c) => {
            const picks = wonLots.filter((l) => l.winner_coach_id === c.id);
            const onTurn = !draftDone && currentPicker?.id === c.id;
            return (
              <div key={c.id} className="paper p-4"
                style={{ borderTop: `5px solid ${c.color}`, outline: onTurn ? `2px solid ${c.color}` : undefined }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-bold text-lg">{c.name}{c.is_admin && " (host)"}</span>
                  <span className="text-sm text-ink-soft">{picks.length} picks</span>
                </div>
                <div className="mt-3 space-y-2 min-h-10">
                  {picks.length === 0 && <p className="text-sm text-ink-soft italic">No picks yet</p>}
                  {picks.map((l) => {
                    const m = monMap.get(l.mon_id);
                    return (
                      <div key={l.id} className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={spriteSmall(l.mon_id)} alt="" width={32} height={32} loading="lazy"
                          onError={(e) => { if (m) (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                        <span className="text-sm flex-1 truncate">{m?.display ?? l.mon_id}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
        <div>
          <h1 className="font-display text-3xl font-black">
            {league.name} <span className="hand text-coral text-2xl font-normal">live</span>
            {league.ruleset && (
              <span className="chip ml-2 align-middle" style={{ background: "var(--mustard)" }}>{league.ruleset}</span>
            )}
          </h1>
          <p className="text-sm text-ink-soft">
            Code <span className="font-mono font-bold tracking-widest">{league.code}</span> ·{" "}
            {coaches.length} coaches · {MODE_LABEL[mode] ?? mode} · you are{" "}
            <b style={{ color: me?.color }}>{me?.name ?? "a spectator"}</b>
            {isAdmin && " (admin)"}
          </p>
        </div>
        <Link href="/" className="btn btn-ghost text-sm py-2">Leave</Link>
      </div>

      {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* Stage */}
        <div className="paper creased p-6 relative">
          {currentMon ? (
            <>
              <div className="flex items-start gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteUrl(currentMon.id)} alt={currentMon.display} width={150} height={150}
                  className="drop-shadow-md shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).src = spriteUrl(currentMon.baseId); }} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display text-3xl font-black">{currentMon.display}</h2>
                    {currentMon.isMega && <span className="chip" style={{ background: "var(--indigo)" }}>Mega</span>}
                    <span className="chip" style={{ background: TIER_COLORS[league.pool[currentMon.id]] ?? "var(--ink)" }}>
                      Tier {league.pool[currentMon.id] ?? "?"}
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {currentMon.types.map((t) => (
                      <span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>{t}</span>
                    ))}
                  </div>
                  <p className="mt-2.5 text-sm text-ink-soft">
                    <span className="font-semibold text-ink">{currentMon.isMega ? "Mega ability:" : "Abilities:"}</span>{" "}
                    {currentMon.abilities.join(" · ") || "—"}
                  </p>
                  <p className="mt-4 text-ink-soft">
                    {highCoach ? (
                      <>High bid <span className="font-display text-2xl font-black" style={{ color: highCoach.color }}>{highBid!.amount}</span> by <b>{highCoach.name}</b></>
                    ) : (
                      <>Opening at <span className="font-display text-2xl font-black">{OPENING}</span></>
                    )}
                  </p>
                </div>
              </div>

              {isAdmin && (
                <div className="mt-6 flex gap-3 border-t border-dashed border-paper-edge pt-4">
                  <button className="btn btn-coral" onClick={() => act(() => sellLot(activeLot!))} disabled={!highCoach}>Sold!</button>
                  <button className="btn btn-ghost" onClick={() => act(() => passLot(activeLot!.id))}>Pass</button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-14">
              <p className="hand text-3xl text-coral">
                {iNominate ? "your turn to nominate ↓"
                  : iRevealRandom ? "reveal the random pick ↓"
                  : isRandomTurn ? "waiting for a random Pokémon…"
                  : `waiting for ${nominator?.name ?? "the admin"}…`}
              </p>
              <p className="text-ink-soft mt-1">
                {iNominate ? "Pick from the pool below to open bidding."
                  : iRevealRandom ? "Spin up the next random Pokémon."
                  : "The next Pokémon will appear here."}
              </p>
            </div>
          )}
        </div>

        {/* Live bids + bidding */}
        <div className="paper p-5">
          <h3 className="font-display text-lg font-bold mb-3">Live bids</h3>
          <div className="space-y-2 max-h-56 overflow-auto pr-1">
            {bids.length === 0 && <p className="text-sm text-ink-soft italic">No bids yet.</p>}
            {bids.map((b) => {
              const c = coaches.find((x) => x.id === b.coach_id);
              return (
                <div key={b.id} className="flex items-center justify-between rounded bg-white/40 px-3 py-1.5"
                  style={{ borderLeft: `4px solid ${c?.color ?? "#888"}` }}>
                  <span className="font-bold">{c?.name ?? "?"}</span>
                  <span className="font-display font-black">{b.amount}</span>
                </div>
              );
            })}
          </div>

          {me && activeLot && (
            <div className="mt-4 border-t border-dashed border-paper-edge pt-3">
              {iAmHigh ? (
                <p className="text-sm text-teal-700 font-semibold">You have the top bid.</p>
              ) : (
                <>
                  <p className="text-xs text-ink-soft mb-1.5">Raise by:</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {INCREMENTS.map((step) => (
                      <button key={step} onClick={() => setIncrement(step)}
                        className={`btn text-sm px-3 py-1.5 ${increment === step ? "btn-coral" : "btn-ghost"}`}
                        disabled={!highBid && step !== 1}>+{step}</button>
                    ))}
                  </div>
                  <button className="btn btn-teal w-full" disabled={!canBid} onClick={submitBid}>
                    {remaining(me) < nextBid ? "Not enough points" : `Bid ${nextBid}`}
                  </button>
                  <p className="text-xs text-ink-soft mt-1 text-center">{remaining(me)} points left</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Nomination — pool picker for the current nominator */}
      {!activeLot && iNominate && (
        <div className="mt-6">
          <h3 className="font-display text-xl font-bold mb-3">
            {mode === "admin" ? "Nominate from your pool" : `${me?.name}, nominate a Pokémon`} ({poolMons.length} left)
          </h3>
          <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {poolMons.map((m) => (
              <button key={m.id} onClick={() => act(() => nominate(league.id, m.id))}
                className="paper p-2 text-center hover:-translate-y-0.5 transition" title={m.display}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteSmall(m.id)} alt={m.display} width={56} height={56} loading="lazy" className="mx-auto"
                  onError={(e) => { (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                <span className="block text-xs truncate">{m.display}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Nomination — random reveal (one-nominated-one-random mode) */}
      {!activeLot && iRevealRandom && (
        <div className="mt-6 text-center">
          <button className="btn btn-coral text-lg px-7 py-3" onClick={revealRandom} disabled={!poolMons.length}>
            Reveal random Pokémon
          </button>
          <p className="text-sm text-ink-soft mt-2">{poolMons.length} still in the pool</p>
        </div>
      )}

      {/* Rosters */}
      <h3 className="font-display text-xl font-bold mt-8 mb-3">Teams</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {coaches.map((c) => {
          const picks = wonLots.filter((l) => l.winner_coach_id === c.id);
          return (
            <div key={c.id} className="paper p-4" style={{ borderTop: `5px solid ${c.color}` }}>
              <div className="flex items-baseline justify-between">
                <span className="font-display font-bold text-lg">{c.name}{c.is_admin && " (host)"}</span>
                <span className="text-sm text-ink-soft">{remaining(c)} pts</span>
              </div>
              <div className="mt-3 space-y-2 min-h-10">
                {picks.length === 0 && <p className="text-sm text-ink-soft italic">No picks yet</p>}
                {picks.map((l) => {
                  const m = monMap.get(l.mon_id);
                  return (
                    <div key={l.id} className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={spriteSmall(l.mon_id)} alt="" width={32} height={32} loading="lazy"
                        onError={(e) => { if (m) (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                      <span className="text-sm flex-1 truncate">{m?.display ?? l.mon_id}</span>
                      <span className="text-xs text-ink-soft font-mono">{l.final_price}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-center text-ink-soft p-10">{children}</div>;
}
