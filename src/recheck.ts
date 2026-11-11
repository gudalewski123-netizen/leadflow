/**
 * Cheap re-check of KNOWN no-website trade accounts (2026-11-10, Gregg: "we need to get it under .01 per lead").
 *
 * Thousands of trades accounts were already found with no website but dropped only because they had not posted in
 * 60 days at the time. Re-reading a known handle with coderx/instagram-profile-scraper-bio-posts costs $0.0011 and
 * needs no search, so a returning account costs a fraction of a fresh hunt. Each re-read refreshes followers,
 * website and last post; anything that now has a website or is still quiet stays out of the lists by itself.
 *
 *   npx tsx src/recheck.ts [maxProfiles=100] [--money]     (--money: money metros only, see metros.ts)
 */
import fs from "node:fs";
import { pool } from "./db.js";
import { MONEY_PLACES } from "./metros.js";
import { NOT_EXCLUDED_NICHE_SQL } from "./sitecheck.js";

const TOKEN = fs.readFileSync(`${process.env.HOME}/.tier1-config/.env`, "utf8").match(/^APIFY_TOKEN=["']?([^"'\n]+)/m)![1];
const ACTOR = "coderx~instagram-profile-scraper-bio-posts";
const MAX = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 100);
const MONEY = process.argv.includes("--money");
const MAX_SPEND = Number(process.env.HUNT_MAX_SPEND ?? 0);   // absolute monthly ceiling; 0 = no extra check
const api = (p: string, o: any = {}) => fetch(`https://api.apify.com/v2/${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`, o).then((r) => r.json() as any);
const usage = async () => (await api("users/me/limits")).data.current.monthlyUsageUsd as number;

const money = new Set(MONEY_PLACES.map((p) => `${p.city}|${p.state}`.toLowerCase()));
const rows = (await pool.query(`SELECT id, ig_handle, area, state, last_active FROM leads
  WHERE status = 'new' AND ig_handle IS NOT NULL AND ig_handle <> '' AND ig_checked_at IS NOT NULL
    AND (website IS NULL OR website = '') AND ${NOT_EXCLUDED_NICHE_SQL}
    AND COALESCE(niche,'') NOT IN ('barbershop','nail salon','tattoo shop','lash and brow','med spa','massage therapy','gym','catering')
    AND COALESCE(ig_followers,0) BETWEEN 30 AND 15000 AND length(state) = 2
    AND (last_active IS NULL OR last_active <= now() - interval '60 days')
    AND (ig_checked_at < now() - interval '14 days')
  ORDER BY last_active DESC NULLS LAST`)).rows
  .filter((r) => !MONEY || money.has(`${(r.area || "").replace(/,? [A-Z]{2}$/, "")}|${r.state}`.toLowerCase()))
  .slice(0, MAX);
if (!rows.length) { console.log("nothing to re-check"); process.exit(0); }

const u0 = await usage();
if (MAX_SPEND && u0 + rows.length * 0.0012 > MAX_SPEND) { console.log(`would pass the $${MAX_SPEND} ceiling (now $${u0.toFixed(2)}); stopping`); process.exit(0); }
console.log(`Re-checking ${rows.length} known no-website accounts${MONEY ? " in money metros" : ""} (Apify now $${u0.toFixed(2)})`);

const start = await api(`acts/${ACTOR}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usernames: rows.map((r) => r.ig_handle) }) });
let s = start.data;
while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(s.status)) { await new Promise((z) => setTimeout(z, 4000)); s = (await api(`actor-runs/${s.id}`)).data; }
const items = (await api(`datasets/${s.defaultDatasetId}/items?clean=1`)) as any[];
const byHandle = new Map(items.map((x) => [String(x.username).toLowerCase(), x]));

let back = 0, site = 0, quiet = 0, gone = 0, fresh = 0;
const now = Date.now();
for (const r of rows) {
  const x = byHandle.get(String(r.ig_handle).toLowerCase());
  if (!x) { gone++; await pool.query(`UPDATE leads SET ig_checked_at = now() WHERE id = $1`, [r.id]); continue; }
  const last = Math.max(0, ...((x.latestPosts ?? []) as any[]).map((t) => Date.parse(t.timestamp ?? "") || 0));
  const url = x.external_url || (x.externalUrls ?? [])[0]?.url || "";
  await pool.query(`UPDATE leads SET ig_checked_at = now(), ig_followers = $2, ig_posts = $3, last_active = COALESCE($4::timestamptz, last_active),
      website = NULLIF($5, ''), hot_why = CASE WHEN $6 THEN concat_ws(', ', NULLIF(hot_why,''), 'BACK — posting again (re-check ' || to_char(now(),'MM-DD') || ')') ELSE hot_why END
    WHERE id = $1`, [r.id, x.followersCount ?? null, x.postsCount ?? null, last ? new Date(last).toISOString() : null, url, !url && last && now - last < 60 * 864e5]);
  if (url) site++; else if (!last || now - last >= 60 * 864e5) quiet++; else { back++; if (now - last < 14 * 864e5) fresh++; }
}
await new Promise((z) => setTimeout(z, 10000));
const u1 = await usage();
console.log(`profiles ${items.length}/${rows.length}: BACK and posting ${back} (${fresh} this fortnight) · now has a website ${site} · still quiet ${quiet} · gone/renamed ${gone}`);
console.log(`cost $${(u1 - u0).toFixed(4)} -> $${((u1 - u0) / Math.max(1, back)).toFixed(4)} per lead`);
await pool.end();
