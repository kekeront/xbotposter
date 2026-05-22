import "server-only";

export type WriterInput = {
  topic: string;
  context?: string;
  contentType?: "single" | "thread";
};

export type WriterOutput = {
  texts: string[]; // one entry for "single", multiple for "thread"
  rationale?: string;
};

// Slice 0 stub. Real implementation lands in slice 1.
export async function draft(input: WriterInput): Promise<WriterOutput> {
  throw new Error(
    `writer.draft() is not implemented in slice 0 (received topic: ${input.topic}). Wire it up in slice 1.`,
  );
}
