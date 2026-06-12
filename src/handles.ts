/**
 * Resolve real Instagram handles for leads that don't have one, by querying
 * Instagram's own search with the user's logged-in session (cookies extracted
 * to .ig_cookies.json by tools/dump-ig-cookies.py).
 *
 * Usage:
 *   npm run handles -- --test 12     # dry run, print matches, don't save
 *   npm run handles                  # resolve all no-handle leads, save, throttled
 *
 * Runs slowly on purpose — automated queries on a real IG account carry some
 * risk, so we space requests out to stay well under any rate alarm.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";
import { STATE_CITIES } from "./cities.js";

// normalized set of US city + state names, to catch a franchise handle that
// names a DIFFERENT location than the lead (e.g. @mollymaid.huntington for a
// Birmingham lead).
const STATE_NAMES = ["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","newhampshire","newjersey","newmexico","newyork","northcarolina","northdakota","ohio","oklahoma","oregon","pennsylvania","rhodeisland","southcarolina","southdakota","tennessee","texas","utah","vermont","virginia","washington","westvirginia","wisconsin","wyoming"];
const PLACES = new Set<string>(STATE_NAMES);
for (const cities of Object.values(STATE_CITIES)) for (const c of cities) PLACES.add(c.toLowerCase().replace(/[^a-z]/g, ""));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cookiePath = path.join(root, ".ig_cookies.json");
if (!fs.existsSync(cookiePath)) {
  console.error("No .ig_cookies.json — run: python3 tools/dump-ig-cookies.py");
  process.exit(1);
}
const ck = JSON.parse(fs.readFileSync(cookiePath, "utf8")) as {
  sessionid: string; csrftoken: string; ds_user_id: string;
};

const testArg = process.argv.indexOf("--test");
const TEST = testArg !== -1;
const limArg = process.argv.indexOf("--limit");
const LIMIT = TEST
  ? Number(process.argv[testArg + 1] ?? 12)
  : limArg !== -1 ? Number(process.argv[limArg + 1] ?? 150) : Infinity;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Generic words shared by many businesses — matching on these alone pairs you
// with the wrong company, so we drop them and match only on distinctive brand words.
const STOP = new Set([
  "the","and","llc","inc","co","company","corp","of","by","at","a","an","for","your",
  "shop","studio","salon","spa","barbershop","barber","tattoo","tattoos","tattooers","tattooer",
  "ink","parlor","nails","nail","hair","beauty","lash","lashes","skin","brows","makeup",
  "auto","automotive","repair","service","services","car","mobile","detailing","detail",
  "cleaning","clean","construction","contractor","contractors","electric","electrical",
  "plumbing","plumber","hvac","heating","cooling","air","roofing","roofer","lawn","care",
  "landscaping","landscape","pressure","washing","painting","painter","painters","design",
  "art","center","custom","framing","piercing","vape","smoke","gym","fitness","training",
  "massage","therapy","therapist","catering","bakery","coffee","boutique","florist","grooming",
  "pet","towing","junk","removal","locksmith","daycare","school","medical","clinic","md","dds",
  "pest","control","termite","exterminating","exterminators","exterminator","home","office",
  "house","services","group","professional","professionals","quality","best","local","us","usa",
]);
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

// strip city/state and corporate suffixes so IG search matches the brand
function cleanName(name: string, area: string | null): string {
  let n = name.replace(/\b(LLC|L\.L\.C\.?|Inc\.?|Co\.?|Corp\.?)\b/gi, "");
  if (area) {
    const city = area.replace(/\s+[A-Z]{2}$/, "").trim();
    n = n.replace(new RegExp(`\\b${city}\\b`, "gi"), "");
    n = n.replace(/\b[A-Z]{2}\b$/, "");
  }
  return n.replace(/\s+/g, " ").trim();
}

interface IgUser { username: string; full_name: string; is_verified?: boolean }

async function igSearch(query: string): Promise<IgUser[]> {
  const url =
    "https://www.instagram.com/web/search/topsearch/?" +
    new URLSearchParams({ context: "blended", query });
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "x-ig-app-id": "936619743392459",
      "x-csrftoken": ck.csrftoken,
      "x-requested-with": "XMLHttpRequest",
      Referer: "https://www.instagram.com/",
      Cookie: `sessionid=${ck.sessionid}; csrftoken=${ck.csrftoken}; ds_user_id=${ck.ds_user_id}`,
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error(`auth ${res.status} — cookies expired`);
  if (!res.ok) return [];
  const data = (await res.json()) as { users?: { user: IgUser }[] };
  return (data.users ?? []).map((u) => u.user);
}

// Decide if a returned account confidently belongs to the business. Strict on
// purpose — a wrong handle (you'd DM a stranger) is worse than leaving it empty.
// Instagram ranks results by relevance, so we take the FIRST account that clears
// a confidence bar, not a fuzzy best-of.
function bestMatch(name: string, area: string | null, users: IgUser[]): string | null {
  const bizTok = tokens(name);
  const bizJoined = norm(name);
  if (!bizTok.length) return null;
  const leadCity = area ? area.replace(/\s+[A-Z]{2}$/, "").toLowerCase().replace(/[^a-z]/g, "") : "";

  for (const u of users) {
    const uNorm = norm(u.username);
    const fnJoined = norm(u.full_name || "");

    // location guard: if the handle/name embeds a different city or state than
    // the lead's, it's another franchise location — skip it.
    const foreignPlace = [...PLACES].some(
      (p) => p !== leadCity && p.length >= 5 && (uNorm.includes(p) || fnJoined.includes(p))
    );
    if (foreignPlace && !(leadCity && (uNorm.includes(leadCity) || fnJoined.includes(leadCity)))) continue;
    // count distinctive brand words found in the USERNAME — the handle reflecting
    // the brand is the strong signal; a display name alone matches random people
    // who happen to share a name (e.g. a different "Daniel Roussos").
    const uShared = bizTok.filter((t) => uNorm.includes(t));

    // exact: the handle or display name IS the business
    if (uNorm === bizJoined || fnJoined === bizJoined) return u.username;
    // multi-word brand: its handle carries 2+ of the distinctive words, or the
    // whole brand embedded in the handle
    if (bizTok.length >= 2 && (uShared.length >= 2 || uNorm.includes(bizJoined))) {
      return u.username;
    }
    // single distinctive word: accept an exact handle, or a handle that starts
    // with the brand when the brand is a long coined word (≥7 chars, e.g.
    // "splattzone" → @splattzonetattoo) — but never a short common word as a
    // substring of a different name ("stash" ✗ @stashhousect).
    if (bizTok.length === 1) {
      const b = bizTok[0];
      if (uNorm === b) return u.username;
      if (b.length >= 7 && uNorm.startsWith(b)) return u.username;
    }
  }
  return null;
}

await init();
const leads = (
  await pool.query(
    `SELECT id, name, area FROM leads
     WHERE ig_handle IS NULL AND status = 'new'
     ORDER BY (category = 'no_site') DESC, reviews DESC NULLS LAST
     LIMIT ${Number.isFinite(LIMIT) ? LIMIT : 100000}`
  )
).rows as { id: number; name: string; area: string | null }[];

console.log(`${TEST ? "[TEST] " : ""}Resolving handles for ${leads.length} leads...\n`);
let hits = 0;
for (const l of leads) {
  const q = cleanName(l.name, l.area);
  let handle: string | null = null;
  try {
    const users = await igSearch(q);
    handle = bestMatch(l.name, l.area, users);
  } catch (e) {
    console.error((e as Error).message);
    if ((e as Error).message.includes("auth")) break;
  }
  if (handle) {
    hits++;
    if (!TEST) await pool.query("UPDATE leads SET ig_handle=$1 WHERE id=$2", [handle, l.id]);
    console.log(`  ✓ ${l.name}  →  @${handle}`);
  } else {
    console.log(`  ·  ${l.name}  →  (no confident match)`);
  }
  // throttle: ~1 query / 4-7s to stay gentle on the account
  await new Promise((r) => setTimeout(r, 4000 + Math.floor(Math.random() * 3000)));
}
console.log(`\n${TEST ? "[TEST] " : ""}Matched ${hits}/${leads.length}.`);
await pool.end();
