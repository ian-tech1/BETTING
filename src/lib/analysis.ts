import type { Triple } from "./engines";

export type Outcome = keyof Triple;
export type HistoricalMatch = {
  homeId: string;
  awayId: string;
  homeGoals: number;
  awayGoals: number;
  kickoffAt: string;
  season?: number;
  league?: string;
};
export type FreshnessSource = {
  name: string;
  observedAt: string | null;
  required: boolean;
  maxAgeHours?: number;
};
export type FreshnessReport = {
  status: "fresh" | "stale" | "missing";
  action: "allow" | "downgrade" | "pass";
  ageHours: number | null;
  reasons: string[];
};

const KEYS: Outcome[] = ["home", "draw", "away"];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finiteDate = (value: string) => Number.isFinite(Date.parse(value));

function normalize(p: Triple): Triple {
  const values = KEYS.map((key) => (Number.isFinite(p[key]) ? Math.max(0, p[key]) : 0));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!sum) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: values[0] / sum, draw: values[1] / sum, away: values[2] / sum };
}

/** Computes non-negative recovery time between completed fixture and kickoff. */
export function restDays(previousKickoff: string | null, nextKickoff: string): number | null {
  if (!previousKickoff || !finiteDate(previousKickoff) || !finiteDate(nextKickoff)) return null;
  const hours = (Date.parse(nextKickoff) - Date.parse(previousKickoff)) / 3_600_000;
  return hours >= 0 ? hours / 24 : null;
}

/** Small, bounded fatigue multiplier; unknown rest is neutral but remains an explicit missing signal. */
export function fatigueFactor(days: number | null, recentMatchesIn14Days = 0): number {
  if (days === null || !Number.isFinite(days)) return 1;
  const rest = days <= 2 ? 0.92 : days <= 3 ? 0.96 : days <= 4 ? 0.985 : days >= 9 ? 1.01 : 1;
  return clamp(rest - Math.max(0, recentMatchesIn14Days - 2) * 0.012, 0.86, 1.02);
}

/** Home/away PPG summaries from completed real results, kept separate from overall form. */
export function venuePpg(matches: HistoricalMatch[], teamId: string, venue: "home" | "away") {
  const selected = matches.filter((m) => venue === "home" ? m.homeId === teamId : m.awayId === teamId);
  const points = selected.reduce((sum, m) => {
    const gf = venue === "home" ? m.homeGoals : m.awayGoals;
    const ga = venue === "home" ? m.awayGoals : m.homeGoals;
    return sum + (gf > ga ? 3 : gf === ga ? 1 : 0);
  }, 0);
  return { games: selected.length, ppg: selected.length ? points / selected.length : null };
}

/** Shrink a venue PPG ratio toward neutral and cap its effect to avoid small-sample overreaction. */
export function venueSplitFactor(overallPpg: number | null, venueSpecificPpg: number | null, games: number, priorGames = 8) {
  if (games < 4 || overallPpg === null || venueSpecificPpg === null || overallPpg <= 0) return 1;
  const raw = venueSpecificPpg / overallPpg;
  return clamp(1 + (raw - 1) * (games / (games + priorGames)), 0.9, 1.1);
}

export type Stakes = "title-race" | "continental-race" | "relegation-risk" | "mid-table" | "unknown";
export function tableMotivation(position: number | null, totalTeams: number | null, gamesLeft: number | null): { stakes: Stakes; factor: number | null } {
  if (!position || !totalTeams || gamesLeft === null || !Number.isFinite(position + totalTeams + gamesLeft) || position < 1 || totalTeams < position || gamesLeft < 0) {
    return { stakes: "unknown", factor: null };
  }
  if (gamesLeft > 14) return { stakes: "unknown", factor: 1 };
  if (position <= 2) return { stakes: "title-race", factor: 1.02 };
  if (position <= 4) return { stakes: "continental-race", factor: 1.015 };
  if (position >= totalTeams - 2) return { stakes: "relegation-risk", factor: 1.02 };
  if (gamesLeft <= 5 && position > 6 && position < totalTeams - 4) return { stakes: "mid-table", factor: 0.99 };
  return { stakes: "unknown", factor: 1 };
}

/** Reweights a fair 1X2 market from two real timestamped quotes; null means not enough evidence. */
export function oddsMovement(opening: Triple | null, current: Triple | null): Triple | null {
  const fair = (o: Triple | null): Triple | null => {
    if (!o || KEYS.some((k) => !Number.isFinite(o[k]) || o[k] <= 1)) return null;
    return normalize({ home: 1 / o.home, draw: 1 / o.draw, away: 1 / o.away });
  };
  const a = fair(opening), b = fair(current);
  if (!a || !b) return null;
  return { home: b.home - a.home, draw: b.draw - a.draw, away: b.away - a.away };
}

