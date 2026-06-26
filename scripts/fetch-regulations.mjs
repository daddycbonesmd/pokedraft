// Seeds public/regulations.json from Pokémon Showdown's open, maintained dataset
// (NOT scraped from Serebii — this is the structured data competitive tools use).
//   - which national-dex numbers are legal in Scarlet/Violet (isNonstandard === null)
//   - which are Restricted Legendaries / Mythicals (from tags)
//   - per-regulation params (gimmick + restricted-legendary limit)
// Run: node scripts/fetch-regulations.mjs
import { writeFile } from "node:fs/promises";

const DEX = "https://play.pokemonshowdown.com/data/pokedex.json";
const FORMATS = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/config/formats.ts";

const j = async (u) => (await fetch(u)).json();
const t = async (u) => (await fetch(u)).text();

const dex = await j(DEX);
const svLegal = new Set();
const restricted = new Set();
const mythical = new Set();
const notFullyEvolved = new Set(); // has evolutions remaining ⇒ skip for draft pools
for (const key in dex) {
  const e = dex[key];
  if (typeof e.num !== "number" || e.num <= 0) continue;
  if (!e.isNonstandard) svLegal.add(e.num); // null/undefined ⇒ obtainable in SV
  const tags = e.tags || [];
  if (tags.includes("Restricted Legendary")) restricted.add(e.num);
  if (tags.includes("Mythical")) mythical.add(e.num);
  if (Array.isArray(e.evos) && e.evos.length > 0) notFullyEvolved.add(e.num);
}

// Pull gimmick (via mod) + restricted limit straight from Showdown's format defs.
const formats = await t(FORMATS);
const limitWord = { One: 1, Two: 2, Three: 3, Four: 4 };
function readFormat(showdownName) {
  const i = formats.indexOf(`name: "${showdownName}"`);
  if (i < 0) return null;
  const blk = formats.slice(i, i + 400);
  const mod = (blk.match(/mod:\s*'([^']+)'/) || [])[1] || "gen9";
  const lim = (blk.match(/Limit (One|Two|Three|Four) Restricted/) || [])[1];
  // The "champions" / "championsregma" mods are the Mega-Dimension set (Megas, no Tera).
  return { gimmick: mod.startsWith("champions") ? "Mega" : "Tera", restrictedLimit: lim ? limitWord[lim] : 0 };
}

// Curated display names; rule params come from Showdown where available, else fallback.
const TARGETS = [
  { id: "vgc26ma", name: "VGC 2026 Reg M-A", sd: '[Gen 9 Champions] VGC 2026 Reg M-A', fb: { gimmick: "Mega", restrictedLimit: 0 } },
  { id: "vgc26mb", name: "VGC 2026 Reg M-B", sd: '[Gen 9 Champions] VGC 2026 Reg M-B', fb: { gimmick: "Mega", restrictedLimit: 1 } },
  { id: "vgc25i",  name: "VGC 2025 Reg I",   sd: '[Gen 9] VGC 2025 Reg I',            fb: { gimmick: "Tera", restrictedLimit: 2 } },
  { id: "vgc24g",  name: "VGC 2024 Reg G",   sd: '[Gen 9] VGC 2024 Reg G',            fb: { gimmick: "Tera", restrictedLimit: 1 } },
  { id: "vgc24h",  name: "VGC 2024 Reg H",   sd: '[Gen 9] VGC 2024 Reg H',            fb: { gimmick: "Tera", restrictedLimit: 0 } },
];

const presets = TARGETS.map((tg) => {
  const got = readFormat(tg.sd);
  const src = got ? "showdown" : "curated";
  const { gimmick, restrictedLimit } = got ?? tg.fb;
  const banLegends = restrictedLimit === 0;
  const restrictPhrase = banLegends ? "no restricted legends" : `${restrictedLimit} restricted legend${restrictedLimit > 1 ? "s" : ""}`;
  return {
    id: tg.id,
    name: tg.name,
    gimmick, // "Mega" | "Tera"
    restrictedLimit,
    banLegends,
    blurb: `Gen 9 · ${gimmick} · ${restrictPhrase}`,
    source: src,
  };
});

const out = {
  note: "Seeded from Pokémon Showdown. svLegalNums = national-dex numbers obtainable in Scarlet/Violet.",
  svLegalNums: [...svLegal].sort((a, b) => a - b),
  restrictedNums: [...restricted].sort((a, b) => a - b),
  mythicalNums: [...mythical].sort((a, b) => a - b),
  notFullyEvolvedNums: [...notFullyEvolved].sort((a, b) => a - b),
  presets,
};
await writeFile(new URL("../public/regulations.json", import.meta.url), JSON.stringify(out));
console.log(`SV-legal nums: ${out.svLegalNums.length}, restricted: ${out.restrictedNums.length}, mythical: ${out.mythicalNums.length}`);
console.table(presets.map((p) => ({ name: p.name, gimmick: p.gimmick, restricted: p.restrictedLimit, source: p.source })));
