import { runDiscoverFetch } from "@/lib/discover";

export async function POST() {
  const result = await runDiscoverFetch({ source: "manual" });
  return Response.json(result);
}
