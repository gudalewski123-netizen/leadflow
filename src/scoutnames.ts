/**
 * Save account names the in-tab scout found (Gregg's own Chrome, $0) into LeadFlow — 2026-11-12, Gregg:
 * "I just want the account names to get pulled into lead flow".
 *   npx tsx src/scoutnames.ts <names.json>     names.json = [{h, name?, cap?, tag, niche, city?, state?}]
 * Names arrive UNCHECKED (ig_checked_at NULL): they show in LeadFlow's New/All lists, never in No-site/Hot,
 * and the DM bot never sends them the "no website" opener until a check confirms it.
 * (Instagram's page CSP blocks fetches to 127.0.0.1, so the tab can't post here directly.)
 */
import { readFileSync } from "node:fs";
import { pool, init } from "./db.js";
import { isFranchise } from "./score.js";
import { isRelevant } from "./relevance.js";
import { findChains, brandKey } from "./chains.js";

const SKIP = /\b(depot|lowe'?s|home\s?advisor|angi|thumbtack|yelp|nextdoor|realty|realtor|magazine|news|seo|marketing|agency|leads|hardware|supply|alliance|foundation|nonprofit|grocery)\b|clientflow|leadgen/i;
const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as any[];
await init();
const known = new Set<string>((await pool.query("SELECT DISTINCT lower(ig_handle) h FROM leads WHERE ig_handle IS NOT NULL")).rows.map((r) => r.h));
const CHAINS = findChains((await pool.query("SELECT name, state, area FROM leads WHERE name IS NOT NULL")).rows);
const why: Record<string, number> = {}; let saved = 0;
for (const j of rows) {
  const h = String(j.h ?? "").toLowerCase().trim(), name = String(j.name || h), niche = String(j.niche || "handyman");
  const drop = (k: string) => (why[k] = (why[k] ?? 0) + 1);
  if (!h || h === "grzegorz.gudalewski") { drop("empty/self"); continue; }
  if (known.has(h)) { drop("already in LeadFlow"); continue; }
  if (SKIP.test(h) || SKIP.test(name) || isFranchise(name, h) || CHAINS.has(brandKey(name))) { drop("chain/junk"); continue; }
  if (!isRelevant(niche, name, h, String(j.cap ?? ""))) { drop("not this trade"); continue; }
  const area = j.city ? `${j.city} ${j.state ?? ""}`.trim() : (j.state ?? null);
  const r = await pool.query(`INSERT INTO leads (name, niche, area, state, ig_handle, status, source, hot_why) VALUES ($1,$2,$3,$4,$5,'new','ig_scout',$6) ON CONFLICT DO NOTHING RETURNING id`,
    [name.slice(0, 120), niche, area, j.state || null, h, `found by scout via #${j.tag} — not checked yet`]);
  known.add(h);
  if (r.rowCount) { saved++; console.log(`+ @${h}  ${name}  (${niche}, #${j.tag})`); }
}
console.log(`${rows.length} names → ${saved} new in LeadFlow. Skipped: ${JSON.stringify(why)}`);
await pool.end();
