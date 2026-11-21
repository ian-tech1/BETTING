import { Search } from "lucide-react";
import { BOOKS, LEAGUES, MATCHES } from "@/lib/price";
import { useDesk, type LeagueFilter } from "@/lib/desk-store";

const CHIP = "h-11 shrink-0 rounded-full px-4 text-sm font-medium";

export function Controls() {
  const league = useDesk((s) => s.league);
  const setLeague = useDesk((s) => s.setLeague);
  const query = useDesk((s) => s.query);
  const setQuery = useDesk((s) => s.setQuery);
  const bookId = useDesk((s) => s.bookId);
  const setBookId = useDesk((s) => s.setBookId);
  const oddsFormat = useDesk((s) => s.oddsFormat);
  const setOddsFormat = useDesk((s) => s.setOddsFormat);
  const marketFocus = useDesk((s) => s.marketFocus);
  const setMarketFocus = useDesk((s) => s.setMarketFocus);
  const sortKey = useDesk((s) => s.sortKey);
  const setSortKey = useDesk((s) => s.setSortKey);
  const minEdge = useDesk((s) => s.minEdge);
  const setMinEdge = useDesk((s) => s.setMinEdge);
  const onlyValue = useDesk((s) => s.onlyValue);
  const setOnlyValue = useDesk((s) => s.setOnlyValue);
  const onlyDesk = useDesk((s) => s.onlyDesk);
  const setOnlyDesk = useDesk((s) => s.setOnlyDesk);
  const day = useDesk((s) => s.day);
  const setDay = useDesk((s) => s.setDay);
  const watchOnly = useDesk((s) => s.watchOnly);
  const setWatchOnly = useDesk((s) => s.setWatchOnly);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm text-muted">
          Betting site
          <select
            value={bookId}
            onChange={(event) => setBookId(event.target.value as typeof bookId)}
            className="h-11 rounded-card border border-line bg-raised px-3 text-fg"
          >
            {["Sharp", "Kenya", "International"].map((region) => (
              <optgroup key={region} label={region}>
                {BOOKS.filter((book) => book.region === region).map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                    {book.sharp ? " · sharp" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="relative block flex-1">
          <span className="sr-only">Search teams</span>
          <Search className="pointer-events-none absolute top-3 left-3 size-5 text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a club"
            className="h-11 w-full rounded-card border border-line bg-raised pr-3 pl-11 text-fg outline-none placeholder:text-muted focus:border-signal"
          />
        </label>
      </div>

      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Competition">
        {LEAGUES.map((item) => (
          <button
            key={item.code}
            type="button"
            aria-selected={league === item.code}
            onClick={() => setLeague(item.code as LeagueFilter)}
            className={
              CHIP + (league === item.code ? " bg-signal text-ink" : " border border-line text-fg")
            }
          >
            {item.code === "ALL"
              ? `All ${MATCHES.length}`
              : `${item.label} ${MATCHES.filter((match) => match.code === item.code).length}`}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Seg
          label="Prices"
          value={oddsFormat}
          options={[
            ["decimal", "Decimal"],
            ["fractional", "Fractional"],
            ["american", "American"],
          ]}
          onChange={setOddsFormat}
        />
        <Seg
          label="Market"
          value={marketFocus}
          options={[
            ["1x2", "Result"],
            ["goals", "Goals"],
            ["btts", "BTTS"],
            ["corners", "Corners"],
            ["cards", "Cards"],
          ]}
          onChange={setMarketFocus}
        />
        <Seg
          label="Sort"
          value={sortKey}
          options={[
            ["edge", "Edge"],
            ["kickoff", "Kickoff"],
            ["competition", "Competition → kickoff"],
            ["chance", "Chance"],
            ["xg", "xG"],
          ]}
          onChange={setSortKey}
        />
        <Seg
          label="Min edge"
          value={String(minEdge)}
          options={[
            ["0", "Any"],
            ["2", "2 pts"],
            ["4", "4 pts"],
          ]}
          onChange={(value) => setMinEdge(Number(value))}
        />
        <button
          type="button"
          onClick={() => setOnlyValue(!onlyValue)}
          className={CHIP + (onlyValue ? " bg-signal text-ink" : " border border-line text-fg")}
        >
          {onlyValue ? "Value at my site" : "All prices"}
        </button>
        <Seg
          label="Day"
          value={day}
          options={[
            ["ALL", "Any day"],
            ["Saturday", "Saturday"],
            ["Sunday", "Sunday"],
            ["Midweek", "Midweek"],
          ]}
          onChange={setDay}
        />
        <button
          type="button"
          onClick={() => setOnlyDesk(!onlyDesk)}
          className={CHIP + (onlyDesk ? " bg-signal text-ink" : " border border-line text-fg")}
        >
          {onlyDesk ? "Bets only" : "Include passes"}
        </button>
        <button
          type="button"
          onClick={() => setWatchOnly(!watchOnly)}
          className={CHIP + (watchOnly ? " bg-signal text-ink" : " border border-line text-fg")}
        >
          {watchOnly ? "Watchlist" : "All matches"}
        </button>
      </div>
      <p className="text-xs text-muted">
        Competition → kickoff groups fixtures by league, then start time. The same schedule order
        applies to every selected bookmaker; it is not a live mirror of a bookmaker’s internal event
        list.
      </p>
    </div>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line p-1">
      <span className="shrink-0 px-2 text-xs text-muted">{label}</span>
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={
            "h-11 shrink-0 rounded-full px-3 text-sm " +
            (value === id ? "bg-signal font-medium text-ink" : "text-fg")
          }
        >
          {text}
        </button>
      ))}
    </div>
  );
}
