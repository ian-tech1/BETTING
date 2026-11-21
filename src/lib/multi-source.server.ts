import { env } from "./env.server";
import {
  assessFreshness,
  fatigueFactor,
  fitTimeDecayedDixonColes,
  fittedDcProbabilities,
  multiSeasonElo,
  oddsMovement,
  tableMotivation,
  venuePpg,
  venueSplitFactor,
  weatherDiagnostics,
  type HistoricalMatch,
} from "./analysis";
import { normalizeTeamName } from "./jackpot-utils";
import { getSql, ensureDbReady } from "./db";
import { eloTriple, type Signals } from "./signals";
import type { Triple } from "./engines";

type FixtureContext = { id: string; home: string; away: string; league: string; venue?: string; kickoffAt: string | null };
type ApiFixture = {
  fixture?: { id?: number; date?: string; status?: { short?: string } };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
};
type ProviderOdds = { id?: string; home_team?: string; away_team?: string; commence_time?: string; bookmakers?: { key?: string; title?: string; last_update?: string; markets?: { key?: string; outcomes?: { name?: string; price?: number }[] }[] }[] };

type CacheEntry = { expiresAt: number; createdAt: number; promise: Promise<unknown> };
const cache = new Map<string, CacheEntry>();
const TTL = 20 * 60_000;
const HISTORY_TTL = 24 * 60 * 60_000;
const normalize = (value: string) => normalizeTeamName(value).replace(/\b(fc|afc|cf|sc|club)\b/g, "").replace(/\s+/g, " ").trim();
const exactTeam = (a: string, b: string) => normalize(a) === normalize(b);
const validDate = (value: string | null | undefined) => !!value && Number.isFinite(Date.parse(value));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

async function memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise as Promise<T>;
  const entry: CacheEntry = { expiresAt: Date.now() + ttl, createdAt: Date.now(), promise: load() };
  cache.set(key, entry);
  try {
    const value = await entry.promise as T;
    entry.createdAt = Date.now();
    return value;
  } catch (error) { cache.delete(key); throw error; }
}

async function json(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Provider responded ${response.status}`);
  return response.json();
}

async function apiFootball(path: string, params: Record<string, string | number>, ttl = TTL): Promise<any | null> {
  const key = env("API_FOOTBALL_KEY");
  if (!key) return null;
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return memo(`af:${path}:${query}`, ttl, () => json(`https://v3.football.api-sports.io/${path}?${query}`, { "x-apisports-key": key }));
}

function getLeagueOverrides(): Record<string, number> {
  try {
    const parsed = JSON.parse(env("API_FOOTBALL_LEAGUE_MAP") ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => Number.isInteger(v) && Number(v) > 0).map(([k, v]) => [k, Number(v)]));
  } catch { return {}; }
}

async function resolveLeagueId(league: string): Promise<number | null> {
  const override = getLeagueOverrides()[league];
  if (override) return override;
  const result = await apiFootball("leagues", { search: league });
  const matches = (result?.response ?? []).filter((row: any) => exactTeam(String(row.league?.name ?? ""), league));
  const ids = [...new Set<number>(matches.map((row: any) => Number(row.league?.id)).filter((n: number) => Number.isInteger(n) && n > 0))];
  return ids.length === 1 ? ids[0] : null;
}

function seasonFor(kickoffAt: string | null): number {
  const d = kickoffAt && validDate(kickoffAt) ? new Date(kickoffAt) : new Date();
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

function mapFinished(row: ApiFixture, league: string, season: number): HistoricalMatch | null {
  const f = row.fixture, teams = row.teams, goals = row.goals;
  // Use regular-time FT results only. Exclude extra-time and penalty outcomes from a 1X2 fit.
  if (f?.status?.short !== "FT" || !f.date || !teams?.home?.id || !teams.away?.id || teams.home.id === teams.away.id) return null;
  const homeGoals = goals?.home, awayGoals = goals?.away;
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || Number(homeGoals) < 0 || Number(awayGoals) < 0) return null;
  return { homeId: String(teams.home.id), awayId: String(teams.away.id), homeGoals: Number(homeGoals), awayGoals: Number(awayGoals), kickoffAt: f.date, season, league };
}

