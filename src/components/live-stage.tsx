import { liveFixture } from "@/data/live";
import { useNow } from "@/components/use-now";
import { argmax } from "@/lib/engines";
import { pct } from "@/lib/format";
import { inPlay, liveClock, scoreAt } from "@/lib/inplay";
import { findMatch } from "@/lib/price";
import { FormPills } from "@/components/bits";

const HOME = [
  [78, 200],
  [160, 70],
  [160, 150],
  [160, 250],
  [160, 330],
  [250, 110],
  [250, 200],
  [250, 290],
  [330, 90],
  [330, 200],
  [330, 310],
];

const AWAY = HOME.map(([x, y]) => [680 - x, y] as const);

export function LiveStage({ id, compact = false }: { id: string; compact?: boolean }) {
  const match = findMatch(id);
  const { now } = useNow(250);
  if (!match) return null;
  const fixture = liveFixture(match.id);
  const clock = fixture ? liveClock(fixture.offsetMin, now) : { label: match.time, minute: -1, half: "Not started" };
  const score = fixture ? scoreAt(fixture.goals, clock.minute) : { home: 0, away: 0 };
  const play = inPlay(match.lambdaHome, match.lambdaAway, fixture ? clock.minute : 0, score.home, score.away);
  const lean = argmax({ home: play.home, draw: play.draw, away: play.away });
  const leanName = lean === "home" ? match.home.short : lean === "away" ? match.away.short : "Draw";
  const t = now ?? 0;
  const ball = ballAt(t, score.home, score.away, clock.minute);
  const goals = fixture ? fixture.goals.filter((goal) => clock.minute < 0 || goal.minute <= clock.minute) : [];

  return (
    <div id="live-view" className="overflow-hidden rounded-card border border-line bg-[#101612] text-white">
      <div className="relative">
        <Pitch now={t} ball={ball} compact={compact} />
        <div className="absolute top-2 left-2 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-xs">
          <span className="size-2 rounded-full bg-[#d6f25c]" aria-hidden="true" />
          <span>{fixture ? clock.label : "KO"}</span>
          <span className="text-white/70">{fixture ? clock.half : "Not started"}</span>
        </div>
        <div className="absolute right-2 bottom-2 left-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-card bg-black/75 px-3 py-2">
          <p className="truncate text-sm">{match.home.short}</p>
          <p className="font-display text-3xl tabular-nums">{fixture && clock.minute < 0 ? "–" : `${score.home}–${score.away}`}</p>
          <p className="truncate text-right text-sm">{match.away.short}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-3 pt-2">
        <div><p className="text-xs text-white/70">{match.home.short} previous five</p><FormPills form={match.home.form} /></div>
        <div className="text-right"><p className="text-xs text-white/70">{match.away.short} previous five</p><div className="flex justify-end"><FormPills form={match.away.form} /></div></div>
      </div>
      <div className="flex flex-col gap-1 px-3 py-2 text-xs text-white/75">
        <p>
          {match.league}
          {match.venue ? ` · ${match.venue}` : ""} · lean {leanName} {pct(lean === "home" ? play.home : lean === "away" ? play.away : play.draw)}
        </p>
        <p>
          {goals.length === 0
            ? "No goal yet."
            : goals.map((goal) => `${goal.minute}' ${goal.side === "home" ? match.home.short : match.away.short}`).join(" · ")}
        </p>
        <p>Desk picture running on this site. Not the television broadcast.</p>
      </div>
    </div>
  );
}

function Pitch({
  now,
  ball,
  compact,
}: {
  now: number;
  ball: { x: number; y: number };
  compact: boolean;
}) {
  return (
    <svg viewBox="0 0 680 400" className={compact ? "h-44 w-full" : "h-auto max-h-[28rem] w-full"} role="img" aria-label="Live pitch">
      <rect width="680" height="400" fill="#1c4a28" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={i * 85} width="85" height="400" fill={i % 2 ? "#1a4424" : "#1c4a28"} />
      ))}
      <rect x="16" y="16" width="648" height="368" fill="none" stroke="#d6f25c" strokeOpacity="0.75" />
      <line x1="340" y1="16" x2="340" y2="384" stroke="#d6f25c" strokeOpacity="0.75" />
      <circle cx="340" cy="200" r="54" fill="none" stroke="#d6f25c" strokeOpacity="0.75" />
      <rect x="16" y="110" width="90" height="180" fill="none" stroke="#d6f25c" strokeOpacity="0.75" />
      <rect x="574" y="110" width="90" height="180" fill="none" stroke="#d6f25c" strokeOpacity="0.75" />
      {HOME.map(([x, y], i) => (
        <circle key={`h${i}`} cx={x} cy={sway(y, now, i)} r="8" fill="#d6f25c" />
      ))}
      {AWAY.map(([x, y], i) => (
        <circle key={`a${i}`} cx={x} cy={sway(y, now, i + 3)} r="8" fill="#f4f4f0" />
      ))}
      <circle cx={ball.x} cy={ball.y} r="6" fill="#ffffff" />
    </svg>
  );
}

function sway(y: number, now: number, i: number) {
  if (now === 0) return y;
  return Math.min(370, Math.max(30, y + Math.sin(now / 420 + i) * 10));
}

function ballAt(now: number, homeGoals: number, awayGoals: number, minute: number) {
  if (now === 0 || minute < 0) return { x: 340, y: 200 };
  const toward = homeGoals === awayGoals ? 1 : homeGoals > awayGoals ? 1 : -1;
  const x = 340 + Math.sin(now / 900) * 150 + toward * 70;
  const y = 200 + Math.cos(now / 700) * 90;
  return { x: Math.min(640, Math.max(40, x)), y: Math.min(360, Math.max(40, y)) };
}
