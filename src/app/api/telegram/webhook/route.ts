import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { generations, posts } from "@/db/schema";
import { env } from "@/lib/env";
import { extractMemoriesFromPost } from "@/lib/memory-extract";
import { shipPostById } from "@/lib/poster";
import { answerCallback, editMessage } from "@/lib/telegram";
import { writeTrace } from "@/lib/trace";

type TelegramUpdate = {
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: { id: number };
      message_id: number;
      text?: string;
    };
  };
};

export async function POST(request: Request) {
  // Webhook secret in query string — Telegram sends the body to the URL
  // unchanged, so we use ?secret=... rather than a signed header.
  const url = new URL(request.url);
  const provided = url.searchParams.get("secret");
  if (!env.TELEGRAM_WEBHOOK_SECRET || provided !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const cb = update.callback_query;
  if (!cb || !cb.data || !cb.message) {
    // Not a callback we handle. ACK and move on.
    return Response.json({ ok: true });
  }

  const [action, postId] = cb.data.split(":");
  if (!action || !postId) {
    await answerCallback(cb.id, "bad callback");
    return Response.json({ ok: true });
  }

  const originalText = cb.message.text ?? "";
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;

  if (action === "approve") {
    const result = await shipPostById(postId);
    await writeTrace({
      generationId: null,
      agent: "telegram",
      eventType: result.ok ? "shipped" : "ship_failed",
      payload: {
        postId,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
      },
    });
    if (result.ok) {
      const tweetId = result.xTweetIds[0];
      await answerCallback(cb.id, "✅ shipped");
      await editMessage(
        chatId,
        messageId,
        `${originalText}\n\n— ✅ shipped${tweetId ? ` · https://x.com/i/web/status/${tweetId}` : ""}`,
      );
    } else {
      await answerCallback(cb.id, `❌ ${result.error}`);
      await editMessage(
        chatId,
        messageId,
        `${originalText}\n\n— ❌ ship failed: ${result.error}`,
      );
    }
  } else if (action === "unapprove") {
    // Revert auto-approved post back to draft. Safe even if it already
    // shipped (no-op if status moved on) — we explicitly only flip
    // approved/scheduled rows so we never roll back a posted tweet.
    const existing = await db
      .select({ status: posts.status, text: posts.text, generationId: posts.generationId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    const current = existing[0]?.status;

    if (current === "approved" || current === "scheduled") {
      await db
        .update(posts)
        .set({ status: "draft", scheduledFor: null, updatedAt: new Date() })
        .where(eq(posts.id, postId));
      await writeTrace({
        generationId: existing[0]?.generationId ?? null,
        agent: "telegram",
        eventType: "unapproved",
        payload: { postId, from: current },
      });
      void recordRejectionSignal({
        postId,
        text: existing[0]!.text,
        generationId: existing[0]!.generationId,
        outcome: "unapproved",
      });
      await answerCallback(cb.id, "↩ back to draft");
      await editMessage(chatId, messageId, `${originalText}\n\n— ↩ unapproved (back to draft)`);
    } else {
      await answerCallback(cb.id, `cannot unapprove (status=${current ?? "?"})`);
    }
  } else if (action === "skip") {
    const existing = await db
      .select({ text: posts.text, generationId: posts.generationId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    await db
      .update(posts)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(eq(posts.id, postId));
    await writeTrace({
      generationId: existing[0]?.generationId ?? null,
      agent: "telegram",
      eventType: "skipped",
      payload: { postId },
    });
    if (existing[0]) {
      void recordRejectionSignal({
        postId,
        text: existing[0].text,
        generationId: existing[0].generationId,
        outcome: "skipped",
      });
    }
    await answerCallback(cb.id, "⏭ skipped");
    await editMessage(chatId, messageId, `${originalText}\n\n— ⏭ skipped`);
  } else {
    await answerCallback(cb.id, `unknown action: ${action}`);
  }

  return Response.json({ ok: true });
}

async function recordRejectionSignal(input: {
  postId: string;
  text: string;
  generationId: string | null;
  outcome: "skipped" | "unapproved";
}): Promise<void> {
  try {
    let topic: string | null = null;
    if (input.generationId) {
      const g = await db
        .select({ topic: generations.topic })
        .from(generations)
        .where(eq(generations.id, input.generationId))
        .limit(1);
      topic = g[0]?.topic ?? null;
    }
    const result = await extractMemoriesFromPost({
      postText: input.text,
      topic,
      outcome: input.outcome,
      sourceId: input.postId,
    });
    await writeTrace({
      generationId: input.generationId,
      agent: "memory-extract",
      eventType: "complete",
      payload: {
        postId: input.postId,
        outcome: input.outcome,
        extracted: result.extracted.length,
        recorded: result.recorded,
      },
      model: result.model,
      costUsd: result.costUsd.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await writeTrace({
      generationId: input.generationId,
      agent: "memory-extract",
      eventType: "error",
      payload: { postId: input.postId, outcome: input.outcome, message },
    });
  }
}
