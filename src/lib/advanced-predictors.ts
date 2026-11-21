import type { FormMark, Side } from "@/data/weekend";
import { adjustedLambdas, argmax, baseLambdas, scoreTriple, type Triple } from "@/lib/engines";

export type PredictorModel = {
  id: string;
  name: string;
  method: string;
  probabilities: Triple;
};

export type AdvancedTool = {
  id: string;
  name: string;
  value: string;
  method: string;
};

export type AdvancedReport = {
  models: PredictorModel[];
  tools: AdvancedTool[];
  ensemble: Triple;
  pick: keyof Triple;
  outcomeMargin: number;
  agreement: number;
  agreementRate: number;
  spread: number;
  sampleGames: number;
  sampleLabel: "limited" | "moderate" | "broader";
  stressStable: boolean;
  stressPicks: (keyof Triple)[];
  riskFlags: string[];
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const markValue: Record<FormMark, number> = { W: 1, D: 0.35, L: 0 };
const formatPercent = (probability: number) => `${(probability * 100).toFixed(1)}%`;

function recentForm(form: FormMark[]) {
  if (form.length === 0) return 0.4;
  let weighted = 0;
  let total = 0;
  form.forEach((mark, index) => {
    const age = form.length - index - 1;
    const weight = Math.pow(0.72, age);
    weighted += markValue[mark] * weight;
    total += weight;
  });
  return total > 0 ? weighted / total : 0.4;
}

function shrinkRate(rate: number, played: number, prior = 1.35) {
  const games = Math.max(0, played);
  const priorGames = 8;
  return (rate * games + prior * priorGames) / (games + priorGames);
}

function namedAbsences(side: Side) {
  return side.out.filter((name) => !/no new|no senior|no confirmed/i.test(name)).length;
}

function formPoints(form: FormMark[]) {
  return form.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
}

function venueRate(side: Side, fallback: number) {
  const sample = side.venueForm ?? [];
  if (!sample.length) return fallback;
  return (sample.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0) / (sample.length * 3));
}

function weightedEnsemble(models: PredictorModel[], learnedWeights: Record<string, number> = {}): Triple {
  // Scenario stress tests are useful diagnostics, but are deliberately downweighted
  // so adding more scenarios cannot manufacture a stronger or more certain pick.
  const scenarioIds = new Set([
    "xg-only-neutral", "form-only", "goal-trend", "draw-conservative",
    "table-form-blend", "low-tempo-stress",
  ]);
  const modelWeight = (model: PredictorModel) => (scenarioIds.has(model.id) ? 0.35 : 1) * clamp(learnedWeights[model.id] ?? 1, 0.35, 2);
  const weightTotal = models.reduce((sum, model) => sum + modelWeight(model), 0);
  const average = (key: keyof Triple) => models.reduce(
    (sum, model) => sum + model.probabilities[key] * modelWeight(model), 0,
  ) / Math.max(1, weightTotal);
  return { home: average("home"), draw: average("draw"), away: average("away") };
}

function hashedSeed(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0 || 1;
}

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function samplePoisson(lambda: number, random: () => number) {
  const threshold = Math.exp(-lambda);
  let product = 1;
  let goals = 0;
  do {
    goals += 1;
    product *= random();
  } while (product > threshold && goals < 20);
  return goals - 1;
}

function monteCarlo(homeLambda: number, awayLambda: number, seed: number): Triple {
  const simulations = 2400;
  const random = seededRandom(seed);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let index = 0; index < simulations; index++) {
    const homeGoals = samplePoisson(homeLambda, random);
    const awayGoals = samplePoisson(awayLambda, random);
    if (homeGoals > awayGoals) home += 1;
    else if (homeGoals === awayGoals) draw += 1;
    else away += 1;
  }
  const denominator = simulations + 1.5;
  return {
    home: (home + 0.5) / denominator,
    draw: (draw + 0.5) / denominator,
    away: (away + 0.5) / denominator,
  };
}

