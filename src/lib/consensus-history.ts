import type { SourceRecord } from "./consensus";

const KEY = "consensus-history-v1";

export function loadHistory(): SourceRecord[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SourceRecord[]).slice(-100) : [];
  } catch {
    return [];
  }
}

/** Call once per finished match so the engine/AI weights learn from the last 100 results. */
export function recordSettled(record: SourceRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadHistory(), record].slice(-100)));
  } catch {
    /* storage unavailable: weights stay at 50/50 */
  }
}

/** Replace the local window with the server's record (the server is the source of truth for results). */
export function replaceHistory(rows: SourceRecord[]) {
  try {
    if (rows.length) localStorage.setItem(KEY, JSON.stringify(rows.slice(-100)));
  } catch {
    /* storage unavailable */
  }
}
