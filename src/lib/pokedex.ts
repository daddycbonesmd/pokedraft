// Real Pokédex data (seeded into public/pokedex.json by scripts/fetch-pokedex.mjs)
// plus the format-builder storage layer. Formats are kept in localStorage for now;
// they'll move to Supabase when we wire up real multiplayer.

export type PokeMon = {
  id: number;
  name: string;
  display: string;
  types: string[];
  abilities: string[];
  bst: number; // base stat total
  baseId: number; // national-dex id of the base species (for sprite fallback)
  gen: number;
  isMega: boolean;
  isGmax: boolean;
};

export const spriteUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

// Tiny pixel sprite (a few KB) — use in grids, lists, and thumbnails where the
// big official artwork would be wasteful. Far faster to load in bulk.
export const spriteSmall = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

export const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const TYPE_COLORS: Record<string, string> = {
  normal: "#9a917f", fire: "#e3743a", water: "#4f8fd6", electric: "#e0b13a",
  grass: "#5aa653", ice: "#6fc6c6", fighting: "#c0432f", poison: "#9a5aa8",
  ground: "#cc9b53", flying: "#8aa9d6", psychic: "#df6b8a", bug: "#9aa83a",
  rock: "#b0a060", ghost: "#5a5a96", dragon: "#6f56c9", dark: "#4d433b",
  steel: "#6b8a99", fairy: "#d97aa8",
};
export const ALL_TYPES = Object.keys(TYPE_COLORS);

// Offensive chart: for each attacking type, what it's strong/weak/no-effect against.
const TYPE_MATCHUPS: Record<string, { weak: string[]; resist: string[]; immune: string[] }> = {
  normal: { weak: [], resist: ["rock", "steel"], immune: ["ghost"] },
  fire: { weak: ["grass", "ice", "bug", "steel"], resist: ["fire", "water", "rock", "dragon"], immune: [] },
  water: { weak: ["fire", "ground", "rock"], resist: ["water", "grass", "dragon"], immune: [] },
  electric: { weak: ["water", "flying"], resist: ["electric", "grass", "dragon"], immune: ["ground"] },
  grass: { weak: ["water", "ground", "rock"], resist: ["fire", "grass", "poison", "flying", "bug", "dragon", "steel"], immune: [] },
  ice: { weak: ["grass", "ground", "flying", "dragon"], resist: ["fire", "water", "ice", "steel"], immune: [] },
  fighting: { weak: ["normal", "ice", "rock", "dark", "steel"], resist: ["poison", "flying", "psychic", "bug", "fairy"], immune: ["ghost"] },
  poison: { weak: ["grass", "fairy"], resist: ["poison", "ground", "rock", "ghost"], immune: ["steel"] },
  ground: { weak: ["fire", "electric", "poison", "rock", "steel"], resist: ["grass", "bug"], immune: ["flying"] },
  flying: { weak: ["grass", "fighting", "bug"], resist: ["electric", "rock", "steel"], immune: [] },
  psychic: { weak: ["fighting", "poison"], resist: ["psychic", "steel"], immune: ["dark"] },
  bug: { weak: ["grass", "psychic", "dark"], resist: ["fire", "fighting", "poison", "flying", "ghost", "steel", "fairy"], immune: [] },
  rock: { weak: ["fire", "ice", "flying", "bug"], resist: ["fighting", "ground", "steel"], immune: [] },
  ghost: { weak: ["psychic", "ghost"], resist: ["dark"], immune: ["normal"] },
  dragon: { weak: ["dragon"], resist: ["steel"], immune: ["fairy"] },
  dark: { weak: ["psychic", "ghost"], resist: ["fighting", "dark", "fairy"], immune: [] },
  steel: { weak: ["ice", "rock", "fairy"], resist: ["fire", "water", "electric", "steel"], immune: [] },
  fairy: { weak: ["fighting", "dragon", "dark"], resist: ["fire", "poison", "steel"], immune: [] },
};

export type DefenseProfile = { weak: { t: string; x: number }[]; resist: { t: string; x: number }[]; immune: string[] };

// Defensive matchups for a Pokémon's type combo: what hits it hard, what it shrugs off, what can't touch it.
export function defenseProfile(monTypes: string[]): DefenseProfile {
  const out: DefenseProfile = { weak: [], resist: [], immune: [] };
  for (const atk of ALL_TYPES) {
    let x = 1;
    for (const def of monTypes) {
      const mt = TYPE_MATCHUPS[atk];
      const e = !mt ? 1 : mt.immune.includes(def) ? 0 : mt.weak.includes(def) ? 2 : mt.resist.includes(def) ? 0.5 : 1;
      x *= e;
    }
    if (x === 0) out.immune.push(atk);
    else if (x > 1) out.weak.push({ t: atk, x });
    else if (x < 1) out.resist.push({ t: atk, x });
  }
  out.weak.sort((a, b) => b.x - a.x);
  out.resist.sort((a, b) => a.x - b.x);
  return out;
}

// Tiers are just organising labels (every Pokémon still opens at 1 in the auction).
export const TIERS = ["S", "A", "B", "C", "D"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_COLORS: Record<string, string> = {
  S: "#d9594c", A: "#dca23e", B: "#2f8f83", C: "#5867a8", D: "#6f6657",
};

// Draft point value per tier. Defaults the admin can override per format.
export const DEFAULT_TIER_VALUES: Record<string, number> = { S: 20, A: 16, B: 12, C: 8, D: 4 };
export const valueForTier = (tier: string, values?: Record<string, number>) =>
  values?.[tier] ?? DEFAULT_TIER_VALUES[tier] ?? 0;

// Starting tier from raw stats. S is NEVER auto-assigned — it's reserved for the
// admin to mark genuinely strong meta Pokémon. Auto-suggest caps at A.
export function suggestTier(bst: number): Tier {
  if (bst >= 570) return "A";
  if (bst >= 500) return "B";
  if (bst >= 440) return "C";
  return "D";
}

export async function loadPokedex(): Promise<PokeMon[]> {
  const res = await fetch("/pokedex.json");
  if (!res.ok) throw new Error("Could not load the Pokédex data");
  return res.json();
}

// Ability name → short description (seeded by scripts/fetch-abilities.mjs).
export async function loadAbilities(): Promise<Record<string, string>> {
  try { const res = await fetch("/abilities.json"); return res.ok ? res.json() : {}; }
  catch { return {}; }
}

// Notable signature moves per Pokémon + move details (seeded by scripts/fetch-moves.mjs).
export type MoveInfo = { t: string; p: number | null; c: string; d: string };
export type MovesData = { byMon: Record<string, string[]>; info: Record<string, MoveInfo> };
export async function loadMoves(): Promise<MovesData> {
  try { const res = await fetch("/moves.json"); return res.ok ? res.json() : { byMon: {}, info: {} }; }
  catch { return { byMon: {}, info: {} }; }
}

// ── Format storage (localStorage) ─────────────────────────────────
export type Format = {
  id: string;
  name: string;
  includedIds: number[];
  tiers: Record<number, string>; // monId → tier label
  tierValues?: Record<string, number>; // tier → draft point value
  updatedAt: number;
  ruleset?: { name: string; gimmick: string }; // set when started from a regulation preset
};

const KEY = "pokedraft.formats";

export function loadFormats(): Format[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function getFormat(id: string): Format | undefined {
  return loadFormats().find((f) => f.id === id);
}

export function saveFormat(f: Format) {
  const all = loadFormats();
  const i = all.findIndex((x) => x.id === f.id);
  if (i >= 0) all[i] = f;
  else all.push(f);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteFormat(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadFormats().filter((f) => f.id !== id)));
}
