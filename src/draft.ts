/**
 * Draft a personalized opener for each lead (claude CLI if available, template fallback).
 * Usage: npm run draft
 */
import { execFileSync } from "node:child_process";
import { pool, init, Lead } from "./db.js";

await init();
const leads = (
  await pool.query(
    // draft for every new lead missing a message — a lead without an IG handle
    // yet still needs its opener ready, so it's send-able the moment you add one.
    "SELECT * FROM leads WHERE message IS NULL AND status = 'new'"
  )
).rows as Lead[];

console.log(`Drafting messages for ${leads.length} leads...`);

// Templates are the DEFAULT — they cost nothing and read fine. AI drafting is
// opt-in via AI_DRAFT=1, because at batch scale (thousands of leads) one model
// call per lead is the only part of this pipeline that costs money.
let claudeAvailable = process.env.AI_DRAFT === "1";
if (claudeAvailable) {
  try {
    execFileSync("claude", ["--version"], { stdio: "pipe" });
  } catch {
    claudeAvailable = false;
    console.log("claude CLI not found — using templates only.");
  }
} else {
  console.log("Using free templates (set AI_DRAFT=1 to personalize with AI).");
}

/**
 * Openers are deliberately 1-2 sentences. Long DMs from a stranger read as a
 * pitch and get ignored — the goal of message one is only to get a REPLY, which
 * also pulls you out of Instagram's Message Requests folder. The offer comes
 * after they answer.
 */
function template(l: Lead): string {
  const first = l.name.split(/\s+/).slice(0, 3).join(" ");
  if (l.category === "no_site")
    // Question-first: a yes/no question is the lowest-friction thing to answer,
    // and "no" is itself the opening.
    return `Hey! Quick question — do you have a website for ${first}? Couldn't find one linked on your page.`;
  if (l.category === "bad_site")
    return `Hey! Came across ${first} — quick thing, your site ${l.site_notes?.includes("mobile") ? "doesn't display right on phones" : "looks a bit dated"}. Want me to show you what I mean?`;
  return `Hey! Came across ${first} and your work looks great. Do you have a website up for it yet?`;
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
