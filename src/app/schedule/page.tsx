import { ComingSoon } from "@/components/shell/coming-soon";

export default function Page() {
  return (
    <ComingSoon
      title="Schedule"
      description="Calendar of queued posts, content type per slot."
      slice={3}
    />
  );
}
