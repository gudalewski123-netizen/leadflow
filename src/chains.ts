/**
 * Chains by NAME (2026-11-09, Gregg: "make sure none of these are monopolies or chains or just famous people").
 *
 * The franchise list in score.ts only knows brands someone already typed in. A chain we have never heard of
 * still gives itself away in our own data: the same brand name, stored for several different cities in
 * different states ("Rooter Hero Phoenix", "Rooter Hero San Diego", "Rooter Hero Las Vegas").
 *
 * The signal has to be the FULL brand name. A shared adjective ("elite", "premier", "all star") or a plain
 * description ("mobile detailing", "plumbing services") is what every independent calls itself — matching on
 * those buried real prospects in the 2026-09-27 chain scan, so keys made only of trade words and stock
 * adjectives are never treated as a brand.
 */
import { STATE_CITIES } from "./cities.js";

const STATE_NAMES = "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming carolina dakota hampshire jersey mexico york rhode island west north south new";
const PLACE_WORDS = new Set<string>([
  ...STATE_NAMES.split(" "),
  ...Object.keys(STATE_CITIES).map((s) => s.toLowerCase()),
  ...Object.values(STATE_CITIES).flat().flatMap((c) => c.toLowerCase().split(/\s+/)),
  "county", "valley", "metro", "area", "bay", "city", "springs", "beach", "dfw", "nyc", "la", "atl", "phx", "vegas", "socal", "norcal",
]);
/** words that say WHAT the business does or how good it is — never a brand on their own */
const GENERIC = new Set(("llc inc co company corp corporation services service solutions group pros pro professional professionals " +
  "the and of in & best top quality reliable affordable premier elite prime precision superior express expert experts " +
  "american all star stars diamond gold golden first class family local your my a1 plus " +
  "plumbing plumber plumbers rooter drain drains sewer electric electrical electrician electricians hvac heating cooling air " +
  "conditioning ac mechanical moving movers relocation haul hauling junk removal detailing detail detailer auto mobile car " +
  "wash ceramic coating epoxy floors flooring concrete roofing roofer roofers roof painting painters painter handyman " +
  "landscaping landscape lawn care tree fence fencing pool pools window cleaning cleaners gutter gutters pressure washing " +
  "power sealcoating paving construction contractors contractor home homes repair repairs install installation llc. " +
  "four seasons season evergreen legacy heritage southern northern eastern western coastal mountain river lake lakeside " +
  "green blue red eco true pure peak summit pinnacle liberty patriot patriots freedom eagle eagles lion titan apex alpha omega " +
  "pristine perfect hometown neighborhood sunshine sunrise sunset oak pine cedar royal crown king kings ace pioneer frontier " +
  "trusted honest integrity reliance dependable a+ a-1 1st one two 2 3 brothers bros son sons and dad's & united national " +
  "demolition remodeling remodel luxury decorative builders builder building drywall siding coatings coating cutting lifting " +
  "systems commercial residential custom complete modern signature premium handy helpers helper man maintenance property " +
  "softwash soft garden gardens outdoor outdoors lighting doors door windows sheet metal seamless supply products " +
  "school spring house shades world shine live wedding art gallery botanical organic nature comfort climate control " +
  "septic tank emergency landscapes heart clean team squeaky decks deck sand gravel champion prestige regal straight line call " +
  "polished solution solutions specialists specialist " +
  "hair salon salons hairstylist stylist barber barbershop nails nail spa beauty paint paints decorating design designs energy improvement improvements exteriors interiors")
  .split(/\s+/));

export function brandKey(name: string | null | undefined): string {
  let s = (name ?? "").normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase();
  s = s.split(/\s[|•·–—-]\s|\s(?:of|in|serving)\s|[|•·(]/)[0];         // "Brand of Tucson", "Brand | Tucson AZ"
  const words = s.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).filter((w) => !PLACE_WORDS.has(w));
  return words.join(" ");
}
/** true when the key contains at least one word that is a NAME, not a description */
/** how many words in the key are a NAME rather than a description */
export function nameWords(key: string): number {
  return key.split(" ").filter((x) => x && !GENERIC.has(x) && x.length >= 3).length;
}
export function isBrandish(key: string): boolean {
  return nameWords(key) >= 1 && key.length >= 5;
}

/** brand keys that appear for 3+ different places in 2+ states */
export function findChains(rows: { name: string | null; state: string | null; area: string | null }[]): Map<string, number> {
  const by = new Map<string, { places: Set<string>; states: Set<string> }>();
  for (const r of rows) {
    const k = brandKey(r.name);
    if (!isBrandish(k)) continue;
    const g = by.get(k) ?? { places: new Set(), states: new Set() };
    g.places.add((r.area ?? r.state ?? "").toLowerCase()); if (r.state) g.states.add(r.state);
    by.set(k, g);
  }
  const out = new Map<string, number>();
  // one-word keys are often a person's first name or surname ("jason", "daniel", "poole") — they need more
  // places before they count as a brand (naturalawn 14, dabella 21, acculevel 8, rooterman 7 still pass)
  for (const [k, g] of by) {
    // ONE name word is often a surname or a first name ("garcia roofing", "perez landscaping", "jason") shared by
    // unrelated independents — it needs 6+ places in 3+ states. Two or more name words is a real brand phrase.
    const one = nameWords(k) === 1;
    if (g.places.size >= (one ? 6 : 3) && g.states.size >= (one ? 3 : 2)) out.set(k, g.places.size);
  }
  return out;
}
