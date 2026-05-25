import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, connections, and voice profile.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/connections">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>Connections</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Connect X and Telegram accounts.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/settings/voice">
          <Card className="transition-colors hover:bg-muted/50">
            <CardHeader>
              <CardTitle>Voice</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Reference posts and fingerprint profile.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
