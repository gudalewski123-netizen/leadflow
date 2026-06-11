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
