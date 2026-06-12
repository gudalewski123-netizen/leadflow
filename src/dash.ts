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

app.get("/api/leads", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM leads ORDER BY (status = 'new') DESC, site_score ASC NULLS FIRST, reviews DESC NULLS LAST"
  );
  res.json(rows);
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
