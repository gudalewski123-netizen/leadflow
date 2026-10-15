/**
 * Is an Instagram bio link a real website?
 *
 * 2026-10-13/15 incident: the Instagram hunt (apify_hunt) never looks up a website, so `website`
 * was NULL on every IG lead — and NULL was read as "no website". 610 of 684 hot leads had a bio
 * link, most of them real sites, and ~12 businesses with their own domain were DM'd "you don't
 * have a website". Gregg: "these leads are ass with websites".
 *
 * Rule from here on: a lead is "no website" only when we LOOKED and found none. A bio link to the
 * business's own domain (incl. wix/square/godaddy/google-site builders) IS a website.
 * Link-in-bio pages, social profiles, chat links and booking widgets are NOT a website.
 */
const NOT_A_SITE = [
  // link-in-bio pages
  "linktr.ee", "linkin.bio", "lnk.bio", "bio.link", "beacons.ai", "tap.bio", "msha.ke", "solo.to", "campsite.bio",
  "linkr.bio", "taplink.cc", "stan.store", "hoo.be", "allmylinks.com", "carrd.co", "direct.me", "linkpop.com",
  // social / chat / maps
  "instagram.com", "facebook.com", "fb.me", "fb.com", "m.facebook.com", "wa.me", "whatsapp.com", "api.whatsapp.com",
  "tiktok.com", "youtube.com", "youtu.be", "twitter.com", "x.com", "threads.net", "linkedin.com", "pinterest.com",
  "snapchat.com", "t.me", "yelp.com", "nextdoor.com", "thumbtack.com", "angi.com", "homeadvisor.com",
  "g.page", "goo.gl", "maps.app.goo.gl", "google.com", "share.google",
  // booking / invoicing widgets (a booking page, not a website)
  "calendly.com", "booksy.com", "vagaro.com", "squareup.com", "book.squareup.com", "clienthub.getjobber.com",
  "getjobber.com", "housecallpro.com", "book.housecallpro.com", "setmore.com", "acuityscheduling.com",
  "fresha.com", "styleseat.com", "urable.com", "bit.ly", "tinyurl.com", "linkfly.to",
];

export type LinkKind = "website" | "not_a_site" | "none";

export function classifyLink(url: string | null | undefined): LinkKind {
  if (!url || !url.trim()) return "none";
  let host = "";
  try { host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); }
  catch { return "none"; }
  host = host.replace(/^www\./, "");
  if (!host.includes(".")) return "none";
  if (NOT_A_SITE.some((d) => host === d || host.endsWith("." + d))) return "not_a_site";
  return "website";
}

/** Record bio-link websites on leads that have none on file. Idempotent; run before any "no website"
    decision (sender queue, dashboard start). Returns how many leads got a website. */
export async function syncWebsitesFromBio(pool: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id, ig_link FROM leads WHERE ig_link IS NOT NULL AND ig_link <> '' AND (website IS NULL OR website = '')`);
  const ids = rows.filter((r) => classifyLink(r.ig_link) === "website");
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    await pool.query(
      `UPDATE leads AS l SET website = v.link,
              site_notes = COALESCE(NULLIF(l.site_notes, ''), 'website from Instagram bio link (sitecheck)')
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS link) v
        WHERE l.id = v.id AND (l.website IS NULL OR l.website = '')`,
      [chunk.map((r) => r.id), chunk.map((r) => r.ig_link)]);
  }
  return ids.length;
}
