import type { Triple } from "./engines.ts";
import { eloExpected, removeVig } from "./accuracy.ts";
import type { FreshnessReport } from "./analysis.ts";

/**
 * Twelve extra accuracy signals. All pure and client-safe; the server only fetches the raw inputs.
 * Every signal is optional: a missing input is skipped, never invented. The combined shift is capped
 * so no pile of signals can manufacture certainty.
 */

type K = keyof Triple;
const KEYS: K[] = ["home", "draw", "away"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const norm = (t: Triple): Triple => {
  const s = t.home + t.draw + t.away || 1;
  return { home: t.home / s, draw: t.draw / s, away: t.away / s };
};

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
const poisson = (k: number, l: number) => Math.exp(-l) * l ** k / factorial(k);

/** 1. Dixon-Coles: corrects the independent-Poisson habit of under-rating 0-0, 1-1, 1-0 and 0-1. */
export function dixonColes(lh: number, la: number, rho = -0.08, max = 8): Triple {
  const tau = (x: number, y: number) =>
    x === 0 && y === 0 ? 1 - lh * la * rho
    : x === 0 && y === 1 ? 1 + lh * rho
    : x === 1 && y === 0 ? 1 + la * rho
    : x === 1 && y === 1 ? 1 - rho
    : 1;
  let home = 0, draw = 0, away = 0;
  for (let x = 0; x <= max; x++) {
    for (let y = 0; y <= max; y++) {
      const p = poisson(x, lh) * poisson(y, la) * tau(x, y);
      if (x > y) home += p; else if (x === y) draw += p; else away += p;
    }
  }
  return norm({ home, draw, away });
}

/** 2. Elo to 1X2: expected score split into win/draw/loss with a draw share that peaks when teams are level. */
export function eloTriple(rHome: number, rAway: number, homeEdge = 60): Triple {
  const e = eloExpected(rHome, rAway, homeEdge);
  const draw = clamp(0.29 - Math.abs(e - 0.5) * 0.45, 0.12, 0.3);
  return norm({ home: Math.max(0.01, e - draw / 2), draw, away: Math.max(0.01, 1 - e - draw / 2) });
}

/** 3. Multi-bookmaker consensus: de-vig each book, then take the median so one stale price cannot move it. */
export function multiBookConsensus(books: Triple[]): { p: Triple; books: number; dispersion: number } | null {
  const fair = books.map(removeVig).filter((t): t is Triple => !!t);
  if (!fair.length) return null;
  const med = (k: K) => {
    const xs = fair.map((t) => t[k]).sort((a, b) => a - b);
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };
  const p = norm({ home: med("home"), draw: med("draw"), away: med("away") });
  const dispersion = Math.max(...KEYS.map((k) => Math.max(...fair.map((t) => t[k])) - Math.min(...fair.map((t) => t[k]))));
  return { p, books: fair.length, dispersion };
}

/** 4. Line movement: the shift in fair probability from opening to now. Sharp money moves toward the true price. */
export function lineMovement(open: Triple, now: Triple): Triple | null {
  const a = removeVig(open);
  const b = removeVig(now);
  if (!a || !b) return null;
  return { home: b.home - a.home, draw: b.draw - a.draw, away: b.away - a.away };
}

/** 5. Injury impact: weighted by role. Returns goal-rate multipliers for attack and defence. */
export type Absence = { role: "GK" | "DEF" | "MID" | "FWD" | "UNK"; starter: boolean };
export function injuryImpact(absences: Absence[]): { attack: number; defence: number } {
  let attack = 1, defence = 1;
  for (const a of absences) {
    const w = a.starter ? 1 : 0.35;
    if (a.role === "FWD") attack -= 0.07 * w;
    else if (a.role === "MID") { attack -= 0.035 * w; defence += 0.02 * w; }
    else if (a.role === "DEF") defence += 0.05 * w;
    else if (a.role === "GK") defence += 0.09 * w;
    else { attack -= 0.02 * w; defence += 0.02 * w; }
  }
  return { attack: clamp(attack, 0.78, 1), defence: clamp(defence, 1, 1.28) };
}

/** 6. Motivation: title, European places and relegation fights raise stakes; mid-table with nothing to play for lowers them. */
export function motivation(pos: number, teams: number, gamesLeft: number): number {
  if (gamesLeft > 14) return 1;
  const top = pos <= 2 || pos <= 4 ? 1.03 : 1;
  const drop = pos >= teams - 3 ? 1.03 : 1;
  const flat = pos > 6 && pos < teams - 5 && gamesLeft <= 5 ? 0.97 : 1;
  return top * drop * flat;
}

/** 7. Rest and congestion: fewer than 4 days between matches costs goals; a long rest gives a small lift. */
export function restFactor(daysSinceLast: number | null, playedMidweek = false): number {
  if (daysSinceLast === null) return 1;
  const base = daysSinceLast <= 3 ? 0.95 : daysSinceLast === 4 ? 0.98 : daysSinceLast >= 7 ? 1.01 : 1;
  return playedMidweek ? base * 0.99 : base;
}

/** 8. Head to head, shrunk hard: fixtures repeat but squads change, so it is only a light prior. */
export function headToHead(results: K[]): Triple | null {
  if (results.length < 3) return null;
  const n = results.length;
  const c = (k: K) => results.filter((r) => r === k).length;
  const prior = 4;
  return norm({
    home: (c("home") + prior / 3) / (n + prior),
    draw: (c("draw") + prior / 3) / (n + prior),
    away: (c("away") + prior / 3) / (n + prior),
  });
}

/** 9. Home/away split: scales a team's xG by how its venue record differs from its overall record. */
export function venueSplit(overallPpg: number, venuePpg: number, games: number): number {
  if (games < 4 || overallPpg <= 0) return 1;
  const raw = venuePpg / overallPpg;
  const shrunk = 1 + (raw - 1) * (games / (games + 8));
  return clamp(shrunk, 0.9, 1.1);
}

/** 10. Uncertainty band: perturbs both goal rates and reports the spread of the top outcome's probability. */
export function confidenceBand(lh: number, la: number, runs = 200) {
  let state = Math.round((lh * 1000 + la * 100) % 2147483647) || 1;
  const rnd = () => ((state = (state * 48271) % 2147483647) / 2147483647);
  const picks = { home: 0, draw: 0, away: 0 };
  const tops: number[] = [];
  for (let i = 0; i < runs; i++) {
    const p = dixonColes(lh * (0.85 + rnd() * 0.3), la * (0.85 + rnd() * 0.3), -0.08, 6);
    const k = KEYS.reduce((a, b) => (p[b] > p[a] ? b : a));
    picks[k] += 1;
    tops.push(p[k]);
  }
  tops.sort((a, b) => a - b);
  const top = KEYS.reduce((a, b) => (picks[b] > picks[a] ? b : a));
  return { low: tops[Math.floor(runs * 0.1)], high: tops[Math.floor(runs * 0.9)], stability: picks[top] / runs, top };
}

/** 11. Recalibration from history: a per-outcome reliability fix learned from the last 100 settled matches. */
export type CalPoint = { p: Triple; result: K };
export function reliabilityAdjust(p: Triple, history: CalPoint[], min = 40): Triple {
  if (history.length < min) return p;
  const out = { ...p };
  for (const k of KEYS) {
    const predicted = history.reduce((s, h) => s + h.p[k], 0) / history.length;
    const actual = history.filter((h) => h.result === k).length / history.length;
    // Move at most a third of the way toward observed frequency, never more than 4 points.
    out[k] = clamp(p[k] + clamp((actual - predicted) * 0.33, -0.04, 0.04), 0.01, 0.97);
  }
  return norm(out);
}

/** 12. Value and risk: edge over the market, fractional Kelly, and a plain verdict. */
export function valueCheck(p: number, decimalOdds: number | undefined, minEdge = 0.04) {
  if (!decimalOdds || decimalOdds <= 1) return { edge: null, kelly: 0, verdict: "no price" as const };
  const edge = p * decimalOdds - 1;
  const kelly = edge > minEdge ? clamp((edge / (decimalOdds - 1)) * 0.25, 0, 0.05) : 0;
  return { edge, kelly, verdict: (edge > minEdge ? "value" : edge > -0.03 ? "fair" : "overpriced") as "value" | "fair" | "overpriced" };
}

/** 13. Optional AI analyst output is always bounded: it can nudge, never decide. */
export type AiNudge = { home: number; draw: number; away: number; note?: string };
export function boundedNudge(n: AiNudge | null | undefined, cap = 0.04): Triple | null {
  if (!n) return null;
  const f = (x: number) => (Number.isFinite(x) ? clamp(x, -cap, cap) : 0);
  return { home: f(n.home), draw: f(n.draw), away: f(n.away) };
}

export type Signals = {
  elo?: Triple;
  dixonColes?: Triple;
  market?: Triple;
  h2h?: Triple;
  movement?: Triple;
  nudge?: Triple;
  dispersion?: number;
  drawPrior?: { draws: number; sample: number; observedAt: string };
  rest?: { homeDays: number | null; awayDays: number | null; homeGames14d: number; awayGames14d: number };
  venueSplit?: { homePpg: number | null; awayPpg: number | null; homeFactor: number; awayFactor: number; homeGames: number; awayGames: number };
  motivation?: { home: string; away: string; homeFactor: number | null; awayFactor: number | null };
  lineups?: { status: "confirmed" | "not-announced" | "coverage-unavailable" | "identity-unverified" | "provider-error"; observedAt: string; homeStarters: number; awayStarters: number };
  weather?: { validAt: string; temperatureC?: number; precipitationMm?: number; windKmh?: number; diagnostics: string[] };
  oddsMovement?: { openingObservedAt: string; currentObservedAt: string; movement: Triple | null; closingComparison?: { probabilityGap: number; fairOddsGapPct: number } | null };
  notes?: string[];
  freshness?: FreshnessReport;
  featureStatus?: { id: string; status: "ready" | "missing" | "stale" | "diagnostic"; detail: string }[];
};

/** Fold the signals into a base probability. Each acts as a small, capped log-odds nudge. */
export function applySignals(base: Triple, s: Signals | undefined, maxShift = 0.1): { p: Triple; notes: string[] } {
  if (!s) return { p: base, notes: [] };
  const notes = [...(s.notes ?? [])];
  const out = { ...base };
  const pull = (target: Triple | undefined, weight: number, label: string) => {
    if (!target) return;
    for (const k of KEYS) out[k] += (target[k] - base[k]) * weight;
    notes.push(label);
  };
  pull(s.elo, 0.12, "Elo rating");
  pull(s.dixonColes, 0.35, "Time-decayed Dixon–Coles fit");
  pull(s.h2h, 0.04, "Head to head");
  if (s.market) pull(s.market, s.dispersion !== undefined && s.dispersion > 0.08 ? 0.08 : 0.12, "Multi-bookmaker median · supporting signal");
  if (s.movement) for (const k of KEYS) out[k] += clamp(s.movement[k] * 0.5, -0.02, 0.02);
  if (s.nudge) for (const k of KEYS) out[k] += s.nudge[k];
  for (const k of KEYS) out[k] = clamp(out[k], base[k] - maxShift, base[k] + maxShift);
  return { p: norm({ home: Math.max(0.005, out.home), draw: Math.max(0.005, out.draw), away: Math.max(0.005, out.away) }), notes };
}
