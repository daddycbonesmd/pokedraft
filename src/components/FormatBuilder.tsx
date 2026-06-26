"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  loadPokedex,
  getFormat,
  saveFormat,
  suggestTier,
  spriteSmall,
  GENS,
  ALL_TYPES,
  TIERS,
  TIER_COLORS,
  TYPE_COLORS,
  DEFAULT_TIER_VALUES,
  valueForTier,
  type PokeMon,
} from "@/lib/pokedex";
import { loadRegulations, poolFromRegulation, type RegData, type Regulation } from "@/lib/regulations";

const MAX_VISIBLE = 300; // keep the DOM light; filters narrow things down

export default function FormatBuilder({ editId }: { editId?: string }) {
  const router = useRouter();
  const [dex, setDex] = useState<PokeMon[] | null>(null);
  const [regs, setRegs] = useState<RegData | null>(null);
  const [name, setName] = useState("My Format");
  const [ruleset, setRuleset] = useState<{ name: string; gimmick: string } | undefined>(undefined);
  const [tierValues, setTierValues] = useState<Record<string, number>>({ ...DEFAULT_TIER_VALUES });
  // monId → tier label. Presence in the map means "included".
  const [picked, setPicked] = useState<Record<number, string>>({});

  const [search, setSearch] = useState("");
  const [gen, setGen] = useState<number | "all">("all");
  const [type, setType] = useState<string | "all">("all");
  const [showMega, setShowMega] = useState(true);
  const [showForms, setShowForms] = useState(false);
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [sort, setSort] = useState<"dex" | "tier">("dex");

  // Load dex + (optionally) an existing format to edit.
  useEffect(() => {
    loadPokedex().then(setDex).catch(() => setDex([]));
    loadRegulations().then(setRegs).catch(() => setRegs(null));
    if (editId) {
      const f = getFormat(editId);
      if (f) {
        setName(f.name);
        setPicked(f.tiers);
        setRuleset(f.ruleset);
        setTierValues({ ...DEFAULT_TIER_VALUES, ...(f.tierValues ?? {}) });
      }
    }
  }, [editId]);

  function applyRegulation(reg: Regulation) {
    if (!dex || !regs) return;
    setPicked(poolFromRegulation(dex, reg, regs));
    setName(reg.name);
    setRuleset({ name: reg.name, gimmick: reg.gimmick });
  }

  const filtered = useMemo(() => {
    if (!dex) return [];
    const q = search.trim().toLowerCase();
    return dex.filter((m) => {
      if (m.isMega && !showMega) return false;
      if (m.id >= 10000 && !m.isMega && !showForms) return false;
      if (gen !== "all" && m.gen !== gen) return false;
      if (type !== "all" && !m.types.includes(type)) return false;
      if (q && !m.display.toLowerCase().includes(q)) return false;
      if (onlyPicked && !(m.id in picked)) return false;
      return true;
    });
  }, [dex, search, gen, type, showMega, showForms, onlyPicked, picked]);

  const sorted = useMemo(() => {
    if (sort !== "tier") return filtered;
    const rank = (m: PokeMon) =>
      TIERS.indexOf((m.id in picked ? picked[m.id] : suggestTier(m.bst)) as (typeof TIERS)[number]);
    return [...filtered].sort((a, b) => rank(a) - rank(b) || b.bst - a.bst);
  }, [filtered, sort, picked]);

  const visible = sorted.slice(0, MAX_VISIBLE);
  const pickedCount = Object.keys(picked).length;

  function toggle(m: PokeMon) {
    setPicked((p) => {
      const next = { ...p };
      if (m.id in next) delete next[m.id];
      else next[m.id] = suggestTier(m.bst);
      return next;
    });
  }
  function setTier(id: number, tier: string) {
    setPicked((p) => ({ ...p, [id]: tier }));
  }
  function includeAllShown() {
    setPicked((p) => {
      const next = { ...p };
      for (const m of filtered) if (!(m.id in next)) next[m.id] = suggestTier(m.bst);
      return next;
    });
  }
  function clearAll() {
    if (confirm("Remove every Pokémon from this format?")) setPicked({});
  }

  function save() {
    const id = editId ?? (crypto.randomUUID?.() ?? String(Date.now()));
    saveFormat({
      id,
      name: name.trim() || "Untitled Format",
      includedIds: Object.keys(picked).map(Number),
      tiers: picked,
      tierValues,
      updatedAt: Date.now(),
      ruleset,
    });
    router.push("/formats");
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between mb-5">
        <div>
          <Link href="/formats" className="text-sm text-ink-soft hover:underline">
            ← All formats
          </Link>
          <h1 className="font-display text-3xl font-black mt-1">
            Format <span className="text-coral">builder</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="paper px-3 py-2 font-display font-bold outline-none focus:ring-2 focus:ring-coral/40"
            placeholder="Format name"
          />
          <button className="btn btn-coral" onClick={save}>
            Save format
          </button>
        </div>
      </div>

      {/* Start from a regulation */}
      {regs && (
        <div className="paper p-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink-soft mr-1">Start from a regulation:</span>
            {regs.presets.map((reg) => (
              <button
                key={reg.id}
                onClick={() => applyRegulation(reg)}
                className="btn btn-ghost text-sm py-1.5"
                title={reg.blurb}
              >
                {reg.name} · {reg.gimmick}
              </button>
            ))}
          </div>
          {ruleset && (
            <p className="text-xs text-ink-soft mt-2">
              Loaded <b className="text-ink">{ruleset.name}</b> ({ruleset.gimmick}). Tweak the pool below —
              restricted legendaries are included where the format allows them; enforce the team limit at draft time.
            </p>
          )}
        </div>
      )}

      {/* Draft values per tier */}
      <div className="paper p-4 mb-4">
        <p className="text-sm font-semibold text-ink-soft mb-2">Draft values (points each Pokémon costs, by tier)</p>
        <div className="flex flex-wrap gap-3">
          {TIERS.map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <span className="chip" style={{ background: TIER_COLORS[t] }}>{t}</span>
              <input
                type="number"
                min={0}
                value={tierValues[t] ?? 0}
                onChange={(e) => setTierValues((v) => ({ ...v, [t]: Number(e.target.value) }))}
                className="w-16 bg-white/50 rounded px-2 py-1 outline-none"
              />
              <span className="text-xs text-ink-soft">pts</span>
            </label>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="paper p-4 mb-5 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Pokémon…"
            className="flex-1 min-w-44 bg-white/50 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-coral/40"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="bg-white/50 rounded px-3 py-2 outline-none capitalize"
          >
            <option value="all">All types</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">{t}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "dex" | "tier")}
            className="bg-white/50 rounded px-3 py-2 outline-none"
          >
            <option value="dex">Sort: Dex #</option>
            <option value="tier">Sort: Tier</option>
          </select>
        </div>

        {/* Generation chips */}
        <div className="flex flex-wrap gap-1.5">
          <Chip active={gen === "all"} onClick={() => setGen("all")}>All gens</Chip>
          {GENS.map((g) => (
            <Chip key={g} active={gen === g} onClick={() => setGen(g)}>Gen {g}</Chip>
          ))}
        </div>

        {/* Toggles + bulk actions */}
        <div className="flex flex-wrap gap-2 items-center text-sm">
          <Toggle on={showMega} onClick={() => setShowMega((v) => !v)}>Megas</Toggle>
          <Toggle on={showForms} onClick={() => setShowForms((v) => !v)}>Alt forms</Toggle>
          <Toggle on={onlyPicked} onClick={() => setOnlyPicked((v) => !v)}>Only included</Toggle>
          <span className="flex-1" />
          <button className="btn btn-ghost text-sm py-1.5" onClick={includeAllShown}>
            + Include all shown
          </button>
          <button className="btn btn-ghost text-sm py-1.5" onClick={clearAll}>
            Clear
          </button>
        </div>
      </div>

      {/* Count line */}
      <p className="text-sm text-ink-soft mb-3">
        <span className="font-bold text-coral">{pickedCount}</span> included ·{" "}
        showing {visible.length} of {filtered.length}
        {filtered.length > MAX_VISIBLE && " (refine filters to see more)"}
      </p>

      {/* Grid */}
      {!dex ? (
        <p className="text-ink-soft py-20 text-center hand text-2xl">loading the Pokédex…</p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((m) => {
            const isIn = m.id in picked;
            return (
              <div
                key={m.id}
                className="paper p-3 relative transition"
                style={isIn ? { boxShadow: `0 0 0 2.5px ${TIER_COLORS[picked[m.id]]}, 0 10px 20px -14px rgba(44,39,34,0.5)` } : undefined}
              >
                <button onClick={() => toggle(m)} className="w-full text-left">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={spriteSmall(m.id)}
                      alt={m.display}
                      width={56}
                      height={56}
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).src = spriteSmall(m.baseId); }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-display font-bold leading-tight truncate">{m.display}</span>
                        {m.isMega && <span className="chip" style={{ background: "var(--indigo)" }}>Mega</span>}
                      </div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {m.types.map((t) => (
                          <span key={t} className="chip" style={{ background: TYPE_COLORS[t] ?? "#888" }}>{t}</span>
                        ))}
                      </div>
                      <p className="text-xs text-ink-soft mt-1">
                        Gen {m.gen} · {m.bst} BST · <span className="font-semibold text-ink">{valueForTier(isIn ? picked[m.id] : suggestTier(m.bst), tierValues)} pts</span>
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-ink-soft mt-2 truncate">{m.abilities.join(" · ")}</p>
                </button>

                {/* tier picker, only when included */}
                {isIn && (
                  <div className="flex gap-1 mt-2 border-t border-dashed border-paper-edge pt-2">
                    {TIERS.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTier(m.id, t)}
                        className="flex-1 rounded text-xs font-bold py-1 transition"
                        style={{
                          background: picked[m.id] === t ? TIER_COLORS[t] : "transparent",
                          color: picked[m.id] === t ? "#fff" : "var(--ink-soft)",
                          border: `1px solid ${picked[m.id] === t ? TIER_COLORS[t] : "var(--paper-edge)"}`,
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-sm px-3 py-1 rounded-full transition"
      style={{
        background: active ? "var(--ink)" : "transparent",
        color: active ? "var(--paper)" : "var(--ink-soft)",
        border: `1px solid ${active ? "var(--ink)" : "var(--paper-edge)"}`,
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-full transition"
      style={{
        background: on ? "var(--teal)" : "transparent",
        color: on ? "#fff" : "var(--ink-soft)",
        border: `1px solid ${on ? "var(--teal)" : "var(--paper-edge)"}`,
      }}
    >
      {children}
    </button>
  );
}
