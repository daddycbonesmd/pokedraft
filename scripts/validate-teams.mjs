// Validate that teambuilder data → engine-legal teams: build sets from roles.json
// for a few mons, format to Showdown text (mirrors teamToShowdown), pack, and run
// a battle to confirm the engine accepts them.
import { readFile } from "node:fs/promises";
import { BattleStreams, Teams, RandomPlayerAI } from "@pkmn/sim";

const roles = JSON.parse(await readFile(new URL("../public/roles.json", import.meta.url)));
const species = JSON.parse(await readFile(new URL("../public/species.json", import.meta.url)));
const STAT_LABEL = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];

function setText(monId, role) {
  const sp = species[monId];
  const L = [role.item ? `${sp} @ ${role.item}` : sp];
  if (role.ability) L.push(`Ability: ${role.ability}`);
  L.push(`Level: ${role.level || 50}`);
  if (role.tera) L.push(`Tera Type: ${role.tera}`);
  const ev = STATS.filter((k) => (role.evs[k] ?? 0) > 0).map((k) => `${role.evs[k]} ${STAT_LABEL[k]}`).join(" / ");
  if (ev) L.push(`EVs: ${ev}`);
  if (role.nature) L.push(`${role.nature} Nature`);
  const iv = STATS.filter((k) => role.ivs[k] != null && role.ivs[k] !== 31).map((k) => `${role.ivs[k]} ${STAT_LABEL[k]}`).join(" / ");
  if (iv) L.push(`IVs: ${iv}`);
  for (const mv of role.moves) L.push(`- ${mv}`);
  return L.join("\n");
}

// Garchomp(445), Incineroar(727), Amoonguss(591), Flutter Mane(987), Gholdengo(1000)
const ids = [445, 727, 591, 987, 1000];
const text = ids.map((id) => setText(id, roles[id][0])).join("\n\n");
console.log("=== generated team ===\n" + text + "\n");

const packed = Teams.pack(Teams.import(text));
console.log("packed OK, length:", packed.length);

const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
const p1 = new RandomPlayerAI(streams.p1); const p2 = new RandomPlayerAI(streams.p2);
void p1.start(); void p2.start();
let winner = null, turns = 0;
const consume = (async () => {
  for await (const ch of streams.omniscient)
    for (const line of ch.split("\n")) {
      if (line.startsWith("|turn|")) turns = Number(line.slice(6));
      const m = line.match(/^\|win\|(.*)/); if (m) winner = m[1].trim();
    }
})();
void streams.omniscient.write(
  `>start ${JSON.stringify({ formatid: "gen9doublescustomgame", gameType: "doubles" })}\n` +
  `>player p1 ${JSON.stringify({ name: "A", team: packed })}\n` +
  `>player p2 ${JSON.stringify({ name: "B", team: packed })}`,
);
await consume;
console.log(`\nBattle ran with generated teams. winner=${winner} turns=${turns}`);
