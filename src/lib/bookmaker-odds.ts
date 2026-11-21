import { createServerFn } from "@tanstack/react-start";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { MATCHES } from "@/lib/price";
import { fetchSportPesaReference, type SportPesaReference } from "@/lib/odds-reference";

type Triple = { home: number; draw: number; away: number };
export type BookmakerQuote = {
  status: "found" | "no-quote" | "unsupported" | "unavailable" | "fixture-mismatch";
  checkedAt: string;
  sourceUrl: string;
  odds?: Triple;
  freshness: string;
  detail: string;
};
export type BoardOddsComparison = {
  checkedAt: string;
  betika: BookmakerQuote;
  sportpesa: SportPesaReference;
  xbet: { status: "unavailable"; detail: string; sourceUrl: string };
};

type BetikaRow = {
  home_team?: string;
  away_team?: string;
  start_time?: string;
  competition_name?: string;
  home_odd?: string;
  neutral_odd?: string;
  away_odd?: string;
  is_esport?: boolean;
  is_srl?: boolean;
};

const BETIKA_URL = "https://api.betika.com/v1/uo/matches";
const XBET_URL = "https://1xbet.com/en/line/football";
const BETIKA_BOARD = "https://www.betika.com/en-ke/";

function normalizeTeam(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(manchester united|manchester utd|man utd)\b/g, "manutd")
    .replace(/\b(nott'?m forest|nottingham forest)\b/g, "nottinghamforest")
    .replace(/\b(man city|manchester city)\b/g, "manchestercity")
    .replace(/\b(athletic club|athletic bilbao)\b/g, "athletic")
    .replace(/\b(fc|afc|sc|cf|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function sameTeam(left: string, right: string) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  return (
    a.length > 3 &&
    b.length > 3 &&
    (a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))))
  );
}

function checked(result: Omit<BookmakerQuote, "checkedAt">): BookmakerQuote {
  return { ...result, checkedAt: new Date().toISOString() };
}

function parseBetikaStart(value: string) {
  // Betika's public response uses Kenya local time without an offset.
  const date = new Date(`${value.replace(" ", "T")}+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

async function lookupBetika(matchId: string): Promise<BookmakerQuote> {
  const match = MATCHES.find((item) => item.id === matchId);
  const kickoff = KICKOFF_ISO[matchId];
  if (!match || !kickoff) {
    return checked({
      status: "unsupported",
      sourceUrl: BETIKA_BOARD,
      freshness: "Not checked",
      detail: "This fixture has no mapped upcoming kickoff; Betika odds were not matched.",
    });
  }
  const kickoffMs = Date.parse(kickoff);
  if (kickoffMs <= Date.now() - 2 * 60 * 60 * 1000) {
    return checked({
      status: "unsupported",
      sourceUrl: BETIKA_BOARD,
      freshness: "Pre-match fixture has ended",
      detail: "The kickoff has passed; no previous price is presented as current.",
    });
  }

  const url = new URL(BETIKA_URL);
  url.search = new URLSearchParams({
    page: "1",
    limit: "100",
    sport_id: "14",
    keyword: match.home.name,
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return checked({
      status: "unavailable",
      sourceUrl: BETIKA_BOARD,
      freshness: "Unavailable",
      detail: "Betika's public match list could not be reached. No demo line is substituted.",
    });
  }
  if (!response.ok) {
    return checked({
      status: "unavailable",
      sourceUrl: BETIKA_BOARD,
      freshness: `HTTP ${response.status}`,
      detail: "Betika's public match list did not return odds. No demo line is substituted.",
    });
  }

  let rows: BetikaRow[];
  try {
    const data = (await response.json()) as { data?: BetikaRow[] };
    rows = Array.isArray(data.data) ? data.data : [];
  } catch {
    return checked({
      status: "unavailable",
      sourceUrl: BETIKA_BOARD,
      freshness: "Invalid response",
      detail: "Betika returned data that could not be read as a match list.",
    });
  }

  const candidate = rows.filter((row) => {
    if (
      row.is_esport ||
      row.is_srl ||
      /women|wfc|esport|srl/i.test(`${row.home_team ?? ""} ${row.away_team ?? ""}`)
    )
      return false;
    return (
      sameTeam(row.home_team ?? "", match.home.name) &&
      sameTeam(row.away_team ?? "", match.away.name)
    );
  });
  const exact = candidate.find((row) => {
    const eventTime = row.start_time ? parseBetikaStart(row.start_time) : null;
    return eventTime !== null && Math.abs(eventTime - kickoffMs) <= 3 * 60 * 60 * 1000;
  });
  if (!exact) {
    return checked({
      status: candidate.length ? "fixture-mismatch" : "no-quote",
      sourceUrl: BETIKA_BOARD,
      freshness: "No exact current fixture quote",
      detail: candidate.length
        ? "Betika returned same-team rows with a kickoff that did not match this fixture; none are shown."
        : "No exact Betika 1X2 row was returned for both teams and kickoff. No demo or other bookmaker odds are substituted.",
    });
  }

  const prices = [Number(exact.home_odd), Number(exact.neutral_odd), Number(exact.away_odd)];
  if (!prices.every((value) => Number.isFinite(value) && value > 1.01 && value <= 100)) {
    return checked({
      status: "no-quote",
      sourceUrl: BETIKA_BOARD,
      freshness: "Incomplete 1X2 market",
      detail: "The exact Betika match did not return three valid decimal 1X2 prices.",
    });
  }
  return checked({
    status: "found",
    sourceUrl: BETIKA_BOARD,
    odds: { home: prices[0], draw: prices[1], away: prices[2] },
    freshness: `Betika event start ${exact.start_time ?? "unknown"}; check time is shown locally.`,
    detail: `Exact team and kickoff match from Betika's public football list${exact.competition_name ? ` (${exact.competition_name})` : ""}. Verify at Betika before use.`,
  });
}

const cache = new Map<string, { at: number; value: BoardOddsComparison }>();
const pending = new Map<string, Promise<BoardOddsComparison>>();

export const lookupBoardOdds = createServerFn({ method: "GET" })
  .validator((matchId: string) => {
    if (typeof matchId !== "string" || matchId.length > 80 || !/^[a-z0-9-]+$/i.test(matchId))
      throw new Error("Invalid fixture ID");
    return matchId;
  })
  .handler(async ({ data: matchId }) => {
    const cached = cache.get(matchId);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
    const running = pending.get(matchId);
    if (running) return running;
    const task = Promise.all([lookupBetika(matchId), fetchSportPesaReference(matchId)])
      .then(([betika, sportpesa]) => {
        const value: BoardOddsComparison = {
          checkedAt: new Date().toISOString(),
          betika,
          sportpesa,
          xbet: {
            status: "unavailable",
            sourceUrl: XBET_URL,
            detail:
              "No automated 1xBet quote is available here. The public page is not reliably matchable and aggregator terms restrict automated republication.",
          },
        };
        cache.set(matchId, { at: Date.now(), value });
        return value;
      })
      .finally(() => pending.delete(matchId));
    pending.set(matchId, task);
    return task;
  });
