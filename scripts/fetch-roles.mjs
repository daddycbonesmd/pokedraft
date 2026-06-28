// Seeds two files for the battle teambuilder (Stage 2):
//   public/roles.json     { "<monId>": [ {name, moves[4], ability, item, tera, nature, evs, level} ] }
//        archetype "auto" sets, sourced from @pkmn/randbats roles (doubles + singles).
//   public/movepools.json { "<monId>": ["Move Name", ...] }  full legal movepool for manual editing.
// Run: node scripts/fetch-roles.mjs
import { readFile, writeFile } from "node:fs/promises";
import { Dex } from "@pkmn/dex";

const RB_DOUBLES = "https://raw.githubusercontent.com/pkmn/randbats/main/data/gen9randomdoublesbattle.json";
const RB_SINGLES = "https://raw.githubusercontent.com/pkmn/randbats/main/data/gen9randombattle.json";
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const toID = (s) => norm(s);

// PokéAPI form name (normalized) → Showdown species key (mirrors fetch-moves.mjs).
const FORM_KEY = {
  taurospaldeacombatbreed: "taurospaldeacombat", taurospaldeablazebreed: "taurospaldeablaze", taurospaldeaaquabreed: "taurospaldeaaqua",
  basculegionmale: "basculegion", basculegionfemale: "basculegionf", meowsticmale: "meowstic", meowsticfemale: "meowsticf",
  aegislashshield: "aegislash", gourgeistaverage: "gourgeist", lycanrocmidday: "lycanroc", mimikyudisguised: "mimikyu",
  morpekofullbelly: "morpeko", palafinzero: "palafin", mausholdfamilyoffour: "maushold",
  tornadusincarnate: "tornadus", thundurusincarnate: "thundurus", landorusincarnate: "landorus", enamorusincarnate: "enamorus",
  indeedeemale: "indeedee", indeedeefemale: "indeedeef", urshifusinglestrike: "urshifu", urshifurapidstrike: "urshifurapidstrike",
  oricoriobaile: "oricorio", toxtricityamped: "toxtricity", eiscueice: "eiscue", wishiwashisolo: "wishiwashi",
  oinkolognemale: "oinkologne", oinkolognefemale: "oinkolognef", keldeoordinary: "keldeo", zygarde50: "zygarde",
};

async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (t === tries - 1) throw e; await new Promise((res) => setTimeout(res, 500 * (t + 1))); }
  }
}

const LEVEL = 50; // VGC doubles standard

// Heuristic EVs + nature from the role name and its move categories.
function spreadFor(roleName, moves) {
  const cats = moves.map((m) => Dex.moves.get(m).category);
  const phys = cats.filter((c) => c === "Physical").length;
  const spec = cats.filter((c) => c === "Special").length;
  const atk = phys >= spec ? "atk" : "spa";
  const bulky = /bulky|support|defensive|wall|redirection|tank|protect|utility/i.test(roleName);
  const trickRoom = /trick ?room/i.test(roleName);
  if (bulky) {
    const nature = atk === "atk" ? "Adamant" : "Modest";
    return { evs: { hp: 252, def: 4, [atk]: 252 }, nature: spec || phys ? nature : "Bold", ivs: trickRoom ? { spe: 0 } : {} };
  }
  // offensive: max the attacking stat + speed (or 0 Spe under Trick Room)
  if (trickRoom) return { evs: { hp: 252, [atk]: 252, def: 4 }, nature: atk === "atk" ? "Brave" : "Quiet", ivs: { spe: 0 } };
  return { evs: { hp: 4, [atk]: 252, spe: 252 }, nature: atk === "atk" ? "Jolly" : "Timid", ivs: {} };
}

function collectRoles(rb, byKey) {
  for (const [name, entry] of Object.entries(rb)) {
    const key = norm(name);
    const bucket = byKey[key] ?? (byKey[key] = {});
    for (const [roleName, role] of Object.entries(entry.roles || {})) {
      if (!bucket[roleName]) bucket[roleName] = role; // first source wins (doubles loaded first)
    }
  }
}

console.log("Fetching randbats roles (doubles + singles)…");
const rolesByKey = {};
collectRoles(await getJSON(RB_DOUBLES), rolesByKey);
collectRoles(await getJSON(RB_SINGLES), rolesByKey);

const dex = JSON.parse(await readFile(new URL("../public/pokedex.json", import.meta.url)));
const baseName = new Map(dex.map((m) => [m.id, m.name]));

