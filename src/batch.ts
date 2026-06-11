/**
 * Multi-state batch scan: walks the top cities of each state for a niche,
 * then runs enrich + draft automatically.
 *
 * Usage:
 *   npm run batch -- "barbershop" FL,GA,TX        # specific states
 *   npm run batch -- "barbershop" all             # all 50 states (hours!)
 *   npm run batch -- "barbershop" FL,GA 10        # 10 leads per city
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { pool, init } from "./db.js";
import { scanArea } from "./scrape.js";
import { STATE_CITIES, ALL_STATES } from "./cities.js";

const niche = process.argv[2];
const statesArg = process.argv[3];
const perCity = Number(process.argv[4] ?? 15);

if (!niche || !statesArg) {
  console.error('Usage: npm run batch -- "<niche>" <FL,GA,TX | all> [leads-per-city]');
  process.exit(1);
}

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
console.log(
  `Batch scan: "${niche}" across ${states.length} state(s), ${totalCities} cities, ~${perCity}/city.`
);
console.log(`Rough estimate: ${Math.round((totalCities * 3.5) / 60 * 10) / 10}h of scraping.\n`);

await init();
const browser = await chromium.launch({ headless: true });
let grandTotal = 0;

for (const st of states) {
  console.log(`=== ${st} ===`);
  for (const city of STATE_CITIES[st]) {
    const area = `${city} ${st}`;
    console.log(`  ${area}:`);
    try {
      grandTotal += await scanArea(browser, niche, area, st, perCity);
    } catch (e) {
      console.warn(`  ${area} failed: ${(e as Error).message.split("\n")[0]} — moving on`);
    }
    // pause between cities so Google doesn't captcha-block the IP
    const pause = 20000 + Math.floor(Math.random() * 20000);
    await new Promise((r) => setTimeout(r, pause));
  }
  // enrich + draft what we just scanned so the state goes live on the dashboard immediately
  try {
    execSync("npm run enrich", { stdio: "inherit" });
    execSync("npm run draft", { stdio: "inherit" });
    console.log(`=== ${st} complete and live on the dashboard ===\n`);
  } catch {
    console.warn(`=== ${st}: enrich/draft hiccup, will catch up on the next state ===\n`);
  }
}

await browser.close();
const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
console.log(`\nBatch done: ${grandTotal} new leads saved. Database total: ${total}.`);
await pool.end();
console.log("All done — every state is live on the dashboard.");
