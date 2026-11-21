import type { Triple } from "./engines.ts";

type K = keyof Triple;
const KEYS: K[] = ["home", "draw", "away"];

/** One completed match with the probabilities that were stored for it and what actually happened. */
export type BacktestRecord = {
  id?: string;
  engine: Triple;
  ai: Triple;
  /** The reconciled Final tip probabilities, when they were recorded. Preferred over a plain engine/AI average. */
  final?: Triple;
  /** De-vigged bookmaker probabilities captured before kickoff, when available. */
  market?: Triple;
  tier?: "A" | "B" | "C" | "PASS";
  result: K;
};

const top = (t: Triple): K => [...KEYS].sort((a, b) => t[b] - t[a])[0];
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const onehot = (r: K) => ({ home: r === "home" ? 1 : 0, draw: r === "draw" ? 1 : 0, away: r === "away" ? 1 : 0 });

const brierOne = (p: Triple, r: K) => KEYS.reduce((s, k) => s + (p[k] - onehot(r)[k]) ** 2, 0);
const logLossOne = (p: Triple, r: K) => -Math.log(Math.max(p[r], 1e-9));
/** Ranked probability score for the ordered outcomes home < draw < away (lower is better). */
const rpsOne = (p: Triple, r: K) => {
  const o = onehot(r);
  const c1 = p.home - o.home;
  const c2 = p.home + p.draw - o.home - o.draw;
  return (c1 ** 2 + c2 ** 2) / 2;
};

/** 95% Wilson interval for a hit rate. Honest about small samples, unlike a plain percentage. */
export function wilson(hits: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: NaN, high: NaN };
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type Scorecard = {
  n: number;
  hits: number;
  hitRate: number;
  hitLow: number;
  hitHigh: number;
  brier: number;
  logLoss: number;
  rps: number;
};

export type OutcomeAccuracy = { n: number; hits: number; accuracy: number };
export type OutcomeBreakdown = { home: OutcomeAccuracy; draw: OutcomeAccuracy; away: OutcomeAccuracy };

export function score(rows: { p: Triple; result: K }[]): Scorecard {
  const n = rows.length;
  const hits = rows.filter((r) => top(r.p) === r.result).length;
  const w = wilson(hits, n);
  return {
    n,
    hits,
    hitRate: n ? hits / n : NaN,
    hitLow: w.low,
    hitHigh: w.high,
    brier: mean(rows.map((r) => brierOne(r.p, r.result))),
    logLoss: mean(rows.map((r) => logLossOne(r.p, r.result))),
    rps: mean(rows.map((r) => rpsOne(r.p, r.result))),
  };
}

const blend = (a: Triple, b: Triple): Triple => ({
  home: (a.home + b.home) / 2,
  draw: (a.draw + b.draw) / 2,
  away: (a.away + b.away) / 2,
});

export type CalibrationBin = { from: number; to: number; n: number; predicted: number; observed: number };

/** Does "70% confident" really win about 70% of the time? Bins every outcome probability that was issued. */
export function calibrationBins(rows: { p: Triple; result: K }[], edges = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1.0001]): CalibrationBin[] {
  const bins = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], preds: [] as number[], wins: 0 }));
  for (const r of rows) {
    for (const k of KEYS) {
      const b = bins.find((x) => r.p[k] >= x.from && r.p[k] < x.to);
      if (!b) continue;
      b.preds.push(r.p[k]);
      if (r.result === k) b.wins += 1;
    }
  }
  return bins
    .filter((b) => b.preds.length)
    .map((b) => ({ from: b.from, to: Math.min(1, b.to), n: b.preds.length, predicted: mean(b.preds), observed: b.wins / b.preds.length }));
}

export type Verdict = "insufficient" | "no-edge" | "beats-baseline";

export type BacktestReport = {
  n: number;
  engine: Scorecard;
  ai: Scorecard;
  blend: Scorecard;
  /** The probabilities the app actually published (final tip when recorded, otherwise the blend). */
  primary: Scorecard;
  /** Recall by the verified result class, separated for the engine, AI lab and published forecast. */
  outcomes: { engine: OutcomeBreakdown; ai: OutcomeBreakdown; primary: OutcomeBreakdown };
  tiers: { tier: "A" | "B" | "C" | "PASS"; card: Scorecard }[];
  /** Naive references the model has to beat to be worth anything. */
  baselines: { alwaysHome: Scorecard; frequency: Scorecard; uniform: Scorecard; lowestOdds: Scorecard | null };
  /** Brier skill vs. the league-frequency baseline: above 0 means better than guessing by base rates. */
  skill: { engine: number; ai: number; blend: number; primary: number };
  /** Accuracy when the two models agreed vs. when they did not. Agreement is only useful if the first is clearly higher. */
  agreement: { agree: Scorecard; disagree: Scorecard; liftPoints: number };
  /** Accuracy by how confident the blended pick was. */
  confidence: { label: string; card: Scorecard }[];
  calibration: CalibrationBin[];
  verdict: Verdict;
  verdictText: string;
};

