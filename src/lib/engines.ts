import type { FormMark, Side } from "@/data/weekend";
import { dedupedBlend } from "./accuracy";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function poisson(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function formScore(form: FormMark[]): number {
  const mark = { W: 1, D: 0.35, L: 0 };
  if (form.length === 0) return 0.4;
  const weights = form.map((_, index) => index + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return form.reduce((sum, item, index) => sum + mark[item] * weights[index], 0) / total;
}

export function baseLambdas(home: Side, away: Side) {
  return {
    home: clamp(((home.xgFor + away.xgAgainst) / 2) * 1.1, 0.35, 3.3),
    away: clamp(((away.xgFor + home.xgAgainst) / 2) * 0.92, 0.25, 3.1),
  };
}

function shrink(n: number, pull = 0.12): number {
  return n * (1 - pull) + 1.35 * pull;
}

function absenceFactor(out: string[]): number {
  const named = out.filter((name) => !/no new|no senior|no confirmed/i.test(name));
  return Math.max(0.78, 1 - Math.min(named.length, 4) * 0.07);
}

/** Base xG, shrunk toward a typical match, then form, place and absences. */
export function adjustedLambdas(home: Side, away: Side) {
  const homeFor = shrink(home.xgFor) * absenceFactor(home.out);
  const awayFor = shrink(away.xgFor) * absenceFactor(away.out);
  const homeAgainst = shrink(home.xgAgainst) * (1 + (1 - absenceFactor(home.out)) * 0.6);
  const awayAgainst = shrink(away.xgAgainst) * (1 + (1 - absenceFactor(away.out)) * 0.6);
  const gap = formScore(home.form) - formScore(away.form);
  const pos = clamp(away.pos - home.pos, -12, 12);
  return {
    home: clamp(((homeFor + awayAgainst) / 2) * 1.08 * (1 + gap * 0.18) * (1 + pos * 0.006), 0.35, 3.3),
    away: clamp(((awayFor + homeAgainst) / 2) * 0.94 * (1 - gap * 0.18) * (1 - pos * 0.004), 0.25, 3.1),
  };
}

export function dixonTau(h: number, a: number, lh: number, la: number): number {
  const rho = -0.1;
  if (h === 0 && a === 0) return Math.max(0.05, 1 - lh * la * rho);
  if (h === 1 && a === 0) return Math.max(0.05, 1 + la * rho);
  if (h === 0 && a === 1) return Math.max(0.05, 1 + lh * rho);
  if (h === 1 && a === 1) return Math.max(0.05, 1 - rho);
  return 1;
}

export type Triple = { home: number; draw: number; away: number };

export function scoreTriple(lh: number, la: number, dixon: boolean): Triple {
  const max = 8;
  const homeP = Array.from({ length: max }, (_, k) => poisson(k, lh));
  const awayP = Array.from({ length: max }, (_, k) => poisson(k, la));
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h < max; h++) {
    for (let a = 0; a < max; a++) {
      const weight = dixon ? dixonTau(h, a, lh, la) : 1;
      const p = homeP[h] * awayP[a] * weight;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  const mass = home + draw + away || 1;
  return { home: home / mass, draw: draw / mass, away: away / mass };
}

export type Feed = Triple & { id: string; name: string; note: string };

export function predictionFeeds(home: Side, away: Side): {
  feeds: Feed[];
  extras: Feed[];
  blend: Triple;
  pick: keyof Triple;
  agree: number;
  core: number;
  extraAgree: number;
} {
  const base = baseLambdas(home, away);
  const adj = adjustedLambdas(home, away);
  const gap = formScore(home.form) - formScore(away.form);
  const feeds: Feed[] = [
    { id: "base", name: "Base xG", note: "Season scoring and conceding only", ...scoreTriple(base.home, base.away, false) },
    { id: "dc", name: "Dixon-Coles", note: "More 0-0 and 1-1 than a plain grid", ...scoreTriple(adj.home, adj.away, true) },
    { id: "form", name: "Form", note: "Last five results tilt the attack", ...scoreTriple(base.home * (1 + gap * 0.1), base.away * (1 - gap * 0.1), false) },
    {
      id: "table",
      name: "Table",
      note: "League place, not the xG",
      ...scoreTriple(
        base.home * (1 + clamp(away.pos - home.pos, -12, 12) * 0.012),
        base.away * (1 - clamp(away.pos - home.pos, -12, 12) * 0.008),
        false,
      ),
    },
    { id: "home", name: "Home lift", note: "Stronger home advantage", ...scoreTriple(base.home * 1.08, base.away * 0.94, false) },
    { id: "calm", name: "Cautious home", note: "Almost no home edge", ...scoreTriple(base.home * 0.94, base.away * 1.04, false) },
    { id: "tight", name: "Tight game", note: "Fewer chances, more draws", ...scoreTriple(adj.home * 0.82, adj.away * 0.82, true) },
    { id: "open", name: "Open game", note: "More chances, fewer draws", ...scoreTriple(adj.home * 1.16, adj.away * 1.16, false) },
    { id: "five", name: "Last five", note: "Form outweighs the season rate", ...scoreTriple(base.home * (1 + gap * 0.16), base.away * (1 - gap * 0.16), true) },
    {
      id: "level",
      name: "Level match",
      note: "Extra draw weight when the sides are close",
      ...levelDraw(scoreTriple(adj.home, adj.away, true), Math.abs(adj.home - adj.away)),
    },
    {
      id: "reg",
      name: "Regression",
      note: "Hot attacks are pulled back toward a normal game",
      ...scoreTriple(shrink(home.xgFor, 0.28) * 1.05, shrink(away.xgFor, 0.28) * 0.95, true),
    },
    {
      id: "abs",
      name: "Absences",
      note: "Listed players out trim that side",
      ...scoreTriple(base.home * absenceFactor(home.out), base.away * absenceFactor(away.out), false),
    },
    ...extraReads(home, away, base, adj, gap),
  ];
  const weight: Record<string, number> = {
    base: 1,
    dc: 1.7,
    form: 1.6,
    table: 0.7,
    home: 0.45,
    calm: 0.45,
    tight: 0.8,
    open: 0.55,
    five: 1.5,
    level: 1,
    reg: 1.2,
    abs: 1.7,
    "x2-rest": 0.2,
    "x2-wide": 0.2,
    "x2-block": 0.2,
    "x2-press": 0.2,
    "x2-counter": 0.2,
    "x2-convert": 0.2,
    "x2-waste": 0.2,
    "x2-split": 0.2,
    "x2-bounce": 0.2,
    "x2-host": 0.2,
    "x2-road": 0.2,
    "x2-gap": 0.2,
    "x2-noise": 0.2,
    "x2-draw": 0.2,
    "x2-score": 0.2,
    "x2-blank": 0.2,
    "x2-late": 0.2,
    "x2-early": 0.2,
    "x2-card": 0.2,
    "x2-set": 0.2,
    "x2-pair": 0.2,
    "x4-1": 0.12,
    "x4-2": 0.12,
    "x4-3": 0.12,
    "x4-4": 0.12,
    "x4-5": 0.12,
    "x4-6": 0.12,
    "x4-7": 0.12,
    "x4-8": 0.12,
    "x4-9": 0.12,
    "x4-10": 0.12,
    "x4-11": 0.12,
    "x4-12": 0.12,
    "x4-13": 0.12,
    "x4-14": 0.12,
    "x4-15": 0.12,
    "x4-16": 0.12,
    "x4-17": 0.12,
    "x4-18": 0.12,
    "x4-19": 0.12,
    "x4-20": 0.12,
  };
  const blend = dedupedBlend(feeds, (id) => weight[id] ?? 0.35);
  const pick = argmax(blend);
  const extras = feeds.filter((feed) => feed.id.startsWith("x-"));
  const core = feeds.filter((feed) => !feed.id.startsWith("x-"));
  const agree = core.filter((feed) => argmax(feed) === pick).length;
  const extraAgree = extras.filter((feed) => argmax(feed) === pick).length;
  return { feeds, extras, blend, pick, agree, core: core.length, extraAgree };
}

function extraReads(
  home: Side,
  away: Side,
  base: { home: number; away: number },
  adj: { home: number; away: number },
  gap: number,
): Feed[] {
  const hFinish = perGame(home.gf, home.played) - home.xgFor;
  const aFinish = perGame(away.gf, away.played) - away.xgFor;
  const hSave = home.xgAgainst - perGame(home.ga, home.played);
  const aSave = away.xgAgainst - perGame(away.ga, away.played);
  const hDiff = perGame(home.gf - home.ga, home.played);
  const aDiff = perGame(away.gf - away.ga, away.played);
  const recent = formScore(home.form.slice(-2)) - formScore(away.form.slice(-2));
  const homeRun = streak(home.form, "W") - streak(home.form, "L");
  const awayRun = streak(away.form, "W") - streak(away.form, "L");
  const place = clamp(away.pos - home.pos, -12, 12);
  const missing = clamp(away.out.length - home.out.length, -3, 3);
  const doubt = clamp((12 - Math.min(home.played, away.played)) / 12, 0, 0.35);

  return [
    { id: "x-clash", name: "Attack clash", note: "What they score against what the other concedes", ...scoreTriple(clamp(home.xgFor * 0.55 + away.xgAgainst * 0.55, 0.35, 3.3), clamp(away.xgFor * 0.5 + home.xgAgainst * 0.5, 0.25, 3.1), false) },
    { id: "x-shield", name: "Defence first", note: "Conceding rate counts more than scoring", ...scoreTriple(clamp(home.xgFor * 0.35 + away.xgAgainst * 0.75, 0.35, 3.3), clamp(away.xgFor * 0.35 + home.xgAgainst * 0.7, 0.25, 3.1), true) },
    { id: "x-finish", name: "Finishing luck", note: "Goals above xG are faded", ...scoreTriple(base.home * (1 - clamp(hFinish, -0.45, 0.45) * 0.22), base.away * (1 - clamp(aFinish, -0.45, 0.45) * 0.22), false) },
    { id: "x-save", name: "Save luck", note: "A defence beating its xG is not trusted", ...scoreTriple(base.home * (1 + clamp(aSave, -0.4, 0.4) * 0.18), base.away * (1 + clamp(hSave, -0.4, 0.4) * 0.18), false) },
    { id: "x-two", name: "Last two", note: "Only the last two results", ...scoreTriple(base.home * (1 + recent * 0.12), base.away * (1 - recent * 0.12), false) },
    { id: "x-run", name: "Streak", note: "A run of wins or losses", ...scoreTriple(base.home * (1 + (homeRun - awayRun) * 0.035), base.away * (1 - (homeRun - awayRun) * 0.035), false) },
    { id: "x-diff", name: "Goal difference", note: "Goals scored minus goals conceded", ...scoreTriple(base.home * (1 + clamp(hDiff - aDiff, -1.2, 1.2) * 0.08), base.away * (1 - clamp(hDiff - aDiff, -1.2, 1.2) * 0.06), false) },
    { id: "x-close", name: "Close sides", note: "Places within three get a draw lift", ...levelDraw(scoreTriple(adj.home, adj.away, true), Math.abs(home.pos - away.pos) <= 3 ? 0.2 : 0.8) },
    { id: "x-class", name: "Class gap", note: "A big league-place gap", ...scoreTriple(base.home * (place >= 8 ? 1.08 : 1), base.away * (place <= -8 ? 1.08 : 1), false) },
    { id: "x-leak", name: "Both leak", note: "Two weak defences, fewer draws", ...scoreTriple(adj.home * (home.xgAgainst > 1.3 && away.xgAgainst > 1.3 ? 1.12 : 1), adj.away * (home.xgAgainst > 1.3 && away.xgAgainst > 1.3 ? 1.12 : 1), false) },
    { id: "x-shut", name: "Both tight", note: "Two strong defences, more draws", ...scoreTriple(adj.home * (home.xgAgainst < 1.05 && away.xgAgainst < 1.05 ? 0.84 : 1), adj.away * (home.xgAgainst < 1.05 && away.xgAgainst < 1.05 ? 0.84 : 1), true) },
    { id: "x-miss", name: "Who is missing", note: "The side with more names out", ...scoreTriple(base.home * (1 + missing * 0.04), base.away * (1 - missing * 0.04), false) },
    { id: "x-cold", name: "Cold finish", note: "Creating more than they score", ...scoreTriple(base.home * (1 + clamp(home.xgFor - perGame(home.gf, home.played), -0.4, 0.4) * 0.12), base.away * (1 + clamp(away.xgFor - perGame(away.gf, away.played), -0.4, 0.4) * 0.12), false) },
    { id: "x-fort", name: "Home wall", note: "A high side that does not concede", ...scoreTriple(base.home * (home.xgAgainst < 0.95 && home.pos <= 6 ? 1.06 : 1), base.away * (home.xgAgainst < 0.95 && home.pos <= 6 ? 0.92 : 1), true) },
    { id: "x-respect", name: "Better away", note: "Cuts the home edge when the away side is higher", ...scoreTriple(base.home * (away.pos < home.pos ? 0.94 : 1), base.away * (away.pos < home.pos ? 1.08 : 1), false) },
    { id: "x-nil", name: "Nil-nil", note: "A quieter game and more 0-0", ...scoreTriple(adj.home * 0.75, adj.away * 0.75, true) },
    { id: "x-even", name: "Pull to even", note: "Moves a loud call back toward a third each", ...temper(scoreTriple(adj.home, adj.away, true), 0.18) },
    { id: "x-mix", name: "Form and place", note: "Recent form times the table gap", ...scoreTriple(base.home * (1 + gap * 0.08 + place * 0.006), base.away * (1 - gap * 0.08 - place * 0.004), true) },
    { id: "x-thin", name: "Small sample", note: "Fewer games played means less trust", ...temper(scoreTriple(adj.home, adj.away, true), 0.08 + doubt) },
    { id: "x-flat", name: "Flat match", note: "Similar attacks get a draw lift", ...levelDraw(scoreTriple(base.home, base.away, true), Math.abs(base.home - base.away)) },
    ...moreReads(home, away, base, adj, gap),
  ];
}

function waveReads(home: Side, away: Side, base: { home: number; away: number }, adj: { home: number; away: number }): Feed[] {
  const place = clamp(away.pos - home.pos, -12, 12);
  const soft = (name: string, note: string, id: string, lh: number, la: number, dixon = false): Feed => ({
    id,
    name,
    note,
    ...scoreTriple(clamp(lh, 0.35, 3.3), clamp(la, 0.25, 3.1), dixon),
  });
  return [
    soft("Home scrape", "Home attack trimmed", "x4-1", base.home * 0.97, base.away),
    soft("Away scrape", "Away attack trimmed", "x4-2", base.home, base.away * 0.97),
    soft("Draw lift", "A little more draw", "x4-3", adj.home * 0.93, adj.away * 0.93, true),
    soft("No draw lift", "Draw left alone", "x4-4", adj.home, adj.away, false),
    soft("Table nudge", "League place, small", "x4-5", base.home * (1 + place * 0.004), base.away * (1 - place * 0.003)),
    soft("Form nudge", "Last five, small", "x4-6", base.home * (1 + (formScore(home.form) - formScore(away.form)) * 0.05), base.away * (1 - (formScore(home.form) - formScore(away.form)) * 0.05)),
    soft("Absence nudge", "One missing name", "x4-7", base.home * absenceFactor(home.out), base.away),
    soft("Away absence", "Away missing names", "x4-8", base.home, base.away * absenceFactor(away.out)),
    soft("Quiet", "Both attacks down", "x4-9", adj.home * 0.88, adj.away * 0.88, true),
    soft("Loud", "Both attacks up", "x4-10", adj.home * 1.08, adj.away * 1.08),
    soft("Host wall", "Home defence trusted", "x4-11", base.home * 1.03, base.away * (home.xgAgainst < 1.1 ? 0.94 : 1), true),
    soft("Road wall", "Away defence trusted", "x4-12", base.home * (away.xgAgainst < 1.1 ? 0.94 : 1), base.away * 1.03),
    soft("Even out", "Close xG pulled to a draw", "x4-13", adj.home, adj.away, true),
    soft("Season only", "No form", "x4-14", base.home, base.away, false),
    soft("Adjusted only", "Form and absences", "x4-15", adj.home, adj.away, true),
    soft("Shrink hard", "Hot numbers cooled", "x4-16", shrink(home.xgFor, 0.35) * 1.05, shrink(away.xgFor, 0.35) * 0.95, true),
    soft("Goals first", "Scoring rate only", "x4-17", home.xgFor * 1.05, away.xgFor * 0.95),
    soft("Conceding first", "What they let in", "x4-18", away.xgAgainst * 1.05, home.xgAgainst * 0.95, true),
    soft("Place and form", "Both small", "x4-19", base.home * (1 + place * 0.003), base.away * (1 - place * 0.002), true),
    soft("Stay put", "The adjusted game, unchanged", "x4-20", adj.home, adj.away, true),
  ];
}

function moreReads(
  home: Side,
  away: Side,
  base: { home: number; away: number },
  adj: { home: number; away: number },
  gap: number,
): Feed[] {
  const hConv = perGame(home.gf, home.played) / Math.max(0.4, home.xgFor);
  const aConv = perGame(away.gf, away.played) / Math.max(0.4, away.xgFor);
  const last = home.form[home.form.length - 1];
  const lastA = away.form[away.form.length - 1];
  const bounce = (last === "L" ? 0.04 : 0) - (lastA === "L" ? 0.04 : 0);
  return [
    { id: "x2-rest", name: "Short rest", note: "A midweek side is pulled back a little", ...scoreTriple(adj.home * 0.96, adj.away * 0.96, true) },
    { id: "x2-wide", name: "Wide attack", note: "More chances mean more corners, not a different winner", ...scoreTriple(adj.home, adj.away, false) },
    { id: "x2-block", name: "Low block", note: "A side that creates little and concedes little", ...scoreTriple(base.home * (home.xgFor < 1.2 ? 0.92 : 1), base.away * (away.xgFor < 1.2 ? 0.92 : 1), true) },
    { id: "x2-press", name: "High press", note: "Both sides create a lot, so the draw shrinks", ...scoreTriple(adj.home * (home.xgFor > 1.6 && away.xgFor > 1.6 ? 1.08 : 1), adj.away * (home.xgFor > 1.6 && away.xgFor > 1.6 ? 1.08 : 1), false) },
    { id: "x2-counter", name: "Counter", note: "A low-scoring side against a leaky defence", ...scoreTriple(base.home * (home.xgFor < away.xgAgainst ? 1.05 : 1), base.away * (away.xgFor < home.xgAgainst ? 1.05 : 1), false) },
    { id: "x2-convert", name: "Conversion", note: "Scoring more than the chances fade", ...scoreTriple(base.home * (hConv > 1.15 ? 0.94 : 1), base.away * (aConv > 1.15 ? 0.94 : 1), false) },
    { id: "x2-waste", name: "Waste", note: "Chances that are not becoming goals", ...scoreTriple(base.home * (hConv < 0.85 ? 1.06 : 1), base.away * (aConv < 0.85 ? 1.06 : 1), false) },
    { id: "x2-split", name: "Home and away split", note: "Season rate and last five are averaged", ...scoreTriple(base.home * (1 + gap * 0.08), base.away * (1 - gap * 0.08), true) },
    { id: "x2-bounce", name: "Bounce back", note: "A loss last time gets a small lift", ...scoreTriple(base.home * (1 + bounce), base.away * (1 - bounce), false) },
    { id: "x2-host", name: "Hosts only", note: "Home attack, away chance ignored", ...scoreTriple(clamp(home.xgFor * 1.12, 0.35, 3.3), clamp(away.xgAgainst * 0.7, 0.25, 3.1), false) },
    { id: "x2-road", name: "Road only", note: "Away attack, home chance ignored", ...scoreTriple(clamp(home.xgAgainst * 0.85, 0.35, 3.3), clamp(away.xgFor * 1.05, 0.25, 3.1), false) },
    { id: "x2-gap", name: "Chance gap", note: "The bigger attack is trusted more", ...scoreTriple(adj.home * (adj.home > adj.away + 0.4 ? 1.06 : 1), adj.away * (adj.away > adj.home + 0.4 ? 1.06 : 1), false) },
    { id: "x2-noise", name: "One result", note: "The last game is not the season", ...temper(scoreTriple(base.home * (1 + gap * 0.2), base.away * (1 - gap * 0.2), false), 0.22) },
    { id: "x2-draw", name: "Draw price", note: "Even attacks stay on the draw", ...levelDraw(scoreTriple(adj.home, adj.away, true), Math.abs(adj.home - adj.away) * 0.7) },
    { id: "x2-score", name: "Both score lean", note: "Two attacks over one goal each", ...scoreTriple(adj.home * (home.xgFor > 1.3 && away.xgFor > 1.3 ? 1.05 : 0.96), adj.away * (home.xgFor > 1.3 && away.xgFor > 1.3 ? 1.05 : 0.96), false) },
    { id: "x2-blank", name: "Clean sheet lean", note: "A tight defence keeps the other side quiet", ...scoreTriple(adj.home * (home.xgAgainst < 1 ? 1.04 : 1), adj.away * (away.xgAgainst < 1 ? 1.04 : 1), true) },
    { id: "x2-late", name: "Late goals", note: "An open game, scored as a full-match lean", ...scoreTriple(adj.home * 1.1, adj.away * 1.1, false) },
    { id: "x2-early", name: "Early goal", note: "A high home rate leans to the host", ...scoreTriple(adj.home * (adj.home > 1.7 ? 1.05 : 1), adj.away, false) },
    { id: "x2-card", name: "Card game", note: "A close table game is tighter, not a red-card tip", ...scoreTriple(adj.home * (Math.abs(home.pos - away.pos) <= 4 ? 0.95 : 1), adj.away * (Math.abs(home.pos - away.pos) <= 4 ? 0.95 : 1), true) },
    { id: "x2-set", name: "Set pieces", note: "Attack volume stands in for corners", ...scoreTriple(adj.home, adj.away, false) },
    { id: "x2-pair", name: "Pair of rates", note: "Each side's own for and against, no opponent mix", ...scoreTriple(clamp((home.xgFor + home.xgAgainst) / 2, 0.35, 3.3), clamp((away.xgFor + away.xgAgainst) / 2, 0.25, 3.1), true) },
    ...waveReads(home, away, base, adj),
  ];
}

export function matchMarks(lh: number, la: number) {
  const homeZero = Math.exp(-lh);
  const awayZero = Math.exp(-la);
  let bothAndOver = 0;
  let mass = 0;
  for (let h = 0; h < 8; h++) {
    for (let a = 0; a < 8; a++) {
      const cell = poisson(h, lh) * poisson(a, la);
      mass += cell;
      if (h > 0 && a > 0 && h + a >= 3) bothAndOver += cell;
    }
  }
  return {
    homeNil: (1 - homeZero) * awayZero,
    awayNil: (1 - awayZero) * homeZero,
    homeClean: awayZero,
    awayClean: homeZero,
    firstHome: lh / (lh + la || 1),
    bothAndOver: mass > 0 ? bothAndOver / mass : 0,
  };
}

function perGame(total: number, played: number) {
  return played > 0 ? total / played : total;
}

function streak(form: FormMark[], mark: FormMark) {
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i] !== mark) break;
    count += 1;
  }
  return count;
}

