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

  const response = await client.responses.create(
    {
      model,
      input: `Research this topic for an X/Twitter post. Find recent facts, data points, expert opinions, and relevant context. Be specific — include numbers, dates, names where available.\n\nTopic: ${topic}\n\nProvide a concise research brief (5-10 bullet points) with the most useful facts and context. Cite sources.`,
      tools: [{ type: "web_search_preview" as const }],
      include: ["web_search_call.results"],
    },
    { timeout: 45_000 },
  );

  const text = response.output_text ?? "";
  const usage = response.usage;
  const tokensIn = usage?.input_tokens ?? 0;
  const tokensOut = usage?.output_tokens ?? 0;
  const costUsd = costFor(model, tokensIn, tokensOut);

  const sources: SearchSource[] = [];
  for (const item of response.output ?? []) {
    if (item.type === "web_search_call") {
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
