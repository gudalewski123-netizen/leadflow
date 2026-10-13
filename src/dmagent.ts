/**
 * DM AGENT — the helper on Gregg's Mac that the dashboard buttons drive.
 *
 * Runs all the time under launchd (com.gregg.leadflow.dmagent). Every 10s it
 * checks in (so the dashboard can show "Mac online"), reads dm_control, and:
 *
 *   Connect Instagram  → opens the bot's own Chrome window on the Instagram
 *                        login page; Gregg logs in by hand; the moment the
 *                        session cookie appears it reads the username and
 *                        closes the window itself. Passwords never pass
 *                        through here — only the browser profile keeps the login.
 *   Start sending      → runs src/dmbot.ts (live) whenever we're inside
 *                        9am–8pm Eastern and today's cap isn't used up.
 *                        Re-runs it next morning without being asked again.
 *   Stop               → interrupts a run in progress and stays stopped.
 *
 * The bot's own safety stays in charge: if it halts on a login wall or an
 * Instagram warning it writes ~/leadflow/STOP-DMBOT and exits 3. The agent then
 * flips the switch to stopped and shows the reason; resuming needs a second,
 * explicit yes in the dashboard (resume_ok), which is the only path that
 * deletes the STOP file.
 *
 * Never sends anything on its own initiative: desired starts 'stopped'.
 */
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pool, init } from "./db.js";
import { budget, hourInTZ } from "./dmcap.js";

const ROOT = join(homedir(), "leadflow");
const PROFILE = join(ROOT, ".ig-profile");
const STOP = join(ROOT, "STOP-DMBOT");
const STATE = join(ROOT, "logs", "dmagent.state");
const START_HOUR = Number(process.env.DM_START_HOUR ?? 9);
const END_HOUR = Number(process.env.DM_END_HOUR ?? 20);
mkdirSync(join(ROOT, "logs"), { recursive: true });

const log = (...a: unknown[]) => {
  const line = `${new Date().toISOString()} ${a.join(" ")}`;
  console.log(line);
  appendFileSync(join(ROOT, "logs", "dmagent.log"), line + "\n");
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let child: ChildProcess | null = null;
let busyConnecting = false;
let errorStreak = 0;
let retryAt = 0;
let lastConnectSeq = existsSync(STATE) ? Number(readFileSync(STATE, "utf8")) || 0 : -1;

async function setStatus(status: string, detail: string | null = null, extra: Record<string, unknown> = {}) {
  const keys = Object.keys(extra);
  const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(", ");
  await pool.query(
    `UPDATE dm_control SET status=$1, detail=$2${sets ? ", " + sets : ""}, updated_at=now() WHERE id=1`,
    [status, detail, ...keys.map((k) => extra[k])]
  );
}

/* ---------- Connect Instagram ---------- */
async function connect() {
  busyConnecting = true;
  if (child) { log("connect: stopping the running sender first"); child.kill("SIGINT"); await sleep(4000); }
  await setStatus("connecting", "A Chrome window opened on the Mac — log in to Instagram there.");
  const opts = { headless: process.env.DM_HEADLESS === "1", viewport: { width: 1100, height: 820 }, args: ["--disable-blink-features=AutomationControlled"] };
  const ctx = await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" })
    .catch(() => chromium.launchPersistentContext(PROFILE, opts));
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" }).catch(() => {});
    const deadline = Date.now() + Number(process.env.DM_LOGIN_TIMEOUT_MS ?? 10 * 60_000);
    let ok = false;
    while (Date.now() < deadline) {
      if ((await ctx.cookies("https://www.instagram.com")).some((c) => c.name === "sessionid" && c.value)) { ok = true; break; }
      if (ctx.pages().length === 0) break; // window closed by hand
      await sleep(2000);
    }
    if (!ok) { await setStatus("not connected", "Login window closed or timed out before the login finished."); return; }

    await sleep(3000); // let Instagram finish its post-login redirects
    let account: string | null = null;
    try {
      const uid = (await ctx.cookies("https://www.instagram.com")).find((c) => c.name === "ds_user_id")?.value;
      if (uid) {
        account = await page.evaluate(async (id) => {
          const r = await fetch(`/api/v1/users/${id}/info/`, { headers: { "x-ig-app-id": "936619743392459" } });
          return r.ok ? (await r.json())?.user?.username ?? null : null;
        }, uid);
      }
    } catch {}
    if (existsSync(STOP) && /not logged in/i.test(readFileSync(STOP, "utf8"))) unlinkSync(STOP); // that STOP is now resolved
    await setStatus("connected", account ? `Logged in as @${account}.` : "Logged in.", { account: account ?? "(logged in)" });
    log(`connected${account ? " as @" + account : ""}`);
  } finally {
    await ctx.close().catch(() => {});
    busyConnecting = false;
  }
}

