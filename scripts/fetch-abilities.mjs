// Seeds public/abilities.json: { "<Ability Name>": "<short description>" }
// from PokéAPI, so the auction screen can show what each ability does.
// Run: node scripts/fetch-abilities.mjs
import { writeFile } from "node:fs/promises";

const pretty = (s) => s.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

async function getJSON(url, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (t === tries - 1) throw e; await new Promise((res) => setTimeout(res, 600 * (t + 1))); }
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } };
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

const tidy = (s) => (s || "").replace(/\s+/g, " ").trim();

console.log("Fetching ability list…");
const list = (await getJSON("https://pokeapi.co/api/v2/ability?limit=2000")).results;
console.log(`Found ${list.length} abilities. Fetching descriptions…`);

let done = 0;
const entries = await pool(list, 20, async (e) => {
  try {
    const d = await getJSON(e.url);
    const en = (d.effect_entries || []).find((x) => x.language.name === "en");
    let desc = tidy(en?.short_effect || en?.effect);
    if (!desc) {
      const ft = (d.flavor_text_entries || []).filter((x) => x.language.name === "en");
      desc = tidy(ft[ft.length - 1]?.flavor_text);
    }
    if (d.effect_chance != null) desc = desc.replace(/\$effect_chance/g, String(d.effect_chance));
    if (++done % 100 === 0) console.log(`  …${done}/${list.length}`);
    return [pretty(e.name), desc];
  } catch {
    return [pretty(e.name), ""];
  }
});

const map = {};
for (const [name, desc] of entries) if (desc) map[name] = desc;
await writeFile(new URL("../public/abilities.json", import.meta.url), JSON.stringify(map));
console.log(`\nWrote ${Object.keys(map).length} ability descriptions to public/abilities.json`);
