import "server-only";
import { complete } from "./llm";
import {
  recordMemory,
  type RecordMemoryInput,
} from "./memory-store";
import type { MemoryType } from "@/db/schema";

export type ExtractionContext = {
  // What we're extracting from. Required for the LLM to ground its choices.
  postText: string;
  topic?: string | null;
  // Outcome signal — drives the type/confidence weights.
  //   "posted"           — the writer's own voice; mine for preference/opinion
  //   "skipped"          — user rejected this draft; treat content as anti-pattern
  //   "unapproved"       — auto-approved then user reverted; treat as anti-pattern
  //   "telegram_seed"    — historical sample for voice priming
  outcome: "posted" | "skipped" | "unapproved" | "telegram_seed";
  // Loose link back to the post/generation row this came from.
  sourceId?: string | null;
  // Engagement after a post stabilizes (likes/RT counts). Optional, only
  // included if you re-run extraction after the engagement window.
  engagement?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  } | null;
};

export type ExtractedMemory = {
  type: MemoryType;
  slot: string;
  content: string;
  confidence: number;
};

export type ExtractResult = {
  extracted: ExtractedMemory[];
  recorded: number;
  costUsd: number;
  model: string;
};

const SYSTEM_PROMPT = `You extract durable memories from a single X (Twitter) post by one specific writer (this user). The memories will be fused into the writer's prompt context for future drafts.

WHAT COUNTS AS A MEMORY
- "fact"      → a stable assertion about the writer's world (their tools, projects, role, language, location, identity). Examples: "writes in Russian primarily", "studies at KBTU", "builds AI side-projects".
- "preference"→ a writing/style/behavioral pattern the writer favors. Examples: "ends posts with a single emoji", "uses 'ботать' for grinding tasks", "avoids em-dashes".
- "opinion"   → a stance the writer holds about something in their domain (AI, SWE, startups). Examples: "skeptical of agentic frameworks", "bullish on small models".
- "event"     → a discrete signal-bearing observation. Used for engagement/feedback signals. Examples: "draft about X was approved by user", "post about Y outperformed average".

WHAT DOES NOT COUNT
- The literal text of the post (we already store the post).
- Reactions to other people's tweets that the writer didn't author.
- News, world facts, gossip — only things about THIS writer.
- Restatements of memories already known (the runtime will dedupe; you should still try to be novel).

SLOTS (canonical key, kebab-or-colon)
- Pick a short, stable identifier so future memories can supersede the same slot.
- For facts/preferences, a NEW memory in the same slot REPLACES the old one — so name the slot conservatively (e.g. "voice:emoji_placement", not "voice:emoji_at_end_of_a_tweet").
- For opinions/events, the slot groups but does not deduplicate; multiple stack.

CONFIDENCE (0-100)
- 70 = default, asserted with one supporting observation.
- 90+ = repeated/strong; only if the post unambiguously establishes the memory.
- 40-60 = uncertain inference; only if the signal is faint.

CONSTRAINTS
- Output AT MOST 5 memories. Be selective. Most posts produce 0-2.
- Be specific. "writes well" is not a memory. "ends most posts with a one-word punchline" is.
- For "outcome: skipped" or "unapproved" — extract anti-patterns as type=preference with slot prefixed "avoid:" (e.g. "avoid:topic_politics"), confidence 60-80.

OUTPUT — JSON only, no preamble:
{
  "memories": [
    { "type": "fact"|"preference"|"opinion"|"event", "slot": "<slot>", "content": "<assertion>", "confidence": <0-100> },
    ...
  ]
}
If nothing memorable: { "memories": [] }.`;

function buildUserMessage(ctx: ExtractionContext): string {
  const parts: string[] = [];
  parts.push(`Outcome: ${ctx.outcome}`);
  if (ctx.topic) parts.push(`Original topic / seed: ${ctx.topic}`);
  if (ctx.engagement) {
    parts.push(
      `Engagement: likes=${ctx.engagement.likes ?? 0}, RT=${ctx.engagement.retweets ?? 0}, replies=${ctx.engagement.replies ?? 0}, views=${ctx.engagement.views ?? 0}`,
    );
  }
  parts.push(`Post text:\n${ctx.postText.trim()}`);
  parts.push(`\nExtract durable memories. JSON only.`);
  return parts.join("\n\n");
}

export async function extractMemoriesFromPost(
  ctx: ExtractionContext,
): Promise<ExtractResult> {
  const result = await complete({
    tier: "mid",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(ctx) },
    ],
    maxTokens: 2000,
    responseFormat: "json_object",
  });

  let parsed: { memories?: unknown };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { extracted: [], recorded: 0, costUsd: result.costUsd, model: result.model };
  }

  const raw = Array.isArray(parsed.memories) ? parsed.memories : [];
  const extracted: ExtractedMemory[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const type = i.type;
    if (
      type !== "fact" &&
      type !== "preference" &&
      type !== "opinion" &&
      type !== "event"
    ) {
      continue;
    }
    const slot = typeof i.slot === "string" ? i.slot.trim().slice(0, 80) : "";
    const content = typeof i.content === "string" ? i.content.trim() : "";
    if (!slot || !content) continue;
    const confRaw = typeof i.confidence === "number" ? i.confidence : Number(i.confidence);
    const confidence = Number.isFinite(confRaw)
      ? Math.max(0, Math.min(100, Math.round(confRaw)))
      : 70;
    extracted.push({ type, slot, content, confidence });
  }

  // Persist sequentially — each one may need an advisory lock. Failures of
  // a single insert shouldn't block the rest; collect and continue.
  let recorded = 0;
  const sourceKind =
    ctx.outcome === "telegram_seed"
      ? "telegram_seed"
      : ctx.outcome === "skipped" || ctx.outcome === "unapproved"
        ? "generation_feedback"
        : "post";
  for (const m of extracted) {
    try {
      const input: RecordMemoryInput = {
        type: m.type,
        slot: m.slot,
        content: m.content,
        confidence: m.confidence,
        sourceKind,
        sourceId: ctx.sourceId ?? null,
        metadata: ctx.engagement ? { engagement: ctx.engagement, outcome: ctx.outcome } : { outcome: ctx.outcome },
      };
      await recordMemory(input);
      recorded++;
    } catch (err) {
      console.error("[memory-extract] recordMemory failed:", err);
    }
  }

  return { extracted, recorded, costUsd: result.costUsd, model: result.model };
}
