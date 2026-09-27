import 'dotenv/config'; import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const all = (await p.query(`SELECT id,name,ig_handle,niche,area,state,status,hot_score FROM leads WHERE name IS NOT NULL`)).rows;

// every city token we have seen, from the data itself
const cityTok = new Set();
for (const r of all) for (const w of (r.area||'').split(',')[0].toLowerCase().split(/\s+/)) if (w.length>2) cityTok.add(w);
const STATE_AB = new Set('al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc'.split(' '));
const TAIL = /\b(llc|l\.l\.c|inc|co|corp|corporation|ltd|limited|company)\b/g;

// "MGM Fence Company Raleigh" -> "mgm fence company"  (drop the trailing place)
function stem(name){
  let t = name.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim().split(' ');
  while (t.length>2 && (cityTok.has(t.at(-1)) || STATE_AB.has(t.at(-1)))) t.pop();
  let s = t.join(' ').replace(TAIL,' ').replace(/\s+/g,' ').trim();
  return s;
}
// a stem made only of trade words ("mobile detailing", "handyman services") is a
// DESCRIPTION every independent uses, not a brand. Require a distinctive token.
const DESC=new Set('mobile detailing detail auto car wash washing handyman handy man tree care service services trimming removal lawn landscaping landscape fence fencing fences roof roofing concrete sealcoating sealcoat seal coating paving asphalt striping junk hauling haul cleaning clean pressure power window windows gutter gutters deck decks patio masonry contractor contractors construction painting painters painter plumbing plumber electrical electric electrician hvac heating cooling air conditioning repair repairs installation install company co llc inc corp ltd group solutions pro pros professional the and of in your local general home house residential commercial'.split(' '));
const distinctive=s=>s.split(' ').some(w=>!DESC.has(w));
const by=new Map();
for (const r of all){
  const s=stem(r.name); if (s.split(' ').length<2 || s.length<8 || !distinctive(s)) continue;
  if(!by.has(s)) by.set(s,[]); by.get(s).push(r);
}
const hot=r=>r.status==='new'&&r.hot_score>=60;
const chains=[...by.entries()]
  .map(([s,rs])=>({s,rs,states:new Set(rs.map(r=>r.state)).size,places:new Set(rs.map(r=>r.area)).size,hotOnes:rs.filter(hot)}))
  .filter(c=>c.rs.length>=3 && c.states>=2 && c.places>=3)
  .sort((a,b)=>b.hotOnes.length-a.hotOnes.length || b.rs.length-a.rs.length);
const withHot=chains.filter(c=>c.hotOnes.length>0);
console.log(`Identical brand name in 3+ different places across 2+ states: ${chains.length} chains found, ${withHot.length} have a lead sitting in Hot.\n`);
for (const c of withHot){
  console.log(`■ "${c.s}" — ${c.rs.length} locations, ${c.states} states — ${c.hotOnes.length} IN HOT`);
  for (const r of c.hotOnes) console.log(`   >> IN HOT  ${String(r.id).padStart(6)} ${(r.ig_handle||'—').padEnd(28)} ${r.name} (${r.state})`);
  console.log(`      other locations: ${c.rs.filter(r=>!hot(r)).slice(0,6).map(r=>r.state).join(', ')}${c.rs.length>c.hotOnes.length+6?' …':''}`);
}
console.log('\n--- chains with nothing currently in Hot (for the block-list): ' + chains.filter(c=>!c.hotOnes.length).map(c=>`"${c.s}"(${c.rs.length})`).slice(0,25).join(' '));
await p.end();
