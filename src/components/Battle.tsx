"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadPokedex, spriteSmall } from "@/lib/pokedex";
import {
  engineFormat, getBattle, getBattleChoices, getLeagueById, getIdentity,
  subscribeBattle, submitChoice, finishBattle,
  type Battle as BattleRow, type BattleChoice, type BattleFormat,
} from "@/lib/db";
import {
  setupCommands, replay, needsChoice, type BattleSnapshot, type Viewer, type Request, type Slot,
} from "@/lib/battle";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  const nameToId = useRef<Map<string, number>>(new Map());

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
      const dex = await loadPokedex();
      const map = new Map<string, number>();
      for (const m of dex) { map.set(norm(m.display), m.id); map.set(norm(m.name), m.id); }
      nameToId.current = map;
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

      {/* Field — opponent on top, you below */}
      <div className="paper p-4 space-y-4">
        <SideRow side={snap.far} nameToId={nameToId.current} align="right" />
        <div className="border-t border-dashed border-paper-edge" />
        <SideRow side={snap.near} nameToId={nameToId.current} align="left" />
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

function SideRow({ side, nameToId, align }: { side: { name: string; active: Slot[] }; nameToId: Map<string, number>; align: "left" | "right" }) {
  const mons = side.active.filter(Boolean) as NonNullable<Slot>[];
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-xs font-semibold text-ink-soft mb-1">{side.name}</div>
      <div className={`flex gap-3 ${align === "right" ? "justify-end" : ""}`}>
        {mons.length === 0 && <span className="text-ink-soft text-sm italic">—</span>}
        {mons.map((m, i) => {
          const monId = nameToId.get(norm(m.species));
          return (
            <div key={i} className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`} style={{ opacity: m.fainted ? 0.4 : 1 }}>
              {monId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={spriteSmall(monId)} alt={m.species} width={44} height={44} />
              ) : <span className="w-11 h-11 grid place-items-center text-xs">?</span>}
              <div className={align === "right" ? "text-right" : ""}>
                <div className="text-sm font-semibold leading-tight">{m.species}{m.status && <span className="ml-1 text-[10px] uppercase text-coral">{m.status}</span>}</div>
                <div className="w-24 h-2 rounded bg-black/10 mt-0.5 inline-block">
                  <div className="h-full rounded" style={{ width: `${m.hpPct}%`, background: m.hpPct > 50 ? "#2f8f83" : m.hpPct > 20 ? "#dca23e" : "#d9594c" }} />
                </div>
                <div className="text-[10px] text-ink-soft">{m.fainted ? "fainted" : `${m.hpPct}%`}</div>
              </div>
            </div>
          );
        })}
      </div>
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
