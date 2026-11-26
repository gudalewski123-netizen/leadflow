/**
 * Check the unchecked scout names (Gregg's Chrome tab, $0) — 2026-11-13, Gregg: "check the 150 for websites".
 *   npx tsx src/scoutcheck.ts --list                print the unchecked handles as JSON
 *   npx tsx src/scoutcheck.ts <checked.json>        apply results
 * checked.json = [{h, posts, followers, link, last (unix s|0), priv, gone}] read from each profile page in the tab.
 * Same scoring + quality gate as every other source; junk gets status 'skip' with the reason (undo: status='new').
 */
import { readFileSync } from "node:fs";
import { pool, init } from "./db.js";
import { scoreOf, type Profile } from "./score.js";
import { junkReason } from "./quality.js";
import { classifyLink } from "./sitecheck.js";

await init();
if (process.argv[2] === "--list") {
  const r = await pool.query("SELECT ig_handle FROM leads WHERE source='ig_scout' AND ig_checked_at IS NULL AND hot_why LIKE '%not checked yet%' ORDER BY id");
  console.log(JSON.stringify(r.rows.map((x) => x.ig_handle)));
  await pool.end(); process.exit(0);
}
const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as any[];
let ok = 0, keepers = 0, skipped = 0;
for (const r of rows) {
  const h = String(r.h).toLowerCase();
  const lead = (await pool.query("SELECT id, name, niche, hot_why FROM leads WHERE lower(ig_handle)=$1 AND source='ig_scout' LIMIT 1", [h])).rows[0];
  if (!lead) continue;
  const tag = String(lead.hot_why ?? "").match(/#(\S+)/)?.[1] ?? "?";
  if (r.gone || r.priv) {
    await pool.query("UPDATE leads SET status='skip', hot_why=$2, ig_checked_at=now() WHERE id=$1", [lead.id, `found by scout via #${tag}; ${r.gone ? "account gone" : "private"}`]);
    skipped++; continue;
  }
  const link = r.link ? String(r.link) : null;
  const prof: Profile = { lastPost: r.last || null, followers: r.followers ?? null, posts: r.posts ?? null, externalUrl: link, email: null, phone: null, isBusiness: false };
  const { score, why } = scoreOf(prof);
  why.push(`found by scout via #${tag}`);
  const junk = junkReason({ name: lead.name, ig_handle: h, niche: lead.niche, ig_followers: r.followers, ig_link: link, bio: r.bio ?? "", verified: false }, true);
  await pool.query(
    `UPDATE leads SET ig_followers=$2, ig_posts=$3, ig_link=$4, last_active=CASE WHEN $5 > 0 THEN to_timestamp($5) ELSE NULL END,
       hot_score=$6, hot_why=$7, ig_checked_at=now(), status=CASE WHEN $8 <> '' THEN 'skip' ELSE status END,
       website=COALESCE(NULLIF(website, ''), $9) WHERE id=$1`,
    [lead.id, prof.followers, prof.posts, link, prof.lastPost ?? 0, score, junk ? `${why.join(", ")}; skip: ${junk}` : why.join(", "), junk,
     classifyLink(link) === "website" ? link : null]);
  ok++;
  if (junk) { skipped++; continue; }
  const active = prof.lastPost && Date.now() / 1000 - prof.lastPost < 60 * 86400;
  if (!link && active && (prof.followers ?? 0) >= 30) { keepers++; console.log(`  ✅ @${h} ${prof.followers}f · ${lead.niche}`); }
}
console.log(`${rows.length} checked → ${ok} updated, ${keepers} no-website & posting, ${skipped} skipped (private/gone/junk). Cost $0.`);
await pool.end();
