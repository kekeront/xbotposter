import { Badge } from "@/components/ui/badge";

type Props = {
  title: string;
  description: string;
  slice: number;
};

export function ComingSoon({ title, description, slice }: Props) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice {slice}
        </Badge>
      </header>
      <div className="rounded-lg border border-dashed p-8">
        <p className="text-sm text-muted-foreground">Lands in slice {slice}.</p>
      </div>
    </div>
  );
}
