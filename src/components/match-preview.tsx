import { useEffect } from "react";
import { X } from "lucide-react";
import { liveFixture } from "@/data/live";
import { LiveStage } from "@/components/live-stage";
import { findMatch, LIVE } from "@/lib/price";
import { useDesk } from "@/lib/desk-store";

export function MatchPreview({ id }: { id: string }) {
  const match = findMatch(id);
  const setPreview = useDesk((s) => s.setPreview);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPreview]);

  if (!match || !liveFixture(match.id)) return null;

  return (
    <div
      role="dialog"
      aria-label="Live game"
      className="fixed right-3 bottom-20 z-40 w-[min(100%-1.5rem,22rem)] overflow-hidden rounded-card border border-line bg-bg shadow-2xl md:bottom-4"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <p className="min-w-0 flex-1 text-sm text-signal">Live window</p>
        <button
          type="button"
          onClick={() => setPreview(null)}
          aria-label="Close live window"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line"
        >
          <X className="size-5" />
        </button>
      </div>
      <label className="block border-b border-line px-3 py-2 text-xs text-muted">
        Switch game
        <select
          value={match.id}
          onChange={(event) => setPreview(event.target.value)}
          className="mt-1 h-11 w-full rounded-card border border-line bg-raised px-2 text-sm text-fg"
        >
          {LIVE.map((row) => (
            <option key={row.id} value={row.id}>
              {row.home.short} v {row.away.short}
            </option>
          ))}
        </select>
      </label>
      <LiveStage id={match.id} compact />
    </div>
  );
}
