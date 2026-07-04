"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { joinLeague, getIdentity, storageAvailable, STORAGE_BLOCKED_MSG } from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";
import { EnvNotice } from "./HostLeague";

export default function JoinLeague({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageBlocked, setStorageBlocked] = useState(false);
  // Checked after mount (client-only) to avoid a hydration mismatch.
  useEffect(() => { setStorageBlocked(!storageAvailable()); }, []);

  async function join() {
    setError("");
    const c = code.trim().toUpperCase();
    if (!c) return setError("Enter the league code.");
    if (!name.trim()) return setError("Enter your name.");
    setBusy(true);
    try {
      // If you've already joined this room on this device, just go back in.
      if (getIdentity(c)) return router.push(`/room/${c}`);
      const { league } = await joinLeague(c, name.trim());
      router.push(`/room/${league.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join.");
      setBusy(false);
    }
  }

  if (!supabaseReady) return <EnvNotice />;

  return (
    <main className="max-w-md mx-auto px-4 py-12">
      <Link href="/" className="text-sm text-ink-soft hover:underline">← Home</Link>
      <h1 className="font-display text-4xl font-black mt-1 mb-6">
        Join a <span className="text-coral">draft</span>
      </h1>
      {storageBlocked && (
        <div className="paper p-4 mb-4 text-sm" style={{ borderLeft: "4px solid var(--coral)" }}>
          <b className="text-coral">⚠ This browser is blocking site storage.</b>
          <p className="text-ink-soft mt-1">{STORAGE_BLOCKED_MSG}</p>
        </div>
      )}
      <div className="paper p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-ink-soft">League code</span>
          <input
            className="input font-mono tracking-widest text-lg uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="FOLD42"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-ink-soft">Your name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya" />
        </label>
        {error && <p className="text-coral text-sm">{error}</p>}
        <button className="btn btn-coral w-full" onClick={join} disabled={busy}>
          {busy ? "Joining…" : "Join the room"}
        </button>
      </div>
      <style jsx>{`
        .input {
          width: 100%;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 4px;
          padding: 0.55rem 0.75rem;
          outline: none;
          margin-top: 0.25rem;
        }
        .input:focus { box-shadow: 0 0 0 2px rgba(217, 89, 76, 0.4); }
      `}</style>
    </main>
  );
}
