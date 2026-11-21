import type { Consensus } from "@/lib/consensus";

const NAME = { home: "Home", draw: "Draw", away: "Away" } as const;

export function ConsensusBadge({ c, home, away, signalsUsed = [] }: { c: Consensus; home: string; away: string; signalsUsed?: string[] }) {
  const who = c.pick === "home" ? home : c.pick === "away" ? away : "Draw";
  const covered = c.code.length === 2 ? ` · cover ${c.code}` : "";
  return (
    <div
      className="rounded-card p-3"
      style={{ border: `2px solid ${c.color}`, background: `${c.color}1A` }}
      role="status"
      aria-label={`Final prediction ${who}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: c.color }}>
        Final tip · {c.label}
      </p>
      <p className="mt-1 text-base font-semibold text-fg">
        {`${who} (${c.pick === "home" ? "1" : c.pick === "draw" ? "X" : "2"})`}
        <span className="ml-2 text-sm font-normal text-muted">
          {Math.round(c.probabilities[c.pick] * 100)}% · tier {c.tier}{covered}
        </span>
      </p>
      <p className="mt-1 text-xs text-muted">
        Engine said {NAME[c.enginePick]}, AI lab said {NAME[c.aiPick]}; one reconciled result is shown. Weights{" "}
        {Math.round(c.weights.engine * 100)}/{Math.round(c.weights.ai * 100)} (engine/AI, last {c.weights.sample} matches).
        {c.cautions.length ? ` Cautions: ${c.cautions.join("; ")}.` : ""}
      </p>
      <p className="mt-1 text-xs text-muted">
        Pick holds in {Math.round(c.band.stability * 100)}% of goal-rate stress runs; range {Math.round(c.band.low * 100)}–{Math.round(c.band.high * 100)}%.
        {signalsUsed.length ? ` Extra signals: ${signalsUsed.join(", ")}.` : " No live data keys configured, stats-only."}
      </p>
    </div>
  );
}
