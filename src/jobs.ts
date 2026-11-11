/**
 * Build a HUNT_JOBS file of searches nobody has run yet (2026-11-09).
 *   npx tsx src/jobs.ts "auto detailing,mobile detailing,plumbing" > /tmp/jobs.json
 * Trades are ROUND-ROBIN (2026-11-09, Gregg: "why are all these leads car related? I don't like that" — the old
 * trade-major order let the cheapest-to-convert trade, detailing, eat the whole budget). Search 1 is trade A in the
 * biggest new city, search 2 trade B, … so a run that stops at its spend ceiling stops with an even mix. Inside a
 * trade, cities are interleaved across states by rank, biggest untouched cities first. Searches already in
 * hunt_queries (any date) are left out, and so are the top-3 cities the default grid covers.
 */
import { pool } from "./db.js";
import { STATE_CITIES } from "./cities.js";
import { MORE_CITIES } from "./morecities.js";

/* 2026-11-10 Gregg: "I don't want car detailers… I want real leads, trades people… new accounts". Default = trades only. */
export const TRADES = "plumbing,electrician,hvac,roofing,handyman,painting,landscaping,lawn care,tree service,fencing,concrete contractor,hardscaping,masonry,pressure washing,window cleaning,gutter cleaning,junk removal,sealcoating,epoxy flooring,pool service,moving company,christmas light installation";
const niches = (process.argv[2] ?? TRADES).split(",").map((s) => s.trim()).filter(Boolean);
const done = new Set((await pool.query(`SELECT query FROM hunt_queries`)).rows.map((r) => String(r.query).toLowerCase()));
const perTrade: { niche: string; city: string; state: string }[][] = [];
for (const niche of niches) {
  const out: { niche: string; city: string; state: string }[] = [];
  perTrade.push(out);
  const cand: { city: string; state: string; rank: number }[] = [];
  for (const [st, list] of Object.entries(MORE_CITIES)) {
    const top = new Set((STATE_CITIES[st] ?? []).map((c) => c.toLowerCase()));
    const uniq = [...new Set(list)].filter((c) => !top.has(c.toLowerCase()));
    uniq.forEach((city, i) => cand.push({ city, state: st, rank: i / uniq.length }));
  }
  cand.sort((a, b) => a.rank - b.rank);
  for (const c of cand) if (!done.has(`${niche} ${c.city} ${c.state}`.toLowerCase())) out.push({ niche, city: c.city, state: c.state });
}
const out: { niche: string; city: string; state: string }[] = [];
for (let i = 0; perTrade.some((t) => i < t.length); i++) for (const t of perTrade) if (t[i]) out.push(t[i]);
console.log(JSON.stringify(out));
console.error(`${out.length} new searches across ${niches.length} trade(s)`);
await pool.end();
