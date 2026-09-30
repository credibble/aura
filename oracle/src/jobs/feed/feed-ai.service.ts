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
  signals: {
    sourceId: string;
    label: string;
    metrics: { name: string; value: number; delta: number }[];
    /** Verbatim headlines from this source that mention the handle. */
    items?: string[];
  }[];
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
  "RULES: the post is a SUMMARY of everything below — read every source's quotes and write one take that " +
  "covers the story they share; name what actually happened (the match, the launch, the number) and lead with it; " +
  "NEVER copy a headline verbatim and never write \"Outlet: headline\" — that is what the sources said, not your take; " +
  "if the sources disagree or cover different angles, say so; one idea per post; name the handle with @; say AURA — never " +
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
      `News items that mention it: ${input.newItemCount}\n` +
      `Aura change: ${input.auraChange}\n` +
      "What the sources actually published:\n" +
      (input.signals
        .map((s) => {
          const head = `- ${s.label} (${s.sourceId}) → ` +
            s.metrics.map((m) => `${m.name}=${m.value}`).join(", ");
          const quotes = (s.items ?? []).map((t) => `    · "${t}"`).join("\n");
          return quotes ? `${head}\n${quotes}` : head;
        })
        .join("\n") || "nothing yet");

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