import { env } from "./env.server";
import { eloUpdate } from "./accuracy";
import { normalizeTeamName } from "./jackpot-utils";
import { boundedNudge, headToHead, injuryImpact, type Absence, type Signals } from "./signals";
import type { Triple } from "./engines";

/** Server-only. Every fetch is optional: with no key the signal is simply absent. */
async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

const TTL = 20 * 60 * 1000;
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v as T;
  const v = await load();
  cache.set(key, { at: Date.now(), v });
  return v;
}

const COMPETITIONS = ["PL", "ELC", "BL1", "PD", "FL1", "SA", "DED", "PPL"];
export type SignalContext = { id: string; home: string; away: string; league: string; venue?: string; kickoffAt: string | null };
const same = (a: string, b: string) => {
  const x = normalizeTeamName(a), y = normalizeTeamName(b);
  return !!x && !!y && (x === y || (x.length > 4 && y.includes(x)) || (y.length > 4 && x.includes(y)));
};

/** Elo ratings built from real finished results (football-data.org). Cached 20 min. */
export async function eloRatings(): Promise<Map<string, number> | null> {
  const key = env("FOOTBALL_DATA_KEY");
  if (!key) return null;
  return cached("elo", async () => {
    const to = new Date();
    const from = new Date(Date.now() - 9 * 86400000);
    const rows: { date: string; h: string; a: string; gh: number; ga: number }[] = [];
    for (const comp of COMPETITIONS.slice(0, 5)) {
      try {
        // Free tier allows a 10-day window per request; walk back ~60 days.
        for (let w = 0; w < 6; w++) {
          const t = new Date(to.getTime() - w * 9 * 86400000);
          const f = new Date(from.getTime() - w * 9 * 86400000);
          const q = new URLSearchParams({ status: "FINISHED", dateFrom: f.toISOString().slice(0, 10), dateTo: t.toISOString().slice(0, 10) });
          const j = await getJson(`https://api.football-data.org/v4/competitions/${comp}/matches?${q}`, { "X-Auth-Token": key });
          for (const m of j.matches ?? []) {
            const gh = m.score?.fullTime?.home, ga = m.score?.fullTime?.away;
            if (typeof gh === "number" && typeof ga === "number") rows.push({ date: m.utcDate, h: m.homeTeam.name, a: m.awayTeam.name, gh, ga });
          }
        }
      } catch { /* a rate limit on one competition must not drop the rest */ }
    }
    rows.sort((x, y) => x.date.localeCompare(y.date));
    const r = new Map<string, number>();
    for (const m of rows) {
      const next = eloUpdate(r.get(m.h) ?? 1500, r.get(m.a) ?? 1500, m.gh, m.ga);
      r.set(m.h, next.home);
      r.set(m.a, next.away);
    }
    return r;
  });
}

