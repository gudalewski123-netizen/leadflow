/**
 * Score each lead's website (or flag missing ones) and discover Instagram handles.
 * Usage: npm run enrich
 */
import { pool, init, Lead } from "./db.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const IG_JUNK = new Set([
  "p", "reel", "reels", "explore", "accounts", "stories", "direct", "about",
  "developer", "legal", "share", "tv",
  // booking/aggregator accounts that barbershops link to — NOT their own IG
  "booksybiz", "booksy", "vagaropro", "vagaro", "squareup", "square",
  "fresha", "thecut", "getsquire", "squireapp", "schedulicity", "yelp",
  "facebook", "linktr", "linktree", "google", "goo",
]);

function igFromHtml(html: string): string | null {
  for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/g)) {
    const h = m[1].replace(/\.$/, "");
    if (!IG_JUNK.has(h.toLowerCase())) return h;
  }
  return null;
}

async function fetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; html: string; finalUrl: string; status: number }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    const html = await res.text();
    return { ok: res.ok, html, finalUrl: res.url, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

function scoreSite(html: string, finalUrl: string): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 100;
  const lower = html.toLowerCase();

  if (!finalUrl.startsWith("https://")) { score -= 25; notes.push("no SSL"); }
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) { score -= 30; notes.push("not mobile-friendly"); }
  if (!/<h1[\s>]/i.test(html)) { score -= 10; notes.push("no h1"); }
  if (!/<meta[^>]+name=["']description["']/i.test(html)) { score -= 10; notes.push("no meta description"); }

  const yearMatches = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)]
    .map((m) => parseInt(m[1]))
    .filter((y) => y > 1995 && y <= 2026);
  const newest = yearMatches.length ? Math.max(...yearMatches) : null;
  if (newest && newest < 2023) { score -= 20; notes.push(`copyright stuck at ${newest}`); }

  for (const [marker, label] of [
    ["wix.com", "Wix builder"],
    ["weebly", "Weebly builder"],
    ["godaddysites", "GoDaddy builder"],
    ["squarespace", "Squarespace"],
    ["wp-content", "WordPress"],
  ] as const) {
    if (lower.includes(marker)) { notes.push(label); break; }
  }

  if (html.length < 5000) { score -= 15; notes.push("very thin page"); }
  return { score: Math.max(0, score), notes };
}

// Validate a candidate handle actually resolves to a public IG profile,
// so we don't save a wrong/dead guess (e.g. a search-result artifact).
async function igProfileExists(handle: string): Promise<boolean> {
  try {
    const { ok, html } = await fetchText(`https://www.instagram.com/${handle}/`, 9000);
    if (!ok) return false;
    return /"@type":"ProfilePage"|profilePage_|al:ios:url|content="instagram:\/\//i.test(html)
      || html.includes(`@${handle}`);
  } catch {
    return false;
  }
}

// Try several search engines; the business name + location + "instagram".
// DuckDuckGo rate-limits fast, so Bing is the workhorse fallback.
async function findIgViaSearch(name: string, area: string): Promise<string | null> {
  const q = `${name} ${area} instagram`;
  const engines = [
    `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
  ];
  const seen = new Set<string>();
  for (const url of engines) {
    try {
      const { html } = await fetchText(url, 12000);
      // gather a few candidates, not just the first, then verify
      for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/g)) {
        const h = m[1].replace(/\.$/, "");
        if (seen.has(h.toLowerCase())) continue;
        seen.add(h.toLowerCase());
        const candidate = igFromHtml(`instagram.com/${h}`);
        if (candidate && (await igProfileExists(candidate))) return candidate;
      }
    } catch {
      /* try next engine */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

await init();
const leads = (
  await pool.query(
    "SELECT * FROM leads WHERE site_score IS NULL OR (ig_handle IS NULL AND status = 'new')"
  )
).rows as Lead[];

console.log(`Enriching ${leads.length} leads...`);

for (const lead of leads) {
  let site_score = lead.site_score ?? 0;
  let category = lead.category ?? "no_site";
  let site_notes = lead.site_notes ?? "";
  let ig_handle: string | null = lead.ig_handle;

  if (lead.website && lead.site_score === null) {
    try {
      const { ok, html, finalUrl, status } = await fetchText(lead.website);
      if (!ok) {
        site_score = 5;
        category = "bad_site";
        site_notes = `site returns HTTP ${status}`;
      } else {
        const { score, notes } = scoreSite(html, finalUrl);
        site_score = score;
        category = score < 55 ? "bad_site" : "ok_site";
        site_notes = notes.join(", ") || "looks decent";
        if (!ig_handle) ig_handle = igFromHtml(html);
      }
    } catch (e) {
      site_score = 0;
      category = "bad_site";
      site_notes = `site unreachable (${(e as Error).name})`;
    }
  } else if (!lead.website) {
    site_score = 0;
    category = "no_site";
    site_notes = "no website at all";
  }

  // The search-engine IG lookup is slow (~4s/lead) and low-yield, so it's gated
  // behind FIND_IG=1. The fast default just categorizes (instant for no-site
  // leads); IG handles come from the website HTML above or the Find-on-IG button.
  if (process.env.FIND_IG === "1" && !ig_handle && lead.area) {
    ig_handle = await findIgViaSearch(lead.name, lead.area);
    await new Promise((r) => setTimeout(r, 1200));
  }

  await pool.query(
    "UPDATE leads SET site_score=$1, site_notes=$2, category=$3, ig_handle=COALESCE($4, ig_handle) WHERE id=$5",
    [site_score, site_notes, category, ig_handle, lead.id]
  );
  console.log(
    `  ${lead.name}: ${category} (${site_score})${ig_handle ? ` @${ig_handle}` : " [no IG found]"}`
  );
}

const counts = (
  await pool.query("SELECT category, COUNT(*)::int c FROM leads GROUP BY category")
).rows as { category: string; c: number }[];
console.log("\nBreakdown:", counts.map((r) => `${r.category}: ${r.c}`).join("  "));
console.log("Next: npm run draft");
await pool.end();
