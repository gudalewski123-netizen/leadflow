/**
 * DM BOT — sends LeadFlow's hot leads an Instagram DM from Gregg's own account.
 *
 * Gregg, 2026-10-13, after the ban risk was laid out twice: build it, cap 60/day.
 * Everything below exists to keep that account alive while doing it.
 *
 *   npm run dmbot -- --login      one-time: opens the bot's own Chrome window;
 *                                 log in to Instagram there by hand, then close it
 *   npm run dmbot -- --dry        does everything except press Enter — watch it work
 *   npm run dmbot                 live: sends today's remaining budget, spread
 *                                 across 9am–8pm Eastern, then exits
 *   npm run dmbot -- --max 5      live, but never more than 5 this run
 *
 *   touch ~/leadflow/STOP-DMBOT   kill switch — checked before every DM.
 *                                 The bot also creates this file itself the
 *                                 moment Instagram shows any block/warning.
 *
 * WHO GETS MESSAGED, in this order:
 *   1. follow-ups that are due (touch 2 at day 4, touch 3 at day 9 — capped at 3)
 *   2. genuinely hot new leads: hot_score >= 60 AND hot_score_orig IS NULL
 *      (never the September pins), highest score first
 * Never: anyone marked replied / skip / dead, or anyone whose thread already
 * holds a conversation we didn't start.
 *
 * WHAT IT SENDS: openerFor(lead id, touches) from variants.ts — 12 openers,
 * 6 bumps, 4 closers, deterministic per lead, so no two neighbours in the
 * queue get identical text and a follow-up never repeats the first message.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { syncWebsitesFromBio } from "./sitecheck.js";
import { existsSync, writeFileSync, unlinkSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { pool, init } from "./db.js";
import { openerFor, variantTag, OURS } from "./variants.js";
import { threadState, realLines } from "./dmthread.js";
import { budget, hourInTZ, HARD_CAP, WARMUP } from "./dmcap.js";

const ROOT = join(homedir(), "leadflow");
const PROFILE = join(ROOT, ".ig-profile");          // the bot's own browser profile (gitignored)
const STOP = join(ROOT, "STOP-DMBOT");
const LOCK = join(ROOT, "logs", "dmbot.lock");
const START_HOUR = Number(process.env.DM_START_HOUR ?? 9);   // Eastern
const END_HOUR = Number(process.env.DM_END_HOUR ?? 20);      // Eastern, exclusive

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = flag("--dry");
const LOGIN = flag("--login");
const RUN_MAX = val("--max") ? Math.max(0, Number(val("--max"))) : Infinity;

mkdirSync(join(ROOT, "logs"), { recursive: true });
const LOGFILE = join(ROOT, "logs", `dmbot-${new Date().toISOString().slice(0, 10)}.log`);
const log = (...a: unknown[]) => {
  const line = `${new Date().toISOString()} ${DRY ? "[DRY] " : ""}${a.join(" ")}`;
  console.log(line);
  appendFileSync(LOGFILE, line + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/* ---------- alerts: a block is the one thing Gregg must hear about at once ---------- */
