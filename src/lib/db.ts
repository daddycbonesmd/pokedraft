import { supabase, COACH_COLORS } from "./supabase";

export type League = {
  id: string;
  code: string;
  name: string;
  admin_token: string;
  budget: number;
  nomination_mode: string;
  pool: Record<string, string>; // monId → tier
  status: string;
  ruleset: string; // e.g. "VGC 2025 Reg I · Tera" — shown in the room
  created_at: string;
};

export type Coach = {
  id: string;
  league_id: string;
  name: string;
  color: string;
  is_admin: boolean;
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

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O to avoid confusion
  let s = "";
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s + String(Math.floor(Math.random() * 90) + 10); // e.g. FOLD-42
}

// ── League lifecycle ───────────────────────────────────────────────
export type NominationMode = "admin" | "snake" | "one_random";

export async function createLeague(opts: {
  name: string;
  adminName: string;
  pool: Record<string, string>;
  budget: number;
  mode: NominationMode;
  ruleset?: string;
}): Promise<{ league: League; coach: Coach }> {
  const code = makeCode();
  const admin_token = crypto.randomUUID();
  const { data: league, error } = await supabase
    .from("leagues")
    .insert({
      code,
      name: opts.name,
      admin_token,
      budget: opts.budget,
      nomination_mode: opts.mode,
      pool: opts.pool,
      status: "drafting",
      ruleset: opts.ruleset ?? "",
    })
    .select()
    .single();
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

  return { league, coaches: coaches ?? [], activeLot, bids, wonLots, finishedCount };
}

// ── Auction actions ────────────────────────────────────────────────
export async function nominate(leagueId: string, monId: number): Promise<void> {
  const { error } = await supabase.from("lots").insert({ league_id: leagueId, mon_id: monId, status: "active" });
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

export async function sellLot(lot: Lot): Promise<void> {
  const { data: top } = await supabase
    .from("bids")
    .select()
    .eq("lot_id", lot.id)
    .order("amount", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!top) throw new Error("No bids yet — pass instead, or wait for a bid.");
  const { error } = await supabase
    .from("lots")
    .update({ status: "sold", winner_coach_id: top.coach_id, final_price: top.amount })
    .eq("id", lot.id);
  if (error) throw error;
}

export async function passLot(lotId: string): Promise<void> {
  const { error } = await supabase.from("lots").update({ status: "passed" }).eq("id", lotId);
  if (error) throw error;
}

// ── Realtime: fire `onChange` whenever anything in this room moves ──
export function subscribeRoom(leagueId: string, onChange: () => void) {
  const channel = supabase
    .channel(`room:${leagueId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "bids", filter: `league_id=eq.${leagueId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "lots", filter: `league_id=eq.${leagueId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "coaches", filter: `league_id=eq.${leagueId}` }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
