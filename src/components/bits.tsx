import type { FormMark } from "@/data/weekend";
import { pct } from "@/lib/format";
import type { PricedMatch } from "@/lib/price";

export function FormPills({ form }: { form: FormMark[] }) {
  const marks: (FormMark | null)[] = [...form.slice(-5)];
  while (marks.length < 5) marks.unshift(null);
  return (
    <div className="flex gap-1" aria-label="Last five">
      {marks.map((mark, index) => (
        <span
          key={`${mark ?? "pending"}-${index}`}
          className={
            "flex size-6 items-center justify-center rounded-full text-xs font-medium " +
            (mark === "W"
              ? "bg-signal text-ink"
              : mark === "D"
                ? "bg-raised text-fg"
                : mark === "L"
                  ? "bg-line text-muted"
                  : "border border-dashed border-line text-muted")
          }
        >
          {mark ?? "·"}
        </span>
      ))}
    </div>
  );
}

export function SplitBar({ match }: { match: PricedMatch }) {
  const h = match.model.home * 100;
  const d = match.model.draw * 100;
  const a = match.model.away * 100;
  return (
    <div
      className="flex h-1.5 overflow-hidden rounded-full bg-raised"
      role="img"
      aria-label={`Model split ${pct(match.model.home)} home, ${pct(match.model.draw)} draw, ${pct(match.model.away)} away`}
    >
      <div className="bg-signal" style={{ width: `${h.toFixed(1)}%` }} />
      <div className="bg-muted" style={{ width: `${d.toFixed(1)}%` }} />
      <div className="bg-fg" style={{ width: `${a.toFixed(1)}%` }} />
    </div>
  );
}
