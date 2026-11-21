import { useEffect, useState } from "react";
import { CalendarClock, History, Info, Link2, Radio, Sparkles, Ticket, Trophy } from "lucide-react";
import { Board } from "@/components/board";
import { Controls } from "@/components/controls";
import { Jackpot } from "@/components/jackpot";
import { LiveBoard } from "@/components/live-board";
import { MatchPreview } from "@/components/match-preview";
import { MatchSheet } from "@/components/match-sheet";
import { Method } from "@/components/method";
import { Ready } from "@/components/ready";
import { Recent } from "@/components/recent";
import { SlipView } from "@/components/slip-view";
import { useNow } from "@/components/use-now";
import { BOOKS } from "@/lib/price";
import { AccuracyNotice } from "@/components/disclaimer";
import { ModelMonitor } from "@/components/model-monitor";
import { ProviderStatus } from "@/components/provider-status";
import { VisitorCount } from "@/components/visitor-count";
import { useDesk, type DeskView } from "@/lib/desk-store";

const NAV: { id: DeskView; label: string; short: string; icon: typeof Sparkles }[] = [
  { id: "live", label: "Live", short: "Live", icon: Radio },
  { id: "ready", label: "Ready", short: "Ready", icon: Sparkles },
  { id: "upcoming", label: "Upcoming", short: "Next", icon: CalendarClock },
  { id: "jackpot", label: "Jackpot", short: "Jackpot", icon: Trophy },
  { id: "recent", label: "Results", short: "Results", icon: History },
  { id: "slip", label: "Slip", short: "Slip", icon: Ticket },
  { id: "method", label: "Method", short: "Method", icon: Info },
];

export function Desk() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const view = useDesk((s) => s.view);
  const setView = useDesk((s) => s.setView);
  const legs = useDesk((s) => s.legs);
  const bankroll = useDesk((s) => s.bankroll);
  const setBankroll = useDesk((s) => s.setBankroll);
  const openId = useDesk((s) => s.openId);
  const previewId = useDesk((s) => s.previewId);
  const bookId = useDesk((s) => s.bookId);
  const showKes = useDesk((s) => s.showKes);
  const setShowKes = useDesk((s) => s.setShowKes);
  const gameView = view === "live" || view === "ready" || view === "upcoming" || view === "jackpot";
  const book = BOOKS.find((row) => row.id === bookId)?.name ?? "Betika";
  const { now } = useNow(1000);

  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(true), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  const clock =
    now === null
      ? "Live desk"
      : new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
          hourCycle: "h23",
        }).format(now) + " UK";

  if (!open) return <Splash onEnter={() => setOpen(true)} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto flex items-center gap-3">
            <span className="size-3 rounded-full bg-signal" aria-hidden="true" />
            <div>
              <p className="font-display text-xl leading-none">IAN TECH</p>
              <p className="max-w-[16rem] text-[11px] leading-tight text-muted">
                {gameView ? book : `Football betting predictions · ${clock} · ${book}`}
              </p>
            </div>
          </div>
          <VisitorCount />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
            {NAV.map((item) => (
              <NavButton
                key={item.id}
                active={view === item.id}
                label={
                  item.id === "slip" && legs.length > 0
                    ? `${item.label} ${legs.length}`
                    : item.label
                }
                onClick={() => setView(item.id)}
              />
            ))}
          </nav>
          <label className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm">
            <span className="text-muted">Bank</span>
            <input
              type="number"
              min={1}
              max={1000000}
              value={showKes ? Math.round(bankroll * 100) : bankroll}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next) || next < 1) return;
                setBankroll(showKes ? next / 100 : next);
              }}
              className="w-24 bg-transparent text-right tabular-nums outline-none"
              aria-label={showKes ? "Bankroll in Kenyan shillings" : "Bankroll in units"}
            />
            <button type="button" onClick={() => setShowKes(!showKes)} className="text-muted">
              {showKes ? "KES" : "u"}
            </button>
          </label>
          <button
            type="button"
            onClick={() => {
              const url = window.location.href;
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
            className="flex h-11 items-center gap-2 rounded-full border border-line px-3 text-sm"
          >
            <Link2 className="size-4" />
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {!gameView ? <p className="border-t border-line px-4 py-2 text-center text-xs text-muted">
          Estimates, not certainties. Demo prices are the default; choose or compare sources per
          match. Missing public prices stay blank. A positive edge is not a correct bet. 18+. Need
          help?{" "}
          <a className="underline" href="tel:+254723278526">
            +254 723 278 526
          </a>
          {" · "}
          <a
            className="underline"
            href="https://wa.me/254723278526"
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        </p> : null}
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 pb-28 md:pb-10">
        {!gameView ? <AccuracyNotice /> : null}
        {!gameView ? <ProviderStatus /> : null}
        {!gameView ? <ModelMonitor /> : null}
        {view !== "slip" && view !== "method" && view !== "jackpot" ? <Controls /> : null}
        {view === "live" ? <LiveBoard /> : null}
        {view === "ready" ? <Ready /> : null}
        {view === "upcoming" ? <Board /> : null}
        {view === "jackpot" ? <Jackpot /> : null}
        {view === "recent" ? <Recent /> : null}
        {view === "slip" ? <SlipView /> : null}
        {view === "method" ? <Method /> : null}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden"
        aria-label="Sections"
      >
        <ul className="grid grid-cols-7">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setView(item.id)}
                  className={
                    "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] " +
                    (active ? "text-signal" : "text-muted")
                  }
                >
                  <Icon className="size-5" />
                  {item.short}
                  {item.id === "slip" && legs.length > 0 ? ` ${legs.length}` : ""}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {openId ? <MatchSheet id={openId} /> : null}
      {previewId ? <MatchPreview id={previewId} /> : null}
    </div>
  );
}

function Splash({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="size-3 rounded-full bg-signal" aria-hidden="true" />
      <h1 className="font-display text-5xl leading-none sm:text-7xl">
        IAN TECH
        <span className="mt-3 block">PREDICTIONS</span>
      </h1>
      <p className="max-w-sm text-muted">Football. Estimates, not certainties.</p>
      <VisitorCount />
      <button
        type="button"
        onClick={onEnter}
        className="h-11 rounded-full bg-signal px-6 text-sm font-medium text-ink"
      >
        Enter
      </button>
    </div>
  );
}

function NavButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-11 rounded-full px-3 text-sm " +
        (active ? "bg-signal font-medium text-ink" : "text-muted")
      }
    >
      {label}
    </button>
  );
}
