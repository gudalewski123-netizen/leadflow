/**
 * Google Maps lead hunter — businesses with NO WEBSITE that are still doing well.
 *
 * The Instagram hunter (apifyhunt.ts) finds businesses that post. This finds
 * businesses that customers already rate — a different and generally warmer
 * pool, because a 4.6-star shop with 60 reviews and no website is losing work
 * it has already earned.
 *
 * Three filters do the work:
 *   website: "withoutWebsite"   native, Google-side  — no site on the listing
 *   placeMinimumStars: "four"   native, Google-side  — 4.0+ only
 *   reviewsCount >= MIN_REVIEWS local                — not a native filter
 *
 * The two native ones matter for COST, not just tidiness: Apify bills per place
 * *scraped*, so a Google-side filter means we never pay for the 90% of listings
 * that have a website. skipClosedPlaces is deliberately NOT used — it is a third
 * billable filter (+$0.001/place, ~17% more) and the actor already returns
 * permanentlyClosed/temporarilyClosed, so we drop those locally for free.
 *
 * Usage:
 *   npm run maps -- --pilot                         # ~$0.10, one metro, proves it works
 *   npm run maps -- --cities "Tampa FL,Orlando FL" --niches "roofing,painting"
 *   npm run maps -- --states FL,GA --target 500 --max-spend 4
 *   npm run maps -- --csv                           # re-export what's already stored
 */
import fs from "node:fs";
import path from "node:path";
import { pool, init } from "./db.js";
import { STATE_CITIES, ALL_STATES } from "./cities.js";
import { isFranchise } from "./score.js";

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (n: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const has = (n: string) => argv.includes(`--${n}`);

const PILOT = has("pilot");
const CSV_ONLY = has("csv-only");
const MIN_REVIEWS = Number(flag("min-reviews", "4"));
const MIN_STARS = flag("min-stars", "four"); // 'four' | 'fourAndHalf'
const TARGET = Number(flag("target", PILOT ? "80" : "400"));
const MAX_SPEND = Number(flag("max-spend", PILOT ? "0.25" : "4"));
const PER_SEARCH = Number(flag("per-search", "60"));
const CONCURRENCY = Number(flag("concurrency", PILOT ? "2" : "4"));

const DEFAULT_NICHES =
  "roofing,painting,mobile detailing,pressure washing,junk removal,landscaping,handyman,concrete contractor,fencing,tree service,plumbing,electrician,hvac,auto repair,window cleaning,moving company,pool service,sealcoating,lawn care,towing";
const NICHES = (flag("niches", PILOT ? "roofing,painting,mobile detailing" : DEFAULT_NICHES)!)
  .split(",").map(s => s.trim()).filter(Boolean);

/** "Tampa FL" -> {city:"Tampa", state:"FL"} */
function parseCity(s: string) {
  const m = s.trim().match(/^(.*?)[,\s]+([A-Z]{2})$/i);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: s.trim(), state: "" };
}

let LOCATIONS: { city: string; state: string }[] = [];
if (flag("cities")) {
  LOCATIONS = flag("cities")!.split(",").map(parseCity);
} else if (flag("states")) {
  for (const st of flag("states")!.split(",").map(s => s.trim().toUpperCase()))
    for (const city of STATE_CITIES[st] ?? []) LOCATIONS.push({ city, state: st });
} else if (PILOT) {
  LOCATIONS = [{ city: "Tampa", state: "FL" }];
} else {
  for (const st of ALL_STATES)
    for (const city of (STATE_CITIES[st] ?? []).slice(0, 2)) LOCATIONS.push({ city, state: st });
}


/**
 * Niche -> { search term, allowed Google categories }.
 *
 * Both halves exist because of what the Tampa pilot returned. Searching the
 * bare word "painting" gave back picture-frame shops, an artist, a hobby store
 * and a wedding photographer — Google reads "painting" as fine art, not as a
 * trade. Fourteen of 32 "painters" were junk.
 *
 * `q` fixes the cause for free: a sharper search term means Google returns
 * fewer wrong places, and we are billed per place SCRAPED, so a better query is
 * literally cheaper than a filter.
 *
 * `cats` is the safety net, applied locally against the place's own
 * categoryName. Local is deliberate: Apify bills $0.001/place for each native
 * filter, and we have already paid for the scrape by the time we see the
 * category, so filtering here costs nothing and keeps the allowlist under our
 * control instead of Google's fuzzy matching.
 */
