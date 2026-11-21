import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isModelDisagreement,
  parseBetikaKickoff,
  sameTeam,
  stableFixtureId,
  topResult,
} from "./jackpot-utils.ts";

describe("Jackpot source safety helpers", () => {
  it("matches supported aliases but rejects ambiguous substring matches", () => {
    assert.equal(sameTeam("SC Paderborn 07", "Paderborn"), true);
    assert.equal(sameTeam("Man Utd", "Manchester United"), true);
    assert.equal(sameTeam("Paris Saint-Germain", "Paris"), false);
    assert.equal(sameTeam("Newcastle United", "Newcastle"), true);
  });

  it("parses Betika local timestamps as Kenya time and preserves explicit offsets", () => {
    assert.equal(
      parseBetikaKickoff("2026-11-07 17:30:00"),
      Date.parse("2026-11-07T17:30:00+03:00"),
    );
    assert.equal(parseBetikaKickoff("2026-11-07T14:30:00Z"), Date.parse("2026-11-07T14:30:00Z"));
    assert.equal(parseBetikaKickoff("not a date"), null);
  });

  it("returns exactly one most-likely outcome with deterministic tie-breaking", () => {
    assert.equal(topResult({ home: 0.4, draw: 0.35, away: 0.25 }), "home");
    assert.equal(topResult({ home: 0.3, draw: 0.4, away: 0.3 }), "draw");
    assert.equal(topResult({ home: 0.4, draw: 0.4, away: 0.2 }), "home");
  });

  it("flags only a material market/model mismatch", () => {
    assert.equal(isModelDisagreement(0.55, 0.43), true);
    assert.equal(isModelDisagreement(0.55, 0.46), false);
    assert.equal(isModelDisagreement(Number.NaN, 0.2), false);
  });

  it("builds stable fixture keys from teams and kickoff rather than row position", () => {
    assert.equal(
      stableFixtureId("sportpesa", "Man Utd", "Aston Villa", "2026-11-08T16:30:00Z"),
      stableFixtureId("sportpesa", "Manchester United", "Aston Villa", "2026-11-08T16:30:00Z"),
    );
  });
});
