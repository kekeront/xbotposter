import Link from "next/link";

type NavItem = {
  label: string;
  href: string;
  hint?: string;
};

const PRIMARY: NavItem[] = [
  { label: "Queue", href: "/queue", hint: "compose, discover, schedule + ship" },
  { label: "Traces", href: "/traces", hint: "agent event log" },
  { label: "Settings", href: "/settings", hint: "connections + voice" },
];

export function SidebarNav({ activePath }: { activePath?: string }) {
  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="px-2 pb-4">
        <Link
          href="/queue"
          className="font-mono text-lg font-semibold tracking-tight"
        >
          nfactz
        </Link>
        <p className="font-mono text-xs text-muted-foreground">
          x content engine
        </p>
      </div>

      <NavSection items={PRIMARY} activePath={activePath} />
    </nav>
  );
}

function NavSection({
  items,
  activePath,
}: {
  items: NavItem[];
  activePath?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = activePath === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.hint}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
