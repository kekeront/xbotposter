import { TwitterApi } from "twitter-api-v2";
import { readFileSync } from "node:fs";

// Manual .env.local loader (avoid @next/env ESM issues).
function loadDotenv(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadDotenv(".env.local");
loadDotenv(".env");

const client = new TwitterApi({
  appKey: process.env.X_CONSUMER_KEY,
  appSecret: process.env.X_CONSUMER_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

async function tryCall(label, fn) {
  console.log(`\n→ ${label}`);
  const start = Date.now();
  try {
    const res = await fn();
    console.log(`  OK in ${Date.now() - start}ms`);
    return res;
  } catch (err) {
    console.error(`  ERROR after ${Date.now() - start}ms`);
    console.error("  message:", err.message || String(err));
    if (err.data) console.error("  data:", JSON.stringify(err.data, null, 2));
    if (err.code) console.error("  code:", err.code);
    return null;
  }
}

const userRes = await tryCall("userByUsername('karpathy')", () =>
  client.v2.userByUsername("karpathy"),
);

if (userRes?.data?.id) {
  const tlRes = await tryCall(
    `userTimeline(${userRes.data.id}, max=5)`,
    () =>
      client.v2.userTimeline(userRes.data.id, {
        max_results: 5,
        "tweet.fields": ["public_metrics", "created_at", "referenced_tweets"],
        exclude: ["retweets", "replies"],
      }),
  );
  if (tlRes) {
    const tweets = tlRes.data?.data ?? [];
    console.log(`  → ${tweets.length} tweets returned`);
    if (tweets[0]) {
      console.log(`  first tweet: "${tweets[0].text.slice(0, 80)}..."`);
      console.log(`  metrics:`, tweets[0].public_metrics);
    }
  }
}

process.exit(0);
