// Teambuilder data + logic (Stage 2). Turns a coach's drafted Pokémon into real
// Showdown sets — full manual control plus archetype "auto" sets from roles.json.
// Static data (roles/movepools/species/items) is lazy-loaded; the heavy battle
// engine is only pulled in on the battle screen.

export const STATS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
export type Stat = (typeof STATS)[number];
export const STAT_LABEL: Record<Stat, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
export const EV_TOTAL_MAX = 508;
export const EV_STAT_MAX = 252;

export const TERA_TYPES = [
  "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground",
  "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy", "Stellar",
];

// nature → [boosted, lowered] (neutral natures map to null)
export const NATURE_EFFECTS: Record<string, [Stat, Stat] | null> = {
  Hardy: null, Docile: null, Bashful: null, Quirky: null, Serious: null,
  Adamant: ["atk", "spa"], Bold: ["def", "atk"], Brave: ["atk", "spe"], Calm: ["spd", "atk"],
  Careful: ["spd", "spa"], Gentle: ["spd", "def"], Hasty: ["spe", "def"], Impish: ["def", "spa"],
  Jolly: ["spe", "spa"], Lax: ["def", "spd"], Lonely: ["atk", "def"], Mild: ["spa", "def"],
  Modest: ["spa", "atk"], Naive: ["spe", "spd"], Naughty: ["atk", "spd"], Quiet: ["spa", "spe"],
  Rash: ["spa", "spd"], Relaxed: ["def", "spe"], Sassy: ["spd", "spe"], Timid: ["spe", "atk"],
};
export const NATURES = Object.keys(NATURE_EFFECTS).sort();

export function natureLabel(n: string): string {
  const e = NATURE_EFFECTS[n];
  return e ? `${n} (+${STAT_LABEL[e[0]]} −${STAT_LABEL[e[1]]})` : `${n} (neutral)`;
}

export type EVs = Partial<Record<Stat, number>>;
export type IVs = Partial<Record<Stat, number>>;

export type BattleSet = {
  monId: number;
  species: string;   // canonical Showdown species name
  moves: string[];   // up to 4 move display names
  ability: string;
  item: string;
  nature: string;
  evs: EVs;
  ivs: IVs;          // anything omitted = 31
  tera: string;
  level: number;
};
export type Team = BattleSet[];

export type RoleSet = {
  name: string; moves: string[]; ability: string; item: string;
  tera: string; nature: string; evs: EVs; ivs: IVs; level: number;
};

async function loadJSON<T>(path: string, fallback: T): Promise<T> {
  try { const r = await fetch(path); return r.ok ? await r.json() : fallback; }
  catch { return fallback; }
}
export type ItemInfo = { name: string; desc: string; cat: string };
export const loadRoles = () => loadJSON<Record<string, RoleSet[]>>("/roles.json", {});
export const loadMovepools = () => loadJSON<Record<string, string[]>>("/movepools.json", {});
export const loadSpecies = () => loadJSON<Record<string, string>>("/species.json", {});
export const loadItems = () => loadJSON<ItemInfo[]>("/items.json", []);
// Mega id → { base species name, required Mega Stone }. Drafted Megas battle as their
// BASE form holding the Stone, and Mega Evolve in-match — never pre-evolved.
export const loadMegas = () => loadJSON<Record<string, { base: string; stone: string }>>("/megas.json", {});

export function emptySet(monId: number, species: string, abilities: string[]): BattleSet {
  return {
    monId, species, moves: [], ability: abilities[0] ?? "", item: "",
    nature: "Serious", evs: {}, ivs: {}, tera: "", level: 50,
  };
}

// Auto-fill obeys Item Clause: each Pokémon gets a distinct item. When a set's
// preferred item is already taken, fall back to the next free common item.
export const ITEM_FALLBACKS = [
  "Leftovers", "Sitrus Berry", "Rocky Helmet", "Assault Vest", "Life Orb", "Focus Sash",
  "Choice Scarf", "Choice Specs", "Choice Band", "Expert Belt", "Safety Goggles", "Covert Cloak",
  "Wide Lens", "Mental Herb", "Clear Amulet", "Eviolite", "Weakness Policy", "Throat Spray",
  "Mystic Water", "Charcoal", "Magnet", "Miracle Seed", "Light Clay", "Mirror Herb",
];
// Gen-7 Z-Crystals (the 18 type crystals — each upgrades a matching-type move into
// a Z-Move). Offered as item suggestions only in Gen-7 leagues. Signature crystals
// (Pikanium Z, etc.) can still be typed in by hand since the item field is freeform.
export const Z_CRYSTALS: ItemInfo[] = [
  "Buginium Z", "Darkinium Z", "Dragonium Z", "Electrium Z", "Fairium Z", "Fightinium Z",
  "Firium Z", "Flyinium Z", "Ghostium Z", "Grassium Z", "Groundium Z", "Icium Z",
  "Normalium Z", "Poisonium Z", "Psychium Z", "Rockium Z", "Steelium Z", "Waterium Z",
].map((name) => ({ name, desc: "Upgrades a matching-type move into a Z-Move once per battle (Gen 7).", cat: "Z-Crystal" }));

export function uniqueItem(preferred: string, taken: Set<string>): string {
  if (!preferred || !taken.has(preferred)) return preferred;
  for (const it of ITEM_FALLBACKS) if (!taken.has(it)) return it;
  return preferred; // pool exhausted (very large team) — allow the duplicate
}

export function setFromRole(monId: number, species: string, role: RoleSet): BattleSet {
  return {
    monId, species,
    moves: role.moves.slice(0, 4),
    ability: role.ability, item: role.item, nature: role.nature,
    evs: { ...role.evs }, ivs: { ...role.ivs }, tera: role.tera, level: role.level || 50,
  };
}

export const evTotal = (evs: EVs) => STATS.reduce((s, k) => s + (evs[k] ?? 0), 0);

// A set can be sent to battle once it has a species and at least one move.
export const setReady = (s: BattleSet) => Boolean(s.species && s.moves.filter(Boolean).length >= 1);

// ── Showdown export text (what the engine's Teams.import parses) ──
function setToText(s: BattleSet): string {
  const lines: string[] = [];
  lines.push(s.item ? `${s.species} @ ${s.item}` : s.species);
  if (s.ability) lines.push(`Ability: ${s.ability}`);
  if (s.level && s.level !== 100) lines.push(`Level: ${s.level}`);
  if (s.tera) lines.push(`Tera Type: ${s.tera}`);
  const evStr = STATS.filter((k) => (s.evs[k] ?? 0) > 0).map((k) => `${s.evs[k]} ${STAT_LABEL[k]}`).join(" / ");
  if (evStr) lines.push(`EVs: ${evStr}`);
  if (s.nature) lines.push(`${s.nature} Nature`);
  const ivStr = STATS.filter((k) => s.ivs[k] != null && s.ivs[k] !== 31).map((k) => `${s.ivs[k]} ${STAT_LABEL[k]}`).join(" / ");
  if (ivStr) lines.push(`IVs: ${ivStr}`);
  for (const mv of s.moves.filter(Boolean)) lines.push(`- ${mv}`);
  return lines.join("\n");
}

export function teamToShowdown(team: Team): string {
  return team.filter(setReady).map(setToText).join("\n\n");
}
