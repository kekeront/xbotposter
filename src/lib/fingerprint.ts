import "server-only";

export type Fingerprint = {
  sampleCount: number;
  avgChars: number;
  avgWords: number;
  avgSentenceLengthWords: number;
  sentenceLengthP50: number;
  sentenceLengthP90: number;
  languageMix: {
    cyrillicPct: number;
    latinPct: number;
    kazakhMarkerCount: number;
    dominantLanguage: "ru" | "en" | "mixed";
  };
  emojiRatePerPost: number;
  emDashRatePerPost: number;
  drawnOutVowelCount: number;
  endsWithoutPeriodPct: number;
  questionRate: number;
  exclamationRate: number;
  ellipsisRate: number;
  topCasualMarkers: Array<{ marker: string; count: number }>;
};

const CASUAL_MARKERS = [
  "ботать",
  "чалить",
  "фигню",
  "фигня",
  "прочее прочее",
  "провсё",
  "норм",
  "красава",
  "ваще",
  "тааак",
  "ngl",
  "lowkey",
  "fr",
  "shoutout",
];

const KAZAKH_SPECIFIC = /[әғіңөұүһҚҒҺ]/g;
const CYRILLIC = /[Ѐ-ӿ]/g;
const LATIN = /[A-Za-z]/g;
const EM_DASH = /—/g;
const DRAWN_OUT_VOWEL_RU = /([аеиоуыэюяАЕИОУЫЭЮЯ])\1{2,}/g;
const DRAWN_OUT_VOWEL_EN = /([aeiouAEIOU])\1{2,}/g;
const EMOJI =
  /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]/gu;

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Number(((n / total) * 100).toFixed(1));
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function extractFingerprint(rawSamples: string[]): Fingerprint {
  const samples = rawSamples.map((s) => s.trim()).filter(Boolean);
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      avgChars: 0,
      avgWords: 0,
      avgSentenceLengthWords: 0,
      sentenceLengthP50: 0,
      sentenceLengthP90: 0,
      languageMix: {
        cyrillicPct: 0,
        latinPct: 0,
        kazakhMarkerCount: 0,
        dominantLanguage: "mixed",
      },
      emojiRatePerPost: 0,
      emDashRatePerPost: 0,
      drawnOutVowelCount: 0,
      endsWithoutPeriodPct: 0,
      questionRate: 0,
      exclamationRate: 0,
      ellipsisRate: 0,
      topCasualMarkers: [],
    };
  }

  let totalChars = 0;
  let cyrillicChars = 0;
  let latinChars = 0;
  let kazakhSpecific = 0;
  let emojiCount = 0;
  let emDashCount = 0;
  let drawnOutVowelCount = 0;
  let postsWithoutTrailingPeriod = 0;
  let questionPosts = 0;
  let exclamationPosts = 0;
  let ellipsisPosts = 0;
  const sentenceLengths: number[] = [];
  const wordCounts: number[] = [];

  for (const s of samples) {
    totalChars += s.length;
    cyrillicChars += (s.match(CYRILLIC) ?? []).length;
    latinChars += (s.match(LATIN) ?? []).length;
    kazakhSpecific += (s.match(KAZAKH_SPECIFIC) ?? []).length;
    emojiCount += (s.match(EMOJI) ?? []).length;
    emDashCount += (s.match(EM_DASH) ?? []).length;
    drawnOutVowelCount +=
      (s.match(DRAWN_OUT_VOWEL_RU) ?? []).length +
      (s.match(DRAWN_OUT_VOWEL_EN) ?? []).length;

    const trimmed = s.trim();
    const lastChar = trimmed.slice(-1);
    if (![".", "!", "?", ")", "…"].includes(lastChar) && !EMOJI.test(lastChar)) {
      postsWithoutTrailingPeriod += 1;
    }
    if (s.includes("?")) questionPosts += 1;
    if (s.includes("!")) exclamationPosts += 1;
    if (s.includes("…") || s.includes("...")) ellipsisPosts += 1;

    const sentences = s.split(/[.!?]+/).filter(Boolean);
    for (const sent of sentences) {
      const words = sent.trim().split(/\s+/).filter(Boolean);
      if (words.length > 0) sentenceLengths.push(words.length);
    }

    wordCounts.push(s.trim().split(/\s+/).filter(Boolean).length);
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

  const cyrillicPctValue = pct(cyrillicChars, totalChars);
  const latinPctValue = pct(latinChars, totalChars);
  let dominant: "ru" | "en" | "mixed" = "mixed";
  if (cyrillicPctValue > latinPctValue * 2) dominant = "ru";
  else if (latinPctValue > cyrillicPctValue * 2) dominant = "en";

  const allText = samples.join(" ").toLowerCase();
  const markerHits = CASUAL_MARKERS.map((m) => ({
    marker: m,
    count: (allText.match(new RegExp(m.toLowerCase(), "g")) ?? []).length,
  }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    sampleCount: samples.length,
    avgChars: Number(avg(samples.map((s) => s.length)).toFixed(1)),
    avgWords: Number(avg(wordCounts).toFixed(1)),
    avgSentenceLengthWords: Number(avg(sentenceLengths).toFixed(1)),
    sentenceLengthP50: percentile(sentenceLengths, 50),
    sentenceLengthP90: percentile(sentenceLengths, 90),
    languageMix: {
      cyrillicPct: cyrillicPctValue,
      latinPct: latinPctValue,
      kazakhMarkerCount: kazakhSpecific,
      dominantLanguage: dominant,
    },
    emojiRatePerPost: Number((emojiCount / samples.length).toFixed(2)),
    emDashRatePerPost: Number((emDashCount / samples.length).toFixed(2)),
    drawnOutVowelCount,
    endsWithoutPeriodPct: pct(postsWithoutTrailingPeriod, samples.length),
    questionRate: pct(questionPosts, samples.length),
    exclamationRate: pct(exclamationPosts, samples.length),
    ellipsisRate: pct(ellipsisPosts, samples.length),
    topCasualMarkers: markerHits,
  };
}

export function fingerprintToPromptBlock(fp: Fingerprint): string {
  if (fp.sampleCount === 0) return "";
  const lines = [
    `EXTRACTED FINGERPRINT (from ${fp.sampleCount} reference posts):`,
    `- avg length: ${fp.avgChars} chars / ${fp.avgWords} words`,
    `- sentence length: median ${fp.sentenceLengthP50} words, p90 ${fp.sentenceLengthP90} words`,
    `- language: ${fp.languageMix.dominantLanguage} dominant (cyrillic ${fp.languageMix.cyrillicPct}% / latin ${fp.languageMix.latinPct}%${fp.languageMix.kazakhMarkerCount > 0 ? `, ${fp.languageMix.kazakhMarkerCount} kazakh-specific chars` : ""})`,
    `- emoji rate: ${fp.emojiRatePerPost} per post`,
    `- em-dash rate: ${fp.emDashRatePerPost} per post`,
    `- ends without period: ${fp.endsWithoutPeriodPct}% of posts`,
    `- question / exclamation / ellipsis: ${fp.questionRate}% / ${fp.exclamationRate}% / ${fp.ellipsisRate}%`,
  ];
  if (fp.drawnOutVowelCount > 0) {
    lines.push(`- drawn-out vowels (Фууух style): ${fp.drawnOutVowelCount} instances`);
  }
  if (fp.topCasualMarkers.length > 0) {
    lines.push(
      `- casual markers used: ${fp.topCasualMarkers.map((m) => `"${m.marker}" (${m.count})`).join(", ")}`,
    );
  }
  lines.push(
    "",
    "Match these stats. Drift toward median sentence length. Don't blow past avg length. Use emojis at the observed rate, not more.",
  );
  return lines.join("\n");
}