const rolesFor = (n) => rolesByKey[n] ?? rolesByKey[FORM_KEY[n] ?? ""];

// ── roles.json ──
const rolesOut = {};
for (const m of dex) {
  let roles = rolesFor(norm(m.name));
  if (!roles && m.isMega) roles = rolesFor(norm(baseName.get(m.baseId) || ""));
  if (!roles) continue;
  const list = [];
  for (const [name, role] of Object.entries(roles)) {
    const moves = (role.moves || []).slice(0, 4);
    if (!moves.length) continue;
    const { evs, nature, ivs } = spreadFor(name, moves);
    list.push({
      name,
      moves: moves.map((mv) => Dex.moves.get(mv).name),
      ability: (role.abilities || [])[0] ? Dex.abilities.get(role.abilities[0]).name : "",
      item: (role.items || [])[0] ? Dex.items.get(role.items[0]).name : "",
      tera: (role.teraTypes || [])[0] || "",
      nature, evs, ivs, level: LEVEL,
    });
  }
  if (list.length) rolesOut[m.id] = list;
}
await writeFile(new URL("../public/roles.json", import.meta.url), JSON.stringify(rolesOut));
console.log(`Wrote roles.json (${Object.keys(rolesOut).length} mons)`);

// ── movepools.json (full legal movepool per mon) ──
console.log("Building legal movepools from @pkmn/dex learnsets…");
const learnsetCache = new Map(); // learnsetId → string[] of display move names
async function legalMoves(speciesName) {
  const sp = Dex.species.get(speciesName);
  if (!sp || !sp.exists) return null;
  // formes without their own learnset inherit the base species'
  const candidates = [sp.id, toID(sp.baseSpecies)];
  for (const id of candidates) {
    if (learnsetCache.has(id)) return learnsetCache.get(id);
    const ls = await Dex.learnsets.get(id);
    if (ls && ls.learnset) {
      const names = Object.keys(ls.learnset)
        .map((mid) => Dex.moves.get(mid))
        .filter((mv) => mv && mv.exists && mv.name)
        .map((mv) => mv.name)
        .sort();
      learnsetCache.set(id, names);
      return names;
    }
  }
  return null;
}

const movepoolsOut = {};
let done = 0;
for (const m of dex) {
  let moves = await legalMoves(m.name);
  if (!moves && m.isMega) moves = await legalMoves(baseName.get(m.baseId) || "");
  if (moves && moves.length) movepoolsOut[m.id] = moves;
  if (++done % 250 === 0) console.log(`  …${done}/${dex.length}`);
}
await writeFile(new URL("../public/movepools.json", import.meta.url), JSON.stringify(movepoolsOut));
console.log(`Wrote movepools.json (${Object.keys(movepoolsOut).length} mons)`);

// ── species.json (monId → canonical Showdown species name, so teams import cleanly) ──
function showdownSpecies(m) {
  let sp = Dex.species.get(m.name);
  if (!sp.exists) sp = Dex.species.get(FORM_KEY[norm(m.name)] || "");
  if (!sp.exists && m.isMega) sp = Dex.species.get(baseName.get(m.baseId) || "");
  return sp.exists ? sp.name : m.display;
}
const speciesOut = {};
for (const m of dex) speciesOut[m.id] = showdownSpecies(m);
await writeFile(new URL("../public/species.json", import.meta.url), JSON.stringify(speciesOut));
console.log(`Wrote species.json (${Object.keys(speciesOut).length} mons)`);

// ── items.json (battle items with category + description, for the item menus) ──
function itemCategory(i) {
  if (i.isBerry) return "Berry";
  if (i.megaStone) return "Mega Stone";
  if (i.isGem) return "Gem";
  if (i.onPlate || /(Plate|Memory|Drive)$/.test(i.name)) return "Type";
  if (/^Choice /.test(i.name)) return "Choice";
  if (i.isPokeball) return "Poké Ball";
  return "Held item";
}
const itemsOut = Dex.items.all()
  .filter((i) => i.exists && i.name && !i.isNonstandard && !i.isPokeball)
  .map((i) => ({ name: i.name, desc: (i.shortDesc || i.desc || "").replace(/\s+/g, " ").trim(), cat: itemCategory(i) }))
  .sort((a, b) => a.name.localeCompare(b.name));
await writeFile(new URL("../public/items.json", import.meta.url), JSON.stringify(itemsOut));
console.log(`Wrote items.json (${itemsOut.length} items)`);
