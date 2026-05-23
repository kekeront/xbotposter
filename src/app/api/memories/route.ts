import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { memories, MEMORY_TYPE, type MemoryType } from "@/db/schema";

const VALID_TYPES = new Set<string>(MEMORY_TYPE);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const typeRaw = url.searchParams.get("type");
  const showSuperseded = url.searchParams.get("showSuperseded") === "1";
  const search = url.searchParams.get("q")?.trim() ?? "";

  const whereParts = [];
  if (!showSuperseded) whereParts.push(isNull(memories.supersededAt));
  if (typeRaw && VALID_TYPES.has(typeRaw)) {
    whereParts.push(eq(memories.type, typeRaw as MemoryType));
  }
  if (search) {
    whereParts.push(
      sql`(${memories.slot} ILIKE ${`%${search}%`} OR ${memories.content} ILIKE ${`%${search}%`})`,
    );
  }

  const rows = await db
    .select({
      id: memories.id,
      type: memories.type,
      slot: memories.slot,
      content: memories.content,
      confidence: memories.confidence,
      sourceKind: memories.sourceKind,
      sourceId: memories.sourceId,
      metadata: memories.metadata,
      supersededBy: memories.supersededBy,
      supersededAt: memories.supersededAt,
      createdAt: memories.createdAt,
    })
    .from(memories)
    .where(whereParts.length > 0 ? and(...whereParts) : undefined)
    .orderBy(
      asc(memories.type),
      desc(memories.confidence),
      desc(memories.createdAt),
    )
    .limit(200);

  const counts = await db
    .select({
      type: memories.type,
      n: sql<number>`count(*)::int`,
    })
    .from(memories)
    .where(isNull(memories.supersededAt))
    .groupBy(memories.type);

  const countsByType: Record<MemoryType, number> = {
    fact: 0,
    preference: 0,
    opinion: 0,
    event: 0,
  };
  for (const c of counts) countsByType[c.type] = c.n;

  return Response.json({ rows, counts: countsByType });
}
