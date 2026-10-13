import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env (Neon connection string).");
  process.exit(1);
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 10000, // recycle idle clients before Neon drops them
  keepAlive: true,
});

// Neon closes idle server connections; without this handler pg surfaces that as
// an unhandled error event on an idle client and crashes the whole process.
// Long-running scans must survive a dropped idle connection — the pool just
// opens a fresh one on the next query.
pool.on("error", (err) => {
  console.warn(`pg pool idle-client error (recovered): ${err.message}`);
});

// Belt-and-suspenders: never let a stray async DB rejection kill a multi-hour scan.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.warn(`unhandledRejection (ignored to keep scan alive): ${msg}`);
});

export async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      niche TEXT,
      area TEXT,
      address TEXT,
      phone TEXT,
      website TEXT,
      ig_handle TEXT,
      rating REAL,
      reviews INTEGER,
      maps_url TEXT,
      site_score INTEGER,
      site_notes TEXT,
      category TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      contacted_at TIMESTAMPTZ,
      UNIQUE(name, area)
    );
  `);
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT");
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_aeo BOOLEAN"); // schema.org structured data present?

  // Follow-up tracking. Without this a lead goes new -> sent and is finished
  // forever, so every business gets exactly one touch — but most replies to cold
  // outreach come on touch 2 or 3, so a single-shot pipeline throws away the
  // majority of its own replies.
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS touches INT NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_touch_at TIMESTAMPTZ");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach (
      id SERIAL PRIMARY KEY,
      lead_id INT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'ig',
      touch_no INT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      note TEXT
    );
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS outreach_lead_idx ON outreach(lead_id)");
  // Existing 'sent' rows predate touch tracking — treat them as one touch so
  // they enter the follow-up rotation instead of being invisible.
  await pool.query(
    "UPDATE leads SET touches = 1, last_touch_at = COALESCE(contacted_at, now()) WHERE status = 'sent' AND touches = 0"
  );
  /* DM sender control — the dashboard buttons write here, the Mac helper
     (src/dmagent.ts) reads it and reports back. One row. The cloud dashboard
     can't drive a browser on Gregg's Mac directly, so this row IS the wire
     between the two. desired: what Gregg asked for; status/detail: what the
     Mac is actually doing; connect_seq: bumped by "Connect Instagram". */
  // Two processes (Render dashboard + Mac helper) can run init() at the same
  // moment; concurrent CREATE TABLE IF NOT EXISTS can still collide on
  // pg_type (23505). Losing that race means the table exists — carry on.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dm_control (
      id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      desired TEXT NOT NULL DEFAULT 'stopped',
      connect_seq INT NOT NULL DEFAULT 0,
      resume_ok BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'not connected',
      detail TEXT,
      account TEXT,
      agent_seen_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `).catch((e) => { if (e?.code !== "23505") throw e; });
  await pool.query("INSERT INTO dm_control (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  // backfill state from trailing 2-letter code in area, e.g. "Miami FL" -> FL
  await pool.query(
    "UPDATE leads SET state = upper(substring(area from '([A-Za-z]{2})\\s*$')) WHERE state IS NULL AND area ~ '[A-Za-z]{2}\\s*$'"
  );
}

export interface Lead {
  id: number;
  name: string;
  niche: string | null;
  area: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  ig_handle: string | null;
  rating: number | null;
  reviews: number | null;
  maps_url: string | null;
  site_score: number | null;
  site_notes: string | null;
  category: string | null;
  has_aeo: boolean | null;
  message: string | null;
  status: string;
  created_at: string;
  contacted_at: string | null;
}

export async function upsertLead(l: Partial<Lead> & { name: string; area: string }) {
  await pool.query(
    `INSERT INTO leads (name, niche, area, state, address, phone, website, rating, reviews, maps_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (name, area) DO UPDATE SET
       phone   = COALESCE(EXCLUDED.phone, leads.phone),
       website = COALESCE(EXCLUDED.website, leads.website),
       rating  = COALESCE(EXCLUDED.rating, leads.rating),
       reviews = COALESCE(EXCLUDED.reviews, leads.reviews),
       maps_url = COALESCE(EXCLUDED.maps_url, leads.maps_url)`,
    [l.name, l.niche ?? null, l.area, l.state ?? null, l.address ?? null, l.phone ?? null,
     l.website ?? null, l.rating ?? null, l.reviews ?? null, l.maps_url ?? null]
  );
}
