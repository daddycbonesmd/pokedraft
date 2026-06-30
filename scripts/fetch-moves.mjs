// Seeds public/moves.json: { byMon: { "<monId>": ["Move", ...up to 6...] }, info: {...} }
// "Notable" is tuned for DOUBLES (VGC): signature moves, priority, spread moves
// (except Hyper Voice), redirection/speed-control/support, key status & setup.
// Hazards are intentionally EXCLUDED (irrelevant in doubles).
// Run: node scripts/fetch-moves.mjs
import { readFile, writeFile } from "node:fs/promises";

const RANDBATS_DOUBLES = "https://raw.githubusercontent.com/pkmn/randbats/main/data/gen9randomdoublesbattle.json";
const RANDBATS_SINGLES = "https://raw.githubusercontent.com/pkmn/randbats/main/data/gen9randombattle.json";
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Curated doubles categories (priority/spread/signature are auto-detected) ──
const set = (...xs) => new Set(xs);
const PREMIUM_SUPPORT = set("Fake Out", "Follow Me", "Rage Powder", "Helping Hand", "Decorate", "Coaching", "Instruct", "Ally Switch");
const SPEED_CONTROL = set("Tailwind", "Trick Room", "Icy Wind", "Electroweb", "Thunder Wave", "After You", "Nuzzle");
const DISRUPTION = set("Taunt", "Encore", "Disable", "Haze", "Parting Shot", "Knock Off", "Trick", "Switcheroo", "Imprison", "Quash", "Spite", "Clear Smog", "Roar", "Whirlwind", "Dragon Tail", "Circle Throw", "Foul Play");
const STATUS = set("Will-O-Wisp", "Spore", "Sleep Powder", "Yawn", "Glare", "Stun Spore", "Toxic", "Poison Powder", "Confuse Ray", "Lovely Kiss", "Sing");
const PROTECT_SUPPORT = set("Wide Guard", "Quick Guard");
const SUPPORT = set("Heal Pulse", "Life Dew", "Pollen Puff", "Aromatic Mist", "Gravity", "Beat Up", "Skill Swap", "Trick Room", "Heal Bell", "Aromatherapy", "Snarl", "Struggle Bug");
const SETUP = set("Dragon Dance", "Swords Dance", "Nasty Plot", "Calm Mind", "Bulk Up", "Shell Smash", "Quiver Dance", "Belly Drum", "Tail Glow", "Geomancy", "Victory Dance", "No Retreat", "Clangorous Soul", "Take Heart", "Acupressure", "Curse", "Coil", "Filet Away", "Fillet Away");
const SACRIFICE = set("Self-Destruct", "Explosion", "Misty Explosion", "Final Gambit", "Memento", "Healing Wish", "Lunar Dance", "Revival Blessing");
const RECOVERY = set("Recover", "Roost", "Slack Off", "Soft-Boiled", "Morning Sun", "Moonlight", "Synthesis", "Milk Drink", "Shore Up", "Wish", "Strength Sap", "Jungle Healing");
// Excluded entirely — singles-only or not draft-notable in doubles.
const EXCLUDE = set("Stealth Rock", "Spikes", "Toxic Spikes", "Sticky Web", "Rapid Spin", "Defog", "Mortal Spin", "Tidy Up", "Court Change", "Hyper Voice", "Protect", "Detect");
const SPREAD_TARGETS = new Set(["all-opponents", "all-other-pokemon"]);

function scoreMove(name, d) {
  if (EXCLUDE.has(name)) return 0;
  if ((d.lb ?? 99) <= 1) return 100;              // true signature (1 learner)
  if ((d.lb ?? 99) <= 4) return 96;               // semi-signature (a handful of learners)
  if (PREMIUM_SUPPORT.has(name)) return 95;
  if ((d.pr ?? 0) > 0 && d.c !== "status") return 88; // damaging priority
  if ((d.pr ?? 0) > 0) return 82;                  // status priority (Quick Guard etc.)
  if (SPEED_CONTROL.has(name)) return 80;
  if (SPREAD_TARGETS.has(d.tg)) return 70;         // spread move
  if (d.c !== "status" && (d.p ?? 0) >= 100 && (d.ac == null || d.ac >= 90)) return 68; // strong reliable attack (Close Combat, Brave Bird, Wave Crash…)
  if (DISRUPTION.has(name)) return 66;
  if (STATUS.has(name)) return 60;
  if (PROTECT_SUPPORT.has(name)) return 58;
  if (SUPPORT.has(name)) return 56;
  if (SACRIFICE.has(name)) return 54;
  if (SETUP.has(name)) return 48;
  if (RECOVERY.has(name)) return 38;
  return 0;
}

