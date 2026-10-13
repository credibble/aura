import { useState, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Coins, Lock, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar } from "@/components/Avatar";
import { UsdcIcon } from "@/components/aura/UsdcIcon";
import { cn } from "@/lib/utils";

/**
 * "How it works" — a six-step field guide to THIS product: an aura index read
 * from real sources, moving on a clock, traded as YES/NO windows, and staked in
 * $AURA early.
 *
 * The layout is a large two-pane stepper: a numbered rail on the left, an
 * editorial pane on the right, and Back/Next chrome underneath. Each diagram is
 * built from plain shapes and the app's own tokens, so the guide belongs to this
 * codebase rather than reading as borrowed.
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
   Diagrams. Every one is drawn from the app's own tokens (primary / up / down /
   secondary / border) so the guide looks like the rest of the product, and each
   enters with the shared `.hiw-rise` stagger instead of bespoke motion.
   -------------------------------------------------------------------------- */

/** Step 1 — signal in, one number out. */
function AuraVisual() {
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex h-full items-center justify-center gap-10">
      <div className="relative h-[240px] w-[240px]">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="9" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * 0.38}
            className="hiw-arc"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center leading-none">
            <div className="num text-5xl font-bold text-foreground">30.4</div>
            <div className="num mt-2 text-xl font-semibold text-up">+1.20</div>
          </div>
        </div>
      </div>
      <ul className="space-y-4 text-lg font-medium text-muted-foreground">
        <LegendDot className="bg-primary" label="one number" />
        <LegendDot className="bg-up" label="moves all day" />
        <LegendDot className="bg-muted-foreground/50" label="per handle" />
      </ul>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} />
      {label}
    </li>
  );
}

const PLATFORM_SOURCES = [
  { src: "/platforms/x.svg", alt: "X" },
  { src: "/platforms/youtube.svg", alt: "YouTube" },
  { src: "/platforms/reddit.svg", alt: "Reddit" },
  { src: "/platforms/rss.svg", alt: "RSS" },
] as const;

/** Step 2 — many feeds in, one scored index out. */
function SourcesVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-5">
      <div className="flex items-center gap-3">
        {PLATFORM_SOURCES.map((s, i) => (
          <span
            key={s.alt}
            className="hiw-rise grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-border bg-card"
            style={{ animationDelay: `${i * 0.07}s` }}
          >
            <img src={s.src} alt={s.alt} className="h-8 w-8 object-contain" />
          </span>
        ))}
        <span className="mx-2 h-px flex-1 bg-border" />
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="h-7 w-7" aria-hidden="true" />
        </span>
      </div>

      <div
        className="hiw-rise flex flex-wrap items-center gap-2"
        style={{ animationDelay: "0.24s" }}
      >
        {["BBC", "Reuters", "ESPN", "CoinDesk"].map((outlet) => (
          <span
            key={outlet}
            className="rounded-full border border-border px-3 py-1 text-base font-semibold text-muted-foreground"
          >
            {outlet}
          </span>
        ))}
        <span className="rounded-full bg-primary/15 px-3 py-1 text-base font-semibold text-primary">
          + live web search
        </span>
      </div>

      <div
        className="hiw-rise flex items-center gap-4 rounded-2xl border border-border bg-secondary/60 px-4 py-3"
        style={{ animationDelay: "0.34s" }}
      >
        <Avatar seed="ronaldo" size={48} alt="" />
        <span className="truncate text-lg font-bold text-foreground">Ronaldo</span>
        <span className="num ml-auto text-lg font-bold text-foreground">30.40</span>
        <span className="num text-base font-semibold text-up">+1.20</span>
      </div>
    </div>
  );
}

/** Step 3 — a real development lands and the index reprices, fast. */
function CadenceVisual() {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold text-muted-foreground">Aura index</span>
        <span className="num text-base font-semibold text-up">+8.4% today</span>
      </div>
      <svg
        viewBox="0 0 300 110"
        className="mt-3 h-[190px] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="hiw-cad-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--up))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="hsl(var(--up))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 88 C 40 92, 70 86, 96 74 C 128 60, 150 34, 186 26 C 220 18, 250 16, 300 8 L 300 110 L 0 110 Z"
          fill="url(#hiw-cad-fill)"
        />
        <path
          d="M0 88 C 40 92, 70 86, 96 74 C 128 60, 150 34, 186 26 C 220 18, 250 16, 300 8"
          fill="none"
          stroke="hsl(var(--up))"
          strokeWidth="2.5"
          className="hiw-draw"
        />
      </svg>
      <div className="mt-2 flex items-center justify-between text-sm font-semibold text-muted-foreground">
        <span>09:12</span>
        <span>09:20</span>
        <span>09:34</span>
      </div>
    </div>
  );
}

