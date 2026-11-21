import { env } from "@/lib/env.server";
import { providerStatus } from "@/lib/data-providers.server";
import { getSql } from "@/lib/db";

const PROVIDERS = [
  ["manus-ai", "Manus AI", Boolean(env("MANUS_API_URL") && env("MANUS_API_KEY"))],
  ["odds-api", "The Odds API", providerStatus().odds],
  ["api-football", "API-Football", providerStatus().apiFootball],
  ["football-data", "Football-Data.org", providerStatus().footballData],
  ["betika-authorized", "Betika authorized feed", Boolean(env("BETIKA_ODDS_API_URL") && env("BETIKA_ODDS_API_KEY"))],
  ["sportpesa-authorized", "SportPesa authorized feed", Boolean(env("SPORTPESA_ODDS_API_URL") && env("SPORTPESA_ODDS_API_KEY"))],
  ["1xbet-authorized", "1xBet authorized feed", Boolean(env("ONE_X_BET_ODDS_API_URL") && env("ONE_X_BET_ODDS_API_KEY"))],
] as const;

export function publicProviderStatus() {
  return PROVIDERS.map(([id, name, configured]) => ({ id, name, configured }));
}

export function isAdmin(userId: string): boolean {
  const allowed = (env("ADMIN_USER_IDS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return allowed.includes(userId) || userId === env("BOOTSTRAP_ADMIN_USER_ID");
}

export async function operationalStatus() {
  let rows: Array<{ job_type: string; status: string; created_at: string }> = [];
  let storage = "unconfigured";
  try {
    const sql = await getSql();
    rows = await sql.query<{ job_type: string; status: string; created_at: string }>(
      "select distinct on (job_type) job_type, status, created_at from job_runs order by job_type, created_at desc",
    );
    storage = "connected";
  } catch {
    // Provider coverage is still useful before an app Postgres URL is added.
  }
  return {
    generatedAt: new Date().toISOString(),
    storage,
    providers: publicProviderStatus(),
    workers: ["fixture-sync", "odds-snapshot", "prediction-refresh", "result-settlement", "ai-analysis"].map((jobType) => {
      const row = rows.find((candidate) => candidate.job_type === jobType);
      return { jobType, status: row?.status ?? "idle", lastRunAt: row?.created_at ?? null };
    }),
  };
}
