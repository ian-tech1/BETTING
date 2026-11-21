import { useEffect, useState } from "react";

/** Null until mounted so server and first client paint match. */
export function useNow(ms = 15000): { now: number | null; bucket: number } {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, ms);
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", tick);
    };
  }, [ms]);
  const bucket = now === null ? 0 : Math.floor(now / 30000);
  return { now, bucket };
}