function poissonDistribution(lambda: number, maxGoals = 9) {
  const values = Array.from({ length: maxGoals + 1 }, (_, goals) => {
    let probability = Math.exp(-lambda);
    for (let index = 1; index <= goals; index++) probability *= lambda / index;
    return probability;
  });
  const mass = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / mass);
}

function negativeBinomialDistribution(mean: number, dispersion = 6, maxGoals = 9) {
  const p = dispersion / (dispersion + mean);
  const q = 1 - p;
  const values: number[] = [];
  let coefficient = 1;
  let power = Math.pow(p, dispersion);
  for (let goals = 0; goals <= maxGoals; goals++) {
    values.push(coefficient * power);
    coefficient *= (dispersion + goals) / (goals + 1);
    power *= q;
  }
  const mass = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / mass);
}

function tripleFromDistributions(home: number[], away: number[]): Triple {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let h = 0; h < home.length; h++) {
    for (let a = 0; a < away.length; a++) {
      const probability = home[h] * away[a];
      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;
    }
  }
  const total = homeWin + draw + awayWin || 1;
  return { home: homeWin / total, draw: draw / total, away: awayWin / total };
}

function zeroInflate(distribution: number[], extraZeroMass: number) {
  return distribution.map((probability, index) =>
    index === 0
      ? extraZeroMass + (1 - extraZeroMass) * probability
      : (1 - extraZeroMass) * probability,
  );
}

function bivariatePoisson(homeLambda: number, awayLambda: number): Triple {
  const shared = Math.min(0.12, homeLambda * 0.12, awayLambda * 0.12);
  const common = poissonDistribution(shared);
  const homeSolo = poissonDistribution(Math.max(0.01, homeLambda - shared));
  const awaySolo = poissonDistribution(Math.max(0.01, awayLambda - shared));
  const grid = Array.from({ length: homeSolo.length + common.length - 1 }, () =>
    Array.from({ length: awaySolo.length + common.length - 1 }, () => 0),
  );
  for (let commonGoals = 0; commonGoals < common.length; commonGoals++) {
    for (let homeGoals = 0; homeGoals < homeSolo.length; homeGoals++) {
      for (let awayGoals = 0; awayGoals < awaySolo.length; awayGoals++) {
        grid[homeGoals + commonGoals][awayGoals + commonGoals] +=
          common[commonGoals] * homeSolo[homeGoals] * awaySolo[awayGoals];
      }
    }
  }
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      if (h > a) home += grid[h][a];
      else if (h === a) draw += grid[h][a];
      else away += grid[h][a];
    }
  }
  const total = home + draw + away || 1;
  return { home: home / total, draw: draw / total, away: away / total };
}

function strengthProxy(home: Side, away: Side): Triple {
  const formHome = recentForm(home.form);
  const formAway = recentForm(away.form);
  const homeGoalDiff = home.played > 0 ? (home.gf - home.ga) / home.played : 0;
  const awayGoalDiff = away.played > 0 ? (away.gf - away.ga) / away.played : 0;
  const homeRating = (18 - home.pos) * 14 + (formHome - 0.5) * 70 + homeGoalDiff * 28;
  const awayRating = (18 - away.pos) * 14 + (formAway - 0.5) * 70 + awayGoalDiff * 28;
  const ratingGap = clamp(homeRating - awayRating + 48, -320, 320);
  const homeWinGivenNoDraw = 1 / (1 + Math.pow(10, -ratingGap / 400));
  const draw = clamp(0.28 * Math.exp(-Math.abs(ratingGap) / 360), 0.07, 0.29);
  return {
    home: homeWinGivenNoDraw * (1 - draw),
    draw,
    away: (1 - homeWinGivenNoDraw) * (1 - draw),
  };
}

