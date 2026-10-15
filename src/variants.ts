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
 *  0. 2026-10-15: only say what is TRUE. "You don't have a website" went to ~12 businesses whose
 *     Instagram bio linked their own site (IG leads never had a website lookup). Openers now say we
 *     didn't SEE one on their Instagram, and only go to leads with no website on file after
 *     sitecheck.ts records bio-link websites.
 *  1. Gregg, 2026-10-13: the openers are in HIS voice — the message he has
 *     sent by hand many times: "hi I hope all is well, I was looking at your
 *     instagram page and noticed that you didn't have a website. I'd love to
 *     create you a free demo if you're interested?" It states they have no
 *     website, so it is only for leads with NO website on record (the bot's
 *     whole queue on 10-13: 787/787). Leads that do have a site get
 *     SITE_OPENERS, which never say that.
 *  2. No business-name interpolation. IG display names are junk
 *     ("MobileDetailingMiami#[EST.2020]") and reading one back is worse than
 *     using none.
 *  3. Vary SENTENCE SHAPE, not just synonyms. Swapping "Hey" for "Hi" on a
 *     fixed skeleton still hashes to near-identical text.
 *  4. One line each — the bot finds its own earlier message in the thread by
 *     exact line match, so no line breaks.
 */

/* Touch 1 — the cold open, for leads with NO website. */
export const OPENERS: string[] = [
  "Hi, I hope all is well! I was looking at your Instagram page and didn't see a website for the business. I'd love to create you a free demo if you're interested?",
  "Hey, hope all is well! I came across your Instagram and didn't see a website linked. I'd love to put together a free demo site for you if you're interested?",
  "Hi! Hope you're doing well. I was checking out your Instagram page and couldn't find a website for the business — I'd be happy to build you a free demo if you're interested.",
  "Hey, I hope all is well with you! I was looking through your Instagram and didn't see a website. If you're interested, I'd love to make you a free demo.",
  "Hi there, hope all is well! I didn't see a website on your Instagram for the business. I'd love to create a free demo for you — would you be interested?",
  "Hey! Hope business is going well. I was on your Instagram page and didn't see a website linked — I'd love to put together a free demo for you if you're interested?",
  "Hi, hope all is well! I came across your page on Instagram and didn't spot a website. Would you like me to create a free demo for you? No strings attached.",
  "Hey, I hope all is well! I was looking at your Instagram and didn't see a website yet. I'd love to build you a free demo if that's something you'd be interested in?",
];

/* Touch 1 for leads that DO have a website (dashboard only — never sent by the bot). */
export const SITE_OPENERS: string[] = [
  "Hi, I hope all is well! I was looking at your Instagram and your website, and I'd love to create you a free demo of a refreshed site if you're interested?",
  "Hey, hope all is well! I came across your page and had a look at your website — I'd love to put together a free demo of a new version for you if you're interested?",
  "Hi there, hope you're doing well! I checked out your Instagram and website and had a few ideas — I'd love to make you a free demo if you're interested?",
];

/* Touch 2 (~day 4) — a bump, not a re-pitch. Instagram genuinely buries cold
   DMs in Message Requests, so naming that is honest. */
export const BUMPS: string[] = [
  "Hey, just following up in case this got buried in your requests — I'd still love to make you a free demo website if you're interested!",
  "Hi again! Instagram hides these sometimes, so just checking this reached you — happy to put together a free website demo for you.",
  "Hope all is well! Just bumping this up — the free website demo offer still stands if you're interested.",
  "Hey, following up once in case you missed it — would you like me to create a free website demo for your business?",
];

/* Touch 3 (~day 9) — the last one. Always give them a clean out. A third
   message with no exit is what gets an account reported, and the report rate
   is a far bigger input to a restriction than the send count. */
export const CLOSERS: string[] = [
  "Last message from me — if a website isn't something you need right now, no worries at all. Wishing you all the best with the business!",
  "I'll leave it here. If you ever want that free website demo, just send me a message. All the best!",
  "Final one, I promise! If you're all set, no problem at all — the free demo offer is always open.",
];

/* What earlier versions sent (by hand from the dashboard, before 2026-10-13).
   Kept ONLY so the bot recognises a thread that already has one of them and
   doesn't open a second time. Never sent again. */
export const LEGACY: string[] = [
  "Hi, I hope all is well! I was looking at your Instagram page and noticed that you don't have a website. I'd love to create you a free demo if you're interested?",
  "Hey, hope all is well! I came across your Instagram and noticed there's no website linked. I'd love to put together a free demo site for you if you're interested?",
  "Hi! Hope you're doing well. I was checking out your Instagram page and saw you don't have a website yet — I'd be happy to build you a free demo if you're interested.",
  "Hey, I hope all is well with you! I was looking through your Instagram and noticed you don't have a website. If you're interested, I'd love to make you a free demo.",
  "Hi there, hope all is well! I noticed on your Instagram that you don't have a website for the business. I'd love to create a free demo for you — would you be interested?",
  "Hey! Hope business is going well. I was on your Instagram page and noticed you don't have a website — I'd love to put together a free demo for you if you're interested?",
  "Hi, hope all is well! I came across your page on Instagram and saw there's no website. Would you like me to create a free demo for you? No strings attached.",
  "Hey, I hope all is well! I was looking at your Instagram and noticed you don't have a website yet. I'd love to build you a free demo if that's something you'd be interested in?",
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

/** Every line we have ever sent, for spotting our own messages in a thread. */
export const OURS: string[] = [...OPENERS, ...SITE_OPENERS, ...BUMPS, ...CLOSERS, ...LEGACY];

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
export function openerFor(id: number, touches = 0, hasSite = false): string {
  if (touches <= 0) return pick(hasSite ? SITE_OPENERS : OPENERS, id, 0x9e37);
  if (touches === 1) return pick(BUMPS, id, 0x85eb);
  return pick(CLOSERS, id, 0xc2b2);
}

/** Which variant went out, for the outreach log. Lets reply rate be read per text. */
export function variantTag(id: number, touches = 0, hasSite = false): string {
  const list = touches <= 0 ? (hasSite ? SITE_OPENERS : OPENERS) : touches === 1 ? BUMPS : CLOSERS;
  const text = openerFor(id, touches, hasSite);
  return `t${Math.min(touches + 1, 3)}${hasSite && touches <= 0 ? "s" : ""}v${list.indexOf(text)}`;
}
