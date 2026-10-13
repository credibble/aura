import { cn } from "@/lib/utils";

/** Official USDC mark, vendored locally (was a hot-linked Wikimedia URL). */
export const USDC_LOGO = "/tokens/usdc.svg";

/**
 * The USDC mark — used instead of a bare `$` next to amounts, so a figure reads
 * as USDC rather than "some dollars".
 */
export function UsdcIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <img
      src={USDC_LOGO}
      alt="USDC"
      width={size}
      height={size}
      loading="lazy"
      className={cn("inline-block shrink-0 select-none rounded-full", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * An amount with the USDC mark in front of it. `value` must be the number part
 * only (use `formatUsd`), so the icon replaces every `$`.
 */
export function UsdcAmount({
  value,
  size = 14,
  className,
  iconClassName,
}: {
  value: string;
  size?: number;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("num inline-flex items-center gap-1", className)}>
      <UsdcIcon size={size} className={iconClassName} />
      {value}
    </span>
  );
}
