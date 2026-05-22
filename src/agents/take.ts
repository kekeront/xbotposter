import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type TakeInput = {
  viralText: string;
  viralAuthor: string;
  userAngle?: string | null;
  contentType?: "single" | "thread";
  referenceTweets?: string[];
};

export type TakeOutput = {
  texts: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are writing YOUR OWN tweet in reaction to a viral post you just read. This is a TAKE — your opinion or angle, not a summary or paraphrase.

CORE PRINCIPLE — YOUR ANGLE
- Add something the original didn't say: a contrarian view, a missing nuance, a specific concrete observation, a counter-claim, a "yes and…" extension.
- DO NOT paraphrase or summarize the original.
- DO NOT quote the author directly or restate their thesis.
- DO NOT @mention the author. (This is your tweet, standalone.)
- If the user provides their own angle, build the take around that angle exactly.
- If the user provides no angle, find the most interesting non-obvious thing to add.

LANGUAGE — Russian by default, light EN/KZ code-switch (same rules as the writer agent). Pure English only if the seed angle is itself pure English.

VOICE — same anchor rules: anchor is TONE ONLY, not content. Match rhythm, register, language-mix, emoji habits. Do not borrow topics, names, hobbies, brands, or vocabulary from the anchor.

LENGTH
- Single: 60-220 characters.
- Thread: 3-5 posts, each within the same range.

OUTPUT FORMAT — only the take text. No quotes around it, no preamble, no labels.
For threads, separate posts with a single line containing exactly: ---
Do not number the posts.`;

function buildMessages(input: TakeInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  const refs = (input.referenceTweets ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (refs.length > 0) {
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — TONE REFERENCE ONLY, NOT CONTENT.\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  const contentType = input.contentType ?? "single";
  const formatLine =
    contentType === "thread"
      ? "Write a thread of 3-5 posts expressing your take."
      : "Write a single tweet expressing your take.";

  const anglePart = input.userAngle
    ? `\n\nYour angle (build the take around this):\n${input.userAngle.trim()}`
    : `\n\n(No angle provided — find the most interesting non-obvious thing to add.)`;

  messages.push({
    role: "user",
    content: `Viral post by @${input.viralAuthor}:\n"${input.viralText.trim()}"${anglePart}\n\n${formatLine}`,
  });

  return messages;
}

function splitThread(raw: string): string[] {
  return raw
    .split(/^---\s*$/m)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function draft(input: TakeInput): Promise<TakeOutput> {
  const result = await complete({
    tier: "writer",
    messages: buildMessages(input),
    maxTokens: 1500,
  });

  const texts =
    input.contentType === "thread"
      ? splitThread(result.text)
      : [result.text.trim()];

  return {
    texts,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
