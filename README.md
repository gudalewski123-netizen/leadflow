# LeadFlow

Semi-automated Instagram outreach pipeline for web-design client hunting.
The machine finds the leads, grades their websites, and drafts the DMs —
**you** send each one manually (that's what keeps your IG account safe).

## Pipeline

```bash
# 1. Find businesses on Google Maps (any niche, any city)
npm run scan -- "barbershop" "Miami FL" 25

# 1b. Or sweep whole states (top 3 cities each, auto-runs enrich + draft after)
npm run batch -- "barbershop" FL,GA,TX        # specific states
npm run batch -- "barbershop" all 15          # all 50 states — hours of scraping!

# 2. Grade their websites + find their Instagram handles
npm run enrich

# 3. AI-draft a personalized opener per lead (uses claude CLI, falls back to templates)
npm run draft

# 4. Open the outreach dashboard
npm run dash        # local → http://localhost:4571
```

The hosted dashboard (shared, password-protected) lives at
**https://leadflow-lxig.onrender.com** — all scans land there automatically
since everything writes to the shared Neon database. Use the state dropdown
in the header to work outreach one state at a time.

In the dashboard: tap **Copy msg + open IG** → the draft is on your clipboard
and the business's profile opens → paste, tweak if needed, send → **Mark sent**.

## Lead categories

- **NO SITE** — IG-active business with no website at all. Hottest pitch: new build.
- **WEAK SITE** — site scored < 55/100 (no mobile viewport, no SSL, ancient copyright,
  thin content...). Pitch: remodel/redesign. The notes column tells you the angle.
- **OK SITE** — decent site; low priority.

## Staying out of Instagram jail

- Keep it under **~30 cold DMs/day** (the counter in the header turns amber at 30).
- Send from an aged account with a real profile, posts, and a link in bio.
- Vary the messages (the AI drafts already do) and don't paste-blast back-to-back —
  space sends a few minutes apart, ideally while browsing normally.
- Never automate the actual send. That's the line that gets accounts banned.

## Data

Everything lives in `leadflow.db` (SQLite). Re-running `scan` upserts — no dupes.
Statuses: `new → sent → replied → closed`, plus `skip`.
