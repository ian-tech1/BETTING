import { create } from "zustand";
import { LEAGUE_CODES, type LeagueCode } from "@/data/weekend";
import type { OddsFormat } from "@/lib/format";
import { BOOKS, MARKET_KEYS, findMatch, type BookId, type MarketKey } from "@/lib/price";

export type DeskView = "live" | "ready" | "upcoming" | "jackpot" | "recent" | "slip" | "method";
export type LeagueFilter = "ALL" | LeagueCode;
export type MarketFocus = "1x2" | "btts" | "goals" | "corners" | "cards";
export type SortKey = "kickoff" | "chance" | "edge" | "xg" | "competition";
export type DayFilter = "ALL" | "Saturday" | "Sunday" | "Midweek";

export type SlipLeg = {
  matchId: string;
  market: MarketKey;
  /** Decimal the user read on their book. Empty means the desk estimate. */
  seenOdds?: number;
};

export type JackpotOutcome = "home" | "draw" | "away" | null;
export type JackpotBook = "betika" | "sportpesa" | "xbet" | "other";
export type ManualJackpotGame = {
  id: string;
  book: JackpotBook;
  bookmaker: string;
  league: string;
  when: string;
  home: string;
  away: string;
  odds: { home: number; draw: number; away: number };
  enteredAt: string;
};

const MARKETS = new Set<MarketKey>(MARKET_KEYS);
const BOOKS_SET = new Set<string>(BOOKS.map((book) => book.id));
function isManualJackpotGame(value: unknown): value is ManualJackpotGame {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ManualJackpotGame>;
  const odds = row.odds;
  return (
    typeof row.id === "string" &&
    row.id.length <= 200 &&
    row.id.startsWith("manual-") &&
    (row.book === "betika" ||
      row.book === "sportpesa" ||
      row.book === "xbet" ||
      row.book === "other") &&
    typeof row.bookmaker === "string" &&
    row.bookmaker.trim().length > 0 &&
    row.bookmaker.length <= 40 &&
    typeof row.league === "string" &&
    row.league.length <= 80 &&
    typeof row.when === "string" &&
    row.when.length <= 80 &&
    typeof row.home === "string" &&
    row.home.trim().length > 0 &&
    row.home.length <= 80 &&
    typeof row.away === "string" &&
    row.away.trim().length > 0 &&
    row.away.length <= 80 &&
    typeof row.enteredAt === "string" &&
    Number.isFinite(Date.parse(row.enteredAt)) &&
    !!odds &&
    [odds.home, odds.draw, odds.away].every(
      (odd) => typeof odd === "number" && Number.isFinite(odd) && odd > 1.01 && odd <= 100,
    )
  );
}

function trimJackpotPicks(picks: Record<string, JackpotOutcome>) {
  return Object.fromEntries(Object.entries(picks).slice(-200));
}

const VIEWS = new Set<DeskView>([
  "live",
  "ready",
  "upcoming",
  "jackpot",
  "recent",
  "slip",
  "method",
]);

