export type OddsFormat = "decimal" | "fractional" | "american";

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function signedPts(n: number): string {
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} pts`;
}

export function signedEv(n: number): string {
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}% EV`;
}

export function oddsText(n: number): string {
  return n.toFixed(2);
}

export function units(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function priceTone(ev: number): "Edge" | "Fair" | "Short" {
  if (ev >= 0.02) return "Edge";
  if (ev <= -0.03) return "Short";
  return "Fair";
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formatOdds(decimal: number, format: OddsFormat): string {
  if (!Number.isFinite(decimal) || decimal <= 1) return "—";
  if (format === "decimal") return decimal.toFixed(2);
  if (format === "american") {
    if (decimal >= 2) return `+${Math.round((decimal - 1) * 100)}`;
    return `${Math.round(-100 / (decimal - 1))}`;
  }
  const profit = decimal - 1;
  const den = 20;
  const num = Math.max(1, Math.round(profit * den));
  const g = gcd(num, den);
  return `${num / g}/${den / g}`;
}

export function riskBand(decimal: number): "Short" | "Mid" | "Long" {
  if (decimal < 1.7) return "Short";
  if (decimal < 2.6) return "Mid";
  return "Long";
}

export function countdown(kickoffMs: number, now: number): string {
  const delta = kickoffMs - now;
  if (delta <= 0) return "Kicked off";
  const mins = Math.floor(delta / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${rest}m`;
  return `${rest}m`;
}
