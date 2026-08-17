/**
 * Dump a plain list of Instagram handles to work by hand.
 *
 * Usage:
 *   npm run handlelist                 # every un-contacted handle
 *   npm run handlelist -- hot          # only hot_score >= 60
 *   npm run handlelist -- nosite       # only "no link in bio" (needs npm run hot first)
 *   npm run handlelist -- all 500      # cap the count
 *
 * Writes handles.txt (one per line, paste-ready) and handles.csv (with context).
 */
import fs from "node:fs";
import { pool, init } from "./db.js";

const mode = (process.argv[2] ?? "all").toLowerCase();
const cap = Number(process.argv[3] ?? 5000);

// Default to handles sourced FROM Instagram. The legacy ones came from the
// search-engine scraper while it was IP-blocked, so a lot of them are junk
// (an Austrian cathedral filed under Michigan plumbers) — opt into those with
// `legacy` rather than shipping them in a list meant for real outreach.
const conds = ["ig_handle IS NOT NULL", "status = 'new'"];
if (mode !== "legacy") conds.push("source = 'ig_search'");
if (mode === "hot") conds.push("hot_score >= 60");
if (mode === "nosite") conds.push("(ig_link IS NULL AND ig_checked_at IS NOT NULL)");

await init();
const { rows } = await pool.query(
  `SELECT ig_handle, name, niche, area, hot_score, hot_why, ig_followers, last_active
     FROM leads
    WHERE ${conds.join(" AND ")}
    ORDER BY hot_score DESC NULLS LAST, id DESC
    LIMIT $1`,
  [cap]
);

const handles = rows.map((r) => "@" + r.ig_handle).join("\n");
fs.writeFileSync("handles.txt", handles + "\n");

const csv = [
  "handle,business,niche,area,hot_score,followers,last_post,why",
  ...rows.map((r) =>
    [
      "@" + r.ig_handle,
      JSON.stringify(r.name ?? ""),
      r.niche ?? "",
      r.area ?? "",
      r.hot_score ?? "",
      r.ig_followers ?? "",
      r.last_active ? new Date(r.last_active).toISOString().slice(0, 10) : "",
      JSON.stringify(r.hot_why ?? ""),
    ].join(",")
  ),
].join("\n");
fs.writeFileSync("handles.csv", csv + "\n");

console.log(`${rows.length} handles → handles.txt (paste-ready) + handles.csv (with context)`);
console.log(rows.slice(0, 15).map((r) => "  @" + r.ig_handle + (r.hot_score != null ? `  [${r.hot_score}]` : "")).join("\n"));
await pool.end();
