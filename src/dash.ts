/**
 * LeadFlow dashboard — password-protected, shared via Neon Postgres.
 * Local: npm run dash → http://localhost:4571   Production: Render (PORT env)
 */
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, init } from "./db.js";
import { findIgHandle } from "./findig.js";
import { ALL_STATES } from "./cities.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PASSWORD = process.env.APP_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
if (!APP_PASSWORD || !SECRET) {
  console.error("APP_PASSWORD and SESSION_SECRET must be set.");
  process.exit(1);
}

const SESSION_DAYS = 30;
const COOKIE = "lf_session";

function sign(exp: number): string {
  const mac = crypto.createHmac("sha256", SECRET!).update(String(exp)).digest("hex");
  return `${exp}.${mac}`;
}

function verify(token: string | undefined): boolean {
  if (!token) return false;
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now()) return false;
  const expected = crypto.createHmac("sha256", SECRET!).update(expStr).digest("hex");
  return mac?.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

function getCookie(req: express.Request): string | undefined {
  return req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
}

const isAuthed = (req: express.Request) => verify(getCookie(req));

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// --- auth ---
let lastAttempt = 0;
app.post("/api/login", (req, res) => {
  const now = Date.now();
  if (now - lastAttempt < 1000) return res.status(429).json({ error: "slow down" });
  lastAttempt = now;

  const given = String((req.body as { password?: string }).password ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(APP_PASSWORD!);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return res.status(401).json({ error: "wrong password" });

  const exp = now + SESSION_DAYS * 86400_000;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(root, "views", isAuthed(req) ? "app.html" : "login.html"));
});

// --- gated API ---
app.use("/api", (req, res, next) => {
  if (!isAuthed(req)) return res.status(401).json({ error: "unauthorized" });
  next();
});

// Filtered + paginated leads — the dashboard fetches only the page it's showing,
// so it loads instantly no matter how big the database gets.
app.get("/api/leads", async (req, res) => {
  const q = req.query;
  const status = String(q.status ?? "no_site");
  const region = String(q.region ?? "all");
  const niche = String(q.niche ?? "all");
  const chan = String(q.chan ?? "all");
  const minrev = parseInt(String(q.minrev ?? "0")) || 0;
  const limit = Math.min(parseInt(String(q.limit ?? "60")) || 60, 200);
  const offset = parseInt(String(q.offset ?? "0")) || 0;

  const conds: string[] = [];
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return "$" + params.length; };

  if (status === "new") conds.push("status='new'");
  else if (status === "no_site") conds.push("status='new'", "category='no_site'");
  else if (status === "bad_site") conds.push("status='new'", "category='bad_site'");
  else if (status === "sent") conds.push("status='sent'");
  else if (status === "replied") conds.push("status='replied'");
  else conds.push("status NOT IN ('dead','skip')"); // "all" — hide dead/skipped

  if (region === "__us__") conds.push(`state = ANY(${p(ALL_STATES)})`);
  else if (region !== "all") conds.push(`state = ${p(region)}`);
  if (niche !== "all") conds.push(`niche = ${p(niche)}`);
  if (chan === "ig") conds.push("ig_handle IS NOT NULL");
  else if (chan === "phone") conds.push("ig_handle IS NULL AND phone IS NOT NULL");
  if (minrev > 0) conds.push(`COALESCE(reviews,0) >= ${p(minrev)}`);

  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const total = (await pool.query(`SELECT COUNT(*)::int c FROM leads ${where}`, params)).rows[0].c;
  const rows = (await pool.query(
    `SELECT * FROM leads ${where} ORDER BY reviews DESC NULLS LAST, id DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  )).rows;
  res.json({ leads: rows, total });
});

// Dropdown counts (per-region, per-niche, channel) over the to-contact pool —
// computed in SQL so the client never needs the full lead list.
app.get("/api/facets", async (_req, res) => {
  const [states, niches, chan] = await Promise.all([
    pool.query("SELECT state, COUNT(*)::int n FROM leads WHERE status='new' AND state IS NOT NULL GROUP BY state"),
    pool.query("SELECT niche, COUNT(*)::int n FROM leads WHERE status='new' AND niche IS NOT NULL GROUP BY niche"),
    pool.query("SELECT COUNT(*) FILTER (WHERE ig_handle IS NOT NULL)::int ig, COUNT(*) FILTER (WHERE ig_handle IS NULL AND phone IS NOT NULL)::int phone FROM leads WHERE status='new'"),
  ]);
  const regionCounts: Record<string, number> = {};
  for (const r of states.rows) regionCounts[r.state] = r.n;
  const nicheCounts: Record<string, number> = {};
  for (const r of niches.rows) nicheCounts[r.niche] = r.n;
  res.json({ regionCounts, nicheCounts, ig: chan.rows[0].ig, phone: chan.rows[0].phone });
});

app.get("/api/stats", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'new')::int AS to_contact,
      COUNT(*) FILTER (WHERE category = 'no_site' AND status = 'new')::int AS no_site,
      COUNT(*) FILTER (WHERE status = 'replied')::int AS replied,
      COUNT(*) FILTER (WHERE contacted_at >= date_trunc('day', now()))::int AS sent_today
    FROM leads
  `);
  res.json(rows[0]);
});

app.post("/api/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status, message, ig_handle } = req.body as {
    status?: string; message?: string; ig_handle?: string;
  };
  const found = await pool.query("SELECT id FROM leads WHERE id=$1", [id]);
  if (!found.rowCount) return res.status(404).json({ error: "not found" });

  if (message !== undefined)
    await pool.query("UPDATE leads SET message=$1 WHERE id=$2", [message, id]);
  if (ig_handle !== undefined)
    await pool.query("UPDATE leads SET ig_handle=$1 WHERE id=$2", [ig_handle.replace(/^@/, ""), id]);
  if (status !== undefined)
    await pool.query(
      "UPDATE leads SET status=$1, contacted_at = CASE WHEN $1='sent' THEN now() ELSE contacted_at END WHERE id=$2",
      [status, id]
    );
  res.json({ ok: true });
});

// On-demand IG handle resolution — clicked when a no-handle lead's "open IG"
// button needs to land on the real profile. Searches, verifies, saves, returns it.
app.post("/api/leads/:id/resolve-ig", async (req, res) => {
  const id = Number(req.params.id);
  const r = await pool.query("SELECT id, name, area, ig_handle FROM leads WHERE id=$1", [id]);
  const lead = r.rows[0];
  if (!lead) return res.status(404).json({ error: "not found" });
  if (lead.ig_handle) return res.json({ ig_handle: lead.ig_handle, cached: true });

  const handle = await findIgHandle(lead.name, lead.area);
  if (handle) await pool.query("UPDATE leads SET ig_handle=$1 WHERE id=$2", [handle, id]);
  res.json({ ig_handle: handle });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

await init();
const PORT = Number(process.env.PORT ?? 4571);
app.listen(PORT, () => console.log(`LeadFlow → http://localhost:${PORT}`));
