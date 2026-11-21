import type { Triple, Feed } from "./engines";

type K = keyof Triple;
const KEYS: K[] = ["home", "draw", "away"];
const norm = (t: Triple): Triple => {
  const s = t.home + t.draw + t.away || 1;
  return { home: t.home / s, draw: t.draw / s, away: t.away / s };
};
const sorted = (t: Triple) => [...KEYS].sort((a, b) => t[b] - t[a]);

/** 1. Remove the bookmaker margin with the power method (fairer than proportional scaling on long shots). */
export function removeVig(odds: Triple): Triple | null {
  const inv = KEYS.map((k) => 1 / odds[k]);
  if (inv.some((v) => !Number.isFinite(v) || v <= 0 || v >= 1)) return null;
  let lo = 0.5;
  let hi = 4;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inv.reduce((s, v) => s + v ** mid, 0) > 1) lo = mid;
    else hi = mid;
  }
  return norm({ home: inv[0] ** hi, draw: inv[1] ** hi, away: inv[2] ** hi });
}

/** 2. Market context: real odds are a supporting signal, never the forecast itself. */
export function blendWithMarket(model: Triple, market: Triple | null, marketWeight = 0.2): Triple {
  if (!market) return model;
  return norm({
    home: model.home * (1 - marketWeight) + market.home * marketWeight,
    draw: model.draw * (1 - marketWeight) + market.draw * marketWeight,
    away: model.away * (1 - marketWeight) + market.away * marketWeight,
  });
}

/** 3. Calibration: temperature > 1 flattens overconfident probabilities. */
export function calibrate(t: Triple, temperature = 1.15): Triple {
  const p = (x: number) => Math.max(x, 1e-6) ** (1 / temperature);
  return norm({ home: p(t.home), draw: p(t.draw), away: p(t.away) });
}

/** 4. Many feeds are variations of one xG model. Cap each correlated family so they cannot swamp the blend. */
const FAMILY_CAP: Record<string, number> = { x: 1.2, x2: 0.8, x4: 0.5 };
const familyOf = (id: string) => (id.startsWith("x4-") ? "x4" : id.startsWith("x2-") ? "x2" : id.startsWith("x-") ? "x" : null);

export function dedupedBlend(feeds: Feed[], weightOf: (id: string) => number): Triple {
  const raw = new Map<string, number>();
  for (const f of feeds) {
    const fam = familyOf(f.id);
    if (fam) raw.set(fam, (raw.get(fam) ?? 0) + weightOf(f.id));
  }
  let h = 0;
  let d = 0;
  let a = 0;
  let total = 0;
  for (const f of feeds) {
    const fam = familyOf(f.id);
    const scale = fam ? Math.min(1, FAMILY_CAP[fam] / (raw.get(fam) || 1)) : 1;
    const w = weightOf(f.id) * scale;
    h += f.home * w;
    d += f.draw * w;
    a += f.away * w;
    total += w;
  }
  return norm({ home: h / total, draw: d / total, away: a / total });
}

/** 5. Elo from real results, with a goal-difference multiplier. */
export const eloExpected = (rA: number, rB: number, homeEdge = 60) => 1 / (1 + 10 ** ((rB - (rA + homeEdge)) / 400));
export function eloUpdate(rHome: number, rAway: number, gh: number, ga: number, k = 20) {
  const exp = eloExpected(rHome, rAway);
  const actual = gh > ga ? 1 : gh === ga ? 0.5 : 0;
  const mult = Math.log(Math.abs(gh - ga) + 1) + 1;
  const delta = k * mult * (actual - exp);
  return { home: rHome + delta, away: rAway - delta };
}

/** 6. Track record: score every settled prediction, then refit calibration from it. */
export type Settled = { p: Triple; result: K };
export const brier = (xs: Settled[]) =>
  xs.length ? xs.reduce((s, x) => s + KEYS.reduce((q, k) => q + (x.p[k] - (k === x.result ? 1 : 0)) ** 2, 0), 0) / xs.length : NaN;
