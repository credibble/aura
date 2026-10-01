import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// In-app scrollers with no visible scrollbar. Instead of a thumb, the content
// fades out at whichever end still has hidden overflow, horizontal tab rows
// get ‹ › angle arrows to page through, and the active tab self-centers in
// the viewport so the current selection is never stuck half off-screen.
// ---------------------------------------------------------------------------

const FADE = 28;

type Edges = { start: boolean; end: boolean };

/** Edge-fade mask — only fades the side(s) that actually hide content. */
function edgeMask(edges: Edges, axis: "x" | "y"): CSSProperties | undefined {  if (!edges.start && !edges.end) return undefined;
  const stops = [
    edges.start ? `transparent 0px` : `black 0px`,
    edges.start ? `black ${FADE}px` : null,
    edges.end ? `black calc(100% - ${FADE}px)` : `black 100%`,
    edges.end ? `transparent 100%` : null,
  ].filter(Boolean);
  const image = `linear-gradient(to ${axis === "x" ? "right" : "bottom"}, ${stops.join(", ")})`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
  };
}

function useEdges(axis: "x" | "y") {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const pos = axis === "x" ? el.scrollLeft : el.scrollTop;
    const max = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    setEdges((prev) => {
      const next = { start: pos > 1, end: max > 1 && pos < max - 1 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, [axis]);

  // Re-measure after every render (children can appear/change size).
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [measure]);

  return { ref, edges, measure };
}

function RowArrow({
  side,
  onClick,
  className,
}: {
  side: "start" | "end";
  onClick: () => void;
  className?: string;
}) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "start" ? "Scroll left" : "Scroll right"}
      className={cn(
        // The pill keeps a border + fill (they carry the hit area); the drop
        // shadow was a third signal on a 32px control.
        "absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border bg-background/90 text-foreground backdrop-blur transition-colors hover:bg-secondary",
        side === "start" ? "left-0.5" : "right-0.5",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/**
 * ‹ › arrows are a mouse affordance — paging a rail by clicking. Touch users
 * already swipe, so on a coarse/no-hover pointer they would be dead controls
 * parked over the chips. Render them only where a fine pointer can click them.
 */
function useHasFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return fine;
}

/**
 * Horizontal tab/chip row: scrollbar hidden, momentum on touch, ends fade
 * while content is hidden, ‹ › arrows (fine pointers only) page through, and
 * the `[data-active="true"]` child is centered whenever `activeKey` changes.
 *
 * `className` styles the scrolling content box (gap, padding, the `-mx-* px-*`
 * edge bleed); `wrapperClassName` styles the outer box, which is the flex item
 * in a flex parent — it needs `min-w-0` (built in) plus `flex-1` to shrink and
 * scroll instead of pushing the row past its container.
 */
export function ScrollRow({
  children,
  className,
  wrapperClassName,
  activeKey,
  ariaLabel,
}: {
  children: ReactNode;
  /** Scroller content box (gap/padding/edge bleed). */
  className?: string;
  /** Outer box — set `flex-1` (and any align) when the row is a flex child. */
  wrapperClassName?: string;
  /** Marker for the current tab — the row scrolls it into the center. */
  activeKey?: string;
  ariaLabel?: string;
}) {
  const { ref, edges, measure } = useEdges("x");
  const finePointer = useHasFinePointer();

  // Self-center the active tab (clamped to the row start for first items).
  // `offsetLeft` is relative to the wrapper, so subtract the scroller's own
  // offset to get the chip's position inside the content (the bleed slides it
  // negative when the content box is wider than the wrapper).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !activeKey) return;
    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    const centered = active.offsetLeft - el.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    const left = Math.min(max, Math.max(0, centered));
    if (Math.abs(el.scrollLeft - left) < 1) return;
    el.scrollLeft = left;
    measure();
  }, [activeKey, ref, measure]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollLeft += dir * Math.round(el.clientWidth * 0.7);
    measure();
  };

  return (
    // `min-w-0` on the wrapper: as a flex child the row must be allowed to
    // shrink below its content's width, or the intrinsic width of the tabs wins
    // and the whole bar overflows the viewport at tablet widths.
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <div
        ref={ref}
        onScroll={measure}
        aria-label={ariaLabel}
        style={edgeMask(edges, "x")}
        className={cn(
          "scrollbar-hide scroll-rail flex flex-nowrap items-center gap-2 overflow-x-auto",
          className,
        )}
      >
        {children}
      </div>
      {finePointer && edges.start && <RowArrow side="start" onClick={() => page(-1)} />}
      {finePointer && edges.end && <RowArrow side="end" onClick={() => page(1)} />}
    </div>
  );
}

/** Vertical panel scroller: scrollbar hidden, top/bottom ends fade. */
export function FadeBox({ children, className }: { children: ReactNode; className?: string }) {
  const { ref, edges, measure } = useEdges("y");
  return (
    <div
      ref={ref}
      onScroll={measure}
      style={edgeMask(edges, "y")}
      className={cn("scrollbar-hide overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}