/* ---------- the sender ---------- */
function startSender() {
  log("starting dmbot");
  child = spawn("npx", ["tsx", "src/dmbot.ts"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: process.env });
  child.on("exit", async (code) => {
    child = null;
    log(`dmbot exited with code ${code}`);
    if (code === 3 && existsSync(STOP)) {
      const why = readFileSync(STOP, "utf8").split("\n")[1] ?? "stopped";
      const loggedOut = /not logged in|logged out|redirected to .*login/i.test(why);
      await pool.query("UPDATE dm_control SET desired='stopped' WHERE id=1");
      await setStatus(loggedOut ? "not connected" : "blocked", why);
      return;
    }
    if (code === 0 || code === 130) { errorStreak = 0; return; }
    errorStreak++;
    retryAt = Date.now() + 20 * 60_000;
    if (errorStreak >= 3) {
      await pool.query("UPDATE dm_control SET desired='stopped' WHERE id=1");
      await setStatus("error", "The sender crashed 3 times in a row — see ~/leadflow/logs/dmbot-*.log.");
    }
  });
}

async function tick() {
  await pool.query("UPDATE dm_control SET agent_seen_at=now() WHERE id=1");
  const ctl = (await pool.query("SELECT * FROM dm_control WHERE id=1")).rows[0];

  if (lastConnectSeq < 0) { lastConnectSeq = ctl.connect_seq; writeFileSync(STATE, String(lastConnectSeq)); }
  if (ctl.connect_seq > lastConnectSeq && !busyConnecting) {
    lastConnectSeq = ctl.connect_seq; writeFileSync(STATE, String(lastConnectSeq));
    connect().catch(async (e) => { busyConnecting = false; log("connect failed:", e?.message); await setStatus("not connected", `Couldn't open the login window: ${String(e?.message ?? e).slice(0, 140)}`); });
    return;
  }
  if (busyConnecting) return;

  if (ctl.desired !== "running") {
    if (child) { log("stop requested"); child.kill("SIGINT"); }
    if (["sending", "waiting", "done for today"].includes(ctl.status)) await setStatus("stopped", "Paused from the dashboard.");
    return;
  }

  // desired = running
  if (existsSync(STOP)) {
    if (ctl.resume_ok) { unlinkSync(STOP); await pool.query("UPDATE dm_control SET resume_ok=false WHERE id=1"); log("STOP cleared by explicit resume"); }
    else {
      const why = readFileSync(STOP, "utf8").split("\n")[1] ?? "stopped";
      await pool.query("UPDATE dm_control SET desired='stopped' WHERE id=1");
      await setStatus(/not logged in|redirected to .*login/i.test(why) ? "not connected" : "blocked", why);
      return;
    }
  }
  if (child) { if (ctl.status !== "sending") await setStatus("sending", "Sending — spread across the day."); return; }

  const h = hourInTZ();
  if (h < START_HOUR || h >= END_HOUR) { await setStatus("waiting", `Sends between ${START_HOUR}am and ${END_HOUR - 12}pm Eastern. It will start on its own.`); return; }
  const b = await budget();
  if (b.remaining <= 0) { await setStatus("done for today", `${b.today} of ${b.cap} sent today. Picks up again tomorrow at ${START_HOUR}am Eastern.`); return; }
  if (Date.now() < retryAt) { await setStatus("waiting", `Retrying after an error at ${new Date(retryAt).toLocaleTimeString()}.`); return; }

  startSender();
  await setStatus("sending", "Sending — spread across the day.");
}

async function main() {
  await init();
  log("dmagent up");
  for (;;) {
    try { await tick(); } catch (e: any) { log("tick error:", e?.message); }
    await sleep(10_000);
  }
}
process.on("SIGTERM", () => { child?.kill("SIGINT"); process.exit(0); });
main();
