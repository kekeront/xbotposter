import { desc } from "drizzle-orm";
import { db } from "@/db/client";
import { posts, type Post } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

async function loadPosts(): Promise<
  | { ok: true; rows: Post[] }
  | { ok: false; error: string }
> {
  try {
    const rows = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.createdAt))
      .limit(50);
    return { ok: true, rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown DB error",
    };
  }
}

export default async function QueuePage() {
  const result = await loadPosts();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Drafts and scheduled posts. Slice 0 reads from the DB; generation
            lands in slice 1.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 0
        </Badge>
      </header>

      {!result.ok ? (
        <DbErrorState message={result.error} />
      ) : result.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <PostsTable rows={result.rows} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">No posts yet.</p>
      <p className="text-sm text-muted-foreground">
        Trigger a placeholder draft via:
      </p>
      <pre className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {`curl -X POST http://localhost:3000/api/compose \\
  -H "Content-Type: application/json" \\
  -d '{"topic":"hello world"}'`}
      </pre>
    </div>
  );
}

function DbErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <p className="text-sm font-semibold text-destructive">
        Couldn&apos;t reach the database.
      </p>
      <p className="text-sm text-muted-foreground">
        Check that <code className="font-mono">DATABASE_URL</code> is set in
        <code className="font-mono"> .env.local</code> and the migration has
        been applied. See README for setup steps.
      </p>
      <pre className="max-w-2xl overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}

function PostsTable({ rows }: { rows: Post[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Created</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Text</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{row.status}</Badge>
            </TableCell>
            <TableCell className="text-sm">{row.contentType}</TableCell>
            <TableCell className="max-w-xl truncate text-sm">
              {row.text}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
