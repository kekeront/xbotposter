import "server-only";
import { costFor, getOpenAIClient } from "@/lib/llm";
import { env } from "@/lib/env";

// ─── Constants ───────────────────────────────────────────────────────────────

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const UPLOAD_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type UploadMimeType = (typeof UPLOAD_ALLOWED_MIME_TYPES)[number];

// ─── Types ───────────────────────────────────────────────────────────────────

export type UploadInput = {
  bytes: Uint8Array | Buffer;
  mimeType: string;
  filename: string;
};

export type ParseUploadResult = {
  title: string;
  text: string;
  kind: "pdf" | "image";
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString("base64");
}

function isAllowedMime(mime: string): mime is UploadMimeType {
  return (UPLOAD_ALLOWED_MIME_TYPES as ReadonlyArray<string>).includes(mime);
}

// ─── Image parsing via chat.completions (vision) ─────────────────────────────

async function parseImage(
  input: UploadInput,
): Promise<ParseUploadResult> {
  const client = getOpenAIClient();
  const model = env.LLM_MID_MODEL;
  const b64 = toBase64(input.bytes);
  const dataUrl = `data:${input.mimeType};base64,${b64}`;

  const response = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Extract all readable text from this image verbatim. Then on a new line starting with "TITLE:" write a concise 5-10 word descriptive title for the content. Format:\n\n<extracted text>\n\nTITLE: <short title>',
            },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "auto" },
            },
          ],
        },
      ],
      max_completion_tokens: 4096,
    },
    { timeout: 60_000 },
  );

  const raw = response.choices[0]?.message.content ?? "";
  const tokensIn = response.usage?.prompt_tokens ?? 0;
  const tokensOut = response.usage?.completion_tokens ?? 0;
  const costUsd = costFor(model, tokensIn, tokensOut);

  const { title, text } = extractTitleAndText(raw, input.filename);

  return { title, text, kind: "image", tokensIn, tokensOut, costUsd };
}

// ─── PDF parsing via responses API (input_file with base64 file_data) ────────

async function parsePdf(
  input: UploadInput,
): Promise<ParseUploadResult> {
  const client = getOpenAIClient();
  const model = env.LLM_MID_MODEL;
  const b64 = toBase64(input.bytes);

  const response = await client.responses.create(
    {
      model,
      // Bounded digest, not a verbatim dump: a full transcription of a large
      // PDF is slow/expensive and pointless here — uploaded sources are used as
      // a short research-context snippet downstream. Cap output (reasoning-safe).
      max_output_tokens: 2500,
      // Summarizing a document needs no deliberation — minimal reasoning cuts
      // latency a lot on large PDFs (~18s→~11s on a 50-page paper). The input
      // floor is the doc itself: the model still reads every page.
      reasoning: { effort: "minimal" },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: input.filename,
              file_data: `data:${input.mimeType};base64,${b64}`,
            },
            {
              type: "input_text",
              text: 'Summarize this PDF into a concise digest usable as a writing source: the main points, key facts, names, numbers, and conclusions — about 150-250 words, skimmable. Then on a new line starting with "TITLE:" write a concise 5-10 word descriptive title. Format:\n\n<digest>\n\nTITLE: <short title>',
            },
          ],
        },
      ],
    },
    { timeout: 90_000 },
  );

  const raw = response.output_text ?? "";
  const tokensIn = response.usage?.input_tokens ?? 0;
  const tokensOut = response.usage?.output_tokens ?? 0;
  const costUsd = costFor(model, tokensIn, tokensOut);

  const { title, text } = extractTitleAndText(raw, input.filename);

  return { title, text, kind: "pdf", tokensIn, tokensOut, costUsd };
}

// ─── Title / text split ───────────────────────────────────────────────────────

function extractTitleAndText(
  raw: string,
  fallbackFilename: string,
): { title: string; text: string } {
  const titleMatch = /\nTITLE:\s*(.+)$/im.exec(raw);
  const title = titleMatch
    ? titleMatch[1].trim()
    : fallbackFilename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

  // Strip the TITLE line from the extracted text
  const text = raw.replace(/\nTITLE:.*$/im, "").trim();

  return { title: title || fallbackFilename, text: text || raw.trim() };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an uploaded file (PDF or image) through OpenAI and return extracted text.
 *
 * - Images use `chat.completions` with a base64 vision content part.
 * - PDFs use the `responses` API with an `input_file` base64 payload.
 *
 * Throws a plain `Error` with a `.status` property set to 400 for validation
 * failures (bad mime type, file too large) so callers can map it to HTTP 400.
 */
export async function parseUpload(
  input: UploadInput,
): Promise<ParseUploadResult> {
  if (input.bytes.length > UPLOAD_MAX_BYTES) {
    const err = new Error(
      `File too large: ${input.bytes.length} bytes (max ${UPLOAD_MAX_BYTES} bytes / 10 MB)`,
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  if (!isAllowedMime(input.mimeType)) {
    const err = new Error(
      `Unsupported file type: ${input.mimeType}. Allowed: ${UPLOAD_ALLOWED_MIME_TYPES.join(", ")}`,
    );
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  if (input.mimeType === "application/pdf") {
    return parsePdf(input);
  }

  return parseImage(input);
}
