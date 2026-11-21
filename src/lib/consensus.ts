import type { Side } from "@/data/weekend";
import { argmax, predictionFeeds, type Triple } from "./engines";
import { buildAdvancedReport } from "./advanced-predictors";
import { blendWithMarket, brier, calibrate, decide, fitTemperature, removeVig } from "./accuracy";
import { applySignals, confidenceBand, reliabilityAdjust, type Signals } from "./signals";
import { adjustedLambdas } from "./engines";
import { applyLeagueDrawPrior, type FreshnessReport } from "./analysis";

export type SourceRecord = { engine: Triple; ai: Triple; final?: Triple; result: keyof Triple; league?: string; recordedAt?: string; kickoffAt?: string; models?: Record<string, Triple> };
export type Color = "#10B981" | "#F59E0B" | "#EF4444" | "#06B6D4";

/** Weight the statistical engine and the AI-style lab by Brier skill over the last 100 settled matches. */
export function accuracyWeights(history: SourceRecord[], window = 100) {
  const last = history.slice(-window);
  if (last.length < 20) return { engine: 0.5, ai: 0.5, sample: last.length };
  const skill = (k: "engine" | "ai") =>
    Math.max(0.05, 1 - brier(last.map((r) => ({ p: r[k], result: r.result }))) / 0.667);
  const e = skill("engine");
  const a = skill("ai");
  return { engine: e / (e + a), ai: a / (e + a), sample: last.length };
}

/** Convert settled model forecasts into conservative reliability multipliers. Cold-start models remain neutral. */
export function learnedModelWeights(history: SourceRecord[], window = 100): Record<string, number> {
  const scores = new Map<string, { loss: number; count: number }>();
  for (const row of history.slice(-window)) {
    for (const [id, probabilities] of Object.entries(row.models ?? {})) {
      const loss = (Object.keys(probabilities) as (keyof Triple)[]).reduce(
        (sum, key) => sum + (probabilities[key] - (key === row.result ? 1 : 0)) ** 2,
        0,
      );
      const current = scores.get(id) ?? { loss: 0, count: 0 };
      scores.set(id, { loss: current.loss + loss, count: current.count + 1 });
    }
  }
  const weights: Record<string, number> = {};
  for (const [id, score] of scores) {
    if (score.count < 5) continue;
    const brierScore = score.loss / score.count;
    weights[id] = Math.min(2, Math.max(0.35, 0.8 / (0.2 + brierScore)));
  }
  return weights;
}

export type Consensus = {
  probabilities: Triple;
  pick: keyof Triple;
  code: string; // 1 / X / 2 or a double chance such as 1X
  tier: "A" | "B" | "C" | "PASS";
  color: Color;
  label: string;
  conflict: boolean; // engine and AI lab disagreed before reconciliation
  enginePick: keyof Triple;
  aiPick: keyof Triple;
  weights: { engine: number; ai: number; sample: number };
  cautions: string[];
  engineProbs: Triple;
  aiProbs: Triple;
  signalNotes: string[];
  band: { low: number; high: number; stability: number };
  freshness: FreshnessReport;
  insufficientData: boolean;
};

const TIERS = ["A", "B", "C", "PASS"] as const;

function formPoints(form: Side["form"]): number {
  return form.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
}

/** Resolve exact/near ties with fixture evidence instead of object-key order. */
function selectFinalOutcome(probabilities: Triple, home: Side, away: Side): keyof Triple {
  const ordered = (Object.keys(probabilities) as (keyof Triple)[]).sort((a, b) => probabilities[b] - probabilities[a]);
  const top = ordered[0];
  const second = ordered[1];
  if (probabilities[top] - probabilities[second] > 0.0005) return top;
  const evidence: Triple = {
    home: home.xgFor - away.xgAgainst + (formPoints(home.form) - formPoints(away.form)) * 0.08 + ((home.venueForm?.filter((mark) => mark === "W").length ?? 0) - (away.venueForm?.filter((mark) => mark === "W").length ?? 0)) * 0.05 + (away.pos - home.pos) * 0.01,
    draw: -Math.abs(home.xgFor - away.xgFor) * 0.25 - Math.abs(formPoints(home.form) - formPoints(away.form)) * 0.02,
    away: away.xgFor - home.xgAgainst + (formPoints(away.form) - formPoints(home.form)) * 0.08 + ((away.venueForm?.filter((mark) => mark === "W").length ?? 0) - (home.venueForm?.filter((mark) => mark === "W").length ?? 0)) * 0.05 + (home.pos - away.pos) * 0.01,
  };
  const candidates = ordered.filter((outcome) => probabilities[top] - probabilities[outcome] <= 0.0005);
  return candidates.sort((a, b) => evidence[b] - evidence[a])[0] ?? top;
}

