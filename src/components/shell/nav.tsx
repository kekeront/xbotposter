import Link from "next/link";

type NavItem = {
  label: string;
  href: string;
  slice: number;
  active?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Queue", href: "/queue", slice: 0 },
  { label: "Compose", href: "/compose", slice: 1 },
  { label: "Voice", href: "/voice", slice: 6 },
  { label: "Discover", href: "/discover", slice: 4 },
  { label: "Schedule", href: "/schedule", slice: 3 },
  { label: "History", href: "/history", slice: 2 },
  { label: "Traces", href: "/traces", slice: 5 },
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
        <p className="font-mono text-xs text-muted-foreground">admin</p>
      </div>
      {NAV_ITEMS.map((item) => {
        const isActive = activePath === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground"
            }`}
          >
            <span>{item.label}</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground/60">
              slice {item.slice}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
