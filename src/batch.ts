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
import { NICHES, TRADES, buildRegions, Region } from "./cities.js";

const nicheArg = process.argv[2];
const regionArg = process.argv[3];
const perCity = Number(process.argv[4] ?? 120); // Google caps a search at ~120

if (!nicheArg || !regionArg) {
  console.error('Usage: npm run batch -- <"niche" | allbiz> <us | world | intl | uk,poland,FL | ...> [leads/search]');
  process.exit(1);
}

// "allbiz" = all 35 niches, "trades" = the 5 skilled trades, a comma list =
// those exact niches, otherwise a single niche.
const niches =
  nicheArg.toLowerCase() === "allbiz" ? NICHES
  : nicheArg.toLowerCase() === "trades" ? TRADES
  : nicheArg.includes(",") ? nicheArg.split(",").map((s) => s.trim())
  : [nicheArg];

// Region selector: us / world / intl / a comma list of US states + countries.
const regions: Region[] = buildRegions(regionArg);
if (!regions.length) {
  console.error(`No regions matched "${regionArg}". Try: us, world, intl, uk, poland, "FL,GA", "uk,poland".`);
  process.exit(1);
}

const totalCities = regions.reduce((n, r) => n + r.areas.length, 0);
console.log(
  `Batch scan: ${niches.length} niche(s) × ${regions.length} region(s) × cities = ${totalCities * niches.length} searches, ~${perCity}/search.`
);
console.log(`Regions: ${regions.map((r) => r.state).join(", ")}`);
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

// Scan one region's cities for one niche (its own browser, isolated from others).
// A region is a US state ("AL" → "Birmingham AL") or a country ("Poland" →
// "Warsaw, Poland"); scanArea stores region.state so the dashboard can filter by it.
async function scanRegion(region: Region, niche: string) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.warn(`  ${region.state}/${niche}: browser launch failed (${(e as Error).message.split("\n")[0]})`);
    return;
  }
  try {
    for (const area of region.areas) {
      console.log(`  ${area} — ${niche}:`);
      try {
        grandTotal += await scanArea(browser, niche, area, region.state, perCity);
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

// PARALLEL + CONTINUOUS: scan several regions AT ONCE so they all fill in fast
// instead of waiting in line. enrich/draft is handled continuously by the
// background watcher (tools/watch-enrich.sh), so the scan just keeps scanning.
// The whole thing loops forever — each pass re-sweeps and catches new businesses
// (dedup on name+area means nothing is double-counted). Kill the process to stop.
const REGION_CONCURRENCY = 4;
for (let pass = 1; ; pass++) {
  console.log(`\n==================== PASS ${pass} (${REGION_CONCURRENCY} regions at once) ====================`);
  for (const niche of niches) {
    console.log(`\n########## NICHE: ${niche} (pass ${pass}) ##########`);
    await runPool(regions, REGION_CONCURRENCY, (r) => scanRegion(r, niche));
    const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
    console.log(`=== ${niche} swept across all ${regions.length} regions — ${total} total leads (pass ${pass}) ===`);
  }
  console.log(`\n########## PASS ${pass} COMPLETE — looping for more ##########`);
}
