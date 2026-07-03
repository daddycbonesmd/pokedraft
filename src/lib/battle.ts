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
  active?: ({
    moves: { move: string; id: string; pp: number; maxpp: number; target: string; disabled?: boolean }[];
    canTerastallize?: string;
    canMegaEvo?: boolean; canMegaEvoX?: boolean; canMegaEvoY?: boolean;
    canDynamax?: boolean;
    maxMoves?: { maxMoves: { move: string; target: string }[]; gigantamax?: string };
    canZMove?: ({ move: string; target: string } | null)[];
  } | null)[] | null;
  side?: { name: string; pokemon: {
    ident: string; details: string; condition: string; active: boolean;
    // Your own side also carries the full loadout (hidden for the opponent) — used to
    // show moves/ability/item when scouting your team on the Team Preview screen.
    moves?: string[]; ability?: string; baseAbility?: string; item?: string; stats?: Record<string, number>;
  }[] };
};

export type Slot = {
  species: string;
  level: number;
  hpPct: number;
  fainted: boolean;
  status: string;
  tera: string;
  boosts: Record<string, number>; // only non-zero stat stages (atk/def/spa/spd/spe/accuracy/evasion)
  volatiles: string[];            // active volatile conditions (leechseed, confusion, taunt, …)
  item?: string;                  // the mon's CURRENT held item id ("" once lost) — own side only, so a Trick/Knock Off swap is visible
  // Spread details for the damage calculator — only populated for the viewer's own
  // mons (the opponent's EVs/nature/item stay hidden; the calc assumes a default).
  set?: { ability: string; item: string; nature: string; evs: Record<string, number>; ivs: Record<string, number> };
} | null;
export type SideCondition = { id: string; name: string; layers?: number };
export type SideView = { name: string; active: Slot[]; sideConditions: SideCondition[] };
export type FieldState = { weather: string; terrain: string; trickRoom: boolean };
export type BattleSnapshot = {
  turn: number;
  ended: boolean;
  winner: string | null;
  viewer: Viewer;
  request: Request | null; // the viewer's current request (options to choose from)
  owes: boolean;           // whether the viewer must make a choice right now (authoritative)
  near: SideView;          // viewer's side
  far: SideView;           // opponent
  farTeam: { species: string; level: number }[]; // opponent's full team (revealed at team preview)
  field: FieldState;       // weather / terrain / Trick Room
  log: string[];           // human-readable events
  raw: string[];           // raw Showdown protocol log (drives the animated playback timeline)
  nearRevealed: Record<string, string[]>; // species → moves the viewer's team has been seen using
  farRevealed: Record<string, string[]>;  // species → moves the opponent has been seen using
};

const WEATHER: Record<string, string> = {
  sunnyday: "Harsh Sunlight", raindance: "Rain", sandstorm: "Sandstorm", snowscape: "Snow", hail: "Hail",
  desolateland: "Extreme Sun", primordialsea: "Heavy Rain", deltastream: "Strong Winds",
};
const TERRAIN: Record<string, string> = {
  electricterrain: "Electric Terrain", grassyterrain: "Grassy Terrain", psychicterrain: "Psychic Terrain", mistyterrain: "Misty Terrain",
};
const STAT_NAME: Record<string, string> = {
  atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion",
};

