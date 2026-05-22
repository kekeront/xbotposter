import { ComingSoon } from "@/components/shell/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="History"
      description="Past posts, eval scores, agent traces."
      slice={2}
    />
  );
}
