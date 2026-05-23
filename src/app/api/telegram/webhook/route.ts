import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { env } from "@/lib/env";
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
  } else if (action === "skip") {
    await db
      .update(posts)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(eq(posts.id, postId));
    await writeTrace({
      generationId: null,
      agent: "telegram",
      eventType: "skipped",
      payload: { postId },
    });
    await answerCallback(cb.id, "⏭ skipped");
    await editMessage(chatId, messageId, `${originalText}\n\n— ⏭ skipped`);
  } else {
    await answerCallback(cb.id, `unknown action: ${action}`);
  }

  return Response.json({ ok: true });
}