async function loadLeagueFixtures(league: string, kickoffAt: string | null) {
  const leagueId = await resolveLeagueId(league).catch(() => null);
  if (!leagueId) return { leagueId: null, all: [] as ApiFixture[], history: [] as HistoricalMatch[], observedAt: null as string | null };
  const current = seasonFor(kickoffAt);
  const payloads = await Promise.all([current, current - 1, current - 2].map((season) =>
    apiFootball("fixtures", { league: leagueId, season }, HISTORY_TTL).catch(() => null),
  ));
  const all = payloads.flatMap((payload) => (payload?.response ?? []) as ApiFixture[]);
  const history = all.map((row) => mapFinished(row, league, seasonFor(row.fixture?.date ?? null))).filter((m): m is HistoricalMatch => !!m);
  const currentKey = `af:fixtures:${new URLSearchParams({ league: String(leagueId), season: String(current) }).toString()}`;
  const observedAt = cache.get(currentKey)?.createdAt;
  return { leagueId, all, history, observedAt: all.length && observedAt ? new Date(observedAt).toISOString() : null };
}

function matchTeamId(fixtures: ApiFixture[], name: string): number | null {
  const ids = new Set<number>();
  for (const row of fixtures) {
    for (const team of [row.teams?.home, row.teams?.away]) {
      if (team?.id && team.name && exactTeam(team.name, name)) ids.add(team.id);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

function teamRecent(fixtures: ApiFixture[], teamId: number, before: number): HistoricalMatch[] {
  return fixtures.map((row) => mapFinished(row, "", seasonFor(row.fixture?.date ?? null)))
    .filter((m): m is HistoricalMatch => !!m && (m.homeId === String(teamId) || m.awayId === String(teamId)) && Date.parse(m.kickoffAt) < before)
    .sort((a, b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt)).slice(0, 20);
}

function ppg(matches: HistoricalMatch[], teamId: string) {
  if (!matches.length) return null;
  const points = matches.reduce((sum, m) => {
    const isHome = m.homeId === teamId;
    const gf = isHome ? m.homeGoals : m.awayGoals;
    const ga = isHome ? m.awayGoals : m.homeGoals;
    return sum + (gf > ga ? 3 : gf === ga ? 1 : 0);
  }, 0);
  return points / matches.length;
}

function restSummary(matches: HistoricalMatch[], teamId: string, kickoffAt: string | null) {
  if (!kickoffAt || !validDate(kickoffAt)) return { days: null, games14d: 0 };
  const cutoff = Date.parse(kickoffAt);
  const teamMatches = matches.filter((m) => (m.homeId === teamId || m.awayId === teamId) && Date.parse(m.kickoffAt) < cutoff).sort((a, b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt));
  const days = teamMatches[0] ? (cutoff - Date.parse(teamMatches[0].kickoffAt)) / 86_400_000 : null;
  const games14d = teamMatches.filter((m) => cutoff - Date.parse(m.kickoffAt) <= 14 * 86_400_000).length;
  return { days, games14d };
}

async function persistHistory(history: HistoricalMatch[], fixtures: ApiFixture[], league: string, leagueId: number | null) {
  if (!history.length || !leagueId) return;
  try {
    await ensureDbReady();
    const sql = await getSql();
    const latest = history.sort((a, b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt)).slice(0, 500);
    const values: unknown[] = [];
    const placeholders = latest.map((m, i) => {
      const row = fixtures.find((f) => String(f.teams?.home?.id) === m.homeId && String(f.teams?.away?.id) === m.awayId && f.fixture?.date === m.kickoffAt);
      const fixtureId = String(row?.fixture?.id ?? `${m.homeId}-${m.awayId}-${m.kickoffAt}`);
      const names = row?.teams;
      const offset = i * 13;
      values.push("api-football", fixtureId, league, league, m.season ?? null, m.kickoffAt, m.homeId, names?.home?.name ?? m.homeId, m.awayId, names?.away?.name ?? m.awayId, m.homeGoals, m.awayGoals, true);
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12},$${offset + 13})`;
    });
    if (placeholders.length) await sql.query(`insert into historical_match_results (provider,fixture_id,league_code,league_name,season,kickoff_at,home_id,home_name,away_id,away_name,home_goals,away_goals,regulation_time) values ${placeholders.join(",")} on conflict (provider,fixture_id) do nothing`, values);
  } catch { /* the in-memory preview or an unconfigured database is not a source failure */ }
}

async function saveLineup(matchId: string, providerMatchId: number | null, status: NonNullable<Signals["lineups"]>["status"], kickoffAt: string, payload: unknown, observedAt: string) {
  try {
    await ensureDbReady();
    const sql = await getSql();
    await sql`insert into lineup_observations (match_id, provider, provider_match_id, status, kickoff_at, observed_at, payload)
      values (${matchId}, 'api-football', ${providerMatchId === null ? null : String(providerMatchId)}, ${status}, ${kickoffAt}, ${observedAt}, ${JSON.stringify(payload)})
      on conflict (match_id, provider, observed_at) do nothing`;
  } catch { /* report the live signal even if optional persistence is not configured */ }
}

async function lateLineup(context: FixtureContext, fixtures: ApiFixture[], homeId: number, awayId: number): Promise<Signals["lineups"] | undefined> {
  if (!context.kickoffAt || !validDate(context.kickoffAt)) return undefined;
  const kickoff = Date.parse(context.kickoffAt), now = Date.now();
  if (now < kickoff - 90 * 60_000 || now > kickoff + 15 * 60_000) return undefined;
  const date = new Date(kickoff).toISOString().slice(0, 10);
  let providerFixture = fixtures.find((f) => f.fixture?.date?.slice(0, 10) === date && f.teams?.home?.id === homeId && f.teams?.away?.id === awayId);
  if (!providerFixture) {
    const day = await apiFootball("fixtures", { team: homeId, date }, 2 * 60_000).catch(() => null);
    const candidates = (day?.response ?? []).filter((f: ApiFixture) => f.teams?.home?.id === homeId && f.teams?.away?.id === awayId && f.fixture?.date && Math.abs(Date.parse(f.fixture.date) - kickoff) < 12 * 60 * 60_000);
    if (candidates.length === 1) providerFixture = candidates[0];
  }
  const observedAt = new Date(Math.floor(now / 60_000) * 60_000).toISOString();
  if (!providerFixture?.fixture?.id) {
    const status = "identity-unverified" as const;
    await saveLineup(context.id, null, status, context.kickoffAt, {}, observedAt);
    return { status, observedAt, homeStarters: 0, awayStarters: 0 };
  }
  const response = await apiFootball("fixtures/lineups", { fixture: providerFixture.fixture.id }, 2 * 60_000).catch(() => null);
  const rows = response?.response ?? [];
  const h = rows.find((r: any) => r.team?.id === homeId);
  const a = rows.find((r: any) => r.team?.id === awayId);
  const homeStarters = Array.isArray(h?.startXI) ? h.startXI.length : 0;
  const awayStarters = Array.isArray(a?.startXI) ? a.startXI.length : 0;
  const status = homeStarters >= 11 && awayStarters >= 11 ? "confirmed" as const : rows.length ? "not-announced" as const : "coverage-unavailable" as const;
  const payload = { home: h?.startXI ?? [], away: a?.startXI ?? [], substitutes: { home: h?.substitutes ?? [], away: a?.substitutes ?? [] } };
  await saveLineup(context.id, providerFixture.fixture.id, status, context.kickoffAt, payload, observedAt);
  return { status, observedAt, homeStarters, awayStarters };
}

function venueCoordinates(context: FixtureContext): { latitude: number; longitude: number } | null {
  try {
    const raw = JSON.parse(env("VENUE_COORDINATES_JSON") ?? "{}");
    const value = raw?.[context.id] ?? (context.venue ? raw?.[context.venue] : null);
    const latitude = Number(value?.latitude ?? value?.lat), longitude = Number(value?.longitude ?? value?.lon);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude };
  } catch { /* malformed coordinates are unavailable */ }
  return null;
}

async function weatherFor(context: FixtureContext): Promise<Signals["weather"] | undefined> {
  if (!context.kickoffAt || !validDate(context.kickoffAt)) return undefined;
  const coords = venueCoordinates(context);
  if (!coords) return undefined;
  const base = (env("OPEN_METEO_BASE_URL") ?? "https://api.open-meteo.com/v1/forecast").replace(/\/$/, "");
  const params = new URLSearchParams({ latitude: String(coords.latitude), longitude: String(coords.longitude), hourly: "temperature_2m,precipitation,wind_speed_10m", timezone: "UTC", forecast_days: "16" });
  const data = await memo(`weather:${context.id}:${context.kickoffAt}`, 30 * 60_000, () => json(`${base}?${params}`)).catch(() => null);
  const times: string[] = data?.hourly?.time ?? [];
  const target = Date.parse(context.kickoffAt);
  let index = -1, delta = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(Date.parse(times[i]) - target);
    if (diff < delta) { delta = diff; index = i; }
  }
  if (index < 0 || delta > 2 * 60 * 60_000) return undefined;
  const temperatureC = Number(data.hourly.temperature_2m?.[index]);
  const precipitationMm = Number(data.hourly.precipitation?.[index]);
  const windKmh = Number(data.hourly.wind_speed_10m?.[index]);
  const observedAt = new Date().toISOString();
  const variables = { temperatureC: Number.isFinite(temperatureC) ? temperatureC : null, precipitationMm: Number.isFinite(precipitationMm) ? precipitationMm : null, windKmh: Number.isFinite(windKmh) ? windKmh : null };
  try {
    await ensureDbReady();
    const sql = await getSql();
    await sql`insert into weather_observations (match_id, provider, latitude, longitude, observed_at, valid_at, variables)
      values (${context.id}, 'open-meteo', ${coords.latitude}, ${coords.longitude}, ${observedAt}, ${times[index]}, ${JSON.stringify(variables)}) on conflict do nothing`;
  } catch { /* weather remains a display-only diagnostic */ }
  return { validAt: times[index], ...(Number.isFinite(temperatureC) ? { temperatureC } : {}), ...(Number.isFinite(precipitationMm) ? { precipitationMm } : {}), ...(Number.isFinite(windKmh) ? { windKmh } : {}), diagnostics: weatherDiagnostics({ ...(Number.isFinite(temperatureC) ? { temperatureC } : {}), ...(Number.isFinite(precipitationMm) ? { precipitationMm } : {}), ...(Number.isFinite(windKmh) ? { windKmh } : {}) }) };
}

const SPORT_BY_LEAGUE: Record<string, string> = {
  "Premier League": "soccer_epl", "Championship": "soccer_efl_champ", "Bundesliga": "soccer_germany_bundesliga",
  "La Liga": "soccer_spain_la_liga", "Serie A": "soccer_italy_serie_a", "Ligue 1": "soccer_france_ligue_one",
  "Eredivisie": "soccer_netherlands_eredivisie", "Primeira Liga": "soccer_portugal_primeira_liga",
};

async function captureOdds(context: FixtureContext): Promise<{ market: Triple | null; movement: Signals["oddsMovement"] | null; dispersion: number | undefined }> {
  const key = env("ODDS_API_KEY"), sport = SPORT_BY_LEAGUE[context.league];
  if (!key || !sport || !context.kickoffAt) return { market: null, movement: null, dispersion: undefined };
  const payload = await memo(`odds:${sport}`, TTL, () => json(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${encodeURIComponent(key)}&regions=eu,uk&markets=h2h&oddsFormat=decimal`)).catch(() => null) as ProviderOdds[] | null;
  const events = (payload ?? []).filter((event) => exactTeam(String(event.home_team ?? ""), context.home) && exactTeam(String(event.away_team ?? ""), context.away));
  if (events.length !== 1) return { market: null, movement: null, dispersion: undefined };
  const event = events[0];
  if (event.commence_time && Math.abs(Date.parse(event.commence_time) - Date.parse(context.kickoffAt)) > 36 * 60 * 60_000) return { market: null, movement: null, dispersion: undefined };
  const capturedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const captured: { key: string; title: string; updatedAt: string | null; odds: Triple }[] = [];
  for (const book of event.bookmakers ?? []) {
    const market = book.markets?.find((m) => m.key === "h2h");
    const find = (name: string) => market?.outcomes?.find((o) => exactTeam(String(o.name ?? ""), name))?.price;
    const h = find(context.home), a = find(context.away), d = find("Draw");
    const updatedAt = book.last_update ?? null;
    const updatedMs = updatedAt ? Date.parse(updatedAt) : NaN;
    const updateAge = Date.now() - updatedMs;
    if (Number.isFinite(h) && Number.isFinite(a) && Number.isFinite(d) && h! > 1 && a! > 1 && d! > 1 && book.key && Number.isFinite(updatedMs) && updateAge >= -5 * 60_000 && updateAge <= 2 * 60 * 60_000) {
      captured.push({ key: book.key, title: book.title ?? book.key, updatedAt, odds: { home: h!, draw: d!, away: a! } });
    }
  }
  if (!captured.length) return { market: null, movement: null, dispersion: undefined };
  try {
    await ensureDbReady();
    const sql = await getSql();
    const prior = await sql<Record<string, unknown>>`select distinct on (bookmaker_key) bookmaker_key, provider_updated_at from odds_observations where match_id = ${context.id} and provider = 'the-odds-api' order by bookmaker_key, captured_at desc`;
    const lastUpdate = new Map(prior.map((row) => [String(row.bookmaker_key), row.provider_updated_at ? new Date(row.provider_updated_at as string | Date).getTime() : NaN]));
    for (const book of captured) {
      if (lastUpdate.get(book.key) === Date.parse(book.updatedAt!)) continue;
      await sql`insert into odds_observations (match_id, provider, event_id, bookmaker_key, bookmaker_name, market, kickoff_at, captured_at, provider_updated_at, home_odds, draw_odds, away_odds)
        values (${context.id}, 'the-odds-api', ${String(event.id ?? context.id)}, ${book.key}, ${book.title}, 'h2h', ${context.kickoffAt}, ${capturedAt}, ${book.updatedAt}, ${book.odds.home}, ${book.odds.draw}, ${book.odds.away}) on conflict do nothing`;
    }
  } catch { /* external live quotes remain usable even if durable persistence is unavailable */ }
  const { multiBookConsensus } = await import("./signals");
  const marketConsensus = multiBookConsensus(captured.map((b) => b.odds));
  let movement: Signals["oddsMovement"] | null = null;
  try {
    await ensureDbReady();
    const sql = await getSql();
    const history = await sql<Record<string, unknown>>`select bookmaker_key, captured_at, kickoff_at, home_odds, draw_odds, away_odds from odds_observations where match_id = ${context.id} and provider = 'the-odds-api' order by captured_at asc`;
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of history) groups.set(String(row.bookmaker_key), [...(groups.get(String(row.bookmaker_key)) ?? []), row]);
    const shifts: Triple[] = [];
    let openingAt: string | null = null, currentAt: string | null = null;
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      const first = rows[0], last = rows[rows.length - 1];
      const quote = (r: Record<string, unknown>): Triple => ({ home: Number(r.home_odds), draw: Number(r.draw_odds), away: Number(r.away_odds) });
      const firstUpdate = String(first.provider_updated_at ?? ""), lastUpdate = String(last.provider_updated_at ?? "");
      const shift = firstUpdate && lastUpdate && firstUpdate !== lastUpdate ? oddsMovement(quote(first), quote(last)) : null;
      if (shift) shifts.push(shift);
      openingAt ??= new Date(first.captured_at as string | Date).toISOString();
      currentAt = new Date(last.captured_at as string | Date).toISOString();
    }
    if (shifts.length && openingAt && currentAt) {
      const med = (key: keyof Triple) => { const xs = shifts.map((s) => s[key]).sort((a, b) => a - b); return xs[Math.floor(xs.length / 2)]; };
      movement = { openingObservedAt: openingAt, currentObservedAt: currentAt, movement: { home: med("home"), draw: med("draw"), away: med("away") } };
    }
  } catch { /* no persistent history means no movement claim */ }
  const ppg = marketConsensus?.p;
  return { market: ppg ?? null, movement, dispersion: marketConsensus?.dispersion };
}

