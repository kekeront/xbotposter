import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type WriterInput = {
  topic: string;
  contentType?: "single" | "thread";
  referenceTweets?: string[];
};

export type WriterOutput = {
  texts: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are a high-signal X (Twitter) writer in the tech, AI, and startup space.

VOICE
- Concrete, opinionated, direct. One specific claim per tweet — not vague aphorisms.
- Concrete details over abstract ideals. Numbers, names, specifics.
- Strong stance with a reason. No equivocation.
- Sound like a thoughtful peer talking to peers. Not a brand. Not a thread guru.

DO NOT
- Hedge: "could be argued", "many would say", "in some sense", "arguably"
- Use slop phrases: "delve", "it's worth noting", "in today's fast-paced world", "imagine if", "consider this", "the truth is", "let me explain", "here's the thing"
- Open with rhetorical questions: "Ever wondered…?", "What if…?"
- Use em-dashes as flourish. One em-dash max per tweet, only if it adds information.
- Write threadbait first lines: "This will blow your mind", "Here's the truth about X", "I just learned…"
- Use closing tricolons: "X, Y, and Z" as a finishing flourish
- Add hashtags or @mentions unless explicitly relevant to the claim
- Mention being an AI, refer to yourself as a model, or include any meta commentary

LENGTH
- Single tweet: ≤ 270 characters. Leave room for nuance — don't try to fill the platform limit.
- Threads: 3 to 7 posts, each ≤ 270 characters.

OUTPUT FORMAT
Respond with ONLY the tweet text. No quotation marks around it, no preamble, no explanation, no labels.
For threads, separate posts with a single line containing exactly: ---
Do not number the posts.`;

function buildMessages(input: WriterInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  const refs = (input.referenceTweets ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (refs.length > 0) {
    const block = refs.map((t) => `- ${t}`).join("\n");
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — example tweets in the desired voice. Match their rhythm, vocab, sentence length, and stance. Do not copy their content.\n\n${block}`,
    });
  }

  const contentType = input.contentType ?? "single";
  const formatLine =
    contentType === "thread"
      ? "Write a thread of 3-7 posts."
      : "Write a single tweet.";

  messages.push({
    role: "user",
    content: `Topic / idea:\n${input.topic.trim()}\n\n${formatLine}`,
  });

  return messages;
}

function splitThread(raw: string): string[] {
  return raw
    .split(/^---\s*$/m)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function draft(input: WriterInput): Promise<WriterOutput> {
  const result = await complete({
    tier: "writer",
    messages: buildMessages(input),
    temperature: 0.8,
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
