import "server-only";
import { complete } from "@/lib/llm";

export type GuardInput = {
  text: string;
  author?: string | null;
};

export type GuardOutput = {
  safe: boolean;
  category: string;
  reason: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `You are a topic safety gate for a personal-brand X (Twitter) account in the tech / AI / startup space. The writer cannot afford reputational damage from off-brand or controversial commentary.

Your job: classify the topic of an incoming viral post and decide whether generating a public commentary on it would be SAFE for this writer's brand.

ALLOW (safe=true) — tweet is squarely about:
- AI / ML / models / research / benchmarks / agents
- Software engineering, dev tools, programming languages, frameworks
- Startups, product, business of building tech companies, hiring trends in tech, layoffs in tech
- Hardware, infrastructure, cloud, GPU, datacenters
- Science (math, physics, biology research) when not entangled with politics
- Tech industry news that doesn't touch any of the BLOCK list below

BLOCK (safe=false) — tweet involves any of:
- Politics: elections, political parties, government scandals, public officials by name (Trump, Biden, Putin, Zelensky, MTG, Massie, any senator/congressman, any president), legal/court drama around politicians
- Geopolitics: wars, conflicts, sanctions, foreign policy, military
- Conspiracy-adjacent topics: Epstein files, deep state, "what they don't want you to know", "they're hiding" — even when posted by a tech person
- Tragedies: deaths, accidents, mass casualties, suicides, terrorism
- Religion or religious controversy
- Race, gender wars, identity politics, DEI debates
- Personal scandals, lawsuits, dramas involving named people
- Cryptocurrency price calls or market predictions (too volatile, reputational risk)
- Anything where wrong commentary could be reputationally damaging or misinterpreted

BORDERLINE — default to safe=false:
- Finance / markets in general (outside specific tech-company financials)
- Education policy
- Mental health topics (unless specifically about engineering burnout)
- Ambiguous-language tweets where you can't tell the topic clearly

OUTPUT — JSON only, no preamble:
{
  "safe": <boolean>,
  "category": "<short slug, e.g. ai-research / startup / politics / tragedy / conspiracy / crypto / other>",
  "reason": "<one short clause explaining the verdict>"
}

Fail-closed: when in doubt, set safe=false. The cost of blocking a tech tweet is one skipped generation; the cost of allowing a political tweet is a brand crisis.`;

export async function check(input: GuardInput): Promise<GuardOutput> {
  const result = await complete({
    tier: "cheap", // gpt-5-nano: fast + cheap, fine for classification
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Source tweet by @${input.author ?? "?"}:\n"${input.text.trim()}"\n\nReturn JSON only.`,
      },
    ],
    maxTokens: 1500,
    responseFormat: "json_object",
  });

  let parsed: { safe?: unknown; category?: unknown; reason?: unknown };
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return {
      safe: false,
      category: "parse-error",
      reason: "topic guard returned non-JSON output; defaulting to unsafe",
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    };
  }

  return {
    safe: parsed.safe === true,
    category:
      typeof parsed.category === "string" ? parsed.category : "unknown",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
