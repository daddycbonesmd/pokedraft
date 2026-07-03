import { supabase, COACH_COLORS } from "./supabase";
import { resolveByes, type Tournament } from "./tournament";
import { type Team } from "./teambuilder";

export type League = {
  id: string;
  code: string;
  name: string;
  admin_token: string;
  budget: number;
  nomination_mode: string;
  pool: Record<string, string>; // monId → tier
  tier_values: Record<string, number>; // tier → draft point value
  team_size: number; // max Pokémon per coach
  tournament: Tournament | null;
  status: string;
  ruleset: string; // e.g. "VGC 2025 Reg I · Tera" — shown in the room
  battle_format: BattleFormat; // singles or doubles — drives the battle engine
  legal_items: string[] | null; // allowed held items (names); null = all legal
  generation?: number; // 9 = Tera+Mega, 8 = Dynamax+Mega, 7 = Z-moves+Mega (default 9)
  created_at: string;
};

export type BattleFormat = "singles" | "doubles";

// The battle gimmick a league uses, stored in the `generation` column. Three are
// generation-bound (Tera = Gen 9, Dynamax = Gen 8, Z-Moves = Gen 7, each also
// allowing Mega via a Stone). The fourth, "Mega" (stored as 6), is Mega-only: it
// runs on the Gen-9 engine for the full modern dex, with Terastallization hidden.
export const GENERATIONS = [
  { gen: 9, label: "Gen 9", gimmick: "Terastallization", blurb: "Tera + Mega" },
  { gen: 8, label: "Gen 8", gimmick: "Dynamax / Gigantamax", blurb: "Dynamax + Mega" },
  { gen: 7, label: "Gen 7", gimmick: "Z-Moves", blurb: "Z-Moves + Mega" },
  { gen: 6, label: "Mega", gimmick: "Mega Evolution only", blurb: "Mega, no Tera" },
] as const;
export const normalizeGen = (g?: number) => (g === 6 || g === 7 || g === 8 ? g : 9);
export const isMegaOnly = (g?: number) => normalizeGen(g) === 6;

// The Showdown engine format id used for battles in this league. Mega-only (6)
// uses the Gen-9 engine (Tera is hidden in the UI, not banned). Doubles is "bring
// 4, send 2" (VGC-style): Picked Team Size = 4 restricts the active field to the 4
// chosen mons so faint/switch prompts only ever offer those 4 — never all 6.
export const engineFormat = (f: BattleFormat, generation?: number) => {
  const gen = normalizeGen(generation);
  const engineGen = gen === 6 ? 9 : gen;
  const base = `gen${engineGen}${f === "doubles" ? "doubles" : ""}customgame`;
  return f === "doubles" ? `${base}@@@Picked Team Size = 4` : base;
};

export type Coach = {
  id: string;
  league_id: string;
  name: string;
  color: string;
  is_admin: boolean;
  team: Team | null; // battle sets the coach has built for their drafted Pokémon
  created_at: string;
};

export type Lot = {
  id: string;
  league_id: string;
  mon_id: number;
  status: "active" | "sold" | "passed";
  winner_coach_id: string | null;
  final_price: number | null;
  created_at: string;
};

export type Bid = {
  id: string;
  league_id: string;
  lot_id: string;
  coach_id: string;
  amount: number;
  created_at: string;
};

export type RoomState = {
  league: League;
  coaches: Coach[];
  activeLot: Lot | null;
  bids: Bid[]; // bids for the active lot, highest first
  wonLots: Lot[]; // sold lots (rosters are derived from these)
  passedLots: Lot[]; // passed lots — random reveals re-offer these only once the rest of the pool has gone up
  finishedCount: number; // sold + passed lots — drives whose turn it is to nominate
};

// ── Identity (who am I in a given room) — stored per-league locally ──
type Identity = { coachId: string; adminToken?: string };
const idKey = (code: string) => `pokedraft.room.${code.toUpperCase()}`;

