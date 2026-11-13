/**
 * Import scout results (read in Gregg's own logged-in Chrome tab, $0) into LeadFlow.
 *   npx tsx src/scoutimport.ts <results.json> <niche> <tag> [area] [state]
 * results.json = the array the in-tab scout builds in window.__res:
 *   [{h, name, caption, followers, posts, ext, last, biz, priv, bio, phone, err?}]
 * Same filters as the paid hunts (franchise, chains, relevance, junk, >50k followers), same scoring.
 */
import { readFileSync } from "node:fs";
import { pool, init } from "./db.js";
import { scoreOf, isFranchise, type Profile } from "./score.js";
import { isRelevant, MAX_FOLLOWERS } from "./relevance.js";
import { junkReason } from "./quality.js";
import { findChains, brandKey } from "./chains.js";

const [file, niche, tag, area = "", state = ""] = process.argv.slice(2);
if (!file || !niche || !tag) { console.error("usage: scoutimport.ts <results.json> <niche> <tag> [area] [state]"); process.exit(1); }
const rows = JSON.parse(readFileSync(file, "utf8")) as any[];
const SKIP = /\b(depot|lowe'?s|home\s?advisor|angi|thumbtack|yelp|nextdoor|realty|realtor|magazine|news|seo|marketing|agency|leads|hardware|supply|alliance|foundation|nonprofit)\b|clientflow|leadgen/i;

await init();
const known = new Set<string>((await pool.query("SELECT DISTINCT lower(ig_handle) h FROM leads WHERE ig_handle IS NOT NULL")).rows.map((r) => r.h));
const CHAINS = findChains((await pool.query("SELECT name, state, area FROM leads WHERE name IS NOT NULL")).rows);
let saved = 0, keepers = 0; const why0: Record<string, number> = {};
const drop = (k: string) => (why0[k] = (why0[k] ?? 0) + 1);
for (const r of rows) {
  const h = String(r.h ?? "").toLowerCase();
  if (!h || r.err) { drop("unreadable"); continue; }
  if (known.has(h)) { drop("already in LeadFlow"); continue; }
  const name = String(r.name || h);
  if (r.priv) { drop("private"); continue; }
  if ((r.followers ?? 0) > MAX_FOLLOWERS) { drop("too big"); continue; }
  if (SKIP.test(name) || SKIP.test(h) || isFranchise(name, h) || CHAINS.has(brandKey(name))) { drop("chain/franchise/junk name"); continue; }
  if (!isRelevant(niche, name, h, `${r.bio ?? ""} ${r.caption ?? ""}`)) { drop("not this trade"); continue; }
  const link = r.ext || null;
  if (junkReason({ name, ig_handle: h, niche, ig_followers: r.followers, ig_link: link, bio: r.bio ?? "", verified: false }, true)) { drop("quality gate"); continue; }
  const prof: Profile = { lastPost: r.last ?? null, followers: r.followers ?? null, posts: r.posts ?? null, externalUrl: link, email: null, phone: r.phone ?? null, isBusiness: Boolean(r.biz) };
  const { score, why } = scoreOf(prof);
  why.push(`found by scout via #${tag}`);
  const ins = await pool.query(
    `INSERT INTO leads (name, niche, area, state, ig_handle, status, source, last_active, ig_followers, ig_posts, ig_link, ig_phone, ig_business, hot_score, hot_why, ig_checked_at)
     VALUES ($1,$2,$3,$4,$5,'new','ig_scout', CASE WHEN $6 > 0 THEN to_timestamp($6) ELSE NULL END, $7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT DO NOTHING RETURNING id`,
    [name.slice(0, 120), niche, area || null, state || null, h, prof.lastPost ?? 0, prof.followers, prof.posts, link, prof.phone, prof.isBusiness, score, why.join(", ")]);
  if (!ins.rowCount) continue;
  saved++; known.add(h);
  const active = prof.lastPost && Date.now() / 1000 - prof.lastPost < 60 * 86400;
  if (!link && active && (prof.followers ?? 0) >= 30) { keepers++; console.log(`  ✅ @${h} ${prof.followers}f · ${niche} · ${area}`); }
}
await pool.query(`INSERT INTO hunt_queries (query, new_leads) VALUES ($1, $2) ON CONFLICT (query) DO UPDATE SET ran_at = now(), new_leads = EXCLUDED.new_leads`, [`scout:${tag}`, saved]);
console.log(`#${tag}: ${rows.length} profiles read → ${saved} saved, ${keepers} no-website & posting. Dropped: ${JSON.stringify(why0)}. Cost $0.`);
await pool.end();
