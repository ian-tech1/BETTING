import { createServerFn } from "@tanstack/react-start";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { RECENT, actualSide, findAny } from "@/lib/price";
import { buildConsensus } from "@/lib/consensus";
import { buildAdvancedReport } from "@/lib/advanced-predictors";
import type { Signals } from "@/lib/signals";
import type { SourceRecord } from "@/lib/consensus";
import type { Triple } from "@/lib/engines";
import { runBacktest, type BacktestReport } from "@/lib/backtest";
import { normalizeTeamName } from "@/lib/jackpot-utils";

export type SignalReply = Signals & { used: string[] };

/** Extra signals for one fixture. Returns an empty set when no provider key is configured. */
export const getMatchSignals = createServerFn({ method: "GET" })
  .validator((id: string) => {
    if (typeof id !== "string" || id.length > 80 || !/^[a-z0-9-]+$/i.test(id)) throw new Error("Invalid fixture ID");
    return id;
  })
  .handler(async ({ data: id }): Promise<SignalReply> => {
    const match = findAny(id);
    if (!match) return { used: [] };
    const { buildSignals } = await import("@/lib/signals.server");
    const base = buildConsensus(match.home, match.away).probabilities;
    return buildSignals(match.home.name, match.away.name, base, {
      id: match.id,
      home: match.home.name,
      away: match.away.name,
      league: match.league,
      venue: match.venue,
      kickoffAt: KICKOFF_ISO[match.id] ?? null,
    });
  });

export const getProviderStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { env } = await import("@/lib/env.server");
  return {
    odds: !!env("ODDS_API_KEY"),
    apiFootball: !!env("API_FOOTBALL_KEY"),
    footballData: !!env("FOOTBALL_DATA_KEY"),
    ai: !!(env("GEMINI_API_KEY") || env("OPENAI_API_KEY") || env("GROK_API_KEY")),
    gemini: !!env("GEMINI_API_KEY"),
    openai: !!env("OPENAI_API_KEY"),
    grok: !!env("GROK_API_KEY"),
  };
});