export function saveIdentity(code: string, id: Identity) {
  localStorage.setItem(idKey(code), JSON.stringify(id));
}
export function getIdentity(code: string): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(idKey(code)) ?? "null");
  } catch {
    return null;
  }
}

const ID_PREFIX = "pokedraft.room.";
export function myLeagueCodes(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(ID_PREFIX)) out.push(k.slice(ID_PREFIX.length));
  }
  return out;
}
export function forgetLeague(code: string) {
  localStorage.removeItem(idKey(code));
}

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s + String(Math.floor(Math.random() * 90) + 10); // e.g. FOLD-42
}

// ── League lifecycle ───────────────────────────────────────────────
// Draft modes: auction nominations (admin/snake/one_random/auction_random),
// direct point-buy (snake_draft, pointbuy_random), and instant random teams (full_random).
export type NominationMode =
  | "admin" | "snake" | "one_random" | "auction_random"
  | "snake_draft" | "pointbuy_random" | "full_random";

export async function createLeague(opts: {
  name: string;
  adminName: string;
  pool: Record<string, string>;
  budget: number;
  mode: NominationMode;
  ruleset?: string;
  tierValues?: Record<string, number>;
  teamSize?: number;
  battleFormat?: BattleFormat;
  legalItems?: string[] | null;
  generation?: number;
}): Promise<{ league: League; coach: Coach }> {
  const code = makeCode();
  const admin_token = crypto.randomUUID();
  const base = {
    code,
    name: opts.name,
    admin_token,
    budget: opts.budget,
    nomination_mode: opts.mode,
    pool: opts.pool,
    tier_values: opts.tierValues ?? {},
    team_size: opts.teamSize ?? 6,
    status: "drafting",
    ruleset: opts.ruleset ?? "",
  };
  const withFormat = { ...base, battle_format: opts.battleFormat ?? "doubles", legal_items: opts.legalItems ?? null };
  let { data: league, error } = await supabase
    .from("leagues")
    .insert({ ...withFormat, generation: normalizeGen(opts.generation) })
    .select()
    .single();
  // Tolerate newer columns not being migrated yet — drop generation first (so a DB
  // that has battle_format but not generation keeps its format), then everything.
  if (error && /generation|column/i.test(error.message ?? "")) {
    ({ data: league, error } = await supabase.from("leagues").insert(withFormat).select().single());
  }
  if (error && /battle_format|legal_items|column/i.test(error.message ?? "")) {
    ({ data: league, error } = await supabase.from("leagues").insert(base).select().single());
  }
  if (error) throw error;

  const { data: coach, error: e2 } = await supabase
    .from("coaches")
    .insert({ league_id: league.id, name: opts.adminName, color: COACH_COLORS[0], is_admin: true })
    .select()
    .single();
  if (e2) throw e2;

  saveIdentity(code, { coachId: coach.id, adminToken: admin_token });
  return { league, coach };
}

export async function getLeagueByCode(code: string): Promise<League | null> {
  const { data } = await supabase.from("leagues").select().eq("code", code.toUpperCase()).maybeSingle();
  return data;
}

export async function getLeagueById(id: string): Promise<League | null> {
  const { data } = await supabase.from("leagues").select().eq("id", id).maybeSingle();
  return data;
}

export async function getLeaguesByCodes(codes: string[]): Promise<League[]> {
  if (!codes.length) return [];
  const { data } = await supabase.from("leagues").select().in("code", codes.map((c) => c.toUpperCase()));
  return data ?? [];
}

export async function joinLeague(code: string, name: string): Promise<{ league: League; coach: Coach }> {
  const league = await getLeagueByCode(code);
  if (!league) throw new Error("No league found with that code.");

  const { count } = await supabase
    .from("coaches")
    .select("*", { count: "exact", head: true })
    .eq("league_id", league.id);
  const color = COACH_COLORS[(count ?? 0) % COACH_COLORS.length];

  const { data: coach, error } = await supabase
    .from("coaches")
    .insert({ league_id: league.id, name, color, is_admin: false })
    .select()
    .single();
  if (error) throw error;

  saveIdentity(code, { coachId: coach.id });
  return { league, coach };
}

