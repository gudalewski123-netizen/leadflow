import { pool, init } from "../src/db.js";
import { scoreOf } from "../src/score.js";

await init();
const { rows } = await pool.query(`
  SELECT id, last_active, ig_followers, ig_posts, ig_link, ig_email, ig_phone, ig_business, hot_score
  FROM leads WHERE ig_checked_at IS NOT NULL
`);
console.log(`Re-scoring ${rows.length} previously-checked leads...`);

let changed = 0, wasHot = 0, nowHot = 0;
for (const r of rows) {
  const p = {
    lastPost: r.last_active ? Math.floor(new Date(r.last_active).getTime() / 1000) : null,
    followers: r.ig_followers,
    posts: r.ig_posts,
    externalUrl: r.ig_link,
    email: r.ig_email,
    phone: r.ig_phone,
    isBusiness: r.ig_business,
  };
  const { score, why } = scoreOf(p);
  if ((r.hot_score ?? 0) >= 60) wasHot++;
  if (score >= 60) nowHot++;
  if (score !== r.hot_score) {
    changed++;
    await pool.query("UPDATE leads SET hot_score=$1, hot_why=$2 WHERE id=$3", [score, why.join(", "), r.id]);
  }
}
console.log(`Done. ${changed} scores changed. Hot before: ${wasHot} -> after: ${nowHot}`);
await pool.end();
