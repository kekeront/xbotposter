import "server-only";
import { env } from "./env";

// Bridge layer between app code and the memory module. Single place where
// `MEMORY_ENABLED` is checked. Dynamic-imports `@/memory` only when enabled,
// so disabled mode adds zero compile cost in Next dev.
//
// All callers fail-open: if memory is off, errors out, or times out, the
// caller's primary flow (generation, posting) proceeds unaffected.

type RecallContext = {
  block: string;
  citationCount: number;
  embedError: string | null;
};

const EMPTY_RECALL: RecallContext = {
  block: "",
  citationCount: 0,
  embedError: null,
};

export async function recallMemoryBlock(query: string): Promise<RecallContext> {
  if (!env.MEMORY_ENABLED) return EMPTY_RECALL;
  if (!query.trim()) return EMPTY_RECALL;

  const timeoutMs = env.MEMORY_RECALL_TIMEOUT_MS;
  const maxTokens = env.MEMORY_RECALL_MAX_TOKENS;

  const work = (async (): Promise<RecallContext> => {
    try {
      const mod = await import("@/memory");
      const result = await mod.recall({
        userId: mod.MEMORY_USER_ID,
        query,
        maxTokens,
      });
      return {
        block: result.context,
        citationCount: result.citations.length,
        embedError: result.embedError,
      };
    } catch (err) {
      console.error(
        "[memory-bridge] recall failed:",
        err instanceof Error ? err.message : err,
      );
      return EMPTY_RECALL;
    }
  })();

  const timeout = new Promise<RecallContext>((resolve) =>
    setTimeout(() => {
      console.warn(`[memory-bridge] recall timed out after ${timeoutMs}ms`);
      resolve(EMPTY_RECALL);
    }, timeoutMs),
  );

  return Promise.race([work, timeout]);
}

export type RecordTurnPayload = {
  sessionId: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  metadata?: Record<string, unknown>;
};

export async function recordMemoryTurn(
  payload: RecordTurnPayload,
): Promise<void> {
  if (!env.MEMORY_ENABLED) return;
  if (payload.messages.length === 0) return;

  const timeoutMs = env.MEMORY_RECORD_TIMEOUT_MS;

  const work = (async (): Promise<void> => {
    try {
      const mod = await import("@/memory");
      const result = await mod.recordTurn({
        userId: mod.MEMORY_USER_ID,
        sessionId: payload.sessionId,
        messages: payload.messages,
        metadata: payload.metadata,
      });
      if (result.embedError || result.extractionError) {
        console.warn("[memory-bridge] recordTurn partial:", {
          turnId: result.turnId,
          embedError: result.embedError,
          extractionError: result.extractionError,
        });
      }
    } catch (err) {
      console.error(
        "[memory-bridge] recordTurn failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  const timeout = new Promise<void>((resolve) =>
    setTimeout(() => {
      console.warn(`[memory-bridge] recordTurn timed out after ${timeoutMs}ms`);
      resolve();
    }, timeoutMs),
  );

  await Promise.race([work, timeout]);
}
