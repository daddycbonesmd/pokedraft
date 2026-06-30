// Thin wrapper over @smogon/calc (the same engine Showdown's calculator uses) so
// the battle screen can preview a move's damage roll. It accounts for STAB, type
// effectiveness, the attacker's real spread + boosts + burn + item/ability, the
// field (weather/terrain), and the defender's current HP for the KO read.
//
// The attacker is always one of *your* mons, so we know its spread exactly. The
// defender's EVs/nature/item/ability are hidden, so we assume a fully defensive
// spread — max HP + max Def vs a physical move, or max HP + max SpD vs a special
// move, with the matching boosting nature — i.e. the figure is the damage a hard
// wall would take (a useful floor: "even their bulkiest build takes at least…").
import { calculate, Generations, Pokemon, Move, Field } from "@smogon/calc";
import type { Slot, FieldState } from "./battle";

// Snapshot field display names → @smogon/calc names.
const WEATHER_CALC: Record<string, string> = {
  "Harsh Sunlight": "Sun", "Rain": "Rain", "Sandstorm": "Sand", "Snow": "Snow", "Hail": "Hail",
  "Extreme Sun": "Harsh Sunshine", "Heavy Rain": "Heavy Rain", "Strong Winds": "Strong Winds",
};
const TERRAIN_CALC: Record<string, string> = {
  "Electric Terrain": "Electric", "Grassy Terrain": "Grassy", "Psychic Terrain": "Psychic", "Misty Terrain": "Misty",
};

export type DamageResult = { loPct: number; hiPct: number; lo: number; hi: number; ko: string; immune: boolean };

// Round a stat-stage / boosts record down to the six battle stats the calc accepts.
const boostsFor = (b: Record<string, number> | undefined) => {
  const out: Record<string, number> = {};
  for (const k of ["atk", "def", "spa", "spd", "spe"]) if (b?.[k]) out[k] = b[k];
  return out;
};

export function calcDamage(
  gen: number,
  attacker: NonNullable<Slot>,
  defender: NonNullable<Slot>,
  moveName: string,
  field: FieldState,
): DamageResult | null {
  try {
    const G = Generations.get(gen === 7 || gen === 8 ? gen : 9);
    const atk = new Pokemon(G, attacker.species, {
      level: attacker.level,
      ability: attacker.set?.ability || undefined,
      item: attacker.set?.item || undefined,
      nature: attacker.set?.nature || undefined,
      evs: attacker.set?.evs,
      ivs: attacker.set?.ivs,
      boosts: boostsFor(attacker.boosts),
      status: (attacker.status || "") as never,
      teraType: (attacker.tera || undefined) as never,
    });
    const move = new Move(G, moveName);
    // Assume the foe is fully invested in the defence this move targets.
    const physical = move.category === "Physical";
    const def = new Pokemon(G, defender.species, {
      level: defender.level,
      evs: physical ? { hp: 252, def: 252 } : { hp: 252, spd: 252 },
      nature: physical ? "Impish" : "Calm",
      boosts: boostsFor(defender.boosts),
      status: (defender.status || "") as never,
      teraType: (defender.tera || undefined) as never,
    });
    const maxhp = def.maxHP();
    if (defender.hpPct != null && defender.hpPct < 100) {
      (def as unknown as { originalCurHP: number }).originalCurHP = Math.max(1, Math.round((maxhp * defender.hpPct) / 100));
    }
    const f = new Field({
      weather: (WEATHER_CALC[field.weather] || undefined) as never,
      terrain: (TERRAIN_CALC[field.terrain] || undefined) as never,
      isTrickRoom: field.trickRoom,
    } as never);
    const res = calculate(G, atk, def, move, f);
    const r = res.range();
    if (!r || r[1] === 0) return { loPct: 0, hiPct: 0, lo: 0, hi: 0, ko: "", immune: true };
    let ko = "";
    try { ko = res.kochance()?.text ?? ""; } catch { /* some moves can't report ko */ }
    return { loPct: (r[0] / maxhp) * 100, hiPct: (r[1] / maxhp) * 100, lo: r[0], hi: r[1], ko, immune: false };
  } catch {
    return null;
  }
}
