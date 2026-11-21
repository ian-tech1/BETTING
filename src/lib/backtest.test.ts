import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runBacktest, wilson, score, calibrationBins, MIN_SAMPLE, type BacktestRecord } from "./backtest.ts";

const T = (home: number, draw: number, away: number) => ({ home, draw, away });

describe("backtest engine", () => {
  it("refuses to claim accuracy on a small sample", () => {
    const r = runBacktest([{ engine: T(0.6, 0.25, 0.15), ai: T(0.55, 0.25, 0.2), result: "home" }]);
    assert.equal(r.verdict, "insufficient");
  });

  it("scores a perfect and a terrible forecaster correctly", () => {
    const good = score([{ p: T(1, 0, 0), result: "home" }]);
    const bad = score([{ p: T(1, 0, 0), result: "away" }]);
    assert.equal(good.hitRate, 1);
    assert.ok(good.brier < 1e-9);
    assert.equal(bad.hitRate, 0);
    assert.ok(Math.abs(bad.brier - 2) < 1e-9);
  });

  it("Wilson interval is wide for tiny samples and tightens with more data", () => {
    const small = wilson(3, 4);
    const big = wilson(300, 400);
    assert.ok(small.high - small.low > big.high - big.low);
    assert.ok(big.low < 0.75 && big.high > 0.75);
  });

  it("flags a forecaster that does no better than base rates", () => {
    const recs: BacktestRecord[] = [];
    const results = ["home", "draw", "away", "home", "away", "draw"] as const;
    for (let i = 0; i < MIN_SAMPLE + 10; i++) recs.push({ engine: T(0.8, 0.1, 0.1), ai: T(0.8, 0.1, 0.1), result: results[i % 6] });
    const r = runBacktest(recs);
    assert.equal(r.verdict, "no-edge");
  });

  it("recognises a forecaster with real signal", () => {
    const recs: BacktestRecord[] = [];
    for (let i = 0; i < 90; i++) {
      const side = (["home", "draw", "away"] as const)[i % 3];
      const p = side === "home" ? T(0.6, 0.25, 0.15) : side === "draw" ? T(0.3, 0.4, 0.3) : T(0.15, 0.25, 0.6);
      recs.push({ engine: p, ai: p, result: side });
    }
    const r = runBacktest(recs);
    assert.equal(r.verdict, "beats-baseline");
    assert.ok(r.skill.blend > 0);
  });

  it("separates agreement from accuracy", () => {
    const recs: BacktestRecord[] = [
      { engine: T(0.6, 0.2, 0.2), ai: T(0.6, 0.2, 0.2), result: "away" },
      { engine: T(0.6, 0.2, 0.2), ai: T(0.2, 0.2, 0.6), result: "home" },
    ];
    const r = runBacktest(recs);
    assert.equal(r.agreement.agree.n, 1);
    assert.equal(r.agreement.disagree.n, 1);
    assert.ok(r.agreement.liftPoints < 0, "agreeing models were wrong here, so agreement shows no lift");
  });

  it("calibration bins report predicted vs observed frequency", () => {
    const bins = calibrationBins([
      { p: T(0.9, 0.05, 0.05), result: "home" },
      { p: T(0.9, 0.05, 0.05), result: "away" },
    ]);
    const hi = bins.find((b) => b.from >= 0.8)!;
    assert.equal(hi.n, 2);
    assert.equal(hi.observed, 0.5);
  });

  it("scores the lowest-verified-odds baseline without fabricating missing prices", () => {
    const withMarket = runBacktest([
      { engine: T(0.6, 0.2, 0.2), ai: T(0.6, 0.2, 0.2), market: T(0.2, 0.2, 0.6), result: "away" },
    ]);
    const withoutMarket = runBacktest([
      { engine: T(0.6, 0.2, 0.2), ai: T(0.6, 0.2, 0.2), result: "home" },
    ]);
    assert.equal(withMarket.baselines.lowestOdds?.hits, 1);
    assert.equal(withoutMarket.baselines.lowestOdds, null);
  });
});
