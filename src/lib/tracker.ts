import type { Triple } from "./engines.ts";
import { runBacktest, score, type BacktestReport, type Scorecard, MIN_SAMPLE } from "./backtest.ts";
import { sameTeam } from "./jackpot-utils.ts";
import { perLeagueAccuracy } from "./analysis.ts";

export type Side = keyof Triple;
export const SIDES: Side[] = ["home", "draw", "away"];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Bump when the forecasting logic changes so old and new versions can be scored separately. */
export const MODEL_VERSION = "2026-11-b-multisource";

/** One logged forecast. Everything before `result` is frozen at recording time. */
export type PredictionRow = {
  matchId: string;
  home: string;
  away: string;
  league: string;
  kickoffAt: string;
  recordedAt: string;
  modelVersion: string;
  inputHash: string;
  engine: Triple;
  ai: Triple;
  final: Triple;
  pick: Side;
  code: string;
  tier: "A" | "B" | "C" | "PASS";
  result: Side | null;
  homeGoals: number | null;
  awayGoals: number | null;
  settledAt: string | null;
  resultSource: string | null;
  /** Provider timestamps, freshness, and safe signal values frozen with this forecast. */
  sourceSnapshot?: Record<string, JsonValue>;
};

export type ModelPerformance = { id: string; name: string; n: number; hits: number; hitRate: number; brier: number; logLoss: number };

/** Scores only immutable per-model snapshots captured before kickoff. Older rows are excluded. */
export function modelPerformance(rows: PredictionRow[]): ModelPerformance[] {
  const grouped = new Map<string, { name: string; values: { p: Triple; result: Side }[] }>();
  for (const row of rows) {
    if (!row.result || !isPreMatch(row)) continue;
    const raw = row.sourceSnapshot?.advancedModels;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const value = item as { id?: unknown; name?: unknown; probabilities?: Partial<Triple> };
      const p = value.probabilities;
      if (!value.id || !p || ![p.home, p.draw, p.away].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
      const id = String(value.id);
      const bucket = grouped.get(id) ?? { name: String(value.name ?? id), values: [] };
      bucket.values.push({ p: { home: Number(p.home), draw: Number(p.draw), away: Number(p.away) }, result: row.result });
      grouped.set(id, bucket);
    }
  }
  return [...grouped.entries()].map(([id, bucket]) => {
    const n = bucket.values.length;
    const hits = bucket.values.filter((x) => argmaxTriple(x.p) === x.result).length;
    return {
      id, name: bucket.name, n, hits, hitRate: n ? hits / n : NaN,
      brier: n ? bucket.values.reduce((sum, x) => sum + SIDES.reduce((s, side) => s + (x.p[side] - (side === x.result ? 1 : 0)) ** 2, 0), 0) / n : NaN,
      logLoss: n ? -bucket.values.reduce((sum, x) => sum + Math.log(Math.max(x.p[x.result], 1e-9)), 0) / n : NaN,
    };
  }).sort((a, b) => (Number.isFinite(a.brier) ? a.brier : Infinity) - (Number.isFinite(b.brier) ? b.brier : Infinity));
}

function argmaxTriple(p: Triple): Side {
  return SIDES.reduce((best, side) => p[side] > p[best] ? side : best, "home" as Side);
}

const ms = (iso: string) => Date.parse(iso);

/* ---------- protection against post-match information ---------- */

/** A forecast may only be recorded while the kickoff is known and still in the future (server clock). */
export function canRecord(nowMs: number, kickoffMs: number | null): { ok: boolean; reason: string } {
  if (kickoffMs === null || !Number.isFinite(kickoffMs)) return { ok: false, reason: "no verified kickoff time" };
  if (nowMs >= kickoffMs) return { ok: false, reason: "kickoff already passed" };
  return { ok: true, reason: "" };
}

/** Counted only if it was recorded strictly before kickoff. */
export const isPreMatch = (r: Pick<PredictionRow, "recordedAt" | "kickoffAt">) => ms(r.recordedAt) < ms(r.kickoffAt);

export type FeedResult = { home: string; away: string; utcDate: string; homeGoals: number; awayGoals: number };

