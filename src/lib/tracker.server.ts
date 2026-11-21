import { createHash } from "node:crypto";
import { env } from "./env.server";
import { getSql, ensureDbReady } from "./db";
import { MATCHES, kickoffMs, type PricedMatch } from "./price";
import { buildConsensus } from "./consensus";
import { buildAdvancedReport } from "./advanced-predictors";
import { canRecord, pairResult, MODEL_VERSION, type FeedResult, type JsonValue, type PredictionRow, type Side } from "./tracker";
import { closingLineComparison, oddsMovement } from "./analysis";
import type { Triple } from "./engines";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { buildSignals } from "./signals.server";
import type { Signals } from "./signals";

/** Server-only. Records forecasts before kickoff, then fills in results from a real results feed. */

const num = (v: unknown) => Number(v);
const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string | number | Date).toISOString());

function toRow(r: Record<string, unknown>): PredictionRow {
  return {
    matchId: String(r.match_id),
    home: String(r.home),
    away: String(r.away),
    league: String(r.league),
    kickoffAt: iso(r.kickoff_at)!,
    recordedAt: iso(r.recorded_at)!,
    modelVersion: String(r.model_version),
    inputHash: String(r.input_hash),
    engine: { home: num(r.engine_home), draw: num(r.engine_draw), away: num(r.engine_away) },
    ai: { home: num(r.ai_home), draw: num(r.ai_draw), away: num(r.ai_away) },
    final: { home: num(r.final_home), draw: num(r.final_draw), away: num(r.final_away) },
    pick: r.pick as Side,
    code: String(r.code),
    tier: r.tier as PredictionRow["tier"],
    result: (r.result as Side | null) ?? null,
    homeGoals: r.home_goals === null || r.home_goals === undefined ? null : num(r.home_goals),
    awayGoals: r.away_goals === null || r.away_goals === undefined ? null : num(r.away_goals),
    settledAt: iso(r.settled_at),
    resultSource: (r.result_source as string | null) ?? null,
    sourceSnapshot: r.source_snapshot && typeof r.source_snapshot === "object" ? r.source_snapshot as Record<string, JsonValue> : {},
  };
}

export async function loadPredictions(): Promise<PredictionRow[]> {
  await ensureDbReady();
  const sql = await getSql();
  const rows = await sql<Record<string, unknown>>`select * from prediction_log order by kickoff_at asc`;
  return rows.map(toRow);
}

export type MarketBenchmark = {
  matchId: string;
  snapshots: number;
  bookmakers: number;
  openingObservedAt: string | null;
  latestObservedAt: string | null;
  movement: Triple | null;
  closeObservedAt: string | null;
  closeBooks: number;
  closeProbabilityGap: number | null;
  closeFairOddsGapPct: number | null;
};

/**
 * The database holds timestamped, app-observed odds only. A close proxy is emitted
 * only when a source quote was updated within three hours of kickoff; it is not
 * an official bookmaker close or the user's taken-price CLV.
 */
