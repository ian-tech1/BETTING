import { createServerFn } from "@tanstack/react-start";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { MATCHES } from "@/lib/price";

export type SportPesaReference = {
  status: "found" | "no-quote" | "unsupported" | "unavailable" | "fixture-mismatch";
  checkedAt: string;
  sourceUrl?: string;
  odds?: { home: number; draw: number; away: number };
  freshness: string;
  detail: string;
};

const ROOT = "https://www.surebetafrica.com";
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: SportPesaReference }>();
const inFlight = new Map<string, Promise<SportPesaReference>>();
const LEAGUE_SLUGS: Record<string, string> = {
  "Premier League": "premier-league",
  "La Liga": "la-liga",
  "Serie A": "serie-a",
  Bundesliga: "bundesliga",
  "Ligue 1": "ligue-1",
  Eredivisie: "eredivisie",
  "Primeira Liga": "primeira-liga",
  "Scottish Premiership": "scottish-premiership",
  Championship: "championship",
};

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function visibleText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberSpans(row: string) {
  return [
    ...row.matchAll(
      /<span\b[^>]*class=["'][^"']*tabular-nums[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*<\/span>/gi,
    ),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 1.01 && value <= 100);
}

export function parseSportPesaComparisonPage(
  html: string,
  homeName: string,
  awayName: string,
  sourceUrl: string,
): Omit<SportPesaReference, "checkedAt"> {
  const heading = visibleText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const headingKey = normalized(heading);
  if (
    !headingKey ||
    !headingKey.includes(normalized(homeName)) ||
    !headingKey.includes(normalized(awayName))
  ) {
    return {
      status: "fixture-mismatch",
      sourceUrl,
      freshness: "Fixture not verified",
      detail: "The returned page title did not confirm both teams exactly; no odds were accepted.",
    };
  }

  const visible = visibleText(html);
  const movement = visible
    .match(/Last odds movement\s+(\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?)\s+ago)/i)?.[1]
    ?.trim();
  const freshness = movement
    ? `Aggregator reports last odds movement ${movement}; this is not a guaranteed quote timestamp.`
    : "The aggregator did not publish a clear odds-movement time.";
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((item) => item[0]);
  const oneXTwoTable = tables.find((table) => {
    const header = normalized(visibleText(table));
    return header.includes("home") && header.includes("draw") && header.includes("away");
  });
  const candidates = (oneXTwoTable ? [oneXTwoTable] : tables).flatMap((table) =>
    [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((item) => item[0]),
  );
  const row = candidates.find((candidate) => /alt=["']SportPesa["']/i.test(candidate));
  const prices = row ? numberSpans(row) : [];
  if (!row || prices.length !== 3) {
    return {
      status: "no-quote",
      sourceUrl,
      freshness,
      detail:
        "The exact fixture page did not expose a complete SportPesa 1X2 row. No estimate or other bookmaker price is substituted.",
    };
  }

  return {
    status: "found",
    sourceUrl,
    odds: { home: prices[0], draw: prices[1], away: prices[2] },
    freshness,
    detail:
      "Third-party comparison snapshot, not an official or guaranteed live SportPesa price. Verify directly before use.",
  };
}

function checkedResult(result: Omit<SportPesaReference, "checkedAt">): SportPesaReference {
  return { ...result, checkedAt: new Date().toISOString() };
}

export async function fetchSportPesaReference(matchId: string): Promise<SportPesaReference> {
  const match = MATCHES.find((item) => item.id === matchId);
  if (!match) {
    return checkedResult({
      status: "unsupported",
      freshness: "Not checked",
      detail: "Fixture ID is not present in this board; no odds were requested.",
    });
  }

  const leagueSlug = LEAGUE_SLUGS[match.league];
  const kickoff = KICKOFF_ISO[match.id];
  if (!leagueSlug || !kickoff) {
    return checkedResult({
      status: "unsupported",
      freshness: "Not checked",
      detail:
        "This competition or fixture has no verified comparison-page route; no quote is shown.",
    });
  }
  if (Date.parse(kickoff) <= Date.now()) {
    return checkedResult({
      status: "unsupported",
      freshness: "Pre-match page only",
      detail:
        "The listed kickoff has passed; this lookup does not treat old pre-match prices as current.",
    });
  }

  const eventDate = kickoff.slice(0, 10);
  const sourceUrl = `${ROOT}/kenya/leagues/${leagueSlug}/${eventDate}/${slug(match.home.name)}-vs-${slug(match.away.name)}`;
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      headers: { Accept: "text/html", "User-Agent": "PredictionBoardPublicOddsReference/1.0" },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return checkedResult({
      status: "unavailable",
      sourceUrl,
      freshness: "Unavailable",
      detail:
        "The public comparison page could not be reached. No current SportPesa quote is shown.",
    });
  }

  if (!response.ok) {
    return checkedResult({
      status: "unavailable",
      sourceUrl,
      freshness: `HTTP ${response.status}`,
      detail:
        "The public comparison page did not return an accessible response. No quote is shown.",
    });
  }

  const html = await response.text();
  return checkedResult(
    parseSportPesaComparisonPage(html, match.home.name, match.away.name, sourceUrl),
  );
}

export const lookupSportPesaReference = createServerFn({ method: "GET" })
  .validator((matchId: string) => {
    if (typeof matchId !== "string" || matchId.length > 80 || !/^[a-z0-9-]+$/i.test(matchId)) {
      throw new Error("Invalid fixture ID");
    }
    return matchId;
  })
  .handler(async ({ data: matchId }) => {
    const cached = cache.get(matchId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const running = inFlight.get(matchId);
    if (running) return running;
    const task = fetchSportPesaReference(matchId)
      .then((result) => {
        cache.set(matchId, { at: Date.now(), value: result });
        return result;
      })
      .finally(() => inFlight.delete(matchId));
    inFlight.set(matchId, task);
    return task;
  });
