// One-shot helper: prints your Telegram chat_id by reading the most recent
// update sent to your bot. Requires TELEGRAM_BOT_TOKEN in .env.local and
// at least one message sent FROM you TO the bot in the last 24h.
//
// Usage:
//   1. Add TELEGRAM_BOT_TOKEN=... to .env.local
//   2. Open Telegram → find your bot → send /start (or any message)
//   3. Run: npx tsx scripts/tg-chat-id.mjs

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
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN not set in .env.local");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error("Telegram API error:", data.description ?? JSON.stringify(data));
  process.exit(1);
}

if (!Array.isArray(data.result) || data.result.length === 0) {
  console.error(
    "No updates yet. Send any message to your bot in Telegram first, then re-run.",
  );
  process.exit(1);
}

const seen = new Map();
for (const upd of data.result) {
  const msg = upd.message ?? upd.edited_message;
  if (!msg) continue;
  const chat = msg.chat;
  if (!chat) continue;
  const label =
    chat.type === "private"
      ? `@${chat.username ?? "?"} (${chat.first_name ?? ""} ${chat.last_name ?? ""})`.trim()
      : `[${chat.type}] ${chat.title ?? "?"}`;
  seen.set(chat.id, label);
}

if (seen.size === 0) {
  console.error("Got updates but none had a chat. Try sending a fresh message.");
  process.exit(1);
}

console.log("Chats that have messaged your bot recently:\n");
for (const [id, label] of seen.entries()) {
  console.log(`  chat_id: ${id}    ${label}`);
}
console.log("\nAdd the right one to .env.local:");
console.log(`  TELEGRAM_CHAT_ID=${[...seen.keys()][0]}`);

process.exit(0);