export async function loadMarketBenchmarks(predictions: PredictionRow[]): Promise<MarketBenchmark[]> {
  if (!predictions.length) return [];
  const ids = [...new Set(predictions.map((row) => row.matchId))];
  const slots = ids.map((_, i) => `$${i + 1}`).join(",");
  const sql = await getSql();
  const observations = await sql.query<Record<string, unknown>>(
    `select match_id, bookmaker_key, captured_at, provider_updated_at, kickoff_at, home_odds, draw_odds, away_odds
     from odds_observations where provider = 'the-odds-api' and match_id in (${slots}) order by match_id, bookmaker_key, captured_at asc`,
    ids,
  );
  const byMatch = new Map<string, Record<string, unknown>[]>();
  for (const row of observations) byMatch.set(String(row.match_id), [...(byMatch.get(String(row.match_id)) ?? []), row]);
  const asDate = (value: unknown) => value ? new Date(value as string | number | Date).toISOString() : null;
  const quote = (row: Record<string, unknown>): Triple => ({ home: Number(row.home_odds), draw: Number(row.draw_odds), away: Number(row.away_odds) });
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return predictions.map((prediction) => {
    const rows = byMatch.get(prediction.matchId) ?? [];
    const books = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) books.set(String(row.bookmaker_key), [...(books.get(String(row.bookmaker_key)) ?? []), row]);
    const movements: Triple[] = [];
    const closeComparisons: { gap: number; oddsGap: number; at: string }[] = [];
    let openingObservedAt: string | null = null;
    let latestObservedAt: string | null = null;
    for (const bookRows of books.values()) {
      if (!bookRows.length) continue;
      openingObservedAt ??= asDate(bookRows[0].captured_at);
      latestObservedAt = asDate(bookRows[bookRows.length - 1].captured_at);
      if (bookRows.length > 1) {
        const first = bookRows[0], last = bookRows[bookRows.length - 1];
        const firstUpdate = String(first.provider_updated_at ?? ""), lastUpdate = String(last.provider_updated_at ?? "");
        if (firstUpdate && lastUpdate && firstUpdate !== lastUpdate) {
          const shift = oddsMovement(quote(first), quote(last));
          if (shift) movements.push(shift);
        }
      }
      const kickoff = Date.parse(prediction.kickoffAt);
      const eligible = bookRows.filter((row) => {
        const captured = Date.parse(String(row.captured_at));
        const updated = Date.parse(String(row.provider_updated_at ?? ""));
        return Number.isFinite(kickoff) && Number.isFinite(captured) && Number.isFinite(updated) && captured < kickoff && updated < kickoff && kickoff - updated <= 3 * 60 * 60_000;
      });
      const candidate = eligible.at(-1);
      if (candidate) {
        const comparison = closingLineComparison(prediction.final, quote(candidate));
        if (comparison) closeComparisons.push({ gap: comparison.probabilityGap, oddsGap: comparison.fairOddsGapPct, at: asDate(candidate.provider_updated_at) ?? asDate(candidate.captured_at)! });
      }
    }
    const movement = movements.length ? {
      home: median(movements.map((m) => m.home))!,
      draw: median(movements.map((m) => m.draw))!,
      away: median(movements.map((m) => m.away))!,
    } : null;
    const closeProbabilityGap = median(closeComparisons.map((x) => x.gap));
    const closeFairOddsGapPct = median(closeComparisons.map((x) => x.oddsGap));
    const closeObservedAt = closeComparisons.map((x) => x.at).sort().at(-1) ?? null;
    return {
      matchId: prediction.matchId,
      snapshots: rows.length,
      bookmakers: books.size,
      openingObservedAt,
      latestObservedAt,
      movement,
      closeObservedAt,
      closeBooks: closeComparisons.length,
      closeProbabilityGap,
      closeFairOddsGapPct,
    };
  });
}

export type RecordSummary = { recorded: number; alreadyLogged: number; skipped: { noKickoff: number; passed: number } };

/**
 * Freezes a server-computed forecast with its safe feature/freshness snapshot. A client cannot supply probabilities or
 * a timestamp; `on conflict do nothing` means neither the forecast nor its source snapshot is ever rewritten.
 */
