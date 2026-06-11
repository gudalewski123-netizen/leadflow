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
import { STATE_CITIES, ALL_STATES, NICHES } from "./cities.js";

const nicheArg = process.argv[2];
const statesArg = process.argv[3];
const perCity = Number(process.argv[4] ?? 120); // Google caps a search at ~120

if (!nicheArg || !statesArg) {
  console.error('Usage: npm run batch -- <"niche" | allbiz> <FL,GA,TX | all> [leads-per-city]');
  process.exit(1);
}

// "allbiz" rotates through every local-business niche; otherwise just the one.
const niches = nicheArg.toLowerCase() === "allbiz" ? NICHES : [nicheArg];

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

for (const st of states) {
  console.log(`=== ${st} ===`);
  for (const city of STATE_CITIES[st]) {
    const area = `${city} ${st}`;

    // Fresh browser PER CITY: isolates crashes (one bad city can't kill the run)
    // and the browser is fully closed before each enrich/draft step, so the
    // synchronous CLI work can't starve Playwright's connection.
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      console.warn(`  ${area}: could not launch browser (${(e as Error).message.split("\n")[0]}) — skipping`);
      continue;
    }

    for (const niche of niches) {
      console.log(`  ${area} — ${niche}:`);
      try {
        grandTotal += await scanArea(browser, niche, area, st, perCity);
      } catch (e) {
        console.warn(`  ${area}/${niche} failed: ${(e as Error).message.split("\n")[0]} — moving on`);
      }
      // pause between searches so Google doesn't captcha-block the IP
      const pause = 12000 + Math.floor(Math.random() * 14000);
      await new Promise((r) => setTimeout(r, pause));
    }

    // close the browser BEFORE enrich/draft so the blocking CLI work runs clean
    await browser.close().catch(() => {});

    // enrich + draft this city so its leads go live on the dashboard right away
    try {
      execSync("npm run enrich", { stdio: "inherit" });
      execSync("npm run draft", { stdio: "inherit" });
      console.log(`=== ${area} complete and live on the dashboard ===\n`);
    } catch {
      console.warn(`=== ${area}: enrich/draft hiccup, will catch up later ===\n`);
    }
  }
}

const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
console.log(`\nBatch done: ${grandTotal} new leads saved. Database total: ${total}.`);
await pool.end();
console.log("All done — every state is live on the dashboard.");
