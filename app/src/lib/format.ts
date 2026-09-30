export function formatIndex(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatIndexShort(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number, opts?: { decimals?: number }): string {
  const decimals = opts?.decimals ?? 2;
  const v = n.toFixed(decimals);
  return `${n > 0 ? "+" : ""}${v}%`;
}

export function formatSigned(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}`;
}

/** Compact count — K / M / B (drops to 2 decimals only under 1,000). */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1_000) {
    return Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * A non-money quantity (shares, AURA, order size) — K/M/B from 1,000 up so a
 * table column never turns into a wall of digits.
 */
export function formatAmount(n: number): string {
  return formatCompact(n);
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${formatCompact(n)}`;
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * The number part of a money figure — no `$`. Use with <UsdcAmount>, which puts
 * the USDC mark where the currency symbol used to be. K/M/B from 1,000 up.
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1_000) {
    return Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  }
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
