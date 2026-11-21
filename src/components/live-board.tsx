import { useEffect, useMemo, useState } from "react";
import { getVerifiedLiveGames, type LiveFeedReply, type VerifiedLiveGame } from "@/lib/live-fn";
import { predictionFeeds } from "@/lib/engines";
import { formatOdds, pct } from "@/lib/format";
import { inPlay, liveDecimal } from "@/lib/inplay";
import { BOOKS, priceMatch, quoteAt, type PricedMatch } from "@/lib/price";
import type { LeagueCode, Side } from "@/data/weekend";
import { useDesk } from "@/lib/desk-store";
import { useConsensus } from "@/lib/use-consensus";
import { liveConsensus } from "@/lib/consensus";
import { ConsensusBadge } from "@/components/consensus-badge";
import { FormPills } from "@/components/bits";

type LiveFilter = "all" | "level" | "home" | "away";

export function LiveBoard() {
  const league = useDesk((s) => s.league);
  const query = useDesk((s) => s.query);
  const bookId = useDesk((s) => s.bookId);
  const oddsFormat = useDesk((s) => s.oddsFormat);
  const setOpen = useDesk((s) => s.setOpen);
  const setPreview = useDesk((s) => s.setPreview);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const legs = useDesk((s) => s.legs);
  const [filter, setFilter] = useState<LiveFilter>("all");
  const [byMinute, setByMinute] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [feed, setFeed] = useState<LiveFeedReply>({ games: [], checkedAt: "", unavailable: ["Checking verified live providers…"] });
  const book = BOOKS.find((row) => row.id === bookId);
  const q = query.trim().toLowerCase();
  useEffect(() => {
    let active = true;
    const refresh = () => void getVerifiedLiveGames().then((reply) => active && setFeed(reply)).catch(() => active && setFeed({ games: [], checkedAt: new Date().toISOString(), unavailable: ["Live provider request failed"] }));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const matches = useMemo(() => feed.games.map(toPricedMatch), [feed.games]);

  const rows = matches.filter((match) => {
    if (league !== "ALL" && match.code !== league) return false;
    if (q && !`${match.home.name} ${match.away.name}`.toLowerCase().includes(q)) return false;
    const fixture = feed.games.find((game) => game.id === match.id);
    if (!fixture || filter === "all") return true;
    const score = { home: fixture.homeScore, away: fixture.awayScore };
    if (filter === "level") return score.home === score.away;
    if (filter === "home") return score.home > score.away;
    return score.away > score.home;
  }).sort((a, b) => {
    if (!byMinute) return 0;
    const am = feed.games.find((game) => game.id === a.id)?.minute ?? 0;
    const bm = feed.games.find((game) => game.id === b.id)?.minute ?? 0;
    return bm - am;
  });
  const playing = rows.find((match) => match.id === watchId) ?? rows[0];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-4xl">Live games</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          {rows.length} verified matches showing. Only a provider-confirmed in-play status is displayed; the old running-tape fallback has been removed.
        </p>
      </div>
      <div className="rounded-card border border-line bg-surface p-3 text-xs text-muted">
        <p>{feed.checkedAt ? `Checked ${new Date(feed.checkedAt).toLocaleTimeString()}` : "Checking live providers…"} · Auto-refresh every minute</p>
        {feed.unavailable.length ? <p className="mt-1 text-amber-200">{feed.unavailable.join(" · ")}</p> : <p className="mt-1 text-signal">API-Football, The Odds API and football-data.org checked.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["level", "Level"],
            ["home", "Home leading"],
            ["away", "Away leading"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={
              "h-11 rounded-full border px-4 text-sm " +
              (filter === id ? "border-signal bg-signal text-ink" : "border-line bg-surface")
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setByMinute((on) => !on)}
          className={
            "h-11 rounded-full border px-4 text-sm " +
            (byMinute ? "border-signal bg-signal text-ink" : "border-line bg-surface")
          }
        >
          {byMinute ? "Latest minute" : "Sort by minute"}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-muted">
          No live game in this category.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((match) => (
            <LiveCard
              key={match.id}
              match={match}
              liveGame={feed.games.find((game) => game.id === match.id)!}
              bookId={bookId}
              sharp={Boolean(book?.sharp)}
              bookName={book?.name ?? ""}
              oddsFormat={oddsFormat}
              onSlip={legs.some((leg) => leg.matchId === match.id)}
              watching={playing?.id === match.id}
              onOpen={() => setOpen(match.id)}
              onPreview={() => {
                setWatchId(match.id);
                setPreview(match.id);
                document.getElementById("live-view")?.scrollIntoView({ block: "nearest" });
              }}
              onAdd={(market) => toggleLeg(match.id, market)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveCard({
  match,
  liveGame,
  bookId,
  sharp,
  bookName,
  oddsFormat,
  onSlip,
  watching,
  onOpen,
  onPreview,
  onAdd,
}: {
  match: PricedMatch;
  liveGame: VerifiedLiveGame;
  bookId: ReturnType<typeof useDesk.getState>["bookId"];
  sharp: boolean;
  bookName: string;
  oddsFormat: ReturnType<typeof useDesk.getState>["oddsFormat"];
  onSlip: boolean;
  watching: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onAdd: (market: "home" | "draw" | "away") => void;
}) {
  const clock = { label: liveGame.half === "Half-time" ? "HT" : `${liveGame.minute}'`, minute: liveGame.minute, half: liveGame.half };
  const score = { home: liveGame.homeScore, away: liveGame.awayScore };
  const play = inPlay(match.lambdaHome, match.lambdaAway, clock.minute, score.home, score.away);
  const lean = play.home >= play.away && play.home >= play.draw ? "home" : play.away >= play.draw ? "away" : "draw";
  const leanP = lean === "home" ? play.home : lean === "away" ? play.away : play.draw;
  const leanName = lean === "home" ? match.home.short : lean === "away" ? match.away.short : "Draw";
  const pre = quoteAt(match, bookId, lean);
  const shown = formatOdds(liveDecimal(leanP, sharp), oddsFormat);
  const both = bothStill(score.home, score.away, play.remH, play.remA);
  const split = play.liveXgH + play.liveXgA || 1;
  const pack = predictionFeeds(match.home, match.away);
  const preTip = useConsensus(match.id, match.home, match.away, { live: true, league: match.league });
  const liveTip = liveConsensus(preTip, play, clock.minute);
  const agreeName = pack.pick === "home" ? match.home.short : pack.pick === "away" ? match.away.short : "Draw";

  return (
    <article className={"flex flex-col gap-3 rounded-card border bg-surface p-4 " + (watching ? "border-signal" : "border-line")}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-muted">
          {match.code} · {clock.half}
        </p>
        <p className="flex items-center gap-2 font-medium text-signal">
          <span className="size-2 rounded-full bg-signal" aria-hidden="true" />
          {clock.label}
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
        <div className="min-w-0"><p className="font-medium">{match.home.name}</p><FormPills form={match.home.form} /></div>
        <p className="font-display text-4xl tabular-nums">{clock.minute < 0 ? "–" : `${score.home}–${score.away}`}</p>
        <div className="min-w-0 text-right"><p className="font-medium">{match.away.name}</p><div className="flex justify-end"><FormPills form={match.away.form} /></div></div>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div className="bg-signal" style={{ width: `${((play.liveXgH / split) * 100).toFixed(1)}%` }} />
        <div className="bg-fg" style={{ width: `${((play.liveXgA / split) * 100).toFixed(1)}%` }} />
      </div>
      <p className="text-sm tabular-nums text-muted">
        Live xG {play.liveXgH.toFixed(2)}–{play.liveXgA.toFixed(2)} · left {play.remH.toFixed(2)}–{play.remA.toFixed(2)}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <p className="rounded-card bg-raised px-2 py-2">
          1<span className="mt-1 block font-display text-xl tabular-nums">{pct(play.home)}</span>
        </p>
        <p className="rounded-card bg-raised px-2 py-2">
          X<span className="mt-1 block font-display text-xl tabular-nums">{pct(play.draw)}</span>
        </p>
        <p className="rounded-card bg-raised px-2 py-2">
          2<span className="mt-1 block font-display text-xl tabular-nums">{pct(play.away)}</span>
        </p>
      </div>
      <ConsensusBadge c={liveTip} home={match.home.short} away={match.away.short} signalsUsed={preTip.signalsUsed} />
      <p className="text-sm text-fg">
        In-play lean {leanName} {pct(leanP)} · {bookName} {shown}
      </p>
      <p className="text-sm text-muted">
        Next goal {match.home.short} {pct(play.nextHome)} · both to score {pct(both)} · was {formatOdds(pre.odds, oddsFormat)}
      </p>
      <p className="text-sm text-muted">
        {pack.agree} of {pack.core} core reads say {agreeName}. {pack.extraAgree} of {pack.extras.length} extra reads agree. · verified by {liveGame.sources.join(" + ")}.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onPreview} className="h-11 flex-1 rounded-full bg-signal text-sm font-medium text-ink">
          {watching ? "Watching" : "Watch"}
        </button>
        <button type="button" onClick={onOpen} className="h-11 flex-1 rounded-full border border-line text-sm">
          Sheet
        </button>
        <button type="button" onClick={() => onAdd(lean)} className="h-11 flex-1 rounded-full border border-line text-sm">
          {onSlip ? "On slip" : "Add lean"}
        </button>
      </div>
    </article>
  );
}

function neutralSide(name: string): Side {
  return { name, short: name, pos: 0, form: [], xgFor: 1.35, xgAgainst: 1.35, gf: 0, ga: 0, played: 0, out: [] };
}

function toPricedMatch(game: VerifiedLiveGame): PricedMatch {
  const code = (["EPL", "CHP", "BUN", "LAL", "FRA", "SEA", "ERE", "POR"] as string[]).includes(game.code) ? game.code as LeagueCode : "EPL";
  return priceMatch({ id: game.id, league: game.league, code, day: "Midweek", dateLabel: "Live", time: "Live", venue: "Unavailable", home: neutralSide(game.home), away: neutralSide(game.away) });
}

function bothStill(home: number, away: number, remH: number, remA: number): number {
  if (home > 0 && away > 0) return 1;
  const ph = 1 - Math.exp(-remH);
  const pa = 1 - Math.exp(-remA);
  if (home > 0) return pa;
  if (away > 0) return ph;
  return ph * pa;
}
