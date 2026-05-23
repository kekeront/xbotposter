import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type QrtInput = {
  viralText: string;
  viralAuthor: string;
  userAngle?: string | null;
  referenceTweets?: string[];
  fingerprintBlock?: string;
  memoryBlock?: string;
};

export type QrtOutput = {
  text: string;
  skipped: boolean;
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
- Add ONE thing: a calibrating observation, a missing nuance, a constructive counter-frame, or a pithy synthesizing line.
- If the user supplies an angle, use it directly.

LANGUAGE — Russian by default, light EN/KZ code-switch. Pure English only if seed angle is pure English.

VOICE — anchor is TONE ONLY. Match register/rhythm, not topics.

STANCE — OPTIMIST + ANALYST (CRITICAL FOR QRTs)
The QRT line is publicly attached to the original author. The bar for
tone is very high:
- Constructive, analytical, opportunity-framed.
- No mocking, no dunking, no schadenfreude, no doom, no "I told you so".
- Critique mechanism, not person/company/community. Never attack the
  author of the quoted tweet — explicit OR implicit.
- Disagreement only if reasoned and specific (the missing trade-off,
  the missing data-point). Not "это бред" / "ну такое".
- Default to "интересно тут что…" / "трейд-офф в…" / "ещё угол — …".
- If you cannot find a constructive line in under 140 chars, output
  the literal string SKIP and nothing else.

LENGTH — VERY SHORT. Aim 30-140 characters. Hard max 260. The original is the substance; your line is the spin.

OUTPUT FORMAT — single line. No quotes around it. No prefix/label. No "QRT:" or ">". Just the commentary text.`;

function buildMessages(input: QrtInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (input.fingerprintBlock) {
    messages.push({ role: "system", content: input.fingerprintBlock });
  }

  if (input.memoryBlock && input.memoryBlock.trim().length > 0) {
    messages.push({ role: "system", content: input.memoryBlock });
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

  const text = result.text.trim();
  const skipped = text.toUpperCase() === "SKIP";

  return {
    text,
    skipped,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
