/**
 * HOT scoring via Apify — the fast, safe path.
 *
 * src/hot.ts does the same job using Gregg's own Instagram session, which means
 * (a) every request is his account making it, and (b) it has to crawl at ~15-20s
 * per lead to avoid a rate limit. Apify runs through its own proxy pool: his
 * account is never touched, and a batch of 100 profiles comes back in one run.
 *
 * Scoring itself lives in src/score.ts so both paths can never drift.
 *
 * Usage:
 *   npm run hot:apify                 # score un-scored ig_search handles
 *   npm run hot:apify -- 300 50       # cap total, and batch size
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";
import { scoreOf, type Profile } from "./score.js";

const LIMIT = Number(process.argv[2] ?? 500);
const BATCH = Number(process.argv[3] ?? 50);

// Token lives in ~/.tier1-config/.env (shared with the Vercel/CF/Neon tokens).
function apifyToken(): string {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  const envPath = path.join(process.env.HOME ?? "", ".tier1-config/.env");
  try {
    const m = fs.readFileSync(envPath, "utf8").match(/^APIFY_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  console.error("No APIFY_TOKEN (env or ~/.tier1-config/.env). Use `npm run hot` for the session-based path.");
  process.exit(1);
}
const TOKEN = apifyToken();
const ACTOR = "apify~instagram-scraper";

/** One Apify run per batch of handles. resultsType "details" is what carries
 *  latestPosts — without it the profile comes back with no timestamps at all. */
async function fetchBatch(handles: string[]): Promise<any[]> {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directUrls: handles.map((h) => `https://www.instagram.com/${h}/`),
        resultsType: "details",
        resultsLimit: 5,
        addParentData: false,
      }),
    }
  );
  if (!r.ok) {
    console.error(`  Apify run failed: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
    return [];
  }
  return (await r.json()) as any[];
}

function toProfile(it: any): Profile {
  const posts = it.latestPosts ?? [];
  const ts = posts
    .map((p: any) => (p?.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : null))
    .filter(Boolean) as number[];
  const ext = it.externalUrl ?? (Array.isArray(it.externalUrls) && it.externalUrls[0]?.url) ?? null;
  return {
    // max, not first — a PINNED old post would otherwise make an active
    // business look dead.
    lastPost: ts.length ? Math.max(...ts) : null,
    followers: it.followersCount ?? null,
    posts: it.postsCount ?? null,
    externalUrl: ext,
    email: it.businessEmail ?? null,
    phone: it.businessPhoneNumber ?? null,
    isBusiness: Boolean(it.isBusinessAccount),
  };
}

await init();
await pool.query(`
  ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS last_active   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ig_followers  INT,
    ADD COLUMN IF NOT EXISTS ig_posts      INT,
    ADD COLUMN IF NOT EXISTS ig_link       TEXT,
    ADD COLUMN IF NOT EXISTS ig_email      TEXT,
    ADD COLUMN IF NOT EXISTS ig_phone      TEXT,
    ADD COLUMN IF NOT EXISTS ig_business   BOOLEAN,
    ADD COLUMN IF NOT EXISTS hot_score     INT,
    ADD COLUMN IF NOT EXISTS hot_why       TEXT,
    ADD COLUMN IF NOT EXISTS ig_checked_at TIMESTAMPTZ
`);

const leads = (
  await pool.query(
    `SELECT id, ig_handle FROM leads
      WHERE ig_handle IS NOT NULL AND status='new' AND ig_checked_at IS NULL
      ORDER BY (source = 'ig_search') DESC NULLS LAST, id DESC
      LIMIT $1`,
    [LIMIT]
  )
).rows as { id: number; ig_handle: string }[];

if (!leads.length) {
  console.log("Nothing to score.");
  await pool.end();
  process.exit(0);
}

console.log(`Scoring ${leads.length} handles via Apify, ${BATCH} per run...\n`);
const byHandle = new Map(leads.map((l) => [l.ig_handle.toLowerCase(), l.id]));
let scored = 0, hot = 0;

for (let i = 0; i < leads.length; i += BATCH) {
  const chunk = leads.slice(i, i + BATCH);
  const items = await fetchBatch(chunk.map((l) => l.ig_handle));
  const seen = new Set<number>();

  for (const it of items) {
    const id = byHandle.get(String(it.username ?? "").toLowerCase());
    if (!id) continue;
    const p = toProfile(it);
    const { score, why } = scoreOf(p);
    seen.add(id);
    scored++;
    if (score >= 60) hot++;
    await pool.query(
      `UPDATE leads SET last_active = CASE WHEN $1 > 0 THEN to_timestamp($1) ELSE last_active END,
         ig_followers=$2, ig_posts=$3, ig_link=$4, ig_email=$5, ig_phone=$6,
         ig_business=$7, hot_score=$8, hot_why=$9, ig_checked_at=now()
       WHERE id=$10`,
      [p.lastPost ?? 0, p.followers, p.posts, p.externalUrl, p.email, p.phone,
       p.isBusiness, score, why.join(", "), id]
    );
    if (score >= 60) console.log(`  ${score >= 75 ? "🔥" : "✅"} ${String(score).padStart(3)}  @${it.username}  ${why.join(", ")}`);
  }

  // Handles Apify returned nothing for are deleted/renamed/private — stamp them
  // so they don't get retried (and paid for) on every future run.
  for (const l of chunk) {
    if (!seen.has(l.id)) {
      await pool.query(
        "UPDATE leads SET ig_checked_at=now(), hot_score=0, hot_why='profile unreachable' WHERE id=$1",
        [l.id]
      );
    }
  }
  console.log(`  [batch ${Math.floor(i / BATCH) + 1}] ${items.length}/${chunk.length} returned — ${scored} scored, ${hot} hot so far`);
}

console.log(`\nDone. ${scored} scored, ${hot} HOT (>=60).`);
console.log(`Export them:  npm run handlelist -- hot`);
await pool.end();
