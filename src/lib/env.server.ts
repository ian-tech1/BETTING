const KEY_ALIASES: Record<string, string[]> = {
  API_FOOTBALL_KEY: ["API_FOOTBALL_KEY", "FOOTBALL_API_KEY", "API_FOOTBALL_TOKEN", "API_SPORTS_KEY"],
  ODDS_API_KEY: ["ODDS_API_KEY", "THE_ODDS_API_KEY", "ODDS_API_TOKEN"],
  FOOTBALL_DATA_KEY: ["FOOTBALL_DATA_KEY", "FOOTBALL_DATA_API_KEY"],
  GEMINI_API_KEY: ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY"],
  BETIKA_ODDS_API_KEY: ["BETIKA_ODDS_API_KEY", "BETIKA_API_KEY"],
  SPORTPESA_ODDS_API_KEY: ["SPORTPESA_ODDS_API_KEY", "SPORTPESA_API_KEY"],
  ONE_X_BET_ODDS_API_KEY: ["ONE_X_BET_ODDS_API_KEY", "ONE_XBET_API_KEY", "XBET_API_KEY"],
  BETIKA_ODDS_API_URL: ["BETIKA_ODDS_API_URL", "BETIKA_API_URL"],
  SPORTPESA_ODDS_API_URL: ["SPORTPESA_ODDS_API_URL", "SPORTPESA_API_URL"],
  ONE_X_BET_ODDS_API_URL: ["ONE_X_BET_ODDS_API_URL", "ONE_XBET_API_URL", "XBET_API_URL"],
  SPORTMONKS_API_KEY: ["SPORTMONKS_API_KEY", "SPORTMONKS_API_TOKEN", "SPORTMONKS_TOKEN"],
  GEMINI_MODEL: ["GEMINI_MODEL"],
  OPENAI_API_KEY: ["OPENAI_API_KEY", "OPENAI_KEY"],
  OPENAI_API_BASE: ["OPENAI_API_BASE"],
  OPENAI_MODEL: ["OPENAI_MODEL"],
  GROK_API_KEY: ["GROK_API_KEY", "XAI_API_KEY", "XAI_API_TOKEN"],
  GROK_MODEL: ["GROK_MODEL", "XAI_MODEL"],
};

export function env(key: string): string | undefined {
  const candidates = KEY_ALIASES[key] ?? [key];
  for (const candidate of candidates) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience, gate endpoints and connector-token semantics all
 * key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}
