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

// ── Stage 3: shared-choice-log battles ──────────────────────────────
// A battle is teams + seed + an ordered list of choices. Every client replays
// the engine locally to render its point of view — no central referee.

export type PlayerSide = "p1" | "p2";
export type Viewer = PlayerSide | "spectator";

export function setupCommands(
  engineFormatId: string,
  p1: { name: string; team: string },
  p2: { name: string; team: string },
  seed: number[],
): string[] {
  return [
    `>start ${JSON.stringify({ formatid: engineFormatId, seed })}`,
    `>player p1 ${JSON.stringify({ name: p1.name, team: p1.team })}`,
    `>player p2 ${JSON.stringify({ name: p2.name, team: p2.team })}`,
  ];
}

// Engine request object (only the bits the UI uses).
export type Request = {
  rqid?: number;
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
  request: Request | null; // for the viewer side (null for spectators / waiting)
  near: SideView;          // viewer's side
  far: SideView;           // opponent
  log: string[];           // human-readable events
};

function parseCondition(c: string): { hpPct: number; fainted: boolean; status: string } {
  const [hp, ...rest] = c.split(" ");
  const [cur, max] = hp.split("/").map(Number);
  const fainted = c.includes("fnt") || cur === 0;
  return { hpPct: max ? Math.max(0, Math.round((cur / max) * 100)) : fainted ? 0 : 100, fainted, status: rest.join(" ") };
}

const STATUS_TEXT: Record<string, string> = {
  brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "put to sleep", frz: "frozen",
};
const nick = (idAndName: string) => idAndName.split(": ")[1] ?? idAndName;

// Replay the command list and return the given viewer's point of view.
export async function replay(commands: string[], viewer: Viewer): Promise<BattleSnapshot> {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const stream = viewer === "spectator" ? streams.spectator : streams[viewer];

  const names: Record<string, string> = { p1: "P1", p2: "P2" };
  const sides: Record<string, Slot[]> = { p1: [null, null], p2: [null, null] };
  let turn = 0, winner: string | null = null, ended = false;
  let request: Request | null = null;
  const log: string[] = [];

  const slotOf = (id: string) => ({ side: id.slice(0, 2), pos: id.charCodeAt(2) - 97 });
  const setSlot = (ref: string, details: string, cond: string) => {
    const { side, pos } = slotOf(ref);
    sides[side][pos] = { species: details.split(",")[0], ...parseCondition(cond) };
  };
  const updateCond = (ref: string, cond: string) => {
    const { side, pos } = slotOf(ref);
    const s = sides[side][pos];
    if (s) Object.assign(s, parseCondition(cond));
  };

  const consume = (async () => {
   try {
    for await (const chunk of stream)
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("|")) continue;
        const p = line.split("|"); // ["", tag, ...args]
        const tag = p[1];
        if (tag === "request") { request = line.length > 9 ? JSON.parse(line.slice(9)) : null; }
        else if (tag === "player") { if (p[2] && p[3]) names[p[2]] = p[3]; }
        else if (tag === "switch" || tag === "drag" || tag === "replace") {
          setSlot(p[2].split(":")[0], p[3], p[4] || "100/100");
          if (tag !== "replace") log.push(`${names[p[2].slice(0, 2)]} sent out ${nick(p[2])}.`);
        }
        else if (tag === "detailschange" || tag === "-formechange") {
          const { side, pos } = slotOf(p[2].split(":")[0]);
          if (sides[side][pos]) sides[side][pos]!.species = p[3].split(",")[0];
        }
        else if (tag === "-damage" || tag === "-heal" || tag === "-sethp") updateCond(p[2].split(":")[0], p[3]);
        else if (tag === "faint") {
          const { side, pos } = slotOf(p[2].split(":")[0]);
          if (sides[side][pos]) { sides[side][pos]!.fainted = true; sides[side][pos]!.hpPct = 0; }
          log.push(`${nick(p[2])} fainted.`);
        }
        else if (tag === "move") log.push(`${nick(p[2])} used ${p[3]}.`);
        else if (tag === "-status") log.push(`${nick(p[2])} was ${STATUS_TEXT[p[3]] ?? p[3]}.`);
        else if (tag === "-terastallize") log.push(`${nick(p[2])} Terastallized to ${p[3]}!`);
        else if (tag === "-mega") log.push(`${nick(p[2])} Mega Evolved!`);
        else if (tag === "turn") { turn = Number(p[2]); log.push(`— Turn ${turn} —`); }
        else if (tag === "win") { winner = p[2]?.trim() || null; ended = true; }
        else if (tag === "tie") { winner = "tie"; ended = true; }
      }
   } catch { /* stream destroyed after snapshot */ }
  })();

  streams.omniscient.write(commands.join("\n"));
  await new Promise((r) => setTimeout(r, 50)); // let the in-memory engine drain
  try { (streams.omniscient as unknown as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
  void consume;

  const near = viewer === "spectator" ? "p1" : viewer;
  const far = near === "p1" ? "p2" : "p1";
  // A request is only actionable when it isn't a wait. (cast: TS can't see the
  // closure mutation above, so it would otherwise narrow `request` to null.)
  const r = request as Request | null;
  const actionable = r && !r.wait ? r : null;
  return {
    turn, ended, winner, viewer, request: actionable,
    near: { name: names[near], active: sides[near] },
    far: { name: names[far], active: sides[far] },
    log,
  };
}

// True when this request needs the viewer to make a choice.
export const needsChoice = (r: Request | null) =>
  Boolean(r && !r.wait && (r.teamPreview || r.forceSwitch?.some(Boolean) || r.active?.some(Boolean)));

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
