import "server-only";
import {
  complete,
  completeWithTrace,
  type CompletionMessage,
  type TraceContext,
} from "@/lib/llm";

export type EditorInput = {
  topic: string;
  drafts: string[];
  contentType: "single" | "thread" | "essay";
  referenceTweets?: string[];
  fingerprintBlock?: string;
  traceContext?: TraceContext;
};

export type EditorOutput = {
  texts: string[];
  issuesFound: string[];
  changed: boolean;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are an editor for X (Twitter) posts.

Review the draft against the user's seed and the voice anchor (if provided). If issues exist, fix them. If the draft is clean, return it unchanged.

CHECK FOR
1. LANGUAGE — output must be Russian (with light EN/KZ code-switching for tech terms or memes only). If the draft is mostly English when the seed could be expressed in Russian, rewrite it in Russian colloquial register.
2. INVENTED SPECIFICS — numbers, percentages, dollars, time savings, performance gains, product names, features, brands, people, places, events that aren't in the user's seed. Strip them or replace with vague-but-sharp wording.
3. FALSE STORIES — "I just shipped X", "I cut my time by Y", "my last 6 posts" when the seed doesn't say so.
4. CONTENT BLEED FROM VOICE ANCHOR — the anchor is tone reference only. If the draft mentions specific topics, hobbies, names, brands, or vocabulary that came from the anchor but isn't in the user's seed (e.g., gaming references, music gear, named people, specific platforms) — strip them.
5. SLOP PHRASES (RU + EN) — "delve", "it's worth noting", "the truth is", "the dirty secret", "let me explain", "here's the thing", "imagine if", "consider this", "could be argued", "many would say", "стоит отметить", "хотелось бы сказать", "в нашем быстро меняющемся мире", "представьте себе", "по сути", "как известно"
6. EM-DASH FLOURISHES — em-dashes used for stylistic effect rather than connecting clauses with new info. Replace with period or comma.
7. THREADBAIT OPENERS — "Ever wondered…", "Here's the truth about X", "I just learned…", "А вы знали что…", "Сейчас расскажу…"
8. CLOSING TRICOLONS — "X, Y, and Z" used as a finishing kicker
9. CHARACTER LENGTH — single tweets over 270 chars, threads where any post is over 270 chars. Aim for 60-180 chars on singles when possible (anchor norm is short).
10. VOICE TONE MISMATCH — wildly different rhythm, register, or language-mix from the voice anchor (the TONE should match; the CONTENT should not). Anchor is casual / internet-register Russian — formal Russian counts as a tone mismatch.

OUTPUT FORMAT
Respond as JSON exactly:
{
  "issues": ["short description of issue 1", "issue 2", ...],
  "revised": ["text of post 1", "text of post 2 (for threads)", ...]
}
- "issues" is an empty array if draft is clean.
- "revised" MUST have the same number of items as the input draft (preserve thread structure).
- If you make no changes, "revised" matches the input exactly.
- Respond with ONLY the JSON. No preamble, no markdown, no explanation outside JSON.`;

function buildMessages(input: EditorInput): CompletionMessage[] {
  const messages: CompletionMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  if (input.fingerprintBlock) {
    messages.push({ role: "system", content: input.fingerprintBlock });
  }

  const refs = (input.referenceTweets ?? []).slice(0, 10);
  if (refs.length > 0) {
    messages.push({
      role: "system",
      content: `VOICE ANCHOR — TONE REFERENCE ONLY. The anchor defines HOW the writer sounds (rhythm, casualness, language mix, emoji use). It does NOT define WHAT they're writing about — that comes from the user's seed. Flag if the draft borrows topics/names/brands/specific vocabulary from the anchor.\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  const draftsBlock =
    input.contentType === "thread"
      ? input.drafts.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")
      : input.drafts[0] ?? "";

  messages.push({
    role: "user",
    content: `User's seed:\n${input.topic.trim()}\n\nDraft to review (${input.contentType}, ${input.drafts.length} post${input.drafts.length === 1 ? "" : "s"}):\n${draftsBlock}\n\nReturn JSON with issues + revised array.`,
  });

  return messages;
}

export async function review(input: EditorInput): Promise<EditorOutput> {
  if (input.drafts.length === 0) {
    return {
      texts: [],
      issuesFound: [],
      changed: false,
      model: "skip",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
  }

  const messages = buildMessages(input);
  const opts = {
    tier: "mid" as const,
    messages,
    maxTokens: 3000,
    responseFormat: "json_object" as const,
  };
  const result = input.traceContext
    ? await completeWithTrace(opts, input.traceContext)
    : await complete(opts);

  let parsed: { issues?: string[]; revised?: string[] };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return {
      texts: input.drafts,
      issuesFound: ["editor returned non-JSON output"],
      changed: false,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  const revised = parsed.revised;
  const issues = parsed.issues ?? [];

  const texts =
    Array.isArray(revised) && revised.length === input.drafts.length
      ? revised.map((t) => String(t).trim()).filter(Boolean)
      : input.drafts;

  const changed = texts.some((t, i) => t !== input.drafts[i]);

  return {
    texts: texts.length === input.drafts.length ? texts : input.drafts,
    issuesFound: issues,
    changed,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
