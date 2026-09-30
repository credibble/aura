import { Injectable } from "@nestjs/common";
import { StructuredAiService } from "../ai/structured-ai.service";
import type { FeedEventKind } from "@aura/contracts";

export interface FeedDraft {
  kind: FeedEventKind;
  title: string;
  body: string;
  change: number;
}

export interface FeedInput {
  handleLabel: string;
  signals: { sourceId: string; label: string; metrics: { name: string; value: number; delta: number }[] }[];
  newItemCount: number;
  auraChange: number;
}

const KINDS: FeedEventKind[] = ["shock", "velocity", "trend", "settle", "new"];

const SYSTEM_PROMPT =
  "You write the Aura feed: short, extremely-online, Gen Z / internet-culture posts about prediction handles.\n" +
  "VOICE: casual, clipped, lowercase, slang-first — \"cooked\", \"aura\", \"it's giving\", \"no cap\", \"ate\", " +
  "\"mid\", \"delulu\", \"rent free\", \"caught in 4k\", \"main character\", \"ratio\", \"W/L\", \"lowkey/highkey\", " +
  "\"fr\", \"iykyk\", \"glazing\", \"yapping\", \"ate and left no crumbs\". Funny, a little unhinged, zero cringe. " +
  "Never corporate, never a press release, no em-dashes.\n" +
  "RULES: one idea per post; lead with the number that moved; name the handle with @; say AURA — never " +
  "attention, engagement, clicks or trend-metrics; 0-2 emojis, no hashtag spam; NEVER invent an event, quote, " +
  "source or number that is not in the input, and never turn a weak/flat signal into hype (if it is quiet, say it is quiet).\n" +
  'Reply with ONLY JSON: {"title": string (<90 chars — the hook), "body": string (<280 chars — the take), ' +
  '"kind": "shock"|"velocity"|"trend"|"settle"|"new", "change": number}. ' +
  '"change" is the aura change (1e2 scale) you expect, matching the delta in the input.\n' +
  'EXAMPLE OF THE VOICE ONLY (do not reuse its facts): {"title":"@drake went quiet and the feed noticed",' +
  '"body":"no fresh signal from any source this window — aura flat, tape thin, everyone yapping for nothing. ' +
  'boring but honest 🥱","kind":"new","change":0}';

/** The AI drafts one feed post per handle; the service sanitizes the reply. */
@Injectable()
export class FeedAiService {
  constructor(private readonly ai: StructuredAiService) {}

  async build(input: FeedInput, fallback: FeedDraft): Promise<FeedDraft> {
    const user =
      `Handle: @${input.handleLabel}\n` +
      `New source items: ${input.newItemCount}\n` +
      `Aura change: ${input.auraChange}\n` +
      `Signals:\n` +
      input.signals
        .map(
          (s) =>
            `- ${s.label} (${s.sourceId}) → ` +
            s.metrics.map((m) => `${m.name}=${m.value} (Δ${m.delta})`).join(", "),
        )
        .join("\n") || "no signals";

    // Write the post in the community's voice, from the numbers only.
    const reply = await this.ai.completeJson<Record<string, unknown>>(
      SYSTEM_PROMPT,
      `${user}\n\nWrite the post now. Stay in voice, stay factual — the numbers above are the whole story.`,
      {
        title: fallback.title,
        body: fallback.body,
        kind: fallback.kind,
        change: fallback.change,
      },
    );

    const kind = (typeof reply?.kind === "string" && KINDS.includes(reply.kind as FeedEventKind)
      ? (reply.kind as FeedEventKind)
      : fallback.kind) as FeedEventKind;
    const change = typeof reply?.change === "number" ? Math.round(reply.change) : fallback.change;
    return {
      kind,
      title: clean(reply?.title, fallback.title, 90),
      body: clean(reply?.body, fallback.body, 280),
      change,
    };
  }
}

function clean(value: unknown, fallback: string, max: number): string {
  const s = typeof value === "string" ? value : fallback;
  return s.slice(0, max);
}