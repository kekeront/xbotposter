import "server-only";
import { TwitterApi } from "twitter-api-v2";
import { requireEnv } from "./env";

let _client: TwitterApi | undefined;

export function getXClient(): TwitterApi {
  if (_client) return _client;
  _client = new TwitterApi({
    appKey: requireEnv("X_CONSUMER_KEY"),
    appSecret: requireEnv("X_CONSUMER_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
  });
  return _client;
}

export type PostedTweet = { id: string; text: string };

export async function postTweet(
  text: string,
  opts?: { replyToTweetId?: string; quoteTweetId?: string },
): Promise<PostedTweet> {
  const client = getXClient();
  const res = await client.v2.tweet(text, {
    ...(opts?.replyToTweetId
      ? { reply: { in_reply_to_tweet_id: opts.replyToTweetId } }
      : {}),
    ...(opts?.quoteTweetId ? { quote_tweet_id: opts.quoteTweetId } : {}),
  });
  return { id: res.data.id, text: res.data.text };
}

export async function postThread(texts: string[]): Promise<PostedTweet[]> {
  const results: PostedTweet[] = [];
  let replyTo: string | undefined;
  for (const text of texts) {
    const result = await postTweet(text, { replyToTweetId: replyTo });
    results.push(result);
    replyTo = result.id;
  }
  return results;
}

export type XUserLite = {
  id: string;
  username: string;
  name: string;
};

export async function userByUsername(username: string): Promise<XUserLite | null> {
  const client = getXClient();
  try {
    const res = await client.v2.userByUsername(username);
    if (!res.data) return null;
    return {
      id: res.data.id,
      username: res.data.username,
      name: res.data.name,
    };
  } catch (err) {
    if (err instanceof Error && /not found|404/i.test(err.message)) return null;
    throw err;
  }
}

export type XTimelineTweet = {
  id: string;
  text: string;
  createdAt: string | null;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    quotes: number;
    bookmarks: number;
    impressions: number;
  };
  isReply: boolean;
  isRetweet: boolean;
  isQuote: boolean;
};

export async function userTimeline(
  userId: string,
  opts?: { max?: number },
): Promise<XTimelineTweet[]> {
  const client = getXClient();
  const max = opts?.max ?? 10;
  const res = await client.v2.userTimeline(userId, {
    max_results: Math.max(5, Math.min(100, max)),
    "tweet.fields": [
      "public_metrics",
      "created_at",
      "referenced_tweets",
    ],
    exclude: ["retweets", "replies"],
  });

  const out: XTimelineTweet[] = [];
  for (const t of res.data.data ?? []) {
    const refs = t.referenced_tweets ?? [];
    const m = t.public_metrics;
    out.push({
      id: t.id,
      text: t.text,
      createdAt: t.created_at ?? null,
      metrics: {
        likes: m?.like_count ?? 0,
        retweets: m?.retweet_count ?? 0,
        replies: m?.reply_count ?? 0,
        quotes: m?.quote_count ?? 0,
        bookmarks: m?.bookmark_count ?? 0,
        impressions: m?.impression_count ?? 0,
      },
      isReply: refs.some((r) => r.type === "replied_to"),
      isRetweet: refs.some((r) => r.type === "retweeted"),
      isQuote: refs.some((r) => r.type === "quoted"),
    });
  }

  return out;
}