interface Niche { key: string; q: string; cats: RegExp }
const NICHE_DEFS: Record<string, { q: string; cats: RegExp }> = {
  "roofing":            { q: "roofing contractor",        cats: /roof/i },
  "painting":           { q: "house painting contractor", cats: /^(painter|painting|house painter|painting contractor)$/i },
  "mobile detailing":   { q: "mobile car detailing",      cats: /car detailing|car wash|auto detailing/i },
  "pressure washing":   { q: "pressure washing service",  cats: /pressure wash|power wash/i },
  "junk removal":       { q: "junk removal service",      cats: /junk|garbage|rubbish|dumpster|debris removal/i },
  "landscaping":        { q: "landscaping contractor",    cats: /landscap|lawn/i },
  "lawn care":          { q: "lawn care service",         cats: /lawn|landscap/i },
  "handyman":           { q: "handyman service",          cats: /handy/i },
  "concrete contractor":{ q: "concrete contractor",       cats: /concrete|masonry/i },
  "fencing":            { q: "fence contractor",          cats: /fence|fencing/i },
  "tree service":       { q: "tree service",              cats: /tree|arborist|stump/i },
  "plumbing":           { q: "plumber",                   cats: /plumb/i },
  "electrician":        { q: "electrician",               cats: /electric/i },
  "hvac":               { q: "hvac contractor",           cats: /hvac|air conditioning|heating|furnace/i },
  "auto repair":        { q: "auto repair shop",          cats: /auto repair|mechanic|car repair/i },
  "window cleaning":    { q: "window cleaning service",   cats: /window clean/i },
  "moving company":     { q: "moving company",            cats: /mover|moving/i },
  "pool service":       { q: "swimming pool service",     cats: /pool/i },
  "sealcoating":        { q: "asphalt sealcoating",       cats: /paving|asphalt|seal|driveway/i },
  "towing":             { q: "towing service",            cats: /tow/i },
};
/** Unknown niche: search it verbatim and accept any category (with a warning). */
function defOf(key: string): Niche {
  const d = NICHE_DEFS[key.toLowerCase()];
  if (d) return { key, q: d.q, cats: d.cats };
  console.warn(`  ! no category allowlist for "${key}" — results will not be category-filtered`);
  return { key, q: key, cats: /.*/ };
}
const NICHE_DEFS_LIST = Object.keys(NICHE_DEFS);

// ---------- apify ----------
function apifyToken(): string {
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN;
  try {
    const m = fs.readFileSync(path.join(process.env.HOME ?? "", ".tier1-config/.env"), "utf8")
      .match(/^APIFY_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  console.error("No APIFY_TOKEN in env or ~/.tier1-config/.env");
  process.exit(1);
}
const TOKEN = apifyToken();
const ACTOR = "compass~crawler-google-places";

/**
 * Start async + poll rather than run-sync-get-dataset-items. Same lesson as
 * apifyhunt.ts: the sync endpoint holds the connection open for the whole run,
 * and when runs queue behind each other the fetch dies — while Apify still
 * bills for a run whose results we never read.
 *
 * null = the run failed (so the caller must NOT record the query as swept).
 */
async function search(term: string, city: string, state: string): Promise<any[] | null> {
  const input = {
    searchStringsArray: [term],
    locationQuery: `${city}, ${state}, United States`,
    maxCrawledPlacesPerSearch: PER_SEARCH,
    language: "en",
    countryCode: "us",
    website: "withoutWebsite",     // billable filter #1 — the whole point
    placeMinimumStars: MIN_STARS,  // billable filter #2
    skipClosedPlaces: false,       // deliberately off: filtered locally for free
    maxReviews: 0, maxImages: 0, maxQuestions: 0,
    scrapeReviewsPersonalData: false,
  };
  try {
    const start = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${TOKEN}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!start.ok) { console.error(`  start HTTP ${start.status} on "${term} ${city}"`); return null; }
    const d = ((await start.json()) as any)?.data;
    if (!d?.id || !d?.defaultDatasetId) return null;

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const st = await fetch(`https://api.apify.com/v2/actor-runs/${d.id}?token=${TOKEN}`);
      if (!st.ok) continue;
      const status = ((await st.json()) as any)?.data?.status;
      if (status === "SUCCEEDED") {
        const ds = await fetch(`https://api.apify.com/v2/datasets/${d.defaultDatasetId}/items?token=${TOKEN}&clean=true`);
        return ds.ok ? ((await ds.json()) as any[]) : null;
      }
      if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
        console.error(`  run ${status} on "${term} ${city}"`); return null;
      }
    }
    console.error(`  run never finished on "${term} ${city}"`);
    return null;
  } catch (e: any) {
    console.error(`  error on "${term} ${city}": ${e?.message}`);
    return null;
  }
}

