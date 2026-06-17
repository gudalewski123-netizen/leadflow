/**
 * IG-recency / dead-business pass. For each lead that's on Instagram, read the
 * date of their most recent post via the logged-in session. Businesses whose
 * last post is older than STALE_MONTHS are flagged status='dead' (they drop out
 * of the active dashboard views). Runs slow + gentle so Instagram doesn't block.
 *
 * Usage: npm run freshness            # flag stale on-IG leads
 *        npm run freshness -- 12      # custom staleness cutoff in months
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ck = JSON.parse(fs.readFileSync(path.join(root, ".ig_cookies.json"), "utf8")) as {
  sessionid: string; csrftoken: string; ds_user_id: string;
};

const STALE_MONTHS = Number(process.argv[2] ?? 18);
const cutoff = Date.now() / 1000 - STALE_MONTHS * 30 * 86400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// latest post unix-ts, or null (unknown), or "rl" (rate-limited)
async function latestPostTs(handle: string): Promise<number | null | "rl"> {
  try {
    const r = await fetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${handle}`, {
      headers: {
        "User-Agent": "Instagram 269.0.0.18.75 Android",
        "x-ig-app-id": "936619743392459",
        "x-csrftoken": ck.csrftoken,
        Cookie: `sessionid=${ck.sessionid}; csrftoken=${ck.csrftoken}; ds_user_id=${ck.ds_user_id}`,
      },
    });
    if (r.status === 429) return "rl";
    if (r.status !== 200) return null;
    const d = (await r.json()) as any;
    const posts = d?.data?.user?.edge_owner_to_timeline_media?.edges ?? [];
    // max of the first few — the very first can be a PINNED old post, which would
    // make an active business look dead.
    const tss = posts.slice(0, 6).map((e: any) => e?.node?.taken_at_timestamp).filter(Boolean);
    return tss.length ? Math.max(...tss) : null;
  } catch {
    return null;
  }
}

await init();
await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ");

const leads = (
  await pool.query("SELECT id, name, ig_handle FROM leads WHERE ig_handle IS NOT NULL AND status = 'new' AND last_active IS NULL")
).rows as { id: number; name: string; ig_handle: string }[];

console.log(`Checking recency for ${leads.length} on-Instagram leads (stale = no post in ${STALE_MONTHS} months)...\n`);
let dead = 0, checked = 0;

for (const l of leads) {
  // On 429, back off (progressively, capped at 10 min) and RETRY the same lead —
  // never give up. This lets the pass start now and auto-begin the moment
  // Instagram's rate limit eases, instead of waiting on a fixed timer.
  let ts: number | null | "rl" = "rl";
  let rlStreak = 0;
  while (ts === "rl") {
    ts = await latestPostTs(l.ig_handle);
    if (ts === "rl") {
      rlStreak++;
      // back off hard (up to 30 min) so we stop nagging Instagram and let the
      // account's penalty actually lift — then it auto-resumes on the next try.
      const wait = Math.min(1800000, 120000 * rlStreak);
      console.log(`  rate-limited, resting ${Math.round(wait / 60000)}min...`);
      await sleep(wait);
    }
  }
  if (ts !== null) {
    checked++;
    await pool.query("UPDATE leads SET last_active = to_timestamp($1) WHERE id = $2", [ts, l.id]);
    if (ts < cutoff) {
      await pool.query("UPDATE leads SET status = 'dead' WHERE id = $1", [l.id]);
      dead++;
      console.log(`  💀 ${l.name} @${l.ig_handle} — last post ${new Date(ts * 1000).toISOString().slice(0, 10)}`);
    }
  }
  await sleep(12000 + Math.floor(Math.random() * 8000)); // ~12-20s, gentle
}

console.log(`\nDone. Checked ${checked}, flagged ${dead} dead (no post in ${STALE_MONTHS}mo).`);
await pool.end();