// ── Room state ─────────────────────────────────────────────────────
export async function getRoomState(leagueId: string): Promise<RoomState> {
  const [{ data: league }, { data: coaches }, { data: lots }] = await Promise.all([
    supabase.from("leagues").select().eq("id", leagueId).single(),
    supabase.from("coaches").select().eq("league_id", leagueId).order("created_at"),
    supabase.from("lots").select().eq("league_id", leagueId).order("created_at"),
  ]);

  const activeLot = (lots ?? []).find((l: Lot) => l.status === "active") ?? null;
  const wonLots = (lots ?? []).filter((l: Lot) => l.status === "sold");
  const passedLots = (lots ?? []).filter((l: Lot) => l.status === "passed");
  const finishedCount = (lots ?? []).filter((l: Lot) => l.status !== "active").length;

  let bids: Bid[] = [];
  if (activeLot) {
    const { data } = await supabase
      .from("bids")
      .select()
      .eq("lot_id", activeLot.id)
      .order("amount", { ascending: false });
    bids = data ?? [];
  }

  return { league, coaches: coaches ?? [], activeLot, bids, wonLots, passedLots, finishedCount };
}

// ── Auction actions ────────────────────────────────────────────────
export async function nominate(leagueId: string, monId: number): Promise<void> {
  const { error } = await supabase.from("lots").insert({ league_id: leagueId, mon_id: monId, status: "active" });
  if (error) throw error;
}

// Snake draft: a coach picks a Pokémon directly onto their team (no bidding).
// Stored as an already-sold lot so rosters derive exactly like the auction.
export async function pickDirect(leagueId: string, coachId: string, monId: number, price: number): Promise<void> {
  const { error } = await supabase.from("lots").insert({
    league_id: leagueId, mon_id: monId, status: "sold", winner_coach_id: coachId, final_price: price,
  });
  if (error) throw error;
}

// Full-random draft: wipe any existing picks and assign whole teams at once.
export async function clearLots(leagueId: string): Promise<void> {
  const { error } = await supabase.from("lots").delete().eq("league_id", leagueId);
  if (error) throw error;
}
export async function bulkPick(leagueId: string, picks: { coachId: string; monId: number; price: number }[]): Promise<void> {
  if (!picks.length) return;
  const rows = picks.map((p) => ({
    league_id: leagueId, mon_id: p.monId, status: "sold", winner_coach_id: p.coachId, final_price: p.price,
  }));
  const { error } = await supabase.from("lots").insert(rows);
  if (error) throw error;
}

// Point-buy random: the current coach buys the offered (active) lot at its point cost.
export async function buyLot(lotId: string, coachId: string, price: number): Promise<void> {
  const { error } = await supabase.from("lots")
    .update({ status: "sold", winner_coach_id: coachId, final_price: price }).eq("id", lotId);
  if (error) throw error;
}

export async function placeBid(opts: {
  leagueId: string;
  lotId: string;
  coachId: string;
  amount: number;
}): Promise<void> {
  const { error } = await supabase.from("bids").insert({
    league_id: opts.leagueId,
    lot_id: opts.lotId,
    coach_id: opts.coachId,
    amount: opts.amount,
  });
  if (error) throw error;
}

// Sell to the standing top bid. Anti-snipe: pass `expectedTopBidId` (the bid that
// survived the whole countdown) and the sale aborts if a different bid is on top at
// sale time — a last-millisecond bid can't slip in and win unseen; instead the
// countdown restarts with that bid on the board for everyone to answer.
export async function sellLot(lot: Lot, expectedTopBidId?: string): Promise<void> {
  const { data: top } = await supabase
    .from("bids")
    .select()
    .eq("lot_id", lot.id)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!top) throw new Error("No bids yet — pass instead, or wait for a bid.");
  if (expectedTopBidId && top.id !== expectedTopBidId) throw new Error("A late bid came in — going again!");
  const { error } = await supabase
    .from("lots")
    .update({ status: "sold", winner_coach_id: top.coach_id, final_price: top.amount })
    .eq("id", lot.id);
  if (error) throw error;
}

