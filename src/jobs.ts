/**
 * Build a HUNT_JOBS file of searches nobody has run yet (2026-11-09).
 *   npx tsx src/jobs.ts "auto detailing,mobile detailing,plumbing" > /tmp/jobs.json
 * Trade-major (the best trade sweeps every new city first); inside a trade, cities are interleaved across states by
 * their rank in that state's list, so the biggest untouched cities go before small towns. Searches already in
 * hunt_queries (any date) are left out, and so are the top-3 cities the default grid covers.
 */
import { pool } from "./db.js";
import { STATE_CITIES } from "./cities.js";
import { MORE_CITIES } from "./morecities.js";

const niches = (process.argv[2] ?? "auto detailing").split(",").map((s) => s.trim()).filter(Boolean);
const done = new Set((await pool.query(`SELECT query FROM hunt_queries`)).rows.map((r) => String(r.query).toLowerCase()));
const out: { niche: string; city: string; state: string }[] = [];
for (const niche of niches) {
  const cand: { city: string; state: string; rank: number }[] = [];
  for (const [st, list] of Object.entries(MORE_CITIES)) {
    const top = new Set((STATE_CITIES[st] ?? []).map((c) => c.toLowerCase()));
    const uniq = [...new Set(list)].filter((c) => !top.has(c.toLowerCase()));
    uniq.forEach((city, i) => cand.push({ city, state: st, rank: i / uniq.length }));
  }
  cand.sort((a, b) => a.rank - b.rank);
  for (const c of cand) if (!done.has(`${niche} ${c.city} ${c.state}`.toLowerCase())) out.push({ niche, city: c.city, state: c.state });
}
console.log(JSON.stringify(out));
console.error(`${out.length} new searches across ${niches.length} trade(s)`);
await pool.end();
