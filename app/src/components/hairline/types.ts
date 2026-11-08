/** What a figure's `mount` is handed — the same three things the skill's bench gives it. */
export type HairlineStage = {
  stage: HTMLElement;
  svg: SVGSVGElement;
  /** The caption. Figures write a few characters here (`open`, `yes`, `rest`). */
  read: { textContent: string | null };
};

/** A running figure. `set` takes the figure's own number, on its `range`. */
export type HairlineHandle = { set: (value: number) => void; destroy: () => void };

/** A custom figure, as the `hairline-create` skill declares it (`hairline({ … })`). */
export type HairlineFigureSpec = {
  name: string;
  /** One sentence saying what the figure shows — the default accessible name. */
  means: string;
  rules: number[];
  /** The figure's number at intensity 0, 0.5 and 1. */
  range: [number, number, number];
  /** viewBox stops the unseen pointer walks when the figure plays; `null` leaves. */
  tour: ([number, number] | null)[] | null;
  mount: (stage: HairlineStage, value: number) => HairlineHandle;
};