function logisticFeatures(home: Side, away: Side): Triple {
  const xgGap = clamp(home.xgFor - away.xgFor + away.xgAgainst - home.xgAgainst, -3.5, 3.5);
  const tableGap = clamp(away.pos - home.pos, -20, 20);
  const formGap = recentForm(home.form) - recentForm(away.form);
  const absenceGap = clamp(namedAbsences(away) - namedAbsences(home), -3, 3);
  const score = clamp(
    0.48 * xgGap + 0.025 * tableGap + 0.9 * formGap + 0.08 * absenceGap + 0.24,
    -2.4,
    2.4,
  );
  const logits = [score, 0.5 + Math.abs(score) * 0.12, -score];
  const exp = logits.map((value) => Math.exp(value));
  const total = exp.reduce((sum, value) => sum + value, 0);
  return { home: exp[0] / total, draw: exp[1] / total, away: exp[2] / total };
}

function formCounts(form: FormMark[]) {
  return {
    win: form.filter((mark) => mark === "W").length,
    draw: form.filter((mark) => mark === "D").length,
    loss: form.filter((mark) => mark === "L").length,
    games: form.length,
  };
}

function formPointsVolatility(form: FormMark[]) {
  if (form.length < 2) return null;
  const points: number[] = form.map((mark) => (mark === "W" ? 3 : mark === "D" ? 1 : 0));
  const mean = points.reduce((sum, value) => sum + value, 0) / points.length;
  const variance = points.reduce((sum, value) => sum + (value - mean) ** 2, 0) / points.length;
  return Math.sqrt(variance);
}

function dirichletForm(home: Side, away: Side): Triple {
  const h = formCounts(home.form);
  const a = formCounts(away.form);
  const hWin = (h.win + 1) / (h.games + 3);
  const hDraw = (h.draw + 1) / (h.games + 3);
  const hLoss = (h.loss + 1) / (h.games + 3);
  const aWin = (a.win + 1) / (a.games + 3);
  const aDraw = (a.draw + 1) / (a.games + 3);
  const aLoss = (a.loss + 1) / (a.games + 3);
  const raw = { home: (hWin + aLoss) / 2, draw: (hDraw + aDraw) / 2, away: (aWin + hLoss) / 2 };
  const total = raw.home + raw.draw + raw.away || 1;
  return { home: raw.home / total, draw: raw.draw / total, away: raw.away / total };
}

function venueSplitModel(home: Side, away: Side): Triple {
  const homeForm = home.venueForm?.length ? recentForm(home.venueForm) : recentForm(home.form);
  const awayForm = away.venueForm?.length ? recentForm(away.venueForm) : recentForm(away.form);
  const gap = clamp(homeForm - awayForm, -1, 1);
  return scoreTriple(clamp(1.35 + gap * 0.7 + 0.12, 0.35, 3.3), clamp(1.35 - gap * 0.7, 0.25, 3.1), true);
}

function attackDefenceBalance(home: Side, away: Side): Triple {
  const homeRate = clamp((shrinkRate(home.xgFor, home.played) + shrinkRate(away.xgAgainst, away.played)) / 2, 0.35, 3.3);
  const awayRate = clamp((shrinkRate(away.xgFor, away.played) + shrinkRate(home.xgAgainst, home.played)) / 2, 0.25, 3.1);
  return scoreTriple(homeRate, awayRate, false);
}

function volatilityModel(home: Side, away: Side): Triple {
  const volatility = clamp(((formPointsVolatility(home.form) ?? 0.9) + (formPointsVolatility(away.form) ?? 0.9)) / 2, 0, 1.5);
  const homeRate = clamp(1.35 + (recentForm(home.form) - 0.5) * 0.8 + volatility * 0.08, 0.35, 3.3);
  const awayRate = clamp(1.35 + (recentForm(away.form) - 0.5) * 0.8 + volatility * 0.08, 0.25, 3.1);
  return scoreTriple(homeRate, awayRate, true);
}

