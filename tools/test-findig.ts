/**
 * Sample the IG-handle search fallback before running it at scale.
 * Usage: npx tsx tools/test-findig.ts [sampleSize] [delayMs]
 */
import { pool, init } from "../src/db.js";
import { findIgHandle } from "../src/findig.js";

const N = Number(process.argv[2] ?? 20);
const DELAY = Number(process.argv[3] ?? 1500);

await init();
const { rows } = await pool.query(
  `SELECT id, name, area, reviews FROM leads
   WHERE category='no_site' AND ig_handle IS NULL AND status='new'
   ORDER BY COALESCE(reviews,0) DESC
   LIMIT $1`,
  [N]
);

console.log(`Testing ${rows.length} no_site leads (delay ${DELAY}ms)...\n`);
let hit = 0;
const t0 = Date.now();

for (const l of rows) {
  const started = Date.now();
  let handle: string | null = null;
  try {
    handle = await findIgHandle(l.name, l.area);
  } catch (e: any) {
    console.log(`  ERROR ${l.name}: ${e?.message}`);
  }
  const ms = Date.now() - started;
  if (handle) hit++;
  console.log(
    `  ${handle ? "HIT " : "miss"} ${String(l.reviews ?? 0).padStart(4)}rev  ${String(l.name).slice(0, 38).padEnd(38)} ${handle ? "@" + handle : ""}  ${ms}ms`
  );
  await new Promise((r) => setTimeout(r, DELAY));
}

const secs = (Date.now() - t0) / 1000;
console.log(`\nHIT RATE: ${hit}/${rows.length} (${Math.round((hit / rows.length) * 100)}%)`);
console.log(`Avg ${Math.round((secs / rows.length) * 1000)}ms/lead incl. delay`);
console.log(`Projected for 13,923 leads: ${((13923 * secs) / rows.length / 3600).toFixed(1)} hours`);
await pool.end();
