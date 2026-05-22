import "server-only";
import { db } from "@/db/client";
import { traces, type NewTrace } from "@/db/schema";

export type TraceEventInput = Omit<NewTrace, "id" | "ts">;

export async function writeTrace(input: TraceEventInput): Promise<void> {
  try {
    await db.insert(traces).values(input);
  } catch (err) {
    console.error("[trace] failed to write trace:", err);
  }
}

export async function writeTraces(inputs: TraceEventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await db.insert(traces).values(inputs);
  } catch (err) {
    console.error("[trace] failed to write traces batch:", err);
  }
}
