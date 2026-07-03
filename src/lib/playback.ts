// Turns a raw Showdown protocol log into an ordered list of "steps" the battle
// screen plays back one at a time — so a turn unfolds in speed order with event
// banners and animations, instead of the whole turn snapping to its end state.
// Purely derived from the protocol, so every client produces the same playback.
import type { Slot, FieldState, Viewer } from "./battle";

export type BannerTone =
  | "move" | "super" | "resist" | "immune" | "crit" | "miss" | "fail"
  | "status" | "boostUp" | "boostDown" | "faint" | "weather" | "field" | "ability" | "heal" | "info";

export type Step = {
  near: Slot[];      // viewer's active positions [a, b]
  far: Slot[];       // opponent's active positions [a, b]
  nearName: string;
  farName: string;
  field: FieldState;
  banner: string | null;  // event text to surface (null = silent state change, e.g. raw HP tick)
  tone: BannerTone;
  attacker: string | null; // species lunging this step
  delayMs: number;         // how long to hold this step before the next
};

type Mon = { species: string; level: number; hpPct: number; fainted: boolean; status: string; tera: string; boosts: Record<string, number>; volatiles: Set<string> };

const WEATHER: Record<string, string> = {
  sunnyday: "The sunlight turned harsh", raindance: "It started to rain", sandstorm: "A sandstorm kicked up",
  snowscape: "It started to snow", hail: "It started to hail", desolateland: "The sunlight turned extremely harsh",
  primordialsea: "A heavy rain began", deltastream: "Mysterious strong winds began",
};
const TERRAIN: Record<string, string> = {
  electricterrain: "Electric Terrain", grassyterrain: "Grassy Terrain", psychicterrain: "Psychic Terrain", mistyterrain: "Misty Terrain",
};
const STAT_NAME: Record<string, string> = {
  atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasion",
};
const STATUS_TEXT: Record<string, string> = {
  brn: "burned", par: "paralyzed", psn: "poisoned", tox: "badly poisoned", slp: "fast asleep", frz: "frozen solid",
};
const STATUS_DMG: Record<string, string> = { brn: "its burn", psn: "poison", tox: "poison" };
const CANT: Record<string, string> = { par: "paralysis", slp: "sleep", frz: "being frozen", flinch: "flinching", recharge: "recharging" };

const nick = (tag: string) => tag.split(": ")[1] ?? tag;
const pos = (tag: string) => tag.slice(0, 3);
const clean = (s: string) => (s || "").replace(/^(move|ability|item): /, "");
const toID = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function parseCond(c: string): { hpPct: number; fainted: boolean; status: string } {
  if (!c) return { hpPct: 100, fainted: false, status: "" };
  if (c.includes("fnt")) return { hpPct: 0, fainted: true, status: "" };
  const [hp, status] = c.split(" ");
  const [cur, max] = hp.split("/").map(Number);
  return { hpPct: max ? Math.max(0, Math.round((cur / max) * 100)) : 100, fainted: false, status: status ?? "" };
}

