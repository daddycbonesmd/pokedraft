"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getLeagueByCode, getRoomState, createBattle, listBattles, getIdentity,
  type Coach, type Battle, type League,
} from "@/lib/db";
import { teamToShowdown, setReady } from "@/lib/teambuilder";
import { supabaseReady } from "@/lib/supabase";

const rand = () => Math.floor(Math.random() * 65536);
const teamReady = (c: Coach) => Array.isArray(c.team) && c.team.some(setReady);

export default function Play({ code }: { code: string }) {
  const router = useRouter();
  const [league, setLeague] = useState<League | null>(null);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [oppTeam, setOppTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const identity = useMemo(() => getIdentity(code), [code]);
  const myCoach = coaches.find((c) => c.id === identity?.coachId) ?? null;

  async function load() {
    const lg = await getLeagueByCode(code);
    if (!lg) { setFatal("That league doesn't exist."); return; }
    setLeague(lg);
    const [state, bs] = await Promise.all([getRoomState(lg.id), listBattles(lg.id)]);
    setCoaches(state.coaches);
    setBattles(bs);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [code]);
  // Default the AI opponent to your own team (a mirror match) so practice is one click.
  useEffect(() => { if (!oppTeam && myCoach && teamReady(myCoach)) setOppTeam(myCoach.id); }, [coaches]); // eslint-disable-line

  async function start() {
    setError("");
    if (!league) return;
    if (!p1 || !p2 || p1 === p2) return setError("Pick two different coaches.");
    const c1 = coaches.find((c) => c.id === p1);
    const c2 = coaches.find((c) => c.id === p2);
    if (!c1 || !c2) return setError("Pick two coaches.");
    if (!teamReady(c1) || !teamReady(c2)) return setError("Both coaches need a battle-ready team (build one on the Team page).");
    setBusy(true);
    try {
      const { packTeam } = await import("@/lib/battle");
      const t1 = packTeam(teamToShowdown(c1.team!));
      const t2 = packTeam(teamToShowdown(c2.team!));
      const battle = await createBattle({
        leagueId: league.id,
        format: league.battle_format ?? "doubles",
        p1: { coachId: c1.id, name: c1.name, team: t1 },
        p2: { coachId: c2.id, name: c2.name, team: t2 },
        seed: [rand(), rand(), rand(), rand()],
      });
      router.push(`/battle/${battle.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the battle.");
      setBusy(false);
    }
  }

  async function startPractice() {
    setError("");
    if (!league) return;
    if (!myCoach) return setError("Join this league as a coach (from the room) to practice.");
    if (!teamReady(myCoach)) return setError("Build a battle-ready team first (Team page).");
    const opp = coaches.find((c) => c.id === oppTeam);
    if (!opp || !teamReady(opp)) return setError("Pick the AI opponent's team.");
    setBusy(true);
    try {
      const { packTeam } = await import("@/lib/battle");
      const battle = await createBattle({
        leagueId: league.id,
        format: league.battle_format ?? "doubles",
        p1: { coachId: myCoach.id, name: myCoach.name, team: packTeam(teamToShowdown(myCoach.team!)) },
        p2: { coachId: null, name: "Computer", team: packTeam(teamToShowdown(opp.team!)) },
        seed: [rand(), rand(), rand(), rand()],
      });
      router.push(`/battle/${battle.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start practice.");
      setBusy(false);
    }
  }

  if (!supabaseReady) return <Centered>Supabase isn&apos;t connected.</Centered>;
  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!league) return <Centered><span className="hand text-3xl text-coral">loading…</span></Centered>;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-display text-3xl font-black">Battles</h1>
          <p className="text-sm text-ink-soft">
            League <span className="font-mono font-bold">{code}</span> ·{" "}
            <span className="capitalize font-semibold text-ink">{league.battle_format ?? "doubles"}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/team/${code}`} className="btn btn-ghost text-sm py-2">Team</Link>
          <Link href={`/room/${code}`} className="btn btn-ghost text-sm py-2">← Room</Link>
        </div>
      </div>

      {/* Practice vs AI — solo testing */}
      <div className="paper p-5 mb-4" style={{ borderTop: "4px solid var(--teal)" }}>
        <h2 className="font-display font-bold mb-1">⚡ Practice vs AI</h2>
        <p className="text-xs text-ink-soft mb-3">
          Play a battle solo — you control {myCoach ? <b className="text-ink">{myCoach.name}</b> : "your team"}, the computer plays the other side.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-ink-soft">AI opponent&apos;s team</span>
            <select className="w-full mt-1 bg-white/60 rounded px-2 py-2 outline-none" value={oppTeam} onChange={(e) => setOppTeam(e.target.value)}>
              <option value="">Choose…</option>
              {coaches.filter(teamReady).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.id === myCoach?.id ? " (mirror)" : ""}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-teal w-full" onClick={startPractice} disabled={busy || !myCoach}>
            {busy ? "Starting…" : "Start practice"}
          </button>
        </div>
      </div>

      {/* Start a battle */}
      <div className="paper p-5">
        <h2 className="font-display font-bold mb-3">Start a battle</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <CoachPick label="Player 1" coaches={coaches} value={p1} onChange={setP1} />
          <CoachPick label="Player 2" coaches={coaches} value={p2} onChange={setP2} />
        </div>
        {error && <p className="text-coral text-sm mt-2">{error}</p>}
        <button className="btn btn-coral w-full mt-3" onClick={start} disabled={busy}>
          {busy ? "Starting…" : "Start battle"}
        </button>
        <p className="text-xs text-ink-soft mt-2">Only coaches with a battle-ready team can play. Build teams on the Team page.</p>
      </div>

      {/* Ongoing / past battles */}
      <h2 className="font-display font-bold mt-6 mb-2">Recent battles</h2>
      <div className="space-y-2">
        {battles.length === 0 && <p className="text-ink-soft text-sm">No battles yet.</p>}
        {battles.map((b) => (
          <Link key={b.id} href={`/battle/${b.id}`} className="paper p-3 flex items-center justify-between hover:-translate-y-0.5 transition">
            <span className="font-semibold">{b.p1_name} <span className="text-ink-soft">vs</span> {b.p2_name}</span>
            <span className="text-sm text-ink-soft">
              {b.status === "done" ? (b.winner === "tie" ? "tie" : `${b.winner} won`) : "in progress"}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function CoachPick({ label, coaches, value, onChange }: { label: string; coaches: Coach[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
      <select className="w-full mt-1 bg-white/60 rounded px-2 py-2 outline-none" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {coaches.map((c) => (
          <option key={c.id} value={c.id} disabled={!teamReady(c)}>
            {c.name}{teamReady(c) ? "" : " (no team)"}
          </option>
        ))}
      </select>
    </label>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[60vh] grid place-items-center text-center px-4"><div>{children}</div></main>;
}
