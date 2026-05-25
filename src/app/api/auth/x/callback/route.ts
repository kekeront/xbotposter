import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  getXOAuth2Config,
  exchangeCodeForTokens,
  fetchXUser,
} from "@/lib/x-oauth2";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings/connections?error=${error}`, appUrl),
    );
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("x_oauth_state")?.value;
  const codeVerifier = cookieStore.get("x_code_verifier")?.value;

  cookieStore.delete("x_oauth_state");
  cookieStore.delete("x_code_verifier");

  if (!code || !state || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(
      new URL("/settings/connections?error=invalid_state", appUrl),
    );
  }

  try {
    const { clientId, clientSecret } = getXOAuth2Config();
    const redirectUri = `${appUrl}/api/auth/x/callback`;

    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri,
      clientId,
      clientSecret,
    });

    const xUser = await fetchXUser(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await db
      .insert(socialConnections)
      .values({
        userId: user.id,
        provider: "x",
        providerUserId: xUser.id,
        providerUsername: xUser.username,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: expiresAt,
        scopes: tokens.scope,
        meta: { name: xUser.name },
      })
      .onConflictDoUpdate({
        target: [socialConnections.userId, socialConnections.provider],
        set: {
          providerUserId: xUser.id,
          providerUsername: xUser.username,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: expiresAt,
          scopes: tokens.scope,
          meta: { name: xUser.name },
          updatedAt: new Date(),
        },
      });

    return NextResponse.redirect(
      new URL("/settings/connections?connected=x", appUrl),
    );
  } catch {
    return NextResponse.redirect(
      new URL("/settings/connections?error=token_exchange_failed", appUrl),
    );
  }
}
