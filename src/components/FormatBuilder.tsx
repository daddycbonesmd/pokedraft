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
import { loadItems, type ItemInfo } from "@/lib/teambuilder";

const MAX_VISIBLE = 300; // keep the DOM light; filters narrow things down

export default function FormatBuilder({ editId }: { editId?: string }) {
  const router = useRouter();
  const [dex, setDex] = useState<PokeMon[] | null>(null);
  const [regs, setRegs] = useState<RegData | null>(null);
  const [hosting, setHosting] = useState(false);
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

  // Legal-items menu
  const [itemData, setItemData] = useState<ItemInfo[]>([]);
  const [legalItems, setLegalItems] = useState<Set<string>>(new Set());
  const [showItems, setShowItems] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [itemCat, setItemCat] = useState<string>("all");
  const [itemSort, setItemSort] = useState<"name" | "cat">("name");

  // Load dex + (optionally) an existing format to edit.
  useEffect(() => {
    setHosting(!!sessionStorage.getItem("pokedraft.hostDraft"));
    loadPokedex().then(setDex).catch(() => setDex([]));
    loadRegulations().then(setRegs).catch(() => setRegs(null));
    loadItems().then((data) => {
      setItemData(data);
      const f = editId ? getFormat(editId) : null;
      setLegalItems(f?.items ? new Set(f.items) : new Set(data.map((i) => i.name)));
    }).catch(() => setItemData([]));
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

  const itemCats = useMemo(() => ["all", ...Array.from(new Set(itemData.map((i) => i.cat)))], [itemData]);
  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const list = itemData.filter((i) =>
      (itemCat === "all" || i.cat === itemCat) &&
      (!q || i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)));
    return itemSort === "cat" ? [...list].sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name)) : list;
  }, [itemData, itemSearch, itemCat, itemSort]);

  const toggleItem = (name: string) => setLegalItems((s) => {
    const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n;
  });
  const setShownItems = (include: boolean) => setLegalItems((s) => {
    const n = new Set(s); for (const i of filteredItems) include ? n.add(i.name) : n.delete(i.name); return n;
  });

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
      items: itemData.length && legalItems.size === itemData.length ? undefined : [...legalItems],
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
          <div className="flex gap-3">
            <Link href="/formats" className="text-sm text-ink-soft hover:underline">← All formats</Link>
            {hosting && <Link href="/host" className="text-sm text-coral font-semibold hover:underline">← Back to hosting</Link>}
          </div>
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

      {/* Legal items */}
      <div className="paper p-4 mb-4">
        <button className="flex items-center justify-between w-full" onClick={() => setShowItems((v) => !v)}>
          <span className="text-sm font-semibold text-ink-soft">
            Legal items — <span className="text-coral font-bold">{legalItems.size}</span> of {itemData.length} allowed
          </span>
          <span className="text-ink-soft text-xs">{showItems ? "▲ hide" : "▼ edit"}</span>
        </button>
        {showItems && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2 items-center mb-2">
              <input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search items…"
                className="flex-1 min-w-40 bg-white/50 rounded px-3 py-2 outline-none focus:ring-2 focus:ring-coral/40"
              />
              <select value={itemCat} onChange={(e) => setItemCat(e.target.value)} className="bg-white/50 rounded px-2 py-2 outline-none">
                {itemCats.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
              </select>
              <select value={itemSort} onChange={(e) => setItemSort(e.target.value as "name" | "cat")} className="bg-white/50 rounded px-2 py-2 outline-none">
                <option value="name">Sort: Name</option>
                <option value="cat">Sort: Category</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2 mb-2 items-center">
              <button className="btn btn-ghost text-sm py-1" onClick={() => setLegalItems(new Set(itemData.map((i) => i.name)))}>All</button>
              <button className="btn btn-ghost text-sm py-1" onClick={() => setLegalItems(new Set())}>None</button>
              <button className="btn btn-ghost text-sm py-1" onClick={() => setShownItems(true)}>+ Shown</button>
              <button className="btn btn-ghost text-sm py-1" onClick={() => setShownItems(false)}>− Shown</button>
              <span className="text-xs text-ink-soft">{filteredItems.length} shown</span>
            </div>
            <div className="max-h-72 overflow-auto grid sm:grid-cols-2 gap-1 pr-1">
              {filteredItems.slice(0, 400).map((i) => {
                const on = legalItems.has(i.name);
                return (
                  <button key={i.name} onClick={() => toggleItem(i.name)} title={i.desc}
                    className="text-left rounded px-2 py-1.5 flex items-start gap-2 transition"
                    style={{ background: on ? "rgba(47,143,131,0.12)" : "rgba(0,0,0,0.03)" }}>
                    <span className="mt-0.5 w-4 h-4 shrink-0 rounded-sm grid place-items-center text-[10px] text-white"
                      style={{ background: on ? "var(--teal)" : "transparent", border: `1px solid ${on ? "var(--teal)" : "var(--paper-edge)"}` }}>{on ? "✓" : ""}</span>
                    <span className="min-w-0">
                      <span className="text-sm font-semibold">{i.name}</span> <span className="text-[10px] text-ink-soft">{i.cat}</span>
                      <span className="block text-[11px] text-ink-soft truncate">{i.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