// ---------- setup ----------
await init();
await pool.query(`
  ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS place_id TEXT,
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS hot_score INT,
    ADD COLUMN IF NOT EXISTS hot_why TEXT
`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_place_id_uniq ON leads (place_id) WHERE place_id IS NOT NULL`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS gmaps_queries (
    query TEXT PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    new_leads INT NOT NULL DEFAULT 0
  )`);

/** Rank: reviews carry the most signal (proof of demand), stars break ties. */
function scoreOf(rating: number, reviews: number) {
  const why: string[] = ["no website"];
  let s = 40;
  if (reviews >= 100) { s += 30; why.push(`${reviews} reviews`); }
  else if (reviews >= 40) { s += 22; why.push(`${reviews} reviews`); }
  else if (reviews >= 15) { s += 14; why.push(`${reviews} reviews`); }
  else { s += 6; why.push(`${reviews} reviews`); }
  if (rating >= 4.8) { s += 20; why.push(`${rating}★`); }
  else if (rating >= 4.5) { s += 14; why.push(`${rating}★`); }
  else { s += 6; why.push(`${rating}★`); }
  return { score: Math.min(s, 99), why };
}

async function exportCsv() {
  const r = await pool.query(
    `SELECT name, niche, area, state, rating, reviews, phone, address, maps_url, hot_score, hot_why
       FROM leads WHERE source='gmaps'
      ORDER BY hot_score DESC NULLS LAST, reviews DESC NULLS LAST`);
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = "name,niche,area,state,rating,reviews,phone,address,maps_url,score,why";
  const out = [head, ...r.rows.map((x: any) => Object.values(x).map(esc).join(","))].join("\n");
  const f = path.join(process.env.HOME ?? ".", `gmaps-no-website-leads.csv`);
  fs.writeFileSync(f, out);
  console.log(`\nCSV: ${f}  (${r.rowCount} rows)`);
  return { file: f, n: r.rowCount ?? 0 };
}

if (CSV_ONLY) { await exportCsv(); await pool.end(); process.exit(0); }

// ---------- spend guard ----------
let spend = 0, stoppedForBudget = false;

/**
 * Apify's usage figure LAGS behind a finished run, and each query can scrape up
 * to PER_SEARCH places (~$0.006 each). The pilot proved the danger: a $0.25
 * ceiling checked only every 5 queries let three concurrent runs through and
 * spent $0.769 — 3x over. So the guard is now predictive: we bill ourselves
 * $0.006 per place the moment we see it, and stop on whichever number is
 * higher, ours or Apify's. A query is also refused unless the WORST CASE
 * (a full PER_SEARCH scrape) still fits under the ceiling.
 */
const COST_PER_PLACE = 0.006; // $0.004 scrape + 2 native filters @ $0.001
let estSpend = 0;             // our own running estimate since the run started

function budgetLeft(): number { return MAX_SPEND - Math.max(spend, startSpendEst + estSpend); }
function trip(why: string) {
  if (stoppedForBudget) return;
  stoppedForBudget = true;
  console.log(`\n!! Spend ceiling: ${why}. Stopping.`);
}
async function checkSpend() {
  try {
    const r = await fetch(`https://api.apify.com/v2/users/me/limits?token=${TOKEN}`);
    spend = ((await r.json()) as any)?.data?.current?.monthlyUsageUsd ?? spend;
  } catch {}
  if (Math.max(spend, startSpendEst + estSpend) >= MAX_SPEND)
    trip(`$${Math.max(spend, startSpendEst + estSpend).toFixed(3)} >= $${MAX_SPEND}`);
}
await checkSpend();
const startSpend = spend;
var startSpendEst = spend;

const seen = new Set<string>(
  (await pool.query("SELECT place_id FROM leads WHERE place_id IS NOT NULL")).rows.map((r: any) => r.place_id));
const done = new Set<string>(
  (await pool.query(`SELECT query FROM gmaps_queries WHERE ran_at > now() - interval '30 days'`))
    .rows.map((r: any) => r.query));

// niche-major so every trade sweeps every city before the next trade starts
const NICHE_OBJS = NICHES.map(defOf);

/**
 * City-major round robin: EVERY trade is swept in city 1 before any trade is
 * swept in city 2. Trade-major ordering (the obvious loop) is wrong whenever
 * the budget runs out mid-sweep -- it would spend the entire ceiling on the
 * first three trades and never look at the other eight. This way, whenever the
 * money stops, we have complete trade coverage across however many cities we
 * reached, which is the useful shape of a partial result.
 */