const STATUS_TEXT: Record<string, string> = {
  brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "put to sleep", frz: "frozen",
};
// Persistent side conditions worth surfacing (screens, hazards, tailwind, …), id → label.
const SIDE_CONDITIONS: Record<string, string> = {
  reflect: "Reflect", lightscreen: "Light Screen", auroraveil: "Aurora Veil", safeguard: "Safeguard",
  mist: "Mist", tailwind: "Tailwind", luckychant: "Lucky Chant", stealthrock: "Stealth Rock",
  spikes: "Spikes", toxicspikes: "Toxic Spikes", stickyweb: "Sticky Web", gmaxsteelsurge: "G-Max Steelsurge",
  wideguard: "Wide Guard", quickguard: "Quick Guard", craftyshield: "Crafty Shield", matblock: "Mat Block",
};
const nick = (idAndName: string) => idAndName.split(": ")[1] ?? idAndName;

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const fieldName = (s: string) => s.replace(/^.*?: /, "");
const cleanEff = (s: string) => (s || "").replace(/^(move|ability|item): /, "");
const STATUS_DMG: Record<string, string> = { brn: "its burn", psn: "poison", tox: "poison" };
// Flavour for the charging turn of two-turn moves (|-prepare|).
const PREPARE: Record<string, string> = {
  fly: "flew up high", bounce: "sprang up", dig: "burrowed underground", dive: "hid underwater",
  phantomforce: "vanished instantly", shadowforce: "vanished instantly", skydrop: "took its target into the sky",
  solarbeam: "absorbed light", solarblade: "absorbed light", meteorbeam: "began overflowing with space power",
  electroshot: "absorbed electricity", skullbash: "lowered its head", skyattack: "became cloaked in a harsh light",
  razorwind: "whipped up a whirlwind", freezeshock: "became cloaked in a freezing light", iceburn: "became cloaked in freezing air",
  geomancy: "is absorbing power",
};
function hpPct(cond: string): number | null {
  if (!cond) return null;
  if (cond.includes("fnt")) return 0;
  const [hp] = cond.split(" ");
  const [c, m] = hp.split("/").map(Number);
  return m ? Math.round((c / m) * 100) : null;
}
function fromSource(part: string | undefined): string | null {
  if (!part || !part.startsWith("[from]")) return null;
  const raw = part.replace("[from] ", "");
  return STATUS_DMG[raw] ?? cleanEff(raw);
}

