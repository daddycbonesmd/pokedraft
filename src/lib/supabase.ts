import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Surfaces a clear message if the .env.local values are missing.
export const supabaseReady = Boolean(url && anon);

export const supabase = createClient(url ?? "http://missing", anon ?? "missing", {
  realtime: { params: { eventsPerSecond: 20 } },
});

// 12 distinct "origami paper" colours, handed out in join order (supports up to a
// full 12-player league before any colour repeats).
export const COACH_COLORS = [
  "#d9594c", "#2f8f83", "#dca23e", "#5867a8",
  "#8c5a86", "#6f8f4e", "#b5683e", "#4f7a99",
  "#cf6a9c", "#4a8c4a", "#8a5a3c", "#7867b0",
];