export function buildTimeline(raw: string[], viewer: Viewer): Step[] {
  const names: Record<string, string> = {};
  const model: Record<string, Mon | null> = {};
  const field: FieldState = { weather: "", terrain: "", trickRoom: false };
  const steps: Step[] = [];
  let started = false; // becomes true at the first |turn| — pre-game switch-ins don't animate

  const nearSide = viewer === "p2" ? "p2" : "p1";
  const farSide = nearSide === "p1" ? "p2" : "p1";

  const slotOf = (key: string): Slot => {
    const m = model[key];
    if (!m) return null;
    return {
      species: m.species, level: m.level, hpPct: m.hpPct, fainted: m.fainted, status: m.status, tera: m.tera,
      boosts: Object.fromEntries(Object.entries(m.boosts).filter(([, v]) => v !== 0)),
      volatiles: [...m.volatiles],
    };
  };
  const emit = (banner: string | null, tone: BannerTone, delayMs: number, attacker: string | null = null) => {
    steps.push({
      near: [slotOf(nearSide + "a"), slotOf(nearSide + "b")],
      far: [slotOf(farSide + "a"), slotOf(farSide + "b")],
      nearName: names[nearSide] ?? "", farName: names[farSide] ?? "",
      field: { ...field }, banner, tone, attacker, delayMs,
    });
  };

  let skip = false;
  for (const line of raw) {
    // The omniscient log writes a secret + public copy of each hidden event after
    // a |split| marker; the two are identical here, so drop one.
    if (line.startsWith("|split|")) { skip = true; continue; }
    if (skip) { skip = false; continue; }
    if (!line.startsWith("|")) continue;
    const p = line.split("|");
    const cmd = p[1];

    switch (cmd) {
      case "player": if (p[2] && p[3]) names[p[2]] = p[3]; break;
      case "turn": started = true; break;
      case "switch": case "drag": case "replace": {
        const key = pos(p[2]);
        const lvl = Number(p[3]?.match(/L(\d+)/)?.[1] ?? 50);
        const cond = parseCond(p[4] ?? "");
        model[key] = { species: nick(p[2]), level: lvl, hpPct: cond.hpPct, fainted: cond.fainted, status: cond.status, tera: "", boosts: {}, volatiles: new Set() };
        if (started) emit(`${names[key.slice(0, 2)] ?? ""} sent out ${nick(p[2])}!`.trimStart(), "info", 900);
        break;
      }
      case "detailschange": {
        // The NEW species is in p[3] ("Charizard-Mega-X, L50, M"); p[2] still carries
        // the pre-change nickname, so reading it left the sprite stuck on the base form.
        // Silent here — the paired |-mega| / |-primal| line carries the announcement.
        const m = model[pos(p[2])];
        const next = p[3]?.split(",")[0]?.trim();
        if (m && next) { m.species = next; emit(null, "info", 150); }
        break;
      }
      case "-formechange": {
        const m = model[pos(p[2])];
        const next = p[3]?.split(",")[0]?.trim();
        if (m && next) { m.species = next; emit(`${nick(p[2])} transformed into ${next}!`, "field", 850); }
        break;
      }
      case "move": emit(`${nick(p[2])} used ${p[3]}!`, "move", 2000, nick(p[2])); break;
      case "cant": emit(`${nick(p[2])} couldn't move${CANT[p[3]] ? ` — ${CANT[p[3]]}` : ""}!`, "fail", 950); break;
      case "-supereffective": emit("It's super effective!", "super", 650); break;
      case "-resisted": emit("It's not very effective…", "resist", 650); break;
      case "-immune": emit(`It doesn't affect ${nick(p[2])}…`, "immune", 800); break;
      case "-crit": emit("A critical hit!", "crit", 600); break;
      case "-miss": emit(`${nick(p[2])}'s attack missed!`, "miss", 850); break;
      case "-fail": emit(`${nick(p[2]) ? `${nick(p[2])}: ` : ""}But it failed!`, "fail", 850); break;
      case "-damage": {
        const m = model[pos(p[2])]; if (!m) break;
        const cond = parseCond(p[3] ?? "");
        m.hpPct = cond.hpPct; m.fainted = cond.fainted;
        if (line.includes("[silent]")) { emit(null, "info", 200); break; }
        const from = p[4]?.startsWith("[from]") ? p[4].replace("[from] ", "") : "";
        if (from) {
          const src = STATUS_DMG[from] ?? clean(from);
          emit(`${nick(p[2])} was hurt by ${src}!`, "status", 900);
        } else {
          emit(null, "info", 520); // damage from the move itself — just tick the HP bar down
        }
        break;
      }
      case "-heal": {
        const m = model[pos(p[2])]; if (!m) break;
        const cond = parseCond(p[3] ?? ""); m.hpPct = cond.hpPct; m.fainted = cond.fainted;
        if (line.includes("[silent]")) { emit(null, "info", 200); break; } // e.g. the Dynamax HP boost
        const from = p[4]?.startsWith("[from]") ? clean(p[4].replace("[from] ", "")) : "";
        emit(from ? `${nick(p[2])} was healed by ${from}!` : `${nick(p[2])} restored its health!`, "heal", 800);
        break;
      }
      case "-sethp": { const m = model[pos(p[2])]; if (m) { const c = parseCond(p[3] ?? ""); m.hpPct = c.hpPct; m.fainted = c.fainted; emit(null, "info", 450); } break; }
      case "-status": { const m = model[pos(p[2])]; if (m) m.status = p[3]; emit(`${nick(p[2])} was ${STATUS_TEXT[p[3]] ?? p[3]}!`, "status", 950); break; }
      case "-curestatus": { const m = model[pos(p[2])]; if (m) m.status = ""; emit(`${nick(p[2])} shook off its condition!`, "info", 700); break; }
      case "-boost": { const m = model[pos(p[2])]; const n = Number(p[4]); if (m) m.boosts[p[3]] = Math.min(6, (m.boosts[p[3]] ?? 0) + n); emit(`${nick(p[2])}'s ${STAT_NAME[p[3]] ?? p[3]} ${n >= 2 ? "rose sharply" : "rose"}!`, "boostUp", 750); break; }
      case "-unboost": { const m = model[pos(p[2])]; const n = Number(p[4]); if (m) m.boosts[p[3]] = Math.max(-6, (m.boosts[p[3]] ?? 0) - n); emit(`${nick(p[2])}'s ${STAT_NAME[p[3]] ?? p[3]} ${n >= 2 ? "harshly fell" : "fell"}!`, "boostDown", 750); break; }
      case "-setboost": { const m = model[pos(p[2])]; if (m) m.boosts[p[3]] = Number(p[4]); emit(`${nick(p[2])}'s ${STAT_NAME[p[3]] ?? p[3]} changed!`, "boostUp", 700); break; }
      case "-clearboost": case "-clearnegativeboost": { const m = model[pos(p[2])]; if (m) m.boosts = {}; emit(`${nick(p[2])}'s stat changes were cleared!`, "info", 650); break; }
      case "-clearallboost": { for (const k of Object.keys(model)) if (model[k]) model[k]!.boosts = {}; emit("All stat changes were eliminated!", "info", 700); break; }
      case "faint": { const m = model[pos(p[2])]; if (m) { m.fainted = true; m.hpPct = 0; m.volatiles.clear(); } emit(`${nick(p[2])} fainted!`, "faint", 1200); break; }
      case "-weather": {
        if (p[3] === "[upkeep]") break;
        if (p[2] === "none") { field.weather = ""; emit("The weather cleared up.", "weather", 750); }
        else { field.weather = WEATHER[p[2].toLowerCase()] ? p[2] : p[2]; emit(`${WEATHER[p[2].toLowerCase()] ?? p[2]}!`, "weather", 800); }
        break;
      }
      case "-fieldstart": {
        const eff = clean(p[2]);
        if (/trick ?room/i.test(eff)) { field.trickRoom = true; emit("The dimensions were twisted!", "field", 800); }
        else { field.terrain = eff; emit(`${eff} covered the battlefield!`, "field", 800); }
        break;
      }
      case "-fieldend": {
        const eff = clean(p[2]);
        if (/trick ?room/i.test(eff)) field.trickRoom = false; else field.terrain = "";
        emit(`${eff} faded.`, "field", 650);
        break;
      }
      case "-sidestart": emit(`${clean(p[3])} set up on ${names[p[2]?.slice(0, 2)] ?? "the"} side!`, "field", 700); break;
      case "-ability": emit(`${nick(p[2])}'s ${p[3]}!`, "ability", 850); break;
      case "-activate": { const eff = clean(p[3] ?? ""); if (eff) emit(/protect/i.test(eff) ? `${nick(p[2])} protected itself!` : `${nick(p[2])}: ${eff}!`, "info", 750); break; }
      case "-start": {
        const eff = clean(p[3] ?? "");
        const m = model[pos(p[2])];
        if (/^g?max$/i.test(eff) || /dynamax/i.test(eff)) { emit(`${nick(p[2])} ${/gmax/i.test(eff) ? "Gigantamaxed" : "Dynamaxed"}!`, "field", 950); break; }
        if (m && eff) m.volatiles.add(toID(eff)); // persistent condition (Leech Seed, Confusion, Taunt, Substitute, …)
        if (eff) emit(`${nick(p[2])}: ${eff}!`, "status", 800);
        break;
      }
      case "-end": { const m = model[pos(p[2])]; const eff = clean(p[3] ?? ""); if (m && eff) m.volatiles.delete(toID(eff)); break; }
      case "-zpower": emit(`${nick(p[2])} surrounded itself with its Z-Power!`, "field", 900); break;
      case "-terastallize": { const m = model[pos(p[2])]; if (m) m.tera = p[3]; emit(`${nick(p[2])} Terastallized into ${p[3]}!`, "field", 950); break; }
      case "-mega": emit(`${nick(p[2])} Mega Evolved!`, "field", 950); break;
      case "-enditem": if (p[3]) emit(`${nick(p[2])} used its ${p[3]}!`, "info", 750); break;
      default: break;
    }
  }
  return steps;
}
