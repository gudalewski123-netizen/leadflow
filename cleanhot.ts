import "dotenv/config"; import pg from "pg";
import { isRelevant, MAX_FOLLOWERS } from "./src/relevance.js";
const APPLY = process.argv.includes("--apply");
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const rows = (await p.query(
  `SELECT id,name,ig_handle,niche,ig_followers,hot_score,status FROM leads WHERE status='new' AND hot_score >= 60`
)).rows;
const bad = rows.filter(r =>
  (r.ig_followers != null && r.ig_followers > MAX_FOLLOWERS) ||
  !isRelevant(r.niche, r.name, r.ig_handle, null));
// A sole trader often trades under their own name — "Mark Butts" says nothing
// about painting but may well be a painter. Separate the certain from the guess.
const OTHER = new Set(("art arts artist artists artwork studio studios gallery galleries paint painter painters fineart canvas prints printmaking illustration illustrator mural muralist sculpt ceramics pottery craft crafts designs celf " +
  "fan fanaccount music band brewing brewery promotions promotion dj photography photographer photo travel nomad guide city showroom phone mobilephone academy church school college " +
  "democrat democrats republican realty realtor salon barber tattoo fitness gym yoga restaurant cafe bakery boutique apparel clothing jewelry jewellery nails lash spa shop store market").split(" "));
// split on anything that is not a letter — "ameliabradshaw_art" and "art_of_andrea"
// both hide the word behind an underscore, which \b treats as a word character
const tokens = (s: string) => (s || "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
const otherIndustry = (r: any) => {
  const t = [...tokens(r.name), ...tokens(r.ig_handle)];
  if (t.some(w => OTHER.has(w))) return true;
  // "...art" glued to the end of a handle: lakesandlightsart, wyliecaudillart
  return t.some(w => w.length > 5 && (w.endsWith("art") || w.endsWith("arts") || w.endsWith("studio") || w.endsWith("designs")));
};
const confident = bad.filter(r => (r.ig_followers ?? 0) > 5000 || otherIndustry(r));
const uncertain = bad.filter(r => !confident.includes(r));
const tooBig = bad.filter(r => r.ig_followers > MAX_FOLLOWERS);
const offTrade = bad.filter(r => !(r.ig_followers > MAX_FOLLOWERS));
console.log(`  → ${confident.length} confident junk, ${uncertain.length} judgement calls (personal names, low followers)`);
console.log(`Hot tab: ${rows.length}. Failing today's filters: ${bad.length}`);
console.log(`  ${tooBig.length} over the ${MAX_FOLLOWERS.toLocaleString()}-follower ceiling`);
console.log(`  ${offTrade.length} with nothing about the trade in the name or handle\n`);
console.log('worst offenders:');
for (const r of [...bad].sort((a,b)=>(b.ig_followers??0)-(a.ig_followers??0)).slice(0,14))
  console.log(`  ${String(r.ig_followers ?? '—').padStart(9)}  @${(r.ig_handle||'—').padEnd(26)} ${r.name} [${r.niche}]`);
console.log('\nthe judgement calls I am NOT skipping (could be real sole traders):');
for (const r of uncertain.slice(0,14))
  console.log(`  ${String(r.ig_followers ?? '—').padStart(9)}  @${(r.ig_handle||'—').padEnd(26)} ${r.name} [${r.niche}]`);
if (APPLY) {
  const n = await p.query(`UPDATE leads SET status='skip' WHERE id = ANY($1::int[])`, [confident.map(r=>r.id)]);
  console.log(`\nAPPLIED — skipped ${n.rowCount}. Hot tab now ${(await p.query("SELECT count(*)::int n FROM leads WHERE status='new' AND hot_score>=60")).rows[0].n}`);
} else console.log('\n(dry run — nothing changed. add --apply)');
await p.end();
