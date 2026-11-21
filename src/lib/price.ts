import { KICKOFF_ISO } from "@/data/kickoffs";
import { LIVE_RAW } from "@/data/live";
import { RECENT_RAW } from "@/data/recent";
import { MORE_MATCHES } from "@/data/more-fixtures";
import { REST_MATCHES } from "@/data/rest-fixtures";
import { RAW_MATCHES, type LeagueCode, type RawMatch, type Side } from "@/data/weekend";
import { adjustedLambdas, dixonTau } from "@/lib/engines";

export type MarketKey =
  | "home"
  | "draw"
  | "away"
  | "btts"
  | "over25"
  | "under25"
  | "over15"
  | "over35"
  | "corners95"
  | "red";

export const MARKET_KEYS: MarketKey[] = [
  "home",
  "draw",
  "away",
  "btts",
  "over25",
  "under25",
  "over15",
  "over35",
  "corners95",
  "red",
];

export const BOOKS = [
  { id: "pin", name: "Pinnacle", sharp: true, region: "Sharp", href: "https://www.pinnacle.com" },
  { id: "bf", name: "Betfair", sharp: true, region: "Sharp", href: "https://www.betfair.com" },
  { id: "betika", name: "Betika", sharp: false, region: "Kenya", href: "https://www.betika.com" },
  { id: "odi", name: "Odibets", sharp: false, region: "Kenya", href: "https://odibets.com" },
  { id: "sp", name: "SportPesa", sharp: false, region: "Kenya", href: "https://www.ke.sportpesa.com" },
  { id: "pawa", name: "betPawa", sharp: false, region: "Kenya", href: "https://www.betpawa.co.ke" },
  { id: "mozz", name: "MozzartBet", sharp: false, region: "Kenya", href: "https://www.mozzartbet.co.ke" },
  { id: "bang", name: "Bangbet", sharp: false, region: "Kenya", href: "https://www.bangbet.com" },
  { id: "xbet", name: "1xBet", sharp: false, region: "International", href: "https://1xbet.com" },
  { id: "22b", name: "22Bet", sharp: false, region: "International", href: "https://22bet.com" },
  { id: "mel", name: "Melbet", sharp: false, region: "International", href: "https://melbet.com" },
  { id: "b365", name: "Bet365", sharp: false, region: "International", href: "https://www.bet365.com" },
  { id: "wh", name: "William Hill", sharp: false, region: "International", href: "https://www.williamhill.com" },
  { id: "uni", name: "Unibet", sharp: false, region: "International", href: "https://www.unibet.com" },
  { id: "bw", name: "Betway", sharp: false, region: "International", href: "https://betway.com" },
  { id: "dk", name: "DraftKings", sharp: false, region: "International", href: "https://www.draftkings.com" },
  { id: "fd", name: "FanDuel", sharp: false, region: "International", href: "https://www.fanduel.com" },
] as const;

export type BookId = (typeof BOOKS)[number]["id"];

export type Confidence = "High" | "Solid" | "Thin" | "Outlier";

export type Edge = {
  market: MarketKey;
  model: number;
  consensus: number;
  edge: number;
  odds: number;
  book: string;
  bookId: BookId;
  ev: number;
  confidence: Confidence;
};

export type BookPrice = {
  id: BookId;
  name: string;
  sharp: boolean;
  odds: Record<MarketKey, number>;
};

export type PricedMatch = RawMatch & {
  model: Record<MarketKey, number>;
  books: BookPrice[];
  consensus: Record<MarketKey, number>;
  best: Record<MarketKey, { odds: number; book: string; bookId: BookId }>;
  edges: Edge[];
  /** Highest-probability match result. Not a guarantee and often a short price. */
  likely: Edge;
  /** Best plus-EV price that clears the desk filters, or null when the board says pass. */
  desk: Edge | null;
  lambdaHome: number;
  lambdaAway: number;
  score: string;
  goalDist: { goals: string; pct: number }[];
  read: string;
  extras: { corners: number; homeCorners: number; yellows: number };
  verifiedOdds?: { home: number; draw: number; away: number };
  verifiedOddsSource?: string;
  verifiedOddsCheckedAt?: string;
};