function buildTools(
  home: Side,
  away: Side,
  homeLambda: number,
  awayLambda: number,
): AdvancedTool[] {
  const hDist = poissonDistribution(homeLambda);
  const aDist = poissonDistribution(awayLambda);
  let btts = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let nilNil = 0;
  let homeNil = 0;
  let awayNil = 0;
  let homeClean = 0;
  let awayClean = 0;
  const bands = [0, 0, 0];
  for (let h = 0; h < hDist.length; h++) {
    for (let a = 0; a < aDist.length; a++) {
      const probability = hDist[h] * aDist[a];
      const total = h + a;
      if (h > 0 && a > 0) btts += probability;
      if (total >= 2) over15 += probability;
      if (total >= 3) over25 += probability;
      if (total >= 4) over35 += probability;
      if (h === 0 && a === 0) nilNil += probability;
      if (h > a && a === 0) homeNil += probability;
      if (a > h && h === 0) awayNil += probability;
      if (a === 0) homeClean += probability;
      if (h === 0) awayClean += probability;
      bands[total <= 1 ? 0 : total <= 3 ? 1 : 2] += probability;
    }
  }
  const firstScoringChance = 1 - nilNil;
  const firstHome = (firstScoringChance * homeLambda) / (homeLambda + awayLambda || 1);
  const firstAway = firstScoringChance - firstHome;
  const totalExpected = homeLambda + awayLambda;
  const gap = homeLambda - awayLambda;
  const count = (side: Side) => namedAbsences(side);

  return [
    {
      id: "tool-over15",
      name: "Over 1.5 goals",
      value: formatPercent(over15),
      method: "Independent Poisson score grid from adjusted xG rates.",
    },
    {
      id: "tool-over25",
      name: "Over 2.5 goals",
      value: formatPercent(over25),
      method: "Independent Poisson score grid from adjusted xG rates.",
    },
    {
      id: "tool-under25",
      name: "Under 2.5 goals",
      value: formatPercent(1 - over25),
      method: "Complement of the same 2.5-goal probability.",
    },
    {
      id: "tool-over35",
      name: "Over 3.5 goals",
      value: formatPercent(over35),
      method: "Independent Poisson score grid from adjusted xG rates.",
    },
    {
      id: "tool-btts",
      name: "Both teams to score",
      value: formatPercent(btts),
      method: "Probability both sides score at least once in the score grid.",
    },
    {
      id: "tool-nilnil",
      name: "0–0 scoreline",
      value: formatPercent(nilNil),
      method: "Joint zero-goal probability from both adjusted Poisson rates.",
    },
    {
      id: "tool-home-clean",
      name: `${home.short} clean sheet`,
      value: formatPercent(homeClean),
      method: "Away side scores zero in the score grid.",
    },
    {
      id: "tool-away-clean",
      name: `${away.short} clean sheet`,
      value: formatPercent(awayClean),
      method: "Home side scores zero in the score grid.",
    },
    {
      id: "tool-home-nil",
      name: `${home.short} win to nil`,
      value: formatPercent(homeNil),
      method: "Home win with zero away goals in the score grid.",
    },
    {
      id: "tool-away-nil",
      name: `${away.short} win to nil`,
      value: formatPercent(awayNil),
      method: "Away win with zero home goals in the score grid.",
    },
    {
      id: "tool-first-score",
      name: "First-score proxy",
      value: `${home.short} ${formatPercent(firstHome)} · ${away.short} ${formatPercent(firstAway)} · no goal ${formatPercent(nilNil)}`,
      method:
        "Allocates the chance of at least one goal by relative scoring intensity; no time-to-goal data is available.",
    },
    {
      id: "tool-goal-bands",
      name: "Total-goal bands",
      value: `0–1 ${formatPercent(bands[0])} · 2–3 ${formatPercent(bands[1])} · 4+ ${formatPercent(bands[2])}`,
      method: "Grouped total-goal probability from the independent score grid.",
    },
    {
      id: "tool-xg-context",
      name: "Expected-goals context",
      value: `${home.short} ${homeLambda.toFixed(2)} · ${away.short} ${awayLambda.toFixed(2)} · total ${totalExpected.toFixed(2)} · gap ${gap >= 0 ? "+" : ""}${gap.toFixed(2)}`,
      method: `Pre-match rate inputs. Listed absences: ${home.short} ${count(home)}, ${away.short} ${count(away)}; absence counts are not player-specific weights.`,
    },
  ];
}

function pickName(pick: keyof Triple) {
  if (pick === "home") return "Home";
  if (pick === "away") return "Away";
  return "Draw";
}

