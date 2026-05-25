"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function disconnectProvider(connectionId: string) {
  const user = await requireUser();

  await db
    .delete(socialConnections)
    .where(
      and(
        eq(socialConnections.id, connectionId),
        eq(socialConnections.userId, user.id),
      ),
    );

  revalidatePath("/settings/connections");
}
