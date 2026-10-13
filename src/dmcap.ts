/**
 * The daily DM budget — one source of truth for the bot AND the dashboard.
 *
 * Gregg, 2026-10-13: "the cap should be at 60 DMs a day". 60 is the HARD
 * ceiling. Under it sits a warm-up, on by default: an account that goes from
 * a handful of manual DMs to 60 automated ones overnight is the textbook
 * action-block trigger, so the cap climbs 20 → 40 → 60 over the first week of
 * bot sending. DM_WARMUP=0 turns that off and goes straight to the ceiling.
 *
 * The count covers EVERY Instagram send recorded in `outreach` today —
 * dashboard "mark sent" clicks as well as the bot — so a busy manual morning
 * cannot be added on top of a full bot day.
 */
import { pool } from "./db.js";

export const HARD_CAP = Math.max(1, Number(process.env.DM_DAILY_CAP ?? 60));
export const WARMUP = process.env.DM_WARMUP !== "0";
export const TZ = "America/New_York"; // the leads are US businesses; their day, not ours

/** Cap for today given the date of the bot's first live send (null = never sent). */
export function capFor(firstBotSend: Date | null, now = new Date()): number {
  if (!WARMUP) return HARD_CAP;
  const days = firstBotSend ? Math.floor((now.getTime() - firstBotSend.getTime()) / 86_400_000) : 0;
  const step = days < 3 ? 20 : days < 6 ? 40 : 60;
  return Math.min(HARD_CAP, step);
}

export async function budget() {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE channel='ig'
         AND sent_at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1))::int AS today,
       COUNT(*) FILTER (WHERE channel='ig' AND sent_at >= now() - interval '1 hour')::int AS last_hour,
       MIN(sent_at) FILTER (WHERE note LIKE '%dmbot%') AS first_bot_send
     FROM outreach`,
    [TZ]
  );
  const r = rows[0];
  const cap = capFor(r.first_bot_send ? new Date(r.first_bot_send) : null);
  return { today: r.today as number, lastHour: r.last_hour as number, cap, remaining: Math.max(0, cap - r.today), firstBotSend: r.first_bot_send };
}

/** Current hour (0-23) in the leads' timezone. */
export function hourInTZ(d = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(d));
}
