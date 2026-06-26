// Mock data for the front-end preview. No backend yet — this just lets us
// see and feel the auction screen. Real data comes from Supabase + PokéAPI later.

export type Mon = {
  id: number; // national dex number (used for the sprite)
  name: string;
  types: string[];
  tier: string;
  abilities: string[];
  isMega?: boolean; // megas carry a different ability + typing — relevant for drafting
};

export type RosterPick = { mon: Mon; paid: number };

export type Coach = {
  id: string;
  name: string;
  color: "coral" | "teal" | "mustard" | "indigo" | "plum";
  budget: number; // starting points
  roster: RosterPick[];
  isAdmin?: boolean; // the person running the room
};

// Official artwork from the public PokéAPI sprite set.
export const spriteUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

export const TYPE_COLORS: Record<string, string> = {
  dragon: "#6f56c9",
  ground: "#cc9b53",
  ghost: "#5a5a96",
  steel: "#6b8a99",
  fire: "#e3743a",
  flying: "#8aa9d6",
  poison: "#9a5aa8",
  water: "#4f8fd6",
  fairy: "#d97aa8",
  dark: "#4d433b",
  fighting: "#c0432f",
  psychic: "#df6b8a",
  electric: "#e0b13a",
  grass: "#5aa653",
  normal: "#9a917f",
};

export const COACHES: Coach[] = [
  { id: "c1", name: "Dre", color: "coral", budget: 100, roster: [
    { mon: { id: 887, name: "Dragapult", types: ["dragon", "ghost"], tier: "S", abilities: ["Clear Body", "Infiltrator", "Cursed Body"] }, paid: 31 },
  ] },
  { id: "c2", name: "Maya", color: "teal", budget: 100, roster: [
    { mon: { id: 1000, name: "Gholdengo", types: ["steel", "ghost"], tier: "S", abilities: ["Good as Gold"] }, paid: 28 },
  ] },
  { id: "c3", name: "Kenji", color: "mustard", budget: 100, roster: [] },
  { id: "c4", name: "Lola", color: "indigo", budget: 100, roster: [
    { mon: { id: 983, name: "Kingambit", types: ["dark", "steel"], tier: "A", abilities: ["Defiant", "Supreme Overlord", "Pressure"] }, paid: 24 },
  ] },
  // The room admin. Only joins the bidding when "admin also plays" is toggled on.
  { id: "admin", name: "You", color: "plum", budget: 100, roster: [], isAdmin: true },
];

// The queue of Pokémon coming up for bid in this preview.
export const QUEUE: Mon[] = [
  // A mega leads the queue to show how megas read differently (own ability + typing).
  { id: 6, name: "Mega Charizard X", types: ["fire", "dragon"], tier: "S", abilities: ["Tough Claws"], isMega: true },
  { id: 445, name: "Garchomp", types: ["dragon", "ground"], tier: "S", abilities: ["Rough Skin", "Sand Veil"] },
  { id: 984, name: "Great Tusk", types: ["ground", "fighting"], tier: "S", abilities: ["Protosynthesis"] },
  { id: 94, name: "Gengar", types: ["ghost", "poison"], tier: "A", abilities: ["Cursed Body"] },
  { id: 748, name: "Toxapex", types: ["poison", "water"], tier: "A", abilities: ["Regenerator", "Merciless", "Limber"] },
  { id: 823, name: "Corviknight", types: ["flying", "steel"], tier: "B", abilities: ["Pressure", "Unnerve", "Mirror Armor"] },
];

export const COLOR_HEX: Record<Coach["color"], string> = {
  coral: "#d9594c",
  teal: "#2f8f83",
  mustard: "#dca23e",
  indigo: "#5867a8",
  plum: "#8c5a86",
};
