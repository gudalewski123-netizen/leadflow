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

// BREADTH-FIRST: niche is the OUTER loop, so we sweep one business type across
// EVERY state before moving to the next type. That way all 50 states get leads
// within the first pass (a few hours) instead of one state hogging days of
// scanning. Each (niche, state) gets a fresh browser, closed before enrich/draft.
for (const niche of niches) {
  console.log(`\n########## NICHE: ${niche} ##########`);
  for (const st of states) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (e) {
      console.warn(`  ${st}/${niche}: browser launch failed (${(e as Error).message.split("\n")[0]}) — skipping`);
      continue;
    }

    for (const city of STATE_CITIES[st]) {
      const area = `${city} ${st}`;
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
    try {
      execSync("npm run enrich", { stdio: "inherit" });
      execSync("npm run draft", { stdio: "inherit" });
      console.log(`=== ${st} / ${niche} done and live ===\n`);
    } catch {
      console.warn(`=== ${st} / ${niche}: enrich/draft hiccup, will catch up later ===\n`);
    }
  }
}

const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
console.log(`\nBatch done: ${grandTotal} new leads saved. Database total: ${total}.`);
await pool.end();
console.log("All done — every state is live on the dashboard.");
