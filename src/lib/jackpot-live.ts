import { createServerFn } from "@tanstack/react-start";
import { parseBetikaKickoff, sameTeam, stableFixtureId } from "@/lib/jackpot-utils";
import { lookupVerifiedTeamForms, type TeamFormMark } from "@/lib/team-form.server";

type Side = "home" | "draw" | "away";

export type LiveGame = {
  id: string;
  league: string;
  when: string;
  kickoff?: string;
  home: string;
  away: string;
  odds: Record<Side, number>;
  found: boolean;
  homeForm?: TeamFormMark[];
  awayForm?: TeamFormMark[];
  homeVenueForm?: TeamFormMark[];
  awayVenueForm?: TeamFormMark[];
  homeRecentGoals?: { scored: number; conceded: number };
  awayRecentGoals?: { scored: number; conceded: number };
};

type Want = { home: string; away: string };
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

type BetikaJackpotEvent = {
  meta?: {
    id?: string;
    event_name?: string;
    status?: string;
    total_games?: string;
  };
  data?: Array<BetikaRow & {
    jackpot_match_id?: string;
    pos?: string;
    odds?: Array<{ sub_type_id?: string; display?: string; odd_value?: string }>;
  }>;
};

const BETIKA: Want[] = [
  { home: "Alaves", away: "Deportivo A Coruna" },
  { home: "Elversberg", away: "Freiburg" },
  { home: "Eintracht Fr", away: "Hoffenheim" },
  { home: "Paderborn", away: "Eintracht" },
  { home: "Fulham", away: "Newcastle" },
  { home: "Espanyol", away: "Deportivo" },
  { home: "Auxerre", away: "Paris FC" },
  { home: "Osasuna", away: "Athletic Club" },
  { home: "Napoli", away: "Lazio" },
  { home: "Elche", away: "Betis" },
  { home: "Sunderland", away: "Chelsea" },
  { home: "Rennes", away: "Lille" },
  { home: "Monza", away: "Atalanta" },
  { home: "Le Havre", away: "Lorient" },
  { home: "Angers", away: "Nice" },
  { home: "Brest", away: "Lyon" },
  { home: "Man Utd", away: "Aston Villa" },
  { home: "Lens", away: "Marseille" },
];

const SPORTPESA_JACKPOT_URL = "https://jackpot-offer-api.sportpesa.com/api/jackpots/active";
const BETIKA_MATCH_URL = "https://api.betika.com/v1/uo/matches";
const XBET_PUBLIC_PAGE = "https://1xbet.com/en/line/football";
const MAX_BETIKA_FIXTURE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

async function searchBetika(home = "", page = 1, limit = 50): Promise<BetikaRow[]> {
  try {
    const url = new URL(BETIKA_MATCH_URL);
    url.search = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sport_id: "14",
      keyword: home,
    }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: BetikaRow[] };
    return Array.isArray(body.data) ? body.data : [];
  } catch {
    return [];
  }
}

function eligibleBetikaRow(row: BetikaRow, want: Want, now: number) {
  const home = row.home_team?.trim() ?? "";
  const away = row.away_team?.trim() ?? "";
  if (
    !home ||
    !away ||
    row.is_esport ||
    row.is_srl ||
    /women|wfc|esport|srl/i.test(`${home} ${away}`) ||
    !sameTeam(home, want.home) ||
    !sameTeam(away, want.away)
  )
    return null;

  const kickoff = row.start_time ? parseBetikaKickoff(row.start_time) : null;
  if (kickoff === null || kickoff < now || kickoff - now > MAX_BETIKA_FIXTURE_AGE_MS) return null;

  const odds = {
    home: Number(row.home_odd),
    draw: Number(row.neutral_odd),
    away: Number(row.away_odd),
  };
  if (!Object.values(odds).every((odd) => Number.isFinite(odd) && odd > 1.01 && odd <= 100))
    return null;

  return { home, away, kickoff, odds };
}

