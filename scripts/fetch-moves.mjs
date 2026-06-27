// Seeds public/moves.json:
//   { byMon: { "<monId>": ["Move", ...up to 4...] }, info: { "Move": {t,p,c,d} } }
// "Notable" = the signature/utility moves that define a Pokémon's niche (disruption,
// pivoting, hazards, status, priority, setup) — NOT its whole attacking movepool.
// We intersect each mon's gen9 random-battle movepool with a curated notable list.
// Run: node scripts/fetch-moves.mjs
import { readFile, writeFile } from "node:fs/promises";

const RANDBATS = "https://raw.githubusercontent.com/pkmn/randbats/main/data/gen9randombattle.json";
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Ordered by notability — the distinctive utility/disruption moves come first so the
// top-4 cap favours what actually makes a Pokémon special.
const NOTABLE = [
  // signature utility / disruption
  "Fake Out", "Parting Shot", "Knock Off", "Sucker Punch", "First Impression", "Court Change",
  "Shed Tail", "Chilly Reception", "Revival Blessing", "Healing Wish", "Lunar Dance", "Destiny Bond",
  "Final Gambit", "Spore", "Sleep Powder", "Sticky Web", "Strength Sap", "Nuzzle", "Decorate",
  "Follow Me", "Rage Powder", "Tidy Up", "Mortal Spin", "Pollen Puff", "Coaching",
  // hazards / control / pivot
  "Stealth Rock", "Spikes", "Toxic Spikes", "Rapid Spin", "Defog", "U-turn", "Volt Switch",
  "Flip Turn", "Teleport", "Trick", "Switcheroo", "Encore", "Taunt", "Disable", "Will-O-Wisp",
  "Thunder Wave", "Glare", "Yawn", "Haze", "Clear Smog", "Dragon Tail", "Circle Throw",
  "Whirlwind", "Roar", "Perish Song", "Leech Seed", "Pain Split", "Heal Bell", "Aromatherapy",
  "Wish", "Tailwind", "Aurora Veil", "Trick Room", "Toxic",
  // priority
  "Extreme Speed", "Bullet Punch", "Mach Punch", "Aqua Jet", "Ice Shard", "Shadow Sneak",
  "Grassy Glide", "Jet Punch", "Accelerock", "Water Shuriken", "Vacuum Wave",
  // setup
  "Shell Smash", "Dragon Dance", "Quiver Dance", "Nasty Plot", "Swords Dance", "Calm Mind",
  "Bulk Up", "Belly Drum", "No Retreat", "Victory Dance", "Clangorous Soul", "Tail Glow", "Geomancy",
  // recovery (lowest priority)
  "Recover", "Roost", "Slack Off", "Soft-Boiled", "Morning Sun", "Moonlight", "Synthesis", "Shore Up", "Milk Drink",
];

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

console.log("Fetching random-battle movepools…");
const rb = await getJSON(RANDBATS);
const speciesMoves = {};
for (const [name, entry] of Object.entries(rb)) {
  const set = new Set(entry.moves || []);
  for (const role of Object.values(entry.roles || {})) for (const mv of role.moves || []) set.add(mv);
  speciesMoves[norm(name)] = set;
}

const notableFor = (have) => NOTABLE.filter((mv) => have.has(mv)).slice(0, 4);

const myDex = JSON.parse(await readFile(new URL("../public/pokedex.json", import.meta.url)));
const baseName = new Map(myDex.map((m) => [m.id, m.name]));
const byMon = {};
const allMoves = new Set();
for (const m of myDex) {
  let have = speciesMoves[norm(m.name)];
  if (!have && m.isMega) have = speciesMoves[norm(baseName.get(m.baseId) || "")];
  if (!have) continue;
  const notable = notableFor(have);
  if (notable.length) { byMon[m.id] = notable; notable.forEach((x) => allMoves.add(x)); }
}
console.log(`${Object.keys(byMon).length} Pokémon with notable moves, ${allMoves.size} unique moves.`);

let done = 0;
const moveList = [...allMoves];
const infoPairs = await pool(moveList, 20, async (mv) => {
  try {
    const d = await getJSON(`https://pokeapi.co/api/v2/move/${slug(mv)}`);
    const en = (d.effect_entries || []).find((e) => e.language.name === "en");
    let desc = (en?.short_effect || "").replace(/\s+/g, " ").trim();
    if (d.effect_chance != null) desc = desc.replace(/\$effect_chance/g, String(d.effect_chance));
    if (++done % 50 === 0) console.log(`  …${done}/${moveList.length}`);
    return [mv, { t: d.type?.name ?? "", p: d.power ?? null, c: d.damage_class?.name ?? "", d: desc }];
  } catch { return [mv, { t: "", p: null, c: "", d: "" }]; }
});
const info = Object.fromEntries(infoPairs);

await writeFile(new URL("../public/moves.json", import.meta.url), JSON.stringify({ byMon, info }));
console.log(`\nWrote moves.json (${Object.keys(byMon).length} mons, ${Object.keys(info).length} moves)`);
