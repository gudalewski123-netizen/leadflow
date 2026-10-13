/**
 * Reading an Instagram DM thread's text — kept apart from dmbot.ts so it can
 * be tested without launching a browser.
 */
import { OPENERS, BUMPS } from "./variants.js";

export const UI_NOISE = /^(seen|delivered|sent|active( now| \d+[mhd] ago)?|today|yesterday|message\.{0,3}|enter|send|like|instagram|view profile|\d{1,2}:\d{2}( ?[ap]m)?|(mon|tue|wed|thu|fri|sat|sun)[a-z]*( \d{1,2}:\d{2}.*)?|[a-z]{3} \d{1,2}, \d{4}.*)$/i;

/**
 * Has the other side said anything since our last message?
 * Returns "reply" only when OUR previous message is found in the thread AND
 * real text follows it — the safe direction: a misread can only ever skip a
 * follow-up, never send one on top of a reply.
 */
export function threadState(threadText: string, ourPrevious: string, handle: string): "reply" | "quiet" | "unknown" {
  const lines = threadText.split("\n").map((s) => s.trim()).filter(Boolean);
  const idx = lines.lastIndexOf(ourPrevious);
  if (idx < 0) return "unknown";
  const after = lines.slice(idx + 1).filter((l) => l.length > 1 && !UI_NOISE.test(l)
    && !l.toLowerCase().includes(handle.toLowerCase()) && !OPENERS.includes(l) && !BUMPS.includes(l));
  return after.length ? "reply" : "quiet";
}

/** Lines of a thread that look like real messages (not UI chrome, not the handle). */
export function realLines(threadText: string, handle: string): string[] {
  return threadText.split("\n").map((s) => s.trim())
    .filter((l) => l.length > 1 && !UI_NOISE.test(l) && !l.toLowerCase().includes(handle.toLowerCase()));
}
