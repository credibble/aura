import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { HL } from "./kernel.js";
import type { HairlineFigureSpec, HairlineHandle } from "./types";

/** Intensity 0 → 1 to the figure's own number: two straight lines meeting at 0.5 (as the bench does). */
function valueAt([lo, mid, hi]: HairlineFigureSpec["range"], i: number): number {
  const t = Math.min(1, Math.max(0, i));
  const v = t <= 0.5 ? lo + (t / 0.5) * (mid - lo) : mid + ((t - 0.5) / 0.5) * (hi - mid);
  return Math.round(v * 1000) / 1000;
}

type Props = {
  /** A figure module from `./figures` (made with the `hairline-create` skill). */
  figure: HairlineFigureSpec;
  /** 0 (subtle) → 1 (strong). Default 0.5, the figure's own default. */
  intensity?: number;
  /** Walk the figure's tour until a real pointer arrives (resumes when it leaves). */
  play?: boolean;
  /** Accessible name; defaults to the figure's `means`. */
  label?: string;
  /** The figure's caption, each time it changes. */
  onRead?: (text: string) => void;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

/**
 * Mounts one of OUR Hairline figures — the same engine and contract as the
 * `@lucasmarkes/hairline` components (5:4 box, theme from `.dark`, plate and
 * accent from `--hairline-*`, one shared frame loop that sleeps offscreen),
 * for figures drawn with the skill rather than shipped in the package.
 *
 * Server-rendered as an empty 5:4 box, so nothing shifts when it draws.
 */
export function HairlineFigure({
  figure,
  intensity = 0.5,
  play = false,
  label,
  onRead,
  style,
  ...rest
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const handle = useRef<HairlineHandle | null>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  // Mount once per figure. Intensity changes reach it through `set`, below.
  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;
    HL.inject(document);
    stage.setAttribute("data-hairline", figure.name);
    const svg = HL.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
    let text: string | null = null;
    const read = {
      get textContent() {
        return text;
      },
      set textContent(value: string | null) {
        text = value == null ? "" : String(value);
        onReadRef.current?.(text);
      },
    };
    const h = figure.mount({ stage, svg, read }, valueAt(figure.range, intensity));
    handle.current = h;
    return () => {
      h.destroy();
      svg.remove();
      stage.removeAttribute("data-hairline");
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intensity is pushed via `set`
  }, [figure]);

  useEffect(() => {
    handle.current?.set(valueAt(figure.range, intensity));
  }, [figure, intensity]);

  useEffect(() => {
    const stage = ref.current;
    if (!play || !stage) return;
    // Like the package: under reduced motion a playing figure rests.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lap = HL.tour(stage, figure.tour ?? HL.LAP);
    return () => lap.stop();
  }, [figure, play]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label ?? figure.means}
      style={{ display: "block", position: "relative", aspectRatio: "5 / 4", ...style }}
      {...rest}
    />
  );
}
