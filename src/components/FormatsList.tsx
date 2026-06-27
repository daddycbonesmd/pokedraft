"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadFormats, deleteFormat, TIER_COLORS, type Format } from "@/lib/pokedex";

export default function FormatsList() {
  const [formats, setFormats] = useState<Format[] | null>(null);
  const [hosting, setHosting] = useState(false);

  useEffect(() => {
    setFormats(loadFormats());
    setHosting(!!sessionStorage.getItem("pokedraft.hostDraft"));
  }, []);

  function remove(id: string) {
    if (!confirm("Delete this format?")) return;
    deleteFormat(id);
    setFormats(loadFormats());
  }

  function tierCounts(f: Format) {
    const counts: Record<string, number> = {};
    for (const t of Object.values(f.tiers)) counts[t] = (counts[t] ?? 0) + 1;
    return counts;
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex gap-3">
            <Link href="/" className="text-sm text-ink-soft hover:underline">← Home</Link>
            {hosting && <Link href="/host" className="text-sm text-coral font-semibold hover:underline">← Back to hosting</Link>}
          </div>
          <h1 className="font-display text-4xl font-black mt-1">
            Your <span className="text-coral">formats</span>
          </h1>
          <p className="text-ink-soft mt-1">The Pokémon pools you can run an auction from.</p>
        </div>
        <Link href="/build" className="btn btn-coral">+ New format</Link>
      </div>

      {formats === null ? (
        <p className="hand text-2xl text-ink-soft py-16 text-center">loading…</p>
      ) : formats.length === 0 ? (
        <div className="paper dogear p-10 text-center">
          <p className="hand text-3xl text-coral mb-2">no formats yet</p>
          <p className="text-ink-soft mb-5">Make a Pokémon pool to draft from.</p>
          <Link href="/build" className="btn btn-coral">Build a format</Link>
        </div>
      ) : (
        <div className="space-y-4">
          {formats.map((f) => {
            const counts = tierCounts(f);
            return (
              <div key={f.id} className="paper p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-display text-xl font-bold">{f.name}</h3>
                  <p className="text-sm text-ink-soft">{f.includedIds.length} Pokémon</p>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {Object.entries(counts).map(([t, n]) => (
                      <span key={t} className="chip" style={{ background: TIER_COLORS[t] ?? "#888" }}>
                        {t} · {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/build?id=${f.id}`} className="btn btn-ghost text-sm py-2">Edit</Link>
                  <button onClick={() => remove(f.id)} className="btn btn-ghost text-sm py-2">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