/** Forecast-to-close comparison. This is not a placed-bet CLV without the user's actual taken price. */
export function closingLineComparison(model: Triple, closingOdds: Triple | null) {
  if (!closingOdds || KEYS.some((k) => !Number.isFinite(closingOdds[k]) || closingOdds[k] <= 1)) return null;
  const fairClose = normalize({ home: 1 / closingOdds.home, draw: 1 / closingOdds.draw, away: 1 / closingOdds.away });
  const p = normalize(model);
  const pick = KEYS.reduce((best, key) => p[key] > p[best] ? key : best, "home");
  return {
    pick,
    modelProbability: p[pick],
    closingFairProbability: fairClose[pick],
    probabilityGap: p[pick] - fairClose[pick],
    fairOddsGapPct: ((1 / fairClose[pick]) / (1 / p[pick]) - 1) * 100,
  };
}

/** Per-fixture source gate. Missing or stale required data cannot silently count as fresh. */
export function assessFreshness(sources: FreshnessSource[], nowMs = Date.now()): FreshnessReport {
  const reasons: string[] = [];
  const required = sources.filter((s) => s.required);
  if (!required.length) return { status: "missing", action: "pass", ageHours: null, reasons: ["No required source was declared."] };
  const ages = required.map((source) => {
    if (!source.observedAt || !finiteDate(source.observedAt)) {
      reasons.push(`${source.name}: timestamp missing`);
      return null;
    }
    const age = (nowMs - Date.parse(source.observedAt)) / 3_600_000;
    if (age < 0) {
      reasons.push(`${source.name}: timestamp is in the future`);
      return null;
    }
    if (age > (source.maxAgeHours ?? 24)) reasons.push(`${source.name}: stale (${age.toFixed(1)} h old)`);
    return age;
  });
  if (ages.some((age) => age === null)) return { status: "missing", action: "pass", ageHours: null, reasons };
  const maxAge = Math.max(...ages as number[]);
  const stale = required.some((s) => (nowMs - Date.parse(s.observedAt!)) / 3_600_000 > (s.maxAgeHours ?? 24));
  return {
    status: stale ? "stale" : "fresh",
    action: stale ? (maxAge > 48 ? "pass" : "downgrade") : "allow",
    ageHours: maxAge,
    reasons,
  };
}

/** Shrink league draw frequency toward the global prior and move only a bounded amount of probability. */
export function applyLeagueDrawPrior(p: Triple, leagueDraws: number, sample: number, globalDrawRate = 0.26, priorMatches = 60): Triple {
  if (sample < 20 || !Number.isFinite(leagueDraws) || leagueDraws < 0 || leagueDraws > sample) return normalize(p);
  const target = (leagueDraws + globalDrawRate * priorMatches) / (sample + priorMatches);
  const strength = sample / (sample + priorMatches);
  const shift = clamp((target - p.draw) * strength, -0.03, 0.03);
  const oldSides = p.home + p.away || 1;
  return normalize({ home: p.home - shift * (p.home / oldSides), draw: p.draw + shift, away: p.away - shift * (p.away / oldSides) });
}

/** Elo with between-season regression toward the global prior; caller supplies multi-season real results. */
export function multiSeasonElo(matches: HistoricalMatch[], options: { k?: number; homeEdge?: number; carry?: number } = {}) {
  const k = options.k ?? 20, homeEdge = options.homeEdge ?? 60, carry = clamp(options.carry ?? 0.75, 0, 1);
  const ratings = new Map<string, number>();
  const ordered = [...matches].filter((m) => m.homeId && m.awayId && m.homeId !== m.awayId && Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals) && m.homeGoals >= 0 && m.awayGoals >= 0 && finiteDate(m.kickoffAt)).sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
  let previousSeason: number | undefined;
  for (const m of ordered) {
    if (m.season !== undefined && previousSeason !== undefined && m.season !== previousSeason) {
      for (const [id, rating] of ratings) ratings.set(id, 1500 + (rating - 1500) * carry);
    }
    previousSeason = m.season ?? previousSeason;
    const rh = ratings.get(m.homeId) ?? 1500, ra = ratings.get(m.awayId) ?? 1500;
    const expected = 1 / (1 + 10 ** ((ra - (rh + homeEdge)) / 400));
    const actual = m.homeGoals > m.awayGoals ? 1 : m.homeGoals === m.awayGoals ? 0.5 : 0;
    const margin = Math.log(Math.abs(m.homeGoals - m.awayGoals) + 1) + 1;
    const delta = k * margin * (actual - expected);
    ratings.set(m.homeId, rh + delta);
    ratings.set(m.awayId, ra - delta);
  }
  return { ratings, matches: ordered.length, seasons: [...new Set(ordered.map((m) => m.season).filter((x): x is number => x !== undefined))].sort() };
}