// Turn the omniscient protocol log into human-readable lines. The omniscient log
// interleaves a secret + public copy of each event after a |split| marker — we
// drop the secret copy so events aren't printed twice.
function readableLog(log: readonly string[]): string[] {
  const names: Record<string, string> = {};
  const out: string[] = [];
  let skip = false;
  for (const line of log) {
    if (line.startsWith("|split|")) { skip = true; continue; }
    if (skip) { skip = false; continue; }
    if (!line.startsWith("|")) continue;
    const p = line.split("|");
    const o = (s: string) => out.push(s);
    switch (p[1]) {
      case "player": if (p[2] && p[3]) names[p[2]] = p[3]; break;
      case "switch": case "drag": o(`${names[p[2].slice(0, 2)] ?? ""} sent out ${nick(p[2])}.`.trimStart()); break;
      case "faint": o(`${nick(p[2])} fainted.`); break;
      case "move": o(`${nick(p[2])} used ${p[3]}.`); break;
      case "cant": o(`${nick(p[2])} couldn't move.`); break;
      case "-crit": o("A critical hit!"); break;
      case "-supereffective": o("It's super effective!"); break;
      case "-resisted": o("It's not very effective…"); break;
      case "-immune": o(`It doesn't affect ${nick(p[2])}…`); break;
      case "-miss": o(`${nick(p[2])}'s attack missed!`); break;
      case "-fail": o("But it failed!"); break;
      case "-status": o(`${nick(p[2])} was ${STATUS_TEXT[p[3]] ?? p[3]}.`); break;
      case "-curestatus": o(`${nick(p[2])} was cured.`); break;
      case "-boost": o(`${nick(p[2])}'s ${STAT_NAME[p[3]] ?? p[3]} ${Number(p[4]) >= 2 ? "rose sharply" : "rose"}!`); break;
      case "-unboost": o(`${nick(p[2])}'s ${STAT_NAME[p[3]] ?? p[3]} ${Number(p[4]) >= 2 ? "harshly fell" : "fell"}!`); break;
      case "-weather": if (p[3] !== "[upkeep]") o(p[2] === "none" ? "The weather cleared." : `${WEATHER[toID(p[2])] ?? p[2]} set in!`); break;
      case "-fieldstart": o(`${fieldName(p[2])}${/trick ?room/i.test(p[2]) ? " twisted the dimensions" : ""}!`); break;
      case "-fieldend": o(`${fieldName(p[2])} ended.`); break;
      case "-sidestart": o(`${names[p[2].slice(0, 2)] ?? ""}: ${fieldName(p[3])} set up.`.trimStart()); break;
      case "-sideend": o(`${names[p[2]?.slice(0, 2)] ?? ""}: ${fieldName(p[3])} wore off.`.trimStart()); break;
      case "-prepare": o(`${nick(p[2])} ${PREPARE[toID(p[3])] ?? `began charging ${p[3]}`}!`); break;
      case "-hitcount": o(`Hit ${p[3]} time${p[3] === "1" ? "" : "s"}!`); break;
      case "-mustrecharge": o(`${nick(p[2])} must recharge!`); break;
      case "-notarget": o("But there was no target…"); break;
      case "-transform": o(`${nick(p[2])} transformed into ${nick(p[3])}!`); break;
      case "-item": {
        const src = p[4]?.startsWith("[from]") ? cleanEff(p[4].replace("[from] ", "")) : "";
        o(src ? `${nick(p[2])} obtained ${p[3]} (${src})!` : `${nick(p[2])} is holding ${p[3]}!`);
        break;
      }
      case "-ability": o(`${nick(p[2])}'s ${p[3]}!`); break;
      case "-terastallize": o(`${nick(p[2])} Terastallized to ${p[3]}!`); break;
      case "-mega": o(`${nick(p[2])} Mega Evolved!`); break;
      case "-damage": {
        if (line.includes("[silent]")) break;
        const hp = hpPct(p[3]), src = fromSource(p[4]);
        o(src ? `${nick(p[2])} was hurt by ${src}.${hp != null ? ` (${hp}%)` : ""}`
              : `${nick(p[2])} dropped to ${hp ?? 0}%.`);
        break;
      }
      case "-heal": {
        if (line.includes("[silent]")) break;
        const hp = hpPct(p[3]), src = fromSource(p[4]);
        o(src ? `${nick(p[2])} was healed by ${src}.${hp != null ? ` (${hp}%)` : ""}` : `${nick(p[2])} restored HP. (${hp ?? 100}%)`);
        break;
      }
      case "-start": {
        const eff = cleanEff(p[3] ?? "");
        if (/^g?max$/i.test(eff) || /dynamax/i.test(eff)) o(`${nick(p[2])} ${/gmax/i.test(eff) ? "Gigantamaxed" : "Dynamaxed"}!`);
        else if (eff) o(`${nick(p[2])}: ${eff}!`);
        break;
      }
      case "-zpower": o(`${nick(p[2])} surrounded itself with its Z-Power!`); break;
      case "-enditem": o(line.includes("[eat]") ? `${nick(p[2])} ate its ${p[3]}!` : `${nick(p[2])}'s ${p[3]} activated!`); break;
      case "-activate": { const eff = cleanEff(p[3] ?? ""); if (eff) o(/protect/i.test(eff) ? `${nick(p[2])} protected itself!` : `${nick(p[2])}: ${eff}!`); break; }
      case "-singleturn": { const eff = cleanEff(p[3] ?? ""); if (/protect/i.test(eff)) o(`${nick(p[2])} protected itself!`); break; }
      case "turn": o(`— Turn ${p[2]} —`); break;
    }
  }
  return out;
}

// Incremental-replay cache. The choice log is append-only and the engine is
// deterministic, so re-simulating from turn 1 on every realtime tick is pure waste
// — and that waste grows with the battle's length, which is exactly what made a
// long battle's move buttons freeze ("time out"). We keep the live Battle object
// per (teams+seed+format) identity and feed it only the choices appended since last
// time, turning an O(turns) resim into O(new choices). A tiny LRU caps memory.
type CacheEntry = { battle: Battle; applied: string[] };
const REPLAY_CACHE = new Map<string, CacheEntry>();
const REPLAY_CACHE_MAX = 4;
// Free a @pkmn/sim Battle's internals (it nulls the field + both sides) when we drop
// it from the cache, so evicted engines don't linger in memory until GC.
const destroyBattle = (b: Battle) => { try { (b as unknown as { destroy?: () => void }).destroy?.(); } catch { /* older engine builds may lack destroy() */ } };
const choiceKey = (c: ChoiceEntry) => `${c.side}${c.choice}`;

