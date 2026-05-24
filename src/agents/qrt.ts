import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type QrtInput = {
  viralText: string;
  viralAuthor: string;
  userAngle?: string | null;
  referenceTweets?: string[];
  fingerprintBlock?: string;
  memoryBlock?: string;
  researchBlock?: string;
};

export type QrtOutput = {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are writing the commentary line that sits ON TOP of a quote retweet (QRT). The original tweet will appear under your line — you are NOT writing the tweet text again.

CORE PRINCIPLE — COMMENTARY, NOT RESTATEMENT
- One short line of commentary. The reader sees the original right below.
- DO NOT paraphrase, summarize, or restate the original.
- DO NOT @mention the author (they're already attributed in the QRT).
- Add ONE thing: a sharp reaction, a contrary view, a missing nuance, a punchline, or a pithy frame.
- If the user supplies an angle, use it directly.

LANGUAGE — Russian by default, light EN/KZ code-switch. Pure English only if seed angle is pure English.

VOICE — anchor is TONE ONLY. Match register/rhythm, not topics.

LENGTH — VERY SHORT. Aim 30-140 characters. Hard max 260. The original is the substance; your line is the spin.

OUTPUT FORMAT — single line. No quotes around it. No prefix/label. No "QRT:" or ">". Just the commentary text.`;

function buildMessages(input: QrtInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (input.fingerprintBlock) {
    messages.push({ role: "system", content: input.fingerprintBlock });
  }

  if (input.memoryBlock && input.memoryBlock.trim()) {
    messages.push({
      role: "system",
      content: `MEMORY — known facts and recent activity for this account. Use to avoid contradicting past stances on @${input.viralAuthor} or the topic.\n\n${input.memoryBlock.trim()}`,
    });
  }

  if (input.researchBlock && input.researchBlock.trim()) {
    messages.push({
      role: "system",
      content: `RESEARCH — verified facts from web sources. You MAY reference a concrete detail to make your commentary sharper. Keep it very short — one fact at most.\n\n${input.researchBlock.trim()}`,
    });
  }

  const refs = (input.referenceTweets ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (refs.length > 0) {
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — TONE REFERENCE ONLY.\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  const anglePart = input.userAngle
    ? `\n\nYour angle: ${input.userAngle.trim()}`
    : "";

  messages.push({
    role: "user",
    content: `Original tweet by @${input.viralAuthor} (will appear under your line):\n"${input.viralText.trim()}"${anglePart}\n\nWrite the QRT commentary line.`,
  });

  return messages;
}

export async function draft(input: QrtInput): Promise<QrtOutput> {
  const result = await complete({
    tier: "writer",
    messages: buildMessages(input),
    maxTokens: 500,
  });

  return {
    text: result.text.trim(),
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
