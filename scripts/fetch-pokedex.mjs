// One-time seed script: pulls the full Pokédex (including mega/alt forms) from
// PokéAPI into public/pokedex.json so the app has fast, offline-friendly data.
// Run with:  node scripts/fetch-pokedex.mjs
import { writeFile } from "node:fs/promises";

const LIST_URL = "https://pokeapi.co/api/v2/pokemon?limit=100000";

// National-dex ranges → generation.
const GEN_RANGES = [
  [1, 151], [152, 251], [252, 386], [387, 493], [494, 649],
  [650, 721], [722, 809], [810, 905], [906, 1025],
];
const genOf = (dex) => {
  for (let i = 0; i < GEN_RANGES.length; i++) {
    const [a, b] = GEN_RANGES[i];
    if (dex >= a && dex <= b) return i + 1;
  }
  return 0;
};

const pretty = (s) =>
  s.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

// Keep every Mega form the data source provides (mainline + expanded sets).
const isMegaName = (name) => /-mega(-|$)/.test(name);

async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (t === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 600 * (t + 1)));
    }
  }
}

// Run `fn` over `items` with a fixed number of concurrent workers.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

console.log("Fetching the Pokémon list…");
const list = (await getJSON(LIST_URL)).results;
console.log(`Found ${list.length} entries. Fetching details (this takes a minute)…`);

let done = 0;
const mons = await pool(list, 24, async (entry) => {
  try {
    const d = await getJSON(entry.url);
    const baseId = Number(d.species.url.split("/").filter(Boolean).pop());
    const bst = d.stats.reduce((s, x) => s + x.base_stat, 0);
    const name = entry.name;
    const mon = {
      id: d.id,
      name,
      display: pretty(name),
      types: d.types.map((t) => t.type.name),
      abilities: d.abilities.map((a) => pretty(a.ability.name)),
      bst,
      baseId,
      gen: genOf(baseId),
      isMega: isMegaName(name),
      isGmax: /-gmax$/.test(name),
    };
    if (++done % 150 === 0) console.log(`  …${done}/${list.length}`);
    return mon;
  } catch (e) {
    console.error(`  ! failed ${entry.name}: ${e.message}`);
    return null;
  }
});

const clean = mons.filter(Boolean).sort((a, b) => a.baseId - b.baseId || a.id - b.id);
await writeFile(new URL("../public/pokedex.json", import.meta.url), JSON.stringify(clean));
console.log(`\nDone. Wrote ${clean.length} Pokémon to public/pokedex.json`);
