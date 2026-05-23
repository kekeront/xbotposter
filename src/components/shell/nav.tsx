import Link from "next/link";

type NavItem = {
  label: string;
  href: string;
  hint?: string;
};

const PRIMARY: NavItem[] = [
  { label: "Dashboard", href: "/", hint: "status at a glance" },
  { label: "Queue", href: "/queue", hint: "drafts to review + ship" },
  { label: "Compose", href: "/compose", hint: "AI or manual draft" },
  { label: "Discover", href: "/discover", hint: "viral content + takes" },
];

const SECONDARY: NavItem[] = [
  { label: "Voice", href: "/voice", hint: "reference posts + fingerprint" },
  { label: "Memory", href: "/memories", hint: "what the system has learned" },
  { label: "Automation", href: "/automation", hint: "cron status + autonomy stats" },
  { label: "Traces", href: "/traces", hint: "agent event log" },
  { label: "Schedule", href: "/schedule", hint: "calendar view (soon)" },
  { label: "History", href: "/history", hint: "all posts (soon)" },
];

export function SidebarNav({ activePath }: { activePath?: string }) {
  return (
    <nav className="flex flex-col gap-1 p-4">
      <div className="px-2 pb-4">
        <Link
          href="/"
          className="font-mono text-lg font-semibold tracking-tight"
        >
          nfactz
        </Link>
        <p className="font-mono text-xs text-muted-foreground">
          x content engine
        </p>
      </div>

      <NavSection items={PRIMARY} activePath={activePath} />

      <div className="my-3 border-t border-border/50" />

      <NavSection items={SECONDARY} activePath={activePath} dim />
    </nav>
  );
}

function NavSection({
  items,
  activePath,
  dim = false,
}: {
  items: NavItem[];
  activePath?: string;
  dim?: boolean;
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
                : dim
                  ? "text-muted-foreground/70"
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