export function buildConsensus(
  home: Side,
  away: Side,
  opts: { odds?: Triple; history?: SourceRecord[]; league?: string; live?: boolean; dataAgeHours?: number; signals?: Signals } = {},
): Consensus {
  const engine = predictionFeeds(home, away);
  const history = opts.history ?? [];
  const ai = buildAdvancedReport(home, away, learnedModelWeights(history));
  const hasVerifiedTeamData =
    Math.min(home.played, away.played) > 0 &&
    home.form.length > 0 && away.form.length > 0 &&
    (home.xgFor > 0 || home.gf > 0) && (away.xgFor > 0 || away.gf > 0);
  const weights = accuracyWeights(history);
  const mixed = {
    home: engine.blend.home * weights.engine + ai.ensemble.home * weights.ai,
    draw: engine.blend.draw * weights.engine + ai.ensemble.draw * weights.ai,
    away: engine.blend.away * weights.engine + ai.ensemble.away * weights.ai,
  };
  const market = opts.odds ? removeVig(opts.odds) : null;
  const withSignals = applySignals(mixed, opts.signals);
  // A bookmaker quote is useful context, but letting it contribute 50–78% made
  // the published pick behave like a shortest-price baseline. Keep the
  // independent engine/lab ensemble in control and use the market only as a
  // bounded corroborating signal.
  // Unmatched Jackpot rows often have no catalogue statistics. In that case,
  // verified 1/X/2 prices are the only fixture-specific evidence and must not
  // be drowned out by the generic home-advantage baseline. Without prices,
  // keep the fallback neutral between the two teams rather than defaulting Home.
  const marketWeight = market ? (hasVerifiedTeamData ? 0.18 : 0.72) : 0;
  const limitedPrior = !hasVerifiedTeamData
    ? market
      ? { home: market.home, draw: market.draw, away: market.away }
      : { home: 0.36, draw: 0.28, away: 0.36 }
    : withSignals.p;
  const past = history.slice(-100).map((r) => ({ p: r.final ?? r.engine, result: r.result }));
  // Do not flatten a three-way forecast before there is enough prospective history
  // to fit calibration. Temperature > 1 moves mass toward the middle outcome,
  // which can systematically inflate draws on a cold-start model.
  const temperature = past.length >= 30 ? fitTemperature(past) : 1;
  let probabilities = calibrate(
    reliabilityAdjust(
      blendWithMarket(limitedPrior, market, marketWeight),
      history.slice(-100).map((r) => ({ p: r.final ?? { home: (r.engine.home + r.ai.home) / 2, draw: (r.engine.draw + r.ai.draw) / 2, away: (r.engine.away + r.ai.away) / 2 }, result: r.result })),
    ),
    temperature,
  );
  const leagueHistory = opts.league ? history.filter((r) => r.league === opts.league) : [];
  if (leagueHistory.length >= 20) {
    probabilities = applyLeagueDrawPrior(probabilities, leagueHistory.filter((r) => r.result === "draw").length, leagueHistory.length);
  } else if (opts.signals?.drawPrior) {
    probabilities = applyLeagueDrawPrior(probabilities, opts.signals.drawPrior.draws, opts.signals.drawPrior.sample);
  }
  const lam = adjustedLambdas(home, away);
  const band = confidenceBand(lam.home, lam.away);
  const pick = selectFinalOutcome(probabilities, home, away);
  const agreement = (engine.agree / engine.core + ai.agreementRate) / 2;
  const freshness: FreshnessReport = opts.signals?.freshness ?? (hasVerifiedTeamData
    ? {
        status: "fresh",
        action: "allow",
        ageHours: 0,
        reasons: ["Using available team statistics, form, goals and xG."],
      }
    : {
        status: "missing",
        action: "pass",
        ageHours: null,
        reasons: ["No verified team statistics, form and xG are available."],
      });
  const insufficientData =
    !hasVerifiedTeamData || home.form.length === 0 || away.form.length === 0;
  const age = freshness.status === "fresh" ? (freshness.ageHours ?? opts.dataAgeHours ?? 0) : (freshness.ageHours ?? 49);
  const base = decide(probabilities, agreement, age);

  // Extra reliability checks, each lowers confidence one step.
  const cautions: string[] = [];
  if (freshness.action === "pass") cautions.push("Fresh required data is missing; this is a low-confidence baseline selection.");
  else if (freshness.action === "downgrade") cautions.push("Required data is stale; confidence has been downgraded.");
  cautions.push(...freshness.reasons);
  if (!ai.stressStable) cautions.push("Result flips under a stress test");
  if (ai.sampleLabel === "limited") cautions.push("Small sample of games");
  if (ai.spread > 0.12) cautions.push("Models are widely spread");
  if (market && argmax(market) !== pick) cautions.push("Market favours a different outcome");
  if (band.stability < 0.6) cautions.push("Pick unstable when goal rates are perturbed");
  if (opts.signals?.dispersion !== undefined && opts.signals.dispersion > 0.1) cautions.push("Bookmakers disagree");
  const conflict = argmax(engine.blend) !== argmax(ai.ensemble);
  if (conflict) cautions.push("Engine and AI lab disagreed; reconciled");
  const steps = cautions.filter((c) => !c.includes("reconciled")).length;
  const idx = Math.min(3, TIERS.indexOf(base.tier) + steps + (freshness.action === "downgrade" && age <= 48 ? 1 : 0));
  const tier = insufficientData || freshness.action === "pass" || base.tier === "PASS" ? "C" : TIERS[idx] === "PASS" ? "C" : TIERS[idx];
  const code = pick === "home" ? "1" : pick === "draw" ? "X" : "2";

  const color: Color = opts.live
    ? "#06B6D4"
    : probabilities[pick] < 0.42
      ? "#EF4444"
      : tier === "A" && pick !== "draw"
        ? "#10B981"
        : "#F59E0B";
  const label = opts.live
    ? "Live consensus update"
    : color === "#10B981"
      ? "High-confidence consensus"
      : color === "#F59E0B"
        ? pick === "draw" ? "Draw option, moderate confidence" : "Moderate confidence"
        : "High risk, lower probability";
  if (insufficientData) cautions.push("Verified team statistics, form, or xG are unavailable; selected from the available baseline evidence.");
  return { probabilities, pick, code, tier, color, label: insufficientData || freshness.action === "pass" ? "LOW confidence · limited data" : label, conflict, enginePick: argmax(engine.blend), aiPick: ai.pick, weights, cautions, engineProbs: engine.blend, aiProbs: ai.ensemble, signalNotes: withSignals.notes, band, freshness, insufficientData };
}

/**
 * Live Final tip: the pre-match consensus fades into the in-play probabilities as the match goes on.
 * In-play already contains the score, so its weight grows with the clock (20% at kick-off, 85% late).
 */
export function liveConsensus(pre: Consensus, play: Triple, minute: number): Consensus {
  const w = minute < 0 ? 0.2 : Math.min(0.85, 0.2 + (minute / 90) * 0.65);
  const mixed = {
    home: pre.probabilities.home * (1 - w) + play.home * w,
    draw: pre.probabilities.draw * (1 - w) + play.draw * w,
    away: pre.probabilities.away * (1 - w) + play.away * w,
  };
  const sum = mixed.home + mixed.draw + mixed.away || 1;
  const probabilities = { home: mixed.home / sum, draw: mixed.draw / sum, away: mixed.away / sum };
  const pick = argmax(probabilities);
  const top = probabilities[pick];
  const tier = top >= 0.7 ? "A" : top >= 0.55 ? "B" : "C";
  const code = pick === "home" ? "1" : pick === "draw" ? "X" : "2";
  return { ...pre, probabilities, pick, tier, code, color: "#06B6D4", label: "Live consensus update", conflict: false };
}
