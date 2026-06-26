// Tournament engine. The whole bracket lives in one JSONB blob on the league.
// Match RESULTS are the state; participants of later matches are DERIVED from the
// winners/losers that feed them, so editing any result re-flows downstream.

export type TFormat = "single" | "double" | "round_robin";
export type MatchStatus = "pending" | "reported" | "confirmed";

// A feeder: take the Winner or Loser of another match.
export type Feed = { m: string; take: "W" | "L" };

export type TMatch = {
  id: string;
  round: number;
  slot: number;
  label?: string;
  bracket?: "W" | "L" | "GF"; // winners / losers / grand final (double elim only)
  aSeed?: string | null; // round-1 / round-robin fixed participant (null = bye)
  bSeed?: string | null;
  aFrom?: Feed;
  bFrom?: Feed;
  winner: string | null;
  status: MatchStatus;
  reportWinner?: string | null;
  reportBy?: string | null;
};

export type Tournament = {
  format: TFormat;
  seeds: string[];
  matches: TMatch[];
};

const pow2AtLeast = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };

// ── Resolving who's in each slot ──────────────────────────────────
type Slot = "player" | "empty" | "tbd";

function outcome(mid: string, byId: Map<string, TMatch>, take: "W" | "L"): string | null {
  const m = byId.get(mid);
  if (!m || !m.winner) return null;
  if (take === "W") return m.winner;
  const { a, b } = participants(m, byId);
  return m.winner === a ? b : m.winner === b ? a : null;
}

function settle(m: TMatch, which: "a" | "b", byId: Map<string, TMatch>): Slot {
  const from = which === "a" ? m.aFrom : m.bFrom;
  if (from) {
    const src = byId.get(from.m);
    if (!src || !src.winner) return "tbd";
    return outcome(from.m, byId, from.take) ? "player" : "empty";
  }
  const seed = which === "a" ? m.aSeed : m.bSeed;
  if (seed === undefined) return "tbd";
  return seed === null ? "empty" : "player";
}

export function slotState(m: TMatch, which: "a" | "b", byId: Map<string, TMatch>): Slot {
  return settle(m, which, byId);
}

export function participants(m: TMatch, byId: Map<string, TMatch>): { a: string | null; b: string | null } {
  const val = (which: "a" | "b"): string | null => {
    const from = which === "a" ? m.aFrom : m.bFrom;
    if (from) return outcome(from.m, byId, from.take);
    const seed = which === "a" ? m.aSeed : m.bSeed;
    return seed ?? null;
  };
  return { a: val("a"), b: val("b") };
}

// Auto-advance any match where one side is a real player and the other is a bye.
export function resolveByes(t: Tournament): void {
  const byId = new Map(t.matches.map((m) => [m.id, m]));
  let changed = true, guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const m of t.matches) {
      if (m.winner) continue;
      const a = settle(m, "a", byId), b = settle(m, "b", byId);
      if (a === "player" && b === "empty") { m.winner = participants(m, byId).a; m.status = "confirmed"; changed = true; }
      else if (b === "player" && a === "empty") { m.winner = participants(m, byId).b; m.status = "confirmed"; changed = true; }
    }
  }
}

// ── Bracket generators ────────────────────────────────────────────
function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function generateSingle(seeds: string[]): TMatch[] {
  const size = pow2AtLeast(Math.max(seeds.length, 2));
  const k = Math.round(Math.log2(size));
  const M: TMatch[] = [];
  for (let s = 0; s < size / 2; s++) {
    M.push({ id: `r1-${s}`, round: 1, slot: s, label: roundLabel(1, k), aSeed: seeds[s * 2] ?? null, bSeed: seeds[s * 2 + 1] ?? null, winner: null, status: "pending" });
  }
  for (let r = 2; r <= k; r++) {
    for (let s = 0; s < size / 2 ** r; s++) {
      M.push({ id: `r${r}-${s}`, round: r, slot: s, label: roundLabel(r, k), aFrom: { m: `r${r - 1}-${s * 2}`, take: "W" }, bFrom: { m: `r${r - 1}-${s * 2 + 1}`, take: "W" }, winner: null, status: "pending" });
    }
  }
  return M;
}

export function generateRoundRobin(seeds: string[]): TMatch[] {
  const M: TMatch[] = [];
  let k = 0;
  for (let i = 0; i < seeds.length; i++)
    for (let j = i + 1; j < seeds.length; j++)
      M.push({ id: `rr-${k}`, round: 1, slot: k++, label: "Round robin", aSeed: seeds[i], bSeed: seeds[j], winner: null, status: "pending" });
  return M;
}

