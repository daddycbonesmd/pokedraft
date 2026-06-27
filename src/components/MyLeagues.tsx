"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { myLeagueCodes, getLeaguesByCodes, forgetLeague, getIdentity, type League } from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";
import { EnvNotice } from "./HostLeague";

const MODE_LABEL: Record<string, string> = {
  admin: "Auction · admin choice",
  snake: "Auction · snake nomination",
  one_random: "Auction · one nominated, one random",
  snake_draft: "Snake draft",
};

export default function MyLeagues() {
  const [leagues, setLeagues] = useState<League[] | null>(null);

  useEffect(() => {
    if (!supabaseReady) return;
    getLeaguesByCodes(myLeagueCodes())
      .then((ls) => ls.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)))
      .then(setLeagues)
      .catch(() => setLeagues([]));
  }, []);

  function leave(l: League) {
    const id = getIdentity(l.code);
    const admin = Boolean(id?.adminToken && id.adminToken === l.admin_token);
    const msg = admin
      ? "You're the admin of this league — leaving removes your admin control on this device. Continue?"
      : "Leave this league? It's removed from your list (you can rejoin with the code).";
    if (!confirm(msg)) return;
    forgetLeague(l.code);
    setLeagues((ls) => (ls ? ls.filter((x) => x.code !== l.code) : ls));
  }

  if (!supabaseReady) return <EnvNotice />;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-ink-soft hover:underline">← Home</Link>
      <h1 className="font-display text-4xl font-black mt-1 mb-5">
        Your <span className="text-coral">leagues</span>
      </h1>

      {leagues === null ? (
        <p className="hand text-2xl text-ink-soft py-12 text-center">loading…</p>
      ) : leagues.length === 0 ? (
        <div className="paper dogear p-10 text-center">
          <p className="text-ink-soft mb-4">You haven&apos;t joined any leagues on this device yet.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/host" className="btn btn-coral">Host a league</Link>
            <Link href="/join" className="btn btn-teal">Join a draft</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {leagues.map((l) => {
            const id = getIdentity(l.code);
            const admin = Boolean(id?.adminToken && id.adminToken === l.admin_token);
            return (
              <div key={l.id} className="paper p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-bold truncate">
                    {l.name}{" "}
                    {admin && <span className="chip align-middle" style={{ background: "var(--teal)" }}>admin</span>}
                  </h3>
                  <p className="text-sm text-ink-soft">
                    Code <span className="font-mono font-bold tracking-widest">{l.code}</span> ·{" "}
                    {MODE_LABEL[l.nomination_mode] ?? l.nomination_mode}
                    {l.ruleset ? ` · ${l.ruleset}` : ""}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Link href={`/room/${l.code}`} className="btn btn-coral text-sm py-2">Open</Link>
                  <button onClick={() => leave(l)} className="btn btn-ghost text-sm py-2">Leave</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
