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

// A reasonable starting tier based on raw stats — the admin can override per mon.
export function suggestTier(bst: number): Tier {
  if (bst >= 600) return "S";
  if (bst >= 535) return "A";
  if (bst >= 480) return "B";
  if (bst >= 420) return "C";
  return "D";
}

export async function loadPokedex(): Promise<PokeMon[]> {
  const res = await fetch("/pokedex.json");
  if (!res.ok) throw new Error("Could not load the Pokédex data");
  return res.json();
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