// Matches in losers-bracket round j (1-indexed) for a size-2^k bracket.
const lbCount = (j: number, k: number) => Math.pow(2, k - 1 - Math.ceil(j / 2));

export function generateDouble(seeds: string[]): TMatch[] {
  const size = pow2AtLeast(Math.max(seeds.length, 2));
  const k = Math.round(Math.log2(size));
  const M: TMatch[] = [];

  // Winners bracket
  for (let s = 0; s < size / 2; s++) {
    M.push({ id: `w-r1-${s}`, round: 1, slot: s, bracket: "W", label: "WB Round 1", aSeed: seeds[s * 2] ?? null, bSeed: seeds[s * 2 + 1] ?? null, winner: null, status: "pending" });
  }
  for (let r = 2; r <= k; r++) {
    for (let s = 0; s < size / 2 ** r; s++) {
      M.push({ id: `w-r${r}-${s}`, round: r, slot: s, bracket: "W", label: r === k ? "WB Final" : `WB Round ${r}`, aFrom: { m: `w-r${r - 1}-${s * 2}`, take: "W" }, bFrom: { m: `w-r${r - 1}-${s * 2 + 1}`, take: "W" }, winner: null, status: "pending" });
    }
  }

  if (k >= 2) {
    const lbRounds = 2 * (k - 1);
    for (let j = 1; j <= lbRounds; j++) {
      const cnt = lbCount(j, k);
      const minor = j % 2 === 1;
      for (let s = 0; s < cnt; s++) {
        let aFrom: Feed, bFrom: Feed;
        if (j === 1) { aFrom = { m: `w-r1-${s * 2}`, take: "L" }; bFrom = { m: `w-r1-${s * 2 + 1}`, take: "L" }; }
        else if (minor) { aFrom = { m: `l-r${j - 1}-${s * 2}`, take: "W" }; bFrom = { m: `l-r${j - 1}-${s * 2 + 1}`, take: "W" }; }
        else { aFrom = { m: `l-r${j - 1}-${s}`, take: "W" }; bFrom = { m: `w-r${j / 2 + 1}-${s}`, take: "L" }; }
        M.push({ id: `l-r${j}-${s}`, round: j, slot: s, bracket: "L", label: j === lbRounds ? "LB Final" : `LB Round ${j}`, aFrom, bFrom, winner: null, status: "pending" });
      }
    }
    M.push({ id: "gf", round: k + 1, slot: 0, bracket: "GF", label: "Grand Final", aFrom: { m: `w-r${k}-0`, take: "W" }, bFrom: { m: `l-r${lbRounds}-0`, take: "W" }, winner: null, status: "pending" });
  } else {
    // 2 players: winner vs loser of the single WB match.
    M.push({ id: "gf", round: 2, slot: 0, bracket: "GF", label: "Grand Final", aFrom: { m: "w-r1-0", take: "W" }, bFrom: { m: "w-r1-0", take: "L" }, winner: null, status: "pending" });
  }
  return M;
}

export function buildTournament(format: TFormat, seeds: string[]): Tournament {
  const matches = format === "round_robin" ? generateRoundRobin(seeds)
    : format === "double" ? generateDouble(seeds)
    : generateSingle(seeds);
  const t: Tournament = { format, seeds, matches };
  resolveByes(t);
  return t;
}

export function standings(t: Tournament): { id: string; wins: number; losses: number }[] {
  const rec = new Map<string, { wins: number; losses: number }>();
  for (const id of t.seeds) rec.set(id, { wins: 0, losses: 0 });
  for (const m of t.matches) {
    if (m.status !== "confirmed" || !m.winner) continue;
    const a = m.aSeed, b = m.bSeed;
    if (!a || !b) continue;
    const loser = m.winner === a ? b : a;
    const w = rec.get(m.winner); if (w) w.wins++;
    const l = rec.get(loser); if (l) l.losses++;
  }
  return t.seeds.map((id) => ({ id, ...rec.get(id)! })).sort((x, y) => y.wins - x.wins || x.losses - y.losses);
}

export const FORMAT_LABEL: Record<TFormat, string> = {
  single: "Single elimination",
  double: "Double elimination",
  round_robin: "Round robin",
};
