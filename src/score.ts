/**
 * Shared hot-lead scoring. Used by both src/hot.ts (direct IG session) and
 * src/hotapify.ts (Apify) so the two data sources can never drift apart.
 */

/**
 * Link-in-bio AGGREGATORS (Linktree, Beacons, Taplink, …) bundle several links
 * behind one page — and very often one of those links is a real website
 * (a franchise page, a corporate site, etc). Sampling hot leads on 2026-08-18
 * turned up City of Tampa, Greenpeace Hong Kong, a former Rome mayor, and a
 * 360 Painting franchise — all scored "hot" purely because their single
 * linktr.ee link wasn't detected as a website. These get capped below the
 * hot threshold: worth a look manually, never an auto-hot lead.
 */
export const LINK_AGGREGATOR =
  /linktr\.ee|link\.tree|beacons\.ai|linkin\.bio|bio\.link|allmylinks|taplink|milkshake|campsite\.bio|msha\.ke|solo\.to|shorby/i;

/**
 * Single-purpose booking/CRM/social landing pages that are NOT a real website
 * — these leads stay fully hot. A trades business linking one of these has a
 * scheduling page or a social profile, not a website, and is still very much
 * a prospect. Found this on @donsdetailing, whose only link was
 * go.getjobber.com — 28k followers and no actual site.
 */
export const NOT_A_SITE =
  /facebook\.com|instagram\.com|m\.me|wa\.me|booksy|vagaro|fresha|square\.site|squareup|calendly|yelp\.com|google\.com|g\.page|getjobber|jobber\.com|housecallpro|thumbtack|angi\.com|porch\.com|nextdoor/i;

export interface Profile {
  userId?: string | null;
  lastPost: number | null; // unix seconds
  followers: number | null;
  posts: number | null;
  externalUrl: string | null;
  email: string | null;
  phone: string | null;
  isBusiness: boolean;
}

const DAY = 86400;

export function scoreOf(p: Profile): { score: number; why: string[] } {
  const why: string[] = [];
  let s = 0;

  // 1. Recency — are they active RIGHT NOW? Biggest single factor.
  if (p.lastPost) {
    const ageDays = (Date.now() / 1000 - p.lastPost) / DAY;
    if (ageDays <= 7) { s += 40; why.push("posted this week"); }
    else if (ageDays <= 14) { s += 33; why.push("posted <2wk"); }
    else if (ageDays <= 30) { s += 26; why.push("posted <1mo"); }
    else if (ageDays <= 90) { s += 12; why.push("posted <3mo"); }
    else if (ageDays <= 180) { s += 4; why.push("posted <6mo"); }
    else why.push("stale");
  }

  // 2. Bio link — the money signal.
  let aggregator = false;
  if (!p.externalUrl) { s += 30; why.push("NO link in bio"); }
  else if (LINK_AGGREGATOR.test(p.externalUrl)) { aggregator = true; why.push("link-in-bio page — may hide a real site"); }
  else if (NOT_A_SITE.test(p.externalUrl)) { s += 22; why.push("booking/social page only"); }

  // 3. Treating IG as a business channel.
  if (p.isBusiness) { s += 10; why.push("business acct"); }

  // 4. Real local audience — big enough to have revenue, small enough to need
  //    us. Above 50k followers gets no bonus at all: that's a chain, brand,
  //    public figure, or org, not a small local business.
  if (p.followers != null) {
    if (p.followers >= 500 && p.followers <= 50000) { s += 10; why.push(`${p.followers} followers`); }
    else if (p.followers >= 150 && p.followers < 500) { s += 5; why.push(`${p.followers} followers`); }
  }

  // 5. Enough content to actually build a site from.
  if ((p.posts ?? 0) >= 20) { s += 5; why.push(`${p.posts} posts`); }

  // 6. Public contact = a second channel that isn't a DM.
  if (p.email) { s += 5; why.push("public email"); }

  const score = aggregator ? Math.min(s, 45) : Math.min(100, s);
  return { score, why };
}