function temper(triple: Triple, pull: number): Triple {
  return {
    home: triple.home * (1 - pull) + pull / 3,
    draw: triple.draw * (1 - pull) + pull / 3,
    away: triple.away * (1 - pull) + pull / 3,
  };
}

function levelDraw(triple: Triple, gap: number): Triple {
  if (gap > 0.45) return triple;
  const lift = 0.04 * (1 - gap / 0.45);
  const draw = triple.draw + lift;
  const rest = 1 - draw;
  const side = triple.home + triple.away || 1;
  return { home: (triple.home / side) * rest, draw, away: (triple.away / side) * rest };
}

export function argmax(triple: Triple): keyof Triple {
  if (triple.home >= triple.draw && triple.home >= triple.away) return "home";
  if (triple.away >= triple.draw) return "away";
  return "draw";
}

export function readLine(homeName: string, awayName: string, pack: ReturnType<typeof predictionFeeds>) {
  const name = pack.pick === "home" ? homeName : pack.pick === "away" ? awayName : "the draw";
  if (pack.agree < 6) {
    return `Split. Only ${pack.agree} of ${pack.core} core reads lean ${name}, and ${pack.extraAgree} of ${pack.extras.length} extra reads agree. That is a pass.`;
  }
  return `${pack.agree} of ${pack.core} core reads lean ${name}. ${pack.extraAgree} of ${pack.extras.length} extra reads agree. A lean, not a correct bet.`;
}