type DeskState = {
  view: DeskView;
  league: LeagueFilter;
  query: string;
  openId: string | null;
  previewId: string | null;
  bankroll: number;
  legs: SlipLeg[];
  bookId: BookId;
  placeId: BookId;
  showKes: boolean;
  oddsFormat: OddsFormat;
  marketFocus: MarketFocus;
  sortKey: SortKey;
  minEdge: number;
  onlyValue: boolean;
  onlyDesk: boolean;
  day: DayFilter;
  watchOnly: boolean;
  watch: string[];
  /** Decimal the user typed from their book, keyed by match and market. */
  quotes: Record<string, number>;
  /** Jackpot selections and manually checked fixtures are isolated by the signed-in account. */
  jackpotPicks: Record<string, JackpotOutcome>;
  manualJackpotGames: ManualJackpotGame[];
  setView: (view: DeskView) => void;
  setLeague: (league: LeagueFilter) => void;
  setQuery: (query: string) => void;
  setOpen: (openId: string | null) => void;
  setPreview: (previewId: string | null) => void;
  setBankroll: (bankroll: number) => void;
  setBookId: (bookId: BookId) => void;
  setPlaceId: (placeId: BookId) => void;
  setShowKes: (showKes: boolean) => void;
  setOddsFormat: (oddsFormat: OddsFormat) => void;
  setMarketFocus: (marketFocus: MarketFocus) => void;
  setSortKey: (sortKey: SortKey) => void;
  setMinEdge: (minEdge: number) => void;
  setOnlyValue: (onlyValue: boolean) => void;
  setOnlyDesk: (onlyDesk: boolean) => void;
  setDay: (day: DayFilter) => void;
  setWatchOnly: (watchOnly: boolean) => void;
  toggleWatch: (matchId: string) => void;
  setQuote: (matchId: string, market: MarketKey, odds: number | null) => void;
  toggleLeg: (matchId: string, market: MarketKey) => void;
  setSeenOdds: (matchId: string, market: MarketKey, odds: number | null) => void;
  setLegs: (legs: SlipLeg[]) => void;
  clearLegs: () => void;
  setJackpotPick: (id: string, pick: JackpotOutcome) => void;
  setJackpotPicks: (picks: Record<string, JackpotOutcome>) => void;
  addManualJackpotGame: (game: ManualJackpotGame) => void;
  removeManualJackpotGame: (id: string) => void;
};

export const useDesk = create<DeskState>((set, get) => ({
  view: "live",
  league: "ALL",
  query: "",
  openId: null,
  previewId: null,
  bankroll: 100,
  legs: [],
  bookId: "betika",
  placeId: "betika",
  showKes: false,
  oddsFormat: "decimal",
  marketFocus: "1x2",
  sortKey: "kickoff",
  minEdge: 0,
  onlyValue: false,
  onlyDesk: false,
  day: "ALL",
  watchOnly: false,
  watch: [],
  quotes: {},
  jackpotPicks: {},
  manualJackpotGames: [],
  setView: (view) => set({ view }),
  setLeague: (league) => set({ league }),
  setQuery: (query) => set({ query }),
  setOpen: (openId) => set({ openId }),
  setPreview: (previewId) => set({ previewId }),
  setBankroll: (bankroll) => set({ bankroll }),
  setBookId: (bookId) => set({ bookId }),
  setPlaceId: (placeId) => set({ placeId }),
  setShowKes: (showKes) => set({ showKes }),
  setOddsFormat: (oddsFormat) => set({ oddsFormat }),
  setMarketFocus: (marketFocus) => set({ marketFocus }),
  setSortKey: (sortKey) => set({ sortKey }),
  setMinEdge: (minEdge) => set({ minEdge }),
  setOnlyValue: (onlyValue) => set({ onlyValue }),
  setOnlyDesk: (onlyDesk) => set({ onlyDesk }),
  setDay: (day) => set({ day }),
  setWatchOnly: (watchOnly) => set({ watchOnly }),
  toggleWatch: (matchId) => {
    const watch = get().watch;
    set({
      watch: watch.includes(matchId) ? watch.filter((id) => id !== matchId) : [...watch, matchId],
    });
  },
  setQuote: (matchId, market, odds) => {
    const key = `${matchId}:${market}`;
    const quotes = { ...get().quotes };
    if (odds === null || odds < 1.01 || odds > 50) delete quotes[key];
    else quotes[key] = Math.round(odds * 100) / 100;
    const legs = get().legs.map((leg) =>
      leg.matchId === matchId && leg.market === market ? { ...leg, seenOdds: quotes[key] } : leg,
    );
    set({ quotes, legs });
  },
  toggleLeg: (matchId, market) => {
    const legs = get().legs;
    const same = legs.some((leg) => leg.matchId === matchId && leg.market === market);
    if (same) {
      set({ legs: legs.filter((leg) => !(leg.matchId === matchId && leg.market === market)) });
      return;
    }
    set({
      legs: [...legs, { matchId, market, seenOdds: get().quotes[`${matchId}:${market}`] }],
    });
  },
  setSeenOdds: (matchId, market, odds) => {
    set({
      legs: get().legs.map((leg) =>
        leg.matchId === matchId && leg.market === market
          ? { ...leg, seenOdds: odds ?? undefined }
          : leg,
      ),
    });
  },
  setLegs: (legs) => set({ legs }),
  clearLegs: () => set({ legs: [] }),
  setJackpotPick: (id, pick) =>
    set({ jackpotPicks: trimJackpotPicks({ ...get().jackpotPicks, [id]: pick }) }),
  setJackpotPicks: (jackpotPicks) => set({ jackpotPicks: trimJackpotPicks(jackpotPicks) }),
  addManualJackpotGame: (game) => {
    if (!isManualJackpotGame(game)) return;
    const games = get().manualJackpotGames.filter((item) => item.id !== game.id);
    set({ manualJackpotGames: [...games, game].slice(-24) });
  },
  removeManualJackpotGame: (id) =>
    set({ manualJackpotGames: get().manualJackpotGames.filter((game) => game.id !== id) }),
}));