/** Multi-bookmaker 1X2 for a pair of teams, with a rough opening price from the earliest update. */
async function bookOdds(home: string, away: string): Promise<{ books: Triple[] } | null> {
  const key = env("ODDS_API_KEY");
  if (!key) return null;
  const sports = ["soccer_epl", "soccer_efl_champ", "soccer_germany_bundesliga", "soccer_spain_la_liga", "soccer_france_ligue_one", "soccer_italy_serie_a", "soccer_netherlands_eredivisie", "soccer_portugal_primeira_liga"];
  for (const sport of sports) {
    try {
      const list = await cached(`odds-${sport}`, () => getJson(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${key}&regions=eu,uk&markets=h2h&oddsFormat=decimal`));
      const ev = (list as any[]).find((e) => same(e.home_team, home) && same(e.away_team, away));
      if (!ev) continue;
      const books: Triple[] = [];
      for (const b of ev.bookmakers ?? []) {
        const m = b.markets?.find((x: any) => x.key === "h2h");
        const get = (n: string) => m?.outcomes?.find((o: any) => o.name === n)?.price;
        const h = get(ev.home_team), a = get(ev.away_team), d = get("Draw");
        if (h && a && d) books.push({ home: h, draw: d, away: a });
      }
      if (books.length) return { books };
    } catch { /* try next league */ }
  }
  return null;
}

async function apiFootball(path: string, params: Record<string, string | number>) {
  const key = env("API_FOOTBALL_KEY");
  if (!key) return null;
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return cached(`af-${path}-${qs}`, () => getJson(`https://v3.football.api-sports.io/${path}?${qs}`, { "x-apisports-key": key }));
}

async function teamId(name: string): Promise<number | null> {
  const j = await apiFootball("teams", { search: name.split(" ")[0] });
  const hit = (j?.response ?? []).find((t: any) => same(t.team.name, name));
  return hit?.team?.id ?? null;
}

async function absences(id: number, season: number): Promise<Absence[]> {
  const j = await apiFootball("injuries", { team: id, season });
  const pos: Record<string, Absence["role"]> = { Goalkeeper: "GK", Defender: "DEF", Midfielder: "MID", Attacker: "FWD" };
  const seen = new Set<number>();
  const out: Absence[] = [];
  for (const row of j?.response ?? []) {
    if (seen.has(row.player?.id)) continue;
    seen.add(row.player?.id);
    out.push({ role: pos[row.player?.type] ?? "UNK", starter: true });
  }
  return out.slice(0, 8);
}

async function h2h(a: number, b: number) {
  const j = await apiFootball("fixtures/headtohead", { h2h: `${a}-${b}`, last: 8 });
  const out: ("home" | "draw" | "away")[] = [];
  for (const f of j?.response ?? []) {
    const gh = f.goals?.home, ga = f.goals?.away;
    if (typeof gh !== "number" || typeof ga !== "number") continue;
    const homeIsA = f.teams?.home?.id === a;
    const aWon = homeIsA ? gh > ga : ga > gh;
    out.push(gh === ga ? "draw" : aWon ? "home" : "away");
  }
  return out;
}

/** Gemini model used by the optional AI analyst. Override with GEMINI_MODEL if your quota or region needs a different one. */
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";

/**
 * Optional AI analyst (Google Gemini). It only sees numbers we computed and may nudge each outcome by at most
 * 4 points. Key: GEMINI_API_KEY (https://aistudio.google.com/apikey). The free tier has limited quotas, so
 * replies are cached and any quota error (429) or outage simply drops this signal instead of breaking the page.
 */
async function aiNudge(home: string, away: string, base: Triple, facts: string) {
  const key = env("GEMINI_API_KEY");
  if (!key) return null;
  const model = env("GEMINI_MODEL") ?? GEMINI_MODEL_DEFAULT;
  const rounded = { home: +base.home.toFixed(3), draw: +base.draw.toFixed(3), away: +base.away.toFixed(3) };
  try {
    return await cached(`ai-${model}-${home}-${away}-${JSON.stringify(rounded)}-${facts}`, async () => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "You are a football analyst. Reply with JSON only: {\"home\":n,\"draw\":n,\"away\":n,\"note\":\"short reason\"}. Each n is a probability change between -0.04 and 0.04. Use 0 when unsure. Never invent injuries or news; use only the facts given." }],
          },
          contents: [{ role: "user", parts: [{ text: `${home} v ${away}. Model probabilities ${JSON.stringify(rounded)}. Facts: ${facts}` }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });
      // 429 = free-tier quota used up; 404 = model not available to this key. Either way, skip the signal.
      if (!res.ok) return null;
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("").replace(/```json|```/g, "").trim();
      return boundedNudge(JSON.parse(text));
    });
  } catch {
    return null;
  }
}

async function compatibleAiNudge(
  key: string | undefined,
  endpoint: string,
  model: string,
  home: string,
  away: string,
  base: Triple,
  facts: string,
) {
  if (!key) return null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return JSON only: {home:number,draw:number,away:number,note:string}. Numbers are probability changes from -0.04 to 0.04. Use 0 when unsure. Never invent facts." },
          { role: "user", content: `${home} v ${away}. Base probabilities ${JSON.stringify(base)}. Facts: ${facts}` },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return boundedNudge(JSON.parse(content.replace(/```json|```/g, "").trim()));
  } catch {
    return null;
  }
}

