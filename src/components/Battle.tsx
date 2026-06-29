"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sprites } from "@pkmn/img";
import {
  engineFormat, getBattle, getBattleChoices, getLeagueById, getIdentity,
  subscribeBattle, submitChoice, finishBattle, reportMatchResult,
  type Battle as BattleRow, type BattleChoice, type BattleFormat,
} from "@/lib/db";
import {
  setupCommands, replay, needsChoice, type BattleSnapshot, type Viewer, type Request, type Slot,
} from "@/lib/battle";

const NEED_TARGET = new Set(["normal", "any", "adjacentFoe"]);
type SlotChoice =
  | { kind: "move"; index: number; moveTarget: string; needTarget: boolean }
  | { kind: "switch"; index: number };

export default function Battle({ id }: { id: string }) {
  const [battle, setBattle] = useState<BattleRow | null>(null);
  const [viewer, setViewer] = useState<Viewer>("spectator");
  const [snap, setSnap] = useState<BattleSnapshot | null>(null);
  const [choices, setChoices] = useState<BattleChoice[]>([]);
  const [pending, setPending] = useState<Record<number, SlotChoice>>({});
  const [gimmick, setGimmick] = useState<Record<number, "mega" | "terastallize">>({});
  const [fatal, setFatal] = useState("");
  const [code, setCode] = useState("");
  const reported = useRef(false);

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
      const commands = [
        ...setupCommands(engineFormat(b.format as BattleFormat), { name: b.p1_name, team: b.p1_team }, { name: b.p2_name, team: b.p2_team }, b.seed),
        ...ch.map((c) => `>${c.side} ${c.choice}`),
      ];
      const s = await replay(commands, viewer);
      if (cancelled) return;
      setBattle(b); setChoices(ch); setSnap(s); setPending({}); setGimmick({});

      // Any client persists the result once the engine declares a winner.
      if (s.ended && b.status === "active") await finishBattle(id, s.winner);

      // Advance the tournament bracket once this match's battle is settled.
      const w = s.winner ?? b.winner;
      if (!reported.current && b.match_id && (s.ended || b.status === "done") && w && w !== "tie") {
        reported.current = true;
        const winnerCoachId = w === b.p1_name ? b.p1_coach_id : b.p2_coach_id;
        if (winnerCoachId) await reportMatchResult(b.league_id, b.match_id, winnerCoachId);
      }
    };
    run();
    const unsub = subscribeBattle(id, run);
    return () => { cancelled = true; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.id, viewer]);

  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!snap || !battle) return <Centered><span className="hand text-3xl text-coral">entering the battle…</span></Centered>;

  const myChoiceCount = choices.filter((c) => c.side === viewer).length;
  const req = snap.request;
  const isPlayer = viewer === "p1" || viewer === "p2";
  const ended = snap.ended || battle.status === "done";
  const winner = snap.winner ?? battle.winner;
  const aliveFoes = snap.far.active.filter((s) => s && !s.fainted).length;
  const iMustChoose = isPlayer && !ended && needsChoice(req) && !req?.teamPreview;
  const inTeamPreview = isPlayer && !ended && req?.teamPreview && myChoiceCount === 0;

  // Which active slots need a decision this request.
  const activeSlots: number[] = [];
  if (req && iMustChoose) {
    const n = req.active?.length ?? req.forceSwitch?.length ?? 1;
    for (let i = 0; i < n; i++) {
      if (req.forceSwitch?.[i] || req.active?.[i]) activeSlots.push(i);
    }
  }
  const slotComplete = (i: number) => {
    const c = pending[i];
    if (!c) return false;
    return !(c.kind === "move" && c.needTarget && !c.moveTarget);
  };
  const allChosen = activeSlots.every(slotComplete);

  function chooseMove(slot: number, moveIndex: number, target: string) {
    const needTarget = NEED_TARGET.has(target) && aliveFoes > 1;
    setPending((p) => ({ ...p, [slot]: { kind: "move", index: moveIndex, moveTarget: "", needTarget } }));
  }
  function chooseTarget(slot: number, foeIndex: number) {
    setPending((p) => { const c = p[slot]; if (c?.kind !== "move") return p; return { ...p, [slot]: { ...c, moveTarget: String(foeIndex + 1) } }; });
  }
  function chooseSwitch(slot: number, partyIndex: number) {
    setPending((p) => ({ ...p, [slot]: { kind: "switch", index: partyIndex } }));
  }
  async function submit() {
    const cmd = activeSlots.map((i) => {
      const c = pending[i];
      if (c.kind === "switch") return `switch ${c.index}`;
      const g = gimmick[i] ? ` ${gimmick[i]}` : "";
      return `move ${c.index}${c.moveTarget ? ` ${c.moveTarget}` : ""}${g}`;
    }).join(", ");
    await submitChoice(id, viewer as string, myChoiceCount, cmd);
  }
  async function submitLeads(order: number[]) {
    if (!req?.side) return;
    const all = req.side.pokemon.map((_, i) => i + 1);
    const full = [...order, ...all.filter((n) => !order.includes(n))];
    const bring = battle!.format === "singles" ? all.length : 4;
    await submitChoice(id, viewer as string, 0, "team " + full.slice(0, bring).join(""));
  }
  async function forfeit() {
    if (!isPlayer || ended) return;
    if (!confirm("Forfeit this battle?")) return;
    await finishBattle(id, viewer === "p1" ? battle!.p2_name : battle!.p1_name);
  }

  const benched = (req?.side?.pokemon ?? [])
    .map((p, i) => ({ ...p, party: i + 1 }))
    .filter((p) => !p.active && !p.condition.includes("fnt"));

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

      {/* Field — opponent up-right, you down-left (Showdown layout) */}
      <div className="relative rounded-xl overflow-hidden shadow-inner"
        style={{ height: 300, background: "linear-gradient(#add8ee 0%, #c4e3f2 50%, #cfe8a6 50%, #aed98c 100%)" }}>
        {/* far side */}
        <div className="absolute top-3 right-4"><HpPlate side={snap.far} align="right" /></div>
        <div className="absolute top-10 right-6 flex gap-3 items-end">
          {(snap.far.active.filter(Boolean) as NonNullable<Slot>[]).map((m, i) => <BattleMon key={`far-${i}`} mon={m} facing="front" />)}
        </div>
        {/* near side */}
        <div className="absolute bottom-3 left-4"><HpPlate side={snap.near} align="left" /></div>
        <div className="absolute bottom-8 left-6 flex gap-3 items-end">
          {(snap.near.active.filter(Boolean) as NonNullable<Slot>[]).map((m, i) => <BattleMon key={`near-${i}`} mon={m} facing="back" />)}
        </div>
      </div>

      {/* Status / choices */}
      <div className="paper p-4 mt-4">
        {ended ? (
          <p className="hand text-3xl text-coral text-center">
            {!winner || winner === "tie" ? "It's a tie!" : `${winner} wins!`}
          </p>
        ) : inTeamPreview ? (
          <TeamPreview req={req!} format={battle.format} onConfirm={submitLeads} />
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
                  key={i} slot={i} req={req!} benched={benched} chosen={pending[i]} gimmick={gimmick[i]}
                  foes={snap.far.active} onMove={(mi, t) => chooseMove(i, mi, t)} onTarget={(fi) => chooseTarget(i, fi)}
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

      {/* Log */}
      <div className="paper p-4 mt-4 max-h-56 overflow-auto text-sm">
        {snap.log.slice(-40).map((l, i) => (
          <div key={i} className={l.startsWith("—") ? "font-semibold text-ink-soft mt-1" : "text-ink"}>{l}</div>
        ))}
      </div>
    </main>
  );
}

