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
const SETUP = ["Swords Dance", "Nasty Plot", "Calm Mind", "Dragon Dance", "Quiver Dance", "Bulk Up", "Shell Smash", "Agility", "Coil", "Tail Glow", "Work Up", "Victory Dance", "Take Heart"];
const RECOVERY = ["Recover", "Roost", "Synthesis", "Moonlight", "Morning Sun", "Soft-Boiled", "Slack Off", "Strength Sap", "Milk Drink", "Shore Up", "Matcha Gotcha", "Jungle Healing", "Life Dew", "Wish", "Rest"];
const STATUS = ["Will-O-Wisp", "Thunder Wave", "Toxic", "Spore", "Sleep Powder", "Nuzzle", "Glare", "Yawn", "Stun Spore", "Lovely Kiss", "Hypnosis", "Leech Seed"];
const SUPPORT = ["Fake Out", "Follow Me", "Rage Powder", "Helping Hand", "Reflect", "Light Screen", "Aurora Veil", "Tailwind", "Trick Room", "Icy Wind", "Electroweb", "Pollen Puff", "Heal Pulse", "Decorate", "Coaching", "Ally Switch", "Taunt"];
const FIXED = ["Seismic Toss", "Night Shade", "Body Press"]; // damage without offense stats — good on walls
// Moves to avoid auto-picking (recharge / two-turn / gimmick) unless nothing better.
const BAD = new Set([
  // recharge / two-turn
  "Hyper Beam", "Giga Impact", "Blast Burn", "Hydro Cannon", "Frenzy Plant", "Roar of Time", "Rock Wrecker", "Prismatic Laser", "Eternabeam",
  "Sky Attack", "Razor Wind", "Skull Bash", "Solar Beam", "Solar Blade", "Meteor Beam", "Bounce", "Sky Drop", "Dig", "Dive", "Fly", "Phantom Force", "Shadow Force", "Geomancy",
  // self-KO / heavy recoil
  "Self-Destruct", "Explosion", "Misty Explosion", "Final Gambit", "Memento", "Steel Beam", "Mind Blown", "Chloroblast",
  // need a setup/condition the default set won't provide
  "Steel Roller", "Last Resort", "Focus Punch", "Bide", "Spit Up", "Swallow", "Stockpile", "Belch", "Stuff Cheeks", "Natural Gift", "Fling", "Snore", "Sleep Talk", "Dream Eater",
  "Burn Up", "Double Shock", "Fillet Away", "Clangorous Soul", "No Retreat", "Beat Up", "Aurora Veil", "Acrobatics", "Hex", "Round", "Echoed Voice", "Rage Fist",
  // unreliable / situational
  "Mirror Move", "Synchronoise",
]);

