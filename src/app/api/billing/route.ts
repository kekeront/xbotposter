import { requireUser } from "@/lib/auth";
import { loadBilling } from "@/lib/billing";

export async function GET() {
  await requireUser();
  const snapshot = await loadBilling();
  if (!snapshot) {
    return Response.json(
      { error: "could not load billing" },
      { status: 500 },
    );
  }
  return Response.json(snapshot);
}