const jobs: { n: Niche; city: string; state: string }[] = [];
for (const L of LOCATIONS) for (const n of NICHE_OBJS) jobs.push({ n, city: L.city, state: L.state });

console.log(`Google Maps hunt — no website, ${MIN_STARS === "fourAndHalf" ? "4.5" : "4.0"}★+, ${MIN_REVIEWS}+ reviews`);
console.log(`${NICHE_OBJS.length} niches x ${LOCATIONS.length} locations = ${jobs.length} queries | target ${TARGET}`);
console.log(`Apify spend now $${spend.toFixed(3)} | ceiling $${MAX_SPEND} | known place_ids ${seen.size}\n`);

let added = 0, queries = 0, scraped = 0, cursor = 0;

async function runJob(j: { n: Niche; city: string; state: string }) {
  const qkey = `${j.n.key}|${j.city}|${j.state}`;
  const items = await search(j.n.q, j.city, j.state);
  queries++;
  if (items === null) return;
  scraped += items.length;
  estSpend += items.length * COST_PER_PLACE;   // bill ourselves immediately
  await checkSpend();
  let here = 0, offCat = 0;

  for (const it of items) {
    const pid = it.placeId ?? it.place_id;
    const name = String(it.title ?? "").trim();
    if (!pid || !name || seen.has(pid)) continue;
    if (it.permanentlyClosed || it.temporarilyClosed) continue;   // free local filter
    const site = it.website ?? it.webResults?.[0]?.url ?? null;
    if (site) continue;                                           // belt-and-braces
    const cat = String(it.categoryName ?? "");
    if (!j.n.cats.test(cat)) { offCat++; continue; }              // the pilot's lesson
    const rating = Number(it.totalScore ?? 0);
    const reviews = Number(it.reviewsCount ?? 0);
    if (!(rating >= 4) || reviews < MIN_REVIEWS) continue;
    if (isFranchise(name)) continue;
    seen.add(pid);

    const { score, why } = scoreOf(rating, reviews);
    const r = await pool.query(
      `INSERT INTO leads (name, niche, area, state, address, phone, rating, reviews,
                          maps_url, category, place_id, status, source, hot_score, hot_why)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new','gmaps',$12,$13)
       ON CONFLICT DO NOTHING RETURNING id`,
      [name.slice(0, 160), j.n.key, `${j.city} ${j.state}`, j.state,
       it.address ?? null, it.phone ?? null, rating, reviews,
       it.url ?? null, cat || null, pid, score, why.join(", ")]);
    if (!r.rowCount) continue;
    added++; here++;
    if (score >= 75) console.log(`  \u{1F525} ${score} ${name} \u2014 ${rating}\u2605 ${reviews} rv \u2014 ${cat} \u2014 ${j.city} ${j.state}`);
  }

  await pool.query(
    `INSERT INTO gmaps_queries (query, new_leads) VALUES ($1,$2)
     ON CONFLICT (query) DO UPDATE SET ran_at=now(), new_leads=EXCLUDED.new_leads`, [qkey, here]);
  console.log(`  [q${queries}] ${j.n.key} ${j.city} ${j.state} \u2014 ${items.length} scraped, +${here} kept, ${offCat} wrong-category | ${added}/${TARGET} | ~$${(startSpendEst + estSpend).toFixed(2)}`);
}

async function worker() {
  while (true) {
    if (added >= TARGET || stoppedForBudget) return;
    // Refuse to launch unless the WORST CASE for this one query still fits.
    if (budgetLeft() < PER_SEARCH * COST_PER_PLACE) {
      trip(`only $${budgetLeft().toFixed(3)} left, a query can cost $${(PER_SEARCH * COST_PER_PLACE).toFixed(3)}`);
      return;
    }
    const j = jobs[cursor++];
    if (!j) return;
    if (done.has(`${j.n.key}|${j.city}|${j.state}`)) continue;
    done.add(`${j.n.key}|${j.city}|${j.state}`);
    try { await runJob(j); }
    catch (e: any) { console.error(`  job failed (${j.n.key} ${j.city}): ${e?.message ?? e} \u2014 continuing`); }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

await checkSpend();
const used = spend - startSpend;
console.log(`\nDone${stoppedForBudget ? " (stopped at spend ceiling)" : ""}. ${added} new leads from ${queries} queries (${scraped} places scraped).`);
console.log(`Apify: $${used.toFixed(3)} this run, $${spend.toFixed(3)} total this cycle${added ? `, $${(used / added).toFixed(4)}/lead` : ""}.`);
await exportCsv();
await pool.end();