export const logLoss = (xs: Settled[]) =>
  xs.length ? -xs.reduce((s, x) => s + Math.log(Math.max(x.p[x.result], 1e-9)), 0) / xs.length : NaN;
export const hitRate = (xs: Settled[]) => (xs.length ? xs.filter((x) => sorted(x.p)[0] === x.result).length / xs.length : NaN);

export function fitTemperature(history: Settled[], min = 30): number {
  if (history.length < min) return 1.15;
  let best = 1.15;
  let bestLoss = Infinity;
  for (let t = 0.8; t <= 2.0; t += 0.05) {
    const loss = logLoss(history.map((h) => ({ ...h, p: calibrate(h.p, t) })));
    if (loss < bestLoss) {
      bestLoss = loss;
      best = t;
    }
  }
  return Number(best.toFixed(2));
}

/** 7. Decision gate: single pick, double chance, or PASS. Stale data lowers the tier. */
export type Decision = { pick: string; tier: "A" | "B" | "C" | "PASS"; reason: string };
const CODE: Record<K, string> = { home: "1", draw: "X", away: "2" };

export function decide(p: Triple, agreement: number, dataAgeHours = 0): Decision {
  const [first, second] = sorted(p);
  const stale = dataAgeHours > 48;
  const tiers = ["A", "B", "C"] as const;
  const bump = (i: number) => (stale ? Math.min(i + 1, 3) : i);
  const out = (i: number, pick: string, reason: string): Decision => ({
    pick: i >= 3 ? "PASS" : pick,
    tier: i >= 3 ? "PASS" : tiers[i],
    reason: stale ? `${reason} (data over 48h old, tier lowered)` : reason,
  });
  if (p[first] >= 0.55 && agreement >= 0.7) return out(bump(0), CODE[first], "Strong single");
  if (p[first] >= 0.45 && agreement >= 0.55) return out(bump(1), CODE[first], "Lean single");
  if (p[first] + p[second] >= 0.7) {
    const code = [first, second].sort((a, b) => KEYS.indexOf(a) - KEYS.indexOf(b)).map((k) => CODE[k]).join("");
    return out(bump(2), code === "12" ? "12" : code, "Double chance covers the uncertainty");
  }
  return { pick: "PASS", tier: "PASS", reason: "No outcome pair clears 70%" };
}

/** 8. Jackpot builder: spend a fixed number of doubles where they raise full-card hit probability most. */
export function buildJackpot(games: Triple[], doubles: number) {
  const info = games.map((p, i) => {
    const [a, b] = sorted(p);
    return { i, a, b, single: p[a], dbl: p[a] + p[b], gain: (p[a] + p[b]) / p[a] };
  });
  const chosen = new Set([...info].sort((x, y) => y.gain - x.gain).slice(0, Math.max(0, doubles)).map((x) => x.i));
  const picks = info.map((g) =>
    chosen.has(g.i)
      ? [g.a, g.b].sort((x, y) => KEYS.indexOf(x) - KEYS.indexOf(y)).map((k) => CODE[k]).join("")
      : CODE[g.a],
  );
  const hit = info.reduce((s, g) => s * (chosen.has(g.i) ? g.dbl : g.single), 1);
  return { picks, fullCardProbability: hit };
}

/** 9. Value and staking: fractional Kelly, capped, only above a minimum edge. */
export function stake(p: number, decimalOdds: number, minEdge = 0.03, fraction = 0.25, cap = 0.05) {
  const edge = p * decimalOdds - 1;
  if (!(decimalOdds > 1) || edge < minEdge) return { edge, stake: 0 };
  return { edge, stake: Math.min(cap, (edge / (decimalOdds - 1)) * fraction) };
}

/** 10. One entry point: blend, de-vig, calibrate, decide. */
export function refine(model: Triple, opts: { odds?: Triple; agreement: number; temperature?: number; dataAgeHours?: number }) {
  const market = opts.odds ? removeVig(opts.odds) : null;
  const final = calibrate(blendWithMarket(model, market), opts.temperature ?? 1.15);
  return { probabilities: final, market, decision: decide(final, opts.agreement, opts.dataAgeHours) };
}
