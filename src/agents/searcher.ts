import "server-only";
import OpenAI from "openai";
import { env, requireEnv } from "@/lib/env";
import { costFor } from "@/lib/llm";

export type SearcherInput = {
  topic: string;
  maxSources?: number;
};

export type SearchSource = {
  url: string;
  title: string;
  snippet: string;
};

export type SearcherOutput = {
  researchBlock: string;
  sources: SearchSource[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const EMPTY: SearcherOutput = {
  researchBlock: "",
  sources: [],
  model: "",
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
};

let _client: OpenAI | undefined;
function getClient(): OpenAI {
  if (_client) return _client;
  _client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return _client;
}

export async function search(input: SearcherInput): Promise<SearcherOutput> {
  const topic = input.topic.trim();
  if (!topic) return EMPTY;

  const model = env.LLM_MID_MODEL;
  const client = getClient();

  // `max_tool_calls` is a valid Responses API field but is not yet on the
  // SDK's create-params type (openai-node #1572), so widen with an intersection
  // rather than `any`.
  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming & {
    max_tool_calls?: number;
  } = {
    model,
    input: `Research this topic for an X/Twitter post. Find recent facts, data points, expert opinions, and relevant context. Be specific — include numbers, dates, names where available.\n\nTopic: ${topic}\n\nProvide a concise research brief (5-10 bullet points) with the most useful facts and context. Cite sources.`,
    // `low` search context is the cheapest per-call tier and re-injects far
    // less fetched page content as input tokens.
    tools: [{ type: "web_search_preview", search_context_size: "low" }],
    include: ["web_search_call.results"],
    // The searcher only needs to summarize search hits, not deliberate — low
    // reasoning effort cuts reasoning tokens and, crucially, the number of
    // search rounds the model chains (the ~8 searches that cost ~$0.50).
    reasoning: { effort: "low" },
    // Hard ceiling on built-in tool calls in case the model still over-searches.
    max_tool_calls: env.SEARCH_MAX_TOOL_CALLS,
  };

  const response = await client.responses.create(params, { timeout: 45_000 });

  const text = response.output_text ?? "";
  const usage = response.usage;
  const tokensIn = usage?.input_tokens ?? 0;
  const tokensOut = usage?.output_tokens ?? 0;

  const sources: SearchSource[] = [];
  let webSearchCalls = 0;
  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") {
      webSearchCalls += 1;
      const raw = item as unknown as {
        results?: Array<{ url?: string; title?: string; snippet?: string }>;
      };
      if (Array.isArray(raw.results)) {
        for (const r of raw.results) {
          if (r.url && r.title) {
            sources.push({
              url: r.url,
              title: r.title,
              snippet: r.snippet ?? "",
            });
          }
        }
      }
    }
  }

  // Token cost plus the per-call web_search tool fee, which costFor() does not
  // know about — without this the daily spend cap undercounts search by ~30x.
  const costUsd =
    costFor(model, tokensIn, tokensOut) +
    webSearchCalls * env.OPENAI_WEB_SEARCH_COST_PER_CALL_USD;

  const maxSources = input.maxSources ?? 8;
  const dedupedSources = sources
    .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i)
    .slice(0, maxSources);

  return {
    researchBlock: text,
    sources: dedupedSources,
    model,
    tokensIn,
    tokensOut,
    costUsd,
  };
}
