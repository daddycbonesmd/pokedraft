"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Sprites } from "@pkmn/img";
import {
  engineFormat, getBattle, getBattleChoices, getLeagueById, getIdentity,
  subscribeBattle, submitChoice, finishBattle,
  type Battle as BattleRow, type BattleChoice, type BattleFormat,
} from "@/lib/db";
import {
  setupCommands, replay, needsChoice, type BattleSnapshot, type Viewer, type Request, type Slot,
} from "@/lib/battle";

const NEED_TARGET = new Set(["normal", "any", "adjacentFoe"]);
type SlotChoice = { kind: "move"; index: number; moveTarget: string } | { kind: "switch"; index: number };

export default function Battle({ id }: { id: string }) {
  const [battle, setBattle] = useState<BattleRow | null>(null);
  const [viewer, setViewer] = useState<Viewer>("spectator");
  const [snap, setSnap] = useState<BattleSnapshot | null>(null);
  const [choices, setChoices] = useState<BattleChoice[]>([]);
  const [pending, setPending] = useState<Record<number, SlotChoice>>({});
  const [gimmick, setGimmick] = useState<Record<number, "mega" | "terastallize">>({});
  const [fatal, setFatal] = useState("");
  const [code, setCode] = useState("");

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

      // Auto-resolve team preview (keep drafted order) so v1 jumps straight to
      // battling. Team preview is always this side's first choice (seq 0) — only
      // submit when we have none yet, so realtime re-renders don't spam choices.
      if ((viewer === "p1" || viewer === "p2") && s.request?.teamPreview && ch.filter((c) => c.side === viewer).length === 0) {
        await submitChoice(id, viewer, 0, "default");
      }
      // Any client persists the result once.
      if (s.ended && b.status === "active") await finishBattle(id, s.winner);
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
  const iMustChoose = (viewer === "p1" || viewer === "p2") && needsChoice(req) && !req?.teamPreview;

  // Which active slots need a decision this request.
  const activeSlots: number[] = [];
  if (req && iMustChoose) {
    const n = req.active?.length ?? req.forceSwitch?.length ?? 1;
    for (let i = 0; i < n; i++) {
      if (req.forceSwitch?.[i] || req.active?.[i]) activeSlots.push(i);
    }
  }
  const allChosen = activeSlots.every((i) => pending[i]);

  const aliveFoeTarget = () => {
    const idx = snap.far.active.findIndex((s) => s && !s.fainted);
    return idx >= 0 ? idx + 1 : 1;
  };

  function chooseMove(slot: number, moveIndex: number, target: string) {
    const needT = NEED_TARGET.has(target) && (snap?.far.active.filter((s) => s && !s.fainted).length ?? 0) > 1;
    setPending((p) => ({ ...p, [slot]: { kind: "move", index: moveIndex, moveTarget: needT ? String(aliveFoeTarget()) : "" } }));
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
        <Link href={code ? `/play/${code}` : "/"} className="btn btn-ghost text-sm py-2">← Battles</Link>
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
        {snap.ended ? (
          <p className="hand text-3xl text-coral text-center">
            {snap.winner === "tie" ? "It's a tie!" : `${snap.winner} wins!`}
          </p>
        ) : viewer === "spectator" ? (
          <p className="text-center text-ink-soft">Spectating · turn {snap.turn}</p>
        ) : req?.teamPreview ? (
          <p className="text-center text-ink-soft">Setting up…</p>
        ) : iMustChoose ? (
          <div>
            <p className="text-sm font-semibold mb-2">Your move{activeSlots.length > 1 ? "s" : ""} · turn {snap.turn}</p>
            <div className={activeSlots.length > 1 ? "grid sm:grid-cols-2 gap-3" : ""}>
              {activeSlots.map((i) => (
                <SlotChooser
                  key={i} slot={i} req={req!} benched={benched} chosen={pending[i]} gimmick={gimmick[i]}
                  onMove={(mi, t) => chooseMove(i, mi, t)} onSwitch={(pi) => chooseSwitch(i, pi)}
                  onGimmick={(g) => setGimmick((p) => { const n = { ...p }; if (g) n[i] = g; else delete n[i]; return n; })}
                />
              ))}
            </div>
            <button className="btn btn-coral w-full mt-3" disabled={!allChosen} onClick={submit}>
              {allChosen ? "Lock in" : "Choose an action"}
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

function SlotChooser({ slot, req, benched, chosen, gimmick, onMove, onSwitch, onGimmick }: {
  slot: number; req: Request; benched: { details: string; party: number }[]; chosen?: SlotChoice;
  gimmick?: "mega" | "terastallize";
  onMove: (moveIndex: number, target: string) => void; onSwitch: (partyIndex: number) => void;
  onGimmick: (g?: "mega" | "terastallize") => void;
}) {
  const active = req.active?.[slot];
  const forceSwitch = req.forceSwitch?.[slot];
  return (
    <div className="border border-dashed border-paper-edge rounded p-2">
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

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[60vh] grid place-items-center text-center px-4"><div>{children}</div></main>;
}
