"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { myLeagueCodes, getIdentity, getLeagueByCode, subscribeLeagueBattles, listBattles, type Battle } from "@/lib/db";
import { supabaseReady } from "@/lib/supabase";

type Invite = { id: string; vs: string; me: string };

// Mounted globally: pops a toast on any screen when there's an active battle that
// has you in it (skips practice-vs-AI and battles you're already viewing). Works
// three ways so an invite is never missed: an initial scan of active battles, a
// realtime INSERT subscription for instant delivery, and a slow poll as a fallback
// in case realtime is unavailable or you opened the app after the invite was sent.
export default function BattleNotifier() {
  const pathname = usePathname();
  const [invites, setInvites] = useState<Invite[]>([]);
  const dismissed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!supabaseReady) return;
    let cancelled = false;
    const unsubs: (() => void)[] = [];

    // Resolve my (code → coachId, leagueId) once; reused by scan + subscribe.
    const myLeagues = async () => {
      const out: { leagueId: string; coachId: string }[] = [];
      for (const code of myLeagueCodes()) {
        const id = getIdentity(code);
        if (!id) continue;
        let leagueId: string | undefined;
        try { leagueId = (await getLeagueByCode(code))?.id; } catch { /* ignore */ }
        if (leagueId) out.push({ leagueId, coachId: id.coachId });
      }
      return out;
    };

    const FRESH_MS = 20 * 60 * 1000; // a battle older than 20 min is stale — don't pop it
    const consider = (b: Battle, coachId: string) => {
      const meP1 = b.p1_coach_id === coachId, meP2 = b.p2_coach_id === coachId;
      if ((!meP1 && !meP2) || b.p2_coach_id === null) return;            // not mine, or vs AI
      if (b.status !== "active") return;                                  // already finished
      if (b.created_at && Date.now() - new Date(b.created_at).getTime() > FRESH_MS) return; // stale/abandoned
      if (dismissed.current.has(b.id)) return;                            // user closed it
      if (typeof window !== "undefined" && window.location.pathname.includes(b.id)) return; // already there
      setInvites((prev) => prev.some((x) => x.id === b.id) ? prev
        : [...prev, { id: b.id, vs: meP1 ? b.p2_name : b.p1_name, me: meP1 ? b.p1_name : b.p2_name }]);
    };

    const scan = async (leagues: { leagueId: string; coachId: string }[]) => {
      for (const { leagueId, coachId } of leagues) {
        let battles: Battle[] = [];
        try { battles = await listBattles(leagueId); } catch { /* ignore */ }
        if (cancelled) return;
        for (const b of battles) consider(b, coachId);
      }
    };

    (async () => {
      const leagues = await myLeagues();
      if (cancelled) return;
      await scan(leagues);                                                // 1) catch existing invites
      for (const { leagueId, coachId } of leagues) {                      // 2) instant on new inserts
        unsubs.push(subscribeLeagueBattles(leagueId, (b) => consider(b, coachId)));
      }
      const poll = setInterval(() => { void scan(leagues); }, 15000);     // 3) fallback poll
      unsubs.push(() => clearInterval(poll));
    })();

    return () => { cancelled = true; unsubs.forEach((u) => u()); };
  }, []);

  // Clear an invite once you're on its battle page.
  useEffect(() => { setInvites((prev) => prev.filter((i) => !pathname.includes(i.id))); }, [pathname]);

  const dismiss = (id: string) => { dismissed.current.add(id); setInvites((p) => p.filter((x) => x.id !== id)); };
  if (!invites.length) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-xs">
      {invites.map((i) => (
        <div key={i.id} className="invite-toast paper p-3 shadow-xl flex items-center gap-3" style={{ borderLeft: "4px solid var(--coral)" }}>
          <div className="text-2xl">⚔️</div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-sm leading-tight">Battle ready!</div>
            <div className="text-ink-soft text-xs truncate"><b className="text-ink">{i.vs}</b> wants to battle you.</div>
          </div>
          <Link href={`/battle/${i.id}`} onClick={() => dismiss(i.id)} className="btn btn-coral text-xs py-1.5 px-3">Join</Link>
          <button onClick={() => dismiss(i.id)} aria-label="Dismiss" className="text-ink-soft hover:text-ink text-xl leading-none">×</button>
        </div>
      ))}
      <style jsx>{`
        .invite-toast { animation: slidein 0.25s ease-out; }
        @keyframes slidein { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