const STORAGE_KEY = "sheetline-slip";

type Saved = {
  bankroll?: unknown;
  legs?: unknown;
  bookId?: unknown;
  placeId?: unknown;
  showKes?: unknown;
  oddsFormat?: unknown;
  marketFocus?: unknown;
  sortKey?: unknown;
  minEdge?: unknown;
  onlyValue?: unknown;
  onlyDesk?: unknown;
  day?: unknown;
  watchOnly?: unknown;
  watch?: unknown;
  quotes?: unknown;
  jackpotPicks?: unknown;
  manualJackpotGames?: unknown;
  league?: unknown;
  view?: unknown;
};

export function applySaved(raw: string) {
  try {
    const parsed = JSON.parse(raw) as Saved;
    hydrate(parsed);
  } catch {
    /* ignore a broken saved slip */
  }
}

export function clearPrivate() {
  useDesk.setState({
    bankroll: 100,
    legs: [],
    bookId: "betika",
    placeId: "betika",
    showKes: false,
    oddsFormat: "decimal",
    marketFocus: "1x2",
    sortKey: "kickoff",
    minEdge: 0,
    onlyValue: false,
    onlyDesk: false,
    day: "ALL",
    watchOnly: false,
    watch: [],
    quotes: {},
    league: "ALL",
    jackpotPicks: {},
    manualJackpotGames: [],
    openId: null,
    previewId: null,
  });
}

export function snapshot() {
  const state = useDesk.getState();
  const saved: Saved = {
    bankroll: state.bankroll,
    legs: state.legs,
    bookId: state.bookId,
    placeId: state.placeId,
    showKes: state.showKes,
    oddsFormat: state.oddsFormat,
    marketFocus: state.marketFocus,
    sortKey: state.sortKey,
    minEdge: state.minEdge,
    onlyValue: state.onlyValue,
    onlyDesk: state.onlyDesk,
    day: state.day,
    watchOnly: state.watchOnly,
    watch: state.watch,
    quotes: state.quotes,
    league: state.league,
    view: state.view,
    jackpotPicks: state.jackpotPicks,
    manualJackpotGames: state.manualJackpotGames,
  };
  return JSON.stringify(saved);
}

