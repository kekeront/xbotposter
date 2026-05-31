import "server-only";
import OpenAI from "openai";
import { env, requireEnv } from "./env";

export type LlmTier = "cheap" | "mid" | "writer";

function modelFor(tier: LlmTier): string {
  switch (tier) {
    case "cheap":
      return env.LLM_CHEAP_MODEL;
    case "mid":
      return env.LLM_MID_MODEL;
    case "writer":
      return env.LLM_WRITER_MODEL;
  }
}

// USD per 1M tokens.
const PRICING: Record<
  string,
  { input: number; output: number; cachedInput?: number }
> = {
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cachedInput: 0.075 },
  "gpt-5.4": { input: 2.5, output: 15.0, cachedInput: 0.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

export function costFor(
  model: string,
  tokensIn: number,
  tokensOut: number,
  cachedTokensIn = 0,
): number {
  const p = PRICING[model];
  if (!p) {
    // No pricing row → cost is recorded as $0, which silently undercounts the
    // daily spend cap. Surface it so a renamed/unlisted model is observable.
    console.warn(
      `[costFor] no PRICING entry for model "${model}" — cost recorded as $0; MAX_DAILY_USD may undercount`,
    );
    return 0;
  }
  const uncached = Math.max(0, tokensIn - cachedTokensIn);
  const inputCost = (uncached * p.input) / 1_000_000;
  const cachedCost = (cachedTokensIn * (p.cachedInput ?? p.input)) / 1_000_000;
  const outputCost = (tokensOut * p.output) / 1_000_000;
  return inputCost + cachedCost + outputCost;
}

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return _client;
}

/** Expose the shared OpenAI client singleton for callers that need direct API access. */
export function getOpenAIClient(): OpenAI {
  return getClient();
}

export type CompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionOptions = {
  tier: LlmTier;
  messages: CompletionMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
};

export type CompletionResult = {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number;
  costUsd: number;
};

export async function complete(
  opts: CompletionOptions,
): Promise<CompletionResult> {
  const model = opts.model ?? modelFor(opts.tier);
  const client = getClient();

  const response = await client.chat.completions.create(
    {
      model,
      messages: opts.messages,
      max_completion_tokens: opts.maxTokens,
      ...(typeof opts.temperature === "number"
        ? { temperature: opts.temperature }
        : {}),
      ...(opts.responseFormat === "json_object"
        ? { response_format: { type: "json_object" as const } }
        : {}),
    },
    { timeout: 60_000 },
  );

  const choice = response.choices[0];
  const text = choice?.message.content ?? "";
  const usage = response.usage;
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  const cachedTokensIn = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const costUsd = costFor(model, tokensIn, tokensOut, cachedTokensIn);

  return { text, model, tokensIn, tokensOut, cachedTokensIn, costUsd };
}

export type TraceContext = {
  generationId: string | null;
  agent: string;
  userId?: string;
};

export async function completeWithTrace(
  opts: CompletionOptions,
  ctx: TraceContext,
): Promise<CompletionResult> {
  const result = await complete(opts);

  // Fire-and-forget — don't block the pipeline on trace writes.
  import("./trace").then(({ writeTrace }) =>
    writeTrace({
      generationId: ctx.generationId,
      userId: ctx.userId ?? null,
      agent: ctx.agent,
      eventType: "llm_call",
      messages: opts.messages,
      outputText: result.text,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd.toString(),
    }).catch(() => {}),
  );

  return result;
}

export type EmbedResult = {
  vectors: number[][];
  model: string;
  tokens: number;
  costUsd: number;
};

export async function embed(input: string | string[]): Promise<EmbedResult> {
  const model = env.EMBEDDING_MODEL;
  const client = getClient();
  const response = await client.embeddings.create(
    { model, input },
    { timeout: 30_000 },
  );
  const vectors = response.data.map((d) => d.embedding);
  const tokens = response.usage?.prompt_tokens ?? 0;
  const costUsd = costFor(model, tokens, 0);
  return { vectors, model, tokens, costUsd };
}
