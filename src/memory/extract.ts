import "server-only";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { env, requireEnv } from "@/lib/env";
import { costFor } from "@/lib/llm";
import { MEMORY_TYPE } from "./schema";

// §4.2 from higgsfieldtz/memory-service — 8 categories, schema-validated JSON
// via OpenAI Structured Outputs (no parse failures, no custom parser).
// Adapted for nfactz: the "user" is the Twitter persona (@kekeront);
// memories describe what's been claimed, opined, preferred, or happened.

const ExtractedMemorySchema = z.object({
  type: z.enum(MEMORY_TYPE),
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});

const ExtractionResponseSchema = z.object({
  memories: z.array(ExtractedMemorySchema),
});

export type ExtractedMemory = z.infer<typeof ExtractedMemorySchema>;

export type ExtractResult = {
  memories: ExtractedMemory[];
  error: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You extract structured memories from a single agent turn.

The agent is @kekeront's autonomous Twitter posting system. Each turn is a
post the agent shipped, a draft the user skipped/rejected, or a user-supplied
seed. Extract atomic, durable memories that will help future posts stay
consistent with past behaviour and avoid contradiction.

Eight categories, each emitted as type+key+value:

| Category | type | key examples |
| --- | --- | --- |
| Public claim | fact | claim.<topic>     e.g. claim.gpt-5-evals |
| Topic history | event | posted.<topic>   e.g. posted.eval-frameworks |
| Stated opinion | opinion | opinion.<topic> e.g. opinion.langchain |
| Voice preference | preference | voice.<dimension> e.g. voice.length |
| Topic preference | preference | topic.<dimension> e.g. topic.preferred-area |
| Avoidance | preference | avoid.<topic> e.g. avoid.crypto |
| Identity fact | fact | identity.<slot> e.g. identity.role |
| Skip reason | opinion | reject.<reason> e.g. reject.too-snarky |

CONFIDENCE: 0.95 for explicit statements, 0.85 for clearly implied, 0.65 for
hedged or single-cue inferences.

EXTRACT ONLY:
- Atomic single-fact memories. One claim per row.
- Things that future generations could plausibly want to know.
- Things stated or strongly implied in this turn.

DO NOT EXTRACT:
- Multi-turn corrections that need previous-turn context.
- Free-form narrative summaries — split into atomic memories.
- Speculation, hedged guesses, generic observations.
- Anything explicitly framed as hypothetical or about other people.

If no extractable memories are present, return {"memories": []}.`;

function buildUserPrompt(messages: { role: string; content: string }[]): string {
  const transcript = messages
    .map((m) => `[${m.role}] ${m.content.trim()}`)
    .join("\n\n");
  return `Turn transcript:\n\n${transcript}\n\nExtract memories per the schema.`;
}

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return _client;
}

export async function extractMemoriesFromTurn(
  messages: { role: string; content: string }[],
): Promise<ExtractResult> {
  const model = env.LLM_MID_MODEL;
  const empty: ExtractResult = {
    memories: [],
    error: null,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };

  if (messages.length === 0) return empty;

  try {
    const client = getClient();
    const completion = await client.chat.completions.parse(
      {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(messages) },
        ],
        response_format: zodResponseFormat(
          ExtractionResponseSchema,
          "memories_response",
        ),
        max_completion_tokens: 800,
      },
      { timeout: 30_000 },
    );

    const parsed = completion.choices[0]?.message.parsed;
    const usage = completion.usage;
    const tokensIn = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;

    if (!parsed) {
      return {
        ...empty,
        error: "no_parsed_response",
        tokensIn,
        tokensOut,
        costUsd: costFor(model, tokensIn, tokensOut),
      };
    }

    return {
      memories: parsed.memories,
      error: null,
      tokensIn,
      tokensOut,
      costUsd: costFor(model, tokensIn, tokensOut),
    };
  } catch (err) {
    // §4.2 graceful failure: AuthenticationError surfaces (config bug),
    // anything else degrades to empty memories with error string.
    if (err instanceof OpenAI.AuthenticationError) throw err;
    const message = err instanceof Error ? err.message : "unknown_extract_error";
    return { ...empty, error: message };
  }
}
