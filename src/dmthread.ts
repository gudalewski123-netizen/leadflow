/**
 * Reading an Instagram DM thread's text — kept apart from dmbot.ts so it can
 * be tested without launching a browser.
 */
import { OURS } from "./variants.js";

export const UI_NOISE = /^(seen|delivered|sent|active( now| \d+[mhd] ago)?|today|yesterday|message\.{0,3}|enter|send|like|instagram|view profile|\d{1,2}:\d{2}( ?[ap]m)?|(mon|tue|wed|thu|fri|sat|sun)[a-z]*( \d{1,2}:\d{2}.*)?|[a-z]{3} \d{1,2}, \d{4}.*)$/i;

/**
 * Has the other side said anything since our last message?
 * Returns "reply" only when OUR previous message is found in the thread AND
 * real text follows it — the safe direction: a misread can only ever skip a
 * follow-up, never send one on top of a reply.
 */
export function threadState(threadText: string, ourPrevious: string, handle: string): "reply" | "quiet" | "unknown" {
  const lines = afterCard(threadText.split("\n").map((s) => s.trim()).filter(Boolean));
  const idx = lines.lastIndexOf(ourPrevious);
  if (idx < 0) return "unknown";
  const after = lines.slice(idx + 1).filter((l) => l.length > 1 && !UI_NOISE.test(l)
    && !isProfileLine(l, handle) && !OURS.includes(l));
  return after.length ? "reply" : "quiet";
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The profile card at the top of an empty chat shows the handle AND the display
    name ("Scorpion Sealcoating" for @scorpionsealcoating). The name is not a
    message — on 2026-10-13 it was read as one and a fresh lead got marked
    "replied". A line is the card's if, squashed, it is the handle or sits
    inside it / contains it. */
export function isProfileLine(l: string, handle: string): boolean {
  const a = squash(l), h = squash(handle);
  return l.toLowerCase().includes(handle.toLowerCase()) || (a.length >= 4 && (h.includes(a) || a.includes(h)));
}

/** The chat opens with a profile card (photo, display name, "handle ·
    Instagram", then a "View profile" button); messages only come after it. */
function afterCard(lines: string[]): string[] {
  const i = lines.findIndex((l) => /^view profile$/i.test(l));
  return i >= 0 ? lines.slice(i + 1) : lines;
}

/** Lines of a thread that look like real messages (not UI chrome, not the profile card). */
export function realLines(threadText: string, handle: string): string[] {
  return afterCard(threadText.split("\n").map((s) => s.trim()))
    .filter((l) => l.length > 1 && !UI_NOISE.test(l) && !isProfileLine(l, handle));
}
