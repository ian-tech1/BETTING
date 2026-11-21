import { useEffect, useState } from "react";
import { liveFixture } from "@/data/live";
import { useNow } from "@/components/use-now";
import { formatOdds, pct, signedEv, units } from "@/lib/format";
import { inPlay, liveClock, liveDecimal, scoreAt, slipCode } from "@/lib/inplay";
import {
  BOOKS,
  findMatch,
  quoteAt,
  selectionName,
  suggestedStake,
  type BookId,
  type Edge,
  type MarketKey,
  type PricedMatch,
} from "@/lib/price";
import { useDesk, type SlipLeg } from "@/lib/desk-store";

const HISTORY_KEY = "ian-tech-slips";

type SavedSlip = { code: string; legs: SlipLeg[]; text: string };

function readHistory(): SavedSlip[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((row): row is SavedSlip => {
      if (!row || typeof row !== "object") return false;
      const item = row as SavedSlip;
      return typeof item.code === "string" && Array.isArray(item.legs) && typeof item.text === "string";
    });
  } catch {
    return [];
  }
}

function remember(slip: SavedSlip) {
  const next = [slip, ...readHistory().filter((row) => row.code !== slip.code)].slice(0, 6);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

export function SlipView() {
  const legs = useDesk((s) => s.legs);
  const bankroll = useDesk((s) => s.bankroll);
  const toggleLeg = useDesk((s) => s.toggleLeg);
  const clearLegs = useDesk((s) => s.clearLegs);
  const setOpen = useDesk((s) => s.setOpen);
  const placeId = useDesk((s) => s.placeId);
  const setPlaceId = useDesk((s) => s.setPlaceId);
  const oddsFormat = useDesk((s) => s.oddsFormat);
  const showKes = useDesk((s) => s.showKes);
  const setLegs = useDesk((s) => s.setLegs);
  const setSeenOdds = useDesk((s) => s.setSeenOdds);
  const [receipt, setReceipt] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [stakeText, setStakeText] = useState("");
  const [loadText, setLoadText] = useState("");
  const [loadNote, setLoadNote] = useState("");
  const [history, setHistory] = useState<SavedSlip[]>([]);
  const { now } = useNow(5000);
  const place = BOOKS.find((book) => book.id === placeId) ?? BOOKS[0];

  const rows = legs
    .map((leg) => {
      const match = findMatch(leg.matchId);
      if (!match) return null;
      const priced = priceLeg(match, leg.market, placeId, now, leg.seenOdds);
      return { match, market: leg.market, seenOdds: leg.seenOdds, ...priced };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const sameGame = rows.some((row, index) => rows.findIndex((other) => other.match.id === row.match.id) !== index);
  const combinedOdds = rows.reduce((acc, row) => acc * row.odds, 1);
  const combinedP = rows.reduce((acc, row) => acc * row.model, 1);
  const combinedEv = rows.length === 0 ? 0 : combinedP * combinedOdds - 1;
  const code = slipCode(rows.map((row) => `${row.match.id}:${row.market}`));
  const suggested =
    rows.length === 0
      ? 0
      : rows.length === 1
        ? rows[0].stake
        : parlayStake(combinedOdds, combinedP, combinedEv, bankroll);
  const typedStake = Number(stakeText);
  const stake = stakeText === "" || !Number.isFinite(typedStake) || typedStake < 0 ? suggested : typedStake;
  const returns = stake * (Number.isFinite(combinedOdds) ? combinedOdds : 0);
  const heavy = bankroll > 0 && stake / bankroll > 0.05;
  const money = (n: number) => (showKes ? `KES ${Math.round(n * 100).toLocaleString("en-KE")}` : `${units(n)} u`);
  const lines = rows.map(
    (row, index) =>
      `${index + 1}. ${row.match.home.name} v ${row.match.away.name} — ${selectionName(row.match, row.market)} @ ${row.odds.toFixed(2)}${row.live ? " in-play" : ""}`,
  );
  const xbetText = [
    "IAN TECH lines for 1xBet",
    "Not a 1xBet booking code. 1xBet will not load this. Add each match on 1xBet yourself.",
    ...lines,
    `Combined @ ${combinedOdds.toFixed(2)}`,
    `Stake ${money(stake)} · return ${money(returns)}`,
    `IAN TECH code ${code} — paste this on IAN TECH to reload the slip, not into 1xBet.`,
  ].join("\n");
  const savedSlipSnapshot = JSON.stringify({
    code,
    legs: rows.map((row) => ({ matchId: row.match.id, market: row.market })),
    text: lines.join("\n"),
  });

  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    const saved = JSON.parse(savedSlipSnapshot) as SavedSlip;
    if (saved.legs.length === 0) return;
    remember(saved);
    setHistory(readHistory());
  }, [savedSlipSnapshot]);

  async function processCopy(body: string) {
    setReceipt(body);
    try {
      await navigator.clipboard.writeText(body);
      setReceiptNote("Copy processed. It is on the clipboard. Select the box if you need it again.");
    } catch {
      setReceiptNote("Copy processed on screen. The clipboard was blocked, so select the text.");
    }
  }

  function loadCode() {
    const wanted = loadText.trim().toUpperCase();
    const hit = readHistory().find((row) => row.code.toUpperCase() === wanted);
    if (!hit) {
      setLoadNote("That code is not saved on this browser. IAN TECH codes reload a slip you already built here. 1xBet will not accept them.");
      return;
    }
    setLegs(hit.legs);
    setLoadNote(`Loaded ${hit.code}.`);
  }

  const across = BOOKS.map((book) => ({
    book,
    odds: rows.reduce((acc, row) => acc * priceLeg(row.match, row.market, book.id, now).odds, 1),
  })).sort((a, b) => b.odds - a.odds);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl">Slip</h1>
        <p className="mt-2 max-w-2xl text-pretty text-muted">
          Price the legs for the site you use, then process the copy. 1xBet will not load a code made
          here. Their load box only accepts a code 1xBet printed. The lines below are what you add by hand.
        </p>
      </div>

      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="font-display text-2xl">Load an IAN TECH code</h2>
        <p className="mt-1 text-sm text-muted">
          This reloads a slip already processed in this browser. It is not a 1xBet booking code.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={loadText}
            onChange={(event) => setLoadText(event.target.value)}
            placeholder="SL-····"
            className="h-11 min-w-40 flex-1 rounded-card border border-line bg-bg px-3"
            aria-label="IAN TECH slip code"
          />
          <button type="button" onClick={loadCode} className="h-11 rounded-full bg-signal px-4 text-sm font-medium text-ink">
            Load
          </button>
        </div>
        {loadNote ? <p className="mt-2 text-sm text-muted">{loadNote}</p> : null}
        {history.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {history.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => {
                  setLegs(item.legs);
                  setLoadNote(`Loaded ${item.code}.`);
                }}
                className="h-11 rounded-full border border-line px-4 text-sm"
              >
                {item.code}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface px-4 py-10 text-center">
          <p className="font-medium">The slip is empty.</p>
          <p className="mt-1 text-sm text-muted">Add a pick from Live, Ready, or a match sheet.</p>
          <button
            type="button"
            onClick={() => useDesk.getState().setView("live")}
            className="mt-4 h-11 rounded-full bg-signal px-4 text-sm font-medium text-ink"
          >
            See live games
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-muted">
              Place this on
              <select
                value={placeId}
                onChange={(event) => setPlaceId(event.target.value as BookId)}
                className="h-11 rounded-card border border-line bg-surface px-3 text-fg"
              >
                {["Kenya", "International", "Sharp"].map((region) => (
                  <optgroup key={region} label={region}>
                    {BOOKS.filter((book) => book.region === region).map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {sameGame ? (
              <p className="text-sm text-muted">
                Two markets from the same game are on this slip. Some books will not take both. The combined price treats them as separate.
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={`${row.match.id}:${row.market}`} className="rounded-card border border-line bg-surface p-4">
                  <p className="text-sm text-muted">
                    {row.match.home.short} v {row.match.away.short}
                    {row.live ? " · in play" : ` · ${row.match.dateLabel}`}
                  </p>
                  <p className="mt-1 text-lg font-medium">{selectionName(row.match, row.market)}</p>
                  <p className="mt-1 text-sm tabular-nums text-muted">
                    {row.yours ? "Your price" : `${place.name} desk estimate`} {formatOdds(row.odds, oddsFormat)} · model {pct(row.model)} ·{" "}
                    {signedEv(row.model * row.odds - 1)}
                    {row.stake > 0 ? ` · stake ${money(row.stake)}` : ""}
                  </p>
                  <label className="mt-3 block text-sm text-muted">
                    Odds you see on {place.name}
                    <input
                      inputMode="decimal"
                      placeholder="e.g. 1.85"
                      value={row.seenOdds ?? ""}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setSeenOdds(row.match.id, row.market, event.target.value.trim() === "" || !Number.isFinite(next) ? null : next);
                      }}
                      className="mt-1 h-11 w-full rounded-card border border-line bg-bg px-3 text-fg"
                    />
                  </label>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setOpen(row.match.id)} className="h-11 rounded-full border border-line px-4 text-sm">
                      Sheet
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleLeg(row.match.id, row.market)}
                      className="h-11 rounded-full border border-line px-4 text-sm text-muted"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="font-display text-2xl">Put this on Betika or 1xBet</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Open that site and search each match by the team names below.</li>
                <li>Tap the same pick: 1, X, 2, both teams, or over/under 2.5.</li>
                <li>On Betika, tap Share on their slip. On 1xBet, tap Save/load events.</li>
                <li>The code that site shows is the only one its load box will accept.</li>
              </ol>
              <p className="mt-3 text-sm text-fg">
                The code on this page ({code}) only reloads the slip here. Betika and 1xBet both reject it, because they never created it.
              </p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-card bg-bg p-3 text-sm">{xbetText}</pre>
            </section>
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="font-display text-2xl">Same slip, every site</h2>
              <p className="mt-1 text-sm text-muted">
                Best place to play it: {across[0]?.book.name} at {across[0]?.odds.toFixed(2)}. Still type it in yourself.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {across.map((row) => (
                  <li key={row.book.id} className={"flex items-center justify-between rounded-card px-3 py-2 text-sm " + (row.book.id === placeId ? "bg-signal text-ink" : "bg-raised")}>
                    <span>{row.book.name}</span>
                    <span className="tabular-nums">{formatOdds(row.odds, oddsFormat)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <aside className="h-fit rounded-card border border-dashed border-line bg-surface p-4">
            <p className="text-sm text-muted">{rows.length === 1 ? "Single" : `${rows.length}-leg parlay`} · {place.name}</p>
            <p className="font-display text-4xl tabular-nums">{formatOdds(combinedOdds, oddsFormat)}</p>
            <p className="mt-2 text-sm text-muted">Desk code {code}</p>
            <p className="text-sm text-muted">Combined model chance {pct(combinedP)}</p>
            <p className="text-sm tabular-nums">{signedEv(combinedEv)}</p>
            <p className="mt-3 text-sm text-fg">
              Stake {money(stake)} · possible return {money(returns)}
            </p>
            <label className="mt-3 flex flex-col gap-1 text-sm text-muted">
              Your stake
              <input
                value={stakeText}
                onChange={(event) => setStakeText(event.target.value)}
                inputMode="decimal"
                placeholder={suggested ? String(suggested) : "0"}
                className="h-11 rounded-card border border-line bg-bg px-3 text-fg"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 5, 10].map((n) => (
                <button key={n} type="button" onClick={() => setStakeText(String(n))} className="h-11 rounded-full border border-line px-3 text-sm">
                  {n}u
                </button>
              ))}
            </div>
            {heavy ? (
              <p className="mt-3 text-sm text-pretty text-muted">That stake is over 5% of the bank. Cut it.</p>
            ) : null}
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div className="h-full bg-signal" style={{ width: `${Math.min(100, combinedP * 100).toFixed(1)}%` }} />
            </div>
            <p className="mt-1 text-sm text-muted">Slip chance {pct(combinedP)}</p>
            {rows.length > 2 ? (
              <p className="mt-3 text-sm text-pretty text-muted">
                Three or more legs multiply the book’s margin. A long acca is not a better bet.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void processCopy(xbetText)}
              className="mt-4 h-11 w-full rounded-full bg-signal text-sm font-medium text-ink"
            >
              Process 1xBet lines
            </button>
            <button
              type="button"
              onClick={() =>
                void processCopy(
                  [`IAN TECH slip · ${place.name}`, `Code ${code}`, ...lines, `Combined @ ${combinedOdds.toFixed(2)}`, `Stake ${money(stake)}`].join("\n"),
                )
              }
              className="mt-2 h-11 w-full rounded-full border border-line text-sm"
            >
              Process {place.name} copy
            </button>
            <a
              href={place.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex h-11 w-full items-center justify-center rounded-full border border-line text-sm"
            >
              Open {place.name}
            </a>
            <button type="button" onClick={clearLegs} className="mt-2 h-11 w-full rounded-full border border-line text-sm text-muted">
              Clear slip
            </button>
          </aside>
          {receipt ? (
            <section className="rounded-card border border-signal bg-surface p-4 lg:col-span-2">
              <h2 className="font-display text-2xl">Copy processed</h2>
              <p className="mt-1 text-sm text-muted">{receiptNote}</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-card bg-bg p-3 text-sm text-fg">{receipt}</pre>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function priceLeg(match: PricedMatch, market: MarketKey, bookId: BookId, now: number | null, seen?: number) {
  const fixture = liveFixture(match.id);
  const book = BOOKS.find((row) => row.id === bookId);
  const typed = typeof seen === "number" && seen >= 1.01 && seen <= 50 ? Math.round(seen * 100) / 100 : null;
  if (fixture && (market === "home" || market === "draw" || market === "away") && now !== null && typed === null) {
    const clock = liveClock(fixture.offsetMin, now);
    const score = scoreAt(fixture.goals, clock.minute);
    const play = inPlay(match.lambdaHome, match.lambdaAway, clock.minute, score.home, score.away);
    const model = market === "home" ? play.home : market === "away" ? play.away : play.draw;
    const odds = liveDecimal(model, Boolean(book?.sharp));
    const edge: Edge = {
      market,
      model,
      consensus: model,
      edge: 0,
      odds,
      book: book?.name ?? "",
      bookId,
      ev: model * odds - 1,
      confidence: "Solid",
    };
    return { odds, model, live: true, yours: false, stake: suggestedStake(edge, useDesk.getState().bankroll) };
  }
  const quote = quoteAt(match, bookId, market);
  const model = match.model[market];
  const odds = typed ?? quote.odds;
  const edge: Edge = {
    market,
    model,
    consensus: match.consensus[market],
    edge: quote.edge,
    odds,
    book: quote.book,
    bookId,
    ev: model * odds - 1,
    confidence: "Solid",
  };
  return { odds, model, live: false, yours: typed !== null, stake: suggestedStake(edge, useDesk.getState().bankroll) };
}

function parlayStake(odds: number, model: number, ev: number, bankroll: number): number {
  if (ev <= 0 || odds <= 1) return 0;
  const fraction = Math.min(0.02, Math.max(0, ((odds - 1) * model - (1 - model)) / (odds - 1)) * 0.25);
  return Math.round(fraction * bankroll * 100) / 100;
}
