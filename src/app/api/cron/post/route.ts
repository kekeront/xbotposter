import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  return Response.json({
    ok: true,
    slice: 0,
    message:
      "stub: would drain approved+scheduled posts to X here. Real impl lands in slice 2.",
  });
}
