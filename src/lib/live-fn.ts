import { createServerFn } from "@tanstack/react-start";
import { env } from "./env.server";

export type VerifiedLiveGame = {
  id: string;
  league: string;
  code: string;
  home: string;
  away: string;
  kickoffAt: string;
  minute: number;
  half: string;
  homeScore: number;
  awayScore: number;
  sources: string[];
};

export type LiveFeedReply = { games: VerifiedLiveGame[]; checkedAt: string; unavailable: string[] };

const SPORTS: [string, string, string][] = [
  ["soccer_epl", "EPL", "Premier League"],
  ["soccer_efl_champ", "CHP", "Championship"],
  ["soccer_germany_bundesliga", "BUN", "Bundesliga"],
  ["soccer_spain_la_liga", "LAL", "La Liga"],
  ["soccer_italy_serie_a", "SEA", "Serie A"],
  ["soccer_france_ligue_one", "FRA", "Ligue 1"],
  ["soccer_netherlands_eredivisie", "ERE", "Eredivisie"],
  ["soccer_portugal_primeira_liga", "POR", "Primeira Liga"],
];

const inPlayStatus = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "IN_PLAY"]);
const normalize = (value: string) => value.toLowerCase().replace(/\b(fc|afc|cf|sc|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const samePair = (a: string, b: string, c: string, d: string) => normalize(a) === normalize(c) && normalize(b) === normalize(d);

function minuteFromKickoff(kickoffAt: string) {
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(kickoffAt)) / 60000));
  if (elapsed === 45) return { minute: 45, half: "Half-time" };
  if (elapsed > 45 && elapsed < 60) return { minute: elapsed, half: "2nd half" };
  if (elapsed >= 90) return { minute: elapsed, half: "Added time" };
  return { minute: elapsed, half: "1st half" };
}

async function apiFootball(): Promise<{ games: VerifiedLiveGame[]; error?: string }> {
  const key = env("API_FOOTBALL_KEY");
  if (!key) return { games: [], error: "API-Football key not configured" };
  try {
    const response = await fetch("https://v3.football.api-sports.io/fixtures?live=all", { headers: { "x-apisports-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const body = await response.json().catch(() => ({})) as { errors?: Record<string, unknown>; response?: any[] };
    if (!response.ok || Object.keys(body.errors ?? {}).length) return { games: [], error: `API-Football unavailable${body.errors ? `: ${Object.values(body.errors).join("; ")}` : ` (HTTP ${response.status})`}` };
    return { games: (body.response ?? []).flatMap((row) => {
      const status = row.fixture?.status?.short;
      const home = row.teams?.home?.name, away = row.teams?.away?.name, kickoffAt = row.fixture?.date;
      if (!home || !away || !kickoffAt || !inPlayStatus.has(status)) return [];
      const minute = Number(row.fixture?.status?.elapsed ?? 0);
      return [{ id: `af-live-${row.fixture.id}`, league: row.league?.name ?? "Live football", code: String(row.league?.id ?? "LIVE"), home, away, kickoffAt: new Date(kickoffAt).toISOString(), minute, half: status === "HT" ? "Half-time" : status === "2H" ? "2nd half" : status === "ET" ? "Extra time" : "1st half", homeScore: Number(row.goals?.home ?? 0), awayScore: Number(row.goals?.away ?? 0), sources: ["API-Football"] }];
    }) };
  } catch { return { games: [], error: "API-Football request failed" }; }
}

async function oddsApi(): Promise<{ games: VerifiedLiveGame[]; error?: string }> {
  const key = env("ODDS_API_KEY");
  if (!key) return { games: [], error: "The Odds API key not configured" };
  const games: VerifiedLiveGame[] = [];
  const errors: string[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < SPORTS.length) {
      const [sport, code, league] = SPORTS[cursor++];
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${encodeURIComponent(key)}&daysFrom=1`;
        const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
        if (!response.ok) { errors.push(`The Odds API ${league}: HTTP ${response.status}`); continue; }
        const rows = await response.json() as any[];
        for (const row of rows) {
          if (row.completed || !row.commence_time || !row.home_team || !row.away_team) continue;
          const kickoffAt = new Date(row.commence_time).toISOString();
          const clock = minuteFromKickoff(kickoffAt);
          const scoreFor = (name: string) => Number(row.scores?.find((score: any) => score.name === name)?.score ?? 0);
          games.push({ id: `odds-live-${row.id}`, league: row.sport_title ?? league, code, home: row.home_team, away: row.away_team, kickoffAt, minute: clock.minute, half: clock.half, homeScore: scoreFor(row.home_team), awayScore: scoreFor(row.away_team), sources: ["The Odds API"] });
        }
      } catch { errors.push(`The Odds API ${league}: request failed`); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { games, error: errors.length ? errors.join(" · ") : undefined };
}

async function footballData(): Promise<{ games: VerifiedLiveGame[]; error?: string }> {
  const key = env("FOOTBALL_DATA_KEY");
  if (!key) return { games: [], error: "football-data.org key not configured" };
  const games: VerifiedLiveGame[] = [];
  try {
    for (const [competition, code, league] of [["PL", "EPL", "Premier League"], ["BL1", "BUN", "Bundesliga"], ["PD", "LAL", "La Liga"], ["SA", "SEA", "Serie A"]] as const) {
      const response = await fetch(`https://api.football-data.org/v4/competitions/${competition}/matches?status=IN_PLAY`, { headers: { "X-Auth-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return { games: [], error: `football-data.org unavailable (HTTP ${response.status})` };
      const body = await response.json() as { matches?: any[] };
      for (const row of body.matches ?? []) {
        if (!row.utcDate || !row.homeTeam?.name || !row.awayTeam?.name) continue;
        const clock = minuteFromKickoff(row.utcDate);
        games.push({ id: `fd-live-${row.id}`, league: row.competition?.name ?? league, code, home: row.homeTeam.name, away: row.awayTeam.name, kickoffAt: new Date(row.utcDate).toISOString(), minute: clock.minute, half: "Live", homeScore: Number(row.score?.fullTime?.home ?? 0), awayScore: Number(row.score?.fullTime?.away ?? 0), sources: ["football-data.org"] });
      }
    }
    return { games };
  } catch { return { games: [], error: "football-data.org request failed" }; }
}

export const getVerifiedLiveGames = createServerFn({ method: "GET" }).handler(async (): Promise<LiveFeedReply> => {
  const [api, odds, football] = await Promise.all([apiFootball(), oddsApi(), footballData()]);
  const merged: VerifiedLiveGame[] = [];
  for (const game of [...api.games, ...odds.games, ...football.games]) {
    const existing = merged.find((item) => samePair(item.home, item.away, game.home, game.away));
    if (!existing) merged.push(game);
    else { existing.sources = [...new Set([...existing.sources, ...game.sources])]; if (game.sources.includes("API-Football")) Object.assign(existing, game); }
  }
  return { games: merged, checkedAt: new Date().toISOString(), unavailable: [api.error, odds.error, football.error].filter((value): value is string => Boolean(value)) };
});
