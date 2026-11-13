/**
 * Scout — FREE Instagram trades leads (2026-11-12, Gregg: "lets do that for free").
 *
 * Instagram closed the cookie shortcuts the June pipeline used (/api/v1/web/search/topsearch and
 * /users/web_profile_info both 404 even logged in, tested 11-12). What still works is what a person does:
 * open a hashtag page, open each poster's profile. The scout does exactly that in its OWN Chrome profile
 * (~/leadflow/.scout-profile) logged into a SPARE Instagram account — never the DM bot's account — at human
 * pace, and reads the data the pages themselves load. $0 per lead.
 *
 *   npx tsx src/scout.ts --login              open the scout's Chrome; log in to the spare account; close it
 *   npx tsx src/scout.ts [--profiles 150] [--tags 12] [--headless]
 *   touch ~/leadflow/STOP-SCOUT               kill switch (the scout also writes it itself on any block)
 *
 * Every profile it reads is saved (source 'ig_scout'), so nothing is read twice; the No-website list then
 * picks out the ones with no website that posted in the last 60 days, like every other source.
 */
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";
import { MONEY_PLACES } from "./metros.js";
import { scoreOf, isFranchise, type Profile } from "./score.js";
import { isRelevant, MAX_FOLLOWERS } from "./relevance.js";
import { junkReason } from "./quality.js";
import { findChains, brandKey } from "./chains.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_DIR = join(ROOT, ".scout-profile");
const STOP = join(ROOT, "STOP-SCOUT");
const argv = process.argv.slice(2);
const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const LOGIN = argv.includes("--login");
const HEADLESS = argv.includes("--headless");
const MAX_PROFILES = Number(val("--profiles") ?? 150);
const MAX_TAGS = Number(val("--tags") ?? 12);
const ONLY_TAG = val("--tag");

