/**
 * Look INSIDE link-in-bio pages for the business's real website.
 *
 * 2026-10-18 (Gregg: "these leads are hot garbage"): 172 of the "no website" Instagram leads had a
 * linktr.ee bio link — sitecheck.ts rightly says a Linktree is not a website, but a Linktree very often
 * LISTS the website. Pitching "you don't have a website" to them repeats the 10-15 incident.
 *
 * For each unchecked lead whose bio link is a link page (or a shortener we can follow), fetch the page
 * directly (plain HTTP — no Apify, no Instagram session) and collect its outbound links. A link counts as
 * THEIR website when its domain shares a 4+ letter token with the business name or handle, or it is a
 * site-builder address (wixsite, square.site, godaddysites, business.site, weebly, sites.google.com …).
 * Payment / shopping / social / booking links never count.
 *
 *   npm run linkpage            # check everything unchecked
 *   npm run linkpage -- --dry   # report only
 */
import { pool, init } from "./db.js";
import { classifyLink } from "./sitecheck.js";

const LINK_PAGES = ["linktr.ee", "linkin.bio", "lnk.bio", "bio.link", "beacons.ai", "tap.bio", "msha.ke", "solo.to",
  "campsite.bio", "linkr.bio", "taplink.cc", "hoo.be", "allmylinks.com", "direct.me", "linkpop.com", "linkfly.to",
  "bit.ly", "tinyurl.com", "carrd.co", "stan.store"];
const NEVER_SITE = /(^|\.)(paypal\.com|paypal\.me|venmo\.com|cash\.app|zelle|amazon\.[a-z.]+|amzn\.to|etsy\.com|ebay\.com|spotify\.com|apple\.com|music\.apple|soundcloud\.com|shopify\.com|gofundme\.com|cashapp|google\.com|gstatic\.com|linktr\.ee|linktree|cloudflare|onetrust|cookielaw|fonts\.|jsdelivr|unpkg|schema\.org|w3\.org|sentry\.io|segment\.)/i;
const BUILDERS = /(wixsite\.com|square\.site|godaddysites\.com|business\.site|weebly\.com|webflow\.io|wordpress\.com|squarespace\.com|sites\.google\.com|carrd\.co|myshopify\.com|hibu\.com|yolasite\.com|jimdosite\.com|site123\.me)$/i;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

function hostOf(u: string): string {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}
const tokens = (s: string) => (s.toLowerCase().normalize("NFKD").match(/[a-z]{4,}/g) ?? [])
  .filter((t) => !["llc", "inc", "services", "service", "company", "the", "and", "official", "cleaning", "pressure",
    "washing", "lawn", "care", "landscaping", "roofing", "painting", "plumbing", "detailing", "mobile", "window"].includes(t));

/** Is `url` plausibly this business's own website? */
export function ownSite(url: string, name: string, handle: string): boolean {
  const h = hostOf(url);
  if (!h || NEVER_SITE.test(h)) return false;
  if (BUILDERS.test(h)) return true;
  if (classifyLink(url) !== "website") return false;
  const core = h.replace(/\.(com|net|org|co|us|biz|info|io|pro|services|llc)(\.[a-z]{2})?$/, "").replace(/[^a-z0-9]/g, "");
  const toks = new Set([...tokens(name), ...tokens(handle.replace(/[._]/g, " ")), ...tokens(handle)]);
  for (const t of toks) if (core.includes(t)) return true;
  // a handle squashed into the domain ("smithsroofing" in smithsroofingllc.com)
  const hs = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  return hs.length >= 6 && (core.includes(hs) || hs.includes(core) && core.length >= 6);
}

async function fetchPage(url: string): Promise<{ finalUrl: string; html: string } | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(/^https?:\/\//i.test(url) ? url : `https://${url}`, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html" } });
    if (!r.ok) return { finalUrl: r.url, html: "" };
    return { finalUrl: r.url, html: (await r.text()).slice(0, 600_000) };
  } catch { return null; } finally { clearTimeout(t); }
}

function outboundLinks(html: string): string[] {
  const out = new Set<string>();
  // Linktree ships its links inside HTML-escaped JSON ("&quot;url&quot;:&quot;https://…")
  html = html.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x2F;|&#47;/g, "/");
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\)]+/g)) out.add(m[0].replace(/\\\//g, "/").replace(/[.,;]+$/, ""));
  return [...out];
}

type Q = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };
export async function ensureLinkpageColumn(db: Q) {
  await db.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkpage_checked_at TIMESTAMPTZ");
}

/** Check every unchecked link page; returns how many turned out to hold a website. */
export async function checkLinkPages(db: Q, { dry = false, quiet = false } = {}): Promise<number> {
  const pool = db;
  await ensureLinkpageColumn(db);
  // the scraper stored a missing bio link as the string "false" on some rows
  if (!dry) await pool.query("UPDATE leads SET ig_link = NULL WHERE ig_link IN ('false','null','undefined')");
  const { rows } = await pool.query(
    `SELECT id, name, ig_handle, ig_link FROM leads
      WHERE status IN ('new','sent') AND ig_link IS NOT NULL AND ig_link <> '' AND (website IS NULL OR website = '')
        AND linkpage_checked_at IS NULL`);
  const todo = rows.filter((r) => {
    const h = hostOf(r.ig_link);
    return h === "sites.google.com" || LINK_PAGES.some((d) => h === d || h.endsWith("." + d));
  });
  if (!quiet) console.log(`link pages to check: ${todo.length}`);
  let found = 0, none = 0, dead = 0;
  for (const r of todo) {
    let site: string | null = null;
    if (hostOf(r.ig_link) === "sites.google.com") site = r.ig_link;          // a Google Site IS a website
    else {
      const pg = await fetchPage(r.ig_link);
      if (!pg) { dead++; continue; }                                           // retry next run
      const fin = hostOf(pg.finalUrl);
      if (ownSite(pg.finalUrl, r.name, r.ig_handle) && !LINK_PAGES.includes(fin)) site = pg.finalUrl;   // shortener -> their site
      else site = outboundLinks(pg.html).find((u) => ownSite(u, r.name, r.ig_handle)) ?? null;
      await new Promise((res) => setTimeout(res, 400));                        // polite
    }
    if (site) found++; else none++;
    if (site && !quiet) console.log(`  HAS SITE  ${r.name.slice(0, 40).padEnd(40)} @${r.ig_handle}  ->  ${site}`);
    if (!dry) await pool.query(
      `UPDATE leads SET linkpage_checked_at = now(), website = COALESCE($2, website),
              site_notes = CASE WHEN $2::text IS NOT NULL THEN 'website found inside link-in-bio page (linkpage)' ELSE site_notes END
        WHERE id = $1`, [r.id, site]);
  }
  if (!quiet) console.log(`done: ${found} have a website inside their link page, ${none} genuinely none, ${dead} unreachable`);
  return found;
}

async function main() {
  await init();
  await checkLinkPages(pool, { dry: process.argv.includes("--dry") });
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
