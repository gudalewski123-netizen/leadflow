/** Shared Google Maps scraping logic used by scan.ts (single area) and batch.ts (multi-state). */
import { Browser, Page } from "playwright";
import { upsertLead } from "./db.js";

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

/** Scan one "<city> <ST>" area. Returns number of leads saved. */
export async function scanArea(
  browser: Browser,
  niche: string,
  area: string,
  state: string | null,
  limit: number
): Promise<number> {
  const page = await browser.newPage({
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const query = `${niche} in ${area}`;
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
    let saved = 0;
    for (const url of links) {
      try {
        const p = await scrapePlace(page, url);
        if (!p) continue;
        await upsertLead({ ...p, niche, area, state });
        saved++;
        console.log(
          `    [${saved}/${links.length}] ${p.name}${p.website ? "" : "  ** NO WEBSITE **"}`
        );
      } catch (e) {
        console.warn(`    skipped: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return saved;
  } finally {
    await page.close();
  }
}

/** "Miami FL" → "FL" if the last token looks like a state code. */
export function stateFromArea(area: string): string | null {
  const m = area.trim().match(/\b([A-Z]{2})$/);
  return m ? m[1] : null;
}
