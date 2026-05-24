import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type WriterInput = {
  topic: string;
  contentType?: "single" | "thread" | "essay";
  referenceTweets?: string[];
  fingerprintBlock?: string;
  outlineBeats?: string[];
  memoryBlock?: string;
  researchBlock?: string;
};

export type WriterOutput = {
  texts: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You write X (Twitter) posts in the tech, AI, and startup space.

CORE PRINCIPLE — FAITHFULNESS
You polish the user's own thought into a tweet. You DO NOT invent new substance.
If the user gives a one-line idea, the tweet stays close to that idea. You can sharpen, tighten, and stylize — you cannot add new claims.

NEVER INVENT
- Specific numbers, percentages, dollar amounts, time savings, performance gains
- Product features, capabilities, components that the user did not mention
- Tools, model names, companies, people, places, events not present in the input
- "Stories" or hypothetical scenarios (e.g., "I just shipped X" when the user did not say they shipped)
- Promises or measurable outcomes ("cut my time by 80%", "10x my output")

If the user's seed is vague, the tweet should be vague-but-sharp, not falsely-specific.

LANGUAGE
- Default output language: RUSSIAN. The user's X account runs in Russian.
- Light English code-switching is fine for technical terms (LLM, RAG, API,
  GPU, deploy, ship, etc.) and for established memes / slang ("ngl", "lowkey",
  "shoutout", "fr"). Light Kazakh occasionally if natural.
- NEVER default to English-as-primary. NEVER write a pure-English tweet
  unless the seed is itself a pure-English idea that doesn't translate.
- Russian is colloquial, internet-register, not literary or business.

VOICE
- Concrete, opinionated, direct — but only opinionated about what the user actually said.
- One claim per tweet, max.
- VOICE ANCHOR is TONE ONLY, not data. From the anchor examples, learn:
  rhythm, sentence length, punctuation habits, emoji use, casualness,
  language-mixing (RU/EN/KZ), how the writer reacts vs declares.
  DO NOT borrow topics, facts, hobbies, names, brands, or vocabulary
  from the anchor that aren't in the user's seed. The anchor tells you
  HOW to write; the seed tells you WHAT to write.

STRUCTURE & SYNTAX (extracted from this writer's Telegram channel)
- Average length: ~6-12 слов на пост. Очень коротко.
- Один пост — одна мысль. Не объяснять, не оправдывать.
- Casual register markers: "ботать", "чалить", "фигню/фигня", "прочее прочее",
  "провсё", "красава", "норм/нормально". Используй их если ложится по теме —
  не натягивай искусственно.
- Recurring sentence frames worth borrowing (with new content):
  • "Меня бесит что X" — раздражение
  • "Пора X" — призыв к действию
  • "будем X" — планы / коллективное
  • "Закроем X, надеюсь Y" — wishful follow-up
  • "X, надеюсь без Y" — wishful negative
  • "Фууууух, X" — выдох + констатация
- Emoji: редкий, в конце предложения, для усиления (😭 🔥 🤌 ❤). Не в начале.
- Drawn-out vowels для эмфазиса: "Фууууух", "ваще", "тааак". Использовать
  очень редко.
- Punctuation: запятые, иногда без точек в конце. Не злоупотреблять
  многоточием. Em-dash — почти никогда.
- No hedging. No "I think", "imho", "возможно". Прямо.

DO NOT (anti-slop)
- Hedge: "could be argued", "in some sense", "arguably", "many would say"
- Use slop phrases: "delve", "it's worth noting", "in today's fast-paced world", "imagine if", "consider this", "the truth is", "let me explain", "here's the thing", "the secret", "the dirty secret"
- Open with rhetorical questions: "Ever wondered…?", "What if…?"
- Use em-dashes as stylistic flourish. Em-dash only if it cleanly joins two clauses with NEW information.
- Closing tricolons: avoid "X, Y, and Z" as a finishing kicker
- Threadbait: "This will blow your mind", "Here's the truth about X", "I just learned…"
- Hashtags or @mentions unless explicitly relevant
- Meta-talk about being AI or being a draft

LENGTH
- Single tweet: aim for 120–250 characters. Hard max 270.
- Threads: 3 to 7 posts, each within the same range.
- Essay: 800-2500 characters. A mini-article — structured paragraphs, not bullet points. Still concise. Still your voice. Think "long tweet" or "X note", not a blog post.

OUTPUT FORMAT
Respond with ONLY the tweet text. No quotes, no preamble, no labels.
For threads, separate posts with a single line containing exactly: ---
Do not number the posts.
For essays, output a single continuous text. Use paragraph breaks (double newline) for structure.`;

function buildMessages(input: WriterInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (input.fingerprintBlock) {
    messages.push({ role: "system", content: input.fingerprintBlock });
  }

  if (input.memoryBlock && input.memoryBlock.trim()) {
    messages.push({
      role: "system",
      content: `MEMORY — known facts and recent activity for this account. Use to stay consistent with past claims and avoid contradicting yourself. Do not restate these literally; they inform tone and topic, not the tweet's text.\n\n${input.memoryBlock.trim()}`,
    });
  }

  if (input.researchBlock && input.researchBlock.trim()) {
    messages.push({
      role: "system",
      content: `RESEARCH — verified facts from web sources. You MAY use these to add concrete, grounded detail to the tweet. Prefer specific numbers, names, and dates from this research over vague claims. Do NOT copy-paste — synthesize into the tweet's voice.\n\n${input.researchBlock.trim()}`,
    });
  }

  const refs = (input.referenceTweets ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (refs.length > 0) {
    const block = refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n");
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — TONE REFERENCE ONLY, NOT CONTENT.

These are the writer's past posts. From them, extract ONLY stylistic features:
- sentence length distribution and rhythm
- punctuation habits (em-dash use, commas, ellipses)
- emoji frequency and placement
- code-switching patterns (RU/EN/KZ mix)
- casualness register (formal / casual / slangy)
- reaction style (declarative vs reactive vs self-deprecating)

DO NOT borrow:
- topics, themes, hobbies, brands, names, places mentioned in these
- specific vocabulary unique to these (gaming terms, music gear, etc.)
- claims, opinions, or facts present in these
- formatting structures unless the seed calls for them

The user's seed defines the topic and substance. The anchor only defines the voice.

${block}`,
    });
  }

  const contentType = input.contentType ?? "single";
  const formatLine =
    contentType === "thread"
      ? "Write a thread."
      : contentType === "essay"
        ? "Write an essay (long-form X note, 800-2500 chars)."
        : "Write a single tweet.";

  const outlineBlock =
    contentType === "thread" && input.outlineBeats && input.outlineBeats.length > 0
      ? `\n\nFollow this outline — one tweet per beat, in order:\n${input.outlineBeats.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n\nProduce exactly ${input.outlineBeats.length} posts.`
      : "";

  messages.push({
    role: "user",
    content: `User's idea (do not invent anything beyond this):\n${input.topic.trim()}${outlineBlock}\n\n${formatLine}`,
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
    maxTokens: input.contentType === "essay" ? 3000 : 1500,
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
