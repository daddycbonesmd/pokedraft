"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadPokedex, spriteSmall, TYPE_COLORS, type PokeMon } from "@/lib/pokedex";
import { getIdentity, getLeagueByCode, getRoomState, saveTeam } from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";
import {
  STATS, STAT_LABEL, EV_TOTAL_MAX, EV_STAT_MAX, NATURES, natureLabel, TERA_TYPES,
  loadRoles, loadMovepools, loadSpecies, loadItems,
  emptySet, setFromRole, setReady, evTotal, teamToShowdown, uniqueItem,
  type BattleSet, type RoleSet, type Stat, type ItemInfo,
} from "@/lib/teambuilder";

export default function Teambuilder({ code }: { code: string }) {
  const router = useRouter();
  const [mons, setMons] = useState<PokeMon[] | null>(null); // drafted mons (in pool order)
  const [coachId, setCoachId] = useState<string>("");
  const [sets, setSets] = useState<Record<number, BattleSet>>({});
  const [roles, setRoles] = useState<Record<string, RoleSet[]>>({});
  const [movepools, setMovepools] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<ItemInfo[]>([]);
  const [legalItems, setLegalItems] = useState<Set<string> | null>(null);
  const [battleFormat, setBattleFormat] = useState<string>("doubles");
  const [fatal, setFatal] = useState("");
  const [saved, setSaved] = useState<"idle" | "saving" | "ok">("idle");
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const identity = getIdentity(code);
      if (!identity) { router.push(`/join?code=${code}`); return; }
      const league = await getLeagueByCode(code);
      if (!league) { setFatal("That league code doesn't exist."); return; }
      const [state, dex, r, mp, sp, it] = await Promise.all([
        getRoomState(league.id), loadPokedex(), loadRoles(), loadMovepools(), loadSpecies(), loadItems(),
      ]);
      const me = state.coaches.find((c) => c.id === identity.coachId);
      if (!me) { setFatal("You're not a coach in this league."); return; }
      setCoachId(me.id);
      setBattleFormat(league.battle_format ?? "doubles");
      setLegalItems(league.legal_items ? new Set(league.legal_items) : null);
      setRoles(r); setMovepools(mp); setItems(it);

      const monMap = new Map(dex.map((m) => [m.id, m]));
      const draftedIds = state.wonLots.filter((l) => l.winner_coach_id === me.id).map((l) => l.mon_id);
      const drafted = draftedIds.map((id) => monMap.get(id)).filter((m): m is PokeMon => Boolean(m));
      setMons(drafted);

      // Seed sets from saved team, else empty per drafted mon.
      const savedById = new Map((me.team ?? []).map((s) => [s.monId, s]));
      const seeded: Record<number, BattleSet> = {};
      for (const m of drafted) {
        const species = sp[m.id] ?? m.display;
        seeded[m.id] = savedById.get(m.id) ?? emptySet(m.id, species, m.abilities);
        seeded[m.id].species = species; // keep canonical name fresh
      }
      setSets(seeded);
    })();
  }, [code, router]);

  // Debounced autosave whenever sets change (after first load).
  const setsList = useMemo(() => (mons ?? []).map((m) => sets[m.id]).filter(Boolean), [mons, sets]);
  useEffect(() => {
    if (!coachId || !mons) return;
    setSaved("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTeam(coachId, setsList).then(() => setSaved("ok")).catch(() => setSaved("idle"));
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [setsList, coachId, mons]);

  function update(monId: number, patch: Partial<BattleSet>) {
    setSets((s) => ({ ...s, [monId]: { ...s[monId], ...patch } }));
  }
  // Fill every drafted Pokémon with its best (first) auto-set, no duplicate items.
  function autoFillAll() {
    setSets((s) => {
      const next = { ...s };
      const used = new Set<string>();
      for (const m of mons ?? []) {
        const r = roles[m.id]?.[0];
        if (!r) continue;
        const set = setFromRole(m.id, next[m.id].species, r);
        set.item = uniqueItem(set.item, used);
        if (set.item) used.add(set.item);
        next[m.id] = set;
      }
      return next;
    });
  }
  // Apply one archetype to a single mon, avoiding an item another mon already holds.
  function applyRole(monId: number, role: RoleSet) {
    setSets((s) => {
      const used = new Set<string>(Object.values(s).filter((x) => x.monId !== monId && x.item).map((x) => x.item));
      const set = setFromRole(monId, s[monId].species, role);
      set.item = uniqueItem(set.item, used);
      return { ...s, [monId]: set };
    });
  }
  function setMove(monId: number, i: number, value: string) {
    setSets((s) => {
      const moves = [...(s[monId].moves ?? [])];
      while (moves.length < 4) moves.push("");
      moves[i] = value;
      return { ...s, [monId]: { ...s[monId], moves } };
    });
  }
  function setEv(monId: number, stat: Stat, raw: number) {
    setSets((s) => {
      const set = s[monId];
      let v = Math.max(0, Math.min(EV_STAT_MAX, Math.round(raw) || 0));
      const others = evTotal({ ...set.evs, [stat]: 0 });
      if (others + v > EV_TOTAL_MAX) v = Math.max(0, EV_TOTAL_MAX - others);
      return { ...s, [monId]: { ...set, evs: { ...set.evs, [stat]: v } } };
    });
  }
  function setIv(monId: number, stat: Stat, raw: number) {
    setSets((s) => {
      const v = Math.max(0, Math.min(31, Math.round(raw)));
      return { ...s, [monId]: { ...s[monId], ivs: { ...s[monId].ivs, [stat]: v } } };
    });
  }

  function copyTeam() {
    const text = teamToShowdown(setsList);
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  if (!supabaseReady) return <Centered>Supabase isn&apos;t connected.</Centered>;
  if (fatal) return <Centered>{fatal} <Link href="/" className="text-coral underline">Home</Link></Centered>;
  if (!mons) return <Centered><span className="hand text-3xl text-coral">loading your team…</span></Centered>;

  const readyCount = setsList.filter(setReady).length;
  // No explicit list = all standard items (Mega Stones are opt-in via the format).
  const itemOptions = legalItems ? items.filter((i) => legalItems.has(i.name)) : items.filter((i) => i.cat !== "Mega Stone");
  const itemCounts: Record<string, number> = {};
  for (const set of setsList) if (set.item) itemCounts[set.item] = (itemCounts[set.item] ?? 0) + 1;
  const dupItems = Object.keys(itemCounts).filter((it) => itemCounts[it] > 1);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="font-display text-3xl font-black">Build your <span className="text-coral">battle team</span></h1>
          <p className="text-sm text-ink-soft">
            League <span className="font-mono font-bold">{code}</span> ·{" "}
            <span className="capitalize font-semibold text-ink">{battleFormat}</span> · {readyCount}/{mons.length} ready ·{" "}
            {saved === "saving" ? "saving…" : saved === "ok" ? "saved" : ""}
            {dupItems.length > 0 && <span className="text-coral font-semibold"> · ⚠ duplicate item: {dupItems.join(", ")}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {mons.length > 0 && <button className="btn btn-coral text-sm py-2" onClick={autoFillAll} title="Fill every Pokémon with its best recommended set">⚡ Auto-fill all</button>}
          <button className="btn btn-ghost text-sm py-2" onClick={copyTeam}>{copied ? "Copied" : "Export"}</button>
          <Link href={`/room/${code}`} className="btn btn-ghost text-sm py-2">← Room</Link>
        </div>
      </div>

      {mons.length === 0 && (
        <div className="paper p-6 text-center text-ink-soft">
          You haven&apos;t drafted any Pokémon yet. Come back once the draft has picks.
        </div>
      )}

      <div className="space-y-4">
        {mons.map((m) => (
          <SetEditor
            key={m.id} mon={m} set={sets[m.id]}
            roles={roles[m.id] ?? []} movepool={movepools[m.id] ?? []} items={itemOptions}
            onApplyRole={(role) => applyRole(m.id, role)}
            onField={(patch) => update(m.id, patch)}
            onMove={(i, v) => setMove(m.id, i, v)}
            onEv={(stat, v) => setEv(m.id, stat, v)}
            onIv={(stat, v) => setIv(m.id, stat, v)}
          />
        ))}
      </div>
    </main>
  );
}

function SetEditor({
  mon, set, roles, movepool, items, onApplyRole, onField, onMove, onEv, onIv,
}: {
  mon: PokeMon; set: BattleSet; roles: RoleSet[]; movepool: string[]; items: ItemInfo[];
  onApplyRole: (r: RoleSet) => void;
  onField: (patch: Partial<BattleSet>) => void;
  onMove: (i: number, v: string) => void;
  onEv: (stat: Stat, v: number) => void;
  onIv: (stat: Stat, v: number) => void;
}) {
  const [showIv, setShowIv] = useState(false);
  const total = evTotal(set.evs);
  const moves = [0, 1, 2, 3].map((i) => set.moves?.[i] ?? "");
  const mpId = `mp-${mon.id}`;
  const itemListId = "all-items";

  return (
    <div className="paper p-4" style={{ borderTop: `4px solid ${setReady(set) ? "var(--pine, #2f8f83)" : "var(--paper-edge)"}` }}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={spriteSmall(mon.id)} alt={mon.display} width={48} height={48}
          onError={(e) => { (e.target as HTMLImageElement).src = spriteSmall(mon.baseId); }} />
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-lg leading-tight">{mon.display}</div>
          <div className="flex gap-1 mt-0.5">
            {mon.types.map((t) => (
              <span key={t} className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 text-white"
                style={{ background: TYPE_COLORS[t] }}>{t}</span>
            ))}
          </div>
        </div>
        {!setReady(set) && <span className="text-xs text-ink-soft italic">needs a move</span>}
      </div>

      {/* Base stats — so you can plan a set without leaving the page */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <Label>Base stats</Label>
          <span className="text-[11px] text-ink-soft font-semibold">BST {mon.bst}</span>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {STATS.map((s) => {
            const v = mon.stats[s];
            return (
              <div key={s} className="text-center">
                <div className="text-[10px] font-bold text-ink-soft">{STAT_LABEL[s]}</div>
                <div className="text-sm font-mono font-bold tabular-nums" style={{ color: statColor(v) }}>{v}</div>
                <div className="h-1 mt-0.5 rounded-full bg-black/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (v / 200) * 100)}%`, background: statColor(v) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Archetype auto-fill buttons */}
      {roles.length > 0 && (
        <div className="mt-3">
          <span className="text-xs font-semibold text-ink-soft">Auto sets:</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {roles.map((r) => (
              <button key={r.name} onClick={() => onApplyRole(r)}
                className="text-xs font-semibold rounded px-2 py-1 bg-coral/10 text-coral hover:bg-coral/20 transition"
                title={`${r.moves.join(", ")} · ${r.item || "no item"} · ${r.ability}`}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Moves + core fields */}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 mt-3">
        <div>
          <Label>Moves</Label>
          <datalist id={mpId}>{movepool.map((mv) => <option key={mv} value={mv} />)}</datalist>
          <div className="space-y-1">
            {moves.map((mv, i) => (
              <input key={i} list={mpId} value={mv} placeholder={`Move ${i + 1}`}
                onChange={(e) => onMove(i, e.target.value)} className="tb-input" />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <Label>Ability</Label>
            <select className="tb-input" value={set.ability} onChange={(e) => onField({ ability: e.target.value })}>
              {!mon.abilities.includes(set.ability) && set.ability && <option value={set.ability}>{set.ability}</option>}
              {mon.abilities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Item</Label>
            <datalist id={itemListId}>{items.map((it) => <option key={it.name} value={it.name}>{it.cat}</option>)}</datalist>
            <input list={itemListId} className="tb-input" value={set.item} placeholder="None"
              onChange={(e) => onField({ item: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tera</Label>
              <select className="tb-input" value={set.tera} onChange={(e) => onField({ tera: e.target.value })}>
                <option value="">None</option>
                {TERA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label>Level</Label>
              <input type="number" min={1} max={100} className="tb-input" value={set.level}
                onChange={(e) => onField({ level: Math.max(1, Math.min(100, Number(e.target.value) || 50)) })} />
            </div>
          </div>
        </div>
      </div>

      {/* Nature + EVs */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <Label>Nature & EVs</Label>
          <span className="text-xs text-ink-soft">{total}/{EV_TOTAL_MAX} EVs · <button className="underline" onClick={() => setShowIv((v) => !v)}>{showIv ? "hide IVs" : "IVs"}</button></span>
        </div>
        <select className="tb-input mb-2" value={set.nature} onChange={(e) => onField({ nature: e.target.value })}>
          {NATURES.map((n) => <option key={n} value={n}>{natureLabel(n)}</option>)}
        </select>
        <div className="grid grid-cols-6 gap-1.5">
          {STATS.map((s) => (
            <div key={s} className="text-center">
              <div className="text-[10px] font-bold text-ink-soft">{STAT_LABEL[s]}</div>
              <input type="number" min={0} max={252} className="tb-input text-center px-1" value={set.evs[s] ?? 0}
                onChange={(e) => onEv(s, Number(e.target.value))} />
              {showIv && (
                <input type="number" min={0} max={31} className="tb-input text-center px-1 mt-1" value={set.ivs[s] ?? 31}
                  title="IV" onChange={(e) => onIv(s, Number(e.target.value))} />
              )}
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        :global(.tb-input) {
          width: 100%;
          background: rgba(255, 255, 255, 0.55);
          border-radius: 4px;
          padding: 0.3rem 0.5rem;
          font-size: 0.85rem;
          outline: none;
        }
        :global(.tb-input:focus) { box-shadow: 0 0 0 2px rgba(217, 89, 76, 0.4); }
      `}</style>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold text-ink-soft block mb-1">{children}</span>;
}

// Colour a base stat the way the Showdown teambuilder does — red (weak) → green (strong).
function statColor(v: number): string {
  if (v >= 130) return "#3aa657";
  if (v >= 100) return "#7cb342";
  if (v >= 80) return "#c9a227";
  if (v >= 60) return "#e07b39";
  return "#d9594c";
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="min-h-[60vh] grid place-items-center text-center px-4"><div>{children}</div></main>;
}
