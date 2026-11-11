/**
 * Hashtag hunt — cheap Instagram trades leads (2026-11-10, Gregg: "how can we get cheap leads using Apify?").
 *
 * Small local trades tag their work with local hashtags (#dallashandyman, #phoenixpoolservice). A post under one
 * of those tags is (1) a trade, (2) in that area and (3) active — the three things the old search hunt paid
 * $0.0023 per profile to learn about every account, most of which failed. Here:
 *   1. scrapesmith~instagram-hashtag-scraper: ~$0.0003 per post → the posters' usernames (+ name, caption).
 *   2. Free filters: already in LeadFlow, franchises/chains, junk names, no sign of the trade.
 *   3. coderx~instagram-profile-scraper-bio-posts: ~$0.0015 per profile → website link, followers, last post.
 * Measured on the first test (8 money-metro tags): 136 new posters → 16 with no website and posting = $0.022 each,
 * vs ~$0.14 per verified trade lead from the search hunt. Every profile checked is stored (with its link), so a
 * handle is never paid for twice; the No-website list filters the rest out by itself.
 *
 *   HUNT_MAX_SPEND=24 npx tsx src/taghunt.ts [maxTags=200] [postsPerTag=30]
 *   HUNT_MAX_SPEND is the Apify MONTHLY total to stop at (same meaning as the search hunt).
 */
import fs from "node:fs";
import { pool, init } from "./db.js";
import { MONEY_PLACES } from "./metros.js";
import { scoreOf, isFranchise, type Profile } from "./score.js";
import { isRelevant, MAX_FOLLOWERS } from "./relevance.js";
import { junkReason } from "./quality.js";
import { findChains, brandKey } from "./chains.js";
import { syncWebsitesFromBio } from "./sitecheck.js";

