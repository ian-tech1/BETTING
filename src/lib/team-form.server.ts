import { env } from "@/lib/env.server";

export type TeamFormMark = "W" | "D" | "L";
export type VerifiedTeamForm = {
  form: TeamFormMark[];
  homeForm: TeamFormMark[];
  awayForm: TeamFormMark[];
  scored: number;
  conceded: number;
  source: string;
  checkedAt: string;
};

type FixtureRow = {
  fixture?: { date?: string; status?: { short?: string } };
  teams?: { home?: { id?: number }; away?: { id?: number } };
  goals?: { home?: number | null; away?: number | null };
};

type TeamSearchRow = { team?: { id?: number; name?: string } };
const cache = new Map<string, { at: number; value: VerifiedTeamForm | null }>();
const CACHE_MS = 15 * 60 * 1000;
let recentFixtureCache: { at: number; rows: FixtureRow[] } | undefined;

function key(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(fc|afc|sc|cf|the)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function chooseTeam(rows: TeamSearchRow[], wanted: string) {
  const wantedKey = key(wanted);
  return rows.map((row) => row.team).filter((team): team is { id: number; name?: string } => typeof team?.id === "number").sort((left, right) => {
    const leftKey = key(left.name ?? "");
    const rightKey = key(right.name ?? "");
    const leftExact = leftKey === wantedKey ? 0 : leftKey.includes(wantedKey) || wantedKey.includes(leftKey) ? 1 : 2;
    const rightExact = rightKey === wantedKey ? 0 : rightKey.includes(wantedKey) || wantedKey.includes(rightKey) ? 1 : 2;
    return leftExact - rightExact;
  })[0];
}

async function loadRecentFixtureRows(apiKey: string): Promise<FixtureRow[]> {
  if (recentFixtureCache && Date.now() - recentFixtureCache.at < CACHE_MS) return recentFixtureCache.rows;
  const dates = Array.from({ length: 45 }, (_, age) => new Date(Date.now() - age * 86400000).toISOString().slice(0, 10));
  const rows: FixtureRow[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < dates.length) {
      const date = dates[cursor++];
      try {
        const query = new URLSearchParams({ date, status: "FT" });
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?${query}`, { headers: { "x-apisports-key": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) continue;
        const body = await response.json() as { response?: FixtureRow[] };
        rows.push(...(body.response ?? []).filter((row) => ["FT", "AET", "PEN"].includes(row.fixture?.status?.short ?? "") && typeof row.fixture?.date === "string" && typeof row.goals?.home === "number" && typeof row.goals?.away === "number"));
      } catch { /* other completed dates remain usable */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  recentFixtureCache = { at: Date.now(), rows };
  return rows;
}

async function fetchTeamForm(name: string, apiKey: string): Promise<VerifiedTeamForm | null> {
  const search = new URLSearchParams({ search: name });
  const searchResponse = await fetch(`https://v3.football.api-sports.io/teams?${search}`, {
    headers: { "x-apisports-key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!searchResponse.ok) return null;
  const searchBody = await searchResponse.json() as { response?: TeamSearchRow[] };
  const team = chooseTeam(searchBody.response ?? [], name);
  if (!team) return null;
  const rows = (await loadRecentFixtureRows(apiKey)).filter((row) => row.teams?.home?.id === team.id || row.teams?.away?.id === team.id).sort((left, right) => String(right.fixture?.date).localeCompare(String(left.fixture?.date)));
  if (!rows.length) return null;
  const overall = rows.slice(0, 5);
  const home = rows.filter((row) => row.teams?.home?.id === team.id).slice(0, 5);
  const away = rows.filter((row) => row.teams?.away?.id === team.id).slice(0, 5);
  const mark = (row: FixtureRow) => {
    const isHome = row.teams?.home?.id === team.id;
    const scored = isHome ? row.goals!.home! : row.goals!.away!;
    const conceded = isHome ? row.goals!.away! : row.goals!.home!;
    return { mark: scored > conceded ? "W" as const : scored === conceded ? "D" as const : "L" as const, scored, conceded };
  };
  const makeForm = (items: FixtureRow[]) => items.map(mark).map((item) => item.mark).reverse();
  const totals = overall.map(mark).reduce((sum, item) => ({ scored: sum.scored + item.scored, conceded: sum.conceded + item.conceded }), { scored: 0, conceded: 0 });
  return { form: makeForm(overall), homeForm: makeForm(home), awayForm: makeForm(away), scored: totals.scored, conceded: totals.conceded, source: "API-Football verified", checkedAt: new Date().toISOString() };
}

export async function lookupVerifiedTeamForms(names: string[]) {
  const apiKey = env("API_FOOTBALL_KEY");
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const result = new Map<string, VerifiedTeamForm>();
  if (!apiKey) return result;
  let cursor = 0;
  const worker = async () => {
    while (cursor < unique.length) {
      const name = unique[cursor++];
      const cacheKey = key(name);
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_MS) {
        if (cached.value) result.set(name, cached.value);
        continue;
      }
      try {
        const value = await fetchTeamForm(name, apiKey);
        cache.set(cacheKey, { at: Date.now(), value });
        if (value) result.set(name, value);
      } catch {
        cache.set(cacheKey, { at: Date.now(), value: null });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, unique.length || 1) }, () => worker()));
  return result;
}
