import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Repeat2,
  Share2,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";

const SLIDES = 5;

/**
 * Illustrated "How it works" carousel — 5 slides matching the onboarding
 * modal: meter, sources, viral spike, quiet drop, then trade.
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
      >
        <DialogTitle className="sr-only">How Aura works</DialogTitle>

        <div className="relative h-[300px] overflow-hidden">
          {/* Restart each illustration when the step changes. */}
          <div key={step} className="absolute inset-0">
            {step === 0 && <SlideMeter />}
            {step === 1 && <SlideSources />}
            {step === 2 && <SlideViral />}
            {step === 3 && <SlideQuiet />}
            {step === 4 && <SlideTrade />}
          </div>
        </div>

        <h2 className="px-7 text-center text-[22px] font-bold leading-snug tracking-tight text-foreground">
          {HEADLINES[step]}
        </h2>

        <div className="flex items-center justify-center gap-1.5 py-5">
          {Array.from({ length: SLIDES }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Slide ${i + 1}`}
              onClick={() => setStep(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === step ? "w-1.5 bg-foreground" : "w-1.5 bg-muted-foreground/35",
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
            className="h-12 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-all hover:brightness-110"
          >
            {last ? "Understood" : "Next"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const HEADLINES = [
  "Aura Index tracks online buzz",
  "It pulls data from X, Reddit, and YouTube",
  "It spikes when things go viral",
  "It drops when things go quiet",
  "Trade what people talk about — and profit when you're right",
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

function SlideMeter() {
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

const SOURCE_LOGOS = [
  {
    src: "https://upload.wikimedia.org/wikipedia/commons/6/6f/X_Logo_2023.svg",
    alt: "X",
    bg: "bg-foreground",
    invert: true,
    line: "h-16",
  },
  {
    src: "https://www.redditstatic.com/desktop2x/img/favicon/android-icon-192x192.png",
    alt: "Reddit",
    bg: "bg-[#FF4500]",
    invert: false,
    line: "h-10",
  },
  {
    src: "https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg",
    alt: "YouTube",
    bg: "bg-white",
    invert: false,
    line: "h-6",
  },
] as const;

function SlideSources() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="flex w-full items-start justify-center gap-8">
        {SOURCE_LOGOS.map((s) => (
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
            <span
              className={cn("w-px border-l border-dashed border-muted-foreground/40", s.line)}
            />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
          </div>
        ))}
      </div>
      <div className="hiw-card-in mt-3 flex w-full max-w-[240px] items-center gap-2.5 rounded-2xl border border-border bg-secondary/70 px-3 py-2.5">
        <Avatar seed="elon" size={36} alt="Example handle" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold">Elon Musk</div>
          <div className="text-[11px] text-muted-foreground">Aura Index</div>
        </div>
        <div className="text-right leading-tight">
          <div className="num text-sm font-bold">71.81</div>
          <div className="num text-[11px] font-semibold text-up">+2.59%</div>
        </div>
      </div>
    </div>
  );
}

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
        <Avatar seed="elon" size={72} alt="" className="ring-2 ring-background" />
        <span className="h-16 w-px bg-border" />
      </div>
    </div>
  );
}

function SlideQuiet() {
  return (
    <div className="relative h-full">
      <svg
        viewBox="0 0 380 180"
        className="hiw-chart-reveal absolute inset-x-0 bottom-0 h-[150px] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="hiw-dn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--down))" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(var(--down))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 40 C 80 50, 160 90, 240 120 C 300 145, 340 155, 380 162 L 380 180 L 0 180 Z"
          fill="url(#hiw-dn)"
        />
        <path
          d="M0 40 C 80 50, 160 90, 240 120 C 300 145, 340 155, 380 162"
          fill="none"
          stroke="hsl(var(--down))"
          strokeWidth="3"
        />
      </svg>
      <div className="hiw-quiet-face absolute flex flex-col items-center">
        <Avatar seed="quiet" size={72} alt="" className="ring-2 ring-background" />
        <span className="h-20 w-px bg-border" />
      </div>
    </div>
  );
}

const TRADES = [
  { seed: "drake", name: "Drake", dir: "Down" as const, value: "$350", change: "+2.5%", up: true },
  {
    seed: "taylor",
    name: "Taylor Swift",
    dir: "Down" as const,
    value: "$280",
    change: "-7.3%",
    up: false,
  },
  {
    seed: "solana",
    name: "Solana",
    dir: "Up" as const,
    value: "$920",
    change: "+14.4%",
    up: true,
  },
];

function SlideTrade() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-6">
      {TRADES.map((t, i) => (
        <div
          key={t.seed}
          className="hiw-card-in flex items-center gap-3 rounded-2xl bg-secondary/70 px-3 py-2.5"
          style={{ animationDelay: `${i * 0.12}s` }}
        >
          <Avatar seed={t.seed} size={40} alt={t.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-bold">{t.name}</div>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {t.dir === "Up" ? (
                <TrendingUp className="h-3 w-3 text-up" />
              ) : (
                <TrendingDown className="h-3 w-3 text-down" />
              )}
              {t.dir}
            </div>
          </div>
          <div className="text-right leading-tight">
            <div className="num text-sm font-bold">{t.value}</div>
            <div className={cn("num text-[11px] font-semibold", t.up ? "text-up" : "text-down")}>
              {t.change}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