export async function recordUpcoming(nowMs = Date.now()): Promise<RecordSummary> {
  await ensureDbReady();
  const sql = await getSql();
  const out: RecordSummary = { recorded: 0, alreadyLogged: 0, skipped: { noKickoff: 0, passed: 0 } };
  const previous = await loadPredictions();
  const existing = new Set(previous.map((row) => row.matchId));
  const history = previous.filter((r): r is PredictionRow & { result: Side } => !!r.result && Date.parse(r.recordedAt) < Date.parse(r.kickoffAt)).map((r) => ({
    engine: r.engine, ai: r.ai, final: r.final, result: r.result, league: r.league, recordedAt: r.recordedAt, kickoffAt: r.kickoffAt,
  }));
  const candidates: { match: PricedMatch; kickoffAt: string }[] = [];
  for (const m of MATCHES) {
    const k = kickoffMs(m.id);
    if (k !== null && k > nowMs) candidates.push({ match: m, kickoffAt: new Date(k).toISOString() });
  }
  try {
    const { fixtureAsPricedMatch, getExpandedFixtures } = await import("./global-fixtures");
    const feed = await getExpandedFixtures();
    for (const fixture of feed.fixtures) {
      const fixtureTime = fixture.kickoffAt ? Date.parse(fixture.kickoffAt) : Number.NaN;
      if (!Number.isFinite(fixtureTime) || fixtureTime <= nowMs) continue;
      const match = fixtureAsPricedMatch(fixture);
      if (!existing.has(match.id) && !candidates.some((candidate) => candidate.match.id === match.id)) {
        candidates.push({ match, kickoffAt: new Date(fixtureTime).toISOString() });
      }
    }
  } catch { /* live fixture discovery is additive; static forecasts remain available */ }

  for (const { match: m, kickoffAt } of candidates) {
    const k = Date.parse(kickoffAt);
    const gate = canRecord(nowMs, k);
    if (!gate.ok) {
      if (k === null) out.skipped.noKickoff++;
      else out.skipped.passed++;
      continue;
    }
    if (existing.has(m.id)) { out.alreadyLogged++; continue; }
    const initial = buildConsensus(m.home, m.away, { history, league: m.league });
    let signals: Signals & { used: string[] } = {
      used: [],
      notes: ["Live signal request failed; freshness gate applies."],
      freshness: { status: "missing", action: "pass", ageHours: null, reasons: ["No timestamped required team-data source is available."] },
    };
    try {
      signals = await buildSignals(m.home.name, m.away.name, initial.probabilities, {
        id: m.id, home: m.home.name, away: m.away.name, league: m.league, venue: m.venue, kickoffAt: KICKOFF_ISO[m.id] ?? kickoffAt,
      });
    } catch { /* a failed source leaves the explicit missing-data PASS in place */ }
    const c = buildConsensus(m.home, m.away, { history, league: m.league, signals });
    const advanced = buildAdvancedReport(m.home, m.away);
    const sourceSnapshot = {
      observedAt: new Date(nowMs).toISOString(),
      used: signals.used,
      freshness: signals.freshness ?? null,
      featureStatus: signals.featureStatus ?? [],
      rest: signals.rest ?? null,
      venueSplit: signals.venueSplit ?? null,
      motivation: signals.motivation ?? null,
      lineups: signals.lineups ?? null,
      weather: signals.weather ?? null,
      oddsMovement: signals.oddsMovement ?? null,
      market: signals.market ?? null,
      advancedModels: advanced.models.map((model) => ({
        id: model.id,
        name: model.name,
        probabilities: model.probabilities,
      })),
      advancedEnsemble: advanced.ensemble,
      advancedAgreement: advanced.agreementRate,
      advancedRiskFlags: advanced.riskFlags,
    };
    const hash = createHash("sha256").update(JSON.stringify({ v: MODEL_VERSION, home: m.home, away: m.away, sourceSnapshot })).digest("hex").slice(0, 16);
    const inserted = await sql<{ match_id: string }>`insert into prediction_log
      (match_id, home, away, league, kickoff_at, model_version, input_hash, source_snapshot,
       engine_home, engine_draw, engine_away, ai_home, ai_draw, ai_away, final_home, final_draw, final_away, pick, code, tier)
      values (${m.id}, ${m.home.name}, ${m.away.name}, ${m.league}, ${kickoffAt}, ${MODEL_VERSION}, ${hash}, ${JSON.stringify(sourceSnapshot)},
       ${c.engineProbs.home}, ${c.engineProbs.draw}, ${c.engineProbs.away}, ${c.aiProbs.home}, ${c.aiProbs.draw}, ${c.aiProbs.away},
       ${c.probabilities.home}, ${c.probabilities.draw}, ${c.probabilities.away}, ${c.pick}, ${c.code}, ${c.tier})
      on conflict (match_id) do nothing returning match_id`;
    if (inserted.length) out.recorded++;
    else out.alreadyLogged++;
  }
  return out;
}

