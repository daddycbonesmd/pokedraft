// Regulation presets (seeded from Pokémon Showdown by scripts/fetch-regulations.mjs).
import { suggestTier, type PokeMon } from "./pokedex";

export type Regulation = {
  id: string;
  name: string;
  gimmick: "Mega" | "Tera";
  restrictedLimit: number;
  banLegends: boolean;
  blurb: string;
  source: string;
  megaIds?: number[]; // Mega regs: which mega forms are legal (base species come from SV legality)
};

export type RegData = {
  svLegalNums: number[];
  restrictedNums: number[];
  mythicalNums: number[];
  notFullyEvolvedNums: number[];
  presets: Regulation[];
};

export async function loadRegulations(): Promise<RegData> {
  const res = await fetch("/regulations.json");
  if (!res.ok) throw new Error("Could not load regulation data");
  return res.json();
}

// Build a starting pool (monId → tier) for a regulation. The admin then tweaks it.
export function poolFromRegulation(dex: PokeMon[], reg: Regulation, data: RegData): Record<number, string> {
  const restricted = new Set(data.restrictedNums);
  const mythical = new Set(data.mythicalNums);
  const sv = new Set(data.svLegalNums);
  const nfe = new Set(data.notFullyEvolvedNums ?? []);
  const out: Record<number, string> = {};

  // A base species is in the pool if it's a fully-evolved, non-mythical SV mon
  // (and not a restricted legendary when the format bans those).
  const baseOk = (m: PokeMon) =>
    sv.has(m.baseId) && !nfe.has(m.baseId) && !mythical.has(m.baseId) &&
    !(reg.banLegends && restricted.has(m.baseId));

  const megaSet = new Set(reg.megaIds ?? []);
  for (const m of dex) {
    if (m.isMega) {
      // Mega regs add the format's legal megas (Tera regs include none).
      if (megaSet.has(m.id) && !mythical.has(m.baseId) && !(reg.banLegends && restricted.has(m.baseId))) {
        out[m.id] = suggestTier(m.bst);
      }
      continue;
    }
    if (m.id >= 10000) continue; // skip other alt forms
    if (baseOk(m)) out[m.id] = suggestTier(m.bst);
  }
  return out;
}
