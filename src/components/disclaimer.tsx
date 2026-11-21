/** Shown wherever picks are shown. Plain wording on purpose: no prediction here is a guarantee. */
export const ACCURACY_NOTICE =
  "Important: AI cannot guarantee winning jackpot predictions. Actual accuracy must be measured against completed match results.";

export function AccuracyNotice({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      className={`rounded-card border border-line bg-raised px-3 py-2 text-xs text-fg ${className}`}
    >
      <strong className="font-semibold">Important:</strong>{" "}
      AI cannot guarantee winning jackpot predictions. Actual accuracy must be measured against
      completed match results.
    </p>
  );
}