/** Only prospective, settled forecast-log rows may train the live consensus. */
export const getPredictionLearningHistory = createServerFn({ method: "GET" }).handler(async (): Promise<SourceRecord[]> => {
  try {
    const { getSql, ensureDbReady } = await import("@/lib/db");
    const { MODEL_VERSION } = await import("@/lib/tracker");
    await ensureDbReady();
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      select engine_home, engine_draw, engine_away, ai_home, ai_draw, ai_away,
             final_home, final_draw, final_away, source_snapshot, league, result, recorded_at, kickoff_at
      from prediction_log
      where result is not null and recorded_at < kickoff_at and model_version = ${MODEL_VERSION}
      order by kickoff_at desc limit 100
    `;
    const asTriple = (r: Record<string, unknown>, prefix: string): Triple => ({
      home: Number(r[`${prefix}_home`]), draw: Number(r[`${prefix}_draw`]), away: Number(r[`${prefix}_away`]),
    });
    const asIso = (value: unknown) => new Date(value as string | Date).toISOString();
    return rows.reverse().map((r) => ({
      engine: asTriple(r, "engine"),
      ai: asTriple(r, "ai"),
      final: asTriple(r, "final"),
      result: r.result as SourceRecord["result"],
      league: String(r.league),
      recordedAt: asIso(r.recorded_at),
      kickoffAt: asIso(r.kickoff_at),
      models: (() => {
        try {
          const snapshot = typeof r.source_snapshot === "string" ? JSON.parse(r.source_snapshot) : r.source_snapshot;
          const entries = Array.isArray(snapshot?.advancedModels) ? snapshot.advancedModels : [];
          return Object.fromEntries(entries.filter((m: any) => m?.id && m?.probabilities).map((m: any) => [m.id, m.probabilities]));
        } catch {
          return {};
        }
      })(),
    }));
  } catch {
    return [];
  }
});

export type ResultLedgerRow = {
  id: string;
  home: string;
  away: string;
  league: string;
  kickoffAt: string;
  recordedAt: string;
  pick: "home" | "draw" | "away";
  probabilities: Triple;
  result: "home" | "draw" | "away";
  homeGoals: number | null;
  awayGoals: number | null;
  resultSource: string | null;
  jackpot: boolean;
  predictionRecorded: boolean;
  modelResults?: { name: string; pick: "home" | "draw" | "away"; correct: boolean }[];
};

function modelResultsFromSnapshot(snapshot: Record<string, unknown>, result: "home" | "draw" | "away") {
  const models = Array.isArray(snapshot.advancedModels) ? snapshot.advancedModels : [];
  return models.flatMap((model: any) => {
    const probabilities = model?.probabilities;
    if (!probabilities || typeof model?.name !== "string") return [];
    const pick = (["home", "draw", "away"] as const).reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home" as "home" | "draw" | "away");
    return [{ name: model.name, pick, correct: pick === result }];
  });
}

type RecentProviderResult = { id: string; home: string; away: string; league: string; kickoffAt: string; homeGoals: number; awayGoals: number; source: string };

async function loadApiFootballResults(from: Date, to: Date): Promise<RecentProviderResult[]> {
  const { env } = await import("@/lib/env.server");
  const key = env("API_FOOTBALL_KEY");
  if (!key) return [];
  const dates: string[] = [];
  for (let cursor = new Date(to); cursor >= from; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  const results: RecentProviderResult[] = [];
  await Promise.all(dates.map(async (date) => {
    try {
      const query = new URLSearchParams({ date, status: "FT" });
      const response = await fetch(`https://v3.football.api-sports.io/fixtures?${query}`, {
        headers: { "x-apisports-key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) return;
      const body = await response.json() as { response?: any[]; errors?: unknown };
      for (const fixture of body.response ?? []) {
        const homeGoals = fixture.goals?.home;
        const awayGoals = fixture.goals?.away;
        const home = fixture.teams?.home?.name;
        const away = fixture.teams?.away?.name;
        const kickoffAt = fixture.fixture?.date;
        if (!fixture.fixture?.id || !home || !away || !kickoffAt || typeof homeGoals !== "number" || typeof awayGoals !== "number") continue;
        results.push({
          id: `api-football-${fixture.fixture.id}`,
          home,
          away,
          league: fixture.league?.name ?? "Football",
          kickoffAt: new Date(kickoffAt).toISOString(),
          homeGoals,
          awayGoals,
          source: "API-Football verified",
        });
      }
    } catch { /* preserve rows from the other verified sources */ }
  }));
  return results;
}