function notify(title: string, body: string) {
  if (process.env.DM_NO_NOTIFY === "1") return; // tests only
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Basso"`]);
  } catch {}
  try {
    const keys = readFileSync(join(homedir(), ".forensic-keys"), "utf8");
    const topic = keys.match(/^\s*(?:export\s+)?NTFY_TOPIC=["']?([^"'\s]+)/m)?.[1];
    if (topic) execFileSync("curl", ["-s", "-m", "10", "-H", `Title: ${title}`, "-H", "Priority: urgent", "-d", body, `https://ntfy.sh/${topic}`]);
  } catch {}
}

function haltForever(reason: string): never {
  writeFileSync(STOP, `${new Date().toISOString()}\n${reason}\nDelete this file to let the DM bot run again.\n`);
  log("HALT:", reason);
  notify("DM bot stopped", reason);
  cleanup();
  process.exit(3);
}

/* ---------- Instagram's warnings. Any of these = stop everything, today and every day, until a human looks. ---------- */
const BLOCK_TEXT = /try again later|action blocked|we restrict certain activity|temporarily (?:blocked|locked|restricted)|your account has been (?:disabled|suspended|restricted)|we suspect automated behavior|unusual activity|confirm it'?s you|help us confirm|suspicious (?:login|activity)|we limit how often/i;
async function checkBlocked(page: Page) {
  const url = page.url();
  if (/\/challenge|\/suspended|\/accounts\/(?:login|suspended|disabled)/.test(url))
    haltForever(`Instagram redirected to ${url} — logged out, challenged or restricted. Click Connect Instagram in LeadFlow to log in again, and check the account in the Instagram app.`);
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const m = text.match(BLOCK_TEXT);
  if (m) haltForever(`Instagram showed "${m[0]}" — the account is being limited. Stop all DMs for at least 24-48h.`);
}

async function dismissPopups(page: Page) {
  for (const name of ["Not Now", "Not now", "Cancel"]) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {});
  }
}