async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (t === tries - 1) throw e; await new Promise((res) => setTimeout(res, 500 * (t + 1))); }
  }
}
async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  const w = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } };
  await Promise.all(Array.from({ length: size }, w));
  return out;
}

console.log("Fetching random-battle movepools (doubles + singles)…");
const speciesMoves = {};
function addRandbats(rb) {
  for (const [name, entry] of Object.entries(rb)) {
    const key = norm(name);
    const s = speciesMoves[key] ?? (speciesMoves[key] = new Set());
    for (const mv of entry.moves || []) s.add(mv);
    for (const role of Object.values(entry.roles || {})) for (const mv of role.moves || []) s.add(mv);
  }
}
addRandbats(await getJSON(RANDBATS_DOUBLES));
addRandbats(await getJSON(RANDBATS_SINGLES));

// PokéAPI form name (normalized) → Showdown species key, for forms that differ.
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
const movesFor = (n) => speciesMoves[n] ?? speciesMoves[FORM_KEY[n] ?? ""];

const myDex = JSON.parse(await readFile(new URL("../public/pokedex.json", import.meta.url)));
// Full legal movepools (from a prior fetch-roles run) let us surface a mon's
// signature/semi-signature moves even when they aren't in its competitive set.
let movepools = {};
try { movepools = JSON.parse(await readFile(new URL("../public/movepools.json", import.meta.url))); }
catch { console.warn("movepools.json not found — run fetch-roles.mjs first for signature moves."); }
const baseName = new Map(myDex.map((m) => [m.id, m.name]));
const monMoves = new Map(); // monId → Set of moves
const allMoves = new Set();
for (const m of myDex) {
  let have = movesFor(norm(m.name));
  if (!have && m.isMega) have = movesFor(norm(baseName.get(m.baseId) || ""));
  if (!have) continue;
  monMoves.set(m.id, have);
  have.forEach((x) => allMoves.add(x));
}
// Every movepool move needs a details fetch too, so we can read its learner count.
for (const id of Object.keys(movepools)) for (const mv of movepools[id]) allMoves.add(mv);

console.log(`Fetching details for ${allMoves.size} moves…`);
let done = 0;
const moveList = [...allMoves];
const detailPairs = await pool(moveList, 20, async (mv) => {
  try {
    const d = await getJSON(`https://pokeapi.co/api/v2/move/${slug(mv)}`);
    const en = (d.effect_entries || []).find((e) => e.language.name === "en");
    let desc = (en?.short_effect || "").replace(/\s+/g, " ").trim();
    if (d.effect_chance != null) desc = desc.replace(/\$effect_chance/g, String(d.effect_chance));
    if (++done % 100 === 0) console.log(`  …${done}/${moveList.length}`);
    return [mv, { t: d.type?.name ?? "", p: d.power ?? null, c: d.damage_class?.name ?? "",
      d: desc, pr: d.priority ?? 0, tg: d.target?.name ?? "", lb: (d.learned_by_pokemon || []).length, ac: d.accuracy ?? null }];
  } catch { return [mv, { t: "", p: null, c: "", d: "", pr: 0, tg: "", lb: 99, ac: null }]; }
});
const detail = Object.fromEntries(detailPairs);

const byMon = {};
const usedMoves = new Set();
for (const [id, moves] of monMoves) {
  // Competitive moves + any signature/semi-signature move from the full movepool.
  const cand = new Set(moves);
  for (const mv of movepools[id] || []) if ((detail[mv]?.lb ?? 99) <= 4) cand.add(mv);
  const scored = [...cand]
    .map((mv) => ({ mv, s: scoreMove(mv, detail[mv] || {}) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.mv.localeCompare(b.mv))
    .slice(0, 6)
    .map((x) => x.mv);
  if (scored.length) { byMon[id] = scored; scored.forEach((mv) => usedMoves.add(mv)); }
}

const info = {};
for (const mv of usedMoves) { const d = detail[mv]; info[mv] = { t: d.t, p: d.p, c: d.c, d: d.d }; }

await writeFile(new URL("../public/moves.json", import.meta.url), JSON.stringify({ byMon, info }));
console.log(`\nWrote moves.json (${Object.keys(byMon).length} mons, ${Object.keys(info).length} moves)`);
