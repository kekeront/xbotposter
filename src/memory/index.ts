// Public API for the memory layer. Import from `@/memory` not internal files.
// Lazy-load this module via dynamic import in hot paths — `MEMORY_ENABLED`
// gates the import so disabled mode adds zero compile cost.

export { recordTurn } from "./store";
export type { RecordTurnInput, RecordTurnResult, TurnMessage } from "./store";

export { recall, listUserMemories, listRecentTurns } from "./recall";
export type {
  RecallInput,
  RecallResult,
  RecallCitation,
  ListMemoriesResult,
} from "./recall";

export { canonicaliseSlot } from "./slots";
export type { MemoryType, MemoryRole } from "./schema";

export const MEMORY_USER_ID = "kekeront";
