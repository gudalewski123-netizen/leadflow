/**
 * Opener variation.
 *
 * WHY THIS FILE EXISTS — read before "simplifying" it back to one string.
 *
 * Instagram's spam classifier does not primarily count messages. It looks at
 * whether the SAME text is going to many accounts that never interacted with
 * you. Before this file, `leads.message` held ONE universal opener on 157,181
 * rows and the dashboard's fallbacks were a further two fixed paragraphs — so
 * every cold DM leaving this pipeline was one of three exact strings. That is
 * the single strongest spam fingerprint an account can emit, and no per-day
 * cap compensates for it: an account sending five identical cold DMs is more
 * exposed than one sending fifty varied ones that get replies.
 *
 * So the lever here is text diversity, not volume.
 *
 * Rules every variant must obey:
 *  1. NEVER assert anything about their website. The no-website scan is often
 *     wrong (link-in-bio pages hide real sites), and opening by telling a
 *     business something false about their own page loses the reply outright.
 *     Ask a question that cannot be wrong instead.
 *  2. No business-name interpolation. IG display names are junk
 *     ("MobileDetailingMiami#[EST.2020]") and reading one back is worse than
 *     using none.
 *  3. One short question. Message one only has to earn a REPLY — that is also
 *     what pulls the thread out of the Message Requests folder. The offer
 *     comes after they answer.
 *  4. Vary SENTENCE SHAPE, not just synonyms. Swapping "Hey" for "Hi" on a
 *     fixed skeleton still hashes to near-identical text.
 */

/* Touch 1 — the cold open. */
export const OPENERS: string[] = [
  "Hey! Quick question — do you have a website for your business?",
  "Hey, quick one — is there a website for the business anywhere?",
  "Hi! Do you guys have a site up, or is it mostly Instagram right now?",
  "Hey — quick question, are you running a website alongside the Instagram?",
  "Hi there, do you have a website for the business?",
  "Hey! Is there a site for you guys, or is Instagram the main thing?",
  "Quick question — do you have a website up for the business?",
  "Hey, do you guys have a website, or do people just reach you through here?",
  "Hi! Random question — is there a website for the business?",
  "Hey — do you have a site for the business these days?",
  "Hi, quick question for you — is there a website for the business anywhere?",
  "Hey! Do you guys run a website, or is it all through Instagram?",
];

/* Touch 2 (~day 4) — a bump, not a re-pitch. Instagram genuinely buries cold
   DMs in Message Requests, so naming that is honest and gives them a reason
   to have missed it that isn't "you ignored me". */
export const BUMPS: string[] = [
  "Hey, floating this back up in case it got buried — still curious whether you have a site.",
  "No worries if you missed this one — do you have a website for the business?",
  "Bumping this in case it landed in your requests folder — is there a site for you guys?",
  "Hey again — Instagram hides these pretty well, so just checking it reached you.",
  "Following up once in case this got lost — do you have a website up?",
  "Hey, this may have gone to requests — any website for the business?",
];

/* Touch 3 (~day 9) — the last one. Always give them a clean out. A third
   message with no exit is what gets an account reported, and the report rate
   is a far bigger input to a restriction than the send count. */
export const CLOSERS: string[] = [
  "Last one from me — if a website isn't something you need, all good, I'll leave you to it.",
  "I'll stop here. If it's ever useful, I build sites for local businesses — either way, good luck with it.",
  "Final one, promise. If you're all set on the website front, no worries at all.",
  "Won't keep bugging you — if it's not a priority right now that's completely fine.",
];

/**
 * Deterministic pick: the same lead always gets the same text.
 *
 * Load-bearing. If this were random, reopening a card would re-roll the
 * message, and a lead could be bumped on day 4 with the text it was already
 * sent on day 1. Keying on the lead id makes the choice stable without
 * storing it, which matters because assigning a variant to 157k existing rows
 * by UPDATE is exactly the bulk loop this pipeline is meant to avoid.
 *
 * The id is mixed before the modulo: ids arrive in insertion order, so raw
 * `id % n` would hand every lead from one scraped city a narrow slice of the
 * set, and a city is often worked in one sitting.
 */
function pick(list: string[], id: number, salt: number): string {
  let h = (id ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return list[h % list.length];
}

/** The message for a lead at its NEXT touch. touches = how many already sent. */
export function openerFor(id: number, touches = 0): string {
  if (touches <= 0) return pick(OPENERS, id, 0x9e37);
  if (touches === 1) return pick(BUMPS, id, 0x85eb);
  return pick(CLOSERS, id, 0xc2b2);
}

/** Which variant went out, for the outreach log. Lets reply rate be read per text. */
export function variantTag(id: number, touches = 0): string {
  const list = touches <= 0 ? OPENERS : touches === 1 ? BUMPS : CLOSERS;
  const text = openerFor(id, touches);
  return `t${Math.min(touches + 1, 3)}v${list.indexOf(text)}`;
}
