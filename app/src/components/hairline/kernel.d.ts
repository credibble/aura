/**
 * Types for the vendored Hairline kernel (kernel.js, generated). Only what the
 * React wrapper calls is typed; figures use the rest from plain JS.
 */
export declare const HL: {
  /** Adds the figures' stylesheet to a document or shadow root, once. */
  inject(root: Document | ShadowRoot): void;
  /** Creates one SVG element with attributes, appended to `parent`. */
  mk(tag: string, attrs: Record<string, string>, parent: Element): SVGSVGElement;
  /** An unseen pointer that walks the stops and gives way to a real one. */
  tour(
    stage: HTMLElement,
    stops: ([number, number] | null)[],
    onStop?: (i: number) => void,
  ): { stop: () => void };
  /** The default stops: a diamond around the centre, then a leave. */
  LAP: ([number, number] | null)[];
  [key: string]: unknown;
};
