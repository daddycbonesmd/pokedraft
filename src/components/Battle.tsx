"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sprites } from "@pkmn/img";
import { TYPE_COLORS, typeEffectiveness, loadPokedex, type PokeMon } from "@/lib/pokedex";
import {
  engineFormat, isMegaOnly, getBattle, getBattleChoices, getLeagueById, getIdentity,
  subscribeBattle, submitChoice, finishBattle, reportMatchResult,
  type Battle as BattleRow, type BattleChoice, type BattleFormat,
} from "@/lib/db";
import {
  replay, type BattleSnapshot, type Viewer, type Request, type Slot, type FieldState, type SideCondition,
} from "@/lib/battle";
import { buildTimeline, type Step, type BannerTone } from "@/lib/playback";
import { calcDamage, type DamageResult } from "@/lib/damagecalc";
import { arenaFor } from "@/lib/arenas";

type MoveInfo = { name: string; type: string; cat: "Physical" | "Special" | "Status"; bp: number; acc: number; pp: number; pr: number; target: string; desc: string };
type TargetOpt = { slot: number; species: string; kind: "foe" | "ally" | "self" };
type FoeInfo = { species: string; types: string[]; fainted: boolean } | null;
type Gimmick = "mega" | "terastallize" | "dynamax" | "zmove";
// "maxflare" → "Max Flare", "gmaxwildfire" → "G-Max Wildfire"
const prettyMax = (id: string) =>
  id.startsWith("gmax") ? "G-Max " + id.slice(4).replace(/^./, (c) => c.toUpperCase())
  : id.startsWith("max") ? "Max " + id.slice(3).replace(/^./, (c) => c.toUpperCase())
  : id.replace(/^./, (c) => c.toUpperCase());
const CAT_ICON: Record<string, string> = { Physical: "●", Special: "◆", Status: "○" };
const STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const STAT_SHORT: Record<string, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };
// Volatile conditions worth surfacing on-sprite (keyed by the engine's volatile id).
// Anything not listed (internal/duration markers) is ignored.
const VOLATILE_LABELS: Record<string, { label: string; color: string }> = {
  leechseed: { label: "Leech Seed", color: "#4a9e4a" },
  confusion: { label: "Confused", color: "#b06bc7" },
  taunt: { label: "Taunt", color: "#d24a3d" },
  substitute: { label: "Substitute", color: "#7a7a7a" },
  encore: { label: "Encore", color: "#d97aa8" },
  disable: { label: "Disable", color: "#8a8a8a" },
  yawn: { label: "Drowsy", color: "#5b9bd6" },
  attract: { label: "Infatuated", color: "#e08ab8" },
  curse: { label: "Cursed", color: "#5a4a6a" },
  perishsong: { label: "Perish Song", color: "#3a3a44" },
  aquaring: { label: "Aqua Ring", color: "#4f8fd6" },
  ingrain: { label: "Ingrain", color: "#6a8a3a" },
  torment: { label: "Torment", color: "#c0533f" },
  partiallytrapped: { label: "Trapped", color: "#c98a2f" },
  saltcure: { label: "Salt Cure", color: "#6b8a99" },
  healblock: { label: "Heal Block", color: "#c0432f" },
  nightmare: { label: "Nightmare", color: "#4a3a5a" },
  magnetrise: { label: "Magnet Rise", color: "#e0b13a" },
  telekinesis: { label: "Telekinesis", color: "#9a5aa8" },
  powertrick: { label: "Power Trick", color: "#cc7a3a" },
  gastroacid: { label: "Ability Off", color: "#8a8a8a" },
  electrify: { label: "Electrified", color: "#e0b13a" },
  foresight: { label: "Identified", color: "#888888" },
  miracleeye: { label: "Identified", color: "#888888" },
  smackdown: { label: "Grounded", color: "#cc9b53" },
  tarshot: { label: "Tar Shot", color: "#4d433b" },
  charge: { label: "Charged", color: "#e0b13a" },
  protect: { label: "Protected", color: "#5aa653" },
  endure: { label: "Enduring", color: "#b0a060" },
};
const volLabels = (vs: string[] | undefined) => (vs ?? []).map((v) => VOLATILE_LABELS[v]).filter(Boolean) as { label: string; color: string }[];
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Layout effect on the client, plain effect on the server (avoids the SSR warning).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Speed at level for the extreme spreads — slowest (0 IV/EV, −nature) to fastest
// (31 IV / 252 EV, +nature) — so a hovered foe shows a believable speed window.
function speedRange(base: number, level: number): [number, number] {
  const calc = (iv: number, ev: number, nat: number) =>
    Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * nat);
  return [calc(0, 0, 0.9), calc(31, 252, 1.1)];
}
const EFF_LABEL = (x: number) => (x === 0 ? "No effect" : x >= 4 ? "4× super effective" : x > 1 ? "2× super effective" : x <= 0.25 ? "¼× resisted" : x < 1 ? "½× resisted" : "1× neutral");
const EFF_COLOR = (x: number) => (x === 0 ? "#6b6b6b" : x > 1 ? "#d9594c" : x < 1 ? "#4f8fd6" : "#7a7a7a");
const EFF_TEXT = (x: number) => (x === 0 ? "0×" : x === 4 ? "4×" : x === 2 ? "2×" : x === 0.5 ? "½×" : x === 0.25 ? "¼×" : "1×");
// Colour a damage-roll chip by lethality (share of the foe's max HP it deals).
const DMG_COLOR = (d: DamageResult) => (d.immune ? "#6b6b6b" : d.hiPct >= 100 ? "#c0392b" : d.hiPct >= 50 ? "#d97a2f" : d.hiPct >= 25 ? "#b8932f" : "#5a7a8a");
const round1 = (n: number) => Math.round(n);
// Colour the playback event banner by what kind of event it is.
const BANNER_COLOR: Record<BannerTone, string> = {
  move: "#3a3a44", super: "#d9594c", resist: "#4f8fd6", immune: "#6b6b6b", crit: "#d9594c", miss: "#8a8a8a",
  fail: "#8a8a8a", status: "#9b5fb0", boostUp: "#2f9e54", boostDown: "#d24a3d", faint: "#2a2a2a",
  weather: "#5a86c9", field: "#2f8f83", ability: "#c98a2f", heal: "#3aa657", info: "#3a3a44",
};
type SlotChoice =
  | { kind: "move"; index: number; moveTarget: string; needTarget: boolean }
  | { kind: "switch"; index: number };