export async function buildSignals(home: string, away: string, base: Triple, context?: SignalContext): Promise<Signals & { used: string[] }> {
  const used: string[] = [];
  const s: Signals & { used: string[] } = { used, notes: [] };
  const [elo, odds] = await Promise.all([
    eloRatings().catch(() => null),
    context ? Promise.resolve(null) : bookOdds(home, away).catch(() => null),
  ]);
  if (elo) {
    const find = (n: string) => [...elo.entries()].find(([k]) => same(k, n))?.[1];
    const rh = find(home), ra = find(away);
    if (rh && ra) {
      const { eloTriple } = await import("./signals");
      s.elo = eloTriple(rh, ra);
      used.push("Elo from real results");
    }
  }
  if (odds) {
    const { multiBookConsensus } = await import("./signals");
    const c = multiBookConsensus(odds.books);
    if (c) {
      s.market = c.p;
      s.dispersion = c.dispersion;
      used.push(`${c.books} bookmakers`);
    }
  }
  let facts = "";
  if (env("API_FOOTBALL_KEY")) {
    try {
      const reference = context?.kickoffAt && Number.isFinite(Date.parse(context.kickoffAt)) ? new Date(context.kickoffAt) : new Date();
      const season = reference.getUTCMonth() >= 6 ? reference.getUTCFullYear() : reference.getUTCFullYear() - 1;
      const [hid, aid] = await Promise.all([teamId(home), teamId(away)]);
      if (hid && aid) {
        const [ha, aa, hh] = await Promise.all([absences(hid, season), absences(aid, season), h2h(hid, aid)]);
        const hi = injuryImpact(ha), ai = injuryImpact(aa);
        // Net injury effect on home win chance, kept small.
        const swing = ((hi.attack - 1) - (hi.defence - 1) - ((ai.attack - 1) - (ai.defence - 1))) * 0.25;
        s.nudge = { home: swing, draw: 0, away: -swing };
        s.h2h = headToHead(hh) ?? undefined;
        facts = `Home absences ${ha.length}, away absences ${aa.length}, head-to-head results ${hh.length}.`;
        used.push("Injuries", "Head to head");
      }
    } catch { /* provider outage leaves the signal out */ }
  }
  const [gemini, openAi, grok] = await Promise.all([
    aiNudge(home, away, base, facts || "No injury data available."),
    compatibleAiNudge(env("OPENAI_API_KEY"), `${env("OPENAI_API_BASE") ?? "https://api.openai.com/v1"}/chat/completions`, env("OPENAI_MODEL") ?? "gpt-4o-mini", home, away, base, facts || "No injury data available."),
    compatibleAiNudge(env("GROK_API_KEY"), "https://api.x.ai/v1/chat/completions", env("GROK_MODEL") ?? "grok-3-mini", home, away, base, facts || "No injury data available."),
  ]);
  const supportive = [
    ["Gemini analyst (bounded)", gemini],
    ["OpenAI analyst (bounded)", openAi],
    ["Grok analyst (bounded)", grok],
  ] as const;
  for (const [label, nudge] of supportive) {
    if (!nudge) continue;
    s.nudge = {
      home: (s.nudge?.home ?? 0) + nudge.home,
      draw: (s.nudge?.draw ?? 0) + nudge.draw,
      away: (s.nudge?.away ?? 0) + nudge.away,
    };
    used.push(label);
  }
  if (context) {
    const { loadMultiSourceSignals } = await import("./multi-source.server");
    let extra: Signals & { used: string[] } = { used: [], notes: ["Optional provider request failed; no live feature is assumed."] };
    try { extra = await loadMultiSourceSignals(context); } catch { /* missing provider data is handled by the freshness gate */ }
    s.elo = extra.elo ?? s.elo;
    s.dixonColes = extra.dixonColes;
    s.market = extra.market ?? s.market;
    s.dispersion = extra.dispersion ?? s.dispersion;
    s.movement = extra.movement ?? s.movement;
    s.oddsMovement = extra.oddsMovement;
    s.drawPrior = extra.drawPrior;
    s.rest = extra.rest;
    s.venueSplit = extra.venueSplit;
    s.motivation = extra.motivation;
    s.lineups = extra.lineups;
    s.weather = extra.weather;
    s.freshness = extra.freshness;
    s.featureStatus = extra.featureStatus;
    if (extra.nudge) {
      s.nudge = {
        home: (s.nudge?.home ?? 0) + extra.nudge.home,
        draw: (s.nudge?.draw ?? 0) + extra.nudge.draw,
        away: (s.nudge?.away ?? 0) + extra.nudge.away,
      };
    }
    s.notes?.push(...(extra.notes ?? []));
    used.push(...extra.used);
  }
  return s;
}
