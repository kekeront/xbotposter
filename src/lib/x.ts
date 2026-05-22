import "server-only";
import { TwitterApi } from "twitter-api-v2";
import { requireEnv } from "./env";

let _client: TwitterApi | undefined;

export function getXClient(): TwitterApi {
  if (_client) return _client;
  _client = new TwitterApi({
    appKey: requireEnv("X_API_KEY"),
    appSecret: requireEnv("X_API_SECRET"),
    accessToken: requireEnv("X_ACCESS_TOKEN"),
    accessSecret: requireEnv("X_ACCESS_TOKEN_SECRET"),
  });
  return _client;
}

export type PostedTweet = { id: string; text: string };

export async function postTweet(
  text: string,
  opts?: { replyToTweetId?: string },
): Promise<PostedTweet> {
  const client = getXClient();
  const res = await client.v2.tweet(text, {
    reply: opts?.replyToTweetId
      ? { in_reply_to_tweet_id: opts.replyToTweetId }
      : undefined,
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
