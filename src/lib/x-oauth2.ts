import "server-only";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { env } from "./env";

const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const USERINFO_URL = "https://api.x.com/2/users/me";

export function getXOAuth2Config() {
  const clientId = env.X_OAUTH2_CLIENT_ID;
  const clientSecret = env.X_OAUTH2_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("X_OAUTH2_CLIENT_ID and X_OAUTH2_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret };
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${params.clientId}:${params.clientSecret}`)}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token exchange failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  }>;
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${params.clientId}:${params.clientSecret}`)}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X token refresh failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

export async function fetchXUser(accessToken: string) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch X user: ${res.status}`);
  }

  const json = (await res.json()) as { data: { id: string; username: string; name: string } };
  return json.data;
}

export async function getXTokensForUser(userId: string) {
  const [conn] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, userId),
        eq(socialConnections.provider, "x"),
      ),
    )
    .limit(1);

  if (!conn || !conn.accessToken) return null;

  const now = new Date();
  const isExpired = conn.tokenExpiresAt && conn.tokenExpiresAt < now;

  if (isExpired && !conn.refreshToken) {
    return null;
  }

  if (isExpired && conn.refreshToken) {
    const { clientId, clientSecret } = getXOAuth2Config();
    const refreshed = await refreshAccessToken({
      refreshToken: conn.refreshToken,
      clientId,
      clientSecret,
    });

    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
    await db
      .update(socialConnections)
      .set({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        tokenExpiresAt: newExpiry,
        updatedAt: now,
      })
      .where(eq(socialConnections.id, conn.id));

    return { accessToken: refreshed.access_token, userId: conn.providerUserId };
  }

  return { accessToken: conn.accessToken, userId: conn.providerUserId };
}
