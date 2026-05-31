import { requireUser } from "@/lib/auth";
import { loadDiscoveryFeed } from "@/lib/discovery-feed";
import { complete } from "@/lib/llm";

export const maxDuration = 60;

// Brief in-memory cache so toggling Feed↔Summary doesn't re-summarize (and
// re-spend) on every view. Best-effort per instance; fine for this scale.
const cache = new Map<string, { summary: string; ts: number }>();
const TTL_MS = 10 * 60 * 1000;

export async function GET() {
  const user = await requireUser();

  const cached = cache.get(user.id);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return Response.json({ summary: cached.summary, cached: true });
  }

  // Top recent items by engagement — the "global bubble" right now.
  const { items } = await loadDiscoveryFeed(user.id, {
    sort: "engagement",
    limit: 40,
  });

  if (items.length === 0) {
    return Response.json({
      summary:
        "Nothing in the feed yet — click “fetch viral” or wait for the next discover cycle.",
      basedOn: 0,
    });
  }

  const corpus = items
    .map(
      (it, i) =>
        `${i + 1}. [${it.kind}${it.author ? ` @${it.author}` : ""}${
          it.score ? ` · ${it.score}` : ""
        }] ${it.title ? `${it.title} — ` : ""}${it.text.slice(0, 240)}`,
    )
    .join("\n");

  const result = await complete({
    tier: "cheap",
    // gpt-5-nano is a reasoning model: reasoning tokens count against this
    // budget, so a low ceiling (e.g. 600) gets fully consumed by reasoning and
    // returns EMPTY visible text. Give it room for reasoning + the digest.
    maxTokens: 3000,
    messages: [
      {
        role: "system",
        content:
          "You summarize what's happening in a tech/AI social feed (the 'global bubble'). " +
          "Given recent items from X, Hacker News, arXiv, Substack and uploads, write a concise " +
          "digest: 4-6 bullets capturing the dominant themes, what's trending, notable debates or " +
          "releases, and any emerging angle worth posting about. Reference sources by handle/kind " +
          "where useful. Be specific and skimmable. No preamble.",
      },
      {
        role: "user",
        content: `Recent feed (${items.length} items):\n\n${corpus}`,
      },
    ],
  });

  cache.set(user.id, { summary: result.text, ts: Date.now() });

  return Response.json({
    summary: result.text,
    basedOn: items.length,
    costUsd: result.costUsd,
  });
}
