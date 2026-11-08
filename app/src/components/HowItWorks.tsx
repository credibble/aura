import { useState, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Relay, Slow, Terrain, Vault } from "@lucasmarkes/hairline/react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HairlineFigure } from "@/components/hairline/HairlineFigure";
import windowFigure from "@/components/hairline/figures/window.js";
import sidesFigure from "@/components/hairline/figures/sides.js";
import { cn } from "@/lib/utils";

/**
 * "How it works" — a six-step field guide to THIS product: an aura index read
 * from real sources, moving on a clock, traded as YES/NO windows, and staked in
 * $AURA early.
 *
 * The layout is a large two-pane stepper: a numbered rail on the left, an
 * editorial pane on the right, and Back/Next chrome underneath. Each step's
 * visual is one Hairline line figure (see "Figures" below): an object you can
 * poke that explains the idea, never a chart with made-up numbers.
 */
export function HowItWorks({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

  const advance = () => setStep((v) => Math.min(v + 1, STEPS.length - 1));
  const back = () => setStep((v) => Math.max(v - 1, 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setStep(0);
      }}
    >
      <DialogTrigger asChild className={className}>
        {children}
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[92vh] w-[min(94vw,1000px)] max-w-[1000px] flex-col gap-0 overflow-hidden rounded-[32px] border-border bg-card p-0 shadow-2xl [&>button]:grid [&>button]:h-9 [&>button]:w-9 [&>button]:place-items-center [&>button>svg]:h-6 [&>button>svg]:w-6"
        aria-describedby={undefined}
        onKeyDown={(e) => {
          // Arrow keys walk the guide; the rail buttons handle the pointer case.
          if (e.key === "ArrowRight") advance();
          if (e.key === "ArrowLeft") back();
        }}
      >
        <DialogTitle className="sr-only">How Aura works</DialogTitle>

        <div className="grid min-h-0 flex-1 grid-cols-[76px_1fr] grid-rows-[minmax(0,1fr)] overflow-hidden sm:grid-cols-[240px_1fr]">
          {/* Rail — where you are in the guide. */}
          <nav
            aria-label="How Aura works steps"
            className="flex flex-col gap-2 overflow-y-auto border-r border-border bg-secondary/40 p-3 sm:p-5"
          >
            {STEPS.map((s, i) => {
              const active = i === step;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={active ? "step" : undefined}
                  aria-label={`Step ${i + 1}: ${s.headline}`}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors sm:px-3 sm:py-3",
                    active
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "num grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[15px] font-bold transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted-foreground/15 text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="hidden truncate text-[17px] font-semibold sm:inline">
                    {s.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Pane — the current step. Re-keyed so its entrance replays. */}
          <section
            key={step}
            className="flex min-h-0 min-w-0 flex-col overflow-y-auto"
            aria-live="polite"
          >
            <div className="flex items-center justify-between pl-8 pr-16 pt-6">
              <span className="text-[13px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Quick tour
              </span>
              <span className="num text-[15px] font-semibold text-muted-foreground">
                {step + 1} / {STEPS.length}
              </span>
            </div>

            <div className="px-8 pt-5">
              <div className="hiw-plate">
                <current.Visual />
              </div>
            </div>

            <div className="px-8 pb-6 pt-6">
              <h2 className="text-[32px] font-bold leading-snug tracking-tight text-foreground">
                {current.headline}
              </h2>
              <p className="mt-3 text-[18px] leading-relaxed text-muted-foreground">
                {current.body}
              </p>
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border p-4 sm:p-5">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="flex items-center gap-2 rounded-full px-4 py-3 text-[17px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Back
          </button>

          <div className="flex items-center gap-1">
            {!last && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setStep(0);
                }}
                className="rounded-full px-4 py-3 text-[17px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (last) {
                  setOpen(false);
                  setStep(0);
                } else {
                  advance();
                }
              }}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[17px] font-bold text-primary-foreground transition-all hover:brightness-110"
            >
              {last ? "Start trading" : "Next"}
              {last ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : (
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

type Visual = () => ReactElement;

const STEPS: {
  label: string;
  headline: string;
  body: string;
  Visual: Visual;
}[] = [
  {
    label: "Aura",
    headline: "Every handle has an aura",
    body: "Aura is the internet's read on a handle — one number that moves all day, whether it's a person, a project or a brand.",
    Visual: AuraVisual,
  },
  {
    label: "Sources",
    headline: "Read from the real internet",
    body: "News feeds, X, YouTube, Reddit and live web search — scored per source, weighted by credibility. Not a poll, not a vibe.",
    Visual: SourcesVisual,
  },
  {
    label: "Cadence",
    headline: "Aura moves in minutes",
    body: "A goal, a launch, a scandal: the index reprices fast, and the market reprices with it.",
    Visual: CadenceVisual,
  },
  {
    label: "Windows",
    headline: "Every market is one window",
    body: "Windows open on a clock and run 15 minutes to a day. Prices move while it's open, then it freezes at the end and settles on the aura it closed at.",
    Visual: WindowsVisual,
  },
  {
    label: "Trade",
    headline: "Buy YES or NO with USDC",
    body: "Put USDC in on the outcome you think wins, exit any time the window is open — or hold and claim 1 USDC per winning share.",
    Visual: TradeVisual,
  },
  {
    label: "Stake",
    headline: "Early? Stake $AURA",
    body: "$AURA holders back a handle early: stake into its vault and earn a cut of every window that settles. The earlier the handle, the bigger the share.",
    Visual: StakeVisual,
  },
];

/* ----------------------------------------------------------------------------
   Figures. Each step is one Hairline line figure that answers the pointer and
   plays its own short lap until a hand arrives — an object for the idea, not a
   chart: nothing here shows a price, a balance or a percentage (those live on
   the market pages). Four come from @lucasmarkes/hairline; the window and the
   YES/NO balance were drawn for Aura with the hairline-create skill
   (app/hairline/*.js → components/hairline/figures).
   -------------------------------------------------------------------------- */

/** The plate a figure sits in: centred, as tall as the plate allows. */
function FigurePlate({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="relative flex h-full items-center justify-center">
      {children}
      {caption && caption !== "rest" && (
        <span className="absolute bottom-0 right-0 rounded-full border border-border bg-card px-3 py-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {caption}
        </span>
      )}
    </div>
  );
}

const FIG = "h-full max-w-full";

/** Step 1 — a field of handles; the one under the pointer rises. */
function AuraVisual() {
  return (
    <FigurePlate>
      <Terrain
        play
        className={FIG}
        label="A field of pillars, one per handle, rising where the pointer is."
      />
    </FigurePlate>
  );
}

/** Step 2 — sources feed the handle, hop by hop. */
function SourcesVisual() {
  return (
    <FigurePlate>
      <Relay
        play
        className={FIG}
        label="A hub with branches of tiles: the path from a source to the hub lights up hop by hop."
      />
    </FigurePlate>
  );
}

/** Step 3 — the clock never stops; hovering slows it so you can read it. */
function CadenceVisual() {
  return (
    <FigurePlate>
      <Slow
        play
        className={FIG}
        label="Crates riding a belt through a gate, always moving; hovering slows the belt."
      />
    </FigurePlate>
  );
}

/** Step 4 — open, frozen, settled: the window as a machine. */
function WindowsVisual() {
  const [caption, setCaption] = useState("rest");
  return (
    <FigurePlate caption={caption}>
      <HairlineFigure
        figure={windowFigure}
        play
        onRead={setCaption}
        className={FIG}
        label="A carriage rides a track to a gate; the gate drops to freeze the window, and the tray past it tips its coin to the settled side."
      />
    </FigurePlate>
  );
}

/** Step 5 — pick a side; coins drop into that pan and it tips. */
function TradeVisual() {
  const [caption, setCaption] = useState("rest");
  return (
    <FigurePlate caption={caption}>
      <HairlineFigure
        figure={sidesFigure}
        play
        onRead={setCaption}
        className={FIG}
        label="A two-pan balance, YES and NO: coins drop into the side you pick and the beam tips toward it."
      />
    </FigurePlate>
  );
}

/** Step 6 — stake into a handle's vault. */
function StakeVisual() {
  return (
    <FigurePlate>
      <Vault play className={FIG} label="A vault door: turning the dial draws its bolts back." />
    </FigurePlate>
  );
}
