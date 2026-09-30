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

/**
 * A market PRICE in cents, to ONE decimal place, from a fraction of a dollar
 * (the space on-chain prices live in: `1e18` = $1, the same one `priceUsd` and
 * `wholeCentPrice` use). This is the ONE price formatter — chart end labels,
 * market cards, the trade ticket, the order book and positions all route here,
 * so a price cannot read "50¢" on one surface and "50.2¢" on another.
 *
 * A binary market's price and its probability are the same number (50¢ = 50%),
 * so a price is always shown in cents; `%` is reserved for genuine
 * probability/chance readouts that are not a price.
 *
 * One decimal, trailing zero dropped so it reads well:
 *   0.502 → "50.2¢" · 0.5 → "50¢" · 0.015 → "1.5¢" · 0.999 → "99.9¢" · 1 → "100¢"
 * A tiny positive price never collapses to a misleading "0¢" — below half a
 * tenth of a cent it reads "<0.1¢".
 */
export function formatCents(price: number): string {
  if (!Number.isFinite(price)) return "—";
  const cents = price * 100;
  const rounded = Math.round(cents * 10) / 10;
  if (rounded === 0 && cents > 0) return "<0.1¢";
  return `${rounded}¢`;
}

export function formatSigned(n: number, decimals = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}`;
}

/**
 * Is this a MEASURED count? A finite number — including a genuine 0 — is
 * reported data; `undefined`/`null`/`NaN` means the platform reported nothing
 * (an RSS feed has no likes), so the UI must show nothing rather than a fake 0.
 */
export function hasCount(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
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