export type DcModel = { intercept: number; homeAdvantage: number; rho: number; attack: Record<string, number>; defence: Record<string, number>; samples: number; halfLifeDays: number };
function factorial(n: number) { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; }
function poisson(k: number, lambda: number) { return Math.exp(-lambda) * lambda ** k / factorial(k); }
function tauAndDerivatives(h: number, a: number, lh: number, la: number, rho: number) {
  if (h === 0 && a === 0) { const t = 1 - lh * la * rho; return { t, gh: -lh * la * rho / t, ga: -lh * la * rho / t, gr: -lh * la / t }; }
  if (h === 0 && a === 1) { const t = 1 + lh * rho; return { t, gh: lh * rho / t, ga: 0, gr: lh / t }; }
  if (h === 1 && a === 0) { const t = 1 + la * rho; return { t, gh: 0, ga: la * rho / t, gr: la / t }; }
  if (h === 1 && a === 1) { const t = 1 - rho; return { t, gh: 0, ga: 0, gr: -1 / t }; }
  return { t: 1, gh: 0, ga: 0, gr: 0 };
}

/**
 * Fits attack/defence, home advantage, and low-score rho by time-decayed maximum likelihood.
 * Returns null for an under-sized or malformed corpus; do not market this as a trained model until present.
 */
export function fitTimeDecayedDixonColes(matches: HistoricalMatch[], options: { nowMs?: number; halfLifeDays?: number; minMatches?: number; iterations?: number } = {}): DcModel | null {
  const valid = matches.filter((m) => m.homeId && m.awayId && m.homeId !== m.awayId && Number.isInteger(m.homeGoals) && Number.isInteger(m.awayGoals) && m.homeGoals >= 0 && m.awayGoals >= 0 && finiteDate(m.kickoffAt));
  const minMatches = options.minMatches ?? 100;
  const teams = [...new Set(valid.flatMap((m) => [m.homeId, m.awayId]))];
  const appearances = new Map<string, number>();
  for (const m of valid) { appearances.set(m.homeId, (appearances.get(m.homeId) ?? 0) + 1); appearances.set(m.awayId, (appearances.get(m.awayId) ?? 0) + 1); }
  if (valid.length < minMatches || teams.length < 4 || teams.some((team) => (appearances.get(team) ?? 0) < 5)) return null;
  const halfLifeDays = options.halfLifeDays ?? 365;
  if (!(halfLifeDays > 0)) return null;
  const nowMs = options.nowMs ?? Date.now();
  const weights = valid.map((m) => Math.exp(-Math.LN2 * Math.max(0, (nowMs - Date.parse(m.kickoffAt)) / 86_400_000) / halfLifeDays));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const avg = valid.reduce((s, m, i) => s + (m.homeGoals + m.awayGoals) * weights[i], 0) / (2 * weightSum);
  let mu = Math.log(clamp(avg, 0.35, 3.5));
  let homeAdv = 0.08, rho = -0.06;
  const att = new Map(teams.map((t) => [t, 0]));
  const def = new Map(teams.map((t) => [t, 0]));
  const iterations = options.iterations ?? 250;
  const all = new Map<string, number>();
  all.set("mu", mu); all.set("homeAdv", homeAdv); all.set("rho", rho);
  for (const t of teams) { all.set(`a:${t}`, 0); all.set(`d:${t}`, 0); }
  const mom = new Map<string, number>(), vel = new Map<string, number>();
  // Adam state is held in these per-parameter maps to keep the optimizer deterministic and dependency-free.
  for (let iteration = 1; iteration <= iterations; iteration++) {
    const grad = new Map<string, number>();
    const add = (key: string, value: number) => grad.set(key, (grad.get(key) ?? 0) + value);
    for (let i = 0; i < valid.length; i++) {
      const match = valid[i], w = weights[i] / weightSum;
      const lh = clamp(Math.exp(mu + (att.get(match.homeId) ?? 0) - (def.get(match.awayId) ?? 0) + homeAdv), 0.08, 4.5);
      const la = clamp(Math.exp(mu + (att.get(match.awayId) ?? 0) - (def.get(match.homeId) ?? 0)), 0.08, 4.5);
      const corr = tauAndDerivatives(match.homeGoals, match.awayGoals, lh, la, rho);
      if (!(corr.t > 0.05)) continue;
      const gh = w * (match.homeGoals - lh + corr.gh);
      const ga = w * (match.awayGoals - la + corr.ga);
      add("mu", gh + ga); add("homeAdv", gh); add("rho", w * corr.gr);
      add(`a:${match.homeId}`, gh); add(`d:${match.awayId}`, -gh);
      add(`a:${match.awayId}`, ga); add(`d:${match.homeId}`, -ga);
    }
    for (const [key, value] of all) {
      const g = (grad.get(key) ?? 0) - (key.startsWith("a:") || key.startsWith("d:") ? 0.02 * value : 0);
      const m = 0.9 * (mom.get(key) ?? 0) + 0.1 * g;
      const v = 0.999 * (vel.get(key) ?? 0) + 0.001 * g * g;
      mom.set(key, m); vel.set(key, v);
      const mhat = m / (1 - 0.9 ** iteration), vhat = v / (1 - 0.999 ** iteration);
      all.set(key, value + 0.025 * mhat / (Math.sqrt(vhat) + 1e-8));
    }
    mu = clamp(all.get("mu") ?? mu, Math.log(0.35), Math.log(3.5));
    homeAdv = clamp(all.get("homeAdv") ?? homeAdv, -0.25, 0.35);
    rho = clamp(all.get("rho") ?? rho, -0.4, 0.4);
    // Center team effects to identify the model and avoid intercept/strength drift.
    const avgAtt = teams.reduce((s, t) => s + (all.get(`a:${t}`) ?? 0), 0) / teams.length;
    const avgDef = teams.reduce((s, t) => s + (all.get(`d:${t}`) ?? 0), 0) / teams.length;
    for (const t of teams) {
      const a = clamp((all.get(`a:${t}`) ?? 0) - avgAtt, -1.5, 1.5);
      const d = clamp((all.get(`d:${t}`) ?? 0) - avgDef, -1.5, 1.5);
      all.set(`a:${t}`, a); all.set(`d:${t}`, d); att.set(t, a); def.set(t, d);
    }
    all.set("mu", mu); all.set("homeAdv", homeAdv); all.set("rho", rho);
  }
  return { intercept: mu, homeAdvantage: homeAdv, rho, attack: Object.fromEntries(att), defence: Object.fromEntries(def), samples: valid.length, halfLifeDays };
}

