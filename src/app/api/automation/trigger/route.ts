import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { env, requireEnv } from "@/lib/env";

const TriggerRequest = z.object({
  endpoint: z.enum([
    "/api/cron/discover",
    "/api/cron/generate",
    "/api/cron/post",
  ]),
});

/**
 * Server-side proxy that fires a cron endpoint with the Bearer header,
 * so the /automation page can trigger runs without exposing CRON_SECRET
 * to the browser. Local-dev convenience only — in prod Vercel Cron does
 * this on schedule.
 */
export async function POST(request: Request) {
  await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = TriggerRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!env.CRON_SECRET) {
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const baseUrl = new URL(request.url).origin;
  const res = await fetch(`${baseUrl}${parsed.data.endpoint}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${requireEnv("CRON_SECRET")}` },
  });
  const data: unknown = await res
    .json()
    .catch(() => ({ error: "non-json response" }));
  return Response.json(data, { status: res.status });
}
