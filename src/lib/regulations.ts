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
  const sv = new Set(data.svLegalNums);
  const restricted = new Set(data.restrictedNums);
  const mythical = new Set(data.mythicalNums);
  const nfe = new Set(data.notFullyEvolvedNums ?? []);
  const out: Record<number, string> = {};

  for (const m of dex) {
    if (!sv.has(m.baseId)) continue;            // must be obtainable in Scarlet/Violet
    if (nfe.has(m.baseId)) continue;             // draft pools only want fully-evolved Pokémon
    if (mythical.has(m.baseId)) continue;        // mythicals are banned in VGC
    if (reg.banLegends && restricted.has(m.baseId)) continue; // Reg H / M-A / M-B
    if (reg.gimmick === "Mega") {
      // base species + megas; skip other alt forms (admin can add specifics)
      if (m.id >= 10000 && !m.isMega) continue;
    } else {
      // Tera regs: no megas
      if (m.isMega) continue;
      if (m.id >= 10000) continue;
    }
    out[m.id] = suggestTier(m.bst);
  }
  return out;
}
