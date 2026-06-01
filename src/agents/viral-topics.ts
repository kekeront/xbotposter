import "server-only";
import { complete } from "@/lib/llm";

export type ViralTopic = {
  topic: string;
  hook: string;
  rationale: string;
};

export type ViralTopicsInput = {
  items: Array<{
    kind: string;
    author: string | null;
    text: string;
    score: number;
  }>;
  count?: number;
  fingerprintBlock?: string;
};

export type ViralTopicsOutput = {
  topics: ViralTopic[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

// Spot the viral wave in the discovery corpus and recommend distinct topics
// worth shooting a post at right now.
export async function recommendViralTopics(
  input: ViralTopicsInput,
): Promise<ViralTopicsOutput> {
  const count = input.count ?? 3;
  const corpus = input.items
    .slice(0, 40)
    .map(
      (it, i) =>
        `${i + 1}. [${it.kind}${it.author ? ` @${it.author}` : ""}${
          it.score ? ` · ${it.score}` : ""
        }] ${it.text.slice(0, 200)}`,
    )
    .join("\n");

  const result = await complete({
    tier: "mid",
    // Reasoning model — give room for reasoning + the JSON (a low ceiling
    // returns empty). See src/app/api/discover/summary/route.ts.
    maxTokens: 3000,
    responseFormat: "json_object",
    messages: [
      {
        role: "system",
        content:
          "You spot the viral wave in a tech/AI feed and recommend topics worth posting about RIGHT NOW to ride the momentum. " +
          "Given recent high-signal items (X posts, HN, arXiv, Substack), pick the most promising, DISTINCT, non-overlapping topics to shoot a post at, in the account's lane. " +
          'For each return: `topic` (a concrete thing to write about), `hook` (a one-line angle/opening idea), and `rationale` (why it is hot right now). ' +
          'Respond ONLY with JSON: {"topics":[{"topic":"...","hook":"...","rationale":"..."}]}.',
      },
      ...(input.fingerprintBlock
        ? [{ role: "system" as const, content: input.fingerprintBlock }]
        : []),
      {
        role: "user",
        content: `Recommend the top ${count} topics from this wave:\n\n${corpus}`,
      },
    ],
  });

  let topics: ViralTopic[] = [];
  try {
    const parsed = JSON.parse(result.text) as { topics?: ViralTopic[] };
    if (Array.isArray(parsed.topics)) {
      topics = parsed.topics
        .filter(
          (t): t is ViralTopic =>
            !!t && typeof t.topic === "string" && t.topic.trim().length > 0,
        )
        .slice(0, count)
        .map((t) => ({
          topic: t.topic.trim(),
          hook: typeof t.hook === "string" ? t.hook : "",
          rationale: typeof t.rationale === "string" ? t.rationale : "",
        }));
    }
  } catch {
    topics = [];
  }

  return {
    topics,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
