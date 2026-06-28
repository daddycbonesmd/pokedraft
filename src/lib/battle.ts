// Browser-side battle engine wrapper around the real Pokémon Showdown sim
// (@pkmn/sim). The host's browser runs the BattleStream; player/spectator views
// are relayed over Supabase in the networked battle (Stage 3). For now this
// exposes the primitives + a self-playing demo to prove the engine bundles.
import { BattleStreams, Teams } from "@pkmn/sim";

// Turn Showdown export text (what the teambuilder produces) into the packed
// team string the sim expects. Throws if the text can't be parsed.
export function packTeam(exportText: string): string {
  const team = Teams.import(exportText);
  if (!team) throw new Error("Could not parse that team.");
  return Teams.pack(team);
}

export type PlayerSpec = { name: string; team: string }; // team = packed string

// Run a battle with both sides controlled by the engine's random AI. Used for
// the bundling test + as a "simulate this matchup" feature. Calls onLine for
// every protocol line; resolves with the winner's name.
export async function runDemoBattle(
  format: string,
  p1: PlayerSpec,
  p2: PlayerSpec,
  onLine: (line: string) => void,
): Promise<string | null> {
  const { RandomPlayerAI } = await import("@pkmn/sim");
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const ai1 = new RandomPlayerAI(streams.p1);
  const ai2 = new RandomPlayerAI(streams.p2);
  void ai1.start();
  void ai2.start();

  let winner: string | null = null;
  const consume = (async () => {
    for await (const chunk of streams.omniscient) {
      for (const line of chunk.split("\n")) {
        onLine(line);
        const m = line.match(/^\|win\|(.*)/);
        if (m) winner = m[1].trim();
      }
    }
  })();

  void streams.omniscient.write(
    `>start ${JSON.stringify({ formatid: format })}\n` +
      `>player p1 ${JSON.stringify(p1)}\n` +
      `>player p2 ${JSON.stringify(p2)}`,
  );

  await consume;
  return winner;
}
