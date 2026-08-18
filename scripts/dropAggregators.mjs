import { pool, init } from "../src/db.js";
import { LINK_AGGREGATOR } from "../src/score.js";

await init();
const { rows } = await pool.query(
  `SELECT id, name, ig_handle, ig_link, status FROM leads WHERE ig_link IS NOT NULL`
);
const hits = rows.filter(r => LINK_AGGREGATOR.test(r.ig_link));
console.log(`Found ${hits.length} leads with a link-aggregator bio link.`);
const byStatus = {};
for (const h of hits) byStatus[h.status] = (byStatus[h.status] ?? 0) + 1;
console.log("By status:", byStatus);

const toSkip = hits.filter(h => h.status === 'new');
console.log(`Skipping ${toSkip.length} (status='new' -> 'skip'). Leaving already-sent/replied ones untouched.`);

let done = 0;
for (const h of toSkip) {
  await pool.query("UPDATE leads SET status='skip' WHERE id=$1", [h.id]);
  done++;
}
console.log(`Done. ${done} leads marked skip.`);
await pool.end();
