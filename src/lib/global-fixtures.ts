import { createServerFn } from "@tanstack/react-start";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { MATCHES, priceMatch, type PricedMatch } from "@/lib/price";
import type { FormMark, LeagueCode, RawMatch, Side } from "@/data/weekend";
import { env } from "@/lib/env.server";
import { parseBetikaKickoff } from "@/lib/jackpot-utils";
import { lookupVerifiedTeamForms } from "@/lib/team-form.server";

const COMPETITIONS = [
  { file: "en.1", code: "EPL", label: "English Premier League" },
  { file: "en.2", code: "CHP", label: "English Championship" },
  { file: "de.1", code: "BUN", label: "German Bundesliga" },
  { file: "es.1", code: "LAL", label: "Spanish La Liga" },
  { file: "fr.1", code: "FRA", label: "French Ligue 1" },
  { file: "it.1", code: "SEA", label: "Italian Serie A" },
  { file: "nl.1", code: "ERE", label: "Dutch Eredivisie" },
  { file: "pt.1", code: "POR", label: "Portuguese Primeira Liga" },
] as const;

const ROOT = "https://raw.githubusercontent.com/openfootball/football.json/master";
const CACHE_MS = 3 * 60 * 60 * 1000;

type FeedMatch = {
  date?: string;
  team1?: string;
  team2?: string;
  round?: string;
  score?: { ft?: [number, number] };
};

export type ExpandedFixture = {
  id: string;
  code: string;
  competition: string;
  date: string;
  home: string;
  away: string;
  round: string | null;
  sourceUrl: string;
  sourceKind?: "api-football" | "odds-api" | "betika-public" | "openfootball";
  kickoffAt?: string | null;
  status?: string | null;
  verifiedOdds?: { home: number; draw: number; away: number };
  oddsSource?: string;
  oddsCheckedAt?: string;
  homeForm?: FormMark[];
  awayForm?: FormMark[];
  homeVenueForm?: FormMark[];
  awayVenueForm?: FormMark[];
  homeRecentGoals?: { scored: number; conceded: number };
  awayRecentGoals?: { scored: number; conceded: number };
  homeProviderId?: number;
  awayProviderId?: number;
};

export type ExpandedFixtureFeed = {
  season: string;
  from: string;
  through: string;
  checkedAt: string;
  source: string;
  competitions: { code: string; label: string; count: number }[];
  fixtures: ExpandedFixture[];
  unavailable: string[];
  today: string;
  tomorrow: string;
  liveProvider: boolean;
};

function limitedSide(name: string, form: FormMark[] = [], venueForm: FormMark[] = [], goals?: { scored: number; conceded: number }): Side {
  const played = goals ? Math.max(form.length, 1) : 0;
  const xgFor = goals ? Math.max(0.15, goals.scored / played) : 1.35;
  const xgAgainst = goals ? Math.max(0.15, goals.conceded / played) : 1.35;
  return { name, short: name, pos: 0, form, xgFor, xgAgainst, gf: goals?.scored ?? 0, ga: goals?.conceded ?? 0, played, out: [], venueForm, recentGoalsFor: goals?.scored, recentGoalsAgainst: goals?.conceded };
}

function fixtureDateLabel(date: string, kickoffAt?: string | null) {
  const instant = kickoffAt ? new Date(kickoffAt) : new Date(`${date}T12:00:00Z`);
  return instant.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Converts a verified provider fixture into the existing shared card model. */
export function fixtureAsPricedMatch(fixture: ExpandedFixture): PricedMatch {
  const kickoff = fixture.kickoffAt ? new Date(fixture.kickoffAt) : new Date(`${fixture.date}T12:00:00Z`);
  const weekday = kickoff.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const raw: RawMatch = {
    id: fixture.id,
    league: fixture.competition,
    code: (fixture.code in { EPL: true, CHP: true, BUN: true, LAL: true, FRA: true, SEA: true, ERE: true, POR: true } ? fixture.code : "EPL") as LeagueCode,
    day: weekday === "Saturday" || weekday === "Sunday" ? weekday : "Midweek",
    dateLabel: fixtureDateLabel(fixture.date, fixture.kickoffAt),
    time: fixture.kickoffAt ? kickoff.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) : "—",
    venue: "Unavailable",
    home: limitedSide(fixture.home, fixture.homeForm, fixture.homeVenueForm, fixture.homeRecentGoals),
    away: limitedSide(fixture.away, fixture.awayForm, fixture.awayVenueForm, fixture.awayRecentGoals),
  };
  const priced = priceMatch(raw);
  return fixture.verifiedOdds ? { ...priced, verifiedOdds: fixture.verifiedOdds, verifiedOddsSource: fixture.oddsSource, verifiedOddsCheckedAt: fixture.oddsCheckedAt } : priced;
}