const TOKEN = fs.readFileSync(`${process.env.HOME}/.tier1-config/.env`, "utf8").match(/^APIFY_TOKEN=["']?([^"'\n]+)/m)![1];
const TAG_ACTOR = "scrapesmith~instagram-hashtag-scraper";
const PROFILE_ACTOR = "coderx~instagram-profile-scraper-bio-posts";
const MAX_TAGS = Number(process.argv[2] ?? 200);
const PER_TAG = Number(process.argv[3] ?? 30);
const MAX_SPEND = Number(process.env.HUNT_MAX_SPEND ?? 0);
if (!MAX_SPEND) { console.error("Set HUNT_MAX_SPEND (the Apify monthly total to stop at)."); process.exit(1); }

/* tag words per trade — what local operators actually type after the city name */
const TAG_WORDS: Record<string, string[]> = {
  "plumbing": ["plumber", "plumbing"],
  "handyman": ["handyman"],
  "pressure washing": ["pressurewashing", "powerwashing", "softwash"],
  "pool service": ["poolservice", "poolcleaning"],
  "landscaping": ["landscaping"],
  "lawn care": ["lawncare"],
  "roofing": ["roofer", "roofing"],
  "painting": ["painter", "housepainter"],
  "electrician": ["electrician"],
  "hvac": ["hvac"],
  "tree service": ["treeservice"],
  "window cleaning": ["windowcleaning"],
  "gutter cleaning": ["guttercleaning"],
  "junk removal": ["junkremoval"],
  "fencing": ["fencecompany", "fencing"],
  "concrete contractor": ["concrete"],
  "epoxy flooring": ["epoxyfloors"],
  "sealcoating": ["sealcoating"],
  "moving company": ["movers"],
  "hardscaping": ["pavers", "hardscape"],
  "christmas light installation": ["christmaslights"],
};
const SKIP = /\b(depot|lowe'?s|home\s?advisor|angi|thumbtack|yelp|nextdoor|realty|realtor|magazine|news|seo|marketing|agency|leads|hardware)\b|clientflow|leadgen/i;   // 11-10: 'Concrete Leads' marketer, a hardware store

const api = (p: string, o: any = {}) => fetch(`https://api.apify.com/v2/${p}${p.includes("?") ? "&" : "?"}token=${TOKEN}`, o).then((r) => r.json() as any);
const usage = async () => (await api("users/me/limits")).data.current.monthlyUsageUsd as number;
async function run(actor: string, input: any): Promise<any[] | null> {
  const r = await api(`acts/${actor}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r?.data?.id) { console.error("  run did not start:", JSON.stringify(r).slice(0, 200)); return null; }
  let s = r.data;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(s.status)) { await new Promise((z) => setTimeout(z, 4000)); s = (await api(`actor-runs/${s.id}`)).data; }
  if (s.status !== "SUCCEEDED") { console.error("  run", s.status); return null; }
  const items = await api(`datasets/${s.defaultDatasetId}/items?clean=1`);
  return Array.isArray(items) ? items : [];
}
const slug = (s: string) => s.toLowerCase().replace(/^st\.?\s/, "saint ").replace(/[^a-z]/g, "");

await init();
const known = new Set<string>((await pool.query("SELECT DISTINCT lower(ig_handle) h FROM leads WHERE ig_handle IS NOT NULL")).rows.map((r) => r.h));
const done = new Set<string>((await pool.query(`SELECT query FROM hunt_queries WHERE query LIKE 'tag:%' AND ran_at > now() - interval '30 days'`)).rows.map((r) => r.query));
const CHAINS = findChains((await pool.query("SELECT name, state, area FROM leads WHERE name IS NOT NULL")).rows);

/* the tag list: trade × money place, interleaved so a capped run spreads across trades and metros */
type Tag = { tag: string; niche: string; city: string; state: string };
const perTrade: Tag[][] = Object.entries(TAG_WORDS).map(([niche, words], k) => {
  const list: Tag[] = [];
  const places = [...MONEY_PLACES.slice((k * 7) % MONEY_PLACES.length), ...MONEY_PLACES.slice(0, (k * 7) % MONEY_PLACES.length)];
  for (const p of places) for (const w of words) { const tag = `${slug(p.city)}${w}`; if (!done.has(`tag:${tag}`)) list.push({ tag, niche, city: p.city, state: p.state }); }
  return list;
});
const tags: Tag[] = [];
for (let i = 0; tags.length < MAX_TAGS && perTrade.some((l) => i < l.length); i++) for (const l of perTrade) if (l[i] && tags.length < MAX_TAGS) tags.push(l[i]);

let spent0 = await usage();
console.log(`Apify now $${spent0.toFixed(2)}; ceiling $${MAX_SPEND}. ${tags.length} hashtags queued.`);
let added = 0, keepers = 0, checked = 0, postsSeen = 0;

for (let b = 0; b < tags.length; b += 40) {
  const batch = tags.slice(b, b + 40);
  const now = await usage();
  if (now + batch.length * PER_TAG * 0.00035 + 60 * 0.0016 > MAX_SPEND) { console.log(`Stopping: next batch could pass $${MAX_SPEND} (now $${now.toFixed(2)}).`); break; }
  const posts = await run(TAG_ACTOR, { hashtags: batch.map((t) => t.tag), maxResultsPerHashtag: PER_TAG });
  if (posts === null) continue;
  postsSeen += posts.length;

  // one candidate per new poster, attributed to the first tag we saw them under
  const byTag = new Map(batch.map((t) => [t.tag, t]));
  const cand = new Map<string, { t: Tag; name: string; caption: string }>();
  for (const p of posts) {
    const h = String(p.ownerUsername ?? "").toLowerCase();
    if (!h || known.has(h) || cand.has(h)) continue;
    const tagName = String(p.inputUrl ?? "").match(/tags\/([^/?#]+)/)?.[1]?.toLowerCase() ?? (p.hashtags ?? []).map((x: string) => x.toLowerCase()).find((x: string) => byTag.has(x));
    const t = byTag.get(tagName ?? "") ?? batch[0];
    const name = String(p.ownerFullName ?? h);
    if (SKIP.test(name) || SKIP.test(h) || isFranchise(name, h) || CHAINS.has(brandKey(name))) { known.add(h); continue; }
    if (!isRelevant(t.niche, name, h, String(p.caption ?? ""))) continue;   // not marked known: another trade's tag may claim them
    cand.set(h, { t, name, caption: String(p.caption ?? "") });
  }
  for (const t of batch) await pool.query(`INSERT INTO hunt_queries (query, new_leads) VALUES ($1, 0) ON CONFLICT (query) DO UPDATE SET ran_at = now()`, [`tag:${t.tag}`]);
  if (!cand.size) { console.log(`  batch ${b / 40 + 1}: ${posts.length} posts, no new posters`); continue; }

  const profiles = await run(PROFILE_ACTOR, { usernames: [...cand.keys()] });
  if (profiles === null) continue;
  let batchKeep = 0;
  for (const x of profiles) {
    const h = String(x.username ?? "").toLowerCase();
    const c = cand.get(h);
    if (!c) continue;
    known.add(h); checked++;
    const link = x.external_url || (Array.isArray(x.externalUrls) && x.externalUrls[0]?.url) || null;
    const bio = String(x.biography ?? "");
    const name = String(x.fullName || c.name || h);
    if ((x.followersCount ?? 0) > MAX_FOLLOWERS) continue;
    if (junkReason({ name, ig_handle: h, niche: c.t.niche, ig_followers: x.followersCount, ig_link: link, bio, verified: Boolean(x.verified) }, true)) continue;
    const ts = ((x.latestPosts ?? []) as any[]).map((p) => Math.floor((Date.parse(p.timestamp ?? "") || 0) / 1000)).filter(Boolean);
    const prof: Profile = { lastPost: ts.length ? Math.max(...ts) : null, followers: x.followersCount ?? null, posts: x.postsCount ?? null, externalUrl: link, email: null, phone: null, isBusiness: Boolean(x.isBusinessAccount) };
    const { score, why } = scoreOf(prof);
    if (x.is_joined_recently) why.push("NEW ACCOUNT (Instagram: joined recently)");
    why.push(`found via #${c.t.tag}`);
    const r = await pool.query(
      `INSERT INTO leads (name, niche, area, state, ig_handle, status, source, last_active, ig_followers, ig_posts, ig_link, ig_business, hot_score, hot_why, ig_checked_at)
       VALUES ($1,$2,$3,$4,$5,'new','ig_hashtag', CASE WHEN $6 > 0 THEN to_timestamp($6) ELSE NULL END, $7,$8,$9,$10,$11,$12, now())
       ON CONFLICT DO NOTHING RETURNING id`,
      [name.slice(0, 120), c.t.niche, `${c.t.city} ${c.t.state}`, c.t.state, h, prof.lastPost ?? 0, prof.followers, prof.posts, link, prof.isBusiness, score, why.join(", ")]);
    if (!r.rowCount) continue;
    added++;
    const fresh = prof.lastPost && Date.now() / 1000 - prof.lastPost < 60 * 86400;
    if (!link && fresh && (prof.followers ?? 0) >= 30 && (prof.followers ?? 0) <= 15000) {
      keepers++; batchKeep++;
      console.log(`  ✅ @${h} ${prof.followers}f · ${c.t.niche} · ${c.t.city} ${c.t.state}${x.is_joined_recently ? " · NEW" : ""}`);
    }
  }
  const s = await usage();
  console.log(`  batch ${b / 40 + 1}: ${posts.length} posts → ${cand.size} new posters → ${batchKeep} no-website & active | Apify $${s.toFixed(2)}`);
}

await syncWebsitesFromBio(pool).catch(() => 0);
await new Promise((z) => setTimeout(z, 8000));
const spent = (await usage()) - spent0;
console.log(`\nDone. ${postsSeen} posts, ${checked} profiles checked, ${added} saved, ${keepers} no-website & active.`);
console.log(`Apify: $${spent.toFixed(2)} this run → $${(spent / Math.max(1, keepers)).toFixed(3)} per no-website lead.`);
await pool.end();
