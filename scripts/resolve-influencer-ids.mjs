// Resolves usernames in src/config/influencers.ts to user IDs and prints
// an updated config block. Paste the output back to skip future
// userByUsername X API calls (saves ~50% of discover read cost).

import { TwitterApi } from "twitter-api-v2";
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

const client = new TwitterApi({
  appKey: process.env.X_CONSUMER_KEY,
  appSecret: process.env.X_CONSUMER_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
});

const handles = [
  { username: "karpathy", name: "Andrej Karpathy", topic: "ai-research" },
  { username: "ylecun", name: "Yann LeCun", topic: "ai-research" },
  { username: "sama", name: "Sam Altman", topic: "ai-ceo" },
  { username: "gdb", name: "Greg Brockman", topic: "ai-ceo" },
  { username: "DrJimFan", name: "Jim Fan", topic: "ai-research" },
  { username: "paulg", name: "Paul Graham", topic: "startups" },
  { username: "swyx", name: "Shawn Wang", topic: "ai-eng" },
  { username: "jeremyphoward", name: "Jeremy Howard", topic: "ml" },
  { username: "soumithchintala", name: "Soumith Chintala", topic: "ml-infra" },
  { username: "andrew_n_carr", name: "Andrew Carr", topic: "ai-research" },
];

console.log("// Paste this into src/config/influencers.ts INFLUENCERS array:");
console.log("");

for (const h of handles) {
  try {
    const res = await client.v2.userByUsername(h.username);
    const id = res.data?.id ?? null;
    if (id) {
      console.log(`  { username: "${h.username}", id: "${id}", name: "${h.name}", topic: "${h.topic}" },`);
    } else {
      console.log(`  // ⚠ @${h.username} not found`);
    }
  } catch (err) {
    console.log(`  // ⚠ @${h.username} errored: ${err.message ?? String(err)}`);
  }
}

process.exit(0);
