import { NextResponse, type NextRequest } from "next/server";
import { createHmac, createHash } from "crypto";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { env } from "@/lib/env";

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const body = (await request.json()) as Record<string, string>;

  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json(
      { error: "Telegram bot not configured" },
      { status: 500 },
    );
  }

  // Verify Telegram Login Widget hash
  const { hash, ...data } = body;
  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }

  const dataCheckString = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (hmac !== hash) {
    return NextResponse.json(
      { error: "Invalid Telegram auth data" },
      { status: 401 },
    );
  }

  // Check auth_date is not too old (1 day)
  const authDate = parseInt(data.auth_date, 10);
  if (Date.now() / 1000 - authDate > 86400) {
    return NextResponse.json(
      { error: "Telegram auth data expired" },
      { status: 401 },
    );
  }

  await db
    .insert(socialConnections)
    .values({
      userId: user.id,
      provider: "telegram",
      providerUserId: data.id,
      providerUsername: data.username ?? null,
      meta: {
        firstName: data.first_name,
        lastName: data.last_name,
        photoUrl: data.photo_url,
      },
    })
    .onConflictDoUpdate({
      target: [socialConnections.userId, socialConnections.provider],
      set: {
        providerUserId: data.id,
        providerUsername: data.username ?? null,
        meta: {
          firstName: data.first_name,
          lastName: data.last_name,
          photoUrl: data.photo_url,
        },
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}
