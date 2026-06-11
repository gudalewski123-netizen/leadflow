/**
 * Scrape Google Maps for businesses in a niche + area. Runs locally, writes to shared DB.
 * Usage: npm run scan -- "barbershop" "Miami FL" [limit]
 */
import { chromium, Page } from "playwright";
import { pool, init, upsertLead } from "./db.js";

const niche = process.argv[2];
const area = process.argv[3];
const limit = Number(process.argv[4] ?? 25);

if (!niche || !area) {
  console.error('Usage: npm run scan -- "<niche>" "<city, state>" [limit]');
  process.exit(1);
}

async function collectPlaceLinks(page: Page, want: number): Promise<string[]> {
  const feed = page.locator('[role="feed"]');
  await feed.waitFor({ timeout: 20000 });
  let links: string[] = [];
  let stale = 0;
  while (links.length < want && stale < 6) {
    const before = links.length;
    links = await page.$$eval('a[href*="/maps/place/"]', (as) =>
      [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]
    );
    if (links.length === before) stale++;
    else stale = 0;
    await feed.evaluate((el) => el.scrollBy(0, 2000));
    await page.waitForTimeout(900);
  }
  return links.slice(0, want);
}

async function scrapePlace(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator("h1").first().waitFor({ timeout: 15000 });
  const name = (await page.locator("h1").first().textContent())?.trim();
  if (!name) return null;

  const attr = async (sel: string, a: string) =>
    (await page.locator(sel).first().getAttribute(a).catch(() => null)) ?? null;
  const text = async (sel: string) =>
    (await page.locator(sel).first().textContent().catch(() => null))?.trim() ?? null;

  const website = await attr('a[data-item-id="authority"]', "href");
  const phoneRaw = await attr('button[data-item-id^="phone:tel:"]', "data-item-id");
  const phone = phoneRaw ? phoneRaw.replace("phone:tel:", "") : null;
  const addrLabel = await attr('button[data-item-id="address"]', "aria-label");
  const address = addrLabel ? addrLabel.replace(/^Address:\s*/i, "") : null;

  let rating: number | null = null;
  let reviews: number | null = null;
  const ratingText = await text("div.F7nice");
  if (ratingText) {
    const m = ratingText.match(/([\d.]+)\s*\(?([\d,]+)?/);
    if (m) {
      rating = parseFloat(m[1]) || null;
      reviews = m[2] ? parseInt(m[2].replace(/,/g, "")) : null;
    }
  }

  return { name, website, phone, address, rating, reviews, maps_url: url };
}

await init();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "en-US",
  viewport: { width: 1440, height: 900 },
});

const query = `${niche} in ${area}`;
console.log(`Searching Google Maps: ${query}`);
await page.goto(
  `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`,
  { waitUntil: "domcontentloaded", timeout: 45000 }
);

const consent = page.locator('button[aria-label*="Accept all"], form[action*="consent"] button');
if (await consent.first().isVisible().catch(() => false)) {
  await consent.first().click().catch(() => {});
  await page.waitForTimeout(1500);
}

const links = await collectPlaceLinks(page, limit);
console.log(`Found ${links.length} places, pulling details...`);

let saved = 0;
for (const url of links) {
  try {
    const p = await scrapePlace(page, url);
    if (!p) continue;
    await upsertLead({ ...p, niche, area });
    saved++;
    console.log(
      `  [${saved}/${links.length}] ${p.name}${p.website ? "" : "  ** NO WEBSITE **"}`
    );
  } catch (e) {
    console.warn(`  skipped ${url}: ${(e as Error).message.split("\n")[0]}`);
  }
}

await browser.close();
const total = (await pool.query("SELECT COUNT(*)::int c FROM leads")).rows[0].c;
console.log(`\nSaved ${saved} leads. Database total: ${total}.`);
console.log("Next: npm run enrich");
await pool.end();