mkdirSync(join(ROOT, "logs"), { recursive: true });
const LOGFILE = join(ROOT, "logs", `scout-${new Date().toISOString().slice(0, 10)}.log`);
const log = (...a: unknown[]) => { const line = `${new Date().toISOString()} ${a.join(" ")}`; console.log(line); appendFileSync(LOGFILE, line + "\n"); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function notify(title: string, body: string) {
  try { execFileSync("osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Basso"`]); } catch {}
  try {
    const topic = readFileSync(join(homedir(), ".forensic-keys"), "utf8").match(/^\s*(?:export\s+)?NTFY_TOPIC=["']?([^"'\s]+)/m)?.[1];
    if (topic) execFileSync("curl", ["-s", "-m", "10", "-H", `Title: ${title}`, "-d", body, `https://ntfy.sh/${topic}`]);
  } catch {}
}
let ctx: BrowserContext | null = null;
async function halt(reason: string): Promise<never> {
  writeFileSync(STOP, `${new Date().toISOString()}\n${reason}\nDelete this file to let the scout run again.\n`);
  log("HALT:", reason); notify("LeadFlow scout stopped", reason);
  await ctx?.close().catch(() => {}); await pool.end().catch(() => {}); process.exit(3);
}
const BLOCK_TEXT = /try again later|action blocked|we restrict certain activity|temporarily (?:blocked|locked|restricted)|your account has been (?:disabled|suspended|restricted)|we suspect automated behavior|unusual activity|confirm it'?s you|help us confirm|suspicious (?:login|activity)|we limit how often/i;
async function checkBlocked(page: Page) {
  const url = page.url();
  if (/\/challenge|\/suspended|\/accounts\/(?:login|suspended|disabled)/.test(url)) await halt(`Instagram sent the scout to ${url} — logged out or challenged. Run: npx tsx src/scout.ts --login`);
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const m = text.match(BLOCK_TEXT);
  if (m) await halt(`Instagram showed "${m[0]}" to the scout account — paused. Leave it 24-48h.`);
}

/* tag words per trade — what local operators type after the city/state name */
const TAG_WORDS: Record<string, string[]> = {
  "plumbing": ["plumber", "plumbing"], "handyman": ["handyman"], "pressure washing": ["pressurewashing", "powerwashing"],
  "pool service": ["poolservice", "poolcleaning"], "landscaping": ["landscaping"], "lawn care": ["lawncare"], "roofing": ["roofer", "roofing"],
  "painting": ["painter"], "electrician": ["electrician"], "hvac": ["hvac"], "tree service": ["treeservice"], "window cleaning": ["windowcleaning"],
  "gutter cleaning": ["guttercleaning"], "junk removal": ["junkremoval"], "fencing": ["fencecompany"], "concrete contractor": ["concrete"],
  "epoxy flooring": ["epoxyfloors"], "sealcoating": ["sealcoating"], "moving company": ["movers"], "hardscaping": ["pavers"],
};
const STATES: [string, string][] = [["texas", "TX"], ["florida", "FL"], ["california", "CA"], ["arizona", "AZ"], ["georgia", "GA"], ["northcarolina", "NC"], ["tennessee", "TN"], ["colorado", "CO"], ["illinois", "IL"], ["ohio", "OH"], ["virginia", "VA"], ["newjersey", "NJ"], ["nevada", "NV"], ["utah", "UT"], ["washington", "WA"], ["michigan", "MI"]];
const slug = (s: string) => s.toLowerCase().replace(/^st\.?\s/, "saint ").replace(/[^a-z]/g, "");
const SKIP = /\b(depot|lowe'?s|home\s?advisor|angi|thumbtack|yelp|nextdoor|realty|realtor|magazine|news|seo|marketing|agency|leads|hardware|supply|winsupply|alliance|foundation|nonprofit)\b|clientflow|leadgen/i;

/* ---- reading what Instagram's own pages load ---- */
type U = { username: string; full_name?: string; biography?: string; external_url?: string | null; bio_links?: { url?: string }[]; follower_count?: number; edge_followed_by?: { count: number }; media_count?: number; edge_owner_to_timeline_media?: { count: number }; is_business_account?: boolean; is_business?: boolean; is_private?: boolean; is_verified?: boolean; public_phone_number?: string; business_phone_number?: string; public_email?: string; business_email?: string };
function walk(x: any, fn: (o: any) => void, depth = 0) {
  if (!x || typeof x !== "object" || depth > 40) return;
  fn(x);
  for (const k in x) walk(x[k], fn, depth + 1);
}
function collector(page: Page) {
  const bodies: any[] = [];
  const on = async (r: Response) => {
    const u = r.url();
    if (!/instagram\.com\/(graphql|api\/)/.test(u)) return;
    if (!/json|javascript|text/.test(r.headers()["content-type"] ?? "")) return;
    try { const t = await r.text(); for (const chunk of t.split("\n")) { const c = chunk.trim(); if (c.startsWith("{")) { try { bodies.push(JSON.parse(c)); } catch {} } } } catch {}
  };
  page.on("response", on);
  return { bodies, stop: () => page.off("response", on) };
}
async function inlineJson(page: Page): Promise<any[]> {
  const raw: string[] = await page.$$eval('script[type="application/json"]', (els) => els.map((e) => e.textContent ?? "")).catch(() => []);
  const out: any[] = [];
  for (const r of raw) { try { out.push(JSON.parse(r)); } catch {} }
  return out;
}

async function readTag(page: Page, tag: string): Promise<Map<string, { name: string; caption: string }>> {
  const c = collector(page);
  await page.goto(`https://www.instagram.com/explore/tags/${tag}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(rand(4000, 6500)); await checkBlocked(page);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, rand(900, 1500)); await sleep(rand(1800, 3200)); }
  c.stop();
  const found = new Map<string, { name: string; caption: string }>();
  const take = (o: any) => {
    const owner = o?.user ?? o?.owner;
    if (owner?.username && (o.taken_at || o.taken_at_timestamp || o.code || o.shortcode)) {
      const cap = o.caption?.text ?? o.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
      if (!found.has(owner.username)) found.set(String(owner.username).toLowerCase(), { name: owner.full_name ?? owner.username, caption: String(cap).slice(0, 600) });
    }
  };
  for (const b of [...c.bodies, ...(await inlineJson(page))]) walk(b, take);
  return found;
}

type Read = { user: U | null; lastPost: number | null; link: string | null };
async function readProfile(page: Page, handle: string): Promise<Read> {
  const c = collector(page);
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(rand(3500, 6000)); await checkBlocked(page);
  c.stop();
  let user: U | null = null; let last = 0;
  const all = [...c.bodies, ...(await inlineJson(page))];
  for (const b of all) walk(b, (o) => {
    if (o?.username && String(o.username).toLowerCase() === handle && ("follower_count" in o || "edge_followed_by" in o || "biography" in o)) user = { ...(user ?? {}), ...o };
    const owner = o?.user ?? o?.owner;
    const ts = Number(o?.taken_at ?? o?.taken_at_timestamp ?? 0);
    if (ts > 1e9 && owner?.username && String(owner.username).toLowerCase() === handle && !o?.is_pinned && !(o?.timeline_pinned_user_ids?.length)) last = Math.max(last, ts);
  });
  // fallback: the visible header (follower count + link) when no data object was caught
  if (!user) {
    const head = await page.locator("header").innerText({ timeout: 3000 }).catch(() => "");
    if (head) user = { username: handle, biography: head } as U;
  }
  const u = user as U | null;
  const link = u?.external_url || u?.bio_links?.find((b) => b?.url)?.url || null;
  return { user: u, lastPost: last || null, link };
}

/* ---- run ---- */
async function launch(): Promise<BrowserContext> {
  const opts = { headless: HEADLESS, viewport: { width: 1280, height: 900 }, args: ["--disable-blink-features=AutomationControlled"] };
  return chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: "chrome", ignoreDefaultArgs: ["--no-sandbox"] })
    .catch(() => chromium.launchPersistentContext(PROFILE_DIR, opts));
}

async function main() {
  if (LOGIN) {
    ctx = await launch();
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    await p.goto("https://www.instagram.com/accounts/login/");
    console.log("\nLog in to the SPARE Instagram account in the window that opened (not the DM bot's account).\nTick 'Save login info' if asked, then close the window.\n");
    await new Promise<void>((r) => ctx!.on("close", () => r()));
    return;
  }
  if (existsSync(STOP)) { console.log(`Kill switch is on (${STOP}):\n${readFileSync(STOP, "utf8")}`); process.exit(2); }

  await init();
  const known = new Set<string>((await pool.query("SELECT DISTINCT lower(ig_handle) h FROM leads WHERE ig_handle IS NOT NULL")).rows.map((r) => r.h));
  const done = new Set<string>((await pool.query(`SELECT query FROM hunt_queries WHERE (query LIKE 'tag:%' OR query LIKE 'scout:%') AND ran_at > now() - interval '30 days'`)).rows.map((r) => String(r.query).replace(/^(tag|scout):/, "")));
  const CHAINS = findChains((await pool.query("SELECT name, state, area FROM leads WHERE name IS NOT NULL")).rows);

  // tag queue: statewide tags first (biggest pools, never used), then money-metro city tags, trades interleaved
  type Tag = { tag: string; niche: string; city: string; state: string };
  const perTrade = Object.entries(TAG_WORDS).map(([niche, words]) => {
    const l: Tag[] = [];
    for (const [st, ab] of STATES) for (const w of words) l.push({ tag: st + w, niche, city: "", state: ab });
    for (const p of MONEY_PLACES) for (const w of words) l.push({ tag: slug(p.city) + w, niche, city: p.city, state: p.state });
    return l.filter((t) => !done.has(t.tag));
  });
  let tags: Tag[] = [];
  for (let i = 0; perTrade.some((l) => i < l.length); i++) for (const l of perTrade) if (l[i]) tags.push(l[i]);
  if (ONLY_TAG) tags = [{ tag: ONLY_TAG, niche: Object.keys(TAG_WORDS).find((n) => TAG_WORDS[n].some((w) => ONLY_TAG.endsWith(w))) ?? "handyman", city: "", state: "" }];
  tags = tags.slice(0, MAX_TAGS);

  ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await sleep(3000); await checkBlocked(page);
  if (!(await ctx.cookies("https://www.instagram.com")).some((c) => c.name === "sessionid" && c.value)) await halt("The scout isn't logged in. Run: npx tsx src/scout.ts --login");
  log(`scout: ${tags.length} hashtags queued, up to ${MAX_PROFILES} profiles`);

  let read = 0, saved = 0, keepers = 0;
  for (const t of tags) {
    if (read >= MAX_PROFILES || existsSync(STOP)) break;
    const posters = await readTag(page, t.tag);
    await pool.query(`INSERT INTO hunt_queries (query, new_leads) VALUES ($1, 0) ON CONFLICT (query) DO UPDATE SET ran_at = now()`, [`scout:${t.tag}`]);
    const fresh = [...posters].filter(([h, p]) => !known.has(h) && !SKIP.test(h) && !SKIP.test(p.name) && !isFranchise(p.name, h) && !CHAINS.has(brandKey(p.name)) && isRelevant(t.niche, p.name, h, p.caption) && !/link in (?:my )?bio|\bwww\.|\.com\b/i.test(p.caption));
    log(`#${t.tag}: ${posters.size} posters, ${fresh.length} new to check`);
    for (const [h, p] of fresh) {
      if (read >= MAX_PROFILES || existsSync(STOP)) break;
      known.add(h); read++;
      const r = await readProfile(page, h);
      const u = r.user;
      if (!u) { log(`  @${h}: nothing readable`); continue; }
      const followers = u.follower_count ?? u.edge_followed_by?.count ?? null;
      const name = String(u.full_name || p.name || h);
      const bio = String(u.biography ?? "");
      if ((followers ?? 0) > MAX_FOLLOWERS || u.is_private) continue;
      if (junkReason({ name, ig_handle: h, niche: t.niche, ig_followers: followers, ig_link: r.link, bio, verified: Boolean(u.is_verified) }, true)) continue;
      const prof: Profile = { lastPost: r.lastPost, followers, posts: u.media_count ?? u.edge_owner_to_timeline_media?.count ?? null, externalUrl: r.link, email: u.public_email ?? u.business_email ?? null, phone: u.public_phone_number ?? u.business_phone_number ?? null, isBusiness: Boolean(u.is_business_account ?? u.is_business) };
      const { score, why } = scoreOf(prof);
      why.push(`found by scout via #${t.tag}`);
      const area = t.city ? `${t.city} ${t.state}` : t.state;
      const ins = await pool.query(
        `INSERT INTO leads (name, niche, area, state, ig_handle, status, source, last_active, ig_followers, ig_posts, ig_link, ig_business, hot_score, hot_why, ig_checked_at)
         VALUES ($1,$2,$3,$4,$5,'new','ig_scout', CASE WHEN $6 > 0 THEN to_timestamp($6) ELSE NULL END, $7,$8,$9,$10,$11,$12, now())
         ON CONFLICT DO NOTHING RETURNING id`,
        [name.slice(0, 120), t.niche, area, t.state || null, h, prof.lastPost ?? 0, followers, prof.posts, r.link, prof.isBusiness, score, why.join(", ")]);
      if (ins.rowCount) saved++;
      const active = r.lastPost && Date.now() / 1000 - r.lastPost < 60 * 86400;
      if (ins.rowCount && !r.link && active && (followers ?? 0) >= 30) { keepers++; log(`  ✅ @${h} ${followers}f · ${t.niche} · ${area}`); }
      else log(`  · @${h} ${followers ?? "?"}f link:${r.link ? "yes" : "no"} last:${r.lastPost ? Math.round((Date.now() / 1000 - r.lastPost) / 86400) + "d" : "?"}`);
      await sleep(rand(7000, 14000));                       // human pace between profiles
      if (read % 25 === 0) { log("  (break)"); await sleep(rand(60000, 120000)); }
    }
    await sleep(rand(15000, 30000));                        // pause between hashtags
  }
  log(`done: ${read} profiles read, ${saved} saved, ${keepers} no-website & posting. Cost $0.`);
  await ctx.close(); await pool.end();
}
main().catch(async (e) => { log("error:", e?.message ?? e); await ctx?.close().catch(() => {}); await pool.end().catch(() => {}); process.exit(1); });
