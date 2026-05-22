import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fingerprints } from "@/db/schema";
import {
  extractFingerprint,
  type Fingerprint,
  fingerprintToPromptBlock,
} from "./fingerprint";

type FingerprintProfile = {
  referenceTweets?: string[];
  fingerprint?: Fingerprint;
};

export type LoadedVoice = {
  referenceTweets: string[];
  fingerprint: Fingerprint | null;
  fingerprintBlock: string;
};

export async function loadDefaultVoice(): Promise<LoadedVoice> {
  const rows = await db
    .select()
    .from(fingerprints)
    .where(eq(fingerprints.name, "default"))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { referenceTweets: [], fingerprint: null, fingerprintBlock: "" };
  }
  const profile = row.profile as FingerprintProfile;
  const refs = profile.referenceTweets ?? [];
  const fp =
    profile.fingerprint ?? (refs.length > 0 ? extractFingerprint(refs) : null);
  return {
    referenceTweets: refs,
    fingerprint: fp,
    fingerprintBlock: fp ? fingerprintToPromptBlock(fp) : "",
  };
}
