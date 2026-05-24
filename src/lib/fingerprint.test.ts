import { describe, it, expect } from "vitest";
import { extractFingerprint, fingerprintToPromptBlock } from "./fingerprint";

describe("extractFingerprint", () => {
  it("returns zeroed fingerprint for empty input", () => {
    const fp = extractFingerprint([]);
    expect(fp.sampleCount).toBe(0);
    expect(fp.avgChars).toBe(0);
    expect(fp.avgWords).toBe(0);
    expect(fp.languageMix.dominantLanguage).toBe("mixed");
    expect(fp.topCasualMarkers).toEqual([]);
  });

  it("filters out blank/whitespace-only samples", () => {
    const fp = extractFingerprint(["", "   ", "\n"]);
    expect(fp.sampleCount).toBe(0);
  });

  it("calculates correct stats for a single Russian sample", () => {
    const fp = extractFingerprint(["Пора чалить кодинг и прочее прочее"]);
    expect(fp.sampleCount).toBe(1);
    expect(fp.avgChars).toBeGreaterThan(0);
    expect(fp.avgWords).toBeGreaterThan(0);
    expect(fp.languageMix.dominantLanguage).toBe("ru");
    expect(fp.languageMix.cyrillicPct).toBeGreaterThan(50);
  });

  it("detects English-dominant text", () => {
    const fp = extractFingerprint([
      "Small models are closing the gap on narrow tasks",
      "Shipped the new deploy pipeline today",
    ]);
    expect(fp.languageMix.dominantLanguage).toBe("en");
    expect(fp.languageMix.latinPct).toBeGreaterThan(50);
  });

  it("detects mixed language when close", () => {
    const fp = extractFingerprint([
      "Буду чалить LLM deploy pipeline сегодня вечером ngl",
    ]);
    expect(fp.languageMix.cyrillicPct).toBeGreaterThan(0);
    expect(fp.languageMix.latinPct).toBeGreaterThan(0);
  });

  it("counts emoji correctly", () => {
    const fp = extractFingerprint(["один пост 🔥", "второй пост 😭🤌"]);
    expect(fp.emojiRatePerPost).toBe(1.5);
  });

  it("counts em-dashes", () => {
    const fp = extractFingerprint(["один — два — три"]);
    expect(fp.emDashRatePerPost).toBe(2);
  });

  it("detects drawn-out vowels in Russian", () => {
    const fp = extractFingerprint(["Фуууух, каникулы"]);
    expect(fp.drawnOutVowelCount).toBeGreaterThan(0);
  });

  it("detects drawn-out vowels in English", () => {
    const fp = extractFingerprint(["sooooo tired today"]);
    expect(fp.drawnOutVowelCount).toBeGreaterThan(0);
  });

  it("tracks ends-without-period percentage", () => {
    const fp = extractFingerprint([
      "без точки",
      "с точкой.",
      "вопрос?",
    ]);
    expect(fp.endsWithoutPeriodPct).toBeCloseTo(33.3, 0);
  });

  it("tracks question/exclamation/ellipsis rates", () => {
    const fp = extractFingerprint([
      "Что делать?",
      "Круто!",
      "Ну вот...",
      "Просто текст",
    ]);
    expect(fp.questionRate).toBe(25);
    expect(fp.exclamationRate).toBe(25);
    expect(fp.ellipsisRate).toBe(25);
  });

  it("detects casual markers", () => {
    const fp = extractFingerprint([
      "пора ботать",
      "чалить код",
      "это всё фигню какую-то",
      "ngl this is lowkey good fr",
    ]);
    const markerNames = fp.topCasualMarkers.map((m) => m.marker);
    expect(markerNames).toContain("ботать");
    expect(markerNames).toContain("чалить");
    expect(markerNames).toContain("фигню");
    expect(markerNames).toContain("ngl");
    expect(markerNames).toContain("fr");
  });

  it("limits casual markers to top 8", () => {
    const fp = extractFingerprint([
      "ботать чалить фигню фигня прочее прочее провсё норм красава ваще тааак ngl lowkey fr shoutout extra extra",
    ]);
    expect(fp.topCasualMarkers.length).toBeLessThanOrEqual(8);
  });

  it("detects Kazakh-specific characters", () => {
    const fp = extractFingerprint(["Сәлем, бәрі жақсы ма?"]);
    expect(fp.languageMix.kazakhMarkerCount).toBeGreaterThan(0);
  });

  it("calculates sentence length percentiles", () => {
    const fp = extractFingerprint([
      "Short. This one is a bit longer sentence with many words.",
    ]);
    expect(fp.sentenceLengthP50).toBeGreaterThan(0);
    expect(fp.sentenceLengthP90).toBeGreaterThanOrEqual(fp.sentenceLengthP50);
  });

  it("handles multiple samples averaging correctly", () => {
    const fp = extractFingerprint([
      "a",         // 1 char
      "abc def",   // 7 chars
    ]);
    expect(fp.avgChars).toBe(4);
    expect(fp.avgWords).toBe(1.5);
  });
});

describe("fingerprintToPromptBlock", () => {
  it("returns empty string for zero-sample fingerprint", () => {
    const fp = extractFingerprint([]);
    expect(fingerprintToPromptBlock(fp)).toBe("");
  });

  it("produces a formatted block for valid fingerprint", () => {
    const fp = extractFingerprint([
      "Пора чалить кодинг и прочее прочее 🔥",
      "Меня бесит что Claude отказывается делать свою работу",
    ]);
    const block = fingerprintToPromptBlock(fp);
    expect(block).toContain("EXTRACTED FINGERPRINT");
    expect(block).toContain("from 2 reference posts");
    expect(block).toContain("avg length:");
    expect(block).toContain("sentence length:");
    expect(block).toContain("language:");
    expect(block).toContain("emoji rate:");
    expect(block).toContain("casual markers used:");
    expect(block).toContain("Match these stats");
  });

  it("includes drawn-out vowel line when present", () => {
    const fp = extractFingerprint(["Фуууууух каникулы"]);
    const block = fingerprintToPromptBlock(fp);
    expect(block).toContain("drawn-out vowels");
  });

  it("omits drawn-out vowel line when zero", () => {
    const fp = extractFingerprint(["Простой текст без растяжек"]);
    const block = fingerprintToPromptBlock(fp);
    expect(block).not.toContain("drawn-out vowels");
  });

  it("includes kazakh-specific char count when present", () => {
    const fp = extractFingerprint(["Сәлем әлем"]);
    const block = fingerprintToPromptBlock(fp);
    expect(block).toContain("kazakh-specific chars");
  });
});
