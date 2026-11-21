import { useEffect, useState } from "react";
import { recordVisitorHeartbeat, type VisitorCount } from "@/lib/visitor-fn";

const STORAGE_KEY = "ian-tech-anonymous-visitor-id";
const HEARTBEAT_MS = 60_000;

function getVisitorId() {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[a-z0-9-]{20,80}$/i.test(existing)) return existing;
    const generated = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

export function VisitorCount() {
  const [count, setCount] = useState<VisitorCount | null>(null);

  useEffect(() => {
    let active = true;
    const visitorId = getVisitorId();
    const heartbeat = () => {
      void recordVisitorHeartbeat({ data: visitorId }).then((next) => {
        if (active && next.total > 0) setCount(next);
      }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!count) return null;
  return (
    <div className="rounded-full border border-line bg-surface px-3 py-2 text-[11px] text-muted" title="Anonymous estimate based on visitors active in the last two minutes">
      <span className="text-signal">●</span> Visitors: {count.active} online · {count.total} total
    </div>
  );
}
