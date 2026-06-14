/**
 * Multi-state batch scan: walks the top cities of each state for one or many
 * niches, then runs enrich + draft automatically.
 *
 * Usage:
 *   npm run batch -- "barbershop" FL,GA,TX        # one niche, specific states
 *   npm run batch -- allbiz all                   # ALL business types, all 50 states
 *   npm run batch -- allbiz FL,GA                 # all business types in FL + GA
 *   npm run batch -- "nail salon" all 80          # one niche, 80 leads/city
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { pool, init } from "./db.js";
import { scanArea } from "./scrape.js";
import { STATE_CITIES, ALL_STATES, NICHES, TRADES } from "./cities.js";

const nicheArg = process.argv[2];
const statesArg = process.argv[3];
const perCity = Number(process.argv[4] ?? 120); // Google caps a search at ~120

if (!nicheArg || !statesArg) {
  console.error('Usage: npm run batch -- <"niche" | allbiz> <FL,GA,TX | all> [leads-per-city]');
  process.exit(1);
}

// "allbiz" = all 35 niches, "trades" = the 5 skilled trades, a comma list =
// those exact niches, otherwise a single niche.
const niches =
  nicheArg.toLowerCase() === "allbiz" ? NICHES
  : nicheArg.toLowerCase() === "trades" ? TRADES
  : nicheArg.includes(",") ? nicheArg.split(",").map((s) => s.trim())
  : [nicheArg];

const states =
  statesArg.toLowerCase() === "all"
    ? ALL_STATES
    : statesArg.toUpperCase().split(",").map((s) => s.trim());

const unknown = states.filter((s) => !STATE_CITIES[s]);
if (unknown.length) {
  console.error(`Unknown state code(s): ${unknown.join(", ")}`);
  process.exit(1);
}

const totalCities = states.reduce((n, s) => n + STATE_CITIES[s].length, 0);
const totalScans = totalCities * niches.length;
console.log(
  `Batch scan: ${niches.length} niche(s) × ${states.length} state(s) × cities = ${totalScans} searches, ~${perCity}/search.`
);
console.log(`Niches: ${niches.join(", ")}\n`);

await init();
let grandTotal = 0;

// run an async fn over items with at most `limit` running concurrently
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item === undefined) break;
        try { await fn(item); } catch (e) { console.warn(`pool item failed: ${(e as Error).message.split("\n")[0]}`); }
      }
    })
  );
}

// Scan one state's cities for one niche (its own browser, isolated from others).
async function scanState(st: string, niche: string) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.warn(`  ${st}/${niche}: browser launch failed (${(e as Error).message.split("\n")[0]})`);
    return;
  }
  try {
    for (const city of STATE_CITIES[st]) {
      const area = `${city} ${st}`;
      console.log(`  ${area} — ${niche}:`);
      try {
        grandTotal += await scanArea(browser, niche, area, st, perCity);
      } catch (e) {
        console.warn(`  ${area}/${niche} failed: ${(e as Error).message.split("\n")[0]} — moving on`);
      }
      const pause = 8000 + Math.floor(Math.random() * 8000);
      await new Promise((r) => setTimeout(r, pause));
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// PARALLEL + CONTINUOUS: scan several states AT ONCE so all 50 fill in fast
// instead of waiting alphabetically. enrich/draft is handled continuously by the
// background watcher (tools/watch-enrich.sh), so the scan just keeps scanning.
// The whole thing loops forever — each pass re-sweeps and catches new businesses
// (dedup on name+area means nothing is double-counted). Kill the process to stop.
const STATE_CONCURRENCY = 4;
for (let pass = 1; ; pass++) {
  console.log(`\n==================== PASS ${pass} (${STATE_CONCURRENCY} states at once) ====================`);
  for (const niche of niches) {
    console.log(`\n########## NICHE: ${niche} (pass ${pass}) ##########`);
    await runPool(states, STATE_CONCURRENCY, (st) => scanState(st, niche));
    const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
    console.log(`=== ${niche} swept across all ${states.length} states — ${total} total leads (pass ${pass}) ===`);
  }
  console.log(`\n########## PASS ${pass} COMPLETE — looping for more ##########`);
}
