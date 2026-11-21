import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLeagueDrawPrior,
  assessFreshness,
  closingLineComparison,
  fatigueFactor,
  fitTimeDecayedDixonColes,
  fittedDcProbabilities,
  multiSeasonElo,
  oddsMovement,
  perLeagueAccuracy,
  restDays,
  tableMotivation,
  venuePpg,
  venueSplitFactor,
  type HistoricalMatch,
} from "./analysis.ts";

describe("multi-source analysis helpers", () => {
  it("computes rest days and keeps unknown rest neutral", () => {
    assert.equal(restDays("2026-11-01T12:00:00Z", "2026-11-05T12:00:00Z"), 4);
    assert.equal(restDays(null, "2026-11-05T12:00:00Z"), null);
    assert.equal(fatigueFactor(null), 1);
    assert.ok(fatigueFactor(2, 4) < fatigueFactor(6, 1));
  });

  it("keeps venue-specific form split and shrinks small samples", () => {
    const matches: HistoricalMatch[] = [
      { homeId: "A", awayId: "B", homeGoals: 2, awayGoals: 0, kickoffAt: "2026-10-01T12:00:00Z" },
      { homeId: "A", awayId: "C", homeGoals: 1, awayGoals: 1, kickoffAt: "2026-10-02T12:00:00Z" },
      { homeId: "B", awayId: "A", homeGoals: 0, awayGoals: 1, kickoffAt: "2026-10-03T12:00:00Z" },
    ];
    assert.deepEqual(venuePpg(matches, "A", "home"), { games: 2, ppg: 2 });
    assert.equal(venueSplitFactor(1.5, 2, 2), 1);
    assert.ok(venueSplitFactor(1.5, 2, 8) > 1);
  });

  it("only labels table motivation when the schedule context is available", () => {
    assert.equal(tableMotivation(null, 20, 3).stakes, "unknown");
    assert.equal(tableMotivation(1, 20, 3).stakes, "title-race");
    assert.equal(tableMotivation(20, 20, 3).stakes, "relegation-risk");
  });

  it("requires real timestamps for freshness and reports missing required inputs as PASS", () => {
    const missing = assessFreshness([{ name: "team stats", observedAt: null, required: true }], Date.parse("2026-11-11T00:00:00Z"));
    assert.equal(missing.action, "pass");
    const fresh = assessFreshness([{ name: "team stats", observedAt: "2026-11-10T23:00:00Z", required: true, maxAgeHours: 24 }], Date.parse("2026-11-11T00:00:00Z"));
    assert.equal(fresh.action, "allow");
    const stale = assessFreshness([{ name: "team stats", observedAt: "2026-11-08T00:00:00Z", required: true, maxAgeHours: 24 }], Date.parse("2026-11-11T00:00:00Z"));
    assert.equal(stale.action, "pass");
  });

  it("shrinks league draw rates and caps their effect", () => {
    const base = { home: 0.5, draw: 0.25, away: 0.25 };
    const adjusted = applyLeagueDrawPrior(base, 60, 100, 0.26);
    assert.ok(adjusted.draw > base.draw);
    assert.ok(adjusted.draw - base.draw <= 0.0300001);
    assert.equal(applyLeagueDrawPrior(base, 10, 19).draw, base.draw);
  });

  it("calculates timestamped fair-odds movement and forecast-to-close comparison", () => {
    const move = oddsMovement({ home: 2.2, draw: 3.3, away: 3.4 }, { home: 2.0, draw: 3.4, away: 3.8 });
    assert.ok(move);
    assert.ok(move.home > 0);
    const comparison = closingLineComparison({ home: 0.5, draw: 0.25, away: 0.25 }, { home: 2.1, draw: 3.4, away: 3.8 });
    assert.equal(comparison?.pick, "home");
    assert.ok(comparison && Number.isFinite(comparison.probabilityGap));
    assert.equal(oddsMovement(null, { home: 2, draw: 3, away: 4 }), null);
  });

  it("regresses Elo between seasons and fits a time-decayed Dixon-Coles model on adequate data", () => {
    const matches: HistoricalMatch[] = [];
    const start = Date.parse("2023-01-01T00:00:00Z");
    for (let i = 0; i < 220; i++) {
      const home = `T${i % 10}`;
      const away = `T${(i * 7 + 1) % 10}`;
      matches.push({
        homeId: home,
        awayId: away,
        homeGoals: i % 5 === 0 ? 0 : i % 3 === 0 ? 2 : 1,
        awayGoals: i % 4 === 0 ? 1 : 0,
        kickoffAt: new Date(start + i * 86_400_000).toISOString(),
        season: i < 110 ? 2023 : 2024,
      });
    }
    const elo = multiSeasonElo(matches);
    assert.equal(elo.matches, matches.length);
    assert.deepEqual(elo.seasons, [2023, 2024]);
    assert.ok(elo.ratings.size === 10);
    const model = fitTimeDecayedDixonColes(matches, { nowMs: start + 300 * 86_400_000, iterations: 80 });
    assert.ok(model);
    const probabilities = fittedDcProbabilities(model!, "T0", "T1");
    assert.ok(Math.abs(probabilities.home + probabilities.draw + probabilities.away - 1) < 1e-9);
    assert.ok(model!.rho >= -0.4 && model!.rho <= 0.4);
    assert.equal(fitTimeDecayedDixonColes(matches.slice(0, 30)), null);
  });

  it("reports per-league scores only for pre-kickoff forecasts", () => {
    const rows = perLeagueAccuracy([
      { league: "Premier League", final: { home: 0.6, draw: 0.2, away: 0.2 }, result: "home", recordedAt: "2026-11-01T10:00:00Z", kickoffAt: "2026-11-01T12:00:00Z" },
      { league: "Premier League", final: { home: 0.7, draw: 0.2, away: 0.1 }, result: "away", recordedAt: "2026-11-01T13:00:00Z", kickoffAt: "2026-11-01T12:00:00Z" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].n, 1);
    assert.equal(rows[0].hitRate, 1);
  });
});
