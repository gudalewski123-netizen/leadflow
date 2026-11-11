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
import { MONEY_PLACES } from "./metros.js";
/* `npx tsx src/jobs.ts "<trades>" metros` (2026-11-10): money metros + their affluent suburbs instead of next-tier towns.
   High-yield trades (no-website keeper rate 9-17% in past hunts) get two searches per round, the rest one. */
const MODE = (process.argv[3] ?? "").toLowerCase();
const HIGH_YIELD = new Set(["plumbing", "pool service", "epoxy flooring", "moving company", "sealcoating", "window cleaning", "tree service", "gutter cleaning", "electrician", "hardscaping", "christmas light installation"]);
const done = new Set((await pool.query(`SELECT query FROM hunt_queries`)).rows.map((r) => String(r.query).toLowerCase()));
const perTrade: { niche: string; city: string; state: string }[][] = [];
for (const niche of niches) {
  const out: { niche: string; city: string; state: string }[] = [];
  perTrade.push(out);
  if (MODE === "metros") {
    for (const c of MONEY_PLACES) if (!done.has(`${niche} ${c.city} ${c.state}`.toLowerCase())) out.push({ niche, city: c.city, state: c.state });
    // interleave metros so a capped run spreads across the country, not 40 searches in New York
    const byMetro = new Map<string, typeof out>(); for (const j of out) { const m = MONEY_PLACES.find((p) => p.city === j.city && p.state === j.state)!.metro; (byMetro.get(m) ?? byMetro.set(m, []).get(m)!).push(j); }
    out.length = 0; const lists = [...byMetro.values()]; for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) out.push(l[i]);
    // stagger: trade k starts k*3 metros along, so a small run covers many metros instead of every trade in the same ones
    const shift = (perTrade.length - 1) * 3 % Math.max(1, lists.length); out.push(...out.splice(0, shift));
    continue;
  }
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
const ptr = perTrade.map(() => 0);
while (perTrade.some((t, k) => ptr[k] < t.length)) perTrade.forEach((t, k) => { const n = HIGH_YIELD.has(niches[k]) ? 2 : 1; for (let r = 0; r < n && ptr[k] < t.length; r++) out.push(t[ptr[k]++]); });
console.log(JSON.stringify(out));
console.error(`${out.length} new searches across ${niches.length} trade(s)`);
await pool.end();
