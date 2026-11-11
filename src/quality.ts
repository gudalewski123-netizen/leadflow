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
export const NOT_LOCAL = /\b(car\s?wash|bin\s?blasters|magazine|academy|training|course|supply|supplies|official|news|podcast|expo|association|marketing|agency|digital|seo|leads?\s?gen|snooker|billiards?|pool\s?hall|pool\s?tables?|distributor|wholesale|store|shop\s?now|realty|realtor)\b/i;   // not 'show'/'sales': "Show Ready Detailing", "Fence Sales & Installation"
/** country words only — Manchester CT / London KY / Birmingham AL are US towns */
export const NOT_US = /(\b(uk|u\.k\.|united kingdom|england|scotland|wales|ireland|canada|ontario|alberta|british columbia|australia|nsw|new zealand|dubai|abu\s?dhabi)\b|\.ca\b|🇬🇧|🇨🇦|🇦🇺|🇮🇪|🇳🇿|🇲🇾|🇫🇷|🇵🇱|🇩🇪|🇲🇽|🇧🇷|🇮🇳|🇵🇭|🇳🇬|🇬🇭)/i;
/** Cyrillic, Arabic, Thai, Devanagari, CJK, Hangul in the NAME (Russian-language detailers, 餘光角落) */
export const FOREIGN_SCRIPT = /[Ѐ-ӿ؀-ۿ฀-๿ऀ-ॿ぀-ヿ一-鿿가-힯\u3100-\u312f]/;   // + Bopomofo (11-10 'ㄇㄇ')
/** UK/foreign trade vocabulary — matched inside handles too ("alphavaleting", "southmanc_handyman") */
export const FOREIGN_WORDS = /(valeting|jet\s?wash|groundworks|tarmac|\bltd\b|gardening\s?services|garden\s?maintenance|\bmanc\b|southmanc|landscapesuk|\buk$|kontraktor|bangunan|arsitek|\bjasa\b|tukang|wiltshire|digbeth|birmingham\s?uk|\bessex\b|\bsurrey\b|\bdevon\b|cornwall|cymru|mistri|karigar|thekedar|\.sby\b|\.jkt\b|\.bdg\b)/i;
/** artists filed under "painting" (murals, airbrush, face painting, portfolios) */
export const ARTIST = /(painted\s?by|paintedby|painted_|painting\s?in\s?the|\bart\b|\barts\b|artist|airbrush|mural|henna|face\s?paint|facepaint|sculpt|canvas|gallery|\bpaintings\b|illustrat|oil\s?painting|celestial|lukisan|diamond\s?(painting|kristal)|porcelain)/i;   // 11-10: oil-painting artist, diamond-painting shop
/** …unless it plainly says contractor ("Gekon Construction | Renovations | Paintings", "Art E Colour Painting & Renovations") */
export const CONTRACTOR = /(construction|renovation|remodel|contractor|drywall|commercial|residential|interior|exterior|cabinet|handyman)/i;
/** a bio that says it is a chain / franchise / national company (Gregg 2026-11-09: "make sure none of these are
    monopolies or chains or just famous people") */
export const CHAIN_BIO = /(\b\d{1,3}\+?\s+(locations|branches|offices|stores)\b|\bnationwide\b|\bfranchis(e|es|ing|ee)\b|\bcorporate\s+(office|headquarters|hq)\b|\bheadquartered\b|\b(across|throughout)\s+(the\s+)?(us|usa|u\.s\.|country|nation|america)\b|\ball\s+50\s+states\b|\bnational\s+(leader|brand|company)\b|\bnyse\b|\bnasdaq\b|\bfortune\s+500\b|\bnow\s+in\s+\d+\s+(states|cities)\b|\bfind\s+a\s+location\b|\blocations?\s+near\s+you\b)/i;
/** Indian state vehicle codes / regions that slipped through as "plumbing" (sandhu_plumbing_pb05) */
export const FOREIGN_HANDLE = /(^|[._])(pb|hr|dl|up|mh|rj|gj)\d{2}($|[._])|(^|[._])ltd($|[._])|sanitary|santexnika|elektrika|fortunetown|nettoyage|r[ée]novation\s+cuir|\bfolie\b|ochrona|lakieru|cuidado|mantenimiento|setapak|sijangkang|selangor|kuala|malaysia|\.fr$|jaat|sirsa|chopta|punjab|haryana|ludhiana|amritsar|jalandhar|chandigarh|mumbai|delhi|lahore|karachi|nigeria|lagos|ghana|kenya|philippines|manila|jamaica|kingston\s?ja|\.in$|nuevo\s?laredo|[İıŞşĞğ]/i;   // 11-09: .in handle, Mexico border town, Turkish letters

/** above this they were bands, YouTubers, influencers — not a local trade */
export const MAX_LOCAL_FOLLOWERS = 15000;

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, "");

export interface LeadLike {
  name?: string | null; ig_handle?: string | null; niche?: string | null;
  ig_followers?: number | null; ig_link?: string | null; bio?: string | null;
  /** Instagram blue check (hunt time only) */
  verified?: boolean | null;
}

export function junkReason(l: LeadLike, strict = false): string {
  const name = l.name ?? "", handle = l.ig_handle ?? "", both = `${name} ${handle}`;
  const link = String(l.ig_link ?? "");
  if (isFranchise(name, handle)) return "franchise";
  if (NOT_US.test(name) || FOREIGN_SCRIPT.test(name) || FOREIGN_WORDS.test(both) || FOREIGN_HANDLE.test(both) || FOREIGN_HANDLE.test(l.bio ?? "")
      || /wa\.me\/(?!1\d{10})\+?\d{6,}/.test(link)) return "not US";
  if (NOT_LOCAL.test(norm(name))) return "not a local business";
  if (CHAIN_BIO.test(norm(l.bio))) return "chain / franchise (bio)";
  // a blue check on a real following = a public figure or a big brand; a small shop that pays for Meta Verified
  // with a few hundred followers is still a fine lead
  if (l.verified && (l.ig_followers ?? 0) >= 2000) return "famous / verified account";
  if (l.niche === "painting" && ARTIST.test(`${norm(name)} ${handle.replace(/[._]/g, " ")}`)
      && !CONTRACTOR.test(both)) return "artist, not a painting contractor";
  if (!strict) return "";
  if ((l.ig_followers ?? 0) > MAX_LOCAL_FOLLOWERS) return "creator/media account (follower count)";
  // reads as this trade? (name/handle/bio). A person's name with no trade word anywhere = a personal or
  // sales account ("Jordan Burns @jburns258", "sales @roofingsaless") — fancy Unicode fonts normalised first
  if (l.niche && !isRelevant(l.niche, norm(name), handle, l.bio ?? null)) return "not this trade / personal account";
  return "";
}
