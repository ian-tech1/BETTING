export type JackpotResult = "home" | "draw" | "away";

const TEAM_GROUPS = [
  ["paderborn", "sc paderborn", "sc paderborn 07", "paderborn 07"],
  ["eintracht", "eintracht frankfurt"],
  ["man utd", "manchester united", "manchester utd"],
  ["athletic club", "athletic bilbao", "athletic"],
  ["deportivo", "deportivo la coruna", "deportivo de la coruna", "depor"],
  ["newcastle", "newcastle united"],
  ["auxerre", "aj auxerre"],
  ["real betis", "betis"],
  ["paris fc", "paris football club"],
];

const TEAM_CANONICAL = new Map<string, string>();
for (const group of TEAM_GROUPS) {
  const canonical = normalizeTeamName(group[0]);
  for (const value of group) TEAM_CANONICAL.set(normalizeTeamName(value), canonical);
}

export function normalizeTeamName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(the|fc|afc|sc|cf)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Strict team matching: known short forms are supported, arbitrary substrings are not. */
export function sameTeam(left: string, right: string): boolean {
  const a = normalizeTeamName(left);
  const b = normalizeTeamName(right);
  if (!a || !b) return false;
  return (TEAM_CANONICAL.get(a) ?? a) === (TEAM_CANONICAL.get(b) ?? b);
}

/** Betika's public match list timestamps are Kenya local time (UTC+03:00) without an offset. */
export function parseBetikaKickoff(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const timestamp = Date.parse(hasZone ? normalized : `${normalized}+03:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** A single deterministic 1X2 choice. Ties keep the explicit home/draw/away order. */
export function topResult(probabilities: Record<JackpotResult, number>): JackpotResult {
  const order: JackpotResult[] = ["home", "draw", "away"];
  return order.reduce((top, result) => (probabilities[result] > probabilities[top] ? result : top));
}

/** Flag a market outcome only when its no-vig probability materially exceeds the model estimate. */
export function isModelDisagreement(
  marketProbability: number,
  modelProbability: number,
  threshold = 0.1,
): boolean {
  return (
    Number.isFinite(marketProbability) &&
    Number.isFinite(modelProbability) &&
    marketProbability - modelProbability >= threshold
  );
}

export function stableFixtureId(
  book: string,
  home: string,
  away: string,
  kickoff: string | number,
): string {
  const slug = (value: string) => {
    const normalized = normalizeTeamName(value);
    return (TEAM_CANONICAL.get(normalized) ?? normalized).slice(0, 48) || "unknown";
  };
  const time = typeof kickoff === "number" ? String(kickoff) : kickoff.replace(/[^0-9]/g, "");
  return `${book}-${slug(home)}-${slug(away)}-${time || "unknown"}`.toLowerCase();
}