async function loadEspnResults(from: Date, to: Date): Promise<RecentProviderResult[]> {
  const leagues = [
    ["eng.1", "EPL", "Premier League"], ["esp.1", "LAL", "La Liga"],
    ["ger.1", "BUN", "Bundesliga"], ["ita.1", "SEA", "Serie A"],
    ["fra.1", "FRA", "Ligue 1"], ["ned.1", "ERE", "Eredivisie"],
  ] as const;
  const dateRange = `${from.toISOString().slice(0, 10).replaceAll("-", "")}-${to.toISOString().slice(0, 10).replaceAll("-", "")}`;
  const results: RecentProviderResult[] = [];
  await Promise.all(leagues.map(async ([leagueCode, code, league]) => {
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard?dates=${dateRange}&limit=500`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return;
      const body = await response.json() as { events?: any[] };
      for (const event of body.events ?? []) {
        const competition = event.competitions?.[0];
        const status = competition?.status?.type;
        const home = competition?.competitors?.find((team: any) => team.homeAway === "home");
        const away = competition?.competitors?.find((team: any) => team.homeAway === "away");
        const kickoffAt = event.date;
        const homeGoals = Number(home?.score), awayGoals = Number(away?.score);
        if (!kickoffAt || !home?.team?.displayName || !away?.team?.displayName || !status?.completed || !Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) continue;
        results.push({ id: `espn-${leagueCode}-${event.id}`, home: home.team.displayName, away: away.team.displayName, league, kickoffAt: new Date(kickoffAt).toISOString(), homeGoals, awayGoals, source: `ESPN verified · ${code}` });
      }
    } catch { /* other verified result sources remain usable */ }
  }));
  return results;
}

async function loadRecentProviderResults(): Promise<RecentProviderResult[]> {
  const { env } = await import("@/lib/env.server");
  const key = env("FOOTBALL_DATA_KEY");
  const footballDataKey = key ?? "";
  const competitions = ["PL", "ELC", "BL1", "PD", "FL1", "SA", "DED", "PPL"];
  const to = new Date();
  // Results is a historical ledger, not an upcoming-fixture window. Keep a wide
  // rolling range so yesterday and earlier dates remain selectable after a missed sync.
  const from = new Date(Date.now() - 90 * 86400000);
  const apiFrom = new Date(Math.max(from.getTime(), to.getTime() - 14 * 86400000));
  const results: RecentProviderResult[] = await loadApiFootballResults(apiFrom, to);
  let cursor = 0;
  const worker = async () => {
    while (cursor < competitions.length) {
      const competition = competitions[cursor++];
      try {
        const query = new URLSearchParams({ status: "FINISHED", dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10), limit: "500" });
        const response = await fetch(`https://api.football-data.org/v4/competitions/${competition}/matches?${query}`, { headers: { "X-Auth-Token": footballDataKey, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
        if (!response.ok) continue;
        const body = await response.json() as { matches?: any[] };
        for (const match of body.matches ?? []) {
          const homeGoals = match.score?.fullTime?.home, awayGoals = match.score?.fullTime?.away;
          if (typeof homeGoals !== "number" || typeof awayGoals !== "number" || !match.homeTeam?.name || !match.awayTeam?.name || !match.utcDate) continue;
          results.push({ id: `provider-${competition}-${match.id}`, home: match.homeTeam.name, away: match.awayTeam.name, league: match.competition?.name ?? competition, kickoffAt: new Date(match.utcDate).toISOString(), homeGoals, awayGoals, source: "football-data.org" });
        }
      } catch { /* Results page reports the available ledger even if one competition is unavailable. */ }
    }
  };
  if (key) await Promise.all(Array.from({ length: 4 }, () => worker()));
  // The live feeds can be empty for future-season dates or temporarily unavailable.
  // OpenFootball supplies published completed scores without inventing a result.
  const files = [
    ["en.1", "EPL", "English Premier League"], ["en.2", "CHP", "English Championship"],
    ["de.1", "BUN", "German Bundesliga"], ["es.1", "LAL", "Spanish La Liga"],
    ["fr.1", "FRA", "French Ligue 1"], ["it.1", "SEA", "Italian Serie A"],
    ["nl.1", "ERE", "Dutch Eredivisie"], ["pt.1", "POR", "Portuguese Primeira Liga"],
  ] as const;
  const year = to.getUTCFullYear();
  const start = to.getUTCMonth() >= 6 ? year : year - 1;
  const seasons = [`${start}-${String(start + 1).slice(-2)}`, `${start - 1}-${String(start).slice(-2)}`];
  await Promise.all(seasons.flatMap((season) => files.map(async ([file, code, league]) => {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${file}.json`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
      if (!response.ok) return;
      const body = await response.json() as { matches?: Array<{ date?: string; team1?: string; team2?: string; score?: { ft?: [number, number] } }> };
      for (const match of body.matches ?? []) {
        const score = match.score?.ft;
        if (!match.date || !match.team1 || !match.team2 || !score || match.date < from.toISOString().slice(0, 10) || match.date > to.toISOString().slice(0, 10)) continue;
        results.push({ id: `openfootball-${season}-${file}-${match.date}-${normalizeTeamName(match.team1)}-${normalizeTeamName(match.team2)}`, home: match.team1, away: match.team2, league, kickoffAt: `${match.date}T12:00:00.000Z`, homeGoals: score[0], awayGoals: score[1], source: `OpenFootball · ${code}` });
      }
    } catch { /* the other verified sources remain usable */ }
  })));
  results.push(...await loadEspnResults(from, to));
  return results;
}

/** Verified completed prediction records for the Results ledger. */
export const getResultLedger = createServerFn({ method: "GET" }).handler(async (): Promise<ResultLedgerRow[]> => {
  try {
    const { recordUpcoming, settlePending, loadPredictions } = await import("@/lib/tracker.server");
    await recordUpcoming().catch(() => undefined);
    await settlePending();
    const rows = await loadPredictions();
    const settled = rows
      .filter((row) => row.result && Date.parse(row.kickoffAt) < Date.now())
      .map((row) => ({
        id: row.matchId,
        home: row.home,
        away: row.away,
        league: row.league,
        kickoffAt: row.kickoffAt,
        recordedAt: row.recordedAt,
        pick: row.pick,
        probabilities: row.final,
        result: row.result!,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        resultSource: row.resultSource,
        jackpot: /jackpot|betika/i.test(`${row.matchId} ${row.league}`),
        predictionRecorded: true,
        modelResults: modelResultsFromSnapshot(row.sourceSnapshot ?? {}, row.result!),
      }))
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
    const seen = new Set(settled.flatMap((row) => [row.id, `${normalizeTeamName(row.home)}:${normalizeTeamName(row.away)}:${row.kickoffAt.slice(0, 10)}`]));
    const providerResults = await loadRecentProviderResults();
    for (const result of providerResults) {
      const key = `${normalizeTeamName(result.home)}:${normalizeTeamName(result.away)}:${result.kickoffAt.slice(0, 10)}`;
      if (seen.has(result.id) || seen.has(key)) continue;
      const matchResult = result.homeGoals === result.awayGoals ? "draw" : result.homeGoals > result.awayGoals ? "home" : "away";
      const reconstructed = buildConsensus(
        { name: result.home, short: result.home, pos: 0, form: [], xgFor: 1.35, xgAgainst: 1.35, gf: 0, ga: 0, played: 0, out: [] },
        { name: result.away, short: result.away, pos: 0, form: [], xgFor: 1.35, xgAgainst: 1.35, gf: 0, ga: 0, played: 0, out: [] },
        { league: result.league },
      );
      const advanced = buildAdvancedReport(
        { name: result.home, short: result.home, pos: 0, form: [], xgFor: 1.35, xgAgainst: 1.35, gf: 0, ga: 0, played: 0, out: [] },
        { name: result.away, short: result.away, pos: 0, form: [], xgFor: 1.35, xgAgainst: 1.35, gf: 0, ga: 0, played: 0, out: [] },
      );
      settled.push({ id: result.id, home: result.home, away: result.away, league: result.league, kickoffAt: result.kickoffAt, recordedAt: result.kickoffAt, pick: reconstructed.pick, probabilities: reconstructed.probabilities, result: matchResult, homeGoals: result.homeGoals, awayGoals: result.awayGoals, resultSource: `${result.source} · score backfill`, jackpot: /jackpot|betika/i.test(`${result.id} ${result.league}`), predictionRecorded: false, modelResults: advanced.models.map((model) => { const pick = (["home", "draw", "away"] as const).reduce((best, side) => model.probabilities[side] > model.probabilities[best] ? side : best, "home" as "home" | "draw" | "away"); return { name: model.name, pick, correct: pick === matchResult }; }) });
      seen.add(result.id); seen.add(key);
    }
    return settled.sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
  } catch {
    return [];
  }
});

/**
 * Records every finished match on the server. The server computes both predictions itself from
 * bundled data, so a client cannot forge a result. Idempotent: a match is stored once.
 */
export const settleKnownResults = createServerFn({ method: "POST" }).handler(async (): Promise<SourceRecord[]> => {
  const { getSql, ensureDbReady, checkDatabaseHealth } = await import("@/lib/db");
  if (!(await checkDatabaseHealth()).connected) return [];
  await ensureDbReady();
  const sql = await getSql();
  for (const m of RECENT) {
    const c = buildConsensus(m.home, m.away);
    await sql`insert into settled_results (match_id, engine_home, engine_draw, engine_away, ai_home, ai_draw, ai_away, result)
      values (${m.id}, ${c.engineProbs.home}, ${c.engineProbs.draw}, ${c.engineProbs.away}, ${c.aiProbs.home}, ${c.aiProbs.draw}, ${c.aiProbs.away}, ${actualSide(m)})
      on conflict (match_id) do nothing`;
  }
  const rows = await sql<Record<string, number | string>>`select * from settled_results order by settled_at desc limit 100`;
  return rows.reverse().map((r) => ({
    engine: { home: Number(r.engine_home), draw: Number(r.engine_draw), away: Number(r.engine_away) },
    ai: { home: Number(r.ai_home), draw: Number(r.ai_draw), away: Number(r.ai_away) },
    result: r.result as SourceRecord["result"],
  }));
});


/**
 * Historical backtest: scores every settled match on record against its real final result.
 * Reads the whole settled_results table (not just the latest 100) so the sample grows as matches finish.
 */
export const getBacktest = createServerFn({ method: "GET" }).handler(async (): Promise<BacktestReport> => {
  const { getSql, ensureDbReady, checkDatabaseHealth } = await import("@/lib/db");
  if (!(await checkDatabaseHealth()).connected) return runBacktest([]);
  await ensureDbReady();
  const sql = await getSql();
  for (const m of RECENT) {
    const c = buildConsensus(m.home, m.away);
    await sql`insert into settled_results (match_id, engine_home, engine_draw, engine_away, ai_home, ai_draw, ai_away, result)
      values (${m.id}, ${c.engineProbs.home}, ${c.engineProbs.draw}, ${c.engineProbs.away}, ${c.aiProbs.home}, ${c.aiProbs.draw}, ${c.aiProbs.away}, ${actualSide(m)})
      on conflict (match_id) do nothing`;
  }
  const rows = await sql<Record<string, unknown>>`
    select s.*, p.source_snapshot
    from settled_results s
    left join prediction_log p on p.match_id = s.match_id
    order by s.settled_at asc
  `;
  return runBacktest(
    rows.map((r) => {
      let snapshot: Record<string, unknown> = {};
      try {
        const raw = typeof r.source_snapshot === "string" ? JSON.parse(r.source_snapshot) : r.source_snapshot;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) snapshot = raw as Record<string, unknown>;
      } catch { /* malformed snapshots do not become market evidence */ }
      const rawMarket = snapshot.market;
      const market = rawMarket && typeof rawMarket === "object" && !Array.isArray(rawMarket)
        ? rawMarket as Partial<Triple>
        : null;
      const verifiedMarket = market && [market.home, market.draw, market.away].every((value) => typeof value === "number" && Number.isFinite(value))
        ? { home: Number(market.home), draw: Number(market.draw), away: Number(market.away) }
        : undefined;
      return {
        id: String(r.match_id),
        engine: { home: Number(r.engine_home), draw: Number(r.engine_draw), away: Number(r.engine_away) },
        ai: { home: Number(r.ai_home), draw: Number(r.ai_draw), away: Number(r.ai_away) },
        market: verifiedMarket,
        result: r.result as "home" | "draw" | "away",
      };
    }),
  );
});
