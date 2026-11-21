import { env } from "@/lib/env.server";

export type AiPredictionBrief = {
  home: string;
  away: string;
  league?: string;
  kickoffAt?: string;
  probabilities: { home: number; draw: number; away: number };
  mostLikelyScore?: string;
  evidence: Array<{ label: string; value: string; source?: string }>;
};

export type AiPredictionReview = {
  summary: string;
  uncertainty: string[];
  alternateScores: string[];
  watchouts: string[];
  confidence: number;
  generatedAt: string;
  model: string;
};

function clampProbability(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function parseReview(content: string, model: string): AiPredictionReview | null {
  try {
    const parsed = JSON.parse(content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "")) as Record<string, unknown>;
    const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    if (!summary) return null;
    return {
      summary,
      uncertainty: list(parsed.uncertainty),
      alternateScores: list(parsed.alternateScores),
      watchouts: list(parsed.watchouts),
      confidence: clampProbability(parsed.confidence),
      generatedAt: new Date().toISOString(),
      model,
    };
  } catch {
    return null;
  }
}

export async function reviewPredictionWithManus(input: AiPredictionBrief): Promise<AiPredictionReview | null> {
  const baseUrl = env("MANUS_API_URL");
  const apiKey = env("MANUS_API_KEY");
  if (!baseUrl || !apiKey) return null;
  const model = env("MANUS_PREDICTION_MODEL") ?? "gpt-5-mini";
  const prompt = [
    `Review this pre-match football forecast for ${input.home} vs ${input.away}.`,
    "Do not invent injuries, odds, lineups, or news. Do not promise a correct score or betting win.",
    "The statistical probabilities are authoritative inputs, not facts to override.",
    "Return JSON only with summary, uncertainty (array), alternateScores (array), watchouts (array), confidence (0..1).",
    JSON.stringify(input),
  ].join("\n");
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are a cautious football analysis reviewer. Evidence first, uncertainty visible." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: unknown };
  if (body.error) return null;
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" ? parseReview(content, model) : null;
}
