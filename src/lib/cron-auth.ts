import "server-only";
import { env } from "./env";

export function authorizeCronRequest(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${env.CRON_SECRET}`;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
