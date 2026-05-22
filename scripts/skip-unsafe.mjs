import postgres from "postgres";
import { readFileSync } from "node:fs";
function loadEnv(p){try{for(const l of readFileSync(p,"utf-8").split(/\r?\n/)){if(!l||l.startsWith("#"))continue;const e=l.indexOf("=");if(e<0)continue;const k=l.slice(0,e).trim();let v=l.slice(e+1).trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}}catch{}}
loadEnv(".env.local");loadEnv(".env");
const sql = postgres(process.env.DATABASE_URL,{prepare:false,max:1});
const result = await sql`
  UPDATE posts SET status='skipped', updated_at=now()
  WHERE id IN (
    SELECT p.id FROM posts p
    JOIN generations g ON g.id = p.generation_id
    WHERE p.status='draft'
      AND (g.input_meta->>'viralAuthor') = 'paulg'
  )
  RETURNING id, text
`;
console.log(`skipped ${result.length} take(s) on @paulg:`);
for (const r of result) console.log(" -", r.text.slice(0,80));
await sql.end(); process.exit(0);
