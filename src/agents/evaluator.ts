import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type EvalInput = {
  seed: string;
  draft: string[];
  contentType?: "single" | "thread" | "essay";
  referenceTweets?: string[];
  fingerprintBlock?: string;
};

export type EvalScores = {
  insightDensity: number;
  voiceMatch: number;
  antiSlop: number;
  charFit: number;
  language: number;
  faithfulness: number;
};

export type EvalOutput = {
  scores: EvalScores;
  overall: number;
  critique: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are an evaluator scoring a tweet draft for an X (Twitter) writer. Output JSON only.

RUBRIC — each criterion scored 0 to 100:

- insightDensity: how much non-obvious claim or specific observation per word.
  Pure restatement of the seed = low. Vague aphorisms = low.
- voiceMatch: how well the draft's TONE matches the voice anchor (sentence rhythm,
  register, language-mix, emoji habits). Content overlap is irrelevant here.
- antiSlop: free of slop phrases ("delve", "the truth is", "стоит отметить",
  "хотелось бы"), em-dash flourishes, threadbait openers ("Ever wondered…",
  "А вы знали…"), closing tricolons. 100 = clean.
- charFit: appropriate length. Single tweets 60-220 chars ideal; thread posts
  in same range each. Penalize overlong or trivially short.
- language: matches the writer's default (Russian-first, light EN/KZ code-switch).
  If a Russian-friendly seed got a pure-English answer, score low.
- faithfulness: 100 if draft sticks to the seed. Penalize invented specifics
  (numbers, dollars, fake stories), topics borrowed from voice anchor that
  weren't in the seed, fabricated brands/people.

OUTPUT — return ONLY this JSON shape, no preamble, no code fences:
{
  "scores": {
    "insightDensity": <int 0-100>,
    "voiceMatch": <int 0-100>,
    "antiSlop": <int 0-100>,
    "charFit": <int 0-100>,
    "language": <int 0-100>,
    "faithfulness": <int 0-100>
  },
  "overall": <int 0-100, simple average rounded>,
  "critique": "<one short sentence, plain prose, RU or EN>"
}`;

function buildMessages(input: EvalInput): CompletionMessage[] {
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
      content: `VOICE ANCHOR (style only):\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  const draftBlock =
    input.draft.length === 1
      ? (input.draft[0] ?? "")
      : input.draft.map((t, i) => `[${i + 1}] ${t}`).join("\n---\n");

  messages.push({
    role: "user",
    content: `User's seed:\n${input.seed.trim()}\n\nDraft to evaluate (${input.contentType ?? "single"}, ${input.draft.length} post${input.draft.length === 1 ? "" : "s"}):\n${draftBlock}\n\nReturn JSON only.`,
  });

  return messages;
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function evaluate(input: EvalInput): Promise<EvalOutput> {
  const result = await complete({
    tier: "mid",
    messages: buildMessages(input),
    // gpt-5 family uses reasoning tokens that eat into max_completion_tokens
    // before the JSON is produced. Be generous so the final JSON isn't cut off.
    maxTokens: 3000,
    responseFormat: "json_object",
  });

  let parsed: {
    scores?: Partial<EvalScores>;
    overall?: number;
    critique?: string;
  };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return {
      scores: {
        insightDensity: 0,
        voiceMatch: 0,
        antiSlop: 0,
        charFit: 0,
        language: 0,
        faithfulness: 0,
      },
      overall: 0,
      critique: "evaluator returned non-JSON output",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  const s = parsed.scores ?? {};
  const scores: EvalScores = {
    insightDensity: clampScore(s.insightDensity),
    voiceMatch: clampScore(s.voiceMatch),
    antiSlop: clampScore(s.antiSlop),
    charFit: clampScore(s.charFit),
    language: clampScore(s.language),
    faithfulness: clampScore(s.faithfulness),
  };

  const computedOverall = Math.round(
    (scores.insightDensity +
      scores.voiceMatch +
      scores.antiSlop +
      scores.charFit +
      scores.language +
      scores.faithfulness) /
      6,
  );

  return {
    scores,
    overall: clampScore(parsed.overall ?? computedOverall),
    critique:
      typeof parsed.critique === "string" ? parsed.critique.trim() : "",
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
