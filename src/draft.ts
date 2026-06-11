/**
 * Draft a personalized opener for each lead (claude CLI if available, template fallback).
 * Usage: npm run draft
 */
import { execFileSync } from "node:child_process";
import { pool, init, Lead } from "./db.js";

await init();
const leads = (
  await pool.query(
    "SELECT * FROM leads WHERE message IS NULL AND status = 'new' AND ig_handle IS NOT NULL"
  )
).rows as Lead[];

console.log(`Drafting messages for ${leads.length} leads...`);

let claudeAvailable = true;
try {
  execFileSync("claude", ["--version"], { stdio: "pipe" });
} catch {
  claudeAvailable = false;
  console.log("claude CLI not found — using templates only.");
}

function template(l: Lead): string {
  const first = l.name.split(/\s+/).slice(0, 3).join(" ");
  if (l.category === "no_site")
    return `Hey! I build websites for ${l.niche ?? "local"} businesses around ${l.area}. Noticed ${first} doesn't have a site yet — a simple one-pager with your services, photos and a contact/booking button usually pays for itself fast. I can send over a free mockup with no commitment if you're curious. Either way, keep up the great work!`;
  if (l.category === "bad_site")
    return `Hey! I was checking out ${first} and noticed your website ${l.site_notes?.includes("mobile") ? "doesn't display right on phones" : "could use a refresh"} — most of your customers are finding you on their phone, so that's costing you calls. I redesign sites for ${l.niche ?? "local"} businesses around ${l.area}. Happy to send a free before/after mockup if you want to see what it could look like. No pressure either way!`;
  return `Hey! I build and modernize websites for ${l.niche ?? "local"} businesses around ${l.area}. If you ever want a refresh of your current site or new features like online booking, I'd be glad to send over some ideas. Keep up the great work!`;
}

function aiDraft(l: Lead): string | null {
  const prompt = `Write a short, casual Instagram DM (max 60 words, no emojis beyond one max, no hashtags) from a freelance web designer reaching out to this local business. Friendly, zero pressure, one clear offer of a free mockup. Do not sound like spam or use hype words.

Business: ${l.name}
Type: ${l.niche ?? "local business"}
Location: ${l.area ?? "their area"}
Website situation: ${l.category === "no_site" ? "they have NO website" : `their site scored ${l.site_score}/100 — issues: ${l.site_notes}`}

Reply with ONLY the message text.`;
  try {
    const out = execFileSync("claude", ["-p", "--model", "haiku", prompt], {
      encoding: "utf8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out.length > 20 && out.length < 600 ? out : null;
  } catch {
    return null;
  }
}

for (const l of leads) {
  const msg = (claudeAvailable ? aiDraft(l) : null) ?? template(l);
  await pool.query("UPDATE leads SET message=$1 WHERE id=$2", [msg, l.id]);
  console.log(`  ${l.name} (@${l.ig_handle}): ${msg.slice(0, 70)}...`);
}

console.log("\nDone. Open the dashboard to start sending.");
await pool.end();
