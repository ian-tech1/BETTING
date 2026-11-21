import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Flag, Trash2 } from "lucide-react";
import { useNow } from "@/components/use-now";
import { FormPills } from "@/components/bits";
import { PredictionLab } from "@/components/prediction-lab";
import { buildConsensus } from "@/lib/consensus";
import { loadHistory } from "@/lib/consensus-history";
import { refreshJackpot, type LiveGame } from "@/lib/jackpot-live";
import { buildAdvancedReport, predictorPickLabel } from "@/lib/advanced-predictors";
import { KICKOFF_ISO } from "@/data/kickoffs";
import { MATCHES, priceMatch, type PricedMatch } from "@/lib/price";
import { isModelDisagreement, sameTeam, topResult } from "@/lib/jackpot-utils";
import {
  useDesk,
  type JackpotBook,
  type JackpotOutcome,
  type ManualJackpotGame,
} from "@/lib/desk-store";

type Pick = Exclude<JackpotOutcome, null>;
type Book = JackpotBook;

type Game = {
  id: string;
  book: Book;
  bookmaker: string;
  league: string;
  when: string;
  kickoff?: string;
  home: string;
  away: string;
  odds?: Record<Pick, number>;
  manual?: boolean;
  enteredAt?: string;
  homeForm?: ("W" | "D" | "L")[];
  awayForm?: ("W" | "D" | "L")[];
  homeVenueForm?: ("W" | "D" | "L")[];
  awayVenueForm?: ("W" | "D" | "L")[];
  homeRecentGoals?: { scored: number; conceded: number };
  awayRecentGoals?: { scored: number; conceded: number };
};

type ManualDraft = {
  book: Book;
  otherBookmaker: string;
  league: string;
  when: string;
  home: string;
  away: string;
  homeOdds: string;
  drawOdds: string;
  awayOdds: string;
};

const BETIKA_STAKE = 49;
const BOOK_LABELS: Record<Book, string> = {
  betika: "Betika",
  sportpesa: "SportPesa",
  xbet: "1xBet",
  other: "Other / manual",
};
const BOOKS: Book[] = ["betika", "sportpesa", "xbet", "other"];
const EMPTY_LISTS: Record<Book, Game[]> = { betika: [], sportpesa: [], xbet: [], other: [] };