/** Step 4 — a window on a clock: open, price, freeze, settle. */
function WindowsVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-5">
      <div className="flex items-center justify-between text-base font-semibold text-muted-foreground">
        <span className="rounded-full bg-secondary px-3 py-1 text-foreground">
          15-minute window
        </span>
        <span className="num">12:34 left</span>
      </div>

      <div className="relative h-3.5 w-full rounded-full bg-secondary">
        <span className="hiw-sweep absolute inset-y-0 left-0 w-[62%] rounded-full bg-primary" />
        <span className="absolute -top-1 left-[62%] grid h-4 w-4 -translate-x-1/2 place-items-center">
          <span className="hiw-ping absolute h-4 w-4 rounded-full bg-primary/40" />
          <span className="h-2.5 w-2.5 rounded-full border-2 border-card bg-primary" />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <OutcomeChip outcome="YES" side="up" cents={62} detail="aura rises" />
        <OutcomeChip outcome="NO" side="down" cents={38} detail="aura falls" />
      </div>

      <p className="flex items-center justify-center gap-2 text-base text-muted-foreground">
        <Lock className="h-5 w-5" aria-hidden="true" />
        Freezes at the end — then settles on the aura close
      </p>
    </div>
  );
}

function OutcomeChip({
  outcome,
  side,
  cents,
  detail,
}: {
  outcome: string;
  side: "up" | "down";
  cents: number;
  detail: string;
}) {
  const tone =
    side === "up" ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down";
  return (
    <div className={cn("rounded-2xl border px-5 py-4 leading-tight", tone)}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold">{outcome}</span>
        <span className="num text-2xl font-bold">{cents}¢</span>
      </div>
      <div className="text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}

const TRADES = [
  {
    seed: "elon",
    handle: "@elon",
    outcome: "YES",
    cents: 74,
    stake: 25,
    up: true,
    photo:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/330px-Elon_Musk_-_54820081119_%28cropped%29.jpg",
  },
  {
    seed: "taylor",
    handle: "@taylor",
    outcome: "NO",
    cents: 41,
    stake: 10,
    up: false,
    photo:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png/330px-Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png",
  },
  {
    seed: "btc",
    handle: "@btc",
    outcome: "YES",
    cents: 56,
    stake: 100,
    up: true,
    photo:
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/330px-Bitcoin.svg.png",
  },
] as const;

/** Step 5 — a ticket: USDC in on an outcome, shares out. */
function TradeVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      {TRADES.map((t, i) => (
        <div
          key={t.seed}
          className="hiw-rise flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3"
          style={{ animationDelay: `${i * 0.09}s` }}
        >
          <Avatar
            seed={t.seed}
            image={t.photo}
            imageFit={t.seed === "btc" ? "contain" : "cover"}
            size={48}
            alt={t.handle}
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-lg font-bold text-foreground">{t.handle}</div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("font-bold", t.up ? "text-up" : "text-down")}>{t.outcome}</span>
              <span className="num">@ {t.cents}¢</span>
            </div>
          </div>
          <span className="flex items-center gap-1.5">
            <UsdcIcon size={16} />
            <span className="num text-lg font-bold text-foreground">{t.stake}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Step 6 — back a handle early; earn a cut of every window it settles. */
function StakeVisual() {
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="hiw-rise flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Coins className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-lg font-bold text-foreground">$AURA vault</div>
          <div className="truncate text-sm text-muted-foreground">
            @ronaldo · fees from every window
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Early bird
        </span>
      </div>

      <div
        className="hiw-rise space-y-2.5 rounded-2xl border border-border bg-secondary/60 px-5 py-4"
        style={{ animationDelay: "0.12s" }}
      >
        <StatRow label="You stake" value="4,200 $AURA" />
        <StatRow label="Vault share" value="1.8%" />
        <StatRow label="Earned so far" value="+38.40 $AURA" tone="up" />
      </div>
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone?: "up" }) {
  return (
    <div className="flex items-center justify-between text-lg">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("num font-bold", tone === "up" ? "text-up" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}
