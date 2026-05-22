import { Badge } from "@/components/ui/badge";
import { ComposeForm } from "./compose-form";

export default function ComposePage() {
  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compose</h1>
          <p className="text-sm text-muted-foreground">
            Paste an idea, get a draft. Drafts land in the queue — nothing
            posts to X until you approve.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 1
        </Badge>
      </header>
      <ComposeForm />
    </div>
  );
}