// Anti-snipe for the no-bid pass too: with `onlyIfNoBids`, a bid that lands in the
// pass countdown's final instant cancels the pass instead of being swallowed by it.
export async function passLot(lotId: string, onlyIfNoBids = false): Promise<void> {
  if (onlyIfNoBids) {
    const { count } = await supabase.from("bids").select("id", { count: "exact", head: true }).eq("lot_id", lotId);
    if ((count ?? 0) > 0) throw new Error("A bid came in — the auction continues!");
  }
  const { error } = await supabase.from("lots").update({ status: "passed" }).eq("id", lotId);
  if (error) throw error;
}

// ── Tournament ─────────────────────────────────────────────────────
export async function saveTournament(leagueId: string, tournament: Tournament | null): Promise<void> {
  const { error } = await supabase.from("leagues").update({ tournament }).eq("id", leagueId);
  if (error) throw error;
}

export async function setLeagueTeamSize(leagueId: string, teamSize: number): Promise<void> {
  const size = Math.max(1, Math.min(30, Math.round(teamSize)));
  const { error } = await supabase.from("leagues").update({ team_size: size }).eq("id", leagueId);
  if (error) throw error;
}

export async function saveTeam(coachId: string, team: Team): Promise<void> {
  const { error } = await supabase.from("coaches").update({ team }).eq("id", coachId);
  if (error) throw error;
}

// ── Battles (Stage 3) ──────────────────────────────────────────────
export type Battle = {
  id: string;
  league_id: string;
  format: string;
  generation?: number; // engine generation (9/8/7); absent = 9
  p1_coach_id: string | null;
  p2_coach_id: string | null;
  p1_name: string;
  p2_name: string;
  p1_team: string; // packed Showdown team
  p2_team: string;
  seed: number[];
  status: string; // active | done
  winner: string | null;
  match_id: string | null; // tournament match this settles (null = exhibition)
  created_at: string;
};
export type BattleChoice = { id: string; battle_id: string; side: string; seq: number; choice: string; created_at: string };

export async function createBattle(b: {
  leagueId: string; format: string; generation?: number;
  p1: { coachId: string | null; name: string; team: string };
  p2: { coachId: string | null; name: string; team: string }; // coachId null = AI (practice)
  seed: number[]; matchId?: string | null;
}): Promise<Battle> {
  const row = {
    league_id: b.leagueId, format: b.format,
    p1_coach_id: b.p1.coachId, p2_coach_id: b.p2.coachId,
    p1_name: b.p1.name, p2_name: b.p2.name,
    p1_team: b.p1.team, p2_team: b.p2.team, seed: b.seed,
  };
  const withExtras = { ...row, match_id: b.matchId ?? null, generation: normalizeGen(b.generation) };
  let { data, error } = await supabase.from("battles").insert(withExtras).select().single();
  // Peel off newer columns one tier at a time if they aren't migrated yet.
  if (error && /generation|column/i.test(error.message ?? "")) {
    ({ data, error } = await supabase.from("battles").insert({ ...row, match_id: b.matchId ?? null }).select().single());
  }
  if (error && /match_id|column/i.test(error.message ?? "")) {
    ({ data, error } = await supabase.from("battles").insert(row).select().single());
  }
  if (error) throw error;
  return data;
}

