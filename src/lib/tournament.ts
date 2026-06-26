// Tournament engine. The whole bracket lives in one JSONB blob on the league.
// Match results are the state; later-round participants are DERIVED from the
// winners that feed them, so editing any result re-flows downstream automatically.

export type TFormat = "single" | "round_robin"; // double elim coming next
export type MatchStatus = "pending" | "reported" | "confirmed";

export type TMatch = {
  id: string;
  round: number;
  slot: number;
  label?: string;
  aSeed?: string | null; // present on round-1 / round-robin matches (null = bye)
  bSeed?: string | null;
  aFrom?: string; // matchId whose winner feeds slot a
  bFrom?: string;
  winner: string | null;
  status: MatchStatus;
  reportWinner?: string | null;
  reportBy?: string | null;
};

export type Tournament = {
  format: TFormat;
  seeds: string[]; // ordered coach ids
  matches: TMatch[];
};

const pow2AtLeast = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };

function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

export function generateSingle(seeds: string[]): TMatch[] {
  const size = pow2AtLeast(Math.max(seeds.length, 2));
  const totalRounds = Math.round(Math.log2(size));
  const matches: TMatch[] = [];

  for (let s = 0; s < size / 2; s++) {
    matches.push({
      id: `r1-${s}`, round: 1, slot: s, label: roundLabel(1, totalRounds),
      aSeed: seeds[s * 2] ?? null, bSeed: seeds[s * 2 + 1] ?? null,
      winner: null, status: "pending",
    });
  }
  for (let r = 2; r <= totalRounds; r++) {
    const count = size / Math.pow(2, r);
    for (let s = 0; s < count; s++) {
      matches.push({
        id: `r${r}-${s}`, round: r, slot: s, label: roundLabel(r, totalRounds),
        aFrom: `r${r - 1}-${s * 2}`, bFrom: `r${r - 1}-${s * 2 + 1}`,
        winner: null, status: "pending",
      });
    }
  }
  // Auto-advance round-1 byes.
  for (const m of matches) {
    if (m.round !== 1) continue;
    if (m.aSeed && !m.bSeed) { m.winner = m.aSeed; m.status = "confirmed"; }
    else if (!m.aSeed && m.bSeed) { m.winner = m.bSeed; m.status = "confirmed"; }
  }
  return matches;
}

export function generateRoundRobin(seeds: string[]): TMatch[] {
  const matches: TMatch[] = [];
  let k = 0;
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      matches.push({
        id: `rr-${k}`, round: 1, slot: k, label: "Round robin",
        aSeed: seeds[i], bSeed: seeds[j], winner: null, status: "pending",
      });
      k++;
    }
  }
  return matches;
}

export function buildTournament(format: TFormat, seeds: string[]): Tournament {
  const matches = format === "round_robin" ? generateRoundRobin(seeds) : generateSingle(seeds);
  return { format, seeds, matches };
}

// Current participants of a match (round-1/RR use fixed seeds; later rounds use feeders' winners).
export function participants(m: TMatch, byId: Map<string, TMatch>): { a: string | null; b: string | null } {
  const win = (mid?: string) => (mid ? byId.get(mid)?.winner ?? null : null);
  return {
    a: m.aSeed !== undefined ? m.aSeed : win(m.aFrom),
    b: m.bSeed !== undefined ? m.bSeed : win(m.bFrom),
  };
}

export function standings(t: Tournament): { id: string; wins: number; losses: number }[] {
  const rec = new Map<string, { wins: number; losses: number }>();
  for (const id of t.seeds) rec.set(id, { wins: 0, losses: 0 });
  for (const m of t.matches) {
    if (m.status !== "confirmed" || !m.winner) continue;
    const a = m.aSeed, b = m.bSeed;
    if (!a || !b) continue;
    const loser = m.winner === a ? b : a;
    rec.get(m.winner)!.wins++;
    rec.get(loser)!.losses++;
  }
  return t.seeds.map((id) => ({ id, ...rec.get(id)! })).sort((x, y) => y.wins - x.wins || x.losses - y.losses);
}

export const FORMAT_LABEL: Record<TFormat, string> = {
  single: "Single elimination",
  round_robin: "Round robin",
};