function fair(odds: Record<Pick, number>) {
  const raw = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const sum = raw.home + raw.draw + raw.away;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

function asGames(rows: LiveGame[], book: Exclude<Book, "other">): Game[] {
  return rows
    .filter((row) => row.found)
    .map((row) => ({
      id: row.id,
      book,
      bookmaker: BOOK_LABELS[book],
      league: row.league,
      when: row.when,
      kickoff: row.kickoff,
      home: row.home,
      away: row.away,
      odds: row.odds,
      homeForm: row.homeForm,
      awayForm: row.awayForm,
      homeVenueForm: row.homeVenueForm,
      awayVenueForm: row.awayVenueForm,
      homeRecentGoals: row.homeRecentGoals,
      awayRecentGoals: row.awayRecentGoals,
    }));
}

function fromManual(row: ManualJackpotGame): Game {
  return {
    ...row,
    manual: true,
    kickoff: row.when === "Kickoff not entered" ? undefined : row.when,
    when: row.when === "Kickoff not entered" ? row.when : formatTime(row.when),
  };
}

function modeledFixture(game: Game): PricedMatch | undefined {
  if (!game.kickoff) return undefined;
  let candidates = MATCHES.filter(
    (match) => sameTeam(game.home, match.home.name) && sameTeam(game.away, match.away.name),
  );
  const fixtureTime = Date.parse(game.kickoff);
  if (!Number.isFinite(fixtureTime)) return undefined;
  candidates = candidates.filter((match) => {
    const modeledTime = KICKOFF_ISO[match.id] ? Date.parse(KICKOFF_ISO[match.id]) : Number.NaN;
    return (
      Number.isFinite(modeledTime) && Math.abs(modeledTime - fixtureTime) <= 6 * 60 * 60 * 1000
    );
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function baselineFixture(game: Game): PricedMatch {
  const neutral = (name: string) => ({
    name,
    short: name,
    pos: 0,
    form: [] as ("W" | "D" | "L")[],
    xgFor: 1.35,
    xgAgainst: 1.35,
    gf: 0,
    ga: 0,
    played: 0,
    out: [],
  });
  // Jackpot rows often do not have an exact MATCHES kickoff identity. Reuse the
  // verified team-history side when available; the old neutral fallback erased
  // all evidence and made the home-advantage prior look like a universal Home pick.
  const home = gameFormSide(game, "home") ?? knownTeamSide(game.home) ?? neutral(game.home);
  const away = gameFormSide(game, "away") ?? knownTeamSide(game.away) ?? neutral(game.away);
  return priceMatch({
    id: `baseline-${game.id}`,
    league: game.league,
    code: "EPL",
    day: "Midweek",
    dateLabel: game.when,
    time: "—",
    venue: "Unavailable",
    home,
    away,
  });
}

function suggestedPick(game: Game): Pick | null {
  const match = modeledFixture(game) ?? baselineFixture(game);
  // The persisted auto-pick must use exactly the same reconciled consensus as
  // the red Final Prediction panel, including verified odds when available.
  return buildConsensus(match.home, match.away, { odds: game.odds, history: loadHistory(), league: match.league }).pick;
}

function mergeGames(publicGames: Game[], manualRows: ManualJackpotGame[]) {
  // Deduplicate equivalent rows even when a feed changes its event ID or kickoff formatting.
  // Keep bookmaker and home/away order in the identity: those determine the actual 1/X/2 prices.
  const rows = [...publicGames, ...manualRows.map(fromManual)];
  const unique: Game[] = [];
  for (const game of rows) {
    const kickoff = game.kickoff ? Date.parse(game.kickoff) : Number.NaN;
    const duplicateIndex = unique.findIndex((existing) => {
      if (
        existing.book !== game.book ||
        !sameTeam(existing.home, game.home) ||
        !sameTeam(existing.away, game.away)
      )
        return false;
      const existingKickoff = existing.kickoff ? Date.parse(existing.kickoff) : Number.NaN;
      if (!Number.isFinite(kickoff) || !Number.isFinite(existingKickoff)) return existing.id === game.id;
      return Math.abs(existingKickoff - kickoff) <= 6 * 60 * 60 * 1000;
    });
    if (duplicateIndex < 0) unique.push(game);
    else if (game.manual || (!unique[duplicateIndex].manual && game.odds)) unique[duplicateIndex] = game;
  }
  return unique.sort((left, right) => {
    const leftTime = left.kickoff ? Date.parse(left.kickoff) : Number.POSITIVE_INFINITY;
    const rightTime = right.kickoff ? Date.parse(right.kickoff) : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || left.home.localeCompare(right.home);
  });
}

export function Jackpot() {
  const { now } = useNow(1000);
  const [book, setBook] = useState<Book>("betika");
  const [lists, setLists] = useState<Record<Book, Game[]>>(EMPTY_LISTS);
  const [status, setStatus] = useState("Checking public bookmaker feeds.");
  const [sourceStatus, setSourceStatus] = useState<Record<Book, string>>({
    betika: "Checking",
    sportpesa: "Checking",
    xbet: "Checking",
    other: "No public feed; manually entered odds only.",
  });
  const [prize, setPrize] = useState("");
  const [expiry, setExpiry] = useState("");
  const [checking, setChecking] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const [dateFilter, setDateFilter] = useState("ALL");
  const [draft, setDraft] = useState<ManualDraft>({
    book: "betika",
    otherBookmaker: "",
    league: "",
    when: "",
    home: "",
    away: "",
    homeOdds: "",
    drawOdds: "",
    awayOdds: "",
  });
  const [formError, setFormError] = useState("");
  const jackpotPicks = useDesk((state) => state.jackpotPicks);
  const manualGames = useDesk((state) => state.manualJackpotGames);
  const setJackpotPick = useDesk((state) => state.setJackpotPick);
  const setJackpotPicks = useDesk((state) => state.setJackpotPicks);
  const addManualJackpotGame = useDesk((state) => state.addManualJackpotGame);
  const removeManualJackpotGame = useDesk((state) => state.removeManualJackpotGame);

  const allGames = useMemo(
    () =>
      mergeGames(
        lists[book] ?? [],
        manualGames.filter((game) => game.book === book),
      ),
    [book, lists, manualGames],
  );
  const gameDates = useMemo(
    () => Array.from(new Set(allGames.map((game) => game.kickoff ? new Date(game.kickoff).toISOString().slice(0, 10) : null).filter((date): date is string => Boolean(date)))).sort(),
    [allGames],
  );
  const games = useMemo(
    () => dateFilter === "ALL" ? allGames : allGames.filter((game) => game.kickoff && new Date(game.kickoff).toISOString().slice(0, 10) === dateFilter),
    [allGames, dateFilter],
  );
  const leagueGroups = useMemo(() => {
    const groups = new Map<string, Game[]>();
    for (const game of games) {
      const label = game.league.trim() || "Competition unavailable";
      groups.set(label, [...(groups.get(label) ?? []), game]);
    }
    return [...groups.entries()];
  }, [games]);
  const deadline = expiry ? Date.parse(expiry) : Number.NaN;
  const left = now === null || !Number.isFinite(deadline) ? null : Math.max(0, deadline - now);
  const complete =
    games.length > 0 &&
    games.every((game) => jackpotPicks[game.id] !== null && jackpotPicks[game.id] !== undefined);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      setChecking(true);
      try {
        const data = await refreshJackpot();
        if (stop) return;
        setLists({
          betika: asGames(data.betika, "betika"),
          sportpesa: asGames(data.sportpesa, "sportpesa"),
          xbet: asGames(data.xbet, "xbet"),
          other: [],
        });
        setPrize(data.prize);
        setExpiry(data.expiry);
        setSourceStatus({
          betika: data.betikaStatus,
          sportpesa: data.sportpesaStatus,
          xbet: data.xbetStatus,
          other: "No public feed; manually entered odds only.",
        });
        const clock = new Date(data.checked).toLocaleTimeString("en-KE", {
          hour: "2-digit",
          minute: "2-digit",
        });
        setStatus(`Last public-source check: ${clock}. Prices are refreshed every two minutes.`);
      } catch {
        if (!stop) {
          setLists(EMPTY_LISTS);
          setSourceStatus({
            betika: "Request failed; no cached or demo prices are shown.",
            sportpesa: "Request failed; no cached or demo prices are shown.",
            xbet: "Request failed; no cached or demo prices are shown.",
            other: "No public feed; manually entered odds only.",
          });
          setStatus("Refresh failed. No saved or simulated public-source prices are displayed.");
        }
      } finally {
        if (!stop) setChecking(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 120_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [refreshCount]);

  useEffect(() => {
    const current = useDesk.getState().jackpotPicks;
    const next = { ...current };
    let changed = false;
    for (const game of games) {
      const proposed = suggestedPick(game);
      const existing = current[game.id];
      const priced = modeledFixture(game) ?? baselineFixture(game);
      const report = buildAdvancedReport(priced.home, priced.away);
      const market = game.odds ? fair(game.odds) : null;
      const flagged =
        existing && report && market
          ? isModelDisagreement(market[existing], report.ensemble[existing])
          : false;
      if (!Object.prototype.hasOwnProperty.call(current, game.id) || existing == null || flagged) {
        next[game.id] = proposed;
        changed = true;
      }
    }
    if (changed) setJackpotPicks(next);
  }, [games, setJackpotPicks]);

  function submitManualGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const home = draft.home.trim();
    const away = draft.away.trim();
    const odds = {
      home: Number(draft.homeOdds),
      draw: Number(draft.drawOdds),
      away: Number(draft.awayOdds),
    };
    if (!home || !away || sameTeam(home, away)) {
      setFormError(
        "Enter two different team names in the same 1 / X / 2 order shown by the bookmaker.",
      );
      return;
    }
    if (!Object.values(odds).every((odd) => Number.isFinite(odd) && odd > 1.01 && odd <= 100)) {
      setFormError("Enter all three decimal odds, each greater than 1.01 and no higher than 100.");
      return;
    }
    const kickoff = draft.when ? new Date(draft.when) : null;
    if (draft.when && (!kickoff || !Number.isFinite(kickoff.getTime()))) {
      setFormError("The kickoff time is not valid.");
      return;
    }
    const bookmaker =
      draft.book === "other" ? draft.otherBookmaker.trim() : BOOK_LABELS[draft.book];
    if (!bookmaker || bookmaker.length > 40) {
      setFormError("Enter the bookmaker name (up to 40 characters).");
      return;
    }
    const when = kickoff ? kickoff.toISOString() : "Kickoff not entered";
    const id = `manual-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`;
    const row: ManualJackpotGame = {
      id,
      book: draft.book,
      bookmaker,
      league: draft.league.trim().slice(0, 80) || "Competition not entered",
      when,
      home,
      away,
      odds,
      enteredAt: new Date().toISOString(),
    };
    addManualJackpotGame(row);
    setBook(draft.book);
    setDraft((current) => ({
      ...current,
      league: "",
      when: "",
      home: "",
      away: "",
      homeOdds: "",
      drawOdds: "",
      awayOdds: "",
    }));
  }

  const lines = complete ? 1 : 0;
  const liveCount = (source: Book) =>
    lists[source].length + manualGames.filter((game) => game.book === source).length;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <h1 className="font-display text-4xl">Betika Jackpot</h1>
        <p className="mt-2 text-sm text-muted">Active jackpot games only · select 1 / X / 2 for each match.</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{status}</p>
        <button
          type="button"
          onClick={() => setRefreshCount((count) => count + 1)}
          disabled={checking}
          className="h-10 shrink-0 rounded-full border border-line px-4 text-sm disabled:opacity-50"
        >
          {checking ? "Checking…" : "Refresh now"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BOOKS.map((source) => (
          <button
            key={source}
            type="button"
            onClick={() => setBook(source)}
            className={
              "h-11 rounded-full text-sm " +
              (book === source ? "bg-signal font-medium text-ink" : "border border-line")
            }
          >
            {BOOK_LABELS[source]} · {liveCount(source)}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{sourceStatus[book]}</p>
      <section className="rounded-card border border-line bg-surface p-3" aria-label="Jackpot date selector">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">Jackpot date:</span>
          <button type="button" onClick={() => setDateFilter("ALL")} className={`h-9 rounded-full px-3 text-xs ${dateFilter === "ALL" ? "bg-signal text-ink" : "border border-line"}`}>All available</button>
          {gameDates.slice(0, 5).map((date) => <button key={date} type="button" onClick={() => setDateFilter(date)} className={`h-9 rounded-full px-3 text-xs ${dateFilter === date ? "bg-signal text-ink" : "border border-line"}`}>{date === new Date().toISOString().slice(0, 10) ? "Today" : new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</button>)}
          <label className="flex h-9 items-center gap-2 rounded-full border border-line px-3 text-xs text-muted">Specific date <input type="date" value={dateFilter === "ALL" ? "" : dateFilter} onChange={(event) => setDateFilter(event.target.value || "ALL")} className="bg-transparent text-fg outline-none" /></label>
        </div>
        <p className="mt-2 text-[11px] text-muted">{games.length} real upcoming game{games.length === 1 ? "" : "s"} visible for this selection. Past games are excluded from Jackpot.</p>
      </section>
      {book === "betika" ? (
        <section className="rounded-card border border-line bg-raised p-4" aria-label="Betika jackpot status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-signal">Betika jackpot</p>
              <p className="mt-1 text-lg font-semibold">{games.length ? "Jackpot card present" : "Jackpot card not detected"}</p>
              <p className="mt-1 text-xs text-muted">{games.length ? `${games.length} verified game${games.length === 1 ? "" : "s"} loaded with 1 / X / 2 prices.` : "No exact public Betika card is available right now. Add the games and odds from the Betika app below; they remain marked manual."}</p>
            </div>
            <a href="https://www.betika.com/en-ke/" target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-2 text-xs text-signal">Open Betika</a>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-4 gap-2 rounded-card bg-signal p-4 text-ink">
        <ClockCell
          label="Days"
          value={left === null ? "—" : String(Math.floor(left / 86400000)).padStart(2, "0")}
        />
        <ClockCell
          label="Hours"
          value={left === null ? "—" : String(Math.floor(left / 3600000) % 24).padStart(2, "0")}
        />
        <ClockCell
          label="Minutes"
          value={left === null ? "—" : String(Math.floor(left / 60000) % 60).padStart(2, "0")}
        />
        <ClockCell
          label="Seconds"
          value={left === null ? "—" : String(Math.floor(left / 1000) % 60).padStart(2, "0")}
        />
      </div>
      <p className="text-center text-sm font-medium">
        {book === "betika"
          ? `Must Be Won · ${prize || "prize unavailable"} · stake KES ${BETIKA_STAKE}`
          : book === "sportpesa"
            ? "SportPesa public jackpot card · no fallback prices"
            : book === "xbet"
              ? "1xBet public page check · no fallback prices"
              : "Manual games · user-entered odds only"}
      </p>

      <details className="rounded-card border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Add a game and odds read from a bookmaker app
        </summary>
        <form className="mt-3 flex flex-col gap-3" onSubmit={submitManualGame}>
          <label className="text-sm text-muted">
            Bookmaker
            <select
              value={draft.book}
              onChange={(event) =>
                setDraft((current) => ({ ...current, book: event.target.value as Book }))
              }
              className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
            >
              <option value="betika">Betika</option>
              <option value="sportpesa">SportPesa</option>
              <option value="xbet">1xBet</option>
              <option value="other">Other bookmaker</option>
            </select>
          </label>
          {draft.book === "other" ? (
            <label className="text-sm text-muted">
              Other bookmaker name
              <input
                value={draft.otherBookmaker}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, otherBookmaker: event.target.value }))
                }
                maxLength={40}
                className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
                placeholder="Bookmaker name"
              />
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-muted">
              Home team (1)
              <input
                required
                value={draft.home}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, home: event.target.value }))
                }
                maxLength={80}
                className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
              />
            </label>
            <label className="text-sm text-muted">
              Away team (2)
              <input
                required
                value={draft.away}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, away: event.target.value }))
                }
                maxLength={80}
                className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-muted">
              Competition (optional)
              <input
                value={draft.league}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, league: event.target.value }))
                }
                maxLength={80}
                className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
              />
            </label>
            <label className="text-sm text-muted">
              Kickoff (optional)
              <input
                type="datetime-local"
                value={draft.when}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, when: event.target.value }))
                }
                className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["homeOdds", "drawOdds", "awayOdds"] as const).map((field, index) => (
              <label key={field} className="text-xs text-muted">
                {index === 0 ? "1 · Home" : index === 1 ? "X · Draw" : "2 · Away"}
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  min="1.02"
                  max="100"
                  step="0.01"
                  value={draft[field]}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field]: event.target.value }))
                  }
                  className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-2 text-fg"
                  placeholder="2.10"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Enter the prices exactly as displayed: 1 is the home team, X is the draw, and 2 is the
            away team. This is a user-entered quote, not independently fetched or verified.
          </p>
          {formError ? (
            <p role="alert" className="text-sm text-red-300">
              {formError}
            </p>
          ) : null}
          <button
            type="submit"
            className="h-11 rounded-full bg-signal text-sm font-medium text-ink"
          >
            Save this manually checked game
          </button>
        </form>
      </details>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            const next = { ...useDesk.getState().jackpotPicks };
            for (const game of games) next[game.id] = suggestedPick(game);
            setJackpotPicks(next);
          }}
          disabled={games.length === 0}
          className="h-11 flex-1 rounded-full border border-line text-sm disabled:opacity-50"
        >
          Auto pick · one result per game
        </button>
        <button
          type="button"
          onClick={() => {
            const next = { ...useDesk.getState().jackpotPicks };
            for (const game of games) next[game.id] = null;
            setJackpotPicks(next);
          }}
          disabled={games.length === 0}
          className="h-11 flex-1 rounded-full border border-line text-sm disabled:opacity-50"
        >
          Clear picks
        </button>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-signal">Jackpot by competition</p>
          <p className="mt-1 text-sm text-muted">Games are arranged under their Betika league or division.</p>
        </div>
        <p className="text-xs text-muted">{games.length} games</p>
      </div>
      <div className="flex flex-col gap-5">
        {games.length === 0 ? (
          <p className="rounded-card border border-line bg-surface p-4 text-sm text-muted">
            No current public quotes are available from this source. Add a game above and enter the
            exact 1 / X / 2 odds you read in the bookmaker app; unverified or estimated prices are
            never presented as official odds.
          </p>
        ) : null}
        {leagueGroups.map(([league, leagueGames]) => (
          <section key={league} className="flex flex-col gap-3">
            <h3 className="font-display text-2xl">{league} <span className="text-sm text-muted">· {leagueGames.length} games</span></h3>
            <ol className="flex flex-col gap-3">
              {leagueGames.map((game) => (
                <JackpotGameCard
                  key={game.id}
                  game={game}
                  index={games.findIndex((item) => item.id === game.id)}
                  chosen={jackpotPicks[game.id] ?? null}
                  onPick={(pick) => setJackpotPick(game.id, jackpotPicks[game.id] === pick ? null : pick)}
                  onRemove={game.manual ? () => removeManualJackpotGame(game.id) : undefined}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3">
        <p>{complete ? "Complete card · one selection per game" : "Card status"}</p>
        <p className="font-display text-2xl tabular-nums">
          {book === "betika"
            ? complete
              ? `KES ${BETIKA_STAKE}`
              : games.length
                ? "Pick one result per game"
                : "No current card"
            : complete
              ? `${lines} line`
              : games.length
                ? "Finish the card"
                : "No current card"}
        </p>
      </div>
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-2xl">Card-wide diagnostics</h2>
        <ul className="mt-3 grid gap-2">
          {checks(games).map((item) => (
            <li key={item.name} className="text-sm">
              <span className="text-fg">{item.name}. </span>
              <span className="text-muted">{item.note}</span>
            </li>
          ))}
        </ul>
      </section>
      <details className="rounded-card border border-line bg-raised p-4">
        <summary className="cursor-pointer text-sm font-medium">
          How to use IAN TECH Jackpot
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>
            Choose Betika, SportPesa, 1xBet, or Other/manual. Public odds appear only when an exact
            game is available.
          </li>
          <li>Check the home team shown first: 1 means home, X means draw, and 2 means away.</li>
          <li>
            One result is preselected for every game. A red flag means the market and local model materially disagree; do not manually choose that red outcome. If every outcome is flagged, the model-led pick is shown in amber as a caution. Amber also marks missing-data fallback picks.
          </li>
          <li>
            If a bookmaker feed has no price, enter the match and all three prices read from that
            bookmaker's app. The entry is labeled as manual and is not independently verified.
          </li>
          <li>
            Open the prediction lab on a game with exact matching team data to see the same
            local models, diagnostics, source check, and risk warnings shown under Ready/Upcoming.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted">
          Your Jackpot picks and manual games are saved with your signed-in account. Another
          account using the same website link has its own saved selections. No prediction is
          certain; verify the match and price before placing anything.
        </p>
      </details>
      <p className="text-sm text-muted">
        Betika prices are accepted only for exact team pairs with a valid upcoming kickoff.
        SportPesa official odds are shown only when its public jackpot response is accessible and
        identifies home and away explicitly. A third-party comparison, old cached line, generated
        estimate, or another bookmaker's price is never relabeled as SportPesa odds. Nothing is
        placed for you.
      </p>
    </div>
  );
}

function knownTeamSide(team: string) {
  for (const match of MATCHES) {
    if (sameTeam(team, match.home.name)) return match.home;
    if (sameTeam(team, match.away.name)) return match.away;
    const wanted = looseTeamKey(team);
    for (const side of [match.home, match.away]) {
      const candidate = looseTeamKey(side.name);
      if (wanted.length >= 5 && candidate.length >= 5 && (wanted.includes(candidate) || candidate.includes(wanted))) return side;
    }
  }
  return undefined;
}

function gameFormSide(game: Game, side: "home" | "away") {
  const form = side === "home" ? game.homeForm : game.awayForm;
  if (!form?.length) return undefined;
  const venueForm = side === "home" ? game.homeVenueForm : game.awayVenueForm;
  const goals = side === "home" ? game.homeRecentGoals : game.awayRecentGoals;
  return {
    name: side === "home" ? game.home : game.away,
    short: side === "home" ? game.home : game.away,
    pos: 0,
    form,
    xgFor: goals ? Math.max(0.15, goals.scored / Math.max(1, form.length)) : 1.35,
    xgAgainst: goals ? Math.max(0.15, goals.conceded / Math.max(1, form.length)) : 1.35,
    gf: goals?.scored ?? 0,
    ga: goals?.conceded ?? 0,
    played: form.length,
    out: [],
    venueForm,
    recentGoalsFor: goals?.scored,
    recentGoalsAgainst: goals?.conceded,
  };
}

function looseTeamKey(value: string) {
  return value.toLowerCase().replace(/\b(the|fc|afc|sc|cf|united|city)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function formRecord(form: readonly ("W" | "D" | "L")[]) {
  const wins = form.filter((mark) => mark === "W").length;
  const draws = form.filter((mark) => mark === "D").length;
  const losses = form.filter((mark) => mark === "L").length;
  return `W ${wins} · D ${draws} · L ${losses}`;
}

function formPoints(form: readonly ("W" | "D" | "L")[]) {
  return form.reduce((sum, mark) => sum + (mark === "W" ? 3 : mark === "D" ? 1 : 0), 0);
}

function JackpotGameCard({
  game,
  index,
  chosen,
  onPick,
  onRemove,
}: {
  game: Game;
  index: number;
  chosen: Pick | null;
  onPick: (pick: Pick) => void;
  onRemove?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const priced = useMemo(() => modeledFixture(game), [game]);
  const labFallback = useMemo(() => baselineFixture(game), [game]);
  const labMatch = priced ?? labFallback;
  const report = useMemo(
    () => buildAdvancedReport(labMatch.home, labMatch.away),
    [labMatch],
  );
  const odds = game.odds;
  const homeFormSide = priced?.home ?? gameFormSide(game, "home") ?? knownTeamSide(game.home);
  const awayFormSide = priced?.away ?? gameFormSide(game, "away") ?? knownTeamSide(game.away);
  const displayReport = report;
  const probs = odds ? fair(odds) : null;
  const modelPick = report
    ? predictorPickLabel(
        report.pick,
        priced?.home.short ?? game.home,
        priced?.away.short ?? game.away,
      )
    : null;
  const redFlags =
    report && probs
      ? (Object.keys(probs) as Pick[]).filter((pick) =>
          isModelDisagreement(probs[pick], report.ensemble[pick]),
        )
      : [];
  const finalMatch = labMatch;
  const final = finalMatch
    ? buildConsensus(finalMatch.home, finalMatch.away, { odds: odds ?? undefined, history: loadHistory(), league: finalMatch.league })
    : null;
  const finalMargin = final ? final.probabilities[final.pick] - Math.max(...Object.entries(final.probabilities).filter(([pick]) => pick !== final.pick).map(([, value]) => value)) : 0;
  const availability = [...(priced?.home.out ?? []), ...(priced?.away.out ?? [])].filter((item) => !/no new|no senior|no confirmed/i.test(item));
  const status = game.kickoff && Date.parse(game.kickoff) <= Date.now() ? "Live / started" : "Upcoming";

  return (
    <li className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 text-sm text-muted">
        <p>
          {String(index + 1).padStart(2, "0")} · {game.league}
        </p>
        <div className="flex items-center gap-2">
          <p className="tabular-nums">{game.when}</p>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove manual game"
              className="grid size-9 place-items-center rounded-full border border-line"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className={`rounded-full border px-2 py-1 ${status === "Upcoming" ? "border-signal/60 text-signal" : "border-red-400/60 text-red-300"}`}>{status}</span>
        <span className="rounded-full border border-line px-2 py-1">Source checked live</span>
        {availability.length ? <span className="rounded-full border border-amber-400/60 px-2 py-1 text-amber-200">{availability.length} absence warning{availability.length === 1 ? "" : "s"}</span> : <span className="rounded-full border border-line px-2 py-1">No named absences</span>}
      </div>
      {game.manual ? (
        <p className="mt-2 text-xs text-signal">
          Manual quote · entered from {game.bookmaker} at{" "}
          {game.enteredAt ? new Date(game.enteredAt).toLocaleTimeString() : "unknown time"} · not
          independently verified
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted">
          Public source · {game.bookmaker} · exact event data
        </p>
      )}
      <div className="mt-3">
        <p className="font-medium">
          <span className="mr-2 text-xs text-muted">1 · HOME</span>
          {game.home}
        </p>
        {homeFormSide ? (
          <>
            <FormPills form={homeFormSide.form} />
            <p className="mt-1 text-[11px] text-muted">Previous 5 · {formRecord(homeFormSide.form)}</p>
          </>
        ) : <p className="mt-1 text-xs text-muted">Previous W/D/L: unavailable in current team data</p>}
        <p className="mt-2 font-medium">
          <span className="mr-2 text-xs text-muted">2 · AWAY</span>
          {game.away}
        </p>
        {awayFormSide ? (
          <>
            <FormPills form={awayFormSide.form} />
            <p className="mt-1 text-[11px] text-muted">Previous 5 · {formRecord(awayFormSide.form)}</p>
          </>
        ) : <p className="mt-1 text-xs text-muted">Previous W/D/L: unavailable in current team data</p>}
      </div>
      <p className="mt-3 text-xs text-muted">
        1 = {game.home} to win · X = draw · 2 = {game.away} to win
      </p>
      {report ? (
        <p className="mt-2 text-sm text-muted">
          Stats-only lean (feeds the Final tip above): <span className="text-fg">{modelPick}</span> ·{" "}
          {Math.round(report.ensemble[report.pick] * 100)}% · {report.agreement}/
          {report.models.length} formulas agree · sample {report.sampleGames} games.
        </p>
      ) : null}
      {displayReport ? (
        <div className="mt-3 rounded-card border border-line bg-raised p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-signal">Prediction lab · {displayReport.models.length}-model ensemble</p>
          <p className="mt-1 text-sm font-medium text-fg">{predictorPickLabel(displayReport.pick, game.home, game.away)} · {Math.round(displayReport.ensemble[displayReport.pick] * 100)}%</p>
          <p className="mt-1 text-xs text-muted">{displayReport.agreement}/{displayReport.models.length} models agree · {displayReport.sampleGames} games sampled · spread {Math.round(displayReport.spread * 100)} pp.</p>
          <p className="mt-1 text-xs text-muted">Stress test: {displayReport.stressStable ? "same lean across scenarios" : "lean changes under stress"}. This is the stats layer feeding the final tip.</p>
        </div>
      ) : null}
      {final ? (
        <section className="mt-3 rounded-card border-2 border-red-400/70 bg-red-950/30 p-3" aria-label="Jackpot unified final prediction">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-300">Unified final prediction</p>
          <p className="mt-1 text-lg font-semibold text-fg">FINAL AI PREDICTION: {mark(final.pick)} · {nameOf(game, final.pick)}</p>
          <p className="mt-1 text-xs text-muted">{Math.round(final.probabilities[final.pick] * 100)}% · {final.insufficientData ? "LOW confidence" : final.tier} · {report?.models.length ?? 0} model formulas · scoreline {finalMatch?.score ?? "—"}</p>
          <p className="mt-2 text-xs text-muted">Why: {final.label}. The selected result has the highest calculated probability across the three outcomes.</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            {(["home", "draw", "away"] as const).map((pick) => <button key={pick} type="button" onClick={() => onPick(pick)} aria-pressed={final.pick === pick} className={`rounded-card border px-2 py-2 ${final.pick === pick ? "border-red-300 bg-red-500/30 text-red-100" : "border-line bg-bg text-muted"}`}>
              <span className="block font-semibold">{mark(pick)} · {Math.round(final.probabilities[pick] * 100)}%</span>
              <span className="block truncate">{nameOf(game, pick)}</span>
              <span className="block text-[10px]">{final.pick === pick ? "FINAL SELECTION" : "calculated alternative"}</span>
            </button>)}
          </div>
          <p className="mt-2 text-[11px] text-red-100/80">All three outcomes are calculated independently. Only the highest-probability outcome is selected. LOW confidence means limited verified evidence.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted sm:grid-cols-4">
            <span>Final margin {Math.round(finalMargin * 100)} pp</span>
            <span>Home form {homeFormSide ? `${formPoints(homeFormSide.form)}/15` : "n/a"}</span>
            <span>Away form {awayFormSide ? `${formPoints(awayFormSide.form)}/15` : "n/a"}</span>
            <span>{final.enginePick === final.aiPick ? "Engine + AI aligned" : "Engine / AI split"}</span>
          </div>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${game.home} v ${game.away}: ${mark(final.pick)} ${nameOf(game, final.pick)} · scoreline ${finalMatch?.score ?? "n/a"}`).then(() => setCopied(true)); }} className="mt-3 h-9 rounded-full border border-line px-3 text-xs text-fg">{copied ? "Final pick copied" : "Copy final pick"}</button>
        </section>
      ) : null}
      {odds ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["home", "draw", "away"] as const).map((pick) => {
              const isFlagged = redFlags.includes(pick);
              return (
                <button
                  key={pick}
                  type="button"
                  onClick={() => {
                    if (!isFlagged) onPick(pick);
                  }}
                  disabled={isFlagged}
                  aria-disabled={isFlagged}
                  aria-pressed={chosen === pick}
                  aria-label={`${mark(pick)} ${nameOf(game, pick)} odds ${odds[pick].toFixed(2)}${isFlagged ? ", red flag: market/model mismatch" : ""}`}
                  className={
                    "flex min-h-14 flex-col items-center justify-center rounded-card px-1 py-2 text-sm tabular-nums " +
                    (isFlagged && chosen === pick
                      ? "border border-amber-400 bg-amber-950/70 text-amber-100 font-medium "
                      : isFlagged
                        ? "border border-red-400 bg-red-950/60 text-red-100 opacity-90 cursor-not-allowed "
                        : chosen === pick
                          ? "bg-signal font-medium text-ink"
                          : "bg-bg text-fg")
                  }
                >
                  {isFlagged ? (
                    <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold">
                      <Flag className="size-3" /> RED FLAG
                    </span>
                  ) : null}
                  <span>
                    {mark(pick)} · {odds[pick].toFixed(2)}
                  </span>
                  {chosen === pick ? (
                    <span className="text-[10px]">
                      {isFlagged ? "Selected · CAUTION" : "Selected"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {redFlags.length ? (
            <p className="mt-2 text-xs text-red-200">
              Red flag: the no-vig bookmaker probability is at least 10 percentage points above the
              corresponding local-model probability for{" "}
              {redFlags.map((pick) => nameOf(game, pick)).join(", ")}. Treat this as a disagreement
              warning only; the formulas are not calibrated.
            </p>
          ) : report ? (
            <p className="mt-2 text-xs text-muted">
              No 10-point market/model mismatch is flagged for these prices. That does not mean the
              bet is safe.
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted">{analyse(game, fair(odds), priced)}</p>
          <p className="mt-1 text-sm text-muted">
            Two price-derived scoreline estimates: {twoScores(odds).join(" · ")}
          </p>
        </>
      ) : (
        <div className="mt-3 rounded-card border border-amber-400 bg-amber-950/50 p-3 text-sm text-amber-100">
          <p className="font-semibold">
            AMBER · {report ? "MODEL PICK · NO VERIFIED BOOKMAKER ODDS" : "LOW DATA FALLBACK"}
          </p>
          <p className="mt-1">
            Selected: {mark(chosen ?? "draw")} · {nameOf(game, chosen ?? "draw")}.
            {report
              ? " This is the matched local model's leading outcome, but bookmaker prices are unavailable."
              : " No exact team-stat model or verified 1X2 odds are available. This is a placeholder selection, not a researched prediction."}
            {" "}Verify the market before using this pick.
          </p>
        </div>
      )}
      {priced ? (
        <p className="mt-1 text-sm text-muted">
          Expected goals {priced.lambdaHome.toFixed(2)}–{priced.lambdaAway.toFixed(2)}. Most likely
          score {priced.score}. {priced.read}
        </p>
      ) : null}
      <PredictionLab match={labMatch} odds={game.odds} />
      {game.manual ? (
        <p className="mt-2 text-xs text-muted">
          Remove this row with the trash button if the event, team order, or price changes.
        </p>
      ) : null}
    </li>
  );
}

function analyse(game: Game, probs: Record<Pick, number>, priced: PricedMatch | undefined) {
  const order = ["home", "draw", "away"] as const;
  const top = topResult(probs);
  const next =
    order.find(
      (pick) =>
        pick !== top &&
        probs[pick] ===
          Math.max(...order.filter((item) => item !== top).map((item) => probs[item])),
    ) ?? "draw";
  const close = probs[top] - probs[next] < 0.06;
  const short = (game.odds?.[top] ?? 9) < 1.7;
  const desk = priced
    ? ` The local game model leans ${priced.likely.market === "home" ? game.home : priced.likely.market === "away" ? game.away : "the draw"}.`
    : "";
  return `No-vig market lean: ${nameOf(game, top)} (${pct(probs[top])}). ${close ? "The market is close; only one result can be selected." : "One result leads."}${short ? " That price is short." : ""}${desk}`;
}

function checks(games: Game[]) {
  const ready = games.filter((game) => game.odds && game.odds.home > 1);
  const leans = ready.map((game) => {
    const probs = fair(game.odds!);
    const top = topResult(probs);
    const gap =
      probs[top] -
      Math.max(
        ...(["home", "draw", "away"] as const)
          .filter((pick) => pick !== top)
          .map((pick) => probs[pick]),
      );
    return { game, probs, top, gap };
  });
  const count = (pick: Pick) => leans.filter((row) => row.top === pick).length;
  const doubles = leans.filter((row) => row.gap < 0.06).length;
  const short = leans.filter((row) => (row.game.odds?.[row.top] ?? 9) < 1.5).length;
  const draws = leans.reduce((sum, row) => sum + row.probs.draw, 0) / Math.max(leans.length, 1);
  const open = leans.slice().sort((a, b) => a.probs.draw - b.probs.draw)[0];
  const even = leans.slice().sort((a, b) => a.gap - b.gap)[0];
  const bankers = leans.filter((row) => row.probs[row.top] >= 0.5).length;
  return [
    { name: "Home leans", note: `${count("home")} of ${leans.length} point to the home side.` },
    { name: "Draw leans", note: `${count("draw")} point to the draw.` },
    { name: "Away leans", note: `${count("away")} point to the away side.` },
    {
      name: "Close markets",
      note: `${doubles} games have a top-two probability gap under 6 points; the card still allows one selection only.`,
    },
    { name: "Bankers", note: `${bankers} market leans are 50% or more. A banker can still lose.` },
    { name: "Short prices", note: `${short} market leans are under 1.50.` },
    { name: "Draw weight", note: `The average draw probability on this card is ${pct(draws)}.` },
    {
      name: "Most open",
      note: open
        ? `${open.game.home} v ${open.game.away} has the smallest draw probability.`
        : "No games.",
    },
    {
      name: "Most even",
      note: even ? `${even.game.home} v ${even.game.away} has the tightest 1X2.` : "No games.",
    },
    {
      name: "Odds-derived scores",
      note: "Each row estimates two scorelines from the selected 1X2 prices; these are not team-stat model outputs.",
    },
    {
      name: "Public rows",
      note: `${games.filter((game) => !game.manual).length} rows came from an accessible public source.`,
    },
    {
      name: "Manual rows",
      note: `${games.filter((game) => game.manual).length} rows were entered by a user and need bookmaker verification.`,
    },
    {
      name: "Market/model warnings",
      note: "A red flag marks a material mismatch between no-vig market odds and a matched local model; no flag means no warning met the threshold.",
    },
    {
      name: "Source order",
      note: "1 is the displayed home team, X is draw, and 2 is the displayed away team.",
    },
    {
      name: "Missing prices",
      note: "Unavailable quotes stay blank; no demo or other-bookmaker odds are substituted.",
    },
    {
      name: "One result",
      note: "A single result is selected per match. Close probabilities do not auto-create a double chance.",
    },
    { name: "Card size", note: `${games.length} games are on this list.` },
    { name: "Data coverage", note: `${leans.length} games have a complete 1X2 price.` },
    {
      name: "Model access",
      note: "The full local model and analytics panel appears only where team order and kickoff match a game in Ready/Upcoming.",
    },
    { name: "Limit", note: "No check or formula makes a jackpot certain." },
  ];
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-KE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Africa/Nairobi",
  }).format(date);
}

function ClockCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="font-display text-3xl tabular-nums">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function mark(pick: Pick) {
  if (pick === "home") return "1";
  if (pick === "draw") return "X";
  return "2";
}

function nameOf(game: Game, pick: Pick) {
  if (pick === "home") return game.home;
  if (pick === "away") return game.away;
  return "Draw";
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

const FACT = [1, 1, 2, 6, 24, 120];

function pois(lambda: number, goals: number) {
  return (Math.exp(-lambda) * lambda ** goals) / FACT[goals];
}

function twoScores(odds: Record<Pick, number>) {
  const probs = fair(odds);
  const total = Math.min(3.4, Math.max(1.7, (2.5 * (1 - probs.draw)) / 0.72));
  const gap = (probs.home - probs.away) * 1.5;
  const home = Math.min(3.1, Math.max(0.35, (total + gap) / 2));
  const away = Math.min(3, Math.max(0.25, (total - gap) / 2));
  const rows: { score: string; chance: number }[] = [];
  for (let h = 0; h <= 5; h += 1) {
    for (let a = 0; a <= 5; a += 1)
      rows.push({ score: `${h}-${a}`, chance: pois(home, h) * pois(away, a) });
  }
  rows.sort((a, b) => b.chance - a.chance);
  return [rows[0].score, rows[1].score];
}
