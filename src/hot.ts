/**
 * HOT pass — score each on-Instagram lead by how good a prospect it is RIGHT NOW.
 *
 * freshness.ts already proved the authenticated IG profile endpoint works; it just
 * threw away everything except the last-post date. That one call also returns the
 * bio link, follower/post counts, and (on business accounts) a public email and
 * phone. This pass keeps all of it and turns it into a 0-100 hot_score.
 *
 * The single strongest signal is `external_url`: if a business is active on
 * Instagram and has NO link in bio, they have no website AND they're clearly
 * marketing themselves. That's the whole pitch, confirmed from Instagram's own
 * data rather than inferred from a Maps listing.
 *
 * Usage: npm run hot              # score unscored on-IG leads
 *        npm run hot -- 300       # cap how many to do this run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ck = JSON.parse(fs.readFileSync(path.join(root, ".ig_cookies.json"), "utf8")) as {
  sessionid: string; csrftoken: string; ds_user_id: string;
};

const LIMIT = Number(process.argv[2] ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400;

// Link-in-bio hosts that are NOT a real website — these leads stay hot.
const NOT_A_SITE = /linktr\.ee|link\.tree|beacons\.ai|linkin\.bio|bio\.link|allmylinks|facebook\.com|instagram\.com|m\.me|wa\.me|booksy|vagaro|fresha|square\.site|calendly|yelp\.com|google\.com|g\.page/i;

interface Profile {
  userId: string | null;
  lastPost: number | null;
  followers: number | null;
  posts: number | null;
  externalUrl: string | null;
  email: string | null;
  phone: string | null;
  isBusiness: boolean;
}

function igHeaders(handle: string) {
  return {
    // Instagram now enforces a SecFetch policy: an Android UA with no Sec-Fetch-*
    // headers gets a blanket 400 "SecFetch Policy violation", which looks exactly
    // like a dead profile. Must present as a real same-origin browser XHR.
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "x-ig-app-id": "936619743392459",
    "x-csrftoken": ck.csrftoken,
    "x-requested-with": "XMLHttpRequest",
    Referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Accept: "*/*",
    Cookie: `sessionid=${ck.sessionid}; csrftoken=${ck.csrftoken}; ds_user_id=${ck.ds_user_id}`,
  };
}

/**
 * web_profile_info still reports the post COUNT but now returns an empty edges
 * array, so recency needs a second call against the user's feed. Without this the
 * whole pass is blind to exactly the signal we care about most.
 * Returns newest post unix-ts, null (unknown), or "rl" (rate-limited).
 */
async function latestPostTs(userId: string, handle: string): Promise<number | null | "rl"> {
  try {
    const r = await fetch(`https://www.instagram.com/api/v1/feed/user/${userId}/?count=12`, {
      headers: igHeaders(handle),
    });
    if (r.status === 429) return "rl";
    if (r.status !== 200) return null;
    const items = ((await r.json()) as any)?.items ?? [];
    // max of the first several — the first can be a PINNED old post, which would
    // make an active business look dead.
    const ts = items.map((i: any) => i?.taken_at).filter(Boolean);
    return ts.length ? Math.max(...ts) : null;
  } catch {
    return null;
  }
}

async function fetchProfile(handle: string): Promise<Profile | null | "rl"> {
  try {
    const r = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      { headers: igHeaders(handle) }
    );
    if (r.status === 429) return "rl";
    if (r.status !== 200) return null;
    const u = (await r.json() as any)?.data?.user;
    if (!u) return null;

    return {
      userId: u.id ?? null,
      lastPost: null, // filled in by latestPostTs() — see note there

      followers: u.edge_followed_by?.count ?? null,
      posts: u.edge_owner_to_timeline_media?.count ?? null,
      externalUrl: u.external_url || null,
      email: u.business_email || null,
      phone: u.business_phone_number || null,
      isBusiness: Boolean(u.is_business_account || u.is_professional_account),
    };
  } catch {
    return null;
  }
}

