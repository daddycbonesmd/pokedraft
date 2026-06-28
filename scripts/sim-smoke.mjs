// Smoke test: run a full battle with the real Showdown engine using explicit
// teams (the path the app will use — teams come from the teambuilder).
import { BattleStreams, Teams, RandomPlayerAI } from "@pkmn/sim";

const team1 = `
Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Swords Dance
- Stone Edge

Rotom-Wash @ Leftovers
Ability: Levitate
Level: 50
EVs: 252 HP / 4 SpA / 252 SpD
Calm Nature
- Hydro Pump
- Volt Switch
- Will-O-Wisp
- Protect
`;

const team2 = `
Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Knock Off
- Parting Shot

Amoonguss @ Rocky Helmet
Ability: Regenerator
Level: 50
EVs: 252 HP / 156 Def / 100 SpD
Calm Nature
- Spore
- Rage Powder
- Pollen Puff
- Protect
`;

const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
const spec = { formatid: "gen9customgame" };
const p1spec = { name: "Alice", team: Teams.pack(Teams.import(team1)) };
const p2spec = { name: "Bob", team: Teams.pack(Teams.import(team2)) };

const p1 = new RandomPlayerAI(streams.p1);
const p2 = new RandomPlayerAI(streams.p2);
void p1.start();
void p2.start();

let winner = null, turns = 0, lines = 0;
const consume = (async () => {
  for await (const chunk of streams.omniscient) {
    for (const line of chunk.split("\n")) {
      lines++;
      if (line.startsWith("|turn|")) turns = Number(line.slice(6));
      const m = line.match(/^\|win\|(.*)/);
      if (m) winner = m[1].trim();
    }
  }
})();

void streams.omniscient.write(
  `>start ${JSON.stringify(spec)}\n>player p1 ${JSON.stringify(p1spec)}\n>player p2 ${JSON.stringify(p2spec)}`
);

await consume;
console.log(`Battle finished. winner=${winner} turns=${turns} protocolLines=${lines}`);