const MAX_GOALS = 8;

function poisson(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function shadeToward(ps: number[], index: number, amount: number): number[] {
  const next = ps.slice();
  const pool = next.reduce((sum, p, i) => (i === index ? sum : sum + p), 0);
  if (pool <= 0) return next;
  const shift = Math.min(amount, pool * 0.8);
  for (let i = 0; i < next.length; i++) {
    if (i !== index) next[i] -= shift * (next[i] / pool);
  }
  next[index] += shift;
  return next;
}

function blankOdds(): Record<MarketKey, number> {
  return {
    home: 0,
    draw: 0,
    away: 0,
    btts: 0,
    over25: 0,
    under25: 0,
    over15: 0,
    over35: 0,
    corners95: 0,
    red: 0,
  };
}

function cornerRead(lh: number, la: number) {
  const total = Math.min(14, Math.max(7, 6.6 + (lh + la) * 1.45));
  const home = total * (lh / (lh + la || 1));
  let under = 0;
  let p = Math.exp(-total);
  for (let k = 0; k <= 9; k++) {
    if (k > 0) p *= total / k;
    under += p;
  }
  return { total, home, over95: 1 - under };
}

function cardRead(lh: number, la: number) {
  const yellows = Math.min(6.4, Math.max(2.2, 2.5 + (lh + la) * 0.55));
  const red = 1 - Math.exp(-Math.min(0.36, 0.08 + yellows * 0.028));
  return { yellows, red };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Book = (typeof BOOKS)[number];

/** Decimal odds for a probability group, plus the de-vigged fair probs. */
function quoteGroup(
  probs: number[],
  book: Book,
  seed: string,
  publicIndex: number,
): { odds: number[]; fair: number[] } {
  const rand = rng(hashString(`${seed}:${book.id}`));
  const margin = book.sharp ? 0.02 + rand() * 0.012 : 0.048 + rand() * 0.03;
  const shade = book.sharp ? rand() * 0.01 : 0.018 + rand() * 0.05;
  const width = book.sharp ? 0.04 : 0.07;
  let next = shadeToward(probs, publicIndex, shade);
  next = next.map((p) => Math.max(0.025, p * (1 - width / 2 + rand() * width)));
  const sum = next.reduce((a, b) => a + b, 0);
  next = next.map((p) => p / sum);
  const odds = next.map((p) => round2(1 / Math.max(0.04, p * (1 + margin))));
  const implied = odds.map((o) => 1 / o);
  const impSum = implied.reduce((a, b) => a + b, 0);
  const fair = implied.map((p) => p / impSum);
  return { odds, fair };
}

function confidenceOf(edge: number): Confidence {
  const pts = edge * 100;
  if (pts < 2) return "Thin";
  if (pts <= 8) return "High";
  if (pts <= 13) return "Solid";
  return "Outlier";
}

function lambdas(home: Side, away: Side) {
  return adjustedLambdas(home, away);
}

function scoreMatrix(lh: number, la: number) {
  const homeP = Array.from({ length: MAX_GOALS }, (_, k) => poisson(k, lh));
  const awayP = Array.from({ length: MAX_GOALS }, (_, k) => poisson(k, la));
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pBtts = 0;
  let pOver = 0;
  let p15 = 0;
  let p35 = 0;
  const totals = Array.from({ length: 7 }, () => 0);
  let best = { h: 0, a: 0, p: 0 };
  for (let h = 0; h < MAX_GOALS; h++) {
    for (let a = 0; a < MAX_GOALS; a++) {
      const weight = dixonTau(h, a, lh, la);
      const p = homeP[h] * awayP[a] * weight;
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
      if (h > 0 && a > 0) pBtts += p;
      const t = h + a;
      if (t >= 2) p15 += p;
      if (t >= 3) pOver += p;
      if (t >= 4) p35 += p;
      if (t <= 6) totals[t] += p;
      if (p > best.p) best = { h, a, p };
    }
  }
  const mass = pHome + pDraw + pAway;
  return {
    model: {
      home: pHome / mass,
      draw: pDraw / mass,
      away: pAway / mass,
      btts: pBtts / mass,
      over25: pOver / mass,
      under25: 1 - pOver / mass,
      over15: p15 / mass,
      over35: p35 / mass,
      corners95: 0,
      red: 0,
    } satisfies Record<MarketKey, number>,
    score: `${best.h}–${best.a}`,
    goalDist: totals.map((p, goals) => ({
      goals: goals === 6 ? "6+" : String(goals),
      pct: Math.round((p / mass) * 1000) / 10,
    })),
  };
}

function phrase(match: RawMatch, market: MarketKey): string {
  switch (market) {
    case "home":
      return `${match.home.short} to win`;
    case "away":
      return `${match.away.short} to win`;
    case "draw":
      return "the draw";
    case "btts":
      return "both teams to score";
    case "over25":
      return "over 2.5 goals";
    case "under25":
      return "under 2.5 goals";
    case "over15":
      return "over 1.5 goals";
    case "over35":
      return "over 3.5 goals";
    case "corners95":
      return "over 9.5 corners";
    case "red":
      return "a red card";
  }
}

function buildRead(
  match: RawMatch,
  likely: Edge,
  desk: Edge | null,
  model: Record<MarketKey, number>,
): string {
  const h = Math.round(model.home * 100);
  const d = Math.round(model.draw * 100);
  const a = Math.round(model.away * 100);
  const split = `Chances: ${h}% ${match.home.short}, ${d}% draw, ${a}% ${match.away.short}. Most likely result is ${phrase(match, likely.market)} (${Math.round(likely.model * 100)}%).`;
  if (!desk) {
    const short = likely.odds < 1.7 ? ` ${phrase(match, likely.market)} is ${likely.odds.toFixed(2)}, which is too short to be the bet.` : "";
    return `${split}${short} A pick has to be at least 1.70 and no longer than 3.75, with an edge against the sharp prices. Otherwise it is a pass.`;
  }
  const price = `${phrase(match, desk.market)} at ${desk.odds.toFixed(2)} with ${desk.book} is ${(desk.edge * 100).toFixed(1)} pts above the de-vigged market (${(desk.ev * 100).toFixed(1)}% expected value).`;
  if (desk.market === likely.market) {
    return `${split} That side is also the soft price: ${price} Still not a promise.`;
  }
  return `${split} The plus-EV number is a different bet: ${price} Likely and value are not the same call.`;
}

const PUBLIC: Record<string, { side: 0 | 1 | 2; totals: 0 | 1; btts: 0 | 1 }> = {
  "lee-tot": { side: 2, totals: 0, btts: 0 },
  "ars-hul": { side: 0, totals: 0, btts: 0 },
  "ful-new": { side: 2, totals: 0, btts: 0 },
  "nfo-mci": { side: 2, totals: 0, btts: 0 },
  "bvb-elv": { side: 0, totals: 0, btts: 0 },
  "koe-b04": { side: 2, totals: 0, btts: 0 },
  "m05-bay": { side: 2, totals: 0, btts: 0 },
  "tor-lec": { side: 0, totals: 1, btts: 1 },
  "rom-sas": { side: 0, totals: 0, btts: 0 },
  "bha-bre": { side: 0, totals: 0, btts: 0 },
  "cry-liv": { side: 2, totals: 0, btts: 0 },
  "sun-che": { side: 2, totals: 0, btts: 0 },
  "ips-bou": { side: 2, totals: 0, btts: 1 },
  "mun-avl": { side: 0, totals: 0, btts: 0 },
  "val-rma": { side: 2, totals: 0, btts: 0 },
  "atm-bar": { side: 2, totals: 0, btts: 0 },
  "nap-laz": { side: 0, totals: 0, btts: 0 },
  "gen-mil": { side: 2, totals: 1, btts: 1 },
  "fio-juv": { side: 2, totals: 1, btts: 1 },
  "int-com": { side: 0, totals: 0, btts: 0 },
};

export function priceMatch(match: RawMatch): PricedMatch {
  const lam = lambdas(match.home, match.away);
  const scored = scoreMatrix(lam.home, lam.away);
  const corners = cornerRead(lam.home, lam.away);
  const cards = cardRead(lam.home, lam.away);
  const model = {
    ...scored.model,
    corners95: corners.over95,
    red: cards.red,
  };

  const books: BookPrice[] = BOOKS.map((book) => ({
    id: book.id,
    name: book.name,
    sharp: book.sharp,
    odds: blankOdds(),
  }));

  const fairSums = blankOdds();

  for (const book of BOOKS) {
    const row = books.find((b) => b.id === book.id)!;
    const pub = PUBLIC[match.id] ?? { side: 0 as const, totals: 0 as const, btts: 0 as const };
    const groups: { keys: MarketKey[]; probs: number[]; publicIndex: number; seed: string }[] = [
      {
        keys: ["home", "draw", "away"],
        probs: [model.home, model.draw, model.away],
        publicIndex: pub.side,
        seed: `${match.id}:1x2`,
      },
      {
        keys: ["btts"],
        probs: [model.btts, 1 - model.btts],
        publicIndex: pub.btts,
        seed: `${match.id}:btts`,
      },
      {
        keys: ["over25", "under25"],
        probs: [model.over25, model.under25],
        publicIndex: pub.totals,
        seed: `${match.id}:ou`,
      },
      {
        keys: ["over15"],
        probs: [model.over15, 1 - model.over15],
        publicIndex: 0,
        seed: `${match.id}:o15`,
      },
      {
        keys: ["over35"],
        probs: [model.over35, 1 - model.over35],
        publicIndex: 0,
        seed: `${match.id}:o35`,
      },
      {
        keys: ["corners95"],
        probs: [model.corners95, 1 - model.corners95],
        publicIndex: 0,
        seed: `${match.id}:corners`,
      },
      {
        keys: ["red"],
        probs: [model.red, 1 - model.red],
        publicIndex: 0,
        seed: `${match.id}:red`,
      },
    ];
    for (const group of groups) {
      const quoted = quoteGroup(group.probs, book, group.seed, group.publicIndex);
      group.keys.forEach((key, i) => {
        row.odds[key] = quoted.odds[i];
        if (book.sharp) fairSums[key] += quoted.fair[i];
      });
    }
  }

  const consensus = {} as Record<MarketKey, number>;
  const best = {} as PricedMatch["best"];
  const sharpCount = BOOKS.filter((book) => book.sharp).length;
  for (const key of MARKET_KEYS) {
    consensus[key] = fairSums[key] / sharpCount;
    let top = books[0];
    for (const b of books) if (b.odds[key] > top.odds[key]) top = b;
    best[key] = { odds: top.odds[key], book: top.name, bookId: top.id };
  }

  const edges: Edge[] = MARKET_KEYS.map((market) => {
    const odds = best[market].odds;
    const edge = model[market] - consensus[market];
    return {
      market,
      model: model[market],
      consensus: consensus[market],
      edge,
      odds,
      book: best[market].book,
      bookId: best[market].bookId,
      ev: model[market] * odds - 1,
      confidence: confidenceOf(edge),
    };
  }).sort((a, b) => b.ev - a.ev);

  const likely = edges
    .filter((e) => e.market === "home" || e.market === "draw" || e.market === "away")
    .sort((a, b) => b.model - a.model)[0];
  if (!likely) throw new Error(`No 1X2 price for ${match.id}`);

  const desk =
    edges.find((e) => e.ev >= 0.02 && e.edge >= 0.02 && e.odds >= 1.7 && e.odds <= 3.75 && e.model >= 0.28) ??
    null;

  return {
    ...match,
    model,
    books,
    consensus,
    best,
    edges,
    likely,
    desk,
    lambdaHome: lam.home,
    lambdaAway: lam.away,
    score: scored.score,
    goalDist: scored.goalDist,
    read: buildRead(match, likely, desk, model),
    extras: { corners: corners.total, homeCorners: corners.home, yellows: cards.yellows },
  };
}

export const MATCHES: PricedMatch[] = [...RAW_MATCHES, ...MORE_MATCHES, ...REST_MATCHES].map(priceMatch);

export const LEAGUES: { code: LeagueCode | "ALL"; label: string }[] = [
  { code: "ALL", label: "All" },
  { code: "EPL", label: "EPL" },
  { code: "UCL", label: "UCL" },
  { code: "UEL", label: "Europa" },
  { code: "UEC", label: "UECL" },
  { code: "LIB", label: "Libertadores" },
  { code: "SUD", label: "Sudamericana" },
  { code: "LAL", label: "La Liga" },
  { code: "SEA", label: "Serie A" },
  { code: "BUN", label: "Bundesliga" },
  { code: "B2", label: "2. Bundesliga" },
  { code: "FRA", label: "Ligue 1" },
  { code: "ERE", label: "Eredivisie" },
  { code: "POR", label: "Portugal" },
  { code: "CHP", label: "Championship" },
  { code: "L1", label: "League One" },
  { code: "SPL", label: "Scotland" },
  { code: "MLS", label: "MLS" },
  { code: "MEX", label: "Liga MX" },
  { code: "BRA", label: "Brazil" },
  { code: "ARG", label: "Argentina" },
  { code: "TUR", label: "Turkey" },
  { code: "BEL", label: "Belgium" },
  { code: "GRE", label: "Greece" },
  { code: "AUT", label: "Austria" },
  { code: "SUI", label: "Switzerland" },
  { code: "SAU", label: "Saudi" },
  { code: "J1", label: "J.League" },
  { code: "KEN", label: "Kenya" },
  { code: "NGA", label: "Nigeria" },
  { code: "RSA", label: "South Africa" },
  { code: "EGY", label: "Egypt" },
];

export function selectionName(match: PricedMatch, market: MarketKey): string {
  switch (market) {
    case "home":
      return `${match.home.name} to win`;
    case "away":
      return `${match.away.name} to win`;
    case "draw":
      return "Draw";
    case "btts":
      return "Both teams to score";
    case "over25":
      return "Over 2.5 goals";
    case "under25":
      return "Under 2.5 goals";
    case "over15":
      return "Over 1.5 goals";
    case "over35":
      return "Over 3.5 goals";
    case "corners95":
      return "Over 9.5 corners";
    case "red":
      return "A red card";
  }
}

export function shortMarket(match: PricedMatch, market: MarketKey): string {
  switch (market) {
    case "home":
      return match.home.short;
    case "away":
      return match.away.short;
    case "draw":
      return "Draw";
    case "btts":
      return "BTTS";
    case "over25":
      return "Over 2.5";
    case "under25":
      return "Under 2.5";
    case "over15":
      return "Over 1.5";
    case "over35":
      return "Over 3.5";
    case "corners95":
      return "Corners 9.5";
    case "red":
      return "Red card";
  }
}

export function marketLabel(market: MarketKey): string {
  switch (market) {
    case "home":
      return "Home";
    case "draw":
      return "Draw";
    case "away":
      return "Away";
    case "btts":
      return "BTTS";
    case "over25":
      return "O 2.5";
    case "under25":
      return "U 2.5";
    case "over15":
      return "O 1.5";
    case "over35":
      return "O 3.5";
    case "corners95":
      return "Corners";
    case "red":
      return "Red card";
  }
}

/** Quarter-Kelly, capped at 4% of bankroll. */
export function suggestedStake(edge: Edge, bankroll: number): number {
  if (edge.ev <= 0 || bankroll <= 0 || edge.odds < 1.7) return 0;
  const b = edge.odds - 1;
  if (b <= 0) return 0;
  const full = (b * edge.model - (1 - edge.model)) / b;
  const capped = Math.min(Math.max(0, full) * 0.25, 0.04);
  return Math.round(capped * bankroll * 100) / 100;
}

export function findMatch(id: string): PricedMatch | undefined {
  return findAny(id);
}

export type FlatEdge = Edge & { match: PricedMatch };

export function rankedEdges(): FlatEdge[] {
  return MATCHES.flatMap((match) =>
    match.edges
      .filter((e) => e.ev >= 0.02 && e.edge >= 0.02 && e.odds >= 1.7 && e.odds <= 3.75 && e.model >= 0.28)
      .map((e) => ({ ...e, match })),
  ).sort((a, b) => b.ev - a.ev);
}

export type SettledMatch = PricedMatch & {
  homeGoals: number;
  awayGoals: number;
  playedLabel: string;
};

export const RECENT: SettledMatch[] = RECENT_RAW.map((row) => {
  const priced = priceMatch(row);
  return {
    ...priced,
    homeGoals: row.homeGoals,
    awayGoals: row.awayGoals,
    playedLabel: row.playedLabel,
  };
});

export const LIVE: PricedMatch[] = LIVE_RAW.map((row) => priceMatch(row));

export function findAny(id: string): PricedMatch | undefined {
  return MATCHES.find((m) => m.id === id) ?? RECENT.find((m) => m.id === id) ?? LIVE.find((m) => m.id === id);
}

export function quoteAt(match: PricedMatch, bookId: BookId, market: MarketKey) {
  const book = match.books.find((row) => row.id === bookId) ?? match.books[0];
  const odds = book.odds[market];
  return {
    odds,
    book: book.name,
    bookId: book.id,
    edge: match.model[market] - match.consensus[market],
    ev: match.model[market] * odds - 1,
  };
}

export function fairOdds(probability: number): number {
  return Math.round((1 / Math.max(0.02, probability)) * 100) / 100;
}

export function doubleChance(match: PricedMatch): { label: string; probability: number; fair: number } {
  const pairs = [
    { label: `${match.home.short} or draw`, probability: match.model.home + match.model.draw },
    { label: `${match.away.short} or draw`, probability: match.model.away + match.model.draw },
    { label: `${match.home.short} or ${match.away.short}`, probability: match.model.home + match.model.away },
  ];
  const best = pairs.sort((a, b) => b.probability - a.probability)[0];
  return { ...best, fair: fairOdds(best.probability) };
}

export function kickoffMs(id: string): number | null {
  const iso = KICKOFF_ISO[id];
  return iso ? Date.parse(iso) : null;
}

function mix(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny demo drift so the board feels live. Not a bookmaker feed. */
export function tapeOdds(base: number, seed: string, bucket: number): number {
  const swing = (mix(`${seed}:${bucket}`) % 5) - 2;
  return Math.round(Math.max(1.01, base + swing * 0.01) * 100) / 100;
}

export function modelRecord(): { hit: number; n: number } {
  let hit = 0;
  for (const match of RECENT) {
    const actual =
      match.homeGoals > match.awayGoals ? "home" : match.homeGoals < match.awayGoals ? "away" : "draw";
    if (actual === match.likely.market) hit += 1;
  }
  return { hit, n: RECENT.length };
}

export function actualSide(match: SettledMatch): "home" | "draw" | "away" {
  if (match.homeGoals > match.awayGoals) return "home";
  if (match.homeGoals < match.awayGoals) return "away";
  return "draw";
}