async function loadBetika(): Promise<{ games: LiveGame[]; status: string; eventName?: string; prize?: string; expiry?: string }> {
  try {
    const eventsResponse = await fetch("https://api.betika.com/v1/jackpot/events", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (eventsResponse.ok) {
      const events = (await eventsResponse.json()) as Array<{
        id?: string;
        event_name?: string;
        status?: string;
        total_games?: string;
        event_expiry?: string;
        prize?: string;
      }>;
      const candidates = await Promise.all(
        events
          .filter((event) => event.status === "ACTIVE" && event.id)
          .map(async (event) => {
            try {
              const response = await fetch(
                `https://api.betika.com/v1/jackpot/event?id=${encodeURIComponent(event.id!)}`,
                { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
              );
              if (!response.ok) return null;
              const detail = (await response.json()) as BetikaJackpotEvent;
              const futureKickoffs = (detail.data ?? [])
                .map((row) => row.start_time ? parseBetikaKickoff(row.start_time) : null)
                .filter((kickoff): kickoff is number => kickoff !== null && kickoff > Date.now());
              if (!futureKickoffs.length) return null;
              return { event, detail, firstKickoff: Math.min(...futureKickoffs) };
            } catch {
              return null;
            }
          }),
      );
      const selected = candidates
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((left, right) => left.firstKickoff - right.firstKickoff)[0];
      if (selected?.event.id) {
        const active = selected.event;
        const detail = selected.detail;
          const games = (detail.data ?? [])
            .map((row): LiveGame | null => {
              const oneXtwo = (row.odds ?? []).filter((odd) => odd.sub_type_id === "1");
              const byDisplay = (display: string) =>
                Number(oneXtwo.find((odd) => odd.display === display)?.odd_value);
              const kickoff = row.start_time ? parseBetikaKickoff(row.start_time) : null;
              const odds = { home: byDisplay("1"), draw: byDisplay("X"), away: byDisplay("2") };
              if (!row.home_team || !row.away_team || !row.competition_name || kickoff === null || kickoff <= Date.now()) return null;
              if (!Object.values(odds).every((odd) => Number.isFinite(odd) && odd > 1.01 && odd <= 100)) return null;
              const kickoffIso = new Date(kickoff).toISOString();
              return {
                id: stableFixtureId(`betika-jackpot-${active.id}`, row.home_team, row.away_team, kickoffIso),
                league: row.competition_name,
                when: formatKickoff(kickoff),
                kickoff: kickoffIso,
                home: row.home_team.trim(),
                away: row.away_team.trim(),
                odds,
                found: true,
              };
            })
            .filter((game): game is LiveGame => game !== null)
            .sort((left, right) => Date.parse(left.kickoff ?? "") - Date.parse(right.kickoff ?? ""));
          if (games.length) {
            return {
              games,
              status: `Betika ${active.event_name ?? "active Jackpot"} loaded ${games.length}/${active.total_games ?? games.length} games from official public event ${active.id}.`,
              eventName: active.event_name,
              prize: active.prize,
              expiry: active.event_expiry,
            };
      }
    }
  }
  } catch {
    // Fall through to the older exact-match fallback if the public event service is temporarily unavailable.
  }
  let cursor = 0;
  const accepted = new Map<string, LiveGame>();
  const now = Date.now();
  let targetCount = BETIKA.length;
  try {
    const eventResponse = await fetch("https://api.betika.com/v1/jackpot/events", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (eventResponse.ok) {
      const events = (await eventResponse.json()) as { total_games?: string; status?: string }[];
      const active = events.find((event) => event.status === "ACTIVE") ?? events[0];
      const count = Number(active?.total_games);
      if (Number.isInteger(count) && count > 0 && count <= 100) targetCount = count;
    }
  } catch { /* the curated fallback list remains available */ }
  const worker = async () => {
    while (cursor < BETIKA.length) {
      const want = BETIKA[cursor++];
      const rows = await searchBetika(want.home);
      const candidates = rows
        .map((row) => ({ row, match: eligibleBetikaRow(row, want, now) }))
        .filter(
          (
            item,
          ): item is { row: BetikaRow; match: NonNullable<ReturnType<typeof eligibleBetikaRow>> } =>
            item.match !== null,
        )
        .sort((left, right) => left.match.kickoff - right.match.kickoff);
      const selected = candidates[0];
      if (!selected) continue;
      const { row, match } = selected;
      const kickoff = new Date(match.kickoff).toISOString();
      const id = stableFixtureId("betika", match.home, match.away, kickoff);
      accepted.set(id, {
        id,
        league: row.competition_name ?? "Competition unavailable",
        when: formatKickoff(match.kickoff),
        kickoff,
        home: match.home,
        away: match.away,
        odds: match.odds,
        found: true,
      });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const games = [...accepted.values()].sort(
    (left, right) => Date.parse(left.kickoff ?? "") - Date.parse(right.kickoff ?? ""),
  );
  return {
    games,
    status: games.length
      ? `Betika active jackpot card matched ${games.length} of ${targetCount} tracked games with valid 1X2 odds. Other games remain under their competition.`
      : "Betika returned no exact upcoming team-and-kickoff quotes for this tracked card; no saved or simulated prices are substituted.",
  };
}

type SportPesaEvent = {
  utcKickOffTime?: string;
  tournamentName?: string;
  home?: number | string;
  draw?: number | string;
  away?: number | string;
  competitors?: { competitorName?: string; isHome?: boolean }[];
};

async function loadSportpesa(): Promise<{ games: LiveGame[]; status: string }> {
  try {
    const response = await fetch(SPORTPESA_JACKPOT_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return {
        games: [],
        status: `SportPesa's official public jackpot feed is unavailable from this server (HTTP ${response.status}); no quote is shown. Use a manually transcribed price from the SportPesa app if needed.`,
      };
    }
    const body = (await response.json()) as { events?: SportPesaEvent[] };
    const accepted = new Map<string, LiveGame>();
    for (const event of body.events ?? []) {
      const competitors = event.competitors ?? [];
      const homeSides = competitors.filter(
        (side) => side.isHome === true && side.competitorName?.trim(),
      );
      const awaySides = competitors.filter(
        (side) => side.isHome === false && side.competitorName?.trim(),
      );
      // Never infer home/away from array position. Reject ambiguous competitor ordering.
      if (homeSides.length !== 1 || awaySides.length !== 1) continue;
      const home = homeSides[0].competitorName!.trim();
      const away = awaySides[0].competitorName!.trim();
      const kickoffMs = event.utcKickOffTime ? Date.parse(event.utcKickOffTime) : Number.NaN;
      const odds = {
        home: Number(event.home),
        draw: Number(event.draw),
        away: Number(event.away),
      };
      if (
        !Number.isFinite(kickoffMs) ||
        kickoffMs <= Date.now() ||
        !Object.values(odds).every((odd) => Number.isFinite(odd) && odd > 1.01 && odd <= 100)
      )
        continue;
      const kickoff = new Date(kickoffMs).toISOString();
      const id = stableFixtureId("sportpesa", home, away, kickoff);
      accepted.set(id, {
        id,
        league: event.tournamentName ?? "Competition unavailable",
        when: formatKickoff(kickoffMs),
        kickoff,
        home,
        away,
        odds,
        found: true,
      });
    }
    const games = [...accepted.values()].sort(
      (left, right) => Date.parse(left.kickoff ?? "") - Date.parse(right.kickoff ?? ""),
    );
    return {
      games,
      status: games.length
        ? `SportPesa official feed returned ${games.length} upcoming 1X2 quotes. Team order is taken only from explicit home/away flags.`
        : "SportPesa returned no valid upcoming 1X2 quotes with explicit home/away labels. No comparison or demo price is presented as its official price.",
    };
  } catch {
    return {
      games: [],
      status:
        "SportPesa's official public jackpot feed request failed; no cached odds are shown. You can enter the prices shown in its app manually.",
    };
  }
}

/** Read the public page only; do not fetch hidden app endpoints or bypass a gate. */
async function checkXbetPublicPage(): Promise<{ games: LiveGame[]; status: string }> {
  try {
    const response = await fetch(XBET_PUBLIC_PAGE, {
      headers: { Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      return {
        games: [],
        status: `1xBet public page returned HTTP ${response.status}; no quotes are shown.`,
      };
    const html = await response.text();
    const title =
      html
        .match(/<title[^>]*>(.*?)<\/title>/is)?.[1]
        ?.replace(/\s+/g, " ")
        .trim() ?? "";
    const gate = /captcha|access denied|country.{0,30}(?:blocked|restricted)|vpn/i.test(html);
    if (gate)
      return {
        games: [],
        status: "1xBet public page is gated in this runtime; no odds are shown.",
      };
    if (!/\b1x2\b/i.test(html) || !/\b(?:home|draw|away)\b/i.test(html)) {
      return {
        games: [],
        status: title
          ? "1xBet page loaded, but the public HTML contains no readable 1X2 prices."
          : "1xBet public page did not expose readable event odds.",
      };
    }
    return {
      games: [],
      status:
        "1xBet page text is present, but its public markup does not provide a safely matchable 1X2 feed.",
    };
  } catch {
    return { games: [], status: "1xBet public page could not be reached; no quotes are shown." };
  }
}

export const refreshJackpot = createServerFn({ method: "GET" }).handler(async () => {
  const [betika, sportpesa, xbet] = await Promise.all([
    loadBetika(),
    loadSportpesa(),
    checkXbetPublicPage(),
  ]);
  const prize = betika.prize ? `KES ${Number(betika.prize).toLocaleString("en-KE")}` : "";
  const expiry = betika.expiry ?? "";
  const allGames = [...betika.games, ...sportpesa.games, ...xbet.games];
  const forms = await lookupVerifiedTeamForms(allGames.flatMap((game) => [game.home, game.away]));
  const enrich = (game: LiveGame): LiveGame => {
    const home = forms.get(game.home);
    const away = forms.get(game.away);
    return {
      ...game,
      homeForm: home?.form,
      awayForm: away?.form,
      homeVenueForm: home?.homeForm,
      awayVenueForm: away?.awayForm,
      homeRecentGoals: home ? { scored: home.scored, conceded: home.conceded } : undefined,
      awayRecentGoals: away ? { scored: away.scored, conceded: away.conceded } : undefined,
    };
  };
  return {
    checked: new Date().toISOString(),
    prize,
    expiry,
    betika: betika.games.map(enrich),
    betikaStatus: betika.status,
    sportpesa: sportpesa.games.map(enrich),
    sportpesaStatus: sportpesa.status,
    xbet: xbet.games.map(enrich),
    xbetStatus: xbet.status,
  };
});

function formatKickoff(timestamp: number) {
  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Nairobi",
  }).format(new Date(timestamp));
}
