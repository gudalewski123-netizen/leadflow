/**
 * One-pass lead hunter: search Instagram, score, and store — all via Apify.
 *
 * Supersedes igsource.ts + hot.ts for bulk work. Those needed three steps and
 * used Gregg's own IG session for two of them. A single Apify actor run with
 * searchType "user" + resultsType "details" returns ~17 accounts per query,
 * each with followers, post count, bio link AND recent post timestamps — which
 * is everything scoreOf() needs. So sourcing and scoring become one call, and
 * his Instagram account is never touched.
 *
 * Re-runnable: existing handles are loaded up front and skipped, so running it
 * again only adds new businesses (and costs nothing for ones already known).
 *
 * Usage:
 *   npm run hunt                       # default: 5000 new leads
 *   npm run hunt -- 2000               # target 2000
 *   npm run hunt -- 5000 "roofing,painting"
 */
import fs from "node:fs";
import path from "node:path";
import { pool, init } from "./db.js";
import { STATE_CITIES, ALL_STATES } from "./cities.js";
import { scoreOf, type Profile } from "./score.js";

const TARGET = Number(process.argv[2] ?? 5000);
const NICHES = (process.argv[3] ??
  "mobile detailing,pressure washing,roofing,painting,junk removal,landscaping,lawn care,handyman,concrete contractor,fencing,tree service,sealcoating,plumbing,electrician,hvac,auto detailing,window cleaning,gutter cleaning,moving company,pool service"
).split(",").map((s) => s.trim()).filter(Boolean);

function apifyToken(): string {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  try {
    const m = fs
      .readFileSync(path.join(process.env.HOME ?? "", ".tier1-config/.env"), "utf8")
      .match(/^APIFY_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  console.error("No APIFY_TOKEN in env or ~/.tier1-config/.env");
  process.exit(1);
}
const TOKEN = apifyToken();
const ACTOR = "apify~instagram-scraper";

// Aggregators, media and franchises — not local businesses we can sell to.
const SKIP = /\b(magazine|academy|training|course|supply|supplies|products|official|news|daily|podcast|expo|association)\b/i;

async function hunt(query: string): Promise<any[]> {
  try {
    const r = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search: query,
          searchType: "user",
          searchLimit: 20,
          resultsType: "details",
          resultsLimit: 5, // recent posts per profile — this is what carries recency
          addParentData: false,
        }),
      }
    );
    if (!r.ok) {
      console.error(`  HTTP ${r.status} on "${query}"`);
      return [];
    }
    return (await r.json()) as any[];
  } catch (e: any) {
    console.error(`  error on "${query}": ${e?.message}`);
    return [];
  }
}

function toProfile(it: any): Profile {
  const ts = (it.latestPosts ?? [])
    .map((p: any) => (p?.timestamp ? Math.floor(new Date(p.timestamp).getTime() / 1000) : null))
    .filter(Boolean) as number[];
  return {
    lastPost: ts.length ? Math.max(...ts) : null, // max, not first: pinned posts
    followers: it.followersCount ?? null,
    posts: it.postsCount ?? null,
    externalUrl: it.externalUrl ?? (Array.isArray(it.externalUrls) && it.externalUrls[0]?.url) ?? null,
    email: it.businessEmail ?? null,
    phone: it.businessPhoneNumber ?? null,
    isBusiness: Boolean(it.isBusinessAccount),
  };
}

await init();
await pool.query(`
  ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ig_followers INT, ADD COLUMN IF NOT EXISTS ig_posts INT,
    ADD COLUMN IF NOT EXISTS ig_link TEXT,     ADD COLUMN IF NOT EXISTS ig_email TEXT,
    ADD COLUMN IF NOT EXISTS ig_phone TEXT,    ADD COLUMN IF NOT EXISTS ig_business BOOLEAN,
    ADD COLUMN IF NOT EXISTS hot_score INT,    ADD COLUMN IF NOT EXISTS hot_why TEXT,
    ADD COLUMN IF NOT EXISTS ig_checked_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS source TEXT
`);

// Skip handles we already have — makes re-runs cheap and purely additive.
const known = new Set<string>(
  (await pool.query("SELECT DISTINCT lower(ig_handle) h FROM leads WHERE ig_handle IS NOT NULL")).rows.map(
    (r: any) => r.h
  )
);
console.log(`Known handles: ${known.size}. Target: ${TARGET} new.\n`);