/* ---------- the queue ---------- */
type Lead = { id: number; ig_handle: string; touches: number; status: string };
async function queue(limit: number): Promise<Lead[]> {
  const { rows } = await pool.query(
    `SELECT id, ig_handle, touches, status FROM leads
      WHERE ig_handle IS NOT NULL AND ig_handle <> '' AND (
            (status='sent' AND touches BETWEEN 1 AND 2
               AND last_touch_at < now() - (CASE WHEN touches <= 1 THEN interval '4 days' ELSE interval '5 days' END)
               -- Only threads the BOT started, and only while still fresh: for
               -- those we know the exact previous text, which is what lets the
               -- reply check work. Hand-sent DMs from months ago would get a
               -- "floating this back up" bump out of nowhere, and their threads
               -- can't be checked reliably (1,024 such leads on 2026-10-13).
               AND last_touch_at > now() - interval '21 days'
               AND EXISTS (SELECT 1 FROM outreach o WHERE o.lead_id = leads.id
                             AND o.touch_no = leads.touches AND o.note LIKE '%dmbot%'))
         OR (status='new' AND hot_score >= 60 AND hot_score_orig IS NULL
             AND (website IS NULL OR website = ''))   -- never tell a business with a site it has none (2026-10-15)
      )
      ORDER BY (status='sent') DESC, hot_score DESC NULLS LAST, id
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function recordSent(lead: Lead, verified: boolean) {
  const r = await pool.query(
    `UPDATE leads SET status='sent', touches = touches + 1, last_touch_at = now(),
            contacted_at = COALESCE(contacted_at, now())
      WHERE id=$1 RETURNING touches`,
    [lead.id]
  );
  const touchNo = r.rows[0]?.touches ?? lead.touches + 1;
  await pool.query(
    "INSERT INTO outreach (lead_id, channel, touch_no, note) VALUES ($1,'ig',$2,$3)",
    [lead.id, touchNo, `${variantTag(lead.id, touchNo - 1)} dmbot${verified ? "" : " unverified"}`]
  );
}
async function setStatus(id: number, status: string, why: string) {
  if (DRY) { log(`(dry: would mark lead ${id} ${status} — ${why})`); return; }
  await pool.query(`UPDATE leads SET status=$2, hot_why = COALESCE(hot_why,'') || $3 WHERE id=$1`,
    [id, status, ` | dmbot ${new Date().toISOString().slice(0, 10)}: ${why}`]);
}

/* ---------- one DM ---------- */
async function openThread(page: Page, handle: string): Promise<"ok" | "gone" | "nomsg"> {
  await page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, { waitUntil: "domcontentloaded" });
  await sleep(rand(2500, 4500));
  await checkBlocked(page);
  await dismissPopups(page);
  const body = await page.locator("body").innerText().catch(() => "");
  if (/sorry, this page isn'?t available|profile isn'?t available/i.test(body)) return "gone";
  const msgBtn = page.getByRole("button", { name: /^message$/i }).or(page.getByText(/^Message$/)).first();
  if (!(await msgBtn.isVisible().catch(() => false))) return "nomsg";
  await msgBtn.click();
  await sleep(rand(3000, 5000));
  await checkBlocked(page);
  await dismissPopups(page);
  return "ok";
}

async function composer(page: Page) {
  const box = page.locator('div[role="textbox"][contenteditable="true"], textarea[placeholder^="Message"]').last();
  await box.waitFor({ state: "visible", timeout: 15000 });
  return box;
}

async function sendOne(page: Page, lead: Lead): Promise<"sent" | "skip"> {
  const msg = openerFor(lead.id, lead.touches);
  const state = await openThread(page, lead.ig_handle);
  if (state === "gone") { await setStatus(lead.id, "dead", "profile no longer exists"); log(`@${lead.ig_handle}: profile gone → dead`); return "skip"; }
  if (state === "nomsg") { log(`@${lead.ig_handle}: no Message button (private/limited) — left for manual`); return "skip"; }

  const box = await composer(page).catch(() => null);
  if (!box) { log(`@${lead.ig_handle}: composer never appeared — skipped`); return "skip"; }

  const thread = await page.locator("main").innerText().catch(() => "");
  if (lead.touches === 0) {
    // A brand-new lead must have an empty thread; anything there means a
    // conversation already exists that LeadFlow doesn't know about.
    const real = realLines(thread, lead.ig_handle);
    if (real.some((l) => OURS.includes(l) || l.length > 12)) {
      const hadUs = real.some((l) => OURS.includes(l));
      await setStatus(lead.id, hadUs ? "sent" : "replied", hadUs ? "thread already had our opener" : "thread already had a conversation — check by hand");
      log(`@${lead.ig_handle}: existing thread found → ${hadUs ? "sent" : "replied"} (not messaged)`);
      return "skip";
    }
  } else {
    const prev = openerFor(lead.id, lead.touches - 1);
    const st = threadState(thread, prev, lead.ig_handle);
    if (st === "reply") { await setStatus(lead.id, "replied", "replied in the thread — follow-up cancelled"); log(`@${lead.ig_handle}: THEY REPLIED → marked replied, no follow-up`); return "skip"; }
    if (st === "unknown") { log(`@${lead.ig_handle}: couldn't find our earlier message — follow-up skipped to be safe`); return "skip"; }
  }

  await box.click();
  for (const ch of msg) { await page.keyboard.type(ch); await sleep(rand(35, 140)); }
  await sleep(rand(800, 2000));

  if (DRY) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
    log(`@${lead.ig_handle}: [dry] typed and cleared → "${msg}"`);
    return "sent";
  }

  const before = (thread.match(new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  await page.keyboard.press("Enter");
  await sleep(rand(2500, 4000));
  await checkBlocked(page);
  const afterText = await page.locator("main").innerText().catch(() => "");
  const after = (afterText.match(new RegExp(msg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const verified = after > before;
  // Recorded even when unverified: re-sending to someone who already got it
  // is worse than one missing log line.
  await recordSent(lead, verified);
  log(`@${lead.ig_handle}: SENT touch ${lead.touches + 1}${verified ? "" : " (could not confirm in thread)"} → "${msg}"`);
  return "sent";
}

/* ---------- lifecycle ---------- */
let ctx: BrowserContext | null = null;
function cleanup() { try { unlinkSync(LOCK); } catch {} }
process.on("SIGINT", async () => { log("stopped by Ctrl-C"); cleanup(); await ctx?.close().catch(() => {}); process.exit(130); });

async function launch(): Promise<BrowserContext> {
  const opts = {
    headless: process.env.DM_HEADLESS === "1",
    viewport: { width: 1280, height: 860 },
    args: ["--disable-blink-features=AutomationControlled"],
  };
  // Real Chrome looks like a person's browser; Playwright's bundled Chromium is the fallback.
  return chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome", ignoreDefaultArgs: ["--no-sandbox"] })
    .catch(() => chromium.launchPersistentContext(PROFILE, opts));
}

async function main() {
  if (LOGIN) {
    ctx = await launch();
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    await p.goto("https://www.instagram.com/accounts/login/");
    console.log("\nLog in to Instagram in the window that just opened (the account the bot should send from).\nTick 'Save login info' if asked, then simply CLOSE the window. The login is kept for future runs.\n");
    await new Promise<void>((r) => ctx!.on("close", () => r()));
    return;
  }

  if (existsSync(STOP)) { console.log(`Kill switch is on (${STOP}):\n${readFileSync(STOP, "utf8")}`); process.exit(2); }
  if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, "utf8"));
    try { process.kill(pid, 0); console.log(`Already running (pid ${pid}).`); process.exit(2); } catch { /* stale lock */ }
  }
  writeFileSync(LOCK, String(process.pid));

  await init();
  const found = await syncWebsitesFromBio(pool);   // a bio link to their own domain = they HAVE a website
  if (found) log(`sitecheck: recorded ${found} websites from Instagram bio links — those leads won't get a no-website DM`);
  const h = hourInTZ();
  if (!DRY && (h < START_HOUR || h >= END_HOUR)) { log(`outside sending hours (${START_HOUR}:00–${END_HOUR}:00 Eastern; now ${h}:00) — nothing sent`); cleanup(); process.exit(0); }

  const b = await budget();
  const todo = DRY ? Math.min(3, RUN_MAX) : Math.min(b.remaining, RUN_MAX);
  log(`cap today ${b.cap}${WARMUP ? ` (warm-up; ceiling ${HARD_CAP})` : ""} · already sent today ${b.today} · this run will send up to ${todo}`);
  if (todo <= 0) { log("daily cap reached — nothing to do"); cleanup(); await pool.end(); return; }

  const leads = await queue(todo * 3); // headroom for skips
  if (!leads.length) { log("queue is empty — no due follow-ups and no uncontacted hot leads"); cleanup(); await pool.end(); return; }

  ctx = await launch();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  await sleep(3000);
  await checkBlocked(page);
  /* Logged in = Instagram's own session cookie is present. The first version
     looked for a login form on the homepage; logged out, Instagram doesn't
     always show one, and a test run happily went on visiting profiles. */
  const session = (await ctx.cookies("https://www.instagram.com")).some((c) => c.name === "sessionid" && c.value);
  if (!session) haltForever("Not logged in to Instagram — click Connect Instagram in LeadFlow.");

  let sent = 0;
  for (const lead of leads) {
    if (sent >= todo) break;
    if (existsSync(STOP)) { log("kill switch found — stopping"); break; }
    if (!DRY && hourInTZ() >= END_HOUR) { log("end of sending hours — stopping for today"); break; }
    if (!DRY) { const live = await budget(); if (live.remaining <= 0) { log("daily cap reached"); break; } }

    const res = await sendOne(page, lead).catch(async (e) => { log(`@${lead.ig_handle}: error ${String(e?.message ?? e).slice(0, 160)}`); return "skip" as const; });
    if (res === "sent") sent++;

    if (sent < todo) {
      // Spread what's left across what's left of the day, with jitter, so the
      // sends never look like a burst: the gap is set by the remaining window,
      // not a fixed timer.
      const nowH = hourInTZ();
      const minsLeft = Math.max(30, (END_HOUR - nowH) * 60);
      const gapMin = DRY ? rand(0.2, 0.5) : Math.min(25, Math.max(3, (minsLeft / Math.max(1, todo - sent)) * rand(0.6, 1.4)));
      log(`next in ${gapMin.toFixed(1)} min`);
      await sleep(gapMin * 60_000);
    }
  }
  log(`done — ${sent} ${DRY ? "rehearsed" : "sent"} this run`);
  await ctx.close().catch(() => {});
  cleanup();
  await pool.end();
}

main().catch(async (e) => { log("fatal:", String(e?.stack ?? e).slice(0, 400)); cleanup(); await ctx?.close().catch(() => {}); process.exit(1); });
