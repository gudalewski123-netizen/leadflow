import 'dotenv/config'; import pg from 'pg';
const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const r=(await p.query("SELECT id,name,ig_handle,niche,area,state,ig_followers,hot_score,hot_why,site_notes,message FROM leads WHERE ig_handle='rockplus'")).rows[0];
console.log(JSON.stringify({id:r?.id,name:r?.name,handle:r?.ig_handle,niche:r?.niche,area:r?.area,followers:r?.ig_followers,score:r?.hot_score,why:r?.hot_why,bio:r?.site_notes},null,1));
console.log('\n--- follower distribution across the Hot tab:');
console.table((await p.query(`SELECT CASE
  WHEN ig_followers IS NULL THEN 'unknown'
  WHEN ig_followers < 1000 THEN 'a <1k'
  WHEN ig_followers < 5000 THEN 'b 1k-5k'
  WHEN ig_followers < 10000 THEN 'c 5k-10k'
  WHEN ig_followers < 20000 THEN 'd 10k-20k'
  ELSE 'e 20k+' END AS band, count(*)::int n
  FROM leads WHERE status='new' AND hot_score>=60 GROUP BY 1 ORDER BY 1`)).rows);
console.log('--- the biggest accounts sitting in Hot:');
for (const x of (await p.query(`SELECT id,name,ig_handle,niche,ig_followers FROM leads WHERE status='new' AND hot_score>=60 AND ig_followers>=8000 ORDER BY ig_followers DESC LIMIT 20`)).rows)
  console.log(`  ${String(x.ig_followers).padStart(6)}  @${(x.ig_handle||'—').padEnd(28)} ${x.name} [${x.niche}]`);
await p.end();
