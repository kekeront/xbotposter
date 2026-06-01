import "server-only";
import {
  complete,
  completeWithTrace,
  type CompletionMessage,
  type TraceContext,
} from "@/lib/llm";

export type ComposePreferences = {
  tone?: string;
  audience?: string;
  language?: string;
  negatives?: string[];
  customInstruction?: string;
};

export type WriterInput = {
  topic: string;
  contentType?: "single" | "thread" | "essay";
  referenceTweets?: string[];
  fingerprintBlock?: string;
  outlineBeats?: string[];
  memoryBlock?: string;
  researchBlock?: string;
  preferences?: ComposePreferences;
  traceContext?: TraceContext;
};

export type WriterOutput = {
  texts: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT_BASE = `You write X (Twitter) posts in the tech, AI, and startup space.

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

VOICE
- Concrete, opinionated, direct — but only opinionated about what the user actually said.
- One claim per tweet, max.
- VOICE ANCHOR is TONE ONLY, not data. From the anchor examples, learn:
  rhythm, sentence length, punctuation habits, emoji use, casualness,
  code-switching habits, how the writer reacts vs declares.
  The anchor's own language is NOT a target — render the post in the
  chosen OUTPUT LANGUAGE defined in the authoritative LANGUAGE section.
  DO NOT borrow topics, facts, hobbies, names, brands, or vocabulary
  from the anchor that aren't in the user's seed. The anchor tells you
  HOW to write; the seed tells you WHAT to write.

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

const LANGUAGE_SECTIONS: Record<string, string> = {
  russian: `LANGUAGE — AUTHORITATIVE, overrides all defaults
OUTPUT LANGUAGE: RUSSIAN. Write primarily in Russian.
- Light English code-switching is fine for technical terms (LLM, RAG, API,
  GPU, deploy, ship, etc.) and for established memes / slang ("ngl", "lowkey",
  "shoutout", "fr"). Light Kazakh occasionally if natural.
- Russian is colloquial, internet-register, not literary or business.

STRUCTURE & SYNTAX (extracted from this writer's Telegram channel — RU register)
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
- No hedging. No "I think", "imho", "возможно". Прямо.`,

  english: `LANGUAGE — AUTHORITATIVE, overrides all defaults
OUTPUT LANGUAGE: ENGLISH. Write primarily in English.
- Light code-switching for widely-used tech terms in Russian contexts is fine
  (e.g., "шипить", "деплоить" may appear in voice anchors — match the tone
  but write the tweet body in English).
- Do NOT impose Russian sentence frames, Russian casual-register markers, or
  Russian-specific stylistic idioms on this English post.
- Register: casual, internet-register English — not formal or corporate.
- No hedging. Direct and opinionated. Same anti-slop rules apply.`,

  "mixed-ru-en": `LANGUAGE — AUTHORITATIVE, overrides all defaults
OUTPUT LANGUAGE: MIXED RU/EN. Write in natural Russian/English code-switching.
- Mix Russian and English freely within the same post — this is the style.
- Technical terms, memes, and startup vocabulary in English; main substance
  can flow between both languages naturally.
- Russian casual register applies where Russian words appear.
- Light Kazakh occasionally if natural.
- No hedging. No "I think", "imho", "возможно". Прямо.`,
};

function resolveLanguageSection(language?: string): string {
  if (language === "english") return LANGUAGE_SECTIONS.english!;
  if (language === "mixed-ru-en") return LANGUAGE_SECTIONS["mixed-ru-en"]!;
  // "russian" or undefined → Russian default
  return LANGUAGE_SECTIONS.russian!;
}

function buildMessages(input: WriterInput): CompletionMessage[] {
  const languageSection = resolveLanguageSection(input.preferences?.language);
  const systemPrompt = `${SYSTEM_PROMPT_BASE}\n\n${languageSection}`;
  const messages: CompletionMessage[] = [
    { role: "system", content: systemPrompt },
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
    const isEnglish = input.preferences?.language === "english";
    const codeSwitchLine = isEnglish
      ? "- code-switching rhythm (note it, but write the post in the chosen output language — do NOT copy the anchor's language mix)"
      : "- code-switching patterns (RU/EN/KZ mix)";
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — TONE REFERENCE ONLY, NOT CONTENT.

These are the writer's past posts. From them, extract ONLY stylistic features:
- sentence length distribution and rhythm
- punctuation habits (em-dash use, commas, ellipses)
- emoji frequency and placement
${codeSwitchLine}
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

  if (input.preferences) {
    const pref = input.preferences;
    const parts: string[] = [];
    if (pref.tone) parts.push(`TONE: ${pref.tone}`);
    if (pref.audience) parts.push(`TARGET AUDIENCE: ${pref.audience}`);
    // language is already baked authoritatively into the system prompt above; omit here.
    if (pref.negatives && pref.negatives.length > 0) {
      parts.push(`MUST AVOID:\n${pref.negatives.map((n) => `- ${n}`).join("\n")}`);
    }
    if (pref.customInstruction) {
      parts.push(`ADDITIONAL INSTRUCTION: ${pref.customInstruction}`);
    }
    if (parts.length > 0) {
      messages.push({
        role: "system",
        content: `USER PREFERENCES — override default style where they conflict with defaults.\n\n${parts.join("\n\n")}`,
      });
    }
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
  const messages = buildMessages(input);
  const opts = {
    tier: "writer" as const,
    messages,
    maxTokens: input.contentType === "essay" ? 3000 : 1500,
  };
  const result = input.traceContext
    ? await completeWithTrace(opts, input.traceContext)
    : await complete(opts);

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
