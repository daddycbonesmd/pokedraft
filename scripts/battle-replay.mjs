// Prototype for Stage 3's networking model: a battle = teams + seed + an ordered
// list of player choices. Every client replays the engine from scratch to get the
// current state — no central referee. This proves the replay/choice loop reaches a
// result, using "default" choices for both sides.
import { readFile } from "node:fs/promises";
import { BattleStreams, Teams } from "@pkmn/sim";

const roles = JSON.parse(await readFile(new URL("../public/roles.json", import.meta.url)));
const species = JSON.parse(await readFile(new URL("../public/species.json", import.meta.url)));
const STAT_LABEL = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const STATS = ["hp", "atk", "def", "spa", "spd", "spe"];

function setText(id) {
  const r = roles[id][0], sp = species[id];
  const L = [r.item ? `${sp} @ ${r.item}` : sp];
  if (r.ability) L.push(`Ability: ${r.ability}`);
  L.push(`Level: ${r.level || 50}`);
  if (r.tera) L.push(`Tera Type: ${r.tera}`);
  const ev = STATS.filter((k) => (r.evs[k] ?? 0) > 0).map((k) => `${r.evs[k]} ${STAT_LABEL[k]}`).join(" / ");
  if (ev) L.push(`EVs: ${ev}`);
  if (r.nature) L.push(`${r.nature} Nature`);
  for (const mv of r.moves) L.push(`- ${mv}`);
  return L.join("\n");
}

const ids = Object.keys(roles).slice(0, 8).map(Number);
const team1 = Teams.pack(Teams.import(ids.slice(0, 4).map(setText).join("\n\n")));
const team2 = Teams.pack(Teams.import(ids.slice(4, 8).map(setText).join("\n\n")));

const setup = [
  `>start ${JSON.stringify({ formatid: "gen9doublescustomgame", seed: [1, 2, 3, 4] })}`,
  `>player p1 ${JSON.stringify({ name: "P1", team: team1 })}`,
  `>player p2 ${JSON.stringify({ name: "P2", team: team2 })}`,
];

// Choices are kept in submission order — which is always a valid command order,
// because a side can only be asked to choose once the previous turn resolved.
const buildInput = (choices) => [...setup, ...choices.map((c) => `>${c.player} ${c.choice}`)];

// Replay all commands in a fresh stream and snapshot each side's current request + winner.
async function snapshot(commands) {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const reqs = { p1: null, p2: null };
  let winner = null, turn = 0;
  const watch = (stream, side) => (async () => {
    for await (const chunk of stream)
      for (const line of chunk.split("\n")) {
        const m = line.match(/^\|request\|(.*)/);
        if (m) reqs[side] = m[1] ? JSON.parse(m[1]) : null;
      }
  })();
  watch(streams.p1, "p1"); watch(streams.p2, "p2");
  (async () => {
    for await (const chunk of streams.omniscient)
      for (const line of chunk.split("\n")) {
        if (line.startsWith("|turn|")) turn = Number(line.slice(6));
        const w = line.match(/^\|win\|(.*)/); if (w) winner = w[1].trim();
        if (line.trim() === "|tie") winner = "tie";
      }
  })();
  streams.omniscient.write(commands.join("\n"));
  await new Promise((r) => setTimeout(r, 40)); // let the in-memory engine drain
  return { reqs, winner, turn };
}

const needAction = (r) => r && !r.wait && (r.teamPreview || r.active || r.forceSwitch);

const choices = [];
let result = null;
for (let iter = 0; iter < 1000; iter++) {
  const { reqs, winner, turn } = await snapshot(buildInput(choices));
  if (winner !== null) { result = `winner=${winner} turn=${turn} choices=${choices.length}`; break; }
  let acted = false;
  for (const side of ["p1", "p2"]) {
    if (needAction(reqs[side])) { choices.push({ player: side, choice: "default" }); acted = true; }
  }
  if (!acted) { result = `STUCK p1=${JSON.stringify(reqs.p1)?.slice(0,80)} p2=${JSON.stringify(reqs.p2)?.slice(0,80)}`; break; }
}
console.log(result ?? "no result in 1000 iters");
