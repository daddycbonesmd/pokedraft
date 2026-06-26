"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  getLeagueByCode, getRoomState, getIdentity, saveTournament, subscribeLeague,
  type League, type Coach,
} from "@/lib/db";
import {
  buildTournament, participants, standings, slotState, resolveByes, FORMAT_LABEL,
  type Tournament, type TFormat, type TMatch,
} from "@/lib/tournament";
import { supabaseReady } from "@/lib/supabase";
import { EnvNotice } from "./HostLeague";

export default function TournamentView({ code }: { code: string }) {
  const [league, setLeague] = useState<League | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const [seedOrder, setSeedOrder] = useState<string[]>([]);
  const leagueIdRef = useRef<string | null>(null);
  const identity = useMemo(() => getIdentity(code), [code]);

  const refresh = useCallback(async () => {
    if (!leagueIdRef.current) return;
    const s = await getRoomState(leagueIdRef.current);
    setLeague(s.league);
    setCoaches(s.coaches);
  }, []);

  useEffect(() => {
    if (!supabaseReady) return;
    let cleanup = () => {};
    (async () => {
      const lg = await getLeagueByCode(code);
      if (!lg) return setFatal("That league code doesn't exist.");
      leagueIdRef.current = lg.id;
      await refresh();
      cleanup = subscribeLeague(lg.id, refresh);
    })();
    return () => cleanup();
  }, [code, refresh]);

  if (!supabaseReady) return <EnvNotice />;
  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!league) return <Centered><span className="hand text-3xl text-coral">loading…</span></Centered>;

  const isAdmin = Boolean(identity?.adminToken && identity.adminToken === league.admin_token);
  const me = coaches.find((c) => c.id === identity?.coachId) ?? null;
  const t = league.tournament;
  const name = (id: string | null) => coaches.find((c) => c.id === id)?.name ?? (id ? "—" : "");
  const color = (id: string | null) => coaches.find((c) => c.id === id)?.color ?? "#888";

  async function mutate(fn: (t: Tournament) => void) {
    if (!t) return;
    setError("");
    try {
      const next: Tournament = structuredClone(t);
      fn(next);
      resolveByes(next);
      await saveTournament(league!.id, next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  async function create(format: TFormat) {
    setError("");
    const seeds = seedOrder.length ? seedOrder : coaches.map((c) => c.id);
    try { await saveTournament(league!.id, buildTournament(format, seeds)); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
  }

  const report = (m: TMatch, winner: string) =>
    mutate((tt) => { const x = tt.matches.find((q) => q.id === m.id)!; x.reportWinner = winner; x.reportBy = me?.id ?? null; x.status = "reported"; });
  const setWinner = (m: TMatch, winner: string) =>
    mutate((tt) => { const x = tt.matches.find((q) => q.id === m.id)!; x.winner = winner; x.status = "confirmed"; });
  const resetMatch = (m: TMatch) =>
    mutate((tt) => { const x = tt.matches.find((q) => q.id === m.id)!; x.winner = null; x.status = "pending"; x.reportWinner = null; x.reportBy = null; });

  // ── No tournament yet ──────────────────────────────────────────
  if (!t) {
    const order = seedOrder.length ? seedOrder : coaches.map((c) => c.id);
    return (
      <main className="max-w-xl mx-auto px-4 py-10">
        <TopLinks code={code} />
        <h1 className="font-display text-4xl font-black mt-1 mb-2">Tournament</h1>
        {error && <p className="text-coral text-sm mb-3">{error}</p>}
        {!isAdmin ? (
          <p className="text-ink-soft">Waiting for the admin to start the tournament.</p>
        ) : coaches.length < 2 ? (
          <p className="text-ink-soft">Need at least 2 coaches to start a tournament.</p>
        ) : (
          <div className="paper p-6 space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-ink-soft">Seeding ({coaches.length})</span>
                <button className="btn btn-ghost text-xs py-1" onClick={() => setSeedOrder([...order].sort(() => Math.random() - 0.5))}>Shuffle</button>
              </div>
              <ol className="space-y-1 list-decimal list-inside">
                {order.map((id) => <li key={id} className="text-sm">{name(id)}</li>)}
              </ol>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-soft mb-2">Choose a format</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-coral" onClick={() => create("single")}>Single elimination</button>
                <button className="btn btn-coral" onClick={() => create("double")}>Double elimination</button>
                <button className="btn btn-teal" onClick={() => create("round_robin")}>Round robin</button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ── Match card ─────────────────────────────────────────────────
  const byId = new Map(t.matches.map((m) => [m.id, m]));
  function MatchCard({ m }: { m: TMatch }) {
    const { a, b } = participants(m, byId);
    const ready = Boolean(a && b);
    const iPlay = Boolean(me && (me.id === a || me.id === b));
    const slot = (id: string | null, fallback: string) => (
      <div className="flex items-center justify-between px-2 py-1 rounded"
        style={{ background: m.winner && m.winner === id ? color(id) : "rgba(255,255,255,0.4)", color: m.winner === id ? "#fff" : undefined }}>
        <span className="text-sm font-bold truncate">{id ? name(id) : fallback}</span>
        {isAdmin && ready && <button className="text-xs underline ml-2 shrink-0" onClick={() => setWinner(m, id!)}>win</button>}
      </div>
    );
    return (
      <div className="paper p-2 w-52">
        {m.label && <p className="text-[11px] text-ink-soft mb-1">{m.label}</p>}
        <div className="space-y-1">
          {slot(a, slotState(m, "a", byId) === "empty" ? "(bye)" : "TBD")}
          {slot(b, slotState(m, "b", byId) === "empty" ? "(bye)" : "TBD")}
        </div>
        {ready && (
          <div className="mt-2 border-t border-dashed border-paper-edge pt-1.5 text-xs">
            {m.status === "confirmed" ? (
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Winner: <b>{name(m.winner)}</b></span>
                {isAdmin && <button className="underline" onClick={() => resetMatch(m)}>edit</button>}
              </div>
            ) : m.status === "reported" ? (
              <div>
                <p className="text-ink-soft mb-1">Reported: <b>{name(m.reportWinner ?? null)}</b> won {m.reportBy ? `(by ${name(m.reportBy)})` : ""}</p>
                {isAdmin ? (
                  <div className="flex gap-1">
                    <button className="btn btn-teal text-xs py-1 flex-1" onClick={() => setWinner(m, m.reportWinner!)}>Confirm</button>
                    <button className="btn btn-ghost text-xs py-1" onClick={() => resetMatch(m)}>Reject</button>
                  </div>
                ) : <p className="text-ink-soft italic">awaiting admin</p>}
              </div>
            ) : iPlay ? (
              <div>
                <p className="text-ink-soft mb-1">Report winner:</p>
                <div className="flex gap-1">
                  <button className="btn btn-ghost text-xs py-1 flex-1" onClick={() => report(m, a!)}>{name(a)}</button>
                  <button className="btn btn-ghost text-xs py-1 flex-1" onClick={() => report(m, b!)}>{name(b)}</button>
                </div>
              </div>
            ) : isAdmin ? (
              <p className="text-ink-soft italic">use the “win” buttons to set a result</p>
            ) : <p className="text-ink-soft italic">not yet played</p>}
          </div>
        )}
      </div>
    );
  }

  function BracketSection({ title, matches }: { title?: string; matches: TMatch[] }) {
    const rs = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b);
    return (
      <div>
        {title && <h3 className="font-display text-lg font-bold mb-2">{title}</h3>}
        <div className="flex gap-6 overflow-x-auto pb-2">
          {rs.map((r) => (
            <div key={r} className="flex flex-col gap-4 justify-around shrink-0">
              {matches.filter((m) => m.round === r).map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <TopLinks code={code} />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1 mb-5">
        <h1 className="font-display text-3xl font-black">
          {league.name} <span className="hand text-coral text-2xl font-normal">{FORMAT_LABEL[t.format]}</span>
        </h1>
        {isAdmin && (
          <button className="btn btn-ghost text-sm py-2" onClick={() => { if (confirm("Reset the whole tournament?")) saveTournament(league.id, null).then(refresh); }}>
            Reset tournament
          </button>
        )}
      </div>
      {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

      {t.format === "round_robin" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="paper p-4 h-fit">
            <h3 className="font-display font-bold mb-2">Standings</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-ink-soft text-left"><th>Coach</th><th className="text-right">W</th><th className="text-right">L</th></tr></thead>
              <tbody>
                {standings(t).map((r) => (
                  <tr key={r.id}><td className="py-0.5">{name(r.id)}</td><td className="text-right">{r.wins}</td><td className="text-right">{r.losses}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            {t.matches.map((m) => <MatchCard key={m.id} m={m} />)}
          </div>
        </div>
      ) : t.format === "double" ? (
        <div className="space-y-6">
          <BracketSection title="Winners bracket" matches={t.matches.filter((m) => m.bracket === "W")} />
          <BracketSection title="Losers bracket" matches={t.matches.filter((m) => m.bracket === "L")} />
          <BracketSection title="Grand final" matches={t.matches.filter((m) => m.bracket === "GF")} />
        </div>
      ) : (
        <BracketSection matches={t.matches} />
      )}
    </main>
  );
}

function TopLinks({ code }: { code: string }) {
  return (
    <div className="flex gap-4 text-sm">
      <Link href="/" className="text-ink-soft hover:underline">← Home</Link>
      <Link href={`/room/${code}`} className="text-coral hover:underline">← Back to draft room</Link>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-center text-ink-soft p-10">{children}</div>;
}
