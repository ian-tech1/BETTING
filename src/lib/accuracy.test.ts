import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { removeVig, blendWithMarket, calibrate, decide, buildJackpot, stake, fitTemperature } from "./accuracy.ts";

const sum = (t: { home: number; draw: number; away: number }) => t.home + t.draw + t.away;

describe("accuracy layer", () => {
  it("removes the margin so probabilities sum to 1", () => {
    const p = removeVig({ home: 2.0, draw: 3.4, away: 3.9 })!;
    assert.ok(Math.abs(sum(p) - 1) < 1e-9);
    assert.ok(p.home > p.draw && p.draw > p.away);
  });
  it("blends and calibrates without breaking normalisation", () => {
    const m = { home: 0.7, draw: 0.2, away: 0.1 };
    const b = blendWithMarket(m, { home: 0.4, draw: 0.3, away: 0.3 });
    assert.ok(Math.abs(sum(b) - 1) < 1e-9);
    assert.ok(calibrate(m).home < m.home);
  });
  it("keeps bookmaker odds as supporting context instead of copying the shortest price", () => {
    const independent = { home: 0.62, draw: 0.23, away: 0.15 };
    const opposingMarket = { home: 0.25, draw: 0.25, away: 0.5 };
    const blended = blendWithMarket(independent, opposingMarket);
    assert.equal([...(["home", "draw", "away"] as const)].sort((a, b) => blended[b] - blended[a])[0], "home");
    assert.ok(blended.home > blended.away);
  });
  it("passes on genuinely open games and lowers tier on stale data", () => {
    assert.equal(decide({ home: 0.36, draw: 0.32, away: 0.32 }, 0.5).tier, "PASS");
    assert.equal(decide({ home: 0.6, draw: 0.25, away: 0.15 }, 0.8).tier, "A");
    assert.equal(decide({ home: 0.6, draw: 0.25, away: 0.15 }, 0.8, 72).tier, "B");
  });
  it("puts doubles on the least certain games", () => {
    const r = buildJackpot([{ home: 0.8, draw: 0.1, away: 0.1 }, { home: 0.4, draw: 0.32, away: 0.28 }], 1);
    assert.deepEqual(r.picks, ["1", "1X"]);
  });
  it("stakes only on real edge", () => {
    assert.equal(stake(0.4, 2.0).stake, 0);
    assert.ok(stake(0.55, 2.0).stake > 0);
  });
  it("keeps default temperature with too little history", () => {
    assert.equal(fitTemperature([]), 1.15);
  });
});
