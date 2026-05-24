import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type FactCheckInput = {
  seed: string;
  draft: string[];
  researchBlock?: string;
};

export type ClaimVerdict = "supported" | "invented" | "uncertain";

export type ExtractedClaim = {
  text: string;
  verdict: ClaimVerdict;
  reason: string;
};

export type FactCheckOutput = {
  claims: ExtractedClaim[];
  hasInvented: boolean;
  inventedCount: number;
  uncertainCount: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are a fact-checker for an X (Twitter) draft. Extract factual claims and classify each.

Definitions:
- A FACTUAL CLAIM is anything that asserts something about the world: a number, a percentage, a product feature, a person's action, a date, a comparison, a cause-effect relationship.
- Opinions, hedges, jokes, and pure rhetorical lines are NOT factual claims (skip them).

Classification per claim:
- "supported"  → the claim is present (in spirit or specifics) in the user's seed OR in the RESEARCH SOURCES provided.
- "invented"   → the claim adds specifics that neither the seed NOR the research sources contain (numbers, dollar amounts, product features, brands, percentages, claims about behavior) — i.e. the model fabricated them.
- "uncertain"  → general assertion that might be true but isn't directly stated in the seed or research (background knowledge). Caller decides if this is acceptable.

When RESEARCH SOURCES are provided, use them as ground truth. A claim backed by a research source is "supported" even if the seed doesn't mention it.

OUTPUT — JSON only, no preamble:
{
  "claims": [
    { "text": "<the claim, short>", "verdict": "supported" | "invented" | "uncertain", "reason": "<one short clause>" },
    ...
  ]
}

If the draft contains no factual claims (pure opinion or reaction), return { "claims": [] }.`;

function buildMessages(input: FactCheckInput): CompletionMessage[] {
  const draftBlock =
    input.draft.length === 1
      ? (input.draft[0] ?? "")
      : input.draft.map((t, i) => `[${i + 1}] ${t}`).join("\n---\n");

  const researchSection =
    input.researchBlock && input.researchBlock.trim()
      ? `\n\nRESEARCH SOURCES (verified web context):\n${input.researchBlock.trim()}`
      : "";

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `User's seed:\n${input.seed.trim()}${researchSection}\n\nDraft:\n${draftBlock}\n\nExtract and classify factual claims. JSON only.`,
    },
  ];
}

export async function check(input: FactCheckInput): Promise<FactCheckOutput> {
  const result = await complete({
    tier: "mid",
    messages: buildMessages(input),
    maxTokens: 3000,
    responseFormat: "json_object",
  });

  let parsed: { claims?: Array<{ text?: unknown; verdict?: unknown; reason?: unknown }> };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return {
      claims: [],
      hasInvented: false,
      inventedCount: 0,
      uncertainCount: 0,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  const raw = Array.isArray(parsed.claims) ? parsed.claims : [];
  const claims: ExtractedClaim[] = raw
    .map((c) => {
      const text = typeof c.text === "string" ? c.text.trim() : "";
      const verdictRaw =
        typeof c.verdict === "string" ? c.verdict.toLowerCase() : "uncertain";
      const verdict: ClaimVerdict =
        verdictRaw === "supported"
          ? "supported"
          : verdictRaw === "invented"
            ? "invented"
            : "uncertain";
      const reason = typeof c.reason === "string" ? c.reason.trim() : "";
      return { text, verdict, reason };
    })
    .filter((c) => c.text.length > 0);

  const inventedCount = claims.filter((c) => c.verdict === "invented").length;
  const uncertainCount = claims.filter((c) => c.verdict === "uncertain").length;

  return {
    claims,
    hasInvented: inventedCount > 0,
    inventedCount,
    uncertainCount,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
