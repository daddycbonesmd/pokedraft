"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadFormats, loadPokedex, suggestTier, DEFAULT_TIER_VALUES, type Format } from "@/lib/pokedex";
import { createLeague, type NominationMode, type BattleFormat } from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";

const ALL_FORMAT_ID = "__all_pokemon__";

const MODES: { value: NominationMode; label: string; blurb: string }[] = [
  { value: "snake_draft", label: "Point buy — snake", blurb: "Take turns picking any Pokémon, paying its points. Snake order (1‑2‑3‑4‑4‑3‑2‑1…)." },
  { value: "pointbuy_random", label: "Point buy — random", blurb: "On your turn a random Pokémon is offered — buy it for its points or pass it." },
  { value: "admin", label: "Auction — admin choice", blurb: "You pick what goes up for bid each time, then everyone bids." },
  { value: "snake", label: "Auction — snake nomination", blurb: "Coaches take turns nominating, then everyone bids." },
  { value: "one_random", label: "Auction — one nominated, one random", blurb: "A coach's nomination, then a random Pokémon, repeating." },
  { value: "auction_random", label: "Auction — fully random", blurb: "Every Pokémon up for bid is random. Everyone bids on each one." },
  { value: "full_random", label: "Random teams (instant)", blurb: "Everyone's whole team is assigned at random in one click. No bidding or picking." },
];

