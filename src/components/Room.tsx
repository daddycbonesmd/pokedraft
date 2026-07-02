"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  loadPokedex,
  loadAbilities,
  loadMoves,
  spriteUrl,
  spriteSmall,
  TYPE_COLORS,
  TIER_COLORS,
  valueForTier,
  defenseProfile,
  type PokeMon,
  type MovesData,
} from "@/lib/pokedex";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const moveTitle = (mv: string, info?: { t: string; p: number | null; c: string; d: string }) =>
  info ? [cap(info.t), cap(info.c), info.p ? `${info.p} BP` : null].filter(Boolean).join(" · ") + (info.d ? ` — ${info.d}` : "") : mv;

// A type-coloured move chip with a hover card showing its description.
function MoveChip({ name, info }: { name: string; info?: { t: string; p: number | null; c: string; d: string } }) {
  return (
    <span className="group relative cursor-help text-xs font-semibold rounded px-2 py-0.5 text-white"
      title={moveTitle(name, info)} style={{ background: TYPE_COLORS[info?.t ?? ""] ?? "var(--ink-soft)" }}>
      {name}
      {info && (
        <span className="pointer-events-none absolute z-30 left-0 bottom-full mb-1 hidden group-hover:block w-56 rounded-md p-2 shadow-xl text-left normal-case font-normal"
          style={{ background: "var(--ink)", color: "var(--paper)" }}>
          <b className="font-bold">{name}</b> · {cap(info.t)} · {cap(info.c)}{info.p ? ` · ${info.p} BP` : ""}
          {info.d && <span className="block mt-1 opacity-90">{info.d}</span>}
        </span>
      )}
    </span>
  );
}

function TypeEffect({ types }: { types: string[] }) {
  const dp = defenseProfile(types);
  const chip = (t: string, suffix = "") => (
    <span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>{t}{suffix}</span>
  );
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-baseline gap-1.5 flex-wrap mt-1">
      <span className="text-xs font-semibold text-ink-soft w-16 shrink-0">{label}</span>
      {children}
    </div>
  );
  return (
    <div className="mt-2.5">
      {dp.weak.length > 0 && <Row label="Weak to">{dp.weak.map(({ t, x }) => chip(t, x === 4 ? " ×4" : ""))}</Row>}
      {dp.resist.length > 0 && <Row label="Resists">{dp.resist.map(({ t, x }) => chip(t, x === 0.25 ? " ×¼" : ""))}</Row>}
      {dp.immune.length > 0 && <Row label="Immune">{dp.immune.map((t) => chip(t))}</Row>}
    </div>
  );
}

