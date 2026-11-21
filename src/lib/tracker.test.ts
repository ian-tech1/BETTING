import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canRecord, isPreMatch, pairResult, bucket, outcomeReport, trend, toCsv, csvCell, buildDashboard, tipCovered, type PredictionRow } from "./tracker.ts";

const T = (home: number, draw: number, away: number) => ({ home, draw, away });
const H = 3600 * 1000;
const base = Date.parse("2026-11-20T15:00:00Z");

function row(i: number, o: Partial<PredictionRow> = {}): PredictionRow {
  const kickoff = new Date(base + i * 86400000).toISOString();
  return {
    matchId: `m${i}`, home: "Arsenal", away: "Hull City", league: "EPL",
    kickoffAt: kickoff, recordedAt: new Date(Date.parse(kickoff) - 20 * H).toISOString(),
    modelVersion: "v1", inputHash: "abc", engine: T(0.6, 0.25, 0.15), ai: T(0.55, 0.25, 0.2), final: T(0.58, 0.25, 0.17),
    pick: "home", code: "1", tier: "B", result: null, homeGoals: null, awayGoals: null, settledAt: null, resultSource: null, ...o,
  };
}
const settle = (r: PredictionRow, res: "home" | "draw" | "away"): PredictionRow => ({ ...r, result: res, homeGoals: 1, awayGoals: 0, settledAt: new Date(Date.parse(r.kickoffAt) + 3 * H).toISOString(), resultSource: "test" });

describe("post-match protection", () => {
  it("refuses to record at or after kickoff or without a kickoff time", () => {
    assert.equal(canRecord(base - 1, base).ok, true);
    assert.equal(canRecord(base, base).ok, false);
    assert.equal(canRecord(base + H, base).ok, false);
    assert.equal(canRecord(base, null).ok, false);
  });
  it("excludes rows recorded after kickoff from every metric", () => {
    const late = row(1, { recordedAt: new Date(base + 86400000 + H).toISOString() });
    const ok = settle(row(2), "home");
    const d = buildDashboard([settle(late, "home"), ok]);
    assert.equal(isPreMatch(late), false);
    assert.equal(d.counts.excluded, 1);
    assert.equal(d.counts.settled, 1);
    assert.equal(d.report.n, 1);
  });
});

describe("result pairing", () => {
  const r = row(0);
  const feed = { home: "Arsenal FC", away: "Hull City", utcDate: "2026-11-20T15:00:00Z", homeGoals: 2, awayGoals: 1 };
  it("pairs the same fixture and rejects other teams, swapped order and far-off dates", () => {
    assert.equal(pairResult(r, feed), "home");
    assert.equal(pairResult(r, { ...feed, home: "Hull City", away: "Arsenal" }), null);
    assert.equal(pairResult(r, { ...feed, away: "Leeds" }), null);
    assert.equal(pairResult(r, { ...feed, utcDate: "2026-12-20T15:00:00Z" }), null);
    assert.equal(pairResult(r, { ...feed, homeGoals: 1, awayGoals: 1 }), "draw");
    assert.equal(pairResult(r, { ...feed, homeGoals: -1 }), null);
  });
});

describe("history and reports", () => {
  it("splits pending from settled and reports correct vs incorrect", () => {
    const rows = [settle(row(0), "home"), settle(row(1, { final: T(0.7, 0.2, 0.1) }), "away"), row(2)];
    const b = bucket(rows);
    assert.equal(b.pending.length, 1);
    assert.equal(b.settled.length, 2);
    const o = outcomeReport(b.settled);
    assert.equal(o.correct.length, 1);
    assert.equal(o.incorrect.length, 1);
    assert.equal(o.confidentMisses.length, 1);
  });
  it("treats a PASS tip as neither hit nor miss for tips", () => {
    assert.equal(tipCovered(settle(row(0, { code: "PASS", tier: "PASS" }), "home")), null);
    assert.equal(tipCovered(settle(row(0, { code: "1X" }), "draw")), true);
    assert.equal(tipCovered(settle(row(0, { code: "1X" }), "away")), false);
  });
  it("will not call a trend before enough matches", () => {
    assert.equal(trend([settle(row(0), "home")]).verdict, "too-early");
  });
  it("detects improvement when later forecasts are better", () => {
    const rows: PredictionRow[] = [];
    for (let i = 0; i < 60; i++) rows.push(settle(row(i, { final: i < 30 ? T(0.2, 0.3, 0.5) : T(0.7, 0.2, 0.1) }), "home"));
    assert.equal(trend(rows).verdict, "improving");
  });
});

describe("csv backup", () => {
  it("neutralises formulas and quotes commas", () => {
    assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell(null), "");
  });
  it("writes a header, one line per row, and marks status", () => {
    const csv = toCsv([row(0), settle(row(1), "home")]);
    const lines = csv.trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith("match_id,"));
    assert.ok(lines[1].includes(",pending,"));
    assert.ok(lines[2].includes(",settled,"));
  });
});
