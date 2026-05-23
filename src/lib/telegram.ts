import "server-only";
import { env } from "./env";

const TG_API = "https://api.telegram.org/bot";

export function isTelegramConfigured(): boolean {
  return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

type SendDraftInput = {
  postId: string;
  text: string;
  sourceLabel?: string; // "take on @karpathy", "QRT @gdb", "autonomous on @sama", etc.
  evalOverall?: number | null;
  // When set, the draft was auto-approved by the guardrail pipeline and is
  // scheduled to ship at this time. Notification shows an "unapprove" button
  // instead of the regular approve/skip pair.
  autoApprovedFor?: Date | null;
};

async function tgRequest(method: string, body: Record<string, unknown>): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    const res = await fetch(`${TG_API}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.text().catch(() => "");
      console.error(`[telegram] ${method} failed: ${res.status} ${data}`);
    }
  } catch (err) {
    console.error(`[telegram] ${method} threw:`, err);
  }
}

export async function sendDraftNotification(
  input: SendDraftInput,
): Promise<void> {
  if (!isTelegramConfigured()) return;

  const evalLine = input.evalOverall != null ? ` · eval ${input.evalOverall}/100` : "";
  const sourceLine = input.sourceLabel ? `_${input.sourceLabel}${evalLine}_\n\n` : "";
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const queueUrl = `${appUrl}/queue`;

  if (input.autoApprovedFor) {
    const whenLocal = input.autoApprovedFor.toISOString().replace("T", " ").slice(0, 16);
    const text = `🟢 *auto-approved* — ships at ${whenLocal} UTC\n\n${sourceLine}${input.text}`;
    await tgRequest("sendMessage", {
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "❌ unapprove (back to draft)", callback_data: `unapprove:${input.postId}` },
          ],
          [{ text: "🔍 open queue", url: queueUrl }],
        ],
      },
    });
    return;
  }

  const text = `🤖 *new draft*\n\n${sourceLine}${input.text}`;
  await tgRequest("sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ approve & ship", callback_data: `approve:${input.postId}` },
          { text: "⏭ skip", callback_data: `skip:${input.postId}` },
        ],
        [{ text: "🔍 open queue", url: queueUrl }],
      ],
    },
  });
}

export async function answerCallback(
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await tgRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function editMessage(
  chatId: number | string,
  messageId: number,
  newText: string,
): Promise<void> {
  await tgRequest("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    parse_mode: "Markdown",
  });
}