async function saveStandings(matchId: string, leagueId: number, season: number, teamId: number, observedAt: string, row: any, gamesLeft: number | null) {
  try {
    await ensureDbReady();
    const sql = await getSql();
    await sql`insert into standings_observations (match_id, provider, league_id, team_id, season, observed_at, position, points, played, games_left)
      values (${matchId}, 'api-football', ${String(leagueId)}, ${String(teamId)}, ${season}, ${observedAt}, ${row.rank ?? null}, ${row.points ?? null}, ${row.all?.played ?? null}, ${gamesLeft}) on conflict do nothing`;
  } catch { /* standings remain live diagnostics */ }
}

export async function loadMultiSourceSignals(context: FixtureContext): Promise<Signals & { used: string[] }> {
  const used: string[] = [];
  const s: Signals & { used: string[] } = { used, notes: [], featureStatus: [] };
  const status = (id: string, state: NonNullable<Signals["featureStatus"]>[number]["status"], detail: string) => s.featureStatus!.push({ id, status: state, detail });
  const key = env("API_FOOTBALL_KEY");
  const weatherAvailable = !!venueCoordinates(context);
  const nowIso = new Date().toISOString();
  if (!key) {
    s.freshness = assessFreshness([{ name: "API-Football core team history", observedAt: null, required: true, maxAgeHours: 24 }]);
    for (const id of ["fatigue", "venue-split", "standings-motivation", "late-lineups", "elo-multiseason", "dixon-coles", "league-draw-rate"]) status(id, "missing", "API_FOOTBALL_KEY is not configured; no data is inferred.");
  }

  const leagueData = key ? await loadLeagueFixtures(context.league, context.kickoffAt).catch(() => ({ leagueId: null, all: [], history: [], observedAt: null })) : { leagueId: null, all: [] as ApiFixture[], history: [] as HistoricalMatch[], observedAt: null as string | null };
  const homeId = leagueData.leagueId ? matchTeamId(leagueData.all, context.home) : null;
  const awayId = leagueData.leagueId ? matchTeamId(leagueData.all, context.away) : null;
  const completeLeagueHistory = leagueData.history;
  const cutoff = context.kickoffAt && validDate(context.kickoffAt) ? Date.parse(context.kickoffAt) : Date.now();
  const history = completeLeagueHistory.filter((m) => Date.parse(m.kickoffAt) < cutoff);
  const coreReady = validDate(context.kickoffAt) && !!leagueData.observedAt && !!homeId && !!awayId && history.filter((m) => m.homeId === String(homeId) || m.awayId === String(homeId)).length >= 4 && history.filter((m) => m.homeId === String(awayId) || m.awayId === String(awayId)).length >= 4;
  s.freshness = assessFreshness([
    { name: "API-Football league history / home team", observedAt: coreReady ? leagueData.observedAt : null, required: true, maxAgeHours: 24 },
    { name: "API-Football league history / away team", observedAt: coreReady ? leagueData.observedAt : null, required: true, maxAgeHours: 24 },
  ]);

  let contextSwing = 0;
  if (coreReady && homeId && awayId) {
    const hid = String(homeId), aid = String(awayId);
    const [homeRecentPayload, awayRecentPayload] = await Promise.all([
      apiFootball("fixtures", { team: homeId, last: 20 }, HISTORY_TTL).catch(() => null),
      apiFootball("fixtures", { team: awayId, last: 20 }, HISTORY_TTL).catch(() => null),
    ]);
    const hRecent = teamRecent((homeRecentPayload?.response ?? []) as ApiFixture[], homeId, cutoff);
    const aRecent = teamRecent((awayRecentPayload?.response ?? []) as ApiFixture[], awayId, cutoff);
    const hr = restSummary(hRecent, hid, context.kickoffAt), ar = restSummary(aRecent, aid, context.kickoffAt);
    s.rest = { homeDays: hr.days, awayDays: ar.days, homeGames14d: hr.games14d, awayGames14d: ar.games14d };
    const homeOverall = ppg(history.filter((m) => m.homeId === hid || m.awayId === hid), hid);
    const awayOverall = ppg(history.filter((m) => m.homeId === aid || m.awayId === aid), aid);
    const homeVenue = venuePpg(history, hid, "home"), awayVenue = venuePpg(history, aid, "away");
    const homeFactor = venueSplitFactor(homeOverall, homeVenue.ppg, homeVenue.games);
    const awayFactor = venueSplitFactor(awayOverall, awayVenue.ppg, awayVenue.games);
    s.venueSplit = { homePpg: homeVenue.ppg, awayPpg: awayVenue.ppg, homeFactor, awayFactor, homeGames: homeVenue.games, awayGames: awayVenue.games };
    if (hr.days !== null && ar.days !== null) {
      contextSwing += clamp((fatigueFactor(hr.days, hr.games14d) - fatigueFactor(ar.days, ar.games14d)) * 0.12, -0.025, 0.025);
      status("fatigue", "ready", `Rest: ${hr.days.toFixed(1)} d vs ${ar.days.toFixed(1)} d; based on completed fixtures.`);
      used.push("Rest and fatigue from completed fixtures");
    } else status("fatigue", "missing", "No verified previous fixture timestamp for both teams.");
    if (homeVenue.games >= 4 && awayVenue.games >= 4) {
      contextSwing += clamp((homeFactor - awayFactor) * 0.08, -0.02, 0.02);
      status("venue-split", "ready", `${homeVenue.games} home and ${awayVenue.games} away results with shrinkage.`);
      used.push("Home/away venue-split form");
    } else status("venue-split", "missing", "Fewer than four venue-specific results for one side.");

    const season = seasonFor(context.kickoffAt);
    if (leagueData.leagueId) {
      const tableData = await apiFootball("standings", { league: leagueData.leagueId, season }).catch(() => null);
      const table = (tableData?.response?.[0]?.league?.standings ?? []).flat() as any[];
      const hTable = table.find((r) => r.team?.id === homeId), aTable = table.find((r) => r.team?.id === awayId);
      const future = leagueData.all.filter((f) => f.fixture?.date && Date.parse(f.fixture.date) >= cutoff - 30 * 60_000 && ["NS", "TBD"].includes(String(f.fixture.status?.short)));
      const gamesLeft = (id: number) => future.filter((f) => f.teams?.home?.id === id || f.teams?.away?.id === id).length;
      const hm = tableMotivation(hTable?.rank ?? null, table.length || null, hTable ? gamesLeft(homeId) : null);
      const am = tableMotivation(aTable?.rank ?? null, table.length || null, aTable ? gamesLeft(awayId) : null);
      const observedAt = new Date().toISOString();
      if (hTable) await saveStandings(context.id, leagueData.leagueId, season, homeId, observedAt, hTable, hm.stakes === "unknown" ? null : gamesLeft(homeId));
      if (aTable) await saveStandings(context.id, leagueData.leagueId, season, awayId, observedAt, aTable, am.stakes === "unknown" ? null : gamesLeft(awayId));
      if (hTable && aTable) {
        s.motivation = { home: hm.stakes, away: am.stakes, homeFactor: hm.factor, awayFactor: am.factor };
        contextSwing += clamp(((hm.factor ?? 1) - (am.factor ?? 1)) * 0.08, -0.015, 0.015);
        status("standings-motivation", "ready", `Standings ${hTable.rank} and ${aTable.rank}; remaining fixtures counted from provider schedule.`);
        used.push("Table position and remaining-fixture motivation");
      } else status("standings-motivation", "missing", "Provider standings did not identify both teams; no motivation adjustment.");
    } else status("standings-motivation", "missing", "League mapping is ambiguous; configure API_FOOTBALL_LEAGUE_MAP to use standings.");

    const elo = multiSeasonElo(history);
    const ratingHome = elo.ratings.get(hid), ratingAway = elo.ratings.get(aid);
    if (ratingHome !== undefined && ratingAway !== undefined && elo.matches >= 100) {
      s.elo = eloTriple(ratingHome, ratingAway);
      used.push(`Multi-season Elo (${elo.seasons.length} seasons, ${elo.matches} results)`);
      status("elo-multiseason", "ready", `${elo.matches} completed results across ${elo.seasons.length} seasons.`);
    } else status("elo-multiseason", "missing", "At least 100 validated results are required for Elo history.");
    const fitted = fitTimeDecayedDixonColes(history);
    if (fitted) {
      s.dixonColes = fittedDcProbabilities(fitted, hid, aid);
      used.push(`Time-decayed Dixon–Coles (${fitted.samples} results)`);
      status("dixon-coles", "ready", `Fitted on ${fitted.samples} dated results; half-life ${fitted.halfLifeDays} days.`);
    } else status("dixon-coles", "missing", "Fewer than 100 suitable dated results or insufficient team coverage.");
    const draws = history.filter((m) => m.homeGoals === m.awayGoals).length;
    if (history.length >= 20) {
      s.drawPrior = { draws, sample: history.length, observedAt: leagueData.observedAt ?? nowIso };
      status("league-draw-rate", "ready", `${draws}/${history.length} draw results, shrunk toward the global prior.`);
      used.push("League-specific draw-rate prior");
    } else status("league-draw-rate", "missing", "At least 20 completed league results are required.");
    void persistHistory(history, leagueData.all, context.league, leagueData.leagueId);

    const lineup = await lateLineup(context, leagueData.all, homeId, awayId).catch(() => undefined);
    if (lineup) {
      s.lineups = lineup;
      status("late-lineups", lineup.status === "confirmed" ? "ready" : "missing", lineup.status === "confirmed" ? `${lineup.homeStarters} and ${lineup.awayStarters} starters confirmed; saved separately.` : `Lineup state: ${lineup.status}; forecast remains frozen.`);
      if (lineup.status === "confirmed") used.push("Late lineup check (separate observation)");
    } else status("late-lineups", "diagnostic", "Lineup query activates on-demand within 90 minutes of a verified kickoff.");
  } else if (key) {
    for (const id of ["fatigue", "venue-split", "standings-motivation", "elo-multiseason", "dixon-coles", "league-draw-rate", "late-lineups"]) status(id, "missing", "Exact competition/team identity or a sufficient real-results history was unavailable.");
    s.notes?.push("API-Football data did not uniquely verify both teams and competition; no live team-context adjustment was applied.");
  }

  const weather = await weatherFor(context).catch(() => undefined);
  if (weather) {
    s.weather = weather;
    status("weather", weather.diagnostics.length ? "diagnostic" : "ready", weather.diagnostics.length ? weather.diagnostics.join(" ") : `Open-Meteo forecast for ${weather.validAt}; diagnostic only.`);
    used.push("Open-Meteo matchday weather diagnostic");
  } else status("weather", weatherAvailable ? "missing" : "missing", "Verified venue coordinates and a forecast within range are required.");

  const odds = await captureOdds(context).catch(() => ({ market: null, movement: null, dispersion: undefined }));
  if (odds.market) { s.market = odds.market; s.dispersion = odds.dispersion; used.push("The Odds API multi-book consensus"); status("market-prices", "ready", "Current 1X2 quote matched by exact teams and fixture date."); }
  else status("market-prices", "missing", "No fresh exact The Odds API event and bookmaker quotes are available.");
  if (odds.movement?.movement) { s.movement = odds.movement.movement; s.oddsMovement = odds.movement; status("odds-movement", "ready", `Opening/current are first and latest app-observed quotes (${odds.movement.openingObservedAt} → ${odds.movement.currentObservedAt}).`); used.push("Timestamped odds movement"); }
  else status("odds-movement", env("ODDS_API_KEY") ? "missing" : "missing", "Two timestamped, same-event quotes are required; no opening price is inferred.");

  if (contextSwing) s.nudge = { home: contextSwing, draw: 0, away: -contextSwing };
  if (!key) s.notes?.push("No API-Football key: stale bundled figures are not treated as verified live inputs; pass until required current team data is available.");
  return s;
}
