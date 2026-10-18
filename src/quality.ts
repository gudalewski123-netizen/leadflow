/**
 * ONE quality gate for every lead source (2026-10-18). Until today the rules lived in three places —
 * apifyhunt's SKIP regex + isFranchise + isRelevant at hunt time, sweep.ts for old rows, and my hand
 * review of the "No site" list (Gregg: "make sure the leads … don't have chains and are good leads").
 * The hand review kept finding the same kinds of junk, so they are rules now, used by the hunter (before
 * a row is stored) and by sweep.ts (for rows stored before a rule existed).
 *
 * junkReason() returns why a lead is not a good outreach lead, or "" if it passes.
 *   strict = the full check for the outreach queues (also: follower cap, must read as THIS trade)
 */
import { isFranchise } from "./score.js";
import { isRelevant } from "./relevance.js";

/** aggregators, media, suppliers, agencies, pool HALLS — not a local service business */
export const NOT_LOCAL = /\b(magazine|academy|training|course|supply|supplies|official|news|podcast|expo|association|marketing|agency|digital|seo|leads?\s?gen|snooker|billiards?|pool\s?hall|pool\s?tables?|distributor|wholesale|store|shop\s?now|realty|realtor)\b/i;   // not 'show'/'sales': "Show Ready Detailing", "Fence Sales & Installation"
/** country words only — Manchester CT / London KY / Birmingham AL are US towns */
export const NOT_US = /(\b(uk|u\.k\.|united kingdom|england|scotland|wales|ireland|canada|ontario|alberta|british columbia|australia|nsw|new zealand|dubai|abu\s?dhabi)\b|\.ca\b|🇬🇧|🇨🇦|🇦🇺|🇮🇪|🇳🇿)/i;
/** Cyrillic, Arabic, Thai, Devanagari, CJK, Hangul in the NAME (Russian-language detailers, 餘光角落) */
export const FOREIGN_SCRIPT = /[Ѐ-ӿ؀-ۿ฀-๿ऀ-ॿ぀-ヿ一-鿿가-힯]/;
/** UK/foreign trade vocabulary — matched inside handles too ("alphavaleting", "southmanc_handyman") */
export const FOREIGN_WORDS = /(valeting|jet\s?wash|groundworks|tarmac|\bltd\b|gardening\s?services|garden\s?maintenance|\bmanc\b|southmanc|landscapesuk|\buk$|kontraktor|bangunan|arsitek|\bjasa\b|tukang|wiltshire|digbeth|birmingham\s?uk|\bessex\b|\bsurrey\b|\bdevon\b|cornwall|cymru|mistri|karigar|thekedar|\.sby\b|\.jkt\b|\.bdg\b)/i;
/** artists filed under "painting" (murals, airbrush, face painting, portfolios) */
export const ARTIST = /(\bart\b|\barts\b|artist|airbrush|mural|henna|face\s?paint|facepaint|sculpt|canvas|gallery|\bpaintings\b|illustrat)/i;
/** …unless it plainly says contractor ("Gekon Construction | Renovations | Paintings", "Art E Colour Painting & Renovations") */
export const CONTRACTOR = /(construction|renovation|remodel|contractor|drywall|commercial|residential|interior|exterior|cabinet|handyman)/i;
/** above this they were bands, YouTubers, influencers — not a local trade */
export const MAX_LOCAL_FOLLOWERS = 15000;

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, "");

export interface LeadLike {
  name?: string | null; ig_handle?: string | null; niche?: string | null;
  ig_followers?: number | null; ig_link?: string | null; bio?: string | null;
}

export function junkReason(l: LeadLike, strict = false): string {
  const name = l.name ?? "", handle = l.ig_handle ?? "", both = `${name} ${handle}`;
  const link = String(l.ig_link ?? "");
  if (isFranchise(name, handle)) return "franchise";
  if (NOT_US.test(name) || FOREIGN_SCRIPT.test(name) || FOREIGN_WORDS.test(both)
      || /wa\.me\/(?!1\d{10})\+?\d{6,}/.test(link)) return "not US";
  if (NOT_LOCAL.test(norm(name))) return "not a local business";
  if (l.niche === "painting" && ARTIST.test(`${norm(name)} ${handle.replace(/[._]/g, " ")}`)
      && !CONTRACTOR.test(both)) return "artist, not a painting contractor";
  if (!strict) return "";
  if ((l.ig_followers ?? 0) > MAX_LOCAL_FOLLOWERS) return "creator/media account (follower count)";
  // reads as this trade? (name/handle/bio). A person's name with no trade word anywhere = a personal or
  // sales account ("Jordan Burns @jburns258", "sales @roofingsaless") — fancy Unicode fonts normalised first
  if (l.niche && !isRelevant(l.niche, norm(name), handle, l.bio ?? null)) return "not this trade / personal account";
  return "";
}
