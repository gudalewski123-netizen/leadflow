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
import { isFranchise } from "./score.js";
import { isRelevant } from "./relevance.js";
import { IG_NO_SITE_SQL } from "./sitecheck.js";

const NOT_LOCAL = /\b(magazine|academy|training|course|supply|supplies|official|news|podcast|expo|association|marketing|agency|digital|seo|leads?\s?gen|snooker|billiards?|pool\s?hall|pool\s?tables?)\b/i;
const NOT_US = /(\b(uk|u\.k\.|united kingdom|england|scotland|wales|ireland|canada|ontario|alberta|british columbia|australia|nsw|new zealand|dubai|abu\s?dhabi)\b|\.ca\b|🇬🇧|🇨🇦|🇦🇺|🇮🇪|🇳🇿)/i;   // countries only: Manchester CT / London KY are US towns
// Cyrillic, Arabic, Thai, CJK, Devanagari … in the NAME = not a US local business (2026-10-18: Russian-language
// detailers, an Indonesian "Kontraktor, Bangunan"); WhatsApp links with a non-US country code; UK/ID place words
const FOREIGN_SCRIPT = /[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
// UK trade vocabulary, matched inside handles too ("alphavaleting"): Birmingham/Manchester searches return UK accounts
const UK_TRADE = /(valeting|jet\s?wash|groundworks|tarmac|\bltd\b|landscapes?\s?ltd|gardening\s?services)/i;
const FOREIGN_WORDS = /\b(kontraktor|bangunan|arsitek|jasa|tukang|wiltshire|digbeth|birmingham uk|valeting|essex|kent|surrey|devon|cornwall|cymru)\b/i;
const MAX_LOCAL_FOLLOWERS = 15000;   // above this they were bands, YouTubers, influencers — not a local trade

async function main() {
  const dry = process.argv.includes("--dry");
  await init();
  const { rows } = await pool.query(`SELECT id, name, ig_handle, niche, ig_followers, ig_link FROM leads WHERE status = 'new' AND ig_handle IS NOT NULL AND ig_handle <> ''`);
  const inQueue = new Set((await pool.query(`SELECT id FROM leads WHERE ${IG_NO_SITE_SQL}`)).rows.map((r) => r.id));
  const hits: { id: number; why: string; name: string }[] = [];
  for (const r of rows) {
    const link = String(r.ig_link ?? "");
    const waForeign = /wa\.me\/(?!1\d{10})\+?\d{6,}/.test(link) || /wa\.me\/message/.test(link) && false;
    const why = isFranchise(r.name, r.ig_handle) ? "franchise"
      : NOT_US.test(r.name ?? "") || FOREIGN_SCRIPT.test(r.name ?? "") || FOREIGN_WORDS.test(`${r.name} ${r.ig_handle}`) || UK_TRADE.test(`${r.name} ${r.ig_handle}`) || waForeign ? "not US"
      : NOT_LOCAL.test(r.name ?? "") ? "not a local business"
      : inQueue.has(r.id) && (r.ig_followers ?? 0) > MAX_LOCAL_FOLLOWERS ? "creator/media account (follower count)"
      // judged only on leads that would reach the "No site" queue: across all 16k rows the name test flagged
      // 4,031, many of them real trades in fancy Unicode fonts (𝐇𝐚𝐢𝐫) — normalised before testing
      : inQueue.has(r.id) && r.niche && !isRelevant(r.niche, (r.name ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, ""), r.ig_handle)
        ? "not this trade (name/handle)"
      : "";
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