const hpColor = (p: number) => (p > 50 ? "#3fa84b" : p > 20 ? "#dca23e" : "#d9594c");

function BattleMon({ mon, facing }: { mon: NonNullable<Slot>; facing: "front" | "back" }) {
  const url = useMemo(
    () => (Sprites.getPokemon(mon.species, { gen: "ani", side: facing === "front" ? "p2" : "p1" }) as { url: string }).url,
    [mon.species, facing],
  );
  const prevHp = useRef(mon.hpPct);
  const [hit, setHit] = useState(false);
  useEffect(() => {
    if (mon.hpPct < prevHp.current && !mon.fainted) {
      setHit(true);
      const t = setTimeout(() => setHit(false), 450);
      prevHp.current = mon.hpPct;
      return () => clearTimeout(t);
    }
    prevHp.current = mon.hpPct;
  }, [mon.hpPct, mon.fainted]);

  return (
    <div style={{ width: 96, height: 100 }} className="grid place-items-end justify-center">
      {/* key by species → a switch or Mega Evolution remounts and replays the entrance */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={mon.species} src={url} alt={mon.species} draggable={false}
        className={`bm ${mon.fainted ? "bm-faint" : "bm-in"} ${hit ? "bm-hit" : ""}`} />
      <style jsx>{`
        .bm { image-rendering: pixelated; max-height: 100px; max-width: 112px; transform-origin: bottom center; }
        .bm-in { animation: bmIn 0.45s ease-out; }
        .bm-hit { animation: bmHit 0.45s ease-in-out; }
        .bm-faint { animation: bmFaint 0.6s ease-in forwards; }
        @keyframes bmIn { from { opacity: 0; transform: translateY(-14px) scale(0.7); } to { opacity: 1; transform: none; } }
        @keyframes bmHit { 0%,100% { transform: translateX(0); filter: none; } 25% { transform: translateX(-6px); filter: brightness(2.2); } 50% { transform: translateX(6px); } 75% { transform: translateX(-4px); } }
        @keyframes bmFaint { to { opacity: 0; transform: translateY(24px) scale(0.85); } }
      `}</style>
    </div>
  );
}

function HpPlate({ side, align }: { side: { name: string; active: Slot[] }; align: "left" | "right" }) {
  const mons = side.active.filter(Boolean) as NonNullable<Slot>[];
  if (!mons.length) return null;
  return (
    <div className={`bg-white/85 rounded-lg px-2.5 py-1.5 shadow ${align === "right" ? "text-right" : ""}`} style={{ minWidth: 156 }}>
      <div className="text-[11px] font-bold text-ink-soft mb-0.5">{side.name}</div>
      {mons.map((m, i) => (
        <div key={i} className="mb-1 last:mb-0">
          <div className="flex items-center gap-1 justify-between">
            <span className="text-xs font-semibold truncate">{m.species}{m.status && <span className="ml-1 text-[9px] uppercase text-coral">{m.status}</span>}</span>
            <span className="text-[10px] text-ink-soft">{m.fainted ? "fnt" : `${m.hpPct}%`}</span>
          </div>
          <div className="h-2 rounded bg-black/10 overflow-hidden">
            <div className="h-full rounded" style={{ width: `${m.hpPct}%`, background: hpColor(m.hpPct), transition: "width 0.6s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotChooser({ slot, req, benched, chosen, gimmick, foes, onMove, onTarget, onSwitch, onGimmick }: {
  slot: number; req: Request; benched: { details: string; party: number }[]; chosen?: SlotChoice;
  gimmick?: "mega" | "terastallize"; foes: Slot[];
  onMove: (moveIndex: number, target: string) => void; onTarget: (foeIndex: number) => void;
  onSwitch: (partyIndex: number) => void; onGimmick: (g?: "mega" | "terastallize") => void;
}) {
  const active = req.active?.[slot];
  const forceSwitch = req.forceSwitch?.[slot];
  const pickingTarget = chosen?.kind === "move" && chosen.needTarget && !chosen.moveTarget;
  return (
    <div className="border border-dashed border-paper-edge rounded p-2">
      {pickingTarget && (
        <div className="mb-2">
          <div className="text-[11px] font-semibold text-ink-soft mb-1">Target which foe?</div>
          <div className="flex gap-1.5">
            {foes.map((f, fi) => f && !f.fainted && (
              <button key={fi} onClick={() => onTarget(fi)}
                className="text-xs font-semibold rounded px-2 py-1 bg-coral/15 text-coral hover:bg-coral/30 transition">
                {f.species}
              </button>
            ))}
          </div>
        </div>
      )}
      {!forceSwitch && active && (active.canMegaEvo || active.canTerastallize) && (
        <div className="flex gap-1.5 mb-2">
          {active.canMegaEvo && (
            <button onClick={() => onGimmick(gimmick === "mega" ? undefined : "mega")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "mega" ? "#a25fb8" : "rgba(162,95,184,0.15)", color: gimmick === "mega" ? "#fff" : "#7d3f93" }}>
              ⬢ Mega Evolve
            </button>
          )}
          {active.canTerastallize && (
            <button onClick={() => onGimmick(gimmick === "terastallize" ? undefined : "terastallize")}
              className="text-xs font-bold rounded px-2 py-1 transition"
              style={{ background: gimmick === "terastallize" ? "#d24f96" : "rgba(210,79,150,0.15)", color: gimmick === "terastallize" ? "#fff" : "#a83274" }}>
              ✦ Tera {active.canTerastallize}
            </button>
          )}
        </div>
      )}
      {!forceSwitch && active && (
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          {active.moves.map((mv, j) => {
            const disabled = mv.disabled || mv.pp === 0;
            const sel = chosen?.kind === "move" && chosen.index === j + 1;
            return (
              <button key={j} disabled={disabled} onClick={() => onMove(j + 1, mv.target)}
                className="text-xs font-semibold rounded px-2 py-1.5 text-left disabled:opacity-30 transition"
                style={{ background: sel ? "var(--coral)" : "rgba(0,0,0,0.05)", color: sel ? "white" : "inherit" }}>
                {mv.move} <span className="opacity-60">{mv.pp}/{mv.maxpp}</span>
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
              className="text-[11px] rounded px-2 py-1 transition"
              style={{ background: sel ? "var(--pine,#2f8f83)" : "rgba(0,0,0,0.05)", color: sel ? "white" : "inherit" }}>
              ⇄ {b.details.split(",")[0]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamPreview({ req, format, onConfirm }: { req: Request; format: string; onConfirm: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const mons = req.side?.pokemon ?? [];
  const doubles = format !== "singles";
  const toggle = (n: number) => setOrder((o) => (o.includes(n) ? o.filter((x) => x !== n) : doubles && o.length >= 4 ? o : [...o, n]));
  return (
    <div>
      <p className="text-sm font-semibold mb-2 text-center">
        {doubles ? "Pick the 4 you'll bring — tap in order (first 2 lead)" : "Tap your lead, then the rest in order (optional)"}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {mons.map((p, i) => {
          const n = i + 1, pos = order.indexOf(n);
          const species = p.details.split(",")[0];
          const url = (Sprites.getPokemon(species, { gen: "ani", side: "p1" }) as { url: string }).url;
          return (
            <button key={n} onClick={() => toggle(n)} className="paper p-1.5 relative grid place-items-center"
              style={{ outline: pos >= 0 ? "2.5px solid var(--coral)" : "none" }}>
              {pos >= 0 && <span className="absolute top-0 left-0 bg-coral text-white text-[10px] font-bold w-4 h-4 grid place-items-center rounded-br">{pos + 1}</span>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={species} className="h-12" style={{ imageRendering: "pixelated" }} />
              <div className="text-[10px] truncate w-full text-center">{species}</div>
            </button>
          );
        })}
      </div>
      <button className="btn btn-coral w-full mt-3" disabled={doubles && order.length < 4} onClick={() => onConfirm(order)}>
        {doubles ? (order.length < 4 ? `Pick ${4 - order.length} more` : "Bring these 4") : "Start battle"}
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[60vh] grid place-items-center text-center px-4"><div>{children}</div></main>;
}