export default function HostLeague() {
  const router = useRouter();
  const [formats, setFormats] = useState<Format[] | null>(null);
  const [adminName, setAdminName] = useState("");
  const [leagueName, setLeagueName] = useState("");
  const [budget, setBudget] = useState(100);
  const [teamSize, setTeamSize] = useState(6);
  const [mode, setMode] = useState<NominationMode>("one_random");
  const [battleFormat, setBattleFormat] = useState<BattleFormat>("doubles");
  const [generation, setGeneration] = useState<number>(9);
  const [formatId, setFormatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hydrated = useRef(false);

  useEffect(() => {
    // Restore an in-progress host form (e.g. after popping over to build a format).
    let saved: { adminName?: string; leagueName?: string; budget?: number; teamSize?: number; mode?: NominationMode; battleFormat?: BattleFormat; generation?: number; formatId?: string } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem("pokedraft.hostDraft") || "null"); } catch {}
    if (saved) {
      setAdminName(saved.adminName ?? "");
      setLeagueName(saved.leagueName ?? "");
      if (typeof saved.budget === "number") setBudget(saved.budget);
      if (typeof saved.teamSize === "number") setTeamSize(saved.teamSize);
      if (saved.mode) setMode(saved.mode);
      if (saved.battleFormat) setBattleFormat(saved.battleFormat);
      if (typeof saved.generation === "number") setGeneration(saved.generation);
    }
    const savedId = saved?.formatId;

    // Build the always-available "Entire Pokédex" pool (every Pokémon, tiered by stats),
    // then list it first ahead of any custom formats the host has built.
    (async () => {
      const custom = loadFormats();
      let everything: Format | null = null;
      try {
        const dex = await loadPokedex();
        const tiers: Record<number, string> = {};
        for (const m of dex) tiers[m.id] = suggestTier(m.bst);
        everything = {
          id: ALL_FORMAT_ID, name: "Entire Pokédex", includedIds: dex.map((m) => m.id),
          tiers, tierValues: DEFAULT_TIER_VALUES, updatedAt: 0,
        };
      } catch { /* fall back to custom formats only */ }
      const all = everything ? [everything, ...custom] : custom;
      setFormats(all);
      if (savedId && all.some((x) => x.id === savedId)) setFormatId(savedId);
      else if (all[0]) setFormatId(all[0].id);
    })();
  }, []);

  // Persist the form on every change so leaving and coming back doesn't lose it.
  useEffect(() => {
    if (!hydrated.current) { hydrated.current = true; return; }
    sessionStorage.setItem("pokedraft.hostDraft", JSON.stringify({ adminName, leagueName, budget, teamSize, mode, battleFormat, generation, formatId }));
  }, [adminName, leagueName, budget, teamSize, mode, battleFormat, generation, formatId]);

  async function start() {
    setError("");
    const fmt = formats?.find((f) => f.id === formatId);
    if (!adminName.trim()) return setError("Enter your name.");
    if (!fmt) return setError("Pick a format to draft from.");
    setBusy(true);
    try {
      const { league } = await createLeague({
        name: leagueName.trim() || "PokéDraft League",
        adminName: adminName.trim(),
        pool: fmt.tiers,
        budget,
        mode,
        ruleset: fmt.ruleset ? `${fmt.ruleset.name} · ${fmt.ruleset.gimmick}` : "",
        tierValues: fmt.tierValues,
        teamSize,
        battleFormat,
        generation,
        legalItems: fmt.items ?? null,
      });
      sessionStorage.removeItem("pokedraft.hostDraft");
      router.push(`/room/${league.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the league.");
      setBusy(false);
    }
  }

  if (!supabaseReady) return <EnvNotice />;

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <Link href="/" className="text-sm text-ink-soft hover:underline">← Home</Link>
      <h1 className="font-display text-4xl font-black mt-1 mb-6">
        Host a <span className="text-coral">league</span>
      </h1>

      <div className="paper p-6 space-y-4">
        <Field label="Your name (you're the admin)">
          <input className="input" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="e.g. Dre" />
        </Field>
        <Field label="League name">
          <input className="input" value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder="Friday Night Draft" />
        </Field>
        <Field label="Starting budget (points per coach)">
          <input type="number" className="input" value={budget} min={10} onChange={(e) => setBudget(Number(e.target.value))} />
        </Field>
        <Field label="Pokémon per team">
          <input type="number" className="input" value={teamSize} min={1} max={24} onChange={(e) => setTeamSize(Number(e.target.value))} />
        </Field>
        <Field label="Battle format">
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "doubles", label: "Doubles", blurb: "VGC-style 2v2" },
              { value: "singles", label: "Singles", blurb: "1v1, six Pokémon" },
            ] as const).map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => setBattleFormat(b.value)}
                className="paper text-left p-3 transition"
                style={battleFormat === b.value ? { boxShadow: "0 0 0 2.5px var(--coral), 0 8px 16px -12px rgba(44,39,34,0.5)" } : undefined}
              >
                <div className="font-display font-bold">{b.label}</div>
                <div className="text-xs text-ink-soft">{b.blurb}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Draft format">
          <div className="space-y-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className="paper w-full text-left p-3 transition"
                style={mode === m.value ? { boxShadow: "0 0 0 2.5px var(--coral), 0 8px 16px -12px rgba(44,39,34,0.5)" } : undefined}
              >
                <div className="font-display font-bold">{m.label}</div>
                <div className="text-xs text-ink-soft">{m.blurb}</div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Format (the Pokémon pool)">
          {formats === null ? (
            <p className="text-ink-soft text-sm">Loading…</p>
          ) : formats.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No formats yet — <Link href="/build" className="text-coral underline">build one first</Link>.
            </p>
          ) : (
            <>
              <select className="input" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                {formats.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.includedIds.length} Pokémon){f.ruleset ? ` — ${f.ruleset.gimmick}` : ""}
                  </option>
                ))}
              </select>
              <Link href="/formats" className="text-xs text-coral underline mt-1 inline-block">
                Build or edit formats
              </Link>
            </>
          )}
        </Field>

        {error && <p className="text-coral text-sm">{error}</p>}

        <button className="btn btn-coral w-full" onClick={start} disabled={busy || !formats?.length}>
          {busy ? "Creating…" : "Create league & open the room"}
        </button>
        <p className="text-xs text-ink-soft text-center">
          You'll get a code to share. Friends join at <span className="font-mono">/join</span>.
        </p>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 4px;
          padding: 0.55rem 0.75rem;
          outline: none;
        }
        .input:focus { box-shadow: 0 0 0 2px rgba(217, 89, 76, 0.4); }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function EnvNotice() {
  return (
    <main className="max-w-lg mx-auto px-4 py-16 text-center">
      <div className="paper dogear p-8">
        <p className="hand text-3xl text-coral mb-2">almost there</p>
        <p className="text-ink-soft">
          Supabase isn&apos;t connected yet. Add your project URL and anon key to{" "}
          <span className="font-mono">.env.local</span> and restart the dev server.
        </p>
      </div>
    </main>
  );
}
