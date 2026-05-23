// Sends a test notification to verify TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// are wired correctly. Same shape as a real draft notification from
// cron/generate, minus the actual postId.

import { readFileSync } from "node:fs";

function loadEnv(p) {
  try {
    for (const l of readFileSync(p, "utf-8").split(/\r?\n/)) {
      if (!l || l.startsWith("#")) continue;
      const e = l.indexOf("=");
      if (e < 0) continue;
      const k = l.slice(0, e).trim();
      let v = l.slice(e + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnv(".env.local");
loadEnv(".env");

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!token || !chatId) {
  console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env.local");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text:
      "🤖 *test from nfactz*\n\n" +
      "_autonomous take on @karpathy · eval 87/100_\n\n" +
      "Если этот тест дошёл — значит cron/generate сможет писать тебе сюда " +
      "каждый новый draft. Approve / skip кнопки заработают после deploy " +
      "и setWebhook.",
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ approve & ship (mock)",
            callback_data: "approve:test-mock-id",
          },
          { text: "⏭ skip (mock)", callback_data: "skip:test-mock-id" },
        ],
      ],
    },
  }),
});

const data = await res.json();
if (!res.ok || !data.ok) {
  console.error("FAILED:", JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(
  `✅ sent. Telegram message_id=${data.result.message_id} to chat=${data.result.chat.id}`,
);
console.log("Check your Telegram now.");
process.exit(0);