/** Applies a fitted Dixon–Coles model to one pair; unknown teams have neutral team effects. */
export function fittedDcProbabilities(model: DcModel, homeId: string, awayId: string, maxGoals = 9): Triple {
  const lh = clamp(Math.exp(model.intercept + (model.attack[homeId] ?? 0) - (model.defence[awayId] ?? 0) + model.homeAdvantage), 0.08, 4.5);
  const la = clamp(Math.exp(model.intercept + (model.attack[awayId] ?? 0) - (model.defence[homeId] ?? 0)), 0.08, 4.5);
  let home = 0, draw = 0, away = 0;
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) {
    const corr = tauAndDerivatives(h, a, lh, la, model.rho).t;
    const p = poisson(h, lh) * poisson(a, la) * Math.max(0.01, corr);
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
  }
  return normalize({ home, draw, away });
}

export type ForecastRow = { league: string; final: Triple; result: Outcome; recordedAt: string; kickoffAt: string };
export function perLeagueAccuracy(rows: ForecastRow[]) {
  const groups = new Map<string, ForecastRow[]>();
  for (const row of rows) {
    if (!row.result || !finiteDate(row.recordedAt) || !finiteDate(row.kickoffAt) || Date.parse(row.recordedAt) >= Date.parse(row.kickoffAt)) continue;
    groups.set(row.league, [...(groups.get(row.league) ?? []), row]);
  }
  return [...groups.entries()].map(([league, xs]) => {
    const n = xs.length;
    const hits = xs.filter((r) => KEYS.reduce((a, b) => r.final[b] > r.final[a] ? b : a, "home") === r.result).length;
    const brier = xs.reduce((s, r) => s + KEYS.reduce((q, k) => q + (r.final[k] - (k === r.result ? 1 : 0)) ** 2, 0), 0) / n;
    const logLoss = -xs.reduce((s, r) => s + Math.log(Math.max(1e-9, r.final[r.result])), 0) / n;
    return { league, n, hitRate: hits / n, brier, logLoss };
  }).sort((a, b) => a.league.localeCompare(b.league));
}

/** Weather is a diagnostic only; no probability shift is implied. */
export function weatherDiagnostics(input: { windKmh?: number; precipitationMm?: number; temperatureC?: number }) {
  const flags: string[] = [];
  if (Number.isFinite(input.windKmh) && input.windKmh! >= 45) flags.push("High wind may affect passing and crossing.");
  if (Number.isFinite(input.precipitationMm) && input.precipitationMm! >= 2) flags.push("Heavy hourly precipitation may affect pitch conditions.");
  if (Number.isFinite(input.temperatureC) && (input.temperatureC! <= 0 || input.temperatureC! >= 32)) flags.push("Temperature is an extreme-matchday diagnostic.");
  return flags;
}