const COMPETITIONS = ["PL", "ELC", "BL1", "PD", "FL1", "SA", "DED", "PPL"];
const WINDOW_MS = 9 * 86400000;
const MIN_GAP_MS = 5 * 60 * 1000;
let lastSettleAt = 0;

async function finishedBetween(key: string, comp: string, from: number, to: number): Promise<FeedResult[]> {
  const q = new URLSearchParams({ status: "FINISHED", dateFrom: new Date(from).toISOString().slice(0, 10), dateTo: new Date(to).toISOString().slice(0, 10) });
  const res = await fetch(`https://api.football-data.org/v4/competitions/${comp}/matches?${q}`, { headers: { "X-Auth-Token": key }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`football-data ${comp} ${res.status}`);
  const j = await res.json();
  const out: FeedResult[] = [];
  for (const m of j.matches ?? []) {
    // 1X2 is a 90-minute market. If a match went to extra time, only use the regular-time score, else skip it.
    const s = m.score ?? {};
    const t = s.duration && s.duration !== "REGULAR" ? s.regularTime : s.fullTime;
    if (typeof t?.home === "number" && typeof t?.away === "number") out.push({ home: m.homeTeam?.name ?? "", away: m.awayTeam?.name ?? "", utcDate: m.utcDate, homeGoals: t.home, awayGoals: t.away });
  }
  return out;
}

export type SettleSummary = { settled: number; waiting: number; note: string };

/** Fills in results for logged forecasts whose match should be over. Only touches rows that still have no result. */
export async function settlePending(nowMs = Date.now()): Promise<SettleSummary> {
  await ensureDbReady();
  const sql = await getSql();
  const due = (await loadPredictions()).filter((r) => !r.result && Date.parse(r.kickoffAt) + 2 * 3600000 < nowMs);
  if (!due.length) return { settled: 0, waiting: 0, note: "No logged match is waiting for a result." };
  const key = env("FOOTBALL_DATA_KEY");
  if (!key) return { settled: 0, waiting: due.length, note: "Set FOOTBALL_DATA_KEY so finished results can be fetched and these matches settled." };
  if (nowMs - lastSettleAt < MIN_GAP_MS) return { settled: 0, waiting: due.length, note: "Results were checked a moment ago; checking again shortly." };
  lastSettleAt = nowMs;

  const from = Math.min(...due.map((r) => Date.parse(r.kickoffAt))) - 86400000;
  const to = Math.min(nowMs, Math.max(...due.map((r) => Date.parse(r.kickoffAt))) + 2 * 86400000);
  const feed: FeedResult[] = [];
  let calls = 0;
  for (const comp of COMPETITIONS) {
    for (let a = from; a < to && calls < 24; a += WINDOW_MS) {
      calls++;
      try {
        feed.push(...(await finishedBetween(key, comp, a, Math.min(a + WINDOW_MS - 86400000, to))));
      } catch { /* rate limit or outage: those matches stay pending and are retried next time */ }
    }
  }
  let settled = 0;
  for (const row of due) {
    for (const f of feed) {
      const side = pairResult(row, f);
      if (!side) continue;
      const done = await sql<{ match_id: string }>`update prediction_log
        set result = ${side}, home_goals = ${f.homeGoals}, away_goals = ${f.awayGoals}, settled_at = now(), result_source = 'football-data.org'
        where match_id = ${row.matchId} and result is null returning match_id`;
      if (done.length) settled++;
      break;
    }
  }
  return { settled, waiting: due.length - settled, note: settled ? `${settled} match${settled === 1 ? "" : "es"} settled from football-data.org.` : "No matching finished results found yet." };
}