export default function Battle({ id }: { id: string }) {
  const [battle, setBattle] = useState<BattleRow | null>(null);
  const [viewer, setViewer] = useState<Viewer>("spectator");
  const [snap, setSnap] = useState<BattleSnapshot | null>(null);
  const [choices, setChoices] = useState<BattleChoice[]>([]);
  const [pending, setPending] = useState<Record<number, SlotChoice>>({});
  const [gimmick, setGimmick] = useState<Record<number, Gimmick>>({});
  const [fatal, setFatal] = useState("");
  const [code, setCode] = useState("");
  const reported = useRef(false);
  const runRef = useRef<() => void>(() => {});
  const prevChoiceLen = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const [movedex, setMovedex] = useState<Record<string, MoveInfo>>({});
  const [itemNames, setItemNames] = useState<Record<string, string>>({}); // item id → display name
  const [abilityNames, setAbilityNames] = useState<Record<string, string>>({}); // ability id → display name
  const [megaByStone, setMegaByStone] = useState<Record<string, string>>({}); // mega-stone id → mega species (for the damage preview)
  const [dex, setDex] = useState<Map<string, PokeMon>>(new Map());
  // Animated playback: `cursor` is the timeline step currently on screen (−1 = caught
  // up, showing the live final state). `playedRef` is the furthest step we've shown.
  const [cursor, setCursor] = useState(-1);
  const cursorRef = useRef(-1);
  cursorRef.current = cursor;
  const playedRef = useRef(-1);
  const firstTimeline = useRef(true);
  const loadedRef = useRef(false);
  const timelineRef = useRef<Step[]>([]);

  useEffect(() => { fetch("/movedex.json").then((r) => r.json()).then(setMovedex).catch(() => {}); }, []);
  useEffect(() => {
    fetch("/items.json").then((r) => r.json()).then((items: { name: string }[]) => {
      setItemNames(Object.fromEntries(items.map((it) => [toID(it.name), it.name])));
    }).catch(() => {});
    fetch("/abilities.json").then((r) => r.json()).then((abil: Record<string, string>) => {
      setAbilityNames(Object.fromEntries(Object.keys(abil).map((name) => [toID(name), name])));
    }).catch(() => {});
    fetch("/megas.json").then((r) => r.json()).then((megas: Record<string, { stone: string; species: string }>) => {
      const byStone: Record<string, string> = {};
      for (const m of Object.values(megas)) if (m.stone && m.species) byStone[toID(m.stone)] = m.species;
      setMegaByStone(byStone);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    loadPokedex().then((list) => {
      const m = new Map<string, PokeMon>();
      for (const p of list) { m.set(toID(p.name), p); m.set(toID(p.display), p); }
      setDex(m);
    }).catch(() => {});
  }, []);
  // Re-sync shortly after our own writes — realtime can race read-after-write,
  // which otherwise leaves the AI (or our view) stuck on a stale replay.
  const scheduleSync = () => setTimeout(() => runRef.current(), 500);

  // Initial load: identify the viewer + sprite map.
  useEffect(() => {
    (async () => {
      const b = await getBattle(id);
      if (!b) { setFatal("That battle doesn't exist."); return; }
      const league = await getLeagueById(b.league_id);
      const c = league?.code ?? "";
      setCode(c);
      const identity = c ? getIdentity(c) : null;
      setViewer(identity?.coachId === b.p1_coach_id ? "p1" : identity?.coachId === b.p2_coach_id ? "p2" : "spectator");
      setBattle(b);
    })();
  }, [id]);

  // Replay on every change (own load + realtime).
  useEffect(() => {
    if (!battle) return;
    let cancelled = false;
    const run = async () => {
      const [b, ch] = await Promise.all([getBattle(id), getBattleChoices(id)]);
      if (!b || cancelled) return;
      const s = replay({
        formatid: engineFormat(b.format as BattleFormat, b.generation),
        p1: { name: b.p1_name, team: b.p1_team }, p2: { name: b.p2_name, team: b.p2_team },
        seed: b.seed, choices: ch.map((c) => ({ side: c.side, choice: c.choice })),
      }, viewer);
      if (cancelled) return;
      setBattle(b); setChoices(ch); setSnap(s);
      loadedRef.current = true;
      // Only clear an in-progress selection when the turn actually advanced (a new
      // choice was recorded). Otherwise the safety heartbeat below would wipe the
      // move the player is mid-way through picking every few seconds.
      if (ch.length !== prevChoiceLen.current) { setPending({}); setGimmick({}); prevChoiceLen.current = ch.length; }

      // Any client persists the result once the engine declares a winner; only the
      // one whose write actually flipped it (finalized) is the authoritative reporter.
      const finalized = (s.ended && b.status === "active") ? await finishBattle(id, s.winner) : false;

      // Advance the tournament bracket once this match's battle is settled. The client
      // that finalized reports it; any other client only reports as a fallback (e.g. it
      // loaded into an already-done battle whose finalizer left). reportMatchResult
      // re-reads and no-ops if the match is already settled, so this can't double-advance.
      const w = s.winner ?? b.winner;
      if (!reported.current && b.match_id && (finalized || b.status === "done") && w && w !== "tie") {
        reported.current = true;
        const winnerCoachId = w === b.p1_name ? b.p1_coach_id : b.p2_coach_id;
        if (winnerCoachId) await reportMatchResult(b.league_id, b.match_id, winnerCoachId);
      }

    };
    runRef.current = run;
    run();
    const unsub = subscribeBattle(id, run);
    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id, viewer]);

  // Practice mode: the player's browser auto-plays the AI opponent (p2). A poll
  // (rather than a realtime trigger) makes this robust to read-after-write races —
  // it submits exactly when p2 has an outstanding request (action count > choices made).
  useEffect(() => {
    if (!battle || battle.p2_coach_id !== null || viewer !== "p1") return;
    let busy = false, lastLen = -1;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const ch = await getBattleChoices(id);
        // Only re-run the (expensive) engine replay when the choice log actually
        // grew — otherwise p2's outstanding-request status can't have changed. This
        // keeps a long battle from re-simulating from scratch every 0.9s.
        if (ch.length === lastLen) return;
        const b = await getBattle(id);
        if (!b || b.status !== "active") return;
        const p2 = replay({
          formatid: engineFormat(b.format as BattleFormat, b.generation),
          p1: { name: b.p1_name, team: b.p1_team }, p2: { name: b.p2_name, team: b.p2_team },
          seed: b.seed, choices: ch.map((c) => ({ side: c.side, choice: c.choice })),
        }, "p2");
        if (p2.owes) await submitChoice(id, "p2", ch.filter((c) => c.side === "p2").length, "default");
        else lastLen = ch.length; // caught up; skip re-sim until new choices arrive (leave unset when we submit / on error, so we retry)
      } catch { /* keep lastLen unset so the next tick retries */ } finally { busy = false; }
    };
    const iv = setInterval(tick, 900);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id, battle?.p2_coach_id, viewer]);

  // Safety heartbeat: Supabase realtime can silently drop its socket after a while,
  // which would otherwise freeze the player's view mid-battle and look like the move
  // selection "timing out". Re-replaying every few seconds makes the screen always
  // self-heal to the latest server state. (pending is preserved unless the turn
  // advanced — see the choice-length guard in `run`.)
  useEffect(() => {
    if (!battle || battle.status === "done") return;
    const iv = setInterval(async () => {
      try {
        const [b, ch] = await Promise.all([getBattle(id), getBattleChoices(id)]);
        // Cheap poll: only trigger the full re-replay when the server state actually
        // moved (a new choice, or the battle ended). Re-simulating every 3s otherwise
        // is what made a long battle stutter and the move buttons feel unresponsive.
        if (b && (ch.length !== prevChoiceLen.current || b.status !== battle.status)) runRef.current();
      } catch { /* ignore; try again next tick */ }
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id, battle?.status]);

  // The animated playback timeline. The protocol log is append-only, so its length
  // is a stable identity: a heartbeat re-replay with no new events reuses the same
  // memoized timeline and the driver below doesn't restart an in-flight animation.
  const rawLen = snap?.raw?.length ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const timeline = useMemo(() => buildTimeline(snap?.raw ?? [], viewer), [rawLen, viewer]);
  timelineRef.current = timeline; // the play-loop always reads the latest steps

  // Playback driver: one persistent loop reveals new steps one at a time, each held
  // for its own delay (2s per move, quicker for sub-events), so a turn plays out in
  // speed order. It reads `timelineRef` every iteration, so steps appended mid-turn
  // are picked up smoothly — it never tears down and restarts (which used to flash a
  // banner past = the "X used X" glitch). When caught up it goes live (cursor −1) and
  // idles, polling for the next turn's steps.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      if (cancelled) return;
      const tl = timelineRef.current;
      if (firstTimeline.current) {
        // On first load, skip whatever history is already present (don't replay it).
        if (loadedRef.current) { firstTimeline.current = false; playedRef.current = tl.length - 1; setCursor(-1); }
        timer = setTimeout(loop, 150);
        return;
      }
      if (playedRef.current < tl.length - 1) {
        const i = playedRef.current + 1;
        playedRef.current = i;
        setCursor(i);
        timer = setTimeout(loop, tl[i]?.delayMs ?? 800);
      } else {
        setCursor(-1);                 // caught up → live (React dedupes when already −1)
        timer = setTimeout(loop, 200); // idle-poll for the next turn
      }
    };
    loop();
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the (full) battle log scrolled to the newest line as events stream in.
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [snap?.log.length]);

  // Flash the browser-tab title when it's your move, so a player with the tab in the
  // background knows the battle is waiting on them. Restored when it's not your turn.
  const myTurnForTitle = Boolean(
    snap && !snap.ended && battle?.status !== "done" && snap.owes && !snap.request?.teamPreview && (viewer === "p1" || viewer === "p2"),
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = battle ? `${battle.p1_name} vs ${battle.p2_name} — PokéDraft` : "PokéDraft";
    if (!myTurnForTitle) { document.title = base; return; }
    let on = false;
    const flip = () => { on = !on; document.title = on ? "🔴 Your move!" : `▶ ${base}`; };
    flip();
    const iv = setInterval(flip, 1000);
    return () => { clearInterval(iv); document.title = base; };
  }, [myTurnForTitle, battle?.p1_name, battle?.p2_name]);

  // Kill the one-frame flash of THIS turn's end result. When a resolved turn lands
  // while we're showing the live (caught-up) state, the field would paint the new end
  // state for a frame before the play loop rewinds to animate it. Before that paint,
  // freeze on the PREVIOUS turn's final step; the loop then reveals the new steps in
  // order. Runs before paint (layout effect), so the flash never reaches the screen.
  useIsoLayoutEffect(() => {
    const tl = timelineRef.current;
    if (!firstTimeline.current && cursorRef.current === -1 && playedRef.current >= 0 && playedRef.current < tl.length - 1) {
      setCursor(playedRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawLen]);

  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!snap || !battle) return <Centered><span className="hand text-3xl text-coral">entering the battle…</span></Centered>;

  const myChoiceCount = choices.filter((c) => c.side === viewer).length;
  const arena = arenaFor(battle.id);
  const megaOnly = isMegaOnly(battle.generation);
  const req = snap.request;
  const isPlayer = viewer === "p1" || viewer === "p2";
  const ended = snap.ended || battle.status === "done";
  const winner = snap.winner ?? battle.winner;
  const isDoubles = battle.format !== "singles";

  // While the turn is animating, the field shows the current playback step instead
  // of the live final state, and the player can't act yet (it'd be choosing against a
  // board that's still resolving). cursor −1 ⇒ caught up to the live snapshot.
  const playing = cursor >= 0 && cursor < timeline.length;
  const step: Step | null = playing ? timeline[cursor] : null;
  const viewNear = step ? { name: step.nearName || snap.near.name, active: step.near } : snap.near;
  const viewFar = step ? { name: step.farName || snap.far.name, active: step.far } : snap.far;
  const attackerSpecies = step?.attacker ?? null;

  const iMustChoose = isPlayer && !ended && snap.owes && !req?.teamPreview && !playing;
  const inTeamPreview = isPlayer && !ended && snap.owes && Boolean(req?.teamPreview);

  const benched = (req?.side?.pokemon ?? [])
    .map((p, i) => ({ ...p, party: i + 1 }))
    .filter((p) => !p.active && !p.condition.includes("fnt"));

  // Live opponents (species + defending types) for the move-effectiveness preview.
  const foeInfos: FoeInfo[] = snap.far.active.map((f) =>
    f ? { species: f.species, types: dex.get(toID(f.species))?.types ?? [], fainted: f.fainted } : null,
  );

  // What does each active slot need from the player this request?
  //  • "switch" — a fainted slot with a replacement waiting
  //  • "move"   — a living active Pokémon choosing an action
  //  • "pass"   — a fainted slot with nothing to send in. Two cases: the engine
  //               keeps a dead slot in the request (with its old moves!) when
  //               you're down to one mon, and a double-KO can demand more
  //               switches than you have bench Pokémon (both faint with one
  //               left). Only as many fainted slots as there are bench mons ask
  //               for a switch; the rest auto-pass — otherwise Lock in waits on
  //               a slot that can never be filled and the battle soft-locks.
  const slotCount = Math.max(req?.active?.length ?? 0, req?.forceSwitch?.length ?? 0) || 1;
  const slotAction = (i: number): "move" | "switch" | "pass" => {
    if (req?.forceSwitch?.[i]) {
      let switchSlotsBefore = 0;
      for (let j = 0; j < i; j++) if (req.forceSwitch[j]) switchSlotsBefore++;
      return switchSlotsBefore < benched.length ? "switch" : "pass";
    }
    const fieldMon = snap.near.active[i];
    if (req?.active?.[i] && fieldMon && !fieldMon.fainted) return "move";
    return "pass";
  };

  // Which active slots actually need a player decision (the rest auto-pass).
  const activeSlots: number[] = [];
  if (req && iMustChoose) {
    for (let i = 0; i < slotCount; i++) if (slotAction(i) !== "pass") activeSlots.push(i);
  }
  const slotComplete = (i: number) => {
    const c = pending[i];
    if (!c) return false;
    return !(c.kind === "move" && c.needTarget && !c.moveTarget);
  };
  const allChosen = activeSlots.every(slotComplete);

  // The legal targets for a move in doubles, as signed engine slot numbers: foes are
  // +1/+2, your own mons −1/−2. A move whose target type doesn't single anyone out
  // (spread, self, whole-side) returns [] — no picker needed.
  function targetOptionsFor(moveTarget: string, callerSlot: number): TargetOpt[] {
    const wantsFoe = moveTarget === "normal" || moveTarget === "any" || moveTarget === "adjacentFoe";
    const wantsAlly = moveTarget === "normal" || moveTarget === "any" || moveTarget === "adjacentAlly" || moveTarget === "adjacentAllyOrSelf";
    const wantsSelf = moveTarget === "adjacentAllyOrSelf";
    const opts: TargetOpt[] = [];
    if (wantsFoe) snap!.far.active.forEach((f, i) => { if (f && !f.fainted) opts.push({ slot: i + 1, species: f.species, kind: "foe" }); });
    if (wantsAlly) snap!.near.active.forEach((a, i) => { if (i !== callerSlot && a && !a.fainted) opts.push({ slot: -(i + 1), species: a.species, kind: "ally" }); });
    if (wantsSelf) { const s = snap!.near.active[callerSlot]; if (s && !s.fainted) opts.push({ slot: -(callerSlot + 1), species: s.species, kind: "self" }); }
    return opts;
  }
  function chooseMove(slot: number, moveIndex: number, target: string) {
    // In doubles a single-target move must carry an explicit target — otherwise a
    // trailing gimmick token (mega/terastallize) gets misparsed as the target. With
    // more than one legal target (e.g. two foes, or a foe and your ally) we ask.
    const opts = isDoubles ? targetOptionsFor(target, slot) : [];
    if (opts.length > 1) {
      setPending((p) => ({ ...p, [slot]: { kind: "move", index: moveIndex, moveTarget: "", needTarget: true } }));
    } else if (opts.length === 1) {
      setPending((p) => ({ ...p, [slot]: { kind: "move", index: moveIndex, moveTarget: String(opts[0].slot), needTarget: false } }));
    } else {
      setPending((p) => ({ ...p, [slot]: { kind: "move", index: moveIndex, moveTarget: "", needTarget: false } }));
    }
  }
  function chooseTarget(slot: number, targetSlot: number) {
    setPending((p) => { const c = p[slot]; if (c?.kind !== "move") return p; return { ...p, [slot]: { ...c, moveTarget: String(targetSlot) } }; });
  }
  function chooseSwitch(slot: number, partyIndex: number) {
    setPending((p) => ({ ...p, [slot]: { kind: "switch", index: partyIndex } }));
  }
  async function submit() {
    // Build a choice for every slot in order — fainted/empty slots auto-pass so the
    // comma-separated command always lines up with what the engine expects.
    const parts: string[] = [];
    for (let i = 0; i < slotCount; i++) {
      const action = slotAction(i);
      const c = pending[i];
      if (action === "pass" || !c) { parts.push("pass"); continue; }
      if (c.kind === "switch") { parts.push(`switch ${c.index}`); continue; }
      const g = gimmick[i] ? ` ${gimmick[i]}` : "";
      parts.push(`move ${c.index}${c.moveTarget ? ` ${c.moveTarget}` : ""}${g}`);
    }
    await submitChoice(id, viewer as string, myChoiceCount, parts.join(", "));
    scheduleSync();
  }
  async function submitLeads(order: number[]) {
    if (!req?.side) return;
    const all = req.side.pokemon.map((_, i) => i + 1);
    const full = [...order, ...all.filter((n) => !order.includes(n))];
    const bring = battle!.format === "singles" ? all.length : 4;
    await submitChoice(id, viewer as string, 0, "team " + full.slice(0, bring).join(""));
    scheduleSync();
  }
  async function forfeit() {
    if (!isPlayer || ended) return;
    if (!confirm("Forfeit this battle?")) return;
    await finishBattle(id, viewer === "p1" ? battle!.p2_name : battle!.p1_name);
    scheduleSync();
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl font-black">
          {battle.p1_name} <span className="text-coral">vs</span> {battle.p2_name}
          <span className="chip ml-2 align-middle capitalize" style={{ background: "var(--mustard)" }}>{battle.format}</span>
        </h1>
        <div className="flex gap-2">
          {isPlayer && !ended && <button onClick={forfeit} className="btn btn-ghost text-sm py-2 text-coral">Forfeit</button>}
          <Link href={code ? `/play/${code}` : "/"} className="btn btn-ghost text-sm py-2">← Battles</Link>
        </div>
      </div>

      {/* Field — a random battle arena (deterministic per battle) behind both sides.
          overflow-visible so hover tooltips can spill past the arena edge. */}
      <div className="relative rounded-xl shadow-inner bg-cover bg-center h-[248px] sm:h-[320px]"
        style={{ backgroundColor: "#9fd0e6", backgroundImage: `url(${arena})` }}>
        {/* a soft vignette so sprites, banners and HP plates stay readable on any arena */}
        <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.18))" }} />
        {/* battle stages — a base under each side so both clearly stand on the arena */}
        <div className="absolute pointer-events-none rounded-[50%]" style={{ top: "33%", left: "44%", right: "7%", height: 54, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.32), transparent 72%)" }} />
        <div className="absolute pointer-events-none rounded-[50%]" style={{ bottom: "4%", left: "7%", right: "44%", height: 66, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.34), transparent 72%)" }} />
        {/* field conditions (from the current playback step while animating) */}
        {((step ? step.field.weather : snap.field.weather) || (step ? step.field.terrain : snap.field.terrain) || (step ? step.field.trickRoom : snap.field.trickRoom)) && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-1 z-20">
            {(step ? step.field.weather : snap.field.weather) && <FieldChip>{step ? step.field.weather : snap.field.weather}</FieldChip>}
            {(step ? step.field.terrain : snap.field.terrain) && <FieldChip>{step ? step.field.terrain : snap.field.terrain}</FieldChip>}
            {(step ? step.field.trickRoom : snap.field.trickRoom) && <FieldChip>Trick Room</FieldChip>}
          </div>
        )}
        {/* event banner — the move/effect/faint text that plays out in speed order */}
        {step?.banner && (
          <div key={cursor} className="event-banner absolute top-9 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full text-white text-sm font-bold shadow-lg whitespace-nowrap max-w-[90%] overflow-hidden text-ellipsis"
            style={{ background: BANNER_COLOR[step.tone] }}>
            {step.banner}
          </div>
        )}
        {/* opponent — HP top-left, sprites upper center-right */}
        <div className="absolute top-3 left-3 z-10"><HpPlate side={viewFar} align="left" conds={snap.far.sideConditions} itemNames={itemNames} /></div>
        <div className="absolute top-6 right-2 sm:right-6 left-[37%] sm:left-[40%] flex justify-center gap-2 sm:gap-5 items-end">
          {(viewFar.active.filter(Boolean) as NonNullable<Slot>[]).map((m, i) => (
            <BattleMon key={`far-${i}`} mon={m} facing="front" attacking={attackerSpecies === m.species}
              tip={<MonTooltip mon={m} info={dex.get(toID(m.species))} revealed={snap.farRevealed[m.species]} side="foe" />} />
          ))}
        </div>
        {/* you — HP bottom-right, sprites lower center-left */}
        <div className="absolute bottom-3 right-3 z-10"><HpPlate side={viewNear} align="right" conds={snap.near.sideConditions} itemNames={itemNames} /></div>
        <div className="absolute bottom-5 left-2 sm:left-6 right-[37%] sm:right-[40%] flex justify-center gap-2 sm:gap-5 items-end">
          {(viewNear.active.filter(Boolean) as NonNullable<Slot>[]).map((m, i) => (
            <BattleMon key={`near-${i}`} mon={m} facing="back" attacking={attackerSpecies === m.species}
              tip={<MonTooltip mon={m} info={dex.get(toID(m.species))} revealed={snap.nearRevealed[m.species]} side="ally" itemNames={itemNames} />} />
          ))}
        </div>
        <style jsx>{`
          .event-banner { animation: bannerPop 0.18s ease-out; }
          @keyframes bannerPop { from { opacity: 0; transform: translate(-50%, -6px) scale(0.92); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
        `}</style>
      </div>

      {/* Status / choices */}
      <div className="paper p-4 mt-4">
        {playing ? (
          <p className="text-center text-ink-soft animate-pulse">Resolving turn {snap.turn}…</p>
        ) : ended ? (
          <p className="hand text-3xl text-coral text-center">
            {!winner || winner === "tie" ? "It's a tie!" : `${winner} wins!`}
          </p>
        ) : inTeamPreview ? (
          <TeamPreview req={req!} format={battle.format} onConfirm={submitLeads} farTeam={snap.farTeam} farName={snap.far.name} dex={dex} movedex={movedex} itemNames={itemNames} abilityNames={abilityNames} />
        ) : viewer === "spectator" ? (
          <p className="text-center text-ink-soft">Spectating · turn {snap.turn}</p>
        ) : req?.teamPreview ? (
          <p className="text-center text-ink-soft">Waiting for {snap.far.name} to choose leads…</p>
        ) : iMustChoose ? (
          <div>
            <p className="text-sm font-semibold mb-2">Your move{activeSlots.length > 1 ? "s" : ""} · turn {snap.turn}</p>
            <div className={activeSlots.length > 1 ? "grid sm:grid-cols-2 gap-3" : ""}>
              {activeSlots.map((i) => (
                <SlotChooser
                  key={i} slot={i} req={req!} chosen={pending[i]} gimmick={gimmick[i]}
                  benched={benched.filter((b) => !activeSlots.some((s) => {
                    const c = pending[s]; // a bench mon picked in another slot isn't offered again here
                    return s !== i && c?.kind === "switch" && c.index === b.party;
                  }))}
                  foes={snap.far.active} foeInfos={foeInfos} attacker={snap.near.active[i]} field={snap.field} gen={battle.generation ?? 9} megaOnly={megaOnly}
                  targetsFor={targetOptionsFor} megaByStone={megaByStone}
                  movedex={movedex} onMove={(mi, t) => chooseMove(i, mi, t)} onTarget={(ts) => chooseTarget(i, ts)}
                  onSwitch={(pi) => chooseSwitch(i, pi)}
                  onGimmick={(g) => setGimmick((p) => { const n = { ...p }; if (g) n[i] = g; else delete n[i]; return n; })}
                />
              ))}
            </div>
            <button className="btn btn-coral w-full mt-3" disabled={!allChosen} onClick={submit}>
              {allChosen ? "Lock in" : activeSlots.some((i) => pending[i]?.kind === "move" && (pending[i] as { needTarget: boolean }).needTarget && !(pending[i] as { moveTarget: string }).moveTarget) ? "Pick a target" : "Choose an action"}
            </button>
          </div>
        ) : (
          <p className="text-center text-ink-soft">Waiting for {snap.far.name}… · turn {snap.turn}</p>
        )}
      </div>

      {/* Log — the complete battle history, always available (scroll up for earlier turns) */}
      <div className="paper mt-4">
        <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">Battle log</div>
        <div ref={logRef} className="px-4 pb-4 max-h-72 overflow-auto text-sm">
          {snap.log.map((l, i) => (
            <div key={i} className={l.startsWith("—") ? "font-semibold text-ink-soft mt-1" : "text-ink"}>{l}</div>
          ))}
        </div>
      </div>
    </main>
  );
}