function outcomeBreakdown(rows: { p: Triple; result: K }[]): OutcomeBreakdown {
  return Object.fromEntries(KEYS.map((outcome) => {
    const classRows = rows.filter((row) => row.result === outcome);
    const hits = classRows.filter((row) => top(row.p) === outcome).length;
    return [outcome, { n: classRows.length, hits, accuracy: classRows.length ? hits / classRows.length : NaN }];
  })) as OutcomeBreakdown;
}

/** Below this many completed matches, no accuracy claim is made. Hit rates on small samples are mostly luck. */
export const MIN_SAMPLE = 50;

/**
 * Historical backtest over completed matches. Every number comes from comparing stored probabilities with
 * real final results; nothing here counts how many models agree as evidence of being right.
 */
export function runBacktest(records: BacktestRecord[]): BacktestReport {
  const n = records.length;
  const rows = {
    engine: records.map((r) => ({ p: r.engine, result: r.result })),
    ai: records.map((r) => ({ p: r.ai, result: r.result })),
    blend: records.map((r) => ({ p: blend(r.engine, r.ai), result: r.result })),
    primary: records.map((r) => ({ p: r.final ?? blend(r.engine, r.ai), result: r.result })),
  };
  const freq = {
    home: n ? records.filter((r) => r.result === "home").length / n : 1 / 3,
    draw: n ? records.filter((r) => r.result === "draw").length / n : 1 / 3,
    away: n ? records.filter((r) => r.result === "away").length / n : 1 / 3,
  };
  const baselines = {
    alwaysHome: score(records.map((r) => ({ p: { home: 0.98, draw: 0.01, away: 0.01 }, result: r.result }))),
    frequency: score(records.map((r) => ({ p: freq, result: r.result }))),
    uniform: score(records.map((r) => ({ p: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, result: r.result }))),
    lowestOdds: records.some((r) => r.market)
      ? score(records.filter((r): r is typeof r & { market: Triple } => !!r.market).map((r) => ({ p: r.market, result: r.result })))
      : null,
  };
  const engine = score(rows.engine);
  const ai = score(rows.ai);
  const bl = score(rows.blend);
  const primary = score(rows.primary);
  const skill = (b: number) => (Number.isFinite(b) && baselines.frequency.brier > 0 ? 1 - b / baselines.frequency.brier : NaN);

  const agreeRows = records.filter((r) => top(r.engine) === top(r.ai)).map((r) => ({ p: r.final ?? blend(r.engine, r.ai), result: r.result }));
  const splitRows = records.filter((r) => top(r.engine) !== top(r.ai)).map((r) => ({ p: r.final ?? blend(r.engine, r.ai), result: r.result }));
  const agree = score(agreeRows);
  const disagree = score(splitRows);

  const buckets: [string, number, number][] = [
    ["Under 45%", 0, 0.45],
    ["45-55%", 0.45, 0.55],
    ["55-65%", 0.55, 0.65],
    ["65% and over", 0.65, 1.01],
  ];
  const confidence = buckets
    .map(([label, lo, hi]) => ({ label, card: score(rows.primary.filter((r) => r.p[top(r.p)] >= lo && r.p[top(r.p)] < hi)) }))
    .filter((b) => b.card.n > 0);

  let verdict: Verdict = "insufficient";
  let verdictText = `Only ${n} completed match${n === 1 ? "" : "es"} on record. At least ${MIN_SAMPLE} are needed before any accuracy claim means much.`;
  if (n >= MIN_SAMPLE) {
    const s = skill(primary.brier);
    verdict = s > 0 ? "beats-baseline" : "no-edge";
    verdictText =
      verdict === "beats-baseline"
        ? `Beats a base-rate guess on Brier score${s < 0.02 ? ", but only by a thin margin" : ""}. That is still not a guarantee on any single match.`
        : "Does not beat a simple base-rate guess yet. Do not treat these picks as an edge.";
  }

  return {
    n,
    engine,
    ai,
    blend: bl,
    primary,
    outcomes: {
      engine: outcomeBreakdown(rows.engine),
      ai: outcomeBreakdown(rows.ai),
      primary: outcomeBreakdown(rows.primary),
    },
    tiers: (["A", "B", "C", "PASS"] as const)
      .map((tier) => ({ tier, card: score(records.filter((r) => r.tier === tier).map((r) => ({ p: r.final ?? blend(r.engine, r.ai), result: r.result }))) }))
      .filter((t) => t.card.n > 0),
    baselines,
    skill: { engine: skill(engine.brier), ai: skill(ai.brier), blend: skill(bl.brier), primary: skill(primary.brier) },
    agreement: { agree, disagree, liftPoints: Number.isFinite(agree.hitRate) && Number.isFinite(disagree.hitRate) ? (agree.hitRate - disagree.hitRate) * 100 : NaN },
    confidence,
    calibration: calibrationBins(rows.primary),
    verdict,
    verdictText,
  };
}
