/**
 * Re-apply today's quality filters to leads stored before the filters existed (2026-10-18).
 * The hunters drop franchises / aggregators / non-US accounts at hunt time, but rows saved earlier never
 * met the newer rules — Fish Window Cleaning (a national franchise) and "Ben's Gutters | UK" were still
 * sitting in the to-contact list. Marks them status='skip' with the reason in site_notes. Idempotent.
 *
 *   npm run sweep            # apply
 *   npm run sweep -- --dry   # list only
 */
import { pool, init } from "./db.js";
import { IG_NO_SITE_SQL } from "./sitecheck.js";
import { junkReason } from "./quality.js";

async function main() {
  const dry = process.argv.includes("--dry");
  await init();
  const { rows } = await pool.query(`SELECT id, name, ig_handle, niche, ig_followers, ig_link FROM leads WHERE status = 'new' AND ig_handle IS NOT NULL AND ig_handle <> ''`);
  const inQueue = new Set((await pool.query(`SELECT id FROM leads WHERE ${IG_NO_SITE_SQL}`)).rows.map((r) => r.id));
  const hits: { id: number; why: string; name: string }[] = [];
  for (const r of rows) {
    // the full (strict) check only for leads that would reach the "No site" queue; the rest get the
    // basic one (franchise / not US / not local) — a big following is fine for a No-AEO pitch
    const why = junkReason(r, inQueue.has(r.id));
    if (why) hits.push({ id: r.id, why, name: r.name });
  }
  const by: Record<string, number> = {};
  for (const h of hits) by[h.why] = (by[h.why] ?? 0) + 1;
  console.log(`${hits.length} of ${rows.length} to skip`, by);
  for (const h of hits.slice(0, 12)) console.log(`  ${h.why.padEnd(20)} ${h.name}`);
  if (!dry) for (const h of hits)
    await pool.query(`UPDATE leads SET status = 'skip', site_notes = $2 WHERE id = $1 AND status = 'new'`, [h.id, `skipped by sweep 2026-10-18: ${h.why}`]);
  await pool.end();
}
main();
