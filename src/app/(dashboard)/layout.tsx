import { CadenceStrip } from "@/components/shell/cadence-strip";
import { SidebarNav } from "@/components/shell/nav";
import { UserMenu } from "@/components/shell/user-menu";
import { requireUser } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <aside className="border-r bg-sidebar text-sidebar-foreground">
        <SidebarNav />
        <UserMenu email={user.email} />
      </aside>
      <main className="flex flex-col">
        <CadenceStrip />
        {children}
      </main>
    </div>
  );
}
