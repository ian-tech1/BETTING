import { LEAGUE_CODES } from "@/data/weekend";
import { kickoffMs, quoteAt, type BookId, type MarketKey, type PricedMatch } from "@/lib/price";
import type { LeagueFilter, MarketFocus, SortKey } from "@/lib/desk-store";

const LEAGUE_ORDER = new Map(LEAGUE_CODES.map((code, index) => [code, index]));

export function matchDateKey(match: PricedMatch): string | null {
  const kickoff = kickoffMs(match.id);
  return kickoff === null ? null : new Date(kickoff).toISOString().slice(0, 10);
}

export function isUpcomingMatch(match: PricedMatch, now = Date.now()): boolean {
  const kickoff = kickoffMs(match.id);
  return kickoff !== null && kickoff > now;
}

export function focusedMarket(match: PricedMatch, focus: MarketFocus): MarketKey {
  if (focus === "btts") return "btts";
  if (focus === "corners") return "corners95";
  if (focus === "cards") return "red";
  if (focus === "goals") return match.model.over25 >= match.model.under25 ? "over25" : "under25";
  if (
    match.desk &&
    (match.desk.market === "home" || match.desk.market === "draw" || match.desk.market === "away")
  ) {
    return match.desk.market;
  }
  const longer = match.edges.find(
    (edge) =>
      (edge.market === "home" || edge.market === "draw" || edge.market === "away") &&
      edge.odds >= 1.7 &&
      edge.odds <= 3.75,
  );
  return longer?.market ?? match.likely.market;
}

export function passesFilters(
  match: PricedMatch,
  opts: {
    league: LeagueFilter;
    query: string;
    bookId: BookId;
    marketFocus: MarketFocus;
    minEdge: number;
    onlyValue: boolean;
    watchOnly: boolean;
    watch: string[];
  },
): boolean {
  if (opts.league !== "ALL" && match.code !== opts.league) return false;
  const q = opts.query.trim().toLowerCase();
  if (q) {
    const hay = `${match.home.name} ${match.away.name} ${match.league}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (opts.watchOnly && !opts.watch.includes(match.id)) return false;
  const market = focusedMarket(match, opts.marketFocus);
  const quote = quoteAt(match, opts.bookId, market);
  if (opts.onlyValue && quote.ev < 0.02) return false;
  if (opts.minEdge > 0 && quote.edge * 100 < opts.minEdge) return false;
  return true;
}

export function sortMatches(
  rows: PricedMatch[],
  sortKey: SortKey,
  bookId: BookId,
  focus: MarketFocus,
): PricedMatch[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (sortKey === "competition") {
      const leagueDifference =
        (LEAGUE_ORDER.get(a.code) ?? Number.MAX_SAFE_INTEGER) -
        (LEAGUE_ORDER.get(b.code) ?? Number.MAX_SAFE_INTEGER);
      if (leagueDifference !== 0) return leagueDifference;
      const aKickoff = kickoffMs(a.id) ?? Number.POSITIVE_INFINITY;
      const bKickoff = kickoffMs(b.id) ?? Number.POSITIVE_INFINITY;
      if (aKickoff !== bKickoff) return aKickoff - bKickoff;
      return a.home.name.localeCompare(b.home.name);
    }
    if (sortKey === "kickoff") return (kickoffMs(a.id) ?? 0) - (kickoffMs(b.id) ?? 0);
    if (sortKey === "chance") return b.likely.model - a.likely.model;
    if (sortKey === "xg") return b.lambdaHome + b.lambdaAway - (a.lambdaHome + a.lambdaAway);
    const ea = quoteAt(a, bookId, focusedMarket(a, focus)).ev;
    const eb = quoteAt(b, bookId, focusedMarket(b, focus)).ev;
    return eb - ea;
  });
  return copy;
}

export function groupMatchesByCompetition(rows: PricedMatch[]) {
  return LEAGUE_CODES.map((code) => ({
    code,
    rows: rows.filter((match) => match.code === code),
  })).filter((group) => group.rows.length > 0);
}
