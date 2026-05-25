import { requireUser } from "@/lib/auth";
import { shipPostById } from "@/lib/poster";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const user = await requireUser();
  const { id } = await params;
  const result = await shipPostById(id, { userId: user.id });
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, postId: id },
      { status: result.status },
    );
  }
  return Response.json({ ok: true, posts: result.posts, xTweetIds: result.xTweetIds });
}
