/**
 * Instagram-FIRST lead sourcing — the handle comes straight from Instagram.
 *
 * The old chain was Maps -> business -> guess their IG via a search engine, and
 * that last hop is IP-blocked, which is why 13,923 no-site leads produced only
 * 723 handles (many of them wrong — an Austrian cathedral was stored as a
 * Michigan plumber). This skips the broken hop entirely: query Instagram's own
 * search, get the handle and the business name together, already verified real.
 *
 * Usage:
 *   npm run igsource -- "mobile detailing" FL,TX,CA
 *   npm run igsource -- "mobile detailing" all
 *   npm run igsource -- "roofing" FL 5          # cap cities per state
 *
 * Then score them:  npm run hot
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";
import { STATE_CITIES, ALL_STATES } from "./cities.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ck = JSON.parse(fs.readFileSync(path.join(root, ".ig_cookies.json"), "utf8")) as {
  sessionid: string; csrftoken: string; ds_user_id: string;
};

const niche = process.argv[2];
const statesArg = (process.argv[3] ?? "all").toLowerCase();
const perState = Number(process.argv[4] ?? 3);

if (!niche) {
  console.error('Usage: npm run igsource -- "<niche>" <STATES|all> [citiesPerState]');
  process.exit(1);
}

const states = statesArg === "all" ? ALL_STATES : statesArg.toUpperCase().split(",").map((s) => s.trim());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Aggregators, franchises and directories — not local businesses we can sell to.
const SKIP = /detailing\.?(world|news|daily)|^detailing$|official|magazine|academy|training|course|supply|supplies|products|shop$|store$|amazon|ebay/i;

async function search(query: string): Promise<{ handle: string; name: string; private: boolean }[] | "rl"> {
  try {
    const r = await fetch(
      `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}`,
      {
        headers: {
          // Same SecFetch requirement as src/hot.ts — an Android UA without these
          // gets a blanket 400 that looks like "no results".
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "x-ig-app-id": "936619743392459",
          "x-csrftoken": ck.csrftoken,
          "x-requested-with": "XMLHttpRequest",
          Referer: "https://www.instagram.com/",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          Accept: "*/*",
          Cookie: `sessionid=${ck.sessionid}; csrftoken=${ck.csrftoken}; ds_user_id=${ck.ds_user_id}`,
        },
      }
    );
    if (r.status === 429) return "rl";
    if (r.status !== 200) return [];
    const users = ((await r.json()) as any)?.users ?? [];
    return users
      .map((x: any) => ({
        handle: x?.user?.username,
        name: x?.user?.full_name || x?.user?.username,
        private: Boolean(x?.user?.is_private),
      }))
      .filter((u: any) => u.handle && !SKIP.test(u.handle) && !SKIP.test(u.name));
  } catch {
    return [];
  }
}

await init();
await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT");

const jobs: { state: string; city: string }[] = [];
for (const st of states) for (const city of (STATE_CITIES[st] ?? []).slice(0, perState)) jobs.push({ state: st, city });

console.log(`Sourcing "${niche}" across ${jobs.length} cities in ${states.length} state(s)...\n`);

let found = 0, added = 0, dupes = 0;
const seen = new Set<string>();

for (const { state, city } of jobs) {
  const q = `${niche} ${city}`;
  let res = await search(q);
  let streak = 0;
  while (res === "rl") {
    streak++;
    const wait = Math.min(1800000, 120000 * streak);
    console.log(`  rate-limited, resting ${Math.round(wait / 60000)}min...`);
    await sleep(wait);
    res = await search(q);
  }

  const hits: string[] = [];
  for (const u of res) {
    if (seen.has(u.handle)) continue;
    seen.add(u.handle);
    found++;
    const r = await pool.query(
      `INSERT INTO leads (name, niche, area, state, ig_handle, status, source)
       VALUES ($1,$2,$3,$4,$5,'new','ig_search')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [u.name.slice(0, 120), niche, `${city} ${state}`, state, u.handle]
    );
    if (r.rowCount) { added++; hits.push("@" + u.handle); } else dupes++;
  }
  console.log(`  ${(city + " " + state).padEnd(24)} ${String(res.length).padStart(2)} found  ${hits.join(" ") || "(all dupes)"}`);
  await sleep(4000 + Math.floor(Math.random() * 3000)); // ~4-7s, gentle
}

console.log(`\nDone. ${found} accounts seen, ${added} new leads added, ${dupes} already known.`);
console.log(`Next: npm run hot        # score them by recency + no-website`);
await pool.end();
