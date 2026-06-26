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
  legalIds?: number[]; // explicit legal pool (Mega regs); Tera regs use svLegalNums
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
  const out: Record<number, string> = {};

  // Mega regs (M-A/M-B): use the exact legal list from the format's Showdown mod.
  if (reg.legalIds && reg.legalIds.length) {
    const legal = new Set(reg.legalIds);
    for (const m of dex) {
      if (!legal.has(m.id)) continue;
      if (mythical.has(m.baseId)) continue;
      if (reg.banLegends && restricted.has(m.baseId)) continue;
      out[m.id] = suggestTier(m.bst);
    }
    return out;
  }

  // Tera regs: SV-legal, fully-evolved base species; no megas.
  const sv = new Set(data.svLegalNums);
  const nfe = new Set(data.notFullyEvolvedNums ?? []);
  for (const m of dex) {
    if (!sv.has(m.baseId)) continue;
    if (nfe.has(m.baseId)) continue;
    if (mythical.has(m.baseId)) continue;
    if (reg.banLegends && restricted.has(m.baseId)) continue;
    if (m.isMega) continue;
    if (m.id >= 10000) continue;
    out[m.id] = suggestTier(m.bst);
  }
  return out;
}