// An existing active battle for a tournament match, if any (avoids duplicates).
export async function getBattleByMatch(leagueId: string, matchId: string): Promise<Battle | null> {
  const { data } = await supabase.from("battles").select()
    .eq("league_id", leagueId).eq("match_id", matchId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

export async function getBattle(id: string): Promise<Battle | null> {
  const { data } = await supabase.from("battles").select().eq("id", id).maybeSingle();
  return data;
}

export async function listBattles(leagueId: string): Promise<Battle[]> {
  const { data } = await supabase.from("battles").select().eq("league_id", leagueId).order("created_at", { ascending: false });
  return data ?? [];
}

export async function getBattleChoices(battleId: string): Promise<BattleChoice[]> {
  // Deterministic, stable order: (created_at, side, seq). The old `id` tiebreak was a
  // random UUID, so same-timestamp choices could reorder between reads — which both
  // thrashed the replay cache and made replays non-deterministic. (side, seq) is unique
  // per battle, so this order never changes from one read to the next.
  const { data } = await supabase.from("battle_choices").select().eq("battle_id", battleId)
    .order("created_at").order("side").order("seq");
  return data ?? [];
}

export async function submitChoice(battleId: string, side: string, seq: number, choice: string): Promise<void> {
  const { error } = await supabase.from("battle_choices").insert({ battle_id: battleId, side, seq, choice });
  if (error && !/duplicate|unique|conflict/i.test(error.message ?? "")) throw error; // ignore double-submit
}

export async function finishBattle(id: string, winner: string | null): Promise<void> {
  await supabase.from("battles").update({ status: "done", winner }).eq("id", id).eq("status", "active");
}

// Record a finished battle's winner onto its tournament match and advance the bracket.
export async function reportMatchResult(leagueId: string, matchId: string, winnerCoachId: string): Promise<void> {
  const league = await getLeagueById(leagueId);
  const t = league?.tournament;
  if (!t) return;
  const m = t.matches.find((x) => x.id === matchId);
  if (!m || m.winner) return; // already settled — don't overwrite
  m.winner = winnerCoachId;
  m.status = "confirmed";
  resolveByes(t);
  await saveTournament(leagueId, t);
}

// Notify when a new battle is created in a league (for the global invite toast).
export function subscribeLeagueBattles(leagueId: string, onInsert: (b: Battle) => void) {
  const channel = supabase
    .channel(`league-battles:${leagueId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "battles", filter: `league_id=eq.${leagueId}` },
      (payload) => onInsert(payload.new as Battle))
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeBattle(battleId: string, onChange: () => void) {
  const channel = supabase
    .channel(`battle:${battleId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "battles", filter: `id=eq.${battleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "battle_choices", filter: `battle_id=eq.${battleId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function subscribeLeague(leagueId: string, onChange: () => void) {
  const channel = supabase
    .channel(`league:${leagueId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "coaches", filter: `league_id=eq.${leagueId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// ── Realtime: report each change so the room can apply it directly ──
export type RoomEvent = {
  table: "bids" | "lots" | "coaches";
  eventType: string; // INSERT | UPDATE | DELETE
  row: Record<string, unknown>;
};

export function subscribeRoom(leagueId: string, onEvent: (e: RoomEvent) => void) {
  const filter = `league_id=eq.${leagueId}`;
  const channel = supabase
    .channel(`room:${leagueId}`, { config: { broadcast: { self: false } } })
    .on("postgres_changes", { event: "*", schema: "public", table: "bids", filter }, (p) =>
      onEvent({ table: "bids", eventType: p.eventType, row: p.new }))
    .on("postgres_changes", { event: "*", schema: "public", table: "lots", filter }, (p) =>
      onEvent({ table: "lots", eventType: p.eventType, row: p.new }))
    .on("postgres_changes", { event: "*", schema: "public", table: "coaches", filter }, (p) =>
      onEvent({ table: "coaches", eventType: p.eventType, row: p.new }))
    // Fast lane: bids are echoed peer-to-peer (~150ms) ahead of the slower DB-change stream.
    .on("broadcast", { event: "bid" }, ({ payload }) =>
      onEvent({ table: "bids", eventType: "INSERT", row: payload as Record<string, unknown> }))
    .subscribe();
  return {
    unsubscribe: () => { supabase.removeChannel(channel); },
    broadcastBid: (row: Record<string, unknown>) => {
      channel.send({ type: "broadcast", event: "bid", payload: row });
    },
  };
}
