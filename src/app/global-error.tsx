"use client";

import { useEffect } from "react";
import { maybeReloadForVersionError } from "@/lib/reload-guard";

// Last-resort boundary for an error thrown by the root layout itself. It replaces the
// whole document, so it must render its own <html>/<body> and can't use the app's CSS.
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { maybeReloadForVersionError(error); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f5efe4", color: "#2c2722" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#6b6257", marginBottom: 16 }}>Reload to try again.</p>
          <button onClick={() => window.location.reload()}
            style={{ background: "#d9594c", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 700 }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