/** Matches a finished fixture from a results feed to a logged forecast: same teams in the same order, within 36 hours of kickoff. */
export function pairResult(row: PredictionRow, feed: FeedResult): Side | null {
  if (!sameTeam(row.home, feed.home) || !sameTeam(row.away, feed.away)) return null;
  const gap = Math.abs(ms(feed.utcDate) - ms(row.kickoffAt));
  if (!Number.isFinite(gap) || gap > 36 * 3600 * 1000) return null;
  if (!Number.isInteger(feed.homeGoals) || !Number.isInteger(feed.awayGoals) || feed.homeGoals < 0 || feed.awayGoals < 0) return null;
  return feed.homeGoals > feed.awayGoals ? "home" : feed.homeGoals < feed.awayGoals ? "away" : "draw";
}

/* ---------- classification ---------- */

export type Buckets = { pending: PredictionRow[]; settled: PredictionRow[]; excluded: PredictionRow[] };

export function bucket(rows: PredictionRow[]): Buckets {
  const out: Buckets = { pending: [], settled: [], excluded: [] };
  for (const r of rows) {
    if (!isPreMatch(r)) out.excluded.push(r);
    else if (r.result) out.settled.push(r);
    else out.pending.push(r);
  }
  out.settled.sort((a, b) => ms(a.kickoffAt) - ms(b.kickoffAt));
  out.pending.sort((a, b) => ms(a.kickoffAt) - ms(b.kickoffAt));
  return out;
}

const SYMBOL: Record<Side, string> = { home: "1", draw: "X", away: "2" };

/** Did the published tip (single or double chance) cover the real result? null when the tip was PASS. */
export const tipCovered = (r: PredictionRow): boolean | null => (r.code === "PASS" || !r.result ? null : r.code.includes(SYMBOL[r.result]));
/** Was the single most likely outcome right? */
export const topCorrect = (r: PredictionRow): boolean | null => (r.result ? r.pick === r.result : null);

export type OutcomeReport = {
  correct: PredictionRow[];
  incorrect: PredictionRow[];
  /** Wrong picks that the model backed with 60% or more. These are the ones that "looked confident". */
  confidentMisses: PredictionRow[];
  tipHits: number;
  tipsMade: number;
  passes: number;
};

export function outcomeReport(settled: PredictionRow[]): OutcomeReport {
  const correct = settled.filter((r) => topCorrect(r) === true);
  const incorrect = settled.filter((r) => topCorrect(r) === false);
  const tips = settled.map(tipCovered).filter((x): x is boolean => x !== null);
  return {
    correct,
    incorrect,
    confidentMisses: incorrect.filter((r) => r.final[r.pick] >= 0.6),
    tipHits: tips.filter(Boolean).length,
    tipsMade: tips.length,
    passes: settled.length - tips.length,
  };
}

/* ---------- trend: is it genuinely improving? ---------- */

const brierOf = (r: PredictionRow) => SIDES.reduce((s, k) => s + (r.final[k] - (r.result === k ? 1 : 0)) ** 2, 0);

export function rollingBrier(settled: PredictionRow[], window = 20): { upTo: number; brier: number }[] {
  const out: { upTo: number; brier: number }[] = [];
  for (let i = window; i <= settled.length; i++) {
    const slice = settled.slice(i - window, i);
    out.push({ upTo: i, brier: slice.reduce((s, r) => s + brierOf(r), 0) / window });
  }
  return out;
}

export type Trend = { verdict: "too-early" | "improving" | "flat" | "worsening"; early: number; late: number; text: string };

