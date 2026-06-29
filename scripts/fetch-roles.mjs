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

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const UTILITY = [
  "Protect", "Detect", "Fake Out", "Follow Me", "Rage Powder", "Spore", "Sleep Powder", "Will-O-Wisp", "Thunder Wave",
  "Swords Dance", "Nasty Plot", "Calm Mind", "Dragon Dance", "Quiver Dance", "Bulk Up", "Shell Smash",
  "Recover", "Roost", "Synthesis", "Moonlight", "Slack Off", "Soft-Boiled", "Substitute", "Taunt",
];

// Build one sensible "Balanced" set for Pokémon that have no randbats roles, so
// every Pokémon gets an auto-build option. Picks STAB + coverage from the legal
// movepool by base power, a utility move, and an offensive/bulky spread by stats.
function synthSet(mon, moveNames) {
  const s = mon.stats || {};
  const physical = (s.atk ?? 0) >= (s.spa ?? 0);
  const wantCat = physical ? "Physical" : "Special";
  const md = moveNames.map((n) => Dex.moves.get(n)).filter((m) => m && m.exists);
  const isStab = (m) => mon.types.includes(m.type.toLowerCase());
  const byBp = (a, b) => b.basePower - a.basePower;
  const attacking = md.filter((m) => m.category === wantCat && m.basePower > 0);
  const stab = attacking.filter(isStab).sort(byBp);
  const coverage = attacking.filter((m) => !isStab(m)).sort(byBp);

  const chosen = [];
  const seenTypes = new Set();
  const add = (name, type) => {
    if (name && !chosen.includes(name) && chosen.length < 4) { chosen.push(name); if (type) seenTypes.add(type); }
  };
  if (stab[0]) add(stab[0].name, stab[0].type);
  for (const m of coverage) { if (chosen.length >= 3) break; if (!seenTypes.has(m.type)) add(m.name, m.type); }
  for (const m of [...stab.slice(1), ...attacking]) { if (chosen.length >= 3) break; add(m.name, m.type); }
  const util = UTILITY.find((u) => moveNames.includes(u));
  if (util) add(util);
  for (const n of moveNames) { if (chosen.length >= 4) break; add(n); }
  const moves = chosen.slice(0, 4);
  if (!moves.length) return null;

  const atk = physical ? "atk" : "spa";
  const fast = (s.spe ?? 0) >= 80;
  const evs = fast ? { hp: 4, [atk]: 252, spe: 252 } : { hp: 252, [atk]: 252, def: 4 };
  const nature = fast ? (physical ? "Jolly" : "Timid") : (physical ? "Adamant" : "Modest");
  return {
    name: "Balanced",
    moves,
    ability: (mon.abilities && mon.abilities[0]) || "",
    item: fast ? "Life Orb" : "Leftovers",
    tera: cap(mon.types[0] || "normal"),
    nature, evs, ivs: {}, level: LEVEL,
  };
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
console.log(`Randbats roles for ${Object.keys(rolesOut).length} mons; synthesizing the rest…`);

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
// Fill any form still without a movepool from its base-name segment (e.g.
// "squawkabilly-green-plumage" → "squawkabilly", "frillish-male" → "frillish").
for (const m of dex) {
  if (movepoolsOut[m.id]) continue;
  const moves = await legalMoves(m.name.split("-")[0]);
  if (moves && moves.length) movepoolsOut[m.id] = moves;
}
await writeFile(new URL("../public/movepools.json", import.meta.url), JSON.stringify(movepoolsOut));
console.log(`Wrote movepools.json (${Object.keys(movepoolsOut).length} mons)`);

// ── Synthesize a "Balanced" auto-set for every mon WITHOUT randbats roles ──
// Any movepool found for a given base species, so sibling forms can borrow it.
const mpByBase = {};
for (const m of dex) if (movepoolsOut[m.id]) mpByBase[m.baseId] ??= movepoolsOut[m.id];

let synth = 0;
for (const m of dex) {
  if (rolesOut[m.id]) continue;
  // cosmetic/totem/cap/gender forms have no learnset of their own — borrow the base species'
  const mp = movepoolsOut[m.id] || movepoolsOut[m.baseId] || mpByBase[m.baseId] || mpByBase[m.id];
  if (!mp || !mp.length) continue;
  const set = synthSet(m, mp);
  if (set) { rolesOut[m.id] = [set]; synth++; }
}
await writeFile(new URL("../public/roles.json", import.meta.url), JSON.stringify(rolesOut));
console.log(`Wrote roles.json (${Object.keys(rolesOut).length} mons; ${synth} synthesized + randbats)`);

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
