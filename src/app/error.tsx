"use client";

import { useEffect } from "react";
import Link from "next/link";
import { isVersionError, maybeReloadForVersionError } from "@/lib/reload-guard";

// Route-level error boundary — catches any render error in the page tree instead of
// letting the framework show a cryptic "reload the page" screen. A stale-build chunk
// error auto-reloads to the new version; any real error shows a friendly panel (with
// the message, so it can actually be reported) and a couple of ways out.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { maybeReloadForVersionError(error); }, [error]);

  const version = isVersionError(error);
  return (
    <main className="min-h-[60vh] grid place-items-center text-center px-4">
      <div className="paper p-8 max-w-md">
        <p className="hand text-3xl text-coral mb-2">{version ? "updating…" : "that didn't go to plan"}</p>
        <p className="text-ink-soft mb-4">
          {version
            ? "A newer version just shipped — reloading to catch up."
            : "This page hit an error. Try again, or reload — your draft and battles are saved."}
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button className="btn btn-coral" onClick={() => reset()}>Try again</button>
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>Reload</button>
          <Link href="/" className="btn btn-ghost">Home</Link>
        </div>
        {!version && error?.message && (
          <p className="text-[11px] text-ink-soft/70 mt-4 font-mono break-words">{error.message}</p>
        )}
      </div>
    </main>
  );
}
