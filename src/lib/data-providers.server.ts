import { env } from "./env.server";

/** Server-only data feeds. Keys come from environment variables, never from source code. Each returns null when its key is missing. */
async function get(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

/** Multi-bookmaker 1X2 odds. Key: https://the-odds-api.com */
export async function fetchMarketOdds(sportKey = "soccer_epl") {
  const key = env("ODDS_API_KEY");
  if (!key) return null;
  return get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${key}&regions=eu,uk&markets=h2h&oddsFormat=decimal`);
}

/** Injuries, standings, recent fixtures. Key: https://www.api-football.com */
export async function fetchApiFootball(path: "injuries" | "standings" | "fixtures", params: Record<string, string | number>) {
  const key = env("API_FOOTBALL_KEY");
  if (!key) return null;
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return get(`https://v3.football.api-sports.io/${path}?${qs}`, { "x-apisports-key": key });
}

/** Finished results for Elo and form. Key: https://www.football-data.org/client/register */
export async function fetchResults(competition = "PL", dateFrom?: string, dateTo?: string) {
  const key = env("FOOTBALL_DATA_KEY");
  if (!key) return null;
  const q = new URLSearchParams({ status: "FINISHED", ...(dateFrom && { dateFrom }), ...(dateTo && { dateTo }) });
  return get(`https://api.football-data.org/v4/competitions/${competition}/matches?${q}`, { "X-Auth-Token": key });
}

export const providerStatus = () => ({
  odds: !!env("ODDS_API_KEY"),
  apiFootball: !!env("API_FOOTBALL_KEY"),
  footballData: !!env("FOOTBALL_DATA_KEY"),
  sportMonks: !!env("SPORTMONKS_API_KEY"),
});