const hpColor = (p: number) => (p > 50 ? "#3fa84b" : p > 20 ? "#dca23e" : "#d9594c");
const STATUS_COLOR: Record<string, string> = { brn: "#e0762f", par: "#d3aa2e", psn: "#9b5fb0", tox: "#9b5fb0", slp: "#8a8a8a", frz: "#5bb9d6" };
const STATUS_TEXT: Record<string, string> = { brn: "Burned", par: "Paralyzed", psn: "Poisoned", tox: "Badly Poisoned", slp: "Asleep", frz: "Frozen" };

function FieldChip({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-ink/80 text-paper shadow">{children}</span>;
}

function BattleMon({ mon, facing, attacking, tip }: { mon: NonNullable<Slot>; facing: "front" | "back"; attacking: boolean; tip?: React.ReactNode }) {
  const url = useMemo(
    () => (Sprites.getPokemon(mon.species, { gen: "ani", side: facing === "front" ? "p2" : "p1" }) as { url: string }).url,
    [mon.species, facing],
  );
  const prevHp = useRef(mon.hpPct);
  // Transient motion applied to the WRAPPER, so it never conflicts with the
  // img's entrance animation: "hit" (took damage) or "atk" (used a move).
  const [motion, setMotion] = useState("");
  useEffect(() => {
    if (mon.hpPct < prevHp.current && !mon.fainted) {
      setMotion("bm-hit");
      const t = setTimeout(() => setMotion(""), 450);
      prevHp.current = mon.hpPct;
      return () => clearTimeout(t);
    }
    prevHp.current = mon.hpPct;
  }, [mon.hpPct, mon.fainted]);
  useEffect(() => {
    if (!attacking || mon.fainted) return;
    setMotion(facing === "back" ? "bm-atk-back" : "bm-atk-front");
    const t = setTimeout(() => setMotion(""), 500);
    return () => clearTimeout(t);
  }, [attacking, facing, mon.fainted]);

  const boosts = Object.entries(mon.boosts ?? {}).filter(([, v]) => v !== 0);
  const vols = volLabels(mon.volatiles);

  return (
    <div className="relative group bm-slot">
      {/* Persistent on-sprite notifiers — stat stages + volatile conditions, always shown. */}
      {(boosts.length > 0 || vols.length > 0) && !mon.fainted && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-0.5 pointer-events-none">
          {boosts.map(([k, v]) => (
            <span key={k} className="text-[8px] font-black rounded px-1 leading-snug shadow text-white whitespace-nowrap"
              style={{ background: v > 0 ? "#2f9e54" : "#d24a3d" }}>
              {STAT_SHORT[k] ?? k} {v > 0 ? "+" : ""}{v}
            </span>
          ))}
          {vols.map((vl, i) => (
            <span key={i} className="text-[8px] font-bold rounded px-1 leading-snug shadow text-white whitespace-nowrap"
              style={{ background: vl.color }}>
              {vl.label}
            </span>
          ))}
        </div>
      )}
      <div className={`bm-wrap ${mon.fainted ? "bm-faint" : ""} ${motion}`}
        style={{ display: "grid", placeItems: "end center" }}>
      {/* key by species → a switch or Mega Evolution remounts and replays the entrance */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={mon.species} src={url} alt={mon.species} draggable={false} className="bm" />
      <style jsx>{`
        .bm-slot { width: 96px; }
        .bm { image-rendering: pixelated; max-height: 104px; max-width: 116px; transform-origin: bottom center; animation: bmIn 0.45s ease-out; }
        .bm-wrap { width: 96px; height: 104px; transform-origin: bottom center; }
        /* Shrink sprites on phones so a doubles field of four fits without overlap. */
        @media (max-width: 640px) {
          .bm-slot { width: 68px; }
          .bm-wrap { width: 68px; height: 78px; }
          .bm { max-height: 78px; max-width: 84px; }
        }
        .bm-hit { animation: bmHit 0.45s ease-in-out; }
        .bm-atk-back { animation: bmAtkBack 0.5s ease-out; }
        .bm-atk-front { animation: bmAtkFront 0.5s ease-out; }
        .bm-faint { animation: bmFaint 0.6s ease-in forwards; }
        @keyframes bmIn { from { opacity: 0; transform: translateY(-14px) scale(0.7); } to { opacity: 1; transform: none; } }
        @keyframes bmHit { 0%,100% { transform: translateX(0); filter: none; } 25% { transform: translateX(-6px); filter: brightness(2.4) saturate(0.5); } 50% { transform: translateX(6px); } 75% { transform: translateX(-4px); } }
        @keyframes bmAtkBack { 0%,100% { transform: translate(0,0); } 45% { transform: translate(0,-18px) scale(1.07); } }
        @keyframes bmAtkFront { 0%,100% { transform: translate(0,0); } 45% { transform: translate(0,18px) scale(1.07); } }
        @keyframes bmFaint { to { opacity: 0; transform: translateY(26px) scale(0.85); } }
      `}</style>
      </div>
      {/* Hover dossier: types, base stats, speed window, scouted moves. */}
      {tip && (
        <div className={`pointer-events-none absolute z-40 left-1/2 -translate-x-1/2 hidden group-hover:block ${facing === "front" ? "top-full mt-1" : "bottom-full mb-1"}`}>
          {tip}
        </div>
      )}
    </div>
  );
}

function MonTooltip({ mon, info, revealed, side, loadout, movedex, itemNames }: {
  mon: NonNullable<Slot>; info?: PokeMon; revealed?: string[]; side: "foe" | "ally";
  loadout?: { ability?: string; item?: string; moves?: string[] }; movedex?: Record<string, MoveInfo>;
  itemNames?: Record<string, string>;
}) {
  const [spMin, spMax] = info ? speedRange(info.stats.spe, mon.level) : [0, 0];
  const moveName = (id: string) => movedex?.[toID(id)]?.name ?? id.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
  const itemName = (id: string) => itemNames?.[toID(id)] ?? id;
  return (
    <div className="w-52 rounded-lg p-2.5 shadow-xl text-left text-[11px]" style={{ background: "var(--ink)", color: "var(--paper)" }}>
      <div className="flex items-center justify-between mb-1">
        <b className="text-xs">{mon.species}</b>
        <span className="opacity-70">Lv{mon.level}{mon.fainted ? " · fainted" : ""}</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-1.5">
        {(info?.types ?? []).map((t) => (
          <span key={t} className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 text-white" style={{ background: TYPE_COLORS[t.toLowerCase()] ?? "#777" }}>{t}</span>
        ))}
        {mon.tera && <span className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5 text-white" style={{ background: TYPE_COLORS[mon.tera.toLowerCase()] ?? "#777" }}>★ {mon.tera}</span>}
      </div>
      {info ? (
        <>
          <div className="grid grid-cols-6 gap-1 mb-1.5">
            {STAT_ORDER.map((s) => (
              <div key={s} className="text-center">
                <div className="opacity-60 text-[8px] font-bold">{STAT_SHORT[s]}</div>
                <div className="font-mono font-bold text-[10px]">{info.stats[s]}</div>
              </div>
            ))}
          </div>
          <div className="opacity-90">Speed <b>{spMin}–{spMax}</b> <span className="opacity-60">(×1.5 scarf → {Math.floor(spMax * 1.5)})</span></div>
        </>
      ) : <div className="opacity-60">No dex data.</div>}
      {side === "ally" && mon.item !== undefined && (
        // Current held item — reflects Trick / Knock Off / Switcheroo swaps live.
        <div className="mt-1"><span className="opacity-60">Item</span> <b>{mon.item ? itemName(mon.item) : "None"}</b></div>
      )}
      {loadout && (loadout.ability || loadout.item || (loadout.moves?.length ?? 0) > 0) && (
        // Your own configured set — the full loadout, shown while picking leads.
        <div className="mt-1.5 pt-1.5 border-t border-white/20 space-y-0.5">
          {loadout.ability && <div><span className="opacity-60">Ability</span> <b>{loadout.ability}</b></div>}
          <div><span className="opacity-60">Item</span> <b>{loadout.item || "None"}</b></div>
          {(loadout.moves?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {loadout.moves!.map((mv) => {
                const md = movedex?.[toID(mv)];
                return (
                  <span key={mv} className="rounded bg-white/15 px-1.5 py-0.5 flex items-center gap-1">
                    {md && <span className="uppercase font-bold text-[8px]" style={{ color: TYPE_COLORS[md.type.toLowerCase()] ?? "#bbb" }}>{md.type.slice(0, 3)}</span>}
                    {moveName(mv)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
      {(() => {
        const conds: string[] = [];
        if (mon.status) conds.push(STATUS_TEXT[mon.status] ?? mon.status);
        for (const vl of volLabels(mon.volatiles)) conds.push(vl.label);
        for (const [k, v] of Object.entries(mon.boosts ?? {})) if (v) conds.push(`${STAT_SHORT[k] ?? k} ${v > 0 ? "+" : ""}${v}`);
        return conds.length > 0 ? (
          <div className="mt-1.5 pt-1.5 border-t border-white/20">
            <div className="opacity-60 text-[9px] font-bold uppercase mb-0.5">Conditions</div>
            <div className="flex flex-wrap gap-1">{conds.map((c, i) => <span key={i} className="rounded bg-white/15 px-1.5 py-0.5">{c}</span>)}</div>
          </div>
        ) : null;
      })()}
      {revealed && revealed.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-white/20">
          <div className="opacity-60 text-[9px] font-bold uppercase mb-0.5">{side === "foe" ? "Scouted moves" : "Moves revealed"}</div>
          <div className="flex flex-wrap gap-1">
            {revealed.map((mv) => <span key={mv} className="rounded bg-white/15 px-1.5 py-0.5">{mv}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function HpPlate({ side, align, conds, itemNames }: { side: { name: string; active: Slot[] }; align: "left" | "right"; conds?: SideCondition[]; itemNames?: Record<string, string> }) {
  const mons = side.active.filter(Boolean) as NonNullable<Slot>[];
  if (!mons.length) return null;
  const itemName = (id: string) => itemNames?.[toID(id)] ?? id;
  return (
    <div className={`bg-white/85 rounded-lg px-2.5 py-1.5 shadow ${align === "right" ? "text-right" : ""}`} style={{ minWidth: 156 }}>
      <div className="text-[11px] font-bold text-ink-soft mb-0.5">{side.name}</div>
      {mons.map((m, i) => (
        <div key={i} className="mb-1 last:mb-0">
          <div className="flex items-center gap-1 justify-between">
            <span className="text-xs font-semibold truncate flex items-center gap-1 min-w-0">
              <span className="truncate">{m.species}</span>
              {m.status && <span className="text-[9px] uppercase font-bold rounded px-1 text-white shrink-0" style={{ background: STATUS_COLOR[m.status] ?? "#888" }}>{m.status}</span>}
              {m.tera && <span className="text-[9px] uppercase font-bold rounded px-1 text-white shrink-0" style={{ background: TYPE_COLORS[m.tera.toLowerCase()] ?? "#777" }}>★{m.tera.slice(0, 3)}</span>}
            </span>
            <span className="text-[10px] text-ink-soft shrink-0">{m.fainted ? "fnt" : `${m.hpPct}%`}</span>
          </div>
          <div className="h-2 rounded bg-black/10 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${m.hpPct}%`, background: hpColor(m.hpPct), transition: "width 0.6s ease" }} />
          </div>
          {/* Current held item (own side only — reflects Trick/Knock Off swaps) */}
          {m.item !== undefined && !m.fainted && (
            <div className={`text-[9px] text-ink-soft ${align === "right" ? "text-right" : ""}`}>
              {m.item ? `◈ ${itemName(m.item)}` : "◇ no item"}
            </div>
          )}
        </div>
      ))}
      {/* Side conditions in effect (Reflect, Light Screen, Tailwind, hazards, …) */}
      {conds && conds.length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${align === "right" ? "justify-end" : ""}`}>
          {conds.map((c) => (
            <span key={c.id} className="text-[9px] font-bold rounded px-1 py-0.5 bg-indigo/85 text-white" style={{ background: "var(--indigo, #5b6bd6)" }}>
              {c.name}{c.layers && c.layers > 1 ? ` ×${c.layers}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const hpFromCondition = (c: string) => {
  const [hp] = (c || "").split(" ");
  const [cur, max] = hp.split("/").map(Number);
  return c?.includes("fnt") ? 0 : max ? Math.round((cur / max) * 100) : 100;
};

function SlotChooser({ slot, req, benched, chosen, gimmick, foes, foeInfos, attacker, field, gen, megaOnly, movedex, targetsFor, megaByStone, onMove, onTarget, onSwitch, onGimmick }: {
  slot: number; req: Request; benched: { details: string; condition: string; party: number }[]; chosen?: SlotChoice;
  gimmick?: Gimmick; foes: Slot[]; foeInfos: FoeInfo[]; attacker: Slot; field: FieldState; gen: number; megaOnly: boolean; movedex: Record<string, MoveInfo>;
  targetsFor: (moveTarget: string, callerSlot: number) => TargetOpt[]; megaByStone: Record<string, string>;
  onMove: (moveIndex: number, target: string) => void; onTarget: (targetSlot: number) => void;
  onSwitch: (partyIndex: number) => void; onGimmick: (g?: Gimmick) => void;
}) {
  const active = req.active?.[slot];
  const forceSwitch = req.forceSwitch?.[slot];
  const pickingTarget = chosen?.kind === "move" && chosen.needTarget && !chosen.moveTarget;
  // The effective target type of the move being aimed (accounting for an armed gimmick).
  const aimingMove = chosen?.kind === "move" ? active?.moves?.[chosen.index - 1] : undefined;
  const aimTarget = pickingTarget && aimingMove
    ? (gimmick === "dynamax" ? active?.maxMoves?.maxMoves?.[chosen!.index - 1]?.target
      : gimmick === "zmove" ? active?.canZMove?.[chosen!.index - 1]?.target
      : aimingMove.target) ?? aimingMove.target
    : "";
  const targetOpts = pickingTarget ? targetsFor(aimTarget, slot) : [];
  const liveFoes = foeInfos.filter((f): f is NonNullable<FoeInfo> => Boolean(f && !f.fainted && f.types.length));
  // Damage calculator: for each damaging move, the predicted roll vs each live foe.
  // Memoised on the actual battle state so flipping move selections doesn't recompute.
  const liveFoeSlots = foes.filter((f): f is NonNullable<Slot> => Boolean(f && !f.fainted));
  // If a gimmick is armed, preview the damage of the form the mon will BECOME this turn:
  // its Mega (mega stats + ability, stone effect gone) or its Tera type (extra STAB).
  const calcAttacker: Slot = (() => {
    if (!attacker) return attacker;
    if (gimmick === "mega") {
      const megaSpecies = megaByStone[toID(attacker.set?.item ?? "")];
      if (megaSpecies) return { ...attacker, species: megaSpecies, set: attacker.set ? { ...attacker.set, ability: "", item: "" } : attacker.set };
    }
    if (gimmick === "terastallize" && active?.canTerastallize) return { ...attacker, tera: active.canTerastallize };
    return attacker;
  })();
  const dmgKey = JSON.stringify([
    calcAttacker && [calcAttacker.species, calcAttacker.level, calcAttacker.status, calcAttacker.tera, calcAttacker.boosts, calcAttacker.set?.item, calcAttacker.set?.ability],
    liveFoeSlots.map((f) => [f.species, f.level, f.hpPct, f.status, f.tera, f.boosts]),
    field, gen, gimmick ?? "",
  ]);
  const dmg = useMemo(() => {
    const map: Record<string, (DamageResult | null)[]> = {};
    if (!calcAttacker?.set) return map;
    for (const mv of active?.moves ?? []) {
      const info = movedex[mv.id];
      if (!info || info.cat === "Status") continue;
      map[mv.id] = liveFoeSlots.map((f) => calcDamage(gen, calcAttacker, f, mv.move, field));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmgKey]);
  return (
    <div className="border border-dashed border-paper-edge rounded p-2">
      {forceSwitch && <div className="text-[11px] font-bold text-coral mb-1.5">A Pokémon fainted — send in a replacement:</div>}
      {pickingTarget && (
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-ink-soft mb-1">Target which Pokémon?</div>
          <div className="flex flex-wrap gap-1.5">
            {targetOpts.map((t) => (
              <button key={t.slot} onClick={() => onTarget(t.slot)}
                className="text-xs font-semibold rounded px-2 py-1 transition"
                style={t.kind === "foe"
                  ? { background: "rgba(217,89,76,0.15)", color: "#b23b30" }
                  : { background: "rgba(47,143,131,0.18)", color: "#256b61" }}>
                {t.kind === "foe" ? "▲" : t.kind === "self" ? "＝" : "▽"} {t.species}
                <span className="opacity-60 ml-1">{t.kind === "foe" ? "foe" : t.kind === "self" ? "self" : "ally"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* Gimmick toggles. Tera is suppressed in Mega-only leagues. */}
      {!forceSwitch && active && (active.canMegaEvo || (active.canTerastallize && !megaOnly) || active.canDynamax || active.canZMove?.some(Boolean)) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {active.canMegaEvo && (
            <button onClick={() => onGimmick(gimmick === "mega" ? undefined : "mega")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "mega" ? "#a25fb8" : "rgba(162,95,184,0.15)", color: gimmick === "mega" ? "#fff" : "#7d3f93" }}>
              ⬢ Mega Evolve
            </button>
          )}
          {active.canTerastallize && !megaOnly && (
            <button onClick={() => onGimmick(gimmick === "terastallize" ? undefined : "terastallize")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "terastallize" ? "#d24f96" : "rgba(210,79,150,0.15)", color: gimmick === "terastallize" ? "#fff" : "#a83274" }}>
              ✦ Tera {active.canTerastallize}
            </button>
          )}
          {active.canDynamax && (
            <button onClick={() => onGimmick(gimmick === "dynamax" ? undefined : "dynamax")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "dynamax" ? "#d6426b" : "rgba(214,66,107,0.15)", color: gimmick === "dynamax" ? "#fff" : "#b02a52" }}>
              ◎ {active.maxMoves?.gigantamax ? "Gigantamax" : "Dynamax"}
            </button>
          )}
          {active.canZMove?.some(Boolean) && (
            <button onClick={() => onGimmick(gimmick === "zmove" ? undefined : "zmove")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "zmove" ? "#e0a417" : "rgba(224,164,23,0.15)", color: gimmick === "zmove" ? "#fff" : "#9c7110" }}>
              ✺ Z-Power
            </button>
          )}
        </div>
      )}
      {!forceSwitch && active && (
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {active.moves.map((mv, j) => {
            const info = movedex[mv.id];
            // When a gimmick is armed the slot turns into its empowered move: Max/G-Max
            // for Dynamax, the Z-move for Z-Power. Z-Power only lights up slots the held
            // Z-Crystal actually empowers, so the rest are locked out while it's armed.
            const dyna = gimmick === "dynamax" ? active.maxMoves?.maxMoves?.[j] : undefined;
            const zed = gimmick === "zmove" ? active.canZMove?.[j] ?? undefined : undefined;
            const label = dyna ? prettyMax(dyna.move) : zed ? zed.move : mv.move;
            const effTarget = dyna ? dyna.target : zed ? zed.target : mv.target;
            const zLocked = gimmick === "zmove" && !active.canZMove?.[j];
            const disabled = mv.disabled || mv.pp === 0 || zLocked;
            // Tell the player WHY a move is greyed out instead of leaving them guessing.
            const disabledReason = mv.pp === 0 ? "No PP left" : zLocked ? "Z-Crystal won't boost this" : mv.disabled ? "Disabled" : "";
            const sel = chosen?.kind === "move" && chosen.index === j + 1;
            const color = info ? (TYPE_COLORS[info.type.toLowerCase()] ?? "#777") : "#777";
            // Effectiveness preview: only damaging moves have a type matchup worth
            // showing (status moves like Protect/Tailwind don't "hit" a type). Max/Z
            // moves keep their base move's type, so the matchup still holds.
            const showEff = info && info.cat !== "Status" && liveFoes.length > 0;
            const effs = showEff ? liveFoes.map((f) => ({ f, x: typeEffectiveness(info!.type, f.types) })) : [];
            return (
              <button key={j} disabled={disabled} onClick={() => onMove(j + 1, effTarget)}
                title={(info ? `${label} — ${info.type} ${info.cat}\nPower ${info.bp || "—"} · Acc ${info.acc || "—"} · ${mv.pp}/${mv.maxpp} PP\n${info.desc}` : label) + (disabledReason ? `\n⛔ ${disabledReason}` : "")}
                className="group relative rounded px-2 py-1.5 text-left text-white disabled:opacity-40 transition"
                style={{ background: color, boxShadow: sel ? "0 0 0 2.5px var(--ink)" : "inset 0 -2px 0 rgba(0,0,0,0.18)" }}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold leading-tight drop-shadow-sm">{label}</span>
                  <span className="text-[11px] opacity-90">{CAT_ICON[info?.cat ?? "Status"]}</span>
                </div>
                <div className="text-[9px] opacity-90">{disabledReason ? `⛔ ${disabledReason}` : <>{info?.type ?? ""} · {mv.pp}/{mv.maxpp} PP</>}</div>
                {dmg[mv.id]?.some(Boolean) ? (
                  // Damage roll vs each live foe (a%–b% of its max HP), colour-coded by lethality.
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {dmg[mv.id].map((d, k) => d && (
                      <span key={k} className="text-[8px] font-black rounded px-1 leading-tight text-white whitespace-nowrap"
                        style={{ background: DMG_COLOR(d) }}>
                        {d.immune ? "immune" : `${round1(d.loPct)}-${round1(d.hiPct)}%`}{liveFoeSlots.length > 1 ? ` ${liveFoeSlots[k].species.slice(0, 4)}` : ""}
                      </span>
                    ))}
                  </div>
                ) : effs.length > 0 ? (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {effs.map(({ f, x }, k) => (
                      <span key={k} className="text-[8px] font-black rounded px-1 leading-tight text-white whitespace-nowrap"
                        style={{ background: EFF_COLOR(x) }}>
                        {EFF_TEXT(x)}{liveFoes.length > 1 ? ` ${f.species.slice(0, 4)}` : ""}
                      </span>
                    ))}
                  </div>
                ) : null}
                {info && (
                  <span className="pointer-events-none absolute z-30 left-0 bottom-full mb-1 hidden group-hover:block w-56 rounded-md p-2 shadow-xl text-left"
                    style={{ background: "var(--ink)", color: "var(--paper)" }}>
                    <b>{mv.move}</b> · {info.type} · {info.cat}<br />
                    Power {info.bp || "—"} · Acc {info.acc || "—"} · {mv.pp}/{mv.maxpp} PP{info.pr ? ` · Priority ${info.pr > 0 ? "+" : ""}${info.pr}` : ""}
                    <span className="block mt-1 opacity-90">{info.desc}</span>
                    {dmg[mv.id]?.some(Boolean) ? (
                      <span className="block mt-1 pt-1 border-t border-white/20">
                        {dmg[mv.id].map((d, k) => d && (
                          <span key={k} className="block" style={{ color: d.immune ? undefined : DMG_COLOR(d) }}>
                            vs {liveFoeSlots[k].species}: {d.immune ? "No effect" : `${round1(d.loPct)}–${round1(d.hiPct)}% (${d.lo}–${d.hi})${d.ko ? " · " + d.ko : ""}`}
                          </span>
                        ))}
                        <span className="block opacity-50 mt-0.5">vs a max-defensive (252 HP + Def/SpD) foe</span>
                      </span>
                    ) : effs.length > 0 ? (
                      <span className="block mt-1 pt-1 border-t border-white/20">
                        {effs.map(({ f, x }, k) => (
                          <span key={k} className="block" style={{ color: EFF_COLOR(x) === "#7a7a7a" ? undefined : EFF_COLOR(x) }}>
                            vs {f.species}: {EFF_LABEL(x)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {benched.map((b) => {
          const sel = chosen?.kind === "switch" && chosen.index === b.party;
          return (
            <button key={b.party} onClick={() => onSwitch(b.party)}
              className="text-[11px] rounded px-2 py-1 transition flex items-center gap-1"
              style={{ background: sel ? "var(--pine,#2f8f83)" : "rgba(0,0,0,0.05)", color: sel ? "white" : "inherit" }}>
              ⇄ {b.details.split(",")[0]} <span className="opacity-60">{hpFromCondition(b.condition)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A single Pokémon thumbnail with a hover dossier — used to scout both teams on
// the Team Preview screen.
function PreviewMon({ species, level, dex, facing, badge, outline, onClick, loadout, movedex }: {
  species: string; level: number; dex: Map<string, PokeMon>; facing: "front" | "back";
  badge?: number; outline?: boolean; onClick?: () => void;
  loadout?: { ability?: string; item?: string; moves?: string[] }; movedex?: Record<string, MoveInfo>;
}) {
  const url = (Sprites.getPokemon(species, { gen: "ani", side: facing === "front" ? "p2" : "p1" }) as { url: string }).url;
  const mon = { species, level, hpPct: 100, fainted: false, status: "", tera: "", boosts: {}, volatiles: [] };
  const inner = (
    <>
      {badge != null && <span className="absolute top-0 left-0 z-10 bg-coral text-white text-[10px] font-bold w-4 h-4 grid place-items-center rounded-br">{badge}</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={species} className="h-12" style={{ imageRendering: "pixelated" }} />
      <div className="text-[10px] truncate w-full text-center">{species}</div>
      <div className={`pointer-events-none absolute z-40 left-1/2 -translate-x-1/2 hidden group-hover:block ${facing === "front" ? "top-full mt-1" : "bottom-full mb-1"}`}>
        <MonTooltip mon={mon} info={dex.get(toID(species))} side={facing === "front" ? "foe" : "ally"} loadout={loadout} movedex={movedex} />
      </div>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="paper p-1.5 relative group grid place-items-center"
      style={{ outline: outline ? "2.5px solid var(--coral)" : "none" }}>{inner}</button>
  ) : (
    <div className="paper p-1.5 relative group grid place-items-center">{inner}</div>
  );
}

function TeamPreview({ req, format, onConfirm, farTeam, farName, dex, movedex, itemNames, abilityNames }: {
  req: Request; format: string; onConfirm: (order: number[]) => void;
  farTeam: { species: string; level: number }[]; farName: string; dex: Map<string, PokeMon>;
  movedex: Record<string, MoveInfo>; itemNames: Record<string, string>; abilityNames: Record<string, string>;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const mons = req.side?.pokemon ?? [];
  const doubles = format !== "singles";
  const bring = doubles ? Math.min(4, mons.length) : mons.length;
  const toggle = (n: number) => setOrder((o) => (o.includes(n) ? o.filter((x) => x !== n) : doubles && o.length >= bring ? o : [...o, n]));
  return (
    <div>
      {/* Opponent's team — scout it before deciding your leads (hover for details). */}
      {farTeam.length > 0 && (
        <div className="mb-3 pb-3 border-b border-paper-edge">
          <p className="text-[11px] font-bold text-ink-soft text-center mb-1.5">{farName}&apos;s team — hover to scout</p>
          <div className="flex flex-wrap justify-center gap-2">
            {farTeam.map((m, i) => <PreviewMon key={i} species={m.species} level={m.level} dex={dex} facing="front" />)}
          </div>
        </div>
      )}
      <p className="text-sm font-semibold mb-2 text-center">
        {doubles ? `Pick the ${bring} you'll bring — tap in order (first 2 lead)` : "Tap your lead, then the rest in order (optional)"}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {mons.map((p, i) => {
          const n = i + 1, pos = order.indexOf(n);
          const species = p.details.split(",")[0];
          const level = Number(p.details.match(/L(\d+)/)?.[1] ?? 50);
          const abilId = p.ability || p.baseAbility || "";
          const loadout = {
            ability: abilId ? (abilityNames[toID(abilId)] ?? abilId) : "",
            item: p.item ? (itemNames[toID(p.item)] ?? p.item) : "",
            moves: p.moves,
          };
          return (
            <PreviewMon key={n} species={species} level={level} dex={dex} facing="back"
              badge={pos >= 0 ? pos + 1 : undefined} outline={pos >= 0} onClick={() => toggle(n)}
              loadout={loadout} movedex={movedex} />
          );
        })}
      </div>
      <button className="btn btn-coral w-full mt-3" disabled={doubles && order.length < bring} onClick={() => onConfirm(order)}>
        {doubles ? (order.length < bring ? `Pick ${bring - order.length} more` : `Bring these ${bring}`) : "Start battle"}
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[60vh] grid place-items-center text-center px-4"><div>{children}</div></main>;
}