function scoreOf(p: Profile): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 0;

  // 1. Recency — are they active RIGHT NOW? Biggest single factor.
  if (p.lastPost) {
    const ageDays = (Date.now() / 1000 - p.lastPost) / DAY;
    if (ageDays <= 7) { s += 40; why.push("posted this week"); }
    else if (ageDays <= 14) { s += 33; why.push("posted <2wk"); }
    else if (ageDays <= 30) { s += 26; why.push("posted <1mo"); }
    else if (ageDays <= 90) { s += 12; why.push("posted <3mo"); }
    else if (ageDays <= 180) { s += 4; why.push("posted <6mo"); }
    else why.push("stale");
  }

  // 2. Bio link — the money signal.
  if (!p.externalUrl) { s += 30; why.push("NO link in bio"); }
  else if (NOT_A_SITE.test(p.externalUrl)) { s += 22; why.push("linktree/social only"); }

  // 3. Treating IG as a business channel.
  if (p.isBusiness) { s += 10; why.push("business acct"); }

  // 4. Real local audience — big enough to have revenue, small enough to need us.
  if (p.followers != null) {
    if (p.followers >= 500 && p.followers <= 50000) { s += 10; why.push(`${p.followers} followers`); }
    else if (p.followers >= 150) { s += 5; why.push(`${p.followers} followers`); }
  }

  // 5. Enough content to actually build a site from.
  if ((p.posts ?? 0) >= 20) { s += 5; why.push(`${p.posts} posts`); }

  // 6. Public contact = a second channel that isn't a DM.
  if (p.email) { s += 5; why.push("public email"); }

  return { score: Math.min(100, s), why };
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

// Handles sourced FROM Instagram go first — they're verified-real accounts, so
// every second spent on them is productive. The legacy search-scraped handles
// are mostly junk and would otherwise hog the queue (they have a category set,
// which used to sort them ahead of the good ones).
const leads = (
  await pool.query(
    `SELECT id, name, ig_handle, category FROM leads
     WHERE ig_handle IS NOT NULL AND status = 'new' AND ig_checked_at IS NULL
     ORDER BY (source = 'ig_search') DESC NULLS LAST,
              (category = 'no_site') DESC,
              COALESCE(reviews,0) DESC
     LIMIT $1`,
    [LIMIT]
  )
).rows as { id: number; name: string; ig_handle: string; category: string | null }[];

console.log(`Scoring ${leads.length} on-Instagram leads...\n`);
let hot = 0, checked = 0;

for (const l of leads) {
  let p: Profile | null | "rl" = "rl";
  let streak = 0;
  while (p === "rl") {
    p = await fetchProfile(l.ig_handle);
    if (p === "rl") {
      streak++;
      const wait = Math.min(1800000, 120000 * streak);
      console.log(`  rate-limited, resting ${Math.round(wait / 60000)}min...`);
      await sleep(wait);
    }
  }

  if (p) {
    // Second call for recency — the profile endpoint no longer carries post dates.
    if (p.userId) {
      await sleep(2500);
      let ts: number | null | "rl" = "rl";
      let tStreak = 0;
      while (ts === "rl") {
        ts = await latestPostTs(p.userId, l.ig_handle);
        if (ts === "rl") {
          tStreak++;
          const wait = Math.min(1800000, 120000 * tStreak);
          console.log(`  rate-limited (feed), resting ${Math.round(wait / 60000)}min...`);
          await sleep(wait);
        }
      }
      p.lastPost = ts;
    }
    const { score, why } = scoreOf(p);
    checked++;
    if (score >= 60) hot++;
    await pool.query(
      `UPDATE leads SET last_active = CASE WHEN $1 > 0 THEN to_timestamp($1) ELSE last_active END,
         ig_followers=$2, ig_posts=$3, ig_link=$4, ig_email=$5, ig_phone=$6,
         ig_business=$7, hot_score=$8, hot_why=$9, ig_checked_at=now()
       WHERE id=$10`,
      [p.lastPost ?? 0, p.followers, p.posts, p.externalUrl, p.email, p.phone,
       p.isBusiness, score, why.join(", "), l.id]
    );
    const flag = score >= 75 ? "🔥" : score >= 60 ? "✅" : "  ";
    console.log(`  ${flag} ${String(score).padStart(3)}  @${l.ig_handle.padEnd(24)} ${why.join(", ")}`);
  } else {
    // Unreachable (private/deleted/renamed) — stamp it so we don't retry forever.
    await pool.query("UPDATE leads SET ig_checked_at=now(), hot_score=0, hot_why='profile unreachable' WHERE id=$1", [l.id]);
    console.log(`   ??  @${l.ig_handle} — unreachable`);
  }

  await sleep(12000 + Math.floor(Math.random() * 8000)); // ~12-20s, gentle
}

console.log(`\nDone. Checked ${checked}, ${hot} scored HOT (>=60).`);
console.log(`Work them with: dashboard filter "hot", or  npm run dash`);
await pool.end();