type PoolFilterProps = {
  search: string; setSearch: (v: string) => void; type: string; setType: (v: string) => void;
  tier: string; setTier: (v: string) => void; ability: string; setAbility: (v: string) => void;
  types: string[]; tiers: string[]; abilities: string[]; count: number;
};
function PoolFilter(p: PoolFilterProps) {
  return (
    <div className="paper p-3 mb-3 flex flex-wrap gap-2 items-center text-left">
      <input value={p.search} onChange={(e) => p.setSearch(e.target.value)} placeholder="Search Pokémon…"
        className="bg-white/50 rounded px-3 py-1.5 outline-none flex-1 min-w-36" />
      <select value={p.type} onChange={(e) => p.setType(e.target.value)} className="bg-white/50 rounded px-2 py-1.5 outline-none capitalize">
        <option value="all">All types</option>
        {p.types.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
      </select>
      <select value={p.tier} onChange={(e) => p.setTier(e.target.value)} className="bg-white/50 rounded px-2 py-1.5 outline-none">
        <option value="all">All tiers</option>
        {p.tiers.map((t) => <option key={t} value={t}>Tier {t}</option>)}
      </select>
      <select value={p.ability} onChange={(e) => p.setAbility(e.target.value)} className="bg-white/50 rounded px-2 py-1.5 outline-none max-w-44">
        <option value="all">All abilities</option>
        {p.abilities.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <span className="text-xs text-ink-soft">{p.count} shown</span>
    </div>
  );
}

function AdminTeamSize({ size, onChange }: { size: number; onChange: (delta: number) => void }) {
  return (
    <div className="paper flex items-center gap-1 px-2 py-1 text-sm" title="Pokémon per team (host only)">
      <span className="text-ink-soft font-semibold">Team</span>
      <button className="w-6 h-6 leading-none font-bold rounded hover:bg-black/5 disabled:opacity-30"
        onClick={() => onChange(-1)} disabled={size <= 1} aria-label="Smaller teams">−</button>
      <span className="w-5 text-center font-bold tabular-nums">{size}</span>
      <button className="w-6 h-6 leading-none font-bold rounded hover:bg-black/5 disabled:opacity-30"
        onClick={() => onChange(1)} disabled={size >= 30} aria-label="Bigger teams">+</button>
    </div>
  );
}

const STAT_ROWS: [string, keyof PokeMon["stats"]][] = [["HP", "hp"], ["Atk", "atk"], ["Def", "def"], ["SpA", "spa"], ["SpD", "spd"], ["Spe", "spe"]];
function StatBars({ stats }: { stats: PokeMon["stats"] }) {
  const total = stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe;
  const color = (v: number) => (v >= 130 ? "#2f8f83" : v >= 100 ? "#5867a8" : v >= 70 ? "#dca23e" : "#d9594c");
  return (
    <div>
      <span className="font-semibold text-ink text-sm">Base stats <span className="text-ink-soft font-normal">({total})</span></span>
      <div className="mt-1 space-y-1">
        {STAT_ROWS.map(([label, key]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span className="w-8 text-ink-soft font-semibold">{label}</span>
            <span className="w-7 text-right font-mono">{stats[key]}</span>
            <div className="flex-1 h-1.5 rounded bg-black/10">
              <div className="h-full rounded" style={{ width: `${Math.min(100, (stats[key] / 200) * 100)}%`, background: color(stats[key]) }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
import {
  getLeagueByCode,
  getRoomState,
  getIdentity,
  subscribeRoom,
  nominate,
  placeBid,
  pickDirect,
  clearLots,
  bulkPick,
  buyLot,
  sellLot,
  passLot,
  setLeagueTeamSize,
  type RoomState,
  type Coach,
  type Bid,
  type Lot,
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
  const [abilities, setAbilities] = useState<Record<string, string>>({});
  const [moves, setMoves] = useState<MovesData>({ byMon: {}, info: {} });
  const [increment, setIncrement] = useState(1);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [pSearch, setPSearch] = useState("");
  const [pType, setPType] = useState("all");
  const [pTier, setPTier] = useState("all");
  const [pAbility, setPAbility] = useState("all");
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
      loadAbilities().then(setAbilities);
      loadMoves().then(setMoves);
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

  // ── Auto-sell countdown ──────────────────────────────────────────
  // No new bid for 5s → 3·2·1·0 → after 2s on 0 the admin client auto-sells.
  // Timing is tracked locally (Date.now) so it's immune to client/server skew.
  const [now, setNow] = useState(() => Date.now());
  const lastBidRef = useRef(Date.now());
  const soldRef = useRef(false);
  const passedRef = useRef(false);
  const activeLotId = state?.activeLot?.id ?? null;
  const topBidId = state?.bids?.[0]?.id ?? null;
  useEffect(() => { lastBidRef.current = Date.now(); soldRef.current = false; passedRef.current = false; setNow(Date.now()); }, [activeLotId, topBidId]);
  useEffect(() => {
    if (!activeLotId) return;
    const iv = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(iv);
  }, [activeLotId]);
  useEffect(() => {
    if (!state || soldRef.current) return;
    const admin = Boolean(identity?.adminToken && identity.adminToken === state.league.admin_token);
    const lot = state.activeLot, top = state.bids?.[0];
    if (admin && lot && top && Date.now() - lastBidRef.current >= 10000) {
      soldRef.current = true;
      sellLot(lot).then(refresh).catch(() => { soldRef.current = false; refresh(); });
    }
  }, [now, state, identity, refresh]);

  // ── No-bid auto-pass ─────────────────────────────────────────────
  // In a bidding auction, a lot nobody bids on within 4s is passed automatically
  // (the admin client is the authority, mirroring the auto-sell above). Point-buy
  // and random-team modes don't bid, so they're excluded.
  useEffect(() => {
    if (!state || passedRef.current) return;
    const admin = Boolean(identity?.adminToken && identity.adminToken === state.league.admin_token);
    const m = state.league.nomination_mode;
    const auctionMode = m === "admin" || m === "snake" || m === "one_random" || m === "auction_random";
    const lot = state.activeLot;
    if (admin && auctionMode && lot && (state.bids?.length ?? 0) === 0 && Date.now() - lastBidRef.current >= 14000) {
      passedRef.current = true;
      passLot(lot.id).then(refresh).catch(() => { passedRef.current = false; refresh(); });
    }
  }, [now, state, identity, refresh]);

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
  // Countdown: 3 (5s) → 2 → 1 → 0 (8s, held 2s) → sold (10s). Only with a standing bid.
  const idleMs = activeLot ? now - lastBidRef.current : 0;
  const countdownNum = highCoach && idleMs >= 5000 ? Math.max(0, 3 - Math.floor((idleMs - 5000) / 1000)) : null;

  const spent = (c: Coach) => wonLots.filter((l) => l.winner_coach_id === c.id).reduce((s, l) => s + (l.final_price ?? 0), 0);
  const remaining = (c: Coach) => league.budget - spent(c);

  const teamSize = league.team_size;
  const teamCount = (c: Coach) => wonLots.filter((l) => l.winner_coach_id === c.id).length;
  const isFull = (c: Coach) => teamCount(c) >= teamSize;

  // Admin can resize teams any time (e.g. bump a league that was set too small).
  function changeTeamSize(delta: number) {
    const next = Math.max(1, Math.min(30, teamSize + delta));
    if (next === teamSize) return;
    setState((s) => (s ? { ...s, league: { ...s.league, team_size: next } } : s));
    setLeagueTeamSize(league.id, next).then(refresh)
      .catch((e) => { setError(e instanceof Error ? e.message : "Could not change team size."); refresh(); });
  }
  const teamSizeControl = isAdmin ? <AdminTeamSize size={teamSize} onChange={changeTeamSize} /> : null;
  const allFull = coaches.length > 0 && coaches.every(isFull);

  const iAmHigh = Boolean(me && highCoach && me.id === highCoach.id);
  const canBid = Boolean(me && activeLot && !iAmHigh && !isFull(me!) && remaining(me!) >= nextBid);

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

  // Search/filter for the nomination & pick grids.
  const poolTypes = [...new Set(poolMons.flatMap((m) => m.types))].sort();
  const poolTiers = ["S", "A", "B", "C", "D"].filter((t) => poolMons.some((m) => league.pool[m.id] === t));
  const poolAbilities = [...new Set(poolMons.flatMap((m) => m.abilities))].sort();
  const filteredPool = poolMons.filter((m) => {
    if (pSearch && !m.display.toLowerCase().includes(pSearch.toLowerCase())) return false;
    if (pType !== "all" && !m.types.includes(pType)) return false;
    if (pTier !== "all" && league.pool[m.id] !== pTier) return false;
    if (pAbility !== "all" && !m.abilities.includes(pAbility)) return false;
    return true;
  });
  const poolFilterProps = {
    search: pSearch, setSearch: setPSearch, type: pType, setType: setPType,
    tier: pTier, setTier: setPTier, ability: pAbility, setAbility: setPAbility,
    types: poolTypes, tiers: poolTiers, abilities: poolAbilities, count: filteredPool.length,
  };

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
    auction_random: "fully random auction", snake_draft: "point buy (snake)",
    pointbuy_random: "point buy (random)", full_random: "random teams",
  };
  let nominatorId: string | null = null;
  let isRandomTurn = false;
  if (mode === "admin") {
    nominatorId = players.find((p) => p.is_admin)?.id ?? null;
  } else if (mode === "snake") {
    nominatorId = players[snakeIdx(finishedCount)]?.id ?? null;
  } else if (mode === "auction_random") {
    isRandomTurn = true; // every lot is a random reveal
  } else if (mode === "one_random") {
    // even turns are a coach nomination, odd turns are a random reveal
    if (finishedCount % 2 === 0) nominatorId = players[snakeIdx(finishedCount / 2)]?.id ?? null;
    else isRandomTurn = true;
  }
  const nominator = players.find((p) => p.id === nominatorId) ?? null;
  const iNominate = Boolean(me && nominatorId && me.id === nominatorId);
  const iRevealRandom = isRandomTurn && isAdmin;

  function revealRandom() {
    if (!poolMons.length) return;
    const m = poolMons[Math.floor(Math.random() * poolMons.length)];
    nominateMon(m.id);
  }

  // Point-buy reveal must persist the real lot before a Buy can target it (no optimistic id).
  function revealForBuy() {
    if (!poolMons.length) return;
    const m = poolMons[Math.floor(Math.random() * poolMons.length)];
    act(() => nominate(league.id, m.id));
  }

  // Snake draft (no auction): take turns picking directly, in snake order.
  const isSnake = mode === "snake_draft";
  const currentPicker = isSnake ? players[snakeIdx(finishedCount)] ?? null : null;
  const iPick = Boolean(isSnake && me && currentPicker && me.id === currentPicker.id && !isFull(me));
  const isRandomDraft = mode === "full_random";
  const isPointbuy = mode === "pointbuy_random";

  // No-bid pass countdown: in a bidding auction, a lot with no bids passes after 4s.
  const isAuctionMode = !isSnake && !isRandomDraft && !isPointbuy;
  const noBidMs = activeLot && bids.length === 0 ? now - lastBidRef.current : 0;
  const passCountdown = isAuctionMode && activeLot && !highCoach ? Math.max(0, Math.ceil((14000 - noBidMs) / 1000)) : null;

  const monValue = (monId: number) => valueForTier(league.pool[monId], league.tier_values);

  // Snake pick — show it instantly, then persist (realtime/refresh reconciles).
  function pickMon(monId: number) {
    if (!me || soldIds.has(monId)) return;
    const price = monValue(monId);
    if (remaining(me) < price) { setError("Not enough points for that pick."); return; }
    setError("");
    const optimistic: Lot = {
      id: `temp-${monId}`, league_id: league.id, mon_id: monId, status: "sold",
      winner_coach_id: me.id, final_price: price, created_at: new Date().toISOString(),
    };
    setState((s) => (s ? { ...s, wonLots: [...s.wonLots, optimistic], finishedCount: s.finishedCount + 1 } : s));
    pickDirect(league.id, me.id, monId, price).then(refresh)
      .catch((e) => { setError(e instanceof Error ? e.message : "Pick failed."); refresh(); });
  }

  // Auction nomination — put the Pokémon on stage instantly, then persist.
  function nominateMon(monId: number) {
    setError("");
    const optimistic: Lot = {
      id: `temp-lot-${monId}`, league_id: league.id, mon_id: monId, status: "active",
      winner_coach_id: null, final_price: null, created_at: new Date().toISOString(),
    };
    setState((s) => (s ? { ...s, activeLot: optimistic, bids: [] } : s));
    nominate(league.id, monId).then(refresh)
      .catch((e) => { setError(e instanceof Error ? e.message : "Could not nominate."); refresh(); });
  }

  // Full random: deal teamSize random Pokémon to each coach (replacing any prior result).
  function randomize() {
    if (!coaches.length) return;
    const poolIds = Object.keys(league.pool).map(Number).filter((id) => monMap!.has(id));
    for (let i = poolIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [poolIds[i], poolIds[j]] = [poolIds[j], poolIds[i]];
    }
    const picks: { coachId: string; monId: number; price: number }[] = [];
    let i = 0;
    for (let r = 0; r < teamSize && i < poolIds.length; r++) {
      for (const c of coaches) {
        if (i >= poolIds.length) break;
        const monId = poolIds[i++];
        picks.push({ coachId: c.id, monId, price: monValue(monId) });
      }
    }
    act(async () => { await clearLots(league.id); await bulkPick(league.id, picks); });
  }

  // Point buy random: the current coach buys the offered Pokémon at its point cost.
  function buyOffer() {
    if (!me || !activeLot) return;
    const price = monValue(activeLot.mon_id);
    if (remaining(me) < price) { setError("Not enough points for that."); return; }
    act(() => buyLot(activeLot!.id, me.id, price));
  }

  // Export a coach's team as Pokémon Showdown import text (species skeleton).
  function copyTeam(coach: Coach) {
    const text = wonLots
      .filter((l) => l.winner_coach_id === coach.id)
      .map((l) => {
        const m = monMap!.get(l.mon_id);
        if (!m) return String(l.mon_id);
        const base = m.isMega ? monMap!.get(m.baseId) : null; // Showdown builds megas from the base species + stone
        return (base ?? m).display;
      })
      .join("\n\n");
    navigator.clipboard?.writeText(text);
    setCopied(coach.id);
    setTimeout(() => setCopied((c) => (c === coach.id ? null : c)), 1500);
  }

  if (isSnake) {
    const draftDone = allFull || poolMons.length === 0;
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
          {teamSizeControl}
          <Link href={`/team/${league.code}`} className="btn btn-ghost text-sm py-2">Team</Link>
          <Link href={`/play/${league.code}`} className="btn btn-ghost text-sm py-2">Battle</Link>
          <Link href="/" className="btn btn-ghost text-sm py-2">← Home</Link>
        </div>

        {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

        <div className="paper p-5 mb-6 text-center">
          {draftDone ? (
            <p className="hand text-3xl text-coral">draft complete</p>
          ) : (
            <>
              <p className="hand text-3xl text-coral">{iPick ? "your pick" : `${currentPicker?.name ?? "…"}'s turn`}</p>
              <p className="text-ink-soft mt-1">
                Pick {wonLots.length + 1} · {poolMons.length} left
                {me && <> · <b className="text-ink">{remaining(me)}</b> pts · {teamCount(me)}/{teamSize} drafted</>}
              </p>
            </>
          )}
          {iPick && !draftDone && (
            <div className="mt-4">
              <PoolFilter {...poolFilterProps} />
              <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
              {filteredPool.map((m) => {
                const v = monValue(m.id);
                const afford = !me || remaining(me) >= v;
                return (
                  <button key={m.id} disabled={!afford} onClick={() => pickMon(m.id)}
                    className="paper p-2 text-center hover:-translate-y-0.5 transition disabled:opacity-40" title={`${m.display} · ${v} pts`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={spriteSmall(m.id)} alt={m.display} width={56} height={56} loading="lazy" className="mx-auto"
                      onError={(e) => { (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                    <span className="block text-xs truncate">{m.display}</span>
                    <span className="block text-[11px] font-bold" style={{ color: TIER_COLORS[league.pool[m.id]] ?? "var(--ink-soft)" }}>{v} pts</span>
                  </button>
                );
              })}
              </div>
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
                  <span className="text-sm text-ink-soft">{remaining(c)} pts · {picks.length}/{teamSize}</span>
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
                {picks.length > 0 && (
                  <button onClick={() => copyTeam(c)} className="btn btn-ghost text-xs py-1 mt-3 w-full">
                    {copied === c.id ? "Copied!" : "Copy for Showdown"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (isRandomDraft) {
    const drafted = wonLots.length > 0;
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div>
            <h1 className="font-display text-3xl font-black">
              {league.name} <span className="hand text-coral text-2xl font-normal">random draft</span>
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
          <div className="flex gap-2">
            {teamSizeControl}
            <Link href={`/team/${league.code}`} className="btn btn-ghost text-sm py-2">Team</Link>
            <Link href={`/play/${league.code}`} className="btn btn-ghost text-sm py-2">Battle</Link>
            <Link href={`/tournament/${league.code}`} className="btn btn-ghost text-sm py-2">Tournament</Link>
            <Link href="/" className="btn btn-ghost text-sm py-2">← Home</Link>
          </div>
        </div>

        {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

        <div className="paper p-5 mb-6 text-center">
          {!drafted ? (
            isAdmin ? (
              <>
                <p className="hand text-3xl text-coral">ready to randomize</p>
                <p className="text-ink-soft mt-1">Each coach gets {teamSize} random Pokémon from the pool.</p>
                <button className="btn btn-coral text-lg px-7 py-3 mt-4" onClick={randomize} disabled={!coaches.length}>Randomize teams</button>
              </>
            ) : (
              <p className="hand text-3xl text-coral">waiting for the admin to randomize…</p>
            )
          ) : (
            <>
              <p className="hand text-3xl text-coral">teams are set</p>
              {isAdmin && <button className="btn btn-ghost mt-3" onClick={randomize}>Re-randomize</button>}
            </>
          )}
        </div>

        <h3 className="font-display text-xl font-bold mb-3">Teams</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coaches.map((c) => {
            const picks = wonLots.filter((l) => l.winner_coach_id === c.id);
            const total = picks.reduce((s, l) => s + (l.final_price ?? 0), 0);
            return (
              <div key={c.id} className="paper p-4" style={{ borderTop: `5px solid ${c.color}` }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-bold text-lg">{c.name}{c.is_admin && " (host)"}</span>
                  <span className="text-sm text-ink-soft">{total} pts</span>
                </div>
                <div className="mt-3 space-y-2 min-h-10">
                  {picks.length === 0 && <p className="text-sm text-ink-soft italic">—</p>}
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
                {picks.length > 0 && (
                  <button onClick={() => copyTeam(c)} className="btn btn-ghost text-xs py-1 mt-3 w-full">
                    {copied === c.id ? "Copied!" : "Copy for Showdown"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (isPointbuy) {
    const cp = players[snakeIdx(finishedCount)] ?? null;
    const iTurn = Boolean(me && cp && me.id === cp.id && !isFull(me));
    const offer = activeLot ? monMap.get(activeLot.mon_id) ?? null : null;
    const cost = offer ? monValue(offer.id) : 0;
    const done = allFull || (!offer && poolMons.length === 0);
    return (
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div>
            <h1 className="font-display text-3xl font-black">
              {league.name} <span className="hand text-coral text-2xl font-normal">point buy · random</span>
              {league.ruleset && (<span className="chip ml-2 align-middle" style={{ background: "var(--mustard)" }}>{league.ruleset}</span>)}
            </h1>
            <p className="text-sm text-ink-soft">
              Code <span className="font-mono font-bold tracking-widest">{league.code}</span> · {coaches.length} coaches · you are{" "}
              <b style={{ color: me?.color }}>{me?.name ?? "a spectator"}</b>{isAdmin && " (admin)"}
            </p>
          </div>
          <div className="flex gap-2">
            {teamSizeControl}
            <Link href={`/team/${league.code}`} className="btn btn-ghost text-sm py-2">Team</Link>
            <Link href={`/play/${league.code}`} className="btn btn-ghost text-sm py-2">Battle</Link>
            <Link href={`/tournament/${league.code}`} className="btn btn-ghost text-sm py-2">Tournament</Link>
            <Link href="/" className="btn btn-ghost text-sm py-2">← Home</Link>
          </div>
        </div>

        {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

        <div className="paper creased p-6 mb-6">
          {done ? (
            <p className="hand text-3xl text-coral text-center py-6">draft complete</p>
          ) : offer ? (
            <>
              <div className="flex items-start gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteUrl(offer.id)} alt={offer.display} width={130} height={130} className="drop-shadow-md shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).src = spriteUrl(offer.baseId); }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display text-2xl font-black">{offer.display}</h2>
                    {offer.isMega && <span className="chip" style={{ background: "var(--indigo)" }}>Mega</span>}
                    <span className="chip" style={{ background: TIER_COLORS[league.pool[offer.id]] ?? "var(--ink)" }}>Tier {league.pool[offer.id] ?? "?"}</span>
                    <span className="chip" style={{ background: "var(--ink-soft)" }}>{cost} pts</span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {offer.types.map((t) => (<span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>{t}</span>))}
                  </div>
                  <TypeEffect types={offer.types} />
                  <div className="mt-2.5 max-w-xs"><StatBars stats={offer.stats} /></div>
                  {(moves.byMon[offer.id]?.length ?? 0) > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {moves.byMon[offer.id].map((mv) => (
                        <MoveChip key={mv} name={mv} info={moves.info[mv]} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-5 border-t border-dashed border-paper-edge pt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-ink-soft">{me ? `${remaining(me)} pts left` : ""}</p>
                {iTurn ? (
                  <div className="flex gap-3">
                    <button className="btn btn-teal" disabled={!me || remaining(me) < cost} onClick={buyOffer}>
                      {me && remaining(me) < cost ? "Can't afford" : `Buy · ${cost} pts`}
                    </button>
                    <button className="btn btn-ghost" onClick={() => act(() => passLot(activeLot!.id))}>Pass</button>
                  </div>
                ) : <p className="text-ink-soft text-sm"><b>{cp?.name ?? "…"}</b> is deciding…</p>}
              </div>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="hand text-3xl text-coral">{iTurn ? "your turn" : `${cp?.name ?? "…"}'s turn`}</p>
              {iTurn ? (
                <button className="btn btn-coral text-lg px-7 py-3 mt-3" onClick={revealForBuy} disabled={!poolMons.length}>Reveal a random Pokémon</button>
              ) : <p className="text-ink-soft mt-1">Waiting for {cp?.name ?? "the next coach"} to reveal.</p>}
            </div>
          )}
        </div>

        <h3 className="font-display text-xl font-bold mb-3">Teams</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {coaches.map((c) => {
            const picks = wonLots.filter((l) => l.winner_coach_id === c.id);
            return (
              <div key={c.id} className="paper p-4" style={{ borderTop: `5px solid ${c.color}` }}>
                <div className="flex items-baseline justify-between">
                  <span className="font-display font-bold text-lg">{c.name}{c.is_admin && " (host)"}</span>
                  <span className="text-sm text-ink-soft">{remaining(c)} pts · {picks.length}/{teamSize}</span>
                </div>
                <div className="mt-3 space-y-2 min-h-10">
                  {picks.length === 0 && <p className="text-sm text-ink-soft italic">No picks yet</p>}
                  {picks.map((l) => {
                    const m = monMap.get(l.mon_id);
                    return (
                      <div key={l.id} className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={spriteSmall(l.mon_id)} alt="" width={32} height={32} loading="lazy" onError={(e) => { if (m) (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }} />
                        <span className="text-sm flex-1 truncate">{m?.display ?? l.mon_id}</span>
                        <span className="text-xs text-ink-soft font-mono">{l.final_price}</span>
                      </div>
                    );
                  })}
                </div>
                {picks.length > 0 && (
                  <button onClick={() => copyTeam(c)} className="btn btn-ghost text-xs py-1 mt-3 w-full">{copied === c.id ? "Copied!" : "Copy for Showdown"}</button>
                )}
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
        <div className="flex gap-2">
          {teamSizeControl}
          <Link href={`/team/${league.code}`} className="btn btn-ghost text-sm py-2">Team</Link>
          <Link href={`/play/${league.code}`} className="btn btn-ghost text-sm py-2">Battle</Link>
          <Link href={`/tournament/${league.code}`} className="btn btn-ghost text-sm py-2">Tournament</Link>
          <Link href="/" className="btn btn-ghost text-sm py-2">← Home</Link>
        </div>
      </div>

      {error && <div className="paper p-3 mb-4 text-coral text-sm">{error}</div>}

      {/* Stage: character (left) + notable moves (right) */}
      <div className="paper creased p-6 relative">
        {currentMon ? (
          <>
            <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
              {/* Character */}
              <div className="flex items-start gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteUrl(currentMon.id)} alt={currentMon.display} width={150} height={150}
                  className="drop-shadow-md shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).src = spriteUrl(currentMon.baseId); }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-display text-3xl font-black">{currentMon.display}</h2>
                    {currentMon.isMega && <span className="chip" style={{ background: "var(--indigo)" }}>Mega</span>}
                    <span className="chip" style={{ background: TIER_COLORS[league.pool[currentMon.id]] ?? "var(--ink)" }}>
                      Tier {league.pool[currentMon.id] ?? "?"}
                    </span>
                    <span className="chip" style={{ background: "var(--ink-soft)" }}>
                      {valueForTier(league.pool[currentMon.id], league.tier_values)} pts
                    </span>
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    {currentMon.types.map((t) => (
                      <span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>{t}</span>
                    ))}
                  </div>
                  <div className="mt-2.5 text-sm">
                    <span className="font-semibold text-ink">{currentMon.isMega ? "Mega ability" : "Abilities"}</span>
                    <ul className="mt-1 space-y-1">
                      {currentMon.abilities.map((a) => (
                        <li key={a} className="text-ink-soft leading-snug">
                          <span className="font-semibold text-ink">{a}</span>
                          {abilities[a] ? ` — ${abilities[a]}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <TypeEffect types={currentMon.types} />
                </div>
              </div>

              {/* Stats + notable moves */}
              <div className="md:border-l md:border-dashed md:border-paper-edge md:pl-6">
                <StatBars stats={currentMon.stats} />
                <span className="font-semibold text-ink text-sm block mt-3">Notable moves</span>
                {(moves.byMon[currentMon.id]?.length ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {moves.byMon[currentMon.id].map((mv) => (
                      <MoveChip key={mv} name={mv} info={moves.info[mv]} />
                    ))}
                    <p className="text-[11px] text-ink-soft mt-1 w-full">Hover a move to read it.</p>
                  </div>
                ) : <p className="text-xs text-ink-soft mt-1.5 italic">No notable moves listed.</p>}
              </div>
            </div>

            {/* High bid + admin controls */}
            <div className="mt-5 border-t border-dashed border-paper-edge pt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-soft">
                {highCoach ? (
                  <>High bid <span className="font-display text-2xl font-black" style={{ color: highCoach.color }}>{highBid!.amount}</span> by <b>{highCoach.name}</b></>
                ) : (
                  <>Opening at <span className="font-display text-2xl font-black">{OPENING}</span></>
                )}
              </p>
              <div className="flex items-center gap-3">
                {countdownNum !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-soft">{countdownNum > 0 ? "Going once…" : "Sold!"}</span>
                    <span key={countdownNum} className="cd-pop font-display text-3xl font-black grid place-items-center rounded-full w-12 h-12 text-white"
                      style={{ background: countdownNum > 0 ? "var(--coral)" : "var(--teal, #2f8f83)" }}>
                      {countdownNum > 0 ? countdownNum : "✓"}
                    </span>
                  </div>
                )}
                {passCountdown !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-soft">{passCountdown > 0 ? "No bids — passing…" : "Passed"}</span>
                    <span key={passCountdown} className="cd-pop font-display text-3xl font-black grid place-items-center rounded-full w-12 h-12 text-white"
                      style={{ background: passCountdown > 0 ? "var(--mustard, #d9a23e)" : "#8a8a8a" }}>
                      {passCountdown > 0 ? passCountdown : "–"}
                    </span>
                  </div>
                )}
                {isAdmin && (
                  <div className="flex gap-2">
                    {countdownNum === null && highCoach && (
                      <button className="btn btn-coral" onClick={() => act(() => sellLot(activeLot!))}>Sell now</button>
                    )}
                    <button className="btn btn-ghost" onClick={() => act(() => passLot(activeLot!.id))}>Pass</button>
                  </div>
                )}
              </div>
              <style jsx>{`.cd-pop { animation: cdpop 0.25s ease-out; } @keyframes cdpop { from { transform: scale(1.6); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }`}</style>
            </div>
          </>
        ) : (
          <div className="text-center py-14">
            <p className="hand text-3xl text-coral">
              {allFull ? "draft complete"
                : iNominate ? "your turn to nominate ↓"
                : iRevealRandom ? "reveal the random pick ↓"
                : isRandomTurn ? "waiting for a random Pokémon…"
                : `waiting for ${nominator?.name ?? "the admin"}…`}
            </p>
            <p className="text-ink-soft mt-1">
              {allFull ? "Every team is full."
                : iNominate ? "Pick from the pool below to open bidding."
                : iRevealRandom ? "Spin up the next random Pokémon."
                : "The next Pokémon will appear here."}
            </p>
          </div>
        )}
      </div>

      {/* Bidding — underneath the character and moves */}
      {activeLot && (
        <div className="paper p-5 mt-6 grid gap-5 sm:grid-cols-2">
          <div>
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
          </div>
          {me && (
            <div className="sm:border-l sm:border-dashed sm:border-paper-edge sm:pl-5">
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
      )}

      {/* Nomination — pool picker for the current nominator */}
      {!allFull && !activeLot && iNominate && (
        <div className="mt-6">
          <h3 className="font-display text-xl font-bold mb-3">
            {mode === "admin" ? "Nominate from your pool" : `${me?.name}, nominate a Pokémon`} ({poolMons.length} left)
          </h3>
          <PoolFilter {...poolFilterProps} />
          <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 lg:grid-cols-7">
            {filteredPool.map((m) => (
              <button key={m.id} onClick={() => nominateMon(m.id)}
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
      {!allFull && !activeLot && iRevealRandom && (
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
              {picks.length > 0 && (
                <button onClick={() => copyTeam(c)} className="btn btn-ghost text-xs py-1 mt-3 w-full">
                  {copied === c.id ? "Copied!" : "Copy for Showdown"}
                </button>
              )}
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
