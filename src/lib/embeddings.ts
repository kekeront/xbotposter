import "server-only";
import { embed as embedRaw } from "./llm";

export type EmbedOneResult = {
  vector: number[];
  tokens: number;
  costUsd: number;
  model: string;
};

export type EmbedManyResult = {
  vectors: number[][];
  tokens: number;
  costUsd: number;
  model: string;
};

export async function embedOne(text: string): Promise<EmbedOneResult> {
  const r = await embedRaw(text);
  const vector = r.vectors[0];
  if (!vector) throw new Error("embedOne: provider returned no vector");
  return { vector, tokens: r.tokens, costUsd: r.costUsd, model: r.model };
}

export async function embedMany(texts: string[]): Promise<EmbedManyResult> {
  if (texts.length === 0) {
    return { vectors: [], tokens: 0, costUsd: 0, model: "" };
  }
  const r = await embedRaw(texts);
  return {
    vectors: r.vectors,
    tokens: r.tokens,
    costUsd: r.costUsd,
    model: r.model,
  };
}

// pgvector accepts the Postgres array literal: '[1.23,4.56,...]'.
// postgres.js will quote it for us if we hand it as a string.
export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