/** Compares the earlier half with the later half. Needs enough matches, and a real gap, before it says anything. */
export function trend(settled: PredictionRow[]): Trend {
  if (settled.length < MIN_SAMPLE) {
    return { verdict: "too-early", early: NaN, late: NaN, text: `Needs at least ${MIN_SAMPLE} settled matches before a trend means anything (have ${settled.length}).` };
  }
  const mid = Math.floor(settled.length / 2);
  const avg = (xs: PredictionRow[]) => xs.reduce((s, r) => s + brierOf(r), 0) / xs.length;
  const early = avg(settled.slice(0, mid));
  const late = avg(settled.slice(mid));
  const delta = early - late; // positive = Brier fell = better
  const verdict = delta > 0.015 ? "improving" : delta < -0.015 ? "worsening" : "flat";
  const text =
    verdict === "improving"
      ? `Brier fell from ${early.toFixed(3)} to ${late.toFixed(3)} between the earlier and later half. Small samples can still be luck.`
      : verdict === "worsening"
        ? `Brier rose from ${early.toFixed(3)} to ${late.toFixed(3)} between the earlier and later half.`
        : `No meaningful change between the earlier half (${early.toFixed(3)}) and later half (${late.toFixed(3)}).`;
  return { verdict, early, late, text };
}

/* ---------- the dashboard model ---------- */

export type Dashboard = {
  counts: { recorded: number; pending: number; settled: number; excluded: number };
  report: BacktestReport;
  outcomes: OutcomeReport;
  trend: Trend;
  rolling: { upTo: number; brier: number }[];
  byVersion: { version: string; card: Scorecard }[];
  byLeague: ReturnType<typeof perLeagueAccuracy>;
  buckets: Buckets;
  avgLeadHours: number;
};

export function buildDashboard(rows: PredictionRow[]): Dashboard {
  const b = bucket(rows);
  const report = runBacktest(b.settled.map((r) => ({ id: r.matchId, engine: r.engine, ai: r.ai, final: r.final, tier: r.tier, result: r.result as Side })));
  const versions = [...new Set(b.settled.map((r) => r.modelVersion))];
  const lead = rows.length ? rows.reduce((s, r) => s + (ms(r.kickoffAt) - ms(r.recordedAt)), 0) / rows.length / 3600000 : NaN;
  return {
    counts: { recorded: rows.length, pending: b.pending.length, settled: b.settled.length, excluded: b.excluded.length },
    report,
    outcomes: outcomeReport(b.settled),
    trend: trend(b.settled),
    rolling: rollingBrier(b.settled),
    byVersion: versions.map((v) => ({ version: v, card: score(b.settled.filter((r) => r.modelVersion === v).map((r) => ({ p: r.final, result: r.result as Side }))) })),
    byLeague: perLeagueAccuracy(b.settled.map((r) => ({ league: r.league, final: r.final, result: r.result as Side, recordedAt: r.recordedAt, kickoffAt: r.kickoffAt }))),
    buckets: b,
    avgLeadHours: lead,
  };
}

/* ---------- CSV backup ---------- */

const HEADER = [
  "match_id", "league", "home", "away", "kickoff_utc", "recorded_utc", "hours_before_kickoff", "status", "model_version", "input_hash",
  "engine_home", "engine_draw", "engine_away", "ai_home", "ai_draw", "ai_away", "final_home", "final_draw", "final_away",
  "pick", "tip_code", "tier", "result", "home_goals", "away_goals", "top_pick_correct", "tip_covered", "brier", "log_loss", "settled_utc", "result_source",
] as const;

/** Spreadsheet-safe cell: quotes escaped, and a leading = + - @ is neutralised so a team name cannot run as a formula. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  let t = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(rows: PredictionRow[]): string {
  const f = (x: number) => Number(x.toFixed(4));
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const status = !isPreMatch(r) ? "excluded_recorded_after_kickoff" : r.result ? "settled" : "pending";
    const settled = !!r.result;
    lines.push(
      [
        r.matchId, r.league, r.home, r.away, r.kickoffAt, r.recordedAt, Number(((ms(r.kickoffAt) - ms(r.recordedAt)) / 3600000).toFixed(2)), status,
        r.modelVersion, r.inputHash,
        f(r.engine.home), f(r.engine.draw), f(r.engine.away), f(r.ai.home), f(r.ai.draw), f(r.ai.away), f(r.final.home), f(r.final.draw), f(r.final.away),
        r.pick, r.code, r.tier, r.result, r.homeGoals, r.awayGoals,
        settled ? topCorrect(r) : null, settled ? tipCovered(r) : null,
        settled ? f(brierOf(r)) : null, settled ? f(-Math.log(Math.max(r.final[r.result!], 1e-9))) : null,
        r.settledAt, r.resultSource,
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