// Replay a battle from teams + seed + ordered choices using the real engine, and
// return the viewer's authoritative point of view. The Battle object's per-side
// isChoiceDone()/requestState tells us reliably whether the viewer still owes a
// choice — the streamed protocol can't (it never emits "wait" in batch replay).
export function replay(
  input: { formatid: string; p1: { name: string; team: string }; p2: { name: string; team: string }; seed: number[]; choices: ChoiceEntry[] },
  viewer: Viewer,
): BattleSnapshot {
  const keys = input.choices.map(choiceKey);
  const cacheKey = `${input.formatid}${input.seed.join(",")}${input.p1.team}${input.p2.team}`;
  let entry = REPLAY_CACHE.get(cacheKey);

  // Reuse the cached engine only if what we've already applied is a prefix of the
  // (possibly longer) new choice log. If a shorter/divergent log arrives — e.g. a
  // realtime read that raced behind another — rebuild from scratch to stay correct.
  // The choice log is append-only, so what we've already applied and the incoming log
  // should agree on their common prefix. If incoming EXTENDS applied we apply just the
  // new choices (fast path). If incoming is SHORTER/equal (a read that raced behind
  // another) the cache is already ahead on the SAME history, so reuse it as-is — never
  // rewind, and never pay a full from-scratch resim just because one poller lagged
  // (that repeated rebuild is what still made long-battle move input stutter). Only a
  // genuine prefix DIVERGENCE (which shouldn't happen) forces a rebuild.
  if (entry) {
    const common = Math.min(entry.applied.length, keys.length);
    let sameLine = true;
    for (let i = 0; i < common; i++) if (entry.applied[i] !== keys[i]) { sameLine = false; break; }
    if (!sameLine) { destroyBattle(entry.battle); entry = undefined; } // rebuilding — free the old engine
  }

  if (!entry) {
    const fresh = new Battle({ formatid: input.formatid, seed: input.seed } as unknown as ConstructorParameters<typeof Battle>[0]);
    fresh.setPlayer("p1", { name: input.p1.name, team: input.p1.team });
    fresh.setPlayer("p2", { name: input.p2.name, team: input.p2.team });
    entry = { battle: fresh, applied: [] };
    REPLAY_CACHE.set(cacheKey, entry);
    if (REPLAY_CACHE.size > REPLAY_CACHE_MAX) {
      // Evict the least-recently-used entry and free its (heavy) engine internals.
      const oldestKey = REPLAY_CACHE.keys().next().value as string;
      const oldest = REPLAY_CACHE.get(oldestKey);
      REPLAY_CACHE.delete(oldestKey);
      if (oldest) destroyBattle(oldest.battle);
    }
  } else {
    // Touch for LRU: re-insert so it's the most-recently-used entry.
    REPLAY_CACHE.delete(cacheKey); REPLAY_CACHE.set(cacheKey, entry);
  }

  const battle = entry.battle;
  // Apply only the choices we haven't fed the engine yet.
  for (let i = entry.applied.length; i < input.choices.length; i++) {
    const c = input.choices[i];
    try { battle.choose(c.side as PlayerSide, c.choice); } catch { /* skip invalid (stale) choice */ }
    entry.applied.push(keys[i]);
  }

  const sideConditionsOf = (idx: number): SideCondition[] => {
    const sc = (battle.sides[idx] as unknown as { sideConditions?: Record<string, { id?: string; layers?: number }> }).sideConditions ?? {};
    return Object.entries(sc).map(([id, v]) => ({ id, name: SIDE_CONDITIONS[id] ?? id, layers: v?.layers }));
  };
  const sideView = (idx: number, withSet: boolean): SideView => ({
    name: battle.sides[idx].name,
    sideConditions: sideConditionsOf(idx),
    active: battle.sides[idx].active.map((mon) => mon ? {
      species: mon.species.name,
      level: mon.level,
      hpPct: mon.maxhp ? Math.max(0, Math.round((mon.hp / mon.maxhp) * 100)) : (mon.fainted ? 0 : 100),
      fainted: mon.fainted,
      status: mon.status || "",
      tera: (mon as unknown as { terastallized?: string }).terastallized || "",
      // Current held item (empty once Knocked Off / Tricked away). Only ever shown to a
      // player for their OWN side — never to a spectator, and never for the opponent.
      item: (withSet && viewer !== "spectator") ? ((mon as unknown as { item?: string }).item || "") : undefined,
      boosts: Object.fromEntries(
        Object.entries((mon as unknown as { boosts?: Record<string, number> }).boosts ?? {}).filter(([, v]) => v !== 0),
      ),
      volatiles: Object.keys((mon as unknown as { volatiles?: Record<string, unknown> }).volatiles ?? {}),
      set: withSet ? (() => {
        const m = mon as unknown as { ability?: string; item?: string; set?: { ability?: string; item?: string; nature?: string; evs?: Record<string, number>; ivs?: Record<string, number> } };
        return { ability: m.ability || m.set?.ability || "", item: m.item || m.set?.item || "", nature: m.set?.nature || "", evs: m.set?.evs || {}, ivs: m.set?.ivs || {} };
      })() : undefined,
    } : null),
  });

  // Track which moves each side has been *seen* using, so the UI can reveal an
  // opponent's known moves on hover (information you'd legitimately have).
  const revealed: Record<"p1" | "p2", Record<string, Set<string>>> = { p1: {}, p2: {} };
  for (const line of battle.log) {
    if (!line.startsWith("|move|")) continue;
    const parts = line.split("|"); // |move|p1a: Garchomp|Earthquake|...
    const side = parts[2]?.slice(0, 2);
    const species = nick(parts[2] ?? "");
    const move = parts[3];
    if ((side === "p1" || side === "p2") && species && move) {
      (revealed[side][species] ??= new Set()).add(move);
    }
  }
  const toArr = (m: Record<string, Set<string>>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));

  const nearIdx = viewer === "p2" ? 1 : 0;
  const vSide = viewer === "spectator" ? null : battle.sides[nearIdx];
  const owes = !!vSide && !vSide.isChoiceDone() && vSide.requestState !== "";
  const ended = !!battle.ended;
  const f = battle.field as unknown as { weather?: string; terrain?: string; pseudoWeather?: Record<string, unknown> };

  return {
    turn: battle.turn,
    ended,
    winner: ended ? (battle.winner || "tie") : null,
    viewer,
    request: (vSide?.activeRequest ?? null) as Request | null,
    owes,
    near: sideView(nearIdx, true),
    far: sideView(nearIdx === 0 ? 1 : 0, false),
    // The opponent's whole team, the way classic Team Preview reveals it (species +
    // level only — items/moves/spreads stay hidden until used).
    farTeam: battle.sides[nearIdx === 0 ? 1 : 0].pokemon.map((p) => ({ species: p.species.name, level: p.level })),
    field: {
      weather: f.weather ? (WEATHER[f.weather] ?? f.weather) : "",
      terrain: f.terrain ? (TERRAIN[f.terrain] ?? f.terrain) : "",
      trickRoom: Boolean(f.pseudoWeather?.trickroom),
    },
    log: readableLog(battle.log),
    raw: [...battle.log],
    nearRevealed: toArr(revealed[viewer === "p2" ? "p2" : "p1"]),
    farRevealed: toArr(revealed[viewer === "p2" ? "p1" : "p2"]),
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
