/**
 * On-demand Instagram handle lookup for a business, shared by enrich.ts and the
 * dashboard's /api/leads/:id/resolve-ig endpoint (clicked when a no-website lead
 * has no handle yet — so the button can open the real profile, not a search).
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const IG_JUNK = new Set([
  "p", "reel", "reels", "explore", "accounts", "stories", "direct", "about",
  "developer", "legal", "share", "tv", "web",
  // booking/aggregator accounts businesses link to — NOT their own IG
  "booksybiz", "booksy", "vagaropro", "vagaro", "squareup", "square",
  "fresha", "thecut", "getsquire", "squireapp", "schedulicity", "yelp",
  "facebook", "linktr", "linktree", "google", "goo", "instagram", "wix",
]);

function candidatesFromHtml(html: string): string[] {
  // Search engines wrap result links in redirects (DuckDuckGo's `uddg=`,
  // others url-encode the target), so the raw HTML rarely contains a plain
  // instagram.com link. Decode every redirect target, then scan the lot.
  let text = html;
  for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
    try { text += " " + decodeURIComponent(m[1]); } catch {}
  }
  const out: string[] = [];
  for (const m of text.matchAll(/instagram\.com\/([A-Za-z0-9_.]{3,30})/g)) {
    const h = m[1].replace(/\.$/, "");
    if (!IG_JUNK.has(h.toLowerCase()) && !out.includes(h)) out.push(h);
  }
  return out;
}

async function fetchText(url: string, timeoutMs = 11000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search for "<name> <area> instagram" and return the top business IG handle.
 * The search engine already ranks the business's own profile first, so we trust
 * that rather than re-fetching instagram.com to "verify" — Instagram serves bots
 * a login wall, so verification produces false negatives and just adds latency.
 * DuckDuckGo first: its result links decode cleanly from the `uddg=` redirects.
 */
export async function findIgHandle(name: string, area: string | null): Promise<string | null> {
  const q = `${name} ${area ?? ""} instagram`;
  const engines = [
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  ];
  // tally candidates across engines; the most-repeated one is the business.
  const tally = new Map<string, number>();
  for (const url of engines) {
    let html = "";
    try { html = await fetchText(url); } catch { continue; }
    const cands = candidatesFromHtml(html);
    if (cands.length) {
      // first candidate from a given engine is its top-ranked result
      cands.slice(0, 3).forEach((c, i) => tally.set(c, (tally.get(c) ?? 0) + (3 - i)));
      // one good engine is enough — return its top result immediately
      return cands[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!tally.size) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
