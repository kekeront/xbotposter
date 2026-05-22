import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  return Response.json({
    ok: true,
    slice: 0,
    message:
      "stub: would pick a topic + draft a post here. Real impl lands in slices 3-4.",
  });
}
