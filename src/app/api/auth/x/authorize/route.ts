import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { generateCodeVerifier, generateCodeChallenge, generateState } from "@/lib/pkce";
import { getXOAuth2Config, buildAuthorizeUrl } from "@/lib/x-oauth2";

export async function GET() {
  await requireUser();

  let clientId: string;
  try {
    ({ clientId } = getXOAuth2Config());
  } catch {
    return NextResponse.json(
      { error: "X OAuth not configured. Set X_OAUTH2_CLIENT_ID and X_OAUTH2_CLIENT_SECRET in .env.local." },
      { status: 501 },
    );
  }
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/x/callback`;

  const cookieStore = await cookies();
  cookieStore.set("x_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  cookieStore.set("x_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
  });

  return NextResponse.redirect(authorizeUrl);
}
