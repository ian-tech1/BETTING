import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dixonColes, eloTriple, multiBookConsensus, lineMovement, injuryImpact, motivation, restFactor,
  headToHead, venueSplit, confidenceBand, reliabilityAdjust, valueCheck, boundedNudge, applySignals,
} from "./signals.ts";

const sum = (t: { home: number; draw: number; away: number }) => t.home + t.draw + t.away;

describe("signals", () => {
  it("dixon-coles normalises and raises the draw over plain poisson", () => {
    const p = dixonColes(1.2, 1.1);
    assert.ok(Math.abs(sum(p) - 1) < 1e-9);
    assert.ok(p.draw > 0.2);
  });
  it("elo favours the stronger home side and always sums to 1", () => {
    const p = eloTriple(1700, 1500);
    assert.ok(p.home > p.away && Math.abs(sum(p) - 1) < 1e-9);
  });
  it("median across books ignores one outlier price", () => {
    const c = multiBookConsensus([
      { home: 2.0, draw: 3.4, away: 3.9 }, { home: 2.05, draw: 3.4, away: 3.8 }, { home: 3.5, draw: 3.0, away: 2.0 },
    ])!;
    assert.ok(c.p.home > c.p.away);
    assert.equal(c.books, 3);
  });
  it("line movement is positive when a price shortens", () => {
    const m = lineMovement({ home: 2.2, draw: 3.3, away: 3.4 }, { home: 1.9, draw: 3.5, away: 4.0 })!;
    assert.ok(m.home > 0 && m.away < 0);
  });
  it("injuries hurt, with a floor", () => {
    const i = injuryImpact(Array(20).fill({ role: "FWD", starter: true }));
    assert.ok(i.attack >= 0.78 && i.attack < 1);
    assert.equal(injuryImpact([]).attack, 1);
  });
  it("small adjustments stay in range", () => {
    assert.ok(motivation(1, 20, 5) > 1);
    assert.ok(restFactor(2) < 1 && restFactor(null) === 1);
    assert.ok(venueSplit(1.5, 2.2, 10) <= 1.1);
    assert.equal(venueSplit(1.5, 2.2, 2), 1);
  });
  it("head to head needs a sample and is shrunk", () => {
    assert.equal(headToHead(["home", "home"]), null);
    const h = headToHead(["home", "home", "home", "home", "home"])!;
    assert.ok(h.home < 0.8 && Math.abs(sum(h) - 1) < 1e-9);
  });
  it("confidence band is ordered and stable on a lopsided game", () => {
    const b = confidenceBand(2.4, 0.6);
    assert.ok(b.low <= b.high && b.stability > 0.9 && b.top === "home");
  });
  it("recalibration does nothing without enough history", () => {
    const p = { home: 0.5, draw: 0.3, away: 0.2 };
    assert.deepEqual(reliabilityAdjust(p, []), p);
  });
  it("recalibration moves overconfident home picks down, by a bounded amount", () => {
    const h = Array.from({ length: 50 }, (_, i) => ({ p: { home: 0.7, draw: 0.2, away: 0.1 }, result: (i % 2 ? "home" : "away") as "home" | "away" }));
    const out = reliabilityAdjust({ home: 0.7, draw: 0.2, away: 0.1 }, h);
    assert.ok(out.home < 0.7 && out.home > 0.6);
  });
  it("value check flags only real edges", () => {
    assert.equal(valueCheck(0.55, 1.8).verdict, "fair");
    assert.equal(valueCheck(0.6, 2.0).verdict, "value");
    assert.equal(valueCheck(0.3, undefined).verdict, "no price");
  });
  it("AI nudge is clamped and bad input is ignored", () => {
    const n = boundedNudge({ home: 0.5, draw: -0.5, away: NaN })!;
    assert.deepEqual(n, { home: 0.04, draw: -0.04, away: 0 });
    assert.equal(boundedNudge(null), null);
  });
  it("combined signals can never move a probability more than the cap", () => {
    const base = { home: 0.5, draw: 0.3, away: 0.2 };
    const { p } = applySignals(base, { elo: { home: 0.05, draw: 0.1, away: 0.85 }, market: { home: 0.05, draw: 0.1, away: 0.85 }, nudge: { home: -0.04, draw: 0, away: 0.04 } }, 0.1);
    assert.ok(Math.abs(sum(p) - 1) < 1e-9);
    assert.ok(base.home - p.home <= 0.11);
  });
});
