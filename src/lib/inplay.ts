import type { LiveGoal } from "@/data/live";

function poisson(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export type LiveClock = { label: string; minute: number; half: string };

/** Minute runs on a 96-minute desk loop so a match is always in play. */
export function liveClock(offsetMin: number, now: number | null): LiveClock {
  if (now === null) return { label: "Live", minute: -1, half: "Live" };
  const minute = (Math.floor(now / 60000) + offsetMin) % 96;
  if (minute >= 45 && minute < 48) return { label: "HT", minute: 45, half: "Half-time" };
  if (minute > 90) return { label: `90+${minute - 90}`, minute, half: "Added time" };
  if (minute >= 48) return { label: `${minute}'`, minute, half: "2nd half" };
  return { label: `${minute}'`, minute, half: "1st half" };
}

export function scoreAt(goals: LiveGoal[], minute: number): { home: number; away: number } {
  if (minute < 0) return { home: 0, away: 0 };
  let home = 0;
  let away = 0;
  for (const goal of goals) {
    if (goal.minute <= minute) {
      if (goal.side === "home") home += 1;
      else away += 1;
    }
  }
  return { home, away };
}

export type InPlay = {
  home: number;
  draw: number;
  away: number;
  liveXgH: number;
  liveXgA: number;
  remH: number;
  remA: number;
  nextHome: number;
  nextAway: number;
  noGoal: number;
};

/** Win chances from the goals already scored plus the xG still left. */
export function inPlay(lamH: number, lamA: number, minute: number, hg: number, ag: number): InPlay {
  const played = minute < 0 ? 20 : Math.min(94, minute);
  const left = Math.max(6, 94 - played) / 94;
  const remH = lamH * left;
  const remA = lamA * left;
  const max = 6;
  const ph = Array.from({ length: max + 1 }, (_, k) => poisson(k, remH));
  const pa = Array.from({ length: max + 1 }, (_, k) => poisson(k, remA));
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = ph[i] * pa[j];
      const fh = hg + i;
      const fa = ag + j;
      if (fh > fa) home += p;
      else if (fh === fa) draw += p;
      else away += p;
    }
  }
  const mass = home + draw + away || 1;
  const noGoal = Math.exp(-(remH + remA));
  const share = remH + remA <= 0 ? 0.5 : remH / (remH + remA);
  return {
    home: home / mass,
    draw: draw / mass,
    away: away / mass,
    liveXgH: lamH * (played / 94),
    liveXgA: lamA * (played / 94),
    remH,
    remA,
    nextHome: (1 - noGoal) * share,
    nextAway: (1 - noGoal) * (1 - share),
    noGoal,
  };
}

export function halfTimeLean(lamH: number, lamA: number): InPlay {
  return inPlay(lamH * 0.45, lamA * 0.45, 0, 0, 0);
}

export function topScorelines(lamH: number, lamA: number, n = 3): { score: string; p: number }[] {
  const max = 5;
  const rows: { score: string; p: number }[] = [];
  const ph = Array.from({ length: max + 1 }, (_, k) => poisson(k, lamH));
  const pa = Array.from({ length: max + 1 }, (_, k) => poisson(k, lamA));
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) rows.push({ score: `${i}–${j}`, p: ph[i] * pa[j] });
  }
  return rows.sort((a, b) => b.p - a.p).slice(0, n);
}

export function liveDecimal(prob: number, sharp: boolean): number {
  const margin = sharp ? 1.035 : 1.075;
  return Math.round((1 / Math.max(0.05, prob * margin)) * 100) / 100;
}

export function slipCode(parts: string[]): string {
  let h = 2166136261;
  const seed = parts.join("|");
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `SL-${(h >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(0, 6)}`;
}
