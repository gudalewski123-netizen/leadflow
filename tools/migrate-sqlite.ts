/** One-off: copy leads from the old local leadflow.db (SQLite) into Postgres. */
import Database from "better-sqlite3";
import { pool, init } from "../src/db.js";

await init();
const sqlite = new Database("leadflow.db", { readonly: true });
const rows = sqlite.prepare("SELECT * FROM leads").all() as Record<string, unknown>[];

for (const r of rows) {
  await pool.query(
    `INSERT INTO leads (name, niche, area, address, phone, website, ig_handle, rating, reviews,
       maps_url, site_score, site_notes, category, message, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (name, area) DO NOTHING`,
    [r.name, r.niche, r.area, r.address, r.phone, r.website, r.ig_handle, r.rating,
     r.reviews, r.maps_url, r.site_score, r.site_notes, r.category, r.message, r.status]
  );
}
console.log(`Migrated ${rows.length} leads.`);
await pool.end();