function hydrate(parsed: Saved) {
  const bankroll =
    typeof parsed.bankroll === "number" && parsed.bankroll >= 1 && parsed.bankroll <= 1_000_000
      ? parsed.bankroll
      : 100;
  const legs = Array.isArray(parsed.legs)
    ? parsed.legs.filter((leg): leg is SlipLeg => {
        if (!leg || typeof leg !== "object") return false;
        const row = leg as { matchId?: unknown; market?: unknown; seenOdds?: unknown };
        if (
          typeof row.matchId !== "string" ||
          typeof row.market !== "string" ||
          !MARKETS.has(row.market as MarketKey) ||
          !findMatch(row.matchId)
        ) {
          return false;
        }
        const seen =
          typeof row.seenOdds === "number" && row.seenOdds >= 1.01 && row.seenOdds <= 50
            ? row.seenOdds
            : undefined;
        (leg as SlipLeg).seenOdds = seen;
        return true;
      })
    : [];
  const bookId =
    typeof parsed.bookId === "string" && BOOKS_SET.has(parsed.bookId)
      ? (parsed.bookId as BookId)
      : "betika";
  const placeId =
    typeof parsed.placeId === "string" && BOOKS_SET.has(parsed.placeId)
      ? (parsed.placeId as BookId)
      : bookId;
  const oddsFormat =
    parsed.oddsFormat === "fractional" ||
    parsed.oddsFormat === "american" ||
    parsed.oddsFormat === "decimal"
      ? parsed.oddsFormat
      : "decimal";
  const marketFocus =
    parsed.marketFocus === "btts" ||
    parsed.marketFocus === "goals" ||
    parsed.marketFocus === "corners" ||
    parsed.marketFocus === "cards" ||
    parsed.marketFocus === "1x2"
      ? parsed.marketFocus
      : "1x2";
  const sortKey =
    parsed.sortKey === "kickoff" ||
    parsed.sortKey === "chance" ||
    parsed.sortKey === "xg" ||
    parsed.sortKey === "edge" ||
    parsed.sortKey === "competition"
      ? parsed.sortKey
      : "kickoff";
  const minEdge = parsed.minEdge === 2 || parsed.minEdge === 4 ? parsed.minEdge : 0;
  const league: LeagueFilter =
    typeof parsed.league === "string" && (LEAGUE_CODES as readonly string[]).includes(parsed.league)
      ? (parsed.league as LeagueCode)
      : "ALL";
  const view =
    typeof parsed.view === "string" && VIEWS.has(parsed.view as DeskView)
      ? (parsed.view as DeskView)
      : "live";
  const watch = Array.isArray(parsed.watch)
    ? parsed.watch.filter((id): id is string => typeof id === "string" && Boolean(findMatch(id)))
    : [];
  const quotes: Record<string, number> = {};
  if (parsed.quotes && typeof parsed.quotes === "object") {
    for (const [key, value] of Object.entries(parsed.quotes as Record<string, unknown>)) {
      if (typeof value === "number" && value >= 1.01 && value <= 50) quotes[key] = value;
    }
  }
  const jackpotPicks: Record<string, JackpotOutcome> = {};
  if (parsed.jackpotPicks && typeof parsed.jackpotPicks === "object") {
    for (const [id, pick] of Object.entries(parsed.jackpotPicks as Record<string, unknown>).slice(
      -200,
    )) {
      if (
        id.length <= 200 &&
        (pick === null || pick === "home" || pick === "draw" || pick === "away")
      )
        jackpotPicks[id] = pick;
    }
  }
  const manualJackpotGames = Array.isArray(parsed.manualJackpotGames)
    ? parsed.manualJackpotGames.filter(isManualJackpotGame).slice(-24)
    : [];
  useDesk.setState({
    bankroll,
    legs,
    bookId,
    placeId,
    showKes: parsed.showKes === true,
    oddsFormat,
    marketFocus,
    sortKey,
    minEdge,
    onlyValue: parsed.onlyValue === true,
    onlyDesk: parsed.onlyDesk === true,
    day:
      parsed.day === "Saturday" || parsed.day === "Sunday" || parsed.day === "Midweek"
        ? parsed.day
        : "ALL",
    watchOnly: parsed.watchOnly === true,
    watch,
    quotes,
    jackpotPicks,
    manualJackpotGames,
    league,
    view,
  });
}

export function loadSlip() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    applySaved(raw);
  } catch {
    /* ignore a broken saved slip */
  }
}

export function watchSlip() {
  return useDesk.subscribe((state) => {
    const saved: Saved = {
      bankroll: state.bankroll,
      legs: state.legs,
      bookId: state.bookId,
      placeId: state.placeId,
      showKes: state.showKes,
      oddsFormat: state.oddsFormat,
      marketFocus: state.marketFocus,
      sortKey: state.sortKey,
      minEdge: state.minEdge,
      onlyValue: state.onlyValue,
      onlyDesk: state.onlyDesk,
      day: state.day,
      watchOnly: state.watchOnly,
      watch: state.watch,
      quotes: state.quotes,
      league: state.league,
      view: state.view,
      jackpotPicks: state.jackpotPicks,
      manualJackpotGames: state.manualJackpotGames,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  });
}
