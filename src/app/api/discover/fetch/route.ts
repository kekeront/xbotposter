import { requireUser } from "@/lib/auth";
import { runDiscoverFetch } from "@/lib/discover";

export async function POST() {
  const user = await requireUser();
  const result = await runDiscoverFetch({ source: "manual", userId: user.id });
  return Response.json(result);
}
