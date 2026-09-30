/**
 * Scroll sentinel for paginated timelines: observes its own position and
 * fires `onEnd` when it nears the viewport, so a list loads the next page
 * exactly when the reader runs out of content.
 */
import { useEffect, useRef } from "react";

export function InfiniteSentinel({
  ready,
  onEnd,
}: {
  /** False while a fetch is in flight (pauses firing). */
  ready: boolean;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onEnd);
  cb.current = onEnd;

  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready]);

  return <div ref={ref} aria-hidden className="h-px" />;
}
