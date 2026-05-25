import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { XConnectButton } from "./x-connect-button";
import { TelegramConnect } from "./telegram-connect";
import { DisconnectButton } from "./disconnect-button";

export default async function ConnectionsPage() {
  const user = await requireUser();

  const connections = await db
    .select()
    .from(socialConnections)
    .where(eq(socialConnections.userId, user.id));

  const xConn = connections.find((c) => c.provider === "x");
  const tgConn = connections.find((c) => c.provider === "telegram");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect your social accounts to use nfactz with your profiles.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>X (Twitter)</CardTitle>
          </CardHeader>
          <CardContent>
            {xConn ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  Connected as{" "}
                  <span className="font-medium">@{xConn.providerUsername}</span>
                </p>
                <DisconnectButton connectionId={xConn.id} provider="X" />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Connect your X account to post tweets and read timelines.
                </p>
                <XConnectButton />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Telegram</CardTitle>
          </CardHeader>
          <CardContent>
            {tgConn ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  Connected as{" "}
                  <span className="font-medium">
                    {tgConn.providerUsername
                      ? `@${tgConn.providerUsername}`
                      : `ID: ${tgConn.providerUserId}`}
                  </span>
                </p>
                <DisconnectButton connectionId={tgConn.id} provider="Telegram" />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  Connect Telegram to receive draft notifications and approve posts inline.
                </p>
                <TelegramConnect />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
