// Seeds public/regulations.json from Pokémon Showdown's open, maintained dataset.
//   - SV legality + Restricted/Mythical/not-fully-evolved categories (for the Tera regs)
//   - For the Mega regs (M-A/M-B), the EXACT legal Pokémon list from each one's
//     Showdown mod (championsregma / champions) — these have their own dex + mega set.
// Run: node scripts/fetch-regulations.mjs
import { readFile, writeFile } from "node:fs/promises";

const DEX = "https://play.pokemonshowdown.com/data/pokedex.json";
const FORMATS = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/config/formats.ts";
const MOD = (mod) => `https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/mods/${mod}/formats-data.ts`;

const j = async (u) => (await fetch(u)).json();
const t = async (u) => (await fetch(u)).text();

// ── Base SV legality + categories (national dex) ──────────────────
const dex = await j(DEX);
const svLegal = new Set();
const restricted = new Set();
const mythical = new Set();
const notFullyEvolved = new Set();
for (const key in dex) {
  const e = dex[key];
  if (typeof e.num !== "number" || e.num <= 0) continue;
  if (!e.isNonstandard) svLegal.add(e.num);
  const tags = e.tags || [];
  if (tags.includes("Restricted Legendary")) restricted.add(e.num);
  if (tags.includes("Mythical")) mythical.add(e.num);
  if (Array.isArray(e.evos) && e.evos.length > 0) notFullyEvolved.add(e.num);
}

// ── Map Showdown species keys → our PokéAPI ids ───────────────────
const myDex = JSON.parse(await readFile(new URL("../public/pokedex.json", import.meta.url)));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameToId = new Map(myDex.map((m) => [norm(m.name), m.id]));

// Showdown default-form keys → PokéAPI form names (where they differ).
const ALIAS = {
  taurospaldeacombat: "tauros-paldea-combat-breed", taurospaldeablaze: "tauros-paldea-blaze-breed",
  taurospaldeaaqua: "tauros-paldea-aqua-breed", basculegion: "basculegion-male", basculegionf: "basculegion-female",
  meowstic: "meowstic-male", meowsticmmega: "meowstic-male-mega", meowsticfmega: "meowstic-female-mega",
  aegislash: "aegislash-shield", gourgeist: "gourgeist-average", lycanroc: "lycanroc-midday",
  mimikyu: "mimikyu-disguised", morpeko: "morpeko-full-belly", palafin: "palafin-zero", maushold: "maushold-family-of-four",
};
const lookupId = (key) => nameToId.get(key) ?? (ALIAS[key] ? nameToId.get(norm(ALIAS[key])) : undefined);

// The actual legal roster for a Mega-Dimension reg = its mod's formats-data entries
// that aren't isNonstandard (this IS Reg M-A / M-B's curated, restricted pool).
async function legalIdsForMod(mod) {
  const txt = await t(MOD(mod));
  const ids = [];
  let unmatched = 0;
  const re = /^\t(\w+): \{([\s\S]*?)^\t\},?$/gm;
  let m;
  while ((m = re.exec(txt))) {
    if (/isNonstandard/.test(m[2])) continue; // not legal in this format
    const id = lookupId(m[1]);
    if (id != null) ids.push(id);
    else unmatched++;
  }
  return { ids, unmatched };
}

// ── Per-format gimmick + restricted limit from formats.ts ─────────
const formats = await t(FORMATS);
const limitWord = { One: 1, Two: 2, Three: 3, Four: 4 };
function readFormat(name) {
  const i = formats.indexOf(`name: "${name}"`);
  if (i < 0) return null;
  const blk = formats.slice(i, i + 400);
  const mod = (blk.match(/mod:\s*'([^']+)'/) || [])[1] || "gen9";
  const lim = (blk.match(/Limit (One|Two|Three|Four) Restricted/) || [])[1];
  return { gimmick: mod.startsWith("champions") ? "Mega" : "Tera", restrictedLimit: lim ? limitWord[lim] : 0 };
}

// Mega regs carry an explicit legal-id list from their mod; Tera regs use svLegalNums.
const TARGETS = [
  { id: "vgc26ma", name: "VGC 2026 Reg M-A", sd: '[Gen 9 Champions] VGC 2026 Reg M-A', fb: { gimmick: "Mega", restrictedLimit: 0 }, mod: "championsregma" },
  { id: "vgc26mb", name: "VGC 2026 Reg M-B", sd: '[Gen 9 Champions] VGC 2026 Reg M-B', fb: { gimmick: "Mega", restrictedLimit: 0 }, mod: "champions" },
  { id: "vgc25i",  name: "VGC 2025 Reg I",   sd: '[Gen 9] VGC 2025 Reg I',            fb: { gimmick: "Tera", restrictedLimit: 2 } },
  { id: "vgc24g",  name: "VGC 2024 Reg G",   sd: '[Gen 9] VGC 2024 Reg G',            fb: { gimmick: "Tera", restrictedLimit: 1 } },
  { id: "vgc24h",  name: "VGC 2024 Reg H",   sd: '[Gen 9] VGC 2024 Reg H',            fb: { gimmick: "Tera", restrictedLimit: 0 } },
];

const presets = [];
for (const tg of TARGETS) {
  const got = readFormat(tg.sd);
  const { gimmick, restrictedLimit } = got ?? tg.fb;
  const banLegends = restrictedLimit === 0;
  const restrictPhrase = banLegends ? "no restricted legends" : `${restrictedLimit} restricted legend${restrictedLimit > 1 ? "s" : ""}`;
  const preset = {
    id: tg.id,
    name: tg.name,
    gimmick,
    restrictedLimit,
    banLegends,
    blurb: `${gimmick === "Mega" ? "Champions" : "Gen 9"} · ${gimmick} · ${restrictPhrase}`,
    source: got ? "showdown" : "curated",
  };
  if (tg.mod) {
    const { ids, unmatched } = await legalIdsForMod(tg.mod);
    preset.legalIds = ids;
    console.log(`  ${tg.name}: ${ids.length} legal Pokémon from mod '${tg.mod}' (${unmatched} unmapped)`);
  }
  presets.push(preset);
}

// Legal held items per reg. Mega regs allow Mega Stones on top of standard items;
// Tera/gen-9 regs omit `items` and fall back to all standard (non-Mega) items.
const allItemNames = JSON.parse(await readFile(new URL("../public/items.json", import.meta.url))).map((i) => i.name);
for (const p of presets) {
  if (p.gimmick === "Mega") p.items = allItemNames;
}

const out = {
  note: "Seeded from Pokémon Showdown. Mega regs (M-A/M-B) carry explicit legalIds + Mega-Stone-inclusive item lists from their mod.",
  svLegalNums: [...svLegal].sort((a, b) => a - b),
  restrictedNums: [...restricted].sort((a, b) => a - b),
  mythicalNums: [...mythical].sort((a, b) => a - b),
  notFullyEvolvedNums: [...notFullyEvolved].sort((a, b) => a - b),
  presets,
};
await writeFile(new URL("../public/regulations.json", import.meta.url), JSON.stringify(out));
console.log(`\nSV-legal ${out.svLegalNums.length}, restricted ${out.restrictedNums.length}, mythical ${out.mythicalNums.length}`);
console.table(presets.map((p) => ({ name: p.name, gimmick: p.gimmick, restricted: p.restrictedLimit, legalIds: p.legalIds ? p.legalIds.length : "(svLegal)" })));
