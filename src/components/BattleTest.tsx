"use client";

import { useState } from "react";

const TEAM1 = `Garchomp @ Life Orb
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
- Protect`;

const TEAM2 = `Incineroar @ Sitrus Berry
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
- Protect`;

export default function BattleTest() {
  const [log, setLog] = useState<string[]>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError(""); setWinner(null); setLog([]);
    try {
      const { packTeam, runDemoBattle } = await import("@/lib/battle");
      const lines: string[] = [];
      const w = await runDemoBattle(
        "gen9customgame",
        { name: "Alice", team: packTeam(TEAM1) },
        { name: "Bob", team: packTeam(TEAM2) },
        (line) => { if (line.trim()) lines.push(line); },
      );
      setLog(lines);
      setWinner(w);
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="font-display text-3xl font-black mb-2">Battle engine test</h1>
      <p className="text-ink-soft mb-4">Runs a real Pokémon Showdown battle (random AI both sides) entirely in your browser.</p>
      <button className="btn btn-coral" onClick={run} disabled={busy}>
        {busy ? "Battling…" : "Run a battle"}
      </button>
      {error && <p className="text-coral mt-4 font-mono text-sm">{error}</p>}
      {winner && <p className="mt-4 text-xl font-display font-bold">Winner: <span className="text-coral">{winner}</span> · {log.filter((l) => l.startsWith("|turn|")).length} turns · {log.length} protocol lines</p>}
      {log.length > 0 && (
        <pre className="mt-4 paper p-4 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap">{log.join("\n")}</pre>
      )}
    </main>
  );
}
