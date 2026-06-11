/**
 * Scan a single area on Google Maps. Runs locally, writes to shared DB.
 * Usage: npm run scan -- "barbershop" "Miami FL" [limit]
 * For multi-state sweeps use: npm run batch
 */
import { chromium } from "playwright";
import { pool, init } from "./db.js";
import { scanArea, stateFromArea } from "./scrape.js";

const niche = process.argv[2];
const area = process.argv[3];
const limit = Number(process.argv[4] ?? 120);

if (!niche || !area) {
  console.error('Usage: npm run scan -- "<niche>" "<city ST>" [limit]');
  process.exit(1);
}

await init();
const browser = await chromium.launch({ headless: true });
console.log(`Searching Google Maps: ${niche} in ${area}`);
const saved = await scanArea(browser, niche, area, stateFromArea(area), limit);
await browser.close();

const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
console.log(`\nSaved ${saved} leads. Database total: ${total}.`);
console.log("Next: npm run enrich");
await pool.end();
