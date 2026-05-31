import "server-only";
import { draft as writerDraft } from "@/agents/writer";
import {
  recommendViralTopics,
  type ViralTopic,
} from "@/agents/viral-topics";
import { loadDiscoveryFeed } from "@/lib/discovery-feed";
import { loadDefaultVoice } from "@/lib/voice-load";

export type WaveShot = ViralTopic & {
  texts: string[];
  model: string;
  costUsd: number;
};

export type WaveShotResult = {
  shots: WaveShot[];
  basedOn: number;
  topicsCostUsd: number;
  previewCostUsd: number;
  totalCostUsd: number;
};

// Riding the viral wave: read the top of the discovery feed, recommend N
// distinct topics, and draft a quick writer-only PREVIEW for each. Full
// edit/eval/fact-check is intentionally deferred to when a preview is promoted.
export async function runWaveShot(
  userId: string,
  opts?: { count?: number },
): Promise<WaveShotResult> {
  const count = opts?.count ?? 3;

  const [voice, feed] = await Promise.all([
    loadDefaultVoice(),
    loadDiscoveryFeed(userId, { sort: "engagement", limit: 40 }),
  ]);

  if (feed.items.length === 0) {
    return {
      shots: [],
      basedOn: 0,
      topicsCostUsd: 0,
      previewCostUsd: 0,
      totalCostUsd: 0,
    };
  }

  const rec = await recommendViralTopics({
    items: feed.items.map((it) => ({
      kind: it.kind,
      author: it.author,
      text: it.text,
      score: it.score,
    })),
    count,
    fingerprintBlock: voice.fingerprintBlock,
  });

  const shots = await Promise.all(
    rec.topics.map(async (t): Promise<WaveShot> => {
      const d = await writerDraft({
        topic: t.topic,
        contentType: "single",
        referenceTweets: voice.referenceTweets,
        fingerprintBlock: voice.fingerprintBlock,
      });
      return {
        ...t,
        texts: d.texts,
        model: d.model,
        costUsd: d.costUsd,
      };
    }),
  );

  const previewCostUsd = shots.reduce((s, x) => s + x.costUsd, 0);
  return {
    shots,
    basedOn: feed.items.length,
    topicsCostUsd: rec.costUsd,
    previewCostUsd,
    totalCostUsd: rec.costUsd + previewCostUsd,
  };
}