// niche-major so every trade sweeps the country before the next one starts —
// otherwise one niche in one state hogs the whole budget.
const jobs: { niche: string; city: string; state: string }[] = [];
for (const niche of NICHES)
  for (const st of ALL_STATES)
    for (const city of (STATE_CITIES[st] ?? []).slice(0, 3)) jobs.push({ niche, city, state: st });

let added = 0, hot = 0, queries = 0;

// Each Apify run spins up its own container (~2-3 min), so serial execution
// would take ~18h for a 5k target. Runs are independent, so pull jobs from a
// shared cursor with a pool of workers instead. Concurrency is well under the
// STARTER plan's run limit.
const CONCURRENCY = Number(process.env.HUNT_CONCURRENCY ?? 8);
let cursor = 0;

// Hard spend ceiling. Cost per new lead varies with the dedupe rate (a niche
// already swept re-fetches known handles and adds nothing), so a runaway sweep
// could drain the account. Poll Apify's own usage figure and stop dead.
const MAX_SPEND = Number(process.env.HUNT_MAX_SPEND ?? 20);
let spend = 0, stoppedForBudget = false;

async function checkSpend(): Promise<void> {
  try {
    const r = await fetch(`https://api.apify.com/v2/users/me/limits?token=${TOKEN}`);
    const d = (await r.json()) as any;
    spend = d?.data?.current?.monthlyUsageUsd ?? spend;
    if (spend >= MAX_SPEND) {
      stoppedForBudget = true;
      console.log(`\n!! Spend ceiling hit: $${spend.toFixed(2)} >= $${MAX_SPEND}. Stopping.`);
    }
  } catch {}
}
await checkSpend();
const startSpend = spend;
console.log(`Apify spend now $${spend.toFixed(2)}; ceiling $${MAX_SPEND}.`);

async function worker() {
  while (true) {
    if (added >= TARGET || stoppedForBudget) return;
    const j = jobs[cursor++];
    if (!j) return;

    const items = await hunt(`${j.niche} ${j.city}`);
    queries++;
    if (queries % 20 === 0) await checkSpend(); // ~every 20 runs, cheap to poll
    let newHere = 0;

    for (const it of items) {
      const h = String(it.username ?? "").toLowerCase();
      if (!h || known.has(h)) continue;
      const full = String(it.fullName ?? h);
      if (SKIP.test(full) || SKIP.test(h)) continue;
      known.add(h); // shared across workers, so no two claim the same handle

      const p = toProfile(it);
      const { score, why } = scoreOf(p);
      const r = await pool.query(
      `INSERT INTO leads (name, niche, area, state, ig_handle, status, source,
                          last_active, ig_followers, ig_posts, ig_link, ig_email,
                          ig_phone, ig_business, hot_score, hot_why, ig_checked_at)
       VALUES ($1,$2,$3,$4,$5,'new','apify_hunt',
               CASE WHEN $6 > 0 THEN to_timestamp($6) ELSE NULL END,
               $7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT DO NOTHING RETURNING id`,
        [full.slice(0, 120), j.niche, `${j.city} ${j.state}`, j.state, h,
         p.lastPost ?? 0, p.followers, p.posts, p.externalUrl, p.email, p.phone,
         p.isBusiness, score, why.join(", ")]
      );
      if (!r.rowCount) continue;
      added++; newHere++;
      if (score >= 60) {
        hot++;
        console.log(`  ${score >= 75 ? "🔥" : "✅"} ${String(score).padStart(3)} @${h}  ${why.join(", ")}`);
      }
    }

    if (newHere)
      console.log(`  [q${queries}] ${j.niche} ${j.city} ${j.state} — +${newHere} | ${added}/${TARGET}, ${hot} hot`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

await checkSpend();
const used = spend - startSpend;
console.log(`\nDone${stoppedForBudget ? " (stopped at spend ceiling)" : ""}. ${added} new leads from ${queries} queries, ${hot} HOT (>=60).`);
console.log(`Apify: $${used.toFixed(2)} this run ($${spend.toFixed(2)} total)${added ? `, $${(used / added).toFixed(4)}/lead` : ""}.`);
console.log(`Export:  npm run handlelist -- hot`);
await pool.end();