let cache: { at: number; feed: ExpandedFixtureFeed } | undefined;

function norm(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(man(?:chester)?\s*(?:united|utd|u))\b/g, "manchesterunited")
    .replace(/\b(man city|manchester city)\b/g, "manchestercity")
    .replace(/\b(newcastle\s*(?:united|utd))\b/g, "newcastle")
    .replace(/\b(west ham\s*(?:united|utd))\b/g, "westham")
    .replace(/\b(wolverhampton wanderers|wolves)\b/g, "wolverhampton")
    .replace(/\b(brighton and hove albion|brighton)\b/g, "brighton")
    .replace(/\b(nott'?m forest|nottingham forest)\b/g, "nottinghamforest")
    .replace(/\b(bayern|bayern munich)\b/g, "bayernmunich")
    .replace(/\b(inter milan|internazionale)\b/g, "inter")
    .replace(/\b(paris saint[- ]germain|paris sg|psg)\b/g, "psg")
    .replace(/\b(atletico madrid|atletico de madrid)\b/g, "atleticomadrid")
    .replace(/\b(tottenham hotspur|tottenham)\b/g, "tottenham")
    .replace(/\b(fc|afc|cf|sc|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function dayAfter(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seasonFor(date: Date) {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 6 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

type FootballDataHistoryRow = {
  utcDate?: string;
  status?: string;
  homeTeam?: { name?: string };
  awayTeam?: { name?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
};

async function loadFootballDataHistory() {
  const key = env("FOOTBALL_DATA_KEY");
  if (!key) return { rows: [] as FootballDataHistoryRow[], unavailable: [] as string[] };
  const competitions = ["PL", "ELC", "BL1", "PD", "FL1", "SA", "DED", "PPL"];
  const rows: FootballDataHistoryRow[] = [];
  const unavailable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < competitions.length) {
      const competition = competitions[cursor++];
      try {
        const url = new URL(`https://api.football-data.org/v4/competitions/${competition}/matches`);
        url.search = new URLSearchParams({ status: "FINISHED", limit: "100" }).toString();
        const response = await fetch(url, { headers: { "X-Auth-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
        if (!response.ok) { unavailable.push(`football-data.org ${competition}: HTTP ${response.status}`); continue; }
        const body = (await response.json()) as { matches?: FootballDataHistoryRow[] };
        rows.push(...(body.matches ?? []));
      } catch { unavailable.push(`football-data.org ${competition}: source could not be reached`); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return { rows, unavailable };
}

async function loadApiFootballFixtures(from: string, through: string) {
  const key = env("API_FOOTBALL_KEY");
  if (!key) return { fixtures: [] as ExpandedFixture[], unavailable: [] as string[] };
  try {
    const query = new URLSearchParams({ from, to: through, timezone: "UTC" });
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?${query}`, {
      headers: { "x-apisports-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return { fixtures: [], unavailable: [`API-Football: source returned HTTP ${response.status}`] };
    const body = (await response.json()) as { errors?: Record<string, unknown>; response?: Array<{ fixture?: { id?: number; date?: string; status?: { short?: string } }; league?: { id?: number; name?: string; country?: string }; teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } } }> };
    if (body.errors && Object.keys(body.errors).length) return { fixtures: [], unavailable: [`API-Football: ${Object.values(body.errors).join("; ")}`] };
    const fixtures: ExpandedFixture[] = [];
    for (const row of body.response ?? []) {
      const fixture = row.fixture;
      const home = row.teams?.home?.name?.trim();
      const away = row.teams?.away?.name?.trim();
      const kickoffAt = fixture?.date;
      const status = fixture?.status?.short ?? null;
      if (!fixture?.id || !kickoffAt || !home || !away || !/^\d{4}-\d{2}-\d{2}/.test(kickoffAt)) continue;
      if (Date.parse(kickoffAt) <= Date.now()) continue;
      if (["FT", "AET", "PEN", "PST", "CANC", "ABD"].includes(status ?? "")) continue;
      fixtures.push({
        id: `af-${fixture.id}`,
        code: `AF-${row.league?.id ?? "OTHER"}`,
        competition: `${row.league?.name ?? "Football"}${row.league?.country ? ` · ${row.league.country}` : ""}`,
        date: kickoffAt.slice(0, 10),
        home,
        away,
        round: null,
        sourceUrl: `https://www.api-football.com/fixtures/${fixture.id}`,
        sourceKind: "api-football",
        kickoffAt,
        status,
        homeProviderId: row.teams?.home?.id,
        awayProviderId: row.teams?.away?.id,
      });
    }
    return { fixtures, unavailable: [] as string[] };
  } catch {
    return { fixtures: [], unavailable: ["API-Football: source could not be reached"] };
  }
}

type ApiRecentRow = {
  fixture?: { date?: string; status?: { short?: string } };
  teams?: { home?: { id?: number }; away?: { id?: number } };
  goals?: { home?: number | null; away?: number | null };
};

type ApiTeamForm = { form: FormMark[]; homeForm: FormMark[]; awayForm: FormMark[]; scored: number; conceded: number };

async function enrichApiFootballForm(fixtures: ExpandedFixture[]) {
  const key = env("API_FOOTBALL_KEY");
  if (!key || !fixtures.length) return { fixtures, unavailable: [] as string[] };
  const ids = [...new Set(fixtures.flatMap((fixture) => [fixture.homeProviderId, fixture.awayProviderId]).filter((id): id is number => typeof id === "number"))];
  const stats = new Map<number, ApiTeamForm>();
  const unavailable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?team=${id}&last=20`, { headers: { "x-apisports-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
        if (!response.ok) { unavailable.push(`API-Football team ${id}: HTTP ${response.status}`); continue; }
        const body = (await response.json()) as { errors?: Record<string, unknown>; response?: ApiRecentRow[] };
        if (body.errors && Object.keys(body.errors).length) { unavailable.push(`API-Football team ${id}: ${Object.values(body.errors).join("; ")}`); continue; }
        const rows = (body.response ?? []).filter((row) => ["FT", "AET", "PEN"].includes(row.fixture?.status?.short ?? "") && Number.isFinite(row.goals?.home) && Number.isFinite(row.goals?.away)).sort((a, b) => String(b.fixture?.date ?? "").localeCompare(String(a.fixture?.date ?? "")));
        const overallRows = rows.slice(0, 5);
        const homeRows = rows.filter((row) => row.teams?.home?.id === id).slice(0, 5);
        const awayRows = rows.filter((row) => row.teams?.away?.id === id).slice(0, 5);
        const form: FormMark[] = [];
        const homeForm: FormMark[] = [];
        const awayForm: FormMark[] = [];
        let scored = 0;
        let conceded = 0;
        for (const row of overallRows) {
          const isHome = row.teams?.home?.id === id;
          const gf = isHome ? Number(row.goals?.home) : Number(row.goals?.away);
          const ga = isHome ? Number(row.goals?.away) : Number(row.goals?.home);
          const mark = gf > ga ? "W" : gf === ga ? "D" : "L";
          scored += gf;
          conceded += ga;
          form.push(mark);
        }
        for (const row of homeRows) {
          const gf = Number(row.goals?.home);
          const ga = Number(row.goals?.away);
          homeForm.push(gf > ga ? "W" : gf === ga ? "D" : "L");
        }
        for (const row of awayRows) {
          const gf = Number(row.goals?.away);
          const ga = Number(row.goals?.home);
          awayForm.push(gf > ga ? "W" : gf === ga ? "D" : "L");
        }
        if (overallRows.length) stats.set(id, { form: form.reverse(), homeForm: homeForm.reverse(), awayForm: awayForm.reverse(), scored, conceded });
      } catch { unavailable.push(`API-Football team ${id}: recent results could not be reached`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length || 1) }, () => worker()));
  return {
    fixtures: fixtures.map((fixture) => {
      const home = fixture.homeProviderId ? stats.get(fixture.homeProviderId) : undefined;
      const away = fixture.awayProviderId ? stats.get(fixture.awayProviderId) : undefined;
      return { ...fixture, homeForm: home?.form ?? fixture.homeForm, awayForm: away?.form ?? fixture.awayForm, homeVenueForm: home?.homeForm, awayVenueForm: away?.awayForm, homeRecentGoals: home ? { scored: home.scored, conceded: home.conceded } : undefined, awayRecentGoals: away ? { scored: away.scored, conceded: away.conceded } : undefined };
    }),
    unavailable,
  };
}

type BetikaScheduleRow = {
  home_team?: string;
  away_team?: string;
  start_time?: string;
  competition_name?: string;
  is_esport?: boolean;
  is_srl?: boolean;
  home_odd?: string;
  neutral_odd?: string;
  away_odd?: string;
};

async function loadBetikaPublicFixtures(from: string, through: string) {
  const fixtures: ExpandedFixture[] = [];
  const seen = new Set<string>();
  const checkedAt = new Date().toISOString();
  try {
    for (let page = 1; page <= 8; page += 1) {
      const query = new URLSearchParams({ page: String(page), limit: "100", sport_id: "14" });
      const response = await fetch(`https://api.betika.com/v1/uo/matches?${query}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) return { fixtures, unavailable: [`Betika public schedule: HTTP ${response.status}`] };
      const body = (await response.json()) as { data?: BetikaScheduleRow[] };
      const rows = Array.isArray(body.data) ? body.data : [];
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.home_team?.trim() || !row.away_team?.trim() || row.is_esport || row.is_srl) continue;
        if (/women|wfc|esport|srl/i.test(`${row.home_team} ${row.away_team}`)) continue;
        const kickoffMs = row.start_time ? parseBetikaKickoff(row.start_time) : null;
        if (kickoffMs === null) continue;
        const kickoffAt = new Date(kickoffMs).toISOString();
        const date = kickoffAt.slice(0, 10);
        if (kickoffMs <= Date.now()) continue;
        if (date < from || date > through) continue;
        const odds = { home: Number(row.home_odd), draw: Number(row.neutral_odd), away: Number(row.away_odd) };
        const verifiedOdds = Object.values(odds).every((odd) => Number.isFinite(odd) && odd > 1.01 && odd <= 100) ? odds : undefined;
        const key = `${date}:${row.home_team.trim().toLowerCase()}:${row.away_team.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fixtures.push({
          id: `betika-${date}-${row.home_team.trim()}-${row.away_team.trim()}`.replace(/[^a-zA-Z0-9-]/g, "-"),
          code: "BETIKA",
          competition: row.competition_name?.trim() || "Betika football schedule",
          date,
          home: row.home_team.trim(),
          away: row.away_team.trim(),
          round: null,
          sourceUrl: "https://www.betika.com/en-ke/",
          sourceKind: "betika-public",
          kickoffAt,
          status: null,
          verifiedOdds,
          oddsSource: verifiedOdds ? "Betika public 1X2" : undefined,
          oddsCheckedAt: verifiedOdds ? checkedAt : undefined,
        });
      }
      if (rows.length < 100) break;
    }
    return { fixtures, unavailable: [] as string[] };
  } catch {
    return { fixtures, unavailable: ["Betika public schedule: source could not be reached"] };
  }
}

async function loadOddsApiFixtures(from: string, through: string) {
  const key = env("ODDS_API_KEY");
  if (!key) return { fixtures: [] as ExpandedFixture[], unavailable: [] as string[] };
  const sports = [
    "soccer_epl", "soccer_efl_champ", "soccer_germany_bundesliga", "soccer_spain_la_liga",
    "soccer_france_ligue_one", "soccer_italy_serie_a", "soccer_netherlands_eredivisie",
    "soccer_portugal_primeira_liga", "soccer_japan_j_league", "soccer_japan_j_league_cup",
    "soccer_hong_kong_1st_division",
  ];
  const fixtures: ExpandedFixture[] = [];
  const unavailable: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < sports.length) {
      const sport = sports[cursor++];
      try {
        const query = new URLSearchParams({ apiKey: key, regions: "eu,uk", markets: "h2h", oddsFormat: "decimal" });
        const response = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?${query}`, { signal: AbortSignal.timeout(9000) });
        if (!response.ok) { unavailable.push(`The Odds API ${sport}: HTTP ${response.status}`); continue; }
        const rows = (await response.json()) as Array<{ id?: string; sport_title?: string; commence_time?: string; home_team?: string; away_team?: string; bookmakers?: Array<{ title?: string; last_update?: string; markets?: Array<{ key?: string; outcomes?: Array<{ name?: string; price?: number }> }> }> }>;
        for (const row of rows) {
          if (!row.id || !row.commence_time || !row.home_team || !row.away_team) continue;
          const date = row.commence_time.slice(0, 10);
          if (Date.parse(row.commence_time) <= Date.now()) continue;
          if (date < from || date > through) continue;
          const bookmaker = (row.bookmakers ?? []).find((candidate) => {
            const market = candidate.markets?.find((item) => item.key === "h2h");
            const names = new Set((market?.outcomes ?? []).map((outcome) => outcome.name));
            return names.has(row.home_team) && names.has(row.away_team) && names.has("Draw");
          });
          const market = bookmaker?.markets?.find((item) => item.key === "h2h");
          const price = (name: string) => market?.outcomes?.find((outcome) => outcome.name === name)?.price;
          const values = { home: price(row.home_team), draw: price("Draw"), away: price(row.away_team) };
          const verifiedOdds = Object.values(values).every((value) => typeof value === "number" && Number.isFinite(value) && value > 1.01 && value <= 100)
            ? values as { home: number; draw: number; away: number }
            : undefined;
          fixtures.push({ id: `odds-${row.id}`, code: `ODDS-${sport.replace(/^soccer_/, "")}`, competition: row.sport_title || sport.replace(/^soccer_/, ""), date, home: row.home_team, away: row.away_team, round: null, sourceUrl: "https://the-odds-api.com/", sourceKind: "odds-api", kickoffAt: row.commence_time, status: null, verifiedOdds, oddsSource: verifiedOdds ? `The Odds API · ${bookmaker?.title ?? "bookmaker"}` : undefined, oddsCheckedAt: verifiedOdds ? bookmaker?.last_update ?? new Date().toISOString() : undefined });
        }
      } catch { unavailable.push(`The Odds API ${sport}: source could not be reached`); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return { fixtures, unavailable };
}

function existingKeys(year: number) {
  const entries = new Map<string, { home: string; away: string }[]>();
  for (const match of MATCHES) {
    const start = KICKOFF_ISO[match.id];
    const labelDate = match.dateLabel.match(
      /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]{3})$/i,
    );
    const month = labelDate
      ? [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ].findIndex((name) => name.toLowerCase() === labelDate[2].toLowerCase())
      : -1;
    const date =
      start?.slice(0, 10) ??
      (labelDate && month >= 0
        ? `${year}-${String(month + 1).padStart(2, "0")}-${labelDate[1].padStart(2, "0")}`
        : null);
    if (!date) continue;
    const key = `${match.code}:${date}`;
    const matches = entries.get(key) ?? [];
    matches.push({ home: norm(match.home.name), away: norm(match.away.name) });
    entries.set(key, matches);
  }
  return entries;
}

function sameTeam(left: string, right: string) {
  return (
    left === right ||
    (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)))
  );
}

async function loadFeed(): Promise<ExpandedFixtureFeed> {
  const now = new Date();
  const season = seasonFor(now);
  const from = now.toISOString().slice(0, 10);
  const tomorrow = dayAfter(from, 1);
  const through = dayAfter(from, 30);
  const [apiBase, odds, betika] = await Promise.all([
    loadApiFootballFixtures(from, tomorrow),
    loadOddsApiFixtures(from, tomorrow),
    loadBetikaPublicFixtures(from, through),
  ]);
  const footballData = await loadFootballDataHistory();
  const apiForm = await enrichApiFootballForm(apiBase.fixtures);
  const api = { fixtures: apiForm.fixtures, unavailable: [...apiBase.unavailable, ...apiForm.unavailable] };
  const existing = existingKeys(now.getUTCFullYear());
  const sourceByFile = new Map<string, ExpandedFixture[]>();
  const recentByTeam = new Map<string, { date: string; mark: FormMark; gf: number; ga: number; venue: "home" | "away" }[]>();
  const addRecent = (team: string, date: string, mark: FormMark, gf: number, ga: number, venue: "home" | "away") => {
    const rows = recentByTeam.get(norm(team)) ?? [];
    rows.push({ date, mark, gf, ga, venue });
    recentByTeam.set(norm(team), rows);
  };
  const lastFive = (team: string) => (recentByTeam.get(norm(team)) ?? [])
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((row) => row.mark)
    .reverse();
  const recentSummary = (team: string) => {
    const rows = (recentByTeam.get(norm(team)) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const latest = rows.slice(0, 5);
    return {
      form: latest.map((row) => row.mark).reverse(),
      homeForm: rows.filter((row) => row.venue === "home").slice(0, 5).map((row) => row.mark).reverse(),
      awayForm: rows.filter((row) => row.venue === "away").slice(0, 5).map((row) => row.mark).reverse(),
      goals: latest.length ? { scored: latest.reduce((sum, row) => sum + row.gf, 0), conceded: latest.reduce((sum, row) => sum + row.ga, 0) } : undefined,
    };
  };
  for (const row of footballData.rows) {
    const home = row.homeTeam?.name?.trim();
    const away = row.awayTeam?.name?.trim();
    const homeGoals = row.score?.fullTime?.home;
    const awayGoals = row.score?.fullTime?.away;
    if (row.status !== "FINISHED" || !row.utcDate || !home || !away || typeof homeGoals !== "number" || typeof awayGoals !== "number" || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals)) continue;
    addRecent(home, row.utcDate, homeGoals > awayGoals ? "W" : homeGoals === awayGoals ? "D" : "L", homeGoals, awayGoals, "home");
    addRecent(away, row.utcDate, awayGoals > homeGoals ? "W" : homeGoals === awayGoals ? "D" : "L", awayGoals, homeGoals, "away");
  }
  const unavailable: string[] = [];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < COMPETITIONS.length) {
      const index = nextIndex++;
      const competition = COMPETITIONS[index];
      const sourceUrl = `${ROOT}/${season}/${competition.file}.json`;
      try {
        const response = await fetch(sourceUrl, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(9000),
        });
        if (!response.ok) {
          unavailable.push(`${competition.code}: source returned HTTP ${response.status}`);
          continue;
        }
        const data = (await response.json()) as { matches?: FeedMatch[] };
        const rows = Array.isArray(data.matches) ? data.matches : [];
        const fixtures: ExpandedFixture[] = [];
        for (const row of rows) {
          const score = row.score?.ft;
          if (row.date && score && row.team1?.trim() && row.team2?.trim()) {
            addRecent(row.team1, row.date, score[0] > score[1] ? "W" : score[0] === score[1] ? "D" : "L", score[0], score[1], "home");
            addRecent(row.team2, row.date, score[1] > score[0] ? "W" : score[1] === score[0] ? "D" : "L", score[1], score[0], "away");
          }
          if (
            !row.date ||
            row.date < from ||
            row.date > through ||
            row.score?.ft ||
            !row.team1?.trim() ||
            !row.team2?.trim()
          ) {
            continue;
          }
          const localMatches = existing.get(`${competition.code}:${row.date}`) ?? [];
          if (
            localMatches.some(
              (match) =>
                sameTeam(match.home, norm(row.team1!)) && sameTeam(match.away, norm(row.team2!)),
            )
          ) {
            continue;
          }
          fixtures.push({
            id: `of-${competition.file}-${row.date}-${norm(row.team1)}-${norm(row.team2)}`,
            code: competition.code,
            competition: competition.label,
            date: row.date,
            home: row.team1.trim(),
            away: row.team2.trim(),
            round: row.round?.trim() || null,
            sourceUrl,
            sourceKind: "openfootball",
            kickoffAt: null,
            status: null,
            homeForm: lastFive(row.team1),
            awayForm: lastFive(row.team2),
          });
        }
        sourceByFile.set(competition.file, fixtures);
      } catch {
        unavailable.push(`${competition.code}: source could not be reached`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  for (const [file, rows] of sourceByFile) {
    sourceByFile.set(file, rows.map((fixture) => ({
      ...fixture,
      homeForm: lastFive(fixture.home),
      awayForm: lastFive(fixture.away),
    })));
  }

  const rawFixtures = [...api.fixtures, ...odds.fixtures, ...betika.fixtures, ...sourceByFile.values()].flat();
  const namesNeedingHistory = rawFixtures.filter((fixture) => !fixture.homeForm?.length || !fixture.awayForm?.length).flatMap((fixture) => [fixture.home, fixture.away]);
  const verifiedForms = await lookupVerifiedTeamForms(namesNeedingHistory);
  const allFixtures = rawFixtures.map((fixture) => {
    const home = recentSummary(fixture.home);
    const away = recentSummary(fixture.away);
    const verifiedHome = verifiedForms.get(fixture.home);
    const verifiedAway = verifiedForms.get(fixture.away);
    return {
      ...fixture,
      homeForm: fixture.homeForm?.length ? fixture.homeForm : verifiedHome?.form ?? home.form,
      awayForm: fixture.awayForm?.length ? fixture.awayForm : verifiedAway?.form ?? away.form,
      homeVenueForm: fixture.homeVenueForm?.length ? fixture.homeVenueForm : verifiedHome?.homeForm ?? home.homeForm,
      awayVenueForm: fixture.awayVenueForm?.length ? fixture.awayVenueForm : verifiedAway?.awayForm ?? away.awayForm,
      homeRecentGoals: fixture.homeRecentGoals ?? (verifiedHome ? { scored: verifiedHome.scored, conceded: verifiedHome.conceded } : home.goals),
      awayRecentGoals: fixture.awayRecentGoals ?? (verifiedAway ? { scored: verifiedAway.scored, conceded: verifiedAway.conceded } : away.goals),
    };
  });
  const merged = new Map<string, ExpandedFixture>();
  for (const fixture of allFixtures) {
    const key = `${fixture.date}:${norm(fixture.home)}:${norm(fixture.away)}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, fixture);
      continue;
    }
    merged.set(key, {
      ...previous,
      ...fixture,
      id: previous.id,
      sourceKind: previous.sourceKind === "betika-public" || fixture.sourceKind === "betika-public" ? "betika-public" : previous.sourceKind,
      verifiedOdds: fixture.verifiedOdds ?? previous.verifiedOdds,
      oddsSource: fixture.oddsSource ?? previous.oddsSource,
      oddsCheckedAt: fixture.oddsCheckedAt ?? previous.oddsCheckedAt,
      homeForm: (fixture.homeForm?.length ?? 0) >= (previous.homeForm?.length ?? 0) ? fixture.homeForm : previous.homeForm,
      awayForm: (fixture.awayForm?.length ?? 0) >= (previous.awayForm?.length ?? 0) ? fixture.awayForm : previous.awayForm,
    });
  }
  const fixtures = [...merged.values()].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    return dateOrder || a.competition.localeCompare(b.competition) || a.home.localeCompare(b.home);
  });
  const counts = new Map<string, number>();
  for (const fixture of fixtures) counts.set(fixture.code, (counts.get(fixture.code) ?? 0) + 1);
  const competitions = [
    ...COMPETITIONS.map((competition) => ({ code: competition.code, label: competition.label })),
    ...api.fixtures.map((fixture) => ({ code: fixture.code, label: fixture.competition })),
    ...odds.fixtures.map((fixture) => ({ code: fixture.code, label: fixture.competition })),
    ...betika.fixtures.map((fixture) => ({ code: fixture.code, label: fixture.competition })),
  ].filter((competition, index, list) => list.findIndex((item) => item.code === competition.code) === index);

  return {
    season,
    from,
    through,
    checkedAt: new Date().toISOString(),
    source: "https://github.com/openfootball/football.json",
    competitions: competitions.map((competition) => ({
      code: competition.code,
      label: competition.label,
      count: counts.get(competition.code) ?? 0,
    })),
    fixtures,
    unavailable: [...unavailable, ...footballData.unavailable, ...api.unavailable, ...odds.unavailable, ...betika.unavailable],
    today: from,
    tomorrow,
    liveProvider: api.fixtures.length > 0 || odds.fixtures.length > 0 || betika.fixtures.length > 0,
  };
}

export const getExpandedFixtures = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.feed;
  const feed = await loadFeed();
  if (feed.fixtures.length) cache = { at: Date.now(), feed };
  return feed;
});
