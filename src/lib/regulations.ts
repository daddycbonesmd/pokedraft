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
  legalIds?: number[]; // Mega regs (M-A/M-B): the exact legal roster from the format's mod
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
  const out: Record<number, string> = {};

  // Mega regs (M-A/M-B): use the format's exact legal roster from its Showdown mod.
  if (reg.legalIds && reg.legalIds.length) {
    const legal = new Set(reg.legalIds);
    for (const m of dex) if (legal.has(m.id)) out[m.id] = suggestTier(m.bst);
    return out;
  }

  // Tera regs: SV-legal, fully-evolved base species; no megas.
  const restricted = new Set(data.restrictedNums);
  const mythical = new Set(data.mythicalNums);
  const sv = new Set(data.svLegalNums);
  const nfe = new Set(data.notFullyEvolvedNums ?? []);
  for (const m of dex) {
    if (m.isMega || m.id >= 10000) continue;
    if (!sv.has(m.baseId) || nfe.has(m.baseId) || mythical.has(m.baseId)) continue;
    if (reg.banLegends && restricted.has(m.baseId)) continue;
    out[m.id] = suggestTier(m.bst);
  }
  return out;
}
