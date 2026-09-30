import { useState } from "react";
import {
  ArrowRight,
  Coins,
  Heart,
  Lock,
  MessageCircle,
  Repeat2,
  Share2,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar } from "@/components/Avatar";
import { UsdcIcon } from "@/components/aura/UsdcIcon";
import { cn } from "@/lib/utils";

const SLIDES = 6;

/**
 * "How it works" — six slides that describe THIS product: an aura index read
 * from real sources, moving on a clock, traded as YES/NO windows, and staked in
 * $AURA early. The previous copy was lifted from a different app (buzz/virality
 * framing, `$` amounts, no windows, no staking), which is why slide 5 listed
 * dollar values on markets that don't exist here.
 */
export function HowItWorks({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const last = step === SLIDES - 1;

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
        className="w-[min(92vw,380px)] max-w-[380px] gap-0 overflow-hidden rounded-[28px] border-border bg-card p-0 shadow-2xl sm:rounded-[28px]"
        aria-describedby={undefined}
        onKeyDown={(e) => {
          // Arrow keys move through the deck (the dots are buttons, but a
          // carousel that only responds to clicks is a keyboard dead end).
          if (e.key === "ArrowRight") setStep((v) => Math.min(v + 1, SLIDES - 1));
          if (e.key === "ArrowLeft") setStep((v) => Math.max(v - 1, 0));
        }}
      >
        <DialogTitle className="sr-only">How Aura works</DialogTitle>

        <div className="relative h-[300px] overflow-hidden" aria-live="polite">
          {/* Restart each illustration when the step changes. */}
          <div key={step} className="absolute inset-0">
            {step === 0 && <SlideAura />}
            {step === 1 && <SlideSources />}
            {step === 2 && <SlideViral />}
            {step === 3 && <SlideWindow />}
            {step === 4 && <SlideTrade />}
            {step === 5 && <SlideStake />}
          </div>
        </div>

        <div className="px-7 text-center">
          <h2 className="text-[22px] font-bold leading-snug tracking-tight text-foreground">
            {HEADLINES[step]}
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{BODIES[step]}</p>
        </div>

        <div className="flex items-center justify-center gap-1.5 py-5">
          {Array.from({ length: SLIDES }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1} of ${SLIDES}`}
              aria-current={i === step ? "step" : undefined}
              onClick={() => setStep(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/35",
              )}
            />
          ))}
        </div>

        <div className="px-5 pb-5">
          <button
            type="button"
            onClick={() => {
              if (last) {
                setOpen(false);
                setStep(0);
              } else {
                setStep((v) => v + 1);
              }
            }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-primary-foreground transition-all hover:brightness-110"
          >
            {last ? "Start trading" : "Next"}
            {!last && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const HEADLINES = [
  "Every handle has an aura",
  "Read from the real internet",
  "Aura moves in minutes",
  "Every market is one window",
  "Buy YES or NO with USDC",
  "Early? Stake $AURA",
];

const BODIES = [
  "Aura is the internet's read on a handle — one number that moves all day, whether it's a person, a project or a brand.",
  "News feeds, X, YouTube, Reddit and live web search — scored per source, weighted by credibility. Not a poll, not a vibe.",
  "A goal, a launch, a scandal: the index reprices fast, and the market reprices with it.",
  "Windows open on a clock and run 15 minutes to a day. Prices move while it's open, then it freezes at the end and settles on the aura it closed at.",
  "Put USDC in on the outcome you think wins, exit any time the window is open — or hold and claim 1 USDC per winning share.",
  "$AURA holders back a handle early: stake into its vault and earn a cut of every window that settles. The earlier the handle, the bigger the share.",
];

const ORBIT = [
  { Icon: Heart, style: { top: "28%", left: "14%" }, delay: "0s" },
  { Icon: Share2, style: { top: "18%", right: "16%" }, delay: "0.4s" },
  { Icon: MessageCircle, style: { top: "52%", left: "10%" }, delay: "0.8s" },
  { Icon: MessageCircle, style: { top: "38%", right: "12%" }, delay: "1.1s" },
  { Icon: ThumbsUp, style: { bottom: "18%", right: "18%" }, delay: "0.6s" },
  { Icon: Repeat2, style: { top: "12%", left: "38%" }, delay: "1.4s" },
  { Icon: Heart, style: { bottom: "22%", left: "20%" }, delay: "1.8s" },
  { Icon: ThumbsUp, style: { top: "22%", left: "22%" }, delay: "0.2s" },
] as const;

/** Slide 1 — the aura index itself: signal in, one number out. */
function SlideAura() {
  return (
    <div className="relative h-full">
      {ORBIT.map(({ Icon, style, delay }, i) => (
        <span
          key={i}
          className="hiw-float absolute text-muted-foreground/70"
          style={{ ...style, animationDelay: delay }}
        >
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </span>
      ))}
      <div className="absolute left-1/2 top-8 h-[200px] w-8 -translate-x-1/2 overflow-hidden rounded-full bg-secondary ring-1 ring-border">
        <span className="hiw-fill absolute inset-x-0 bottom-0 rounded-full bg-primary" />
      </div>
    </div>
  );
}

const SOURCES = [
  { src: "https://upload.wikimedia.org/wikipedia/commons/6/6f/X_Logo_2023.svg", alt: "X", bg: "bg-foreground", invert: true },
  { src: "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg", alt: "YouTube", bg: "bg-white", invert: false },
  { src: "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png", alt: "Reddit", bg: "bg-[#FF4500]", invert: false },
] as const;

/** Slide 2 — where the read comes from: platforms + the news/web-search feeds. */
function SlideSources() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex w-full items-start justify-center gap-8">
        {SOURCES.map((s) => (
          <div key={s.alt} className="flex flex-col items-center">
            <span
              className={cn(
                "grid h-12 w-12 place-items-center overflow-hidden rounded-2xl shadow-sm",
                s.bg,
              )}
            >
              <img
                src={s.src}
                alt={s.alt}
                className={cn("h-6 w-6 object-contain", s.invert && "invert")}
              />
            </span>
            <span className="h-8 w-px border-l border-dashed border-muted-foreground/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          </div>
        ))}
      </div>
      {/* The other half of the read: real news feeds + live web search. */}
      <div className="hiw-card-in mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {["BBC", "Reuters", "ESPN", "TechCrunch", "CoinDesk", "Billboard"].map((outlet) => (
          <span
            key={outlet}
            className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
          >
            {outlet}
          </span>
        ))}
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
          + live web search
        </span>
      </div>
      <div className="hiw-card-in mt-3 flex w-full max-w-[250px] items-center gap-2.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2.5">
        <Avatar seed="ronaldo" size={36} alt="Example handle" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold">Ronaldo</div>
          <div className="text-[11px] text-muted-foreground">Aura index</div>
        </div>
        <div className="text-right leading-tight">
          <div className="num text-sm font-bold">30.40</div>
          <div className="num text-[11px] font-semibold text-up">+1.20</div>
        </div>
      </div>
    </div>
  );
}

/** Slide 3 — aura repricing upward (a real development lands). */
function SlideViral() {
  return (
    <div className="relative h-full">
      <svg
        viewBox="0 0 380 220"
        className="hiw-chart-reveal absolute inset-x-0 bottom-0 h-[180px] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="hiw-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--up))" stopOpacity="0.45" />
            <stop offset="100%" stopColor="hsl(var(--up))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 150 C 70 158, 130 148, 170 120 C 220 80, 280 28, 380 8 L 380 220 L 0 220 Z"
          fill="url(#hiw-up)"
        />
        <path
          d="M0 150 C 70 158, 130 148, 170 120 C 220 80, 280 28, 380 8"
          fill="none"
          stroke="hsl(var(--up))"
          strokeWidth="3"
        />
      </svg>
      <div className="hiw-viral-face absolute flex flex-col items-center">
        {/* Seeded handle artwork — the same photo the explore grid shows. */}
        <span className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-[24%] ring-2 ring-background">
          <img
            src="https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/Kylian_Mbappe_France_v_Senegal_16_June_2026-391_%28cropped%29.jpg/330px-Kylian_Mbappe_France_v_Senegal_16_June_2026-391_%28cropped%29.jpg"
            alt=""
            className="h-full w-full object-cover"
          />
        </span>
        <span className="h-16 w-px bg-border" />
      </div>
    </div>
  );
}

/** Slide 4 — the clock: one window, YES/NO, freeze at the end. */
function SlideWindow() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-6">
      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5">15-minute window</span>
        <span className="num">12:34 left</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <span className="absolute inset-y-0 left-0 w-[62%] rounded-full bg-primary" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-up/40 bg-up/10 px-3 py-2.5 leading-tight">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-up">YES</span>
            <span className="num text-sm font-bold text-up">62¢</span>
          </div>
          <div className="text-[10px] text-muted-foreground">aura rises</div>
        </div>
        <div className="rounded-2xl border border-down/40 bg-down/10 px-3 py-2.5 leading-tight">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-down">NO</span>
            <span className="num text-sm font-bold text-down">38¢</span>
          </div>
          <div className="text-[10px] text-muted-foreground">aura falls</div>
        </div>
      </div>
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Freezes at the end — then settles on the aura close
      </p>
    </div>
  );
}

const TRADES = [
  {
    seed: "elon", name: "@elon", outcome: "YES", cents: 74, stake: 25, up: true,
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5e/Elon_Musk_-_54820081119_%28cropped%29.jpg/330px-Elon_Musk_-_54820081119_%28cropped%29.jpg",
  },
  {
    seed: "taylor", name: "@taylor", outcome: "NO", cents: 41, stake: 10, up: false,
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b1/Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png/330px-Taylor_Swift_at_the_2023_MTV_Video_Music_Awards_%283%29.png",
  },
  {
    seed: "btc", name: "@btc", outcome: "YES", cents: 56, stake: 100, up: true,
    photo: "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/330px-Bitcoin.svg.png",
  },
];

/** Slide 5 — the ticket: USDC in, shares out (no `$`, no fake dollar values). */
function SlideTrade() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-6">
      {TRADES.map((t, i) => (
        <div
          key={t.seed}
          className="hiw-card-in flex items-center gap-3 rounded-2xl bg-secondary/70 px-3 py-2.5"
          style={{ animationDelay: `${i * 0.12}s` }}
        >
          <Avatar
            seed={t.seed}
            image={t.photo}
            imageFit={t.seed === "btc" ? "contain" : "cover"}
            size={40}
            alt={t.name}
          />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{t.name}</div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className={cn("font-semibold", t.up ? "text-up" : "text-down")}>
                {t.outcome}
              </span>
              @ {t.cents}¢
            </div>
          </div>
          <div className="flex items-center gap-1 leading-tight">
            <UsdcIcon size={12} />
            <span className="num text-sm font-bold">{t.stake}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Slide 6 — early birds stake $AURA and earn the windows' fees. */
function SlideStake() {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-6">
      <div className="hiw-card-in gradient-ring rounded-2xl p-[1.5px]">
        <div className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Coins className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-bold text-foreground">$AURA vault</div>
            <div className="text-[11px] text-muted-foreground">@ronaldo · fees from every window</div>
          </div>
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Early bird
          </span>
        </div>
      </div>

      <div className="hiw-card-in space-y-1.5 rounded-2xl bg-secondary/70 px-3 py-2.5" style={{ animationDelay: "0.12s" }}>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">You stake</span>
          <span className="num font-bold text-foreground">4,200 $AURA</span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Vault share</span>
          <span className="num font-bold text-foreground">1.8%</span>
        </div>
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Earned so far</span>
          <span className="num font-bold text-up">+38.40 $AURA</span>
        </div>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Prices move while the window is open — sell any time, or hold to settlement and claim.
        Staking is never locked to one window.
      </p>
    </div>
  );
}