export function buildAdvancedReport(home: Side, away: Side, learnedWeights: Record<string, number> = {}): AdvancedReport {
  const base = baseLambdas(home, away);
  const adjusted = adjustedLambdas(home, away);
  const hAttack = shrinkRate(home.xgFor, home.played);
  const aAttack = shrinkRate(away.xgFor, away.played);
  const hDefence = shrinkRate(home.xgAgainst, home.played);
  const aDefence = shrinkRate(away.xgAgainst, away.played);
  const bayesHome = clamp(((hAttack + aDefence) / 2) * 1.06, 0.35, 3.3);
  const bayesAway = clamp(((aAttack + hDefence) / 2) * 0.94, 0.25, 3.1);
  const recencyGap = recentForm(home.form) - recentForm(away.form);
  const recencyHome = clamp(base.home * (1 + recencyGap * 0.2), 0.35, 3.3);
  const recencyAway = clamp(base.away * (1 - recencyGap * 0.2), 0.25, 3.1);
  const seed = hashedSeed(
    `${home.name}:${away.name}:${home.xgFor}:${away.xgFor}:${home.played}:${away.played}`,
  );
  const homeGoalsRate = home.played > 0 ? home.gf / home.played : 1.35;
  const awayGoalsRate = away.played > 0 ? away.gf / away.played : 1.35;
  const homeConcedeRate = home.played > 0 ? home.ga / home.played : 1.35;
  const awayConcedeRate = away.played > 0 ? away.ga / away.played : 1.35;
  const observedHome = clamp(((homeGoalsRate + awayConcedeRate) / 2) * 1.08, 0.35, 3.3);
  const observedAway = clamp(((awayGoalsRate + homeConcedeRate) / 2) * 0.94, 0.25, 3.1);
  const bayesGoalsHome = clamp(
    ((shrinkRate(homeGoalsRate, home.played) + shrinkRate(awayConcedeRate, away.played)) / 2) *
      1.06,
    0.35,
    3.3,
  );
  const bayesGoalsAway = clamp(
    ((shrinkRate(awayGoalsRate, away.played) + shrinkRate(homeConcedeRate, home.played)) / 2) *
      0.94,
    0.25,
    3.1,
  );
  const hThree = recentForm(home.form.slice(-3));
  const aThree = recentForm(away.form.slice(-3));
  const threeGap = hThree - aThree;
  const rankGap = clamp(away.pos - home.pos, -20, 20);
  const homeGoalDifference = home.played > 0 ? (home.gf - home.ga) / home.played : 0;
  const awayGoalDifference = away.played > 0 ? (away.gf - away.ga) / away.played : 0;
  const difference = homeGoalDifference - awayGoalDifference;
  const noAbsenceHome = namedAbsences(home);
  const noAbsenceAway = namedAbsences(away);
  const stressHome = clamp(adjusted.home * (1 - Math.min(noAbsenceHome, 4) * 0.06), 0.35, 3.3);
  const stressAway = clamp(adjusted.away * (1 - Math.min(noAbsenceAway, 4) * 0.06), 0.25, 3.1);
  const hDir = poissonDistribution(adjusted.home);
  const aDir = poissonDistribution(adjusted.away);

  const models: PredictorModel[] = [
    {
      id: "dixon-coles",
      name: "Dixon–Coles",
      method: "Adjusted xG with a low-score dependence correction.",
      probabilities: scoreTriple(adjusted.home, adjusted.away, true),
    },
    {
      id: "bayesian-xg",
      name: "Bayesian xG shrinkage",
      method: "Team rates are pulled toward a 1.35-goal prior when the sample is small.",
      probabilities: scoreTriple(bayesHome, bayesAway, true),
    },
    {
      id: "decayed-form",
      name: "Recency-decay form",
      method: "Recent results receive exponential weights; older form fades faster.",
      probabilities: scoreTriple(recencyHome, recencyAway, false),
    },
    {
      id: "strength-proxy",
      name: "Strength-rating proxy",
      method:
        "Rating proxy from table position, form, goal difference, and home advantage—not official Elo ratings.",
      probabilities: strengthProxy(home, away),
    },
    {
      id: "feature-logit",
      name: "Logistic feature model",
      method:
        "Softmax classifier-style score from xG gap, table gap, recent form, and listed absences; hand-set, not trained.",
      probabilities: logisticFeatures(home, away),
    },
    {
      id: "monte-carlo",
      name: "Monte Carlo · 2,400 runs",
      method:
        "Seeded score simulation from adjusted Poisson rates; repeatable for the same fixture inputs.",
      probabilities: monteCarlo(adjusted.home, adjusted.away, seed),
    },
    {
      id: "season-rate",
      name: "Season-rate baseline",
      method: "Season xG-for and xG-against without recent-form adjustments.",
      probabilities: scoreTriple(base.home, base.away, false),
    },
    {
      id: "negative-binomial",
      name: "Negative-binomial overdispersion",
      method:
        "Overdispersed goal counts with dispersion r=6; allows more scoreline variance than Poisson.",
      probabilities: tripleFromDistributions(
        negativeBinomialDistribution(adjusted.home),
        negativeBinomialDistribution(adjusted.away),
      ),
    },
    {
      id: "zero-inflated",
      name: "Zero-inflated low-score model",
      method:
        "Adds 10% extra zero-goal mass to each team's Poisson distribution; scenario assumption, not learned from history.",
      probabilities: tripleFromDistributions(zeroInflate(hDir, 0.1), zeroInflate(aDir, 0.1)),
    },
    {
      id: "bivariate",
      name: "Bivariate Poisson",
      method: "Shared latent goal component up to 0.12 plus independent scoring components.",
      probabilities: bivariatePoisson(adjusted.home, adjusted.away),
    },
    {
      id: "observed-goals",
      name: "Goals-for / goals-against",
      method: "Observed goals per game versus opponent concessions; does not use xG.",
      probabilities: scoreTriple(observedHome, observedAway, false),
    },
    {
      id: "bayes-goals",
      name: "Bayesian observed-goals",
      method:
        "Observed goals rates shrink toward a 1.35-goal prior using eight prior-match equivalents.",
      probabilities: scoreTriple(bayesGoalsHome, bayesGoalsAway, true),
    },
    {
      id: "last-three",
      name: "Last-three form tilt",
      method: "Exponential recency on the last three W/D/L marks tilts season xG rates.",
      probabilities: scoreTriple(
        clamp(base.home * (1 + threeGap * 0.25), 0.35, 3.3),
        clamp(base.away * (1 - threeGap * 0.25), 0.25, 3.1),
        false,
      ),
    },
    {
      id: "table-only",
      name: "Table-position-only",
      method:
        "League-rank gap maps to scoring rates with a small home factor; ignores xG and form.",
      probabilities: scoreTriple(
        clamp(1.35 + rankGap * 0.035, 0.35, 3.3),
        clamp(1.35 - rankGap * 0.035, 0.25, 3.1),
        false,
      ),
    },
    {
      id: "goal-difference",
      name: "Goal-difference model",
      method:
        "Season goal difference per game maps to scoring rates; no xG, form, or absence inputs.",
      probabilities: scoreTriple(
        clamp(1.5 + difference * 0.22, 0.35, 3.3),
        clamp(1.35 - difference * 0.22, 0.25, 3.1),
        false,
      ),
    },
    {
      id: "absence-stress",
      name: "Listed-absence stress",
      method:
        "Stress case applies a uniform 6% scoring reduction per named absence, capped at four; no player-specific impact data.",
      probabilities: scoreTriple(stressHome, stressAway, true),
    },
    {
      id: "neutral-venue",
      name: "Neutral-venue scenario",
      method: "Removes the base home multiplier (1.10) and away factor (0.92) before scoring.",
      probabilities: scoreTriple(
        clamp(base.home / 1.1, 0.35, 3.3),
        clamp(base.away / 0.92, 0.25, 3.1),
        false,
      ),
    },
    {
      id: "home-edge-stress",
      name: "Stronger home-edge scenario",
      method:
        "Stress case raises home rate 18% and trims away rate 10%; not a venue-specific estimate.",
      probabilities: scoreTriple(
        clamp(base.home * 1.18, 0.35, 3.3),
        clamp(base.away * 0.9, 0.25, 3.1),
        false,
      ),
    },
    {
      id: "dirichlet-form",
      name: "Dirichlet-smoothed W/D/L",
      method:
        "Recent W/D/L frequencies use a +1 prior for each result before mapping home wins, draws, and away wins.",
      probabilities: dirichletForm(home, away),
    },
    {
      id: "venue-split",
      name: "Home/away venue-form model",
      method: "Uses venue-specific recent form when verified; falls back to overall form when unavailable.",
      probabilities: venueSplitModel(home, away),
    },
    {
      id: "attack-defence-balance",
      name: "Attack/defence balance",
      method: "Matches each team's scoring strength against the opponent's conceded xG without copying bookmaker odds.",
      probabilities: attackDefenceBalance(home, away),
    },
    {
      id: "form-volatility",
      name: "Form-volatility model",
      method: "Adjusts the score distribution for observed W/D/L points volatility.",
      probabilities: volatilityModel(home, away),
    },
    {
      id: "xg-only-neutral",
      name: "Neutral xG baseline",
      method: "Compares season xG rates with the home-venue multiplier removed.",
      probabilities: scoreTriple(clamp((hAttack + aDefence) / 2, 0.35, 3.3), clamp((aAttack + hDefence) / 2, 0.25, 3.1), false),
    },
    {
      id: "form-only",
      name: "Recent-form only",
      method: "Uses the recent W/D/L signal with a modest home edge; ignores season xG.",
      probabilities: scoreTriple(clamp(1.25 + recencyGap * 0.7, 0.35, 3.3), clamp(1.25 - recencyGap * 0.7, 0.25, 3.1), true),
    },
    {
      id: "goal-trend",
      name: "Observed scoring trend",
      method: "Uses goals scored and conceded per match with a small-sample shrinkage prior.",
      probabilities: scoreTriple(bayesGoalsHome, bayesGoalsAway, false),
    },
    {
      id: "draw-conservative",
      name: "Conservative draw scenario",
      method: "Pulls both scoring rates toward an even, lower-tempo match to test draw sensitivity.",
      probabilities: scoreTriple((adjusted.home + 1.25) / 2, (adjusted.away + 1.25) / 2, true),
    },
    {
      id: "table-form-blend",
      name: "Table + form blend",
      method: "Combines league-position gap and recent form using small capped adjustments.",
      probabilities: scoreTriple(clamp(base.home * (1 + recencyGap * 0.12 + rankGap * 0.003), 0.35, 3.3), clamp(base.away * (1 - recencyGap * 0.12 - rankGap * 0.003), 0.25, 3.1), true),
    },
    {
      id: "low-tempo-stress",
      name: "Low-tempo stress test",
      method: "Reduces both expected-goal rates by 15% to test a slower-match scenario.",
      probabilities: scoreTriple(adjusted.home * 0.85, adjusted.away * 0.85, true),
    },
    {
      id: "venue-form-strength",
      name: "Venue-form strength",
      method: "Uses the home side's home W/D/L and away side's away W/D/L as a separate venue-only signal.",
      probabilities: scoreTriple(
        clamp(1.05 + venueRate(home, 0.4) * 1.25, 0.35, 3.3),
        clamp(1.05 + venueRate(away, 0.4) * 1.15, 0.25, 3.1),
        true,
      ),
    },
    {
      id: "goal-momentum",
      name: "Recent goal momentum",
      method: "Blends recent scoring/conceding rates with season rates without using bookmaker prices.",
      probabilities: scoreTriple(
        clamp(adjusted.home * (1 + (home.recentGoalsFor ?? home.gf) / Math.max(1, home.played * 3) * 0.12), 0.35, 3.3),
        clamp(adjusted.away * (1 + (away.recentGoalsFor ?? away.gf) / Math.max(1, away.played * 3) * 0.12), 0.25, 3.1),
        false,
      ),
    },
    {
      id: "form-separation",
      name: "Form separation",
      method: "Compares weighted recent W/D/L points and applies a capped directional adjustment.",
      probabilities: scoreTriple(
        clamp(adjusted.home * (1 + (formPoints(home.form) - formPoints(away.form)) * 0.025), 0.35, 3.3),
        clamp(adjusted.away * (1 - (formPoints(home.form) - formPoints(away.form)) * 0.025), 0.25, 3.1),
        true,
      ),
    },
  ];

  const ensemble = weightedEnsemble(models, learnedWeights);
  const pick = argmax(ensemble);
  const sortedOutcomes = Object.entries(ensemble).sort((a, b) => b[1] - a[1]);
  const outcomeMargin = sortedOutcomes[0][1] - sortedOutcomes[1][1];
  const homeFormVolatility = formPointsVolatility(home.form);
  const awayFormVolatility = formPointsVolatility(away.form);
  const tools = buildTools(home, away, adjusted.home, adjusted.away);
  tools.push(
    {
      id: "tool-top-margin",
      name: "Top-result margin",
      value: formatPercent(outcomeMargin),
      method:
        "Difference between the ensemble's top and second outcome probabilities; a narrow margin means the lean is fragile, not a confidence interval.",
    },
    {
      id: "tool-form-volatility",
      name: "Recent-form volatility · points SD",
      value: `${home.short} ${homeFormVolatility === null ? "n/a" : homeFormVolatility.toFixed(2)} · ${away.short} ${awayFormVolatility === null ? "n/a" : awayFormVolatility.toFixed(2)}`,
      method:
        "Population standard deviation of listed W/D/L points (3/1/0); it describes the short form sequence and is not opponent- or venue-adjusted.",
    },
  );
  const agreement = models.filter((model) => argmax(model.probabilities) === pick).length;
  const pickValues = models.map((model) => model.probabilities[pick]);
  const spread = Math.max(...pickValues) - Math.min(...pickValues);
  const sampleGames = Math.min(home.played, away.played);
  const adjustedScore = scoreTriple(adjusted.home, adjusted.away, true);
  const stressPicks = [
    argmax(scoreTriple(adjusted.home * 0.9, adjusted.away * 1.1, true)),
    argmax(adjustedScore),
    argmax(scoreTriple(adjusted.home * 1.1, adjusted.away * 0.9, true)),
  ];
  const stressStable = stressPicks.every((scenarioPick) => scenarioPick === pick);
  const riskFlags: string[] = [];
  if (sampleGames < 8) riskFlags.push("Small sample: fewer than 8 games for at least one side.");
  if (Math.min(home.form.length, away.form.length) < 3)
    riskFlags.push("Short recent-form sequence: fewer than 3 results for at least one side.");
  if (outcomeMargin < 0.05)
    riskFlags.push(
      "Narrow top-result margin: the leading outcome is less than 5 points ahead of second place.",
    );
  if (agreement < models.length / 2)
    riskFlags.push("Model split: fewer than half of the formula outputs share the ensemble lean.");
  if (spread >= 0.18)
    riskFlags.push("Wide model spread: estimated probability varies by at least 18 points.");
  if (ensemble.draw >= 0.3)
    riskFlags.push("Draw risk: the ensemble draw probability is at least 30%.");
  if (!stressStable) riskFlags.push("Fragile lean: a ±10% xG stress case changes the top outcome.");

  return {
    models,
    tools,
    ensemble,
    pick,
    outcomeMargin,
    agreement,
    agreementRate: agreement / models.length,
    spread,
    sampleGames,
    sampleLabel: sampleGames < 8 ? "limited" : sampleGames < 16 ? "moderate" : "broader",
    stressStable,
    stressPicks,
    riskFlags,
  };
}

export function predictorPickLabel(pick: keyof Triple, home: string, away: string) {
  if (pick === "home") return home;
  if (pick === "away") return away;
  return "Draw";
}

export function predictorShortLabel(pick: keyof Triple) {
  return pickName(pick);
}