// Build 1–3 role-appropriate auto-build sets for a Pokémon, best fit first.
function synthSets(mon, moveNames) {
  const s = mon.stats || {};
  const inPool = (list) => list.filter((n) => moveNames.includes(n));
  const md = moveNames.map((n) => Dex.moves.get(n)).filter((m) => m && m.exists);
  const isStab = (m) => mon.types.includes(m.type.toLowerCase());
  const score = (m) => (m.basePower || 0) + (isStab(m) ? 25 : 0) - (BAD.has(m.name) ? 1000 : 0);
  const phys = md.filter((m) => m.category === "Physical" && m.basePower > 0).sort((a, b) => score(b) - score(a));
  const spec = md.filter((m) => m.category === "Special" && m.basePower > 0).sort((a, b) => score(b) - score(a));
  const physical = (s.atk ?? 0) >= (s.spa ?? 0);
  const offense = Math.max(s.atk ?? 0, s.spa ?? 0);
  const bulk = (s.hp ?? 0) + (s.def ?? 0) + (s.spd ?? 0);
  const fast = (s.spe ?? 0) >= 80;
  const setup = inPool(SETUP), recovery = inPool(RECOVERY), status = inPool(STATUS), support = inPool(SUPPORT), fixed = inPool(FIXED);
  const hasProtect = moveNames.includes("Protect");

  // Pick up to N attacking moves of a category: best STAB, then distinct-type coverage.
  const attackMoves = (cat, n) => {
    const pool = cat === "Physical" ? phys : spec;
    const out = [], types = new Set();
    for (const m of pool) { if (out.length >= n) break; if (isStab(m) && !types.has(m.type)) { out.push(m.name); types.add(m.type); } }
    for (const m of pool) { if (out.length >= n) break; if (!types.has(m.type)) { out.push(m.name); types.add(m.type); } }
    for (const m of pool) { if (out.length >= n) break; if (!out.includes(m.name)) out.push(m.name); }
    return out;
  };
  const fill = (moves) => {
    const u = [...moves];
    if (hasProtect && !u.includes("Protect") && u.length < 4) u.push("Protect");
    for (const n of moveNames) { if (u.length >= 4) break; if (!u.includes(n)) u.push(n); }
    return u.slice(0, 4);
  };

  const offSpread = (atk) => fast
    ? { evs: { hp: 4, [atk]: 252, spe: 252 }, nature: atk === "atk" ? "Jolly" : "Timid" }
    : { evs: { hp: 252, [atk]: 252, def: 4 }, nature: atk === "atk" ? "Adamant" : "Modest" };
  const defStat = (s.def ?? 0) >= (s.spd ?? 0) ? "def" : "spd";
  const wallSpread = { evs: { hp: 252, [defStat]: 252, atk: 4 }, nature: defStat === "def" ? "Bold" : "Calm" };
  const tera = cap(mon.types[0] || "normal");
  // Use the actual forme's ability (Mega/Primal/Totem formes differ from the base).
  const formeSp = Dex.species.get(mon.name);
  const ability = (formeSp.exists ? Object.values(formeSp.abilities)[0] : null) || (mon.abilities && mon.abilities[0]) || "";

  const sets = [];
  const seen = new Set();
  const push = (set) => { const k = set.moves.join(","); if (set.moves.length && !seen.has(k)) { seen.add(k); sets.push(set); } };

  const offMoves = (cat) => fill([...attackMoves(cat, 3)]);
  const physSet = () => ({ name: "Physical Attacker", moves: offMoves("Physical"), ability, item: fast ? "Life Orb" : "Assault Vest", tera, ...offSpread("atk"), ivs: {}, level: LEVEL });
  const specSet = () => ({ name: "Special Attacker", moves: offMoves("Special"), ability, item: fast ? "Life Orb" : "Assault Vest", tera, ...offSpread("spa"), ivs: {}, level: LEVEL });
  const setupSet = () => {
    const cat = physical ? "Physical" : "Special";
    const moves = fill([setup[0], ...attackMoves(cat, 2)]);
    return { name: "Setup Sweeper", moves, ability, item: "Life Orb", tera, ...offSpread(physical ? "atk" : "spa"), ivs: {}, level: LEVEL };
  };
  const supportSet = () => {
    const dmg = fixed[0] || attackMoves(physical ? "Physical" : "Special", 1)[0];
    const picks = [recovery[0], status[0] || support[0], support[0] && support[0] !== (status[0] || support[0]) ? support[0] : support[1], dmg].filter(Boolean);
    const moves = fill([...new Set(picks)]);
    return { name: "Support", moves, ability, item: "Leftovers", tera, ...wallSpread, ivs: {}, level: LEVEL };
  };

  const isWall = offense <= 85 && bulk >= 300 && recovery.length > 0;
  const wantSupport = recovery.length > 0 && (status.length + support.length) > 0;

  // Order: best fit first.
  if (isWall) { push(supportSet()); if (physical && phys.length) push(physSet()); else if (spec.length) push(specSet()); }
  else {
    if (physical && phys.length) push(physSet()); else if (spec.length) push(specSet());
    if (setup.length && (phys.length || spec.length)) push(setupSet());
    if (wantSupport) push(supportSet());
    // a coverage-flipped attacker as a third option
    if (sets.length < 2) { if (physical && spec.length) push(specSet()); else if (!physical && phys.length) push(physSet()); }
  }
  // Guarantee at least one set even for move-poor mons.
  if (!sets.length) { const moves = fill([]); if (moves.length) push({ name: "Balanced", moves, ability, item: "Leftovers", tera, ...offSpread(physical ? "atk" : "spa"), ivs: {}, level: LEVEL }); }
  return sets.slice(0, 3);
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
async function learnsetFor(id) {
  if (learnsetCache.has(id)) return learnsetCache.get(id);
  const ls = await Dex.learnsets.get(id);
  const names = ls?.learnset
    ? Object.keys(ls.learnset).map((mid) => Dex.moves.get(mid)).filter((mv) => mv && mv.exists && mv.name).map((mv) => mv.name)
    : [];
  learnsetCache.set(id, names);
  return names;
}
async function legalMoves(speciesName) {
  const sp = Dex.species.get(speciesName);
  if (!sp || !sp.exists) return null;
  // Battle-only / alt formes (Necrozma-Ultra, Zacian-Crowned, megas…) carry almost
  // no learnset of their own — UNION the forme's moves with the base species'.
  const out = new Set();
  for (const id of [sp.id, toID(sp.baseSpecies)]) {
    if (!id) continue;
    for (const n of await learnsetFor(id)) out.add(n);
  }
  return out.size ? [...out].sort() : null;
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
// (movepools.json is written after roles are built, so role moves can be folded in.)

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
  const list = synthSets(m, mp);
  if (list.length) { rolesOut[m.id] = list; synth++; }
}
// Mega/Primal formes have a forced forme ability — override the listed ability
// to match (base species' randbats role would otherwise leave the base ability).
let megaFix = 0;
for (const m of dex) {
  if (!m.isMega || !rolesOut[m.id]) continue;
  const sp = Dex.species.get(m.name);
  const ab = sp.exists ? Object.values(sp.abilities)[0] : null;
  if (ab) { for (const r of rolesOut[m.id]) r.ability = ab; megaFix++; }
}
await writeFile(new URL("../public/roles.json", import.meta.url), JSON.stringify(rolesOut));
console.log(`Wrote roles.json (${Object.keys(rolesOut).length} mons; ${synth} synthesized; ${megaFix} mega abilities fixed)`);

// Fold every move used by a role set back into that mon's movepool. Randbats roles
// can reference moves the raw @pkmn/dex learnset omits (e.g. Life Dew), which would
// otherwise leave the teambuilder's move suggestions out of sync with the auto-set.
let folded = 0;
for (const id of Object.keys(rolesOut)) {
  const pool = new Set(movepoolsOut[id] ?? []);
  const before = pool.size;
  for (const set of rolesOut[id]) for (const mv of set.moves) if (mv) pool.add(mv);
  if (pool.size !== before) folded++;
  if (pool.size) movepoolsOut[id] = [...pool].sort();
}
await writeFile(new URL("../public/movepools.json", import.meta.url), JSON.stringify(movepoolsOut));
console.log(`Wrote movepools.json (${Object.keys(movepoolsOut).length} mons; folded role moves into ${folded})`);

// ── species.json (monId → canonical Showdown species name, so teams import cleanly) ──
function showdownSpecies(m) {
  let sp = Dex.species.get(m.name);
  if (!sp.exists) sp = Dex.species.get(FORM_KEY[norm(m.name)] || "");
  if (!sp.exists && m.isMega) sp = Dex.species.get(baseName.get(m.baseId) || "");
  // Cosmetic/event forms (cap Pikachus, Totems, Minior meteors, plumages) aren't
  // valid battle species — fall back to a species the engine knows so teams load.
  if (!sp.exists) sp = Dex.species.get(baseName.get(m.baseId) || "");
  if (!sp.exists) {
    const parts = m.name.split("-");
    while (parts.length > 1 && !sp.exists) { parts.pop(); sp = Dex.species.get(parts.join("-")); }
  }
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
