// Recovery for the "works after a reload" class of error. When a new version ships,
// the hashed JS/CSS chunk filenames change; a browser tab still running the OLD build
// then 404s a chunk the moment it navigates or lazy-loads something, and the page dies
// with a cryptic error. This detects that specific failure and reloads once to pick up
// the fresh build — bounded so a genuine, persistent bug can never reload-loop.

export function isVersionError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null | undefined;
  const s = `${e?.name ?? ""} ${e?.message ?? String(err ?? "")}`;
  return /ChunkLoadError|Loading chunk|Loading CSS chunk|dynamically imported module|module script failed|Failed to fetch dynamically|error loading dynamically imported/i.test(s);
}

// Reload for a version/chunk error, at most 3 times per 30s window (so a transient
// stale-chunk recovers instantly, but a persistent failure stops and shows the UI).
// Returns true if a reload was triggered.
export function maybeReloadForVersionError(err: unknown): boolean {
  if (typeof window === "undefined" || !isVersionError(err)) return false;
  const KEY = "pokedraft.autoReload";
  try {
    const now = Date.now();
    let n = 0, t = 0;
    const raw = sessionStorage.getItem(KEY);
    if (raw) { const p = JSON.parse(raw); n = p.n ?? 0; t = p.t ?? 0; }
    if (now - t > 30000) n = 0;          // budget resets after a quiet spell (next deploy)
    if (n >= 3) return false;            // stop looping — let the fallback UI show
    sessionStorage.setItem(KEY, JSON.stringify({ n: n + 1, t: now }));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
