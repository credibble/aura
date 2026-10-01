import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * A number field that grows with its content, so a `$` sign sitting beside it
 * stays tight to the placeholder when empty and to the digits when filled —
 * no fixed width, no misaligned prefix. The hidden twin measures the text.
 */
export function AmountInput({
  value,
  onChange,
  placeholder = "0",
  className,
  textClassName,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Applied to the input element (padding, colours, borders). */
  className?: string;
  /** Font size/weight/tracking — MUST match between input and the measurer. */
  textClassName?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const measure = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = measure.current;
    if (!el) return;
    setWidth(Math.ceil(el.getBoundingClientRect().width) + 2);
  }, [value, placeholder, textClassName]);

  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value.replace(/[^0-9.]/g, ""));
  };

  return (
    <span className="relative inline-flex items-center">
      <input
        value={value}
        onChange={handle}
        inputMode="decimal"
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        // `size={1}` caps the pre-hydration intrinsic width at ~1ch; the default
        // 20-char input width is huge at text-5xl and briefly overflowed the
        // page on first paint before the measuring effect set the exact width.
        size={1}
        style={{ width: width || undefined }}
        className={cn(
          "min-w-[1ch] bg-transparent text-center outline-none placeholder:text-muted-foreground/40",
          textClassName,
          className,
        )}
      />
      {/* Same font as the input, so its width is the input's width */}
      <span
        ref={measure}
        aria-hidden="true"
        className={cn(
          "pointer-events-none invisible absolute left-0 top-0 -z-10 whitespace-pre",
          textClassName,
        )}
      >
        {value || placeholder || "0"}
      </span>
    </span>
  );
}
