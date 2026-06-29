// Browser-side battle engine wrapper around the real Pokémon Showdown sim
// (@pkmn/sim). The host's browser runs the BattleStream; player/spectator views
// are relayed over Supabase in the networked battle (Stage 3). For now this
// exposes the primitives + a self-playing demo to prove the engine bundles.
import { Battle, BattleStreams, Teams } from "@pkmn/sim";

// Turn Showdown export text (what the teambuilder produces) into the packed
// team string the sim expects. Throws if the text can't be parsed.
export function packTeam(exportText: string): string {
  const team = Teams.import(exportText);
  if (!team) throw new Error("Could not parse that team.");
  return Teams.pack(team);
}

// ── Stage 3: shared-choice-log battles ──────────────────────────────
// A battle is teams + seed + an ordered list of choices. Every client replays
// the engine locally to render its point of view — no central referee.

export type PlayerSide = "p1" | "p2";
export type Viewer = PlayerSide | "spectator";
export type ChoiceEntry = { side: string; choice: string };

// Engine request object (only the bits the UI uses).
export type Request = {
  teamPreview?: boolean;
  wait?: boolean;
  forceSwitch?: boolean[];
  active?: ({ moves: { move: string; id: string; pp: number; maxpp: number; target: string; disabled?: boolean }[]; canTerastallize?: string; canMegaEvo?: boolean; canMegaEvoX?: boolean; canMegaEvoY?: boolean } | null)[] | null;
  side?: { name: string; pokemon: { ident: string; details: string; condition: string; active: boolean }[] };
};

export type Slot = { species: string; hpPct: number; fainted: boolean; status: string } | null;
export type SideView = { name: string; active: Slot[] };
export type BattleSnapshot = {
  turn: number;
  ended: boolean;
  winner: string | null;
  viewer: Viewer;
  request: Request | null; // the viewer's current request (options to choose from)
  owes: boolean;           // whether the viewer must make a choice right now (authoritative)
  near: SideView;          // viewer's side
  far: SideView;           // opponent
  log: string[];           // human-readable events
};

const STATUS_TEXT: Record<string, string> = {
  brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "put to sleep", frz: "frozen",
};
const nick = (idAndName: string) => idAndName.split(": ")[1] ?? idAndName;

// Turn the omniscient protocol log into a few human-readable lines.
function readableLog(log: readonly string[]): string[] {
  const names: Record<string, string> = {};
  const out: string[] = [];
  for (const line of log) {
    if (!line.startsWith("|")) continue;
    const p = line.split("|");
    switch (p[1]) {
      case "player": if (p[2] && p[3]) names[p[2]] = p[3]; break;
      case "switch": case "drag": out.push(`${names[p[2].slice(0, 2)] ?? ""} sent out ${nick(p[2])}.`.trimStart()); break;
      case "faint": out.push(`${nick(p[2])} fainted.`); break;
      case "move": out.push(`${nick(p[2])} used ${p[3]}.`); break;
      case "-status": out.push(`${nick(p[2])} was ${STATUS_TEXT[p[3]] ?? p[3]}.`); break;
      case "-terastallize": out.push(`${nick(p[2])} Terastallized to ${p[3]}!`); break;
      case "-mega": out.push(`${nick(p[2])} Mega Evolved!`); break;
      case "turn": out.push(`— Turn ${p[2]} —`); break;
    }
  }
  return out;
}

// Replay a battle from teams + seed + ordered choices using the real engine, and
// return the viewer's authoritative point of view. The Battle object's per-side
// isChoiceDone()/requestState tells us reliably whether the viewer still owes a
// choice — the streamed protocol can't (it never emits "wait" in batch replay).
export function replay(
  input: { formatid: string; p1: { name: string; team: string }; p2: { name: string; team: string }; seed: number[]; choices: ChoiceEntry[] },
  viewer: Viewer,
): BattleSnapshot {
  const battle = new Battle({ formatid: input.formatid, seed: input.seed } as unknown as ConstructorParameters<typeof Battle>[0]);
  battle.setPlayer("p1", { name: input.p1.name, team: input.p1.team });
  battle.setPlayer("p2", { name: input.p2.name, team: input.p2.team });
  for (const c of input.choices) {
    try { battle.choose(c.side as PlayerSide, c.choice); } catch { /* skip invalid (stale) choice */ }
  }

  const sideView = (idx: number): SideView => ({
    name: battle.sides[idx].name,
    active: battle.sides[idx].active.map((mon) => mon ? {
      species: mon.species.name,
      hpPct: mon.maxhp ? Math.max(0, Math.round((mon.hp / mon.maxhp) * 100)) : (mon.fainted ? 0 : 100),
      fainted: mon.fainted,
      status: mon.status || "",
    } : null),
  });

  const nearIdx = viewer === "p2" ? 1 : 0;
  const vSide = viewer === "spectator" ? null : battle.sides[nearIdx];
  const owes = !!vSide && !vSide.isChoiceDone() && vSide.requestState !== "";
  const ended = !!battle.ended;

  return {
    turn: battle.turn,
    ended,
    winner: ended ? (battle.winner || "tie") : null,
    viewer,
    request: (vSide?.activeRequest ?? null) as Request | null,
    owes,
    near: sideView(nearIdx),
    far: sideView(nearIdx === 0 ? 1 : 0),
    log: readableLog(battle.log),
  };
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
