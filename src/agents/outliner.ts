import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type OutlineInput = {
  topic: string;
  referenceTweets?: string[];
  fingerprintBlock?: string;
};

export type OutlineOutput = {
  beats: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `Outline a Twitter thread of 3-7 posts.

Each beat is ONE LINE describing the core claim or move of that post. Beats together should:
- Have a clear sequence (open → develop → close)
- Be distinct (no two beats are the same point)
- Open with the strongest, attention-grabbing claim (NOT a question, NOT "here's the truth")
- Close with a concrete takeaway (NOT a tricolon, NOT a hashtag, NOT "thoughts?")

OUTPUT FORMAT — JSON only:
{
  "beats": ["<beat 1>", "<beat 2>", "<beat 3>", ...]
}
- 3 to 7 beats.
- Each beat is short (5-15 words).
- Russian by default (light EN/KZ for tech terms).
- No preamble, no markdown, no code fences.`;

function buildMessages(input: OutlineInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  if (input.fingerprintBlock) {
    messages.push({ role: "system", content: input.fingerprintBlock });
  }
  const refs = (input.referenceTweets ?? []).slice(0, 8);
  if (refs.length > 0) {
    messages.push({
      role: "system",
      content: `VOICE ANCHOR (tone only, not content):\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }
  messages.push({
    role: "user",
    content: `Topic / idea:\n${input.topic.trim()}\n\nOutline 3-7 beats. JSON only.`,
  });
  return messages;
}

export async function outline(input: OutlineInput): Promise<OutlineOutput> {
  const result = await complete({
    tier: "mid",
    messages: buildMessages(input),
    maxTokens: 800,
    responseFormat: "json_object",
  });

  let parsed: { beats?: unknown };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return {
      beats: [],
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  const beats = Array.isArray(parsed.beats)
    ? parsed.beats
        .map((b) => (typeof b === "string" ? b.trim() : ""))
        .filter(Boolean)
        .slice(0, 7)
    : [];

  return {
    beats,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
