import "server-only";
import { complete, type CompletionMessage } from "@/lib/llm";

export type AnglesInput = {
  topic: string;
  count: number;
  referenceTweets?: string[];
  fingerprintBlock?: string;
};

export type Angle = {
  angle: string;
  hook: string;
};

export type AnglesOutput = {
  angles: Angle[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

const SYSTEM_PROMPT = `Generate distinct angles on a single topic for a Russian-language tech/AI Twitter account.

Each angle is a different spin, perspective, or framing of the same underlying topic.
Angles should be meaningfully different — not just rephrasing the same point.

Good angle variety:
- Contrarian take vs consensus take
- Personal experience vs industry trend
- Technical depth vs accessible overview
- Optimistic vs skeptical
- "Why this matters" vs "What people get wrong"
- Practical advice vs observation

OUTPUT FORMAT — JSON only:
{
  "angles": [
    { "angle": "<2-3 sentence seed for the writer>", "hook": "<5-10 word summary>" },
    ...
  ]
}

Rules:
- Each angle's "angle" field is a 1-2 sentence seed the writer can run with. Keep it concise.
- "hook" is a short label (5-10 words max).
- Write in Russian (light EN for tech terms is fine).
- 2 to 6 angles.
- No preamble, no markdown, no code fences.`;

function buildMessages(input: AnglesInput): CompletionMessage[] {
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
      content: `VOICE ANCHOR (tone only, not content):\n\n${refs.map((t, i) => `[${i + 1}] ${t}`).join("\n\n")}`,
    });
  }

  messages.push({
    role: "user",
    content: `Topic:\n${input.topic.trim()}\n\nGenerate exactly ${input.count} distinct angles. JSON only.`,
  });

  return messages;
}

export async function generateAngles(
  input: AnglesInput,
): Promise<AnglesOutput> {
  const result = await complete({
    tier: "mid",
    messages: buildMessages(input),
    maxTokens: 4000,
    responseFormat: "json_object",
  });

  const raw = result.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: { angles?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const preview = raw.slice(0, 200);
    throw new Error(
      `angles JSON parse failed: ${err instanceof Error ? err.message : "unknown"} — raw: ${preview}`,
    );
  }

  const angles = Array.isArray(parsed.angles)
    ? parsed.angles
        .filter(
          (a): a is { angle: string; hook: string } =>
            typeof a === "object" &&
            a !== null &&
            typeof a.angle === "string" &&
            typeof a.hook === "string",
        )
        .slice(0, input.count)
    : [];

  if (angles.length === 0) {
    throw new Error(
      `angles returned 0 valid items — keys: ${Object.keys(parsed).join(", ")}`,
    );
  }

  return {
    angles,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
