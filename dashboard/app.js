// Token Radar v7 (radar-4) offline dashboard.
// Reads window.RADAR (data.js) and renders the board, live tab and detail view.
// No network. Every number comes from DATA; nothing is hard-coded.
(function(){'use strict';
var D=window.RADAR,app=document.getElementById('app');
if(!D||!D.rows||!D.rows.length){app.innerHTML='<div class="en">No data loaded (data.js missing or empty).</div>';return;}
var M=D.model,C=D.calibration,O=C.odds_model,V=C.verdicts,T1=V.t1_farm_now,T2=V.t2_selective;
var DEPS=[1000,5000,10000,25000];
var S={q:'',sort:'implied',dir:-1,cat:'',chain:'',verdict:'',watch:false,mt:false,mi:false,tab:'board',detail:'',dep:M.default_deposit_usd||5000};
var WL={};D.watchlist.forEach(function(s){WL[s]=1});
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function money(v){if(v==null||!isFinite(v))return '—';var a=Math.abs(v),s=v<0?'−':'';if(a>=1e9)return s+'$'+(a/1e9).toFixed(2)+'B';if(a>=1e6)return s+'$'+(a/1e6).toFixed(1)+'M';if(a>=1e3)return s+'$'+(a/1e3).toFixed(1)+'K';return s+'$'+Math.round(a)}
function num(v){return v==null?'—':Math.round(v).toLocaleString('en-US')}
function pct(v,d){return (v*100).toFixed(d==null?0:d)+'%'}
function chg(v){if(v==null)return '—';return '<span class="'+(v>=0?'pos':'neg')+'">'+(v>=0?'+':'')+v.toFixed(1)+'%</span>'}
function age(d){if(d==null)return '—';return d>=365?(d/365).toFixed(1)+'y':d+'d'}
function ph(v){return (v>=0?'+':'−')+'$'+Math.abs(v).toFixed(2)}
function vcls(v){return v==='FARM NOW'?'v-farm':v==='SELECTIVE'?'v-select':v==='THIN'?'v-thin':'v-skip'}
function farm(r,dep){var pool=M.airdrop_pool_share*r.implied_value_usd,sh=dep/(M.farming_deposit_tvl_share*r.tvl_usd),ex=pool*sh*r.launch_odds,op=dep*M.opp_cost_apr*M.horizon_days/365,net=ex-r.farm_cost_usd-op,per=r.farm_hours>0?net/r.farm_hours:net;return{pool:pool,sh:sh,ex:ex,op:op,net:net,per:per,v:per>=T1?'FARM NOW':per>=T2?'SELECTIVE':per>=0?'THIN':'SKIP'}}
function comp(){return D.rows.map(function(r){return{r:r,f:farm(r,S.dep)}})}
function readHash(){var p=new URLSearchParams(location.hash.slice(1));S.q=p.get('q')||'';S.sort=p.get('sort')||'implied';S.dir=p.get('dir')==='asc'?1:-1;S.cat=p.get('category')||'';S.chain=p.get('chain')||'';S.verdict=p.get('verdict')||'';S.watch=p.get('watch')==='1';S.mt=p.get('minTvl')==='1';S.mi=p.get('minImplied')==='1';S.tab=p.get('tab')==='live'?'live':'board';S.detail=p.get('detail')||'';var d=+p.get('deposit');S.dep=DEPS.indexOf(d)>=0?d:(M.default_deposit_usd||5000)}
function writeHash(){var o=[];function add(k,v){if(v!==''&&v!=null&&v!==false)o.push(encodeURIComponent(k)+'='+encodeURIComponent(v))}
add('q',S.q);if(S.sort!=='implied')add('sort',S.sort);if(S.dir===1)add('dir','asc');add('category',S.cat);add('chain',S.chain);add('verdict',S.verdict);if(S.watch)add('watch',1);if(S.mt)add('minTvl',1);if(S.mi)add('minImplied',1);if(S.tab==='live')add('tab','live');add('detail',S.detail);if(S.dep!==(M.default_deposit_usd||5000))add('deposit',S.dep);history.replaceState(null,'',o.length?'#'+o.join('&'):'#')}
function filtered(){var q=S.q.toLowerCase();return comp().filter(function(c){var r=c.r;
if(S.watch&&!WL[r.slug])return false;if(S.mt&&r.tvl_usd<1e8)return false;if(S.mi&&r.implied_value_usd<5e7)return false;
if(S.cat&&r.category!==S.cat)return false;if(S.chain&&r.chains.indexOf(S.chain)<0)return false;
if(S.verdict&&c.f.v!==S.verdict)return false;
if(q&&(r.name+' '+r.slug+' '+r.category).toLowerCase().indexOf(q)<0)return false;return true})}
function sorted(list){var k=S.sort,d=S.dir;return list.slice().sort(function(a,b){var x,y;
if(k==='name'){x=a.r.name.toLowerCase();y=b.r.name.toLowerCase()}else if(k==='tvl'){x=a.r.tvl_usd;y=b.r.tvl_usd}
else if(k==='odds'){x=a.r.launch_odds;y=b.r.launch_odds}else if(k==='risk'){x=a.r.risk_adj_usd;y=b.r.risk_adj_usd}
else if(k==='ph'){x=a.f.per;y=b.f.per}else{x=a.r.implied_value_usd;y=b.r.implied_value_usd}
if(x<y)return -d;if(x>y)return d;return a.r.rank-b.r.rank})}
function headerHTML(){return '<div class="ph"><div class="hl"><div class="eyebrow">TOKEN RADAR · RADAR-4 · SNAPSHOT '+esc(D.as_of)+'</div><h1>Pre-token protocols: calibrated implied value, launch odds &amp; farming verdicts</h1><p class="subtitle">Every row records no token. Ranked by calibrated implied value with held-out error bands, snapshot launch propensity, risk-adjusted value, and live $/h farming verdicts.</p></div><div class="scs">'+[['Watchlist',D.watchlist_size],['Board rows',D.board_size],['Early finds',D.early_size],['Live tokens',D.live_size]].map(function(x){return '<div class="sc"><div class="sn">'+x[1]+'</div><div class="sl">'+x[0].toUpperCase()+'</div></div>'}).join('')+'</div></div>'}
function mxHTML(){return '<div class="mx"><p><strong>'+esc(C.winner)+' · held-out median error '+C.winner_mape+'%</strong> (median method: '+C.median_mape+'%). Range = fitted value ÷/× (1 + held-out MAPE); coverage '+D.board_size+' of '+D.board_size+' rankable pre-token protocols ('+D.watchlist_size+' watchlist).</p><p>Launch odds = logistic fit on the '+(O.token_count+O.pre_token_count)+'-protocol snapshot (see Method); risk-adjusted value = implied × odds.</p><p>Verdicts from $/h at the selected deposit; airdrop pool '+(M.airdrop_pool_share*100)+'% of implied value, farming deposits '+(M.farming_deposit_tvl_share*100)+'% of TVL, '+(M.opp_cost_apr*100)+'% annual opportunity cost over '+M.horizon_days+' days — assumptions, stated here and in the Method section.</p></div>'}
function top10(){var t=D.rows.slice(0,10),mx=t[0].implied_value_usd;
return '<div class="cc"><div class="ch"><h2>Top 10 by implied value</h2><span class="ci">click a bar for detail</span></div><div class="t10">'+t.map(function(r,i){return '<div class="t10r" data-act="open" data-slug="'+r.slug+'"><span class="t10k">'+(i+1)+'</span><span class="t10n">'+esc(r.name)+'</span><span class="t10w"><span class="t10b" style="width:'+Math.max(2,Math.round(100*r.implied_value_usd/mx))+'%"></span></span><span class="t10v">'+money(r.implied_value_usd)+'</span></div>'}).join('')+'</div></div>'}
function scatter(){var lv=D.live.filter(function(l){return l.mcap_usd&&l.tvl_usd>0});
var xs=lv.map(function(l){return Math.log10(l.tvl_usd)}),ys=lv.map(function(l){return Math.log10(l.ratio)});
var top=D.rows.slice(0,20);top.forEach(function(r){xs.push(Math.log10(r.tvl_usd));ys.push(Math.log10(r.implied_value_usd/r.tvl_usd))});
var x0=Math.floor(Math.min.apply(null,xs)),x1=Math.ceil(Math.max.apply(null,xs)),y0=Math.floor(Math.min.apply(null,ys)),y1=Math.ceil(Math.max.apply(null,ys));
var W=560,H=300,L=46,R=10,T=10,B=28;
function X(v){return L+(v-x0)/(x1-x0)*(W-L-R)}function Y(v){return H-B-(v-y0)/(y1-y0)*(H-T-B)}
var g='';
[1e7,1e8,1e9,1e10].forEach(function(t){if(t>=Math.pow(10,x0)&&t<=Math.pow(10,x1)){var x=X(Math.log10(t));g+='<line class="grid" x1="'+x+'" y1="'+T+'" x2="'+x+'" y2="'+(H-B)+'"/><text class="tick" x="'+x+'" y="'+(H-8)+'" text-anchor="middle">'+money(t)+'</text>'}});
[0.05,0.2,1,5,20,100,400].forEach(function(t){var ly=Math.log10(t);if(ly>=y0&&ly<=y1){var y=Y(ly);g+='<line class="grid" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/><text class="tick" x="'+(L-6)+'" y="'+(y+3)+'" text-anchor="end">'+t+'×</text>'}});
g+='<line class="ref-median" x1="'+L+'" y1="'+Y(Math.log10(D.global_multiple))+'" x2="'+(W-R)+'" y2="'+Y(Math.log10(D.global_multiple))+'"/>';
var a=C.coefficients.global.a,b=C.coefficients.global.b;
g+='<line class="ref-fit" x1="'+X(x0)+'" y1="'+Y((a+(b-1)*Math.log(Math.pow(10,x0)))/Math.LN10)+'" x2="'+X(x1)+'" y2="'+Y((a+(b-1)*Math.log(Math.pow(10,x1)))/Math.LN10)+'"/>';
lv.forEach(function(l){g+='<circle class="dot-live-pt" cx="'+X(Math.log10(l.tvl_usd)).toFixed(1)+'" cy="'+Y(Math.log10(l.ratio)).toFixed(1)+'" r="2.5"><title>'+esc(l.name)+'</title></circle>'});
top.forEach(function(r){g+='<circle class="dot-top-pt" cx="'+X(Math.log10(r.tvl_usd)).toFixed(1)+'" cy="'+Y(Math.log10(r.implied_value_usd/r.tvl_usd)).toFixed(1)+'" r="3.5"><title>'+esc(r.name)+'</title></circle>'});
var med=top.map(function(r){return r.implied_value_usd/r.tvl_usd}).sort(function(p,q){return p-q}),tm=med[Math.floor(med.length/2)];
return '<div class="cc"><div class="ch"><h2>Market pricing: TVL vs mcap / TVL</h2><span class="ci">live '+lv.length+' · top 20</span></div><svg class="plot" viewBox="0 0 '+W+' '+H+'">'+g+'</svg><p class="cp"><span class="dot dot-live"></span> live token &nbsp; <span class="dot dot-top"></span> top-20 board row — grey dashed: market median '+D.global_multiple.toFixed(3)+'×, amber dashed: ols-global fit. The top 20 sit at a median '+tm.toFixed(2)+'× implied/TVL vs the market median '+D.global_multiple.toFixed(3)+'×.</p></div>'}
function calibPlot(){var lv=D.live.filter(function(l){return l.mcap_usd&&l.cv_predicted_mcap_usd>0});
var xs=lv.map(function(l){return Math.log10(l.mcap_usd)}),ys=lv.map(function(l){return Math.log10(l.cv_predicted_mcap_usd)});
var x0=Math.floor(Math.min.apply(null,xs.concat(ys))),x1=Math.ceil(Math.max.apply(null,xs.concat(ys)));
var W=560,H=260,L=46,R=10,T=10,B=28;
function X(v){return L+(v-x0)/(x1-x0)*(W-L-R)}function Y(v){return H-B-(v-x0)/(x1-x0)*(H-T-B)}
var g='<line class="ref-median" x1="'+X(x0)+'" y1="'+Y(x0)+'" x2="'+X(x1)+'" y2="'+Y(x1)+'"/>';
[1e6,1e7,1e8,1e9,1e10,1e11].forEach(function(t){var lt=Math.log10(t);if(lt>=x0&&lt<=x1){g+='<line class="grid" x1="'+X(lt)+'" y1="'+T+'" x2="'+X(lt)+'" y2="'+(H-B)+'"/><text class="tick" x="'+X(lt)+'" y="'+(H-8)+'" text-anchor="middle">'+money(t)+'</text>';g+='<line class="grid" x1="'+L+'" y1="'+Y(lt)+'" x2="'+(W-R)+'" y2="'+Y(lt)+'"/><text class="tick" x="'+(L-6)+'" y="'+(Y(lt)+3)+'" text-anchor="end">'+money(t)+'</text>'}});
lv.forEach(function(l){g+='<circle class="dot-live-pt" cx="'+X(Math.log10(l.mcap_usd)).toFixed(1)+'" cy="'+Y(Math.log10(l.cv_predicted_mcap_usd)).toFixed(1)+'" r="2.5"><title>'+esc(l.name)+'</title></circle>'});
return '<div class="mb"><h3>Calibration — predicted vs actual live mcap</h3><svg class="plot" viewBox="0 0 '+W+' '+H+'">'+g+'</svg><p class="cp">Each dot is a live-token protocol (out-of-fold prediction). Dashed line is y = x. Held-out median error '+C.winner_mape+'% ('+lv.length+' live protocols).</p></div>'}
function histo(){var vs=D.rows.map(function(r){return r.implied_value_usd});
var lo=Math.min.apply(null,vs),hi=Math.max.apply(null,vs),l0=Math.log10(lo),l1=Math.log10(hi),n=6,bins=[];
for(var i=0;i<n;i++){bins.push({a:Math.pow(10,l0+(l1-l0)*i/n),b:Math.pow(10,l0+(l1-l0)*(i+1)/n),c:0})}
vs.forEach(function(v){bins[Math.min(n-1,Math.floor((Math.log10(v)-l0)/(l1-l0)*n))].c++});
var mx=Math.max.apply(null,bins.map(function(b){return b.c}));
var W=560,H=170,L=8,R=8,T=8,B=26,bw=(W-L-R)/n;
var g=bins.map(function(b,i){var h=(H-T-B)*b.c/mx;return '<rect class="hist-bar" x="'+(L+i*bw+2)+'" y="'+(H-B-h)+'" width="'+(bw-4)+'" height="'+h+'"/><text class="tick" x="'+(L+i*bw+bw/2)+'" y="'+(H-B+14)+'" text-anchor="middle">'+money(b.a)+'</text><text class="tick" x="'+(L+i*bw+bw/2)+'" y="'+(H-B-h-4)+'" text-anchor="middle">'+b.c+'</text>'}).join('');
var bi=0;for(var j=1;j<n-1;j++){if(bins[j].c+bins[j+1].c>bins[bi].c+bins[bi+1].c)bi=j}
return '<div class="mb"><h3>Implied-value distribution (log scale)</h3><svg class="plot" viewBox="0 0 '+W+' '+H+'">'+g+'</svg><p class="cp">'+(bins[bi].c+bins[bi+1].c)+' of '+vs.length+' rows sit between '+money(bins[bi].a)+' and '+money(bins[bi+1].b)+'.</p></div>'}
function catSum(){var g={};D.rows.forEach(function(r){(g[r.category]=g[r.category]||[]).push(r)});
var cats=Object.keys(g).filter(function(k){return g[k].length>=3}).sort(function(a,b){return g[b].length-g[a].length});
var rows=cats.map(function(k){var rs=g[k].slice().sort(function(a,b){return a.implied_value_usd-b.implied_value_usd});var med=rs[Math.floor(rs.length/2)].implied_value_usd;var top=g[k].slice().sort(function(a,b){return b.implied_value_usd-a.implied_value_usd})[0];return '<tr><td>'+esc(k)+'</td><td class="n">'+rs.length+'</td><td class="n">'+money(med)+'</td><td>'+esc(top.name)+'</td></tr>'}).join('');
return '<div class="mb"><h3>Category summary (≥3 rows)</h3><table class="mt"><thead><tr><th>Category</th><th class="n">Rows</th><th class="n">Median implied</th><th>Top protocol</th></tr></thead><tbody>'+rows+'</tbody></table></div>'}
function bakeoff(){return '<div class="mb"><h3>Model bake-off — held-out MAPE</h3><table class="mt"><thead><tr><th>Model</th><th class="n">Params</th><th class="n">5-fold</th><th class="n">Walk-forward</th><th class="n">Leave-one-out</th></tr></thead><tbody>'+C.bakeoff.map(function(b){return '<tr'+(b.winner?' class="wr"':'')+'><td>'+esc(b.name)+(b.winner?' ★':'')+' — '+esc(b.label)+'</td><td class="n">'+b.params+'</td><td class="n">'+b.mape+'%</td><td class="n">'+b.wf_mape+'%</td><td class="n">'+b.loo_mape+'%</td></tr>'}).join('')+'</tbody></table><p class="mn">'+esc(C.fold_scheme)+'. Winner '+esc(C.winner)+' ('+C.winner_mape+'% 5-fold MAPE) vs median method '+C.median_mape+'%. Walk-forward split '+C.walk_forward.split_date+': '+C.walk_forward.train_count+' train / '+C.walk_forward.test_count+' test.</p></div>'}
function ablation(){return '<div class="mb"><h3>Model ablation — every variant tried</h3><table class="mt"><thead><tr><th>Variant</th><th class="n">Params</th><th class="n">5-fold MAPE</th><th>Verdict</th></tr></thead><tbody>'+C.ablation.map(function(a){return '<tr><td>'+esc(a.name)+'</td><td class="n">'+a.params+'</td><td class="n">'+a.mape+'%</td><td>'+esc(a.note)+'</td></tr>'}).join('')+'</tbody></table></div>'}
function oddsSec(){var oc=O.coefficients;
var coef='<table class="mt"><thead><tr><th>Feature</th><th class="n">Coefficient</th></tr></thead><tbody>'+[['Intercept',oc.intercept],['log10(TVL)',oc.log_tvl],['log10(age)',oc.log_age],['7d change',oc.chg_7d],['Chain count',oc.n_chains],['Category launch rate',oc.cat_launch_rate]].map(function(x){return '<tr><td>'+x[0]+'</td><td class="n">'+x[1].toFixed(3)+'</td></tr>'}).join('')+'</tbody></table>';
var splits='<table class="mt"><thead><tr><th>Split</th><th class="n">AUC</th><th class="n">Brier</th><th class="n">Base Brier</th></tr></thead><tbody>'+[['5-fold',O.cv5],['Walk-forward',O.walk_forward],['Leave-one-out',O.loo]].map(function(x){return '<tr><td>'+x[0]+'</td><td class="n">'+x[1].auc.toFixed(3)+'</td><td class="n">'+x[1].brier.toFixed(4)+'</td><td class="n">'+x[1].base_brier.toFixed(4)+'</td></tr>'}).join('')+'</tbody></table>';
var bins='<table class="mt"><thead><tr><th>Bin</th><th class="n">n</th><th class="n">Odds range</th><th class="n">Mean predicted</th><th class="n">Actual launch rate</th></tr></thead><tbody>'+O.calibration_bins.map(function(b){return '<tr><td>'+b.bin+'</td><td class="n">'+b.count+'</td><td class="n">'+pct(b.min_odds,0)+'–'+pct(b.max_odds,0)+'</td><td class="n">'+pct(b.mean_predicted,1)+'</td><td class="n">'+pct(b.actual_rate,1)+'</td></tr>'}).join('')+'</tbody></table>';
return '<div class="mb"><h3>Launch-odds model — logistic fit on all '+O.sample_size+' protocols</h3><p class="mn">Target: has a token in the snapshot ('+O.token_count+' of '+O.sample_size+' do). A pre-token protocol that launches later counts as 0 here, so these odds are a snapshot-based launch propensity — a lower bound on the true launch probability — not the probability it will launch. IRLS fit'+(O.converged?' (converged in '+O.iterations+' iterations':' (not converged')+(O.ridge?'; ridge '+O.ridge:'')+'). 5-fold AUC '+O.cv5.auc.toFixed(3)+' (must beat 0.70), Brier '+O.cv5.brier.toFixed(4)+' vs base rate '+O.cv5.base_brier.toFixed(4)+'.</p>'+coef+splits+bins+'</div>'}
function methodHTML(){var E=D.exclusions;
return '<div class="method"><h2 class="st">Method</h2>'+bakeoff()+ablation()+oddsSec()+calibPlot()+catSum()+histo()+'<div class="mb"><h3>Coverage &amp; assumptions</h3><p class="mn">Coverage: '+E.total_pre_token+' pre-token protocols in the snapshot; '+E.ranked+' ranked; '+E.excluded_total+' excluded — '+E.wrapped_category+' wrapped category, '+E.versioned_name+' versioned name, '+E.wrapped_word+' wrapped word, '+E.exchange_name+' exchange name. Farm steps not priced: '+(C.farm_unpriced_steps&&C.farm_unpriced_steps.length?C.farm_unpriced_steps.length+' steps':'none')+'.</p><p class="mn">Verdict assumptions: airdrop pool '+(M.airdrop_pool_share*100)+'% of implied value; farming deposits '+(M.farming_deposit_tvl_share*100)+'% of TVL; opportunity cost '+(M.opp_cost_apr*100)+'% annual on the deposit over '+M.horizon_days+' days. Ranges are the model\'s typical held-out error (fitted value ÷/× (1 + held-out MAPE)), not a confidence interval. Thresholds T1 $'+T1+'/h and T2 $'+T2+'/h are derived from the $/h distribution at the default deposit.</p></div><p class="sr">Source: '+esc(D.source)+' · Snapshot '+esc(D.as_of)+' · Model '+esc(D.model_version)+' · All numbers computed from the snapshot at build time.</p></div>'}
function boardTable(list){var cols=[['#',''],['Protocol','name'],['Chains',''],['TVL','tvl'],['7d',''],['Age',''],['Implied','implied'],['Odds','odds'],['Risk-adj','risk'],['Verdict',''],['$/h','ph']];
function th(c){if(!c[1])return '<th>'+c[0]+'</th>';return '<th data-act="sort" data-k="'+c[1]+'">'+c[0]+(S.sort===c[1]?(S.dir===1?' ↑':' ↓'):'')+'</th>'}
if(!list.length)return '<div class="en">No rows match the current filters.</div>';
var rows=list.map(function(c){var r=c.r,f=c.f;
var rr=r.rank_min===r.rank_max?'':'<span class="rr">'+r.rank_min+'–'+r.rank_max+'</span>';
var ch=r.chains.length>3?r.chains.slice(0,3).join(', ')+' +'+(r.chains.length-3):r.chains.join(', ');
return '<tr data-act="open" data-slug="'+r.slug+'"><td class="rk"><span class="rnu">#'+r.rank+'</span>'+rr+'</td><td><span class="pn">'+esc(r.name)+'</span> '+(WL[r.slug]?'<span class="badge wb">WATCH</span>':'')+' <span class="badge ct">'+esc(r.category)+'</span></td><td>'+esc(ch)+'</td><td class="n">'+money(r.tvl_usd)+'</td><td class="n">'+chg(r.change_7d)+'</td><td class="n">'+age(r.age_days)+'</td><td class="n"><span class="iv">'+money(r.implied_value_usd)+'</span><span class="ir">'+money(r.implied_low_usd)+'–'+money(r.implied_high_usd)+'</span></td><td class="n">'+pct(r.launch_odds,0)+'</td><td class="n">'+money(r.risk_adj_usd)+'</td><td><span class="verdict '+vcls(f.v)+'">'+f.v+'</span></td><td class="n '+(f.per>=0?'pos':'neg')+'">'+ph(f.per)+'</td></tr>'}).join('');
return '<div class="tw"><table class="board"><thead><tr>'+cols.map(th).join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'}
function liveHTML(){var lv=D.live.slice().sort(function(a,b){return b.mcap_usd-a.mcap_usd});
var rows=lv.map(function(l,i){return '<tr><td class="rk"><span class="rnu">#'+(i+1)+'</span></td><td><span class="pn">'+esc(l.name)+'</span> <span class="badge ct">'+esc(l.category)+'</span></td><td>'+esc(l.chains.join(', '))+'</td><td class="n">'+money(l.tvl_usd)+'</td><td class="n">'+money(l.mcap_usd)+'</td><td class="n">'+l.ratio.toFixed(2)+'×</td><td class="n">'+chg(l.change_7d)+'</td></tr>'}).join('');
return '<div class="tw"><table class="board"><thead><tr><th>#</th><th>Protocol</th><th>Chains</th><th class="n">TVL</th><th class="n">MCAP</th><th class="n">MCAP / TVL</th><th class="n">7d</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="rc">'+lv.length+' live-token protocols with a market cap, sorted by mcap.</p>'}
function boardHTML(){var all=comp(),vc={};all.forEach(function(c){vc[c.f.v]=(vc[c.f.v]||0)+1});
var list=sorted(filtered());
var cats=[],chs={};D.rows.forEach(function(r){if(cats.indexOf(r.category)<0)cats.push(r.category);r.chains.forEach(function(c){chs[c]=1})});
cats.sort();var chainList=Object.keys(chs).sort();
var h=headerHTML()+mxHTML()+'<div class="cr">'+top10()+scatter()+'</div>';
h+='<div class="tabs-row"><div class="tabs"><button class="tab'+(S.tab==='board'?' on':'')+'" data-act="tab" data-v="board">Pre-token board ('+D.board_size+')</button><button class="tab'+(S.tab==='live'?' on':'')+'" data-act="tab" data-v="live">Live tokens ('+D.live_size+')</button></div><div class="dp"><span class="dl">Deposit</span>'+DEPS.map(function(d){return '<button class="db'+(S.dep===d?' on':'')+'" data-act="dep" data-v="'+d+'">$'+num(d)+'</button>'}).join('')+'</div></div>';
h+='<p class="vl">'+(vc['FARM NOW']||0)+' FARM NOW · '+(vc['SELECTIVE']||0)+' SELECTIVE · '+(vc['THIN']||0)+' THIN · '+(vc['SKIP']||0)+' SKIP at $'+num(S.dep)+' · thresholds T1 $'+T1+'/h, T2 $'+T2+'/h</p>';
if(S.tab==='live')return h+liveHTML();
h+='<div class="fb"><input id="q" class="fs" type="search" placeholder="Search name, slug or category…" value="'+esc(S.q)+'"><select id="catSel" class="ft"><option value="">All categories</option>'+cats.map(function(c){return '<option'+(S.cat===c?' selected':'')+' value="'+esc(c)+'">'+esc(c)+'</option>'}).join('')+'</select><select id="chainSel" class="ft"><option value="">All chains</option>'+chainList.map(function(c){return '<option'+(S.chain===c?' selected':'')+' value="'+esc(c)+'">'+esc(c)+'</option>'}).join('')+'</select><select id="verSel" class="ft"><option value="">All verdicts</option>'+['FARM NOW','SELECTIVE','THIN','SKIP'].map(function(v){return '<option'+(S.verdict===v?' selected':'')+'>'+v+'</option>'}).join('')+'</select><select id="sortSel" class="fo">'+[['implied','Sort: implied'],['name','Sort: name'],['tvl','Sort: TVL'],['odds','Sort: odds'],['risk','Sort: risk-adj'],['ph','Sort: $/h']].map(function(o){return '<option value="'+o[0]+'"'+(S.sort===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select><button class="chip'+(S.watch?' on':'')+'" data-act="watch">Watchlist</button><button class="chip'+(S.mt?' on':'')+'" data-act="mt">TVL ≥ $100M</button><button class="chip'+(S.mi?' on':'')+'" data-act="mi">Implied ≥ $50M</button><button class="chip reset-btn" data-act="reset">Reset</button></div>';
h+='<p class="rc">Showing '+list.length+' of '+D.board_size+' rows</p>';
h+=boardTable(list)+methodHTML();return h}
var VERB={Lending:'Supply',Dexs:'Provide liquidity on',Yield:'Deposit into',RWA:'Deposit into','Liquid Staking':'Stake with',CDP:'Open a vault on','Basis Trading':'Deposit into','Canonical Bridge':'Bridge into'};
function farmSteps(r){var amt=r.tvl_usd>=1e9?150:r.tvl_usd>=1e8?100:50,ch=r.chains[0]||'',vb=VERB[r.category]||'Deposit into';
return['Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
vb+' $'+amt+' of USDC into '+r.name+(ch?' on '+ch:'')+' and keep the position open. Cost: $'+amt+' of capital and about $4 of gas. Time: 15 minutes to set up.',
'Make one more deposit, swap or vote on '+r.name+' each week, a different action from the first. Cost: about $2 of gas a week. Time: 10 minutes a week.',
'Hold the position for at least 60 days so the activity is counted in more than one snapshot. Cost: the $'+amt+' stays in the position. Time: 60 days.',
"Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.']}
function peerHist(set,fit){if(!set.length)return '';var vs=set.map(function(l){return Math.log10(l.ratio)});var l0=Math.min.apply(null,vs),l1=Math.max.apply(null,vs);if(l1-l0<0.01){l0-=0.5;l1+=0.5}var n=8,bins=[];for(var i=0;i<n;i++)bins.push(0);vs.forEach(function(v){bins[Math.min(n-1,Math.floor((v-l0)/(l1-l0)*n))]++});var mx=Math.max.apply(null,bins),W=260,H=64,bw=W/n;
var g=bins.map(function(c,i){var h=c?Math.max(2,Math.round((H-6)*c/mx)):0;return '<rect class="hist-bar" x="'+(i*bw+1)+'" y="'+(H-h)+'" width="'+(bw-2)+'" height="'+h+'"/>'}).join('');
var fx=Math.max(0,Math.min(W-1,(Math.log10(fit)-l0)/(l1-l0)*W));
return '<svg class="plot" viewBox="0 0 '+W+' '+H+'" style="width:260px;height:64px">'+g+'<line class="hist-marker" x1="'+fx.toFixed(1)+'" y1="0" x2="'+fx.toFixed(1)+'" y2="'+H+'"/></svg>'}
function peers(r){var lv=D.live.filter(function(l){return l.mcap_usd&&l.tvl_usd>0});
var near=lv.map(function(l){return{l:l,d:Math.abs(Math.log(l.ratio/r.fitted_multiple))}}).sort(function(a,b){return a.d-b.d}).slice(0,5);
var rows=near.map(function(x){var l=x.l;return '<tr><td>'+esc(l.name)+'</td><td>'+esc(l.category)+'</td><td class="n">'+money(l.tvl_usd)+'</td><td class="n">'+money(l.mcap_usd)+'</td><td class="n">'+l.ratio.toFixed(3)+'×</td></tr>'}).join('');
var set=r.peer_category==='all live-token protocols'?lv:lv.filter(function(l){return l.category===r.peer_category});
return '<div class="ps"><div class="phd"><h3>Peer comparables</h3><span class="ci">5 closest to fitted '+r.fitted_multiple.toFixed(3)+'× · peer P25–P75 '+r.peer_p25.toFixed(3)+'×–'+r.peer_p75.toFixed(3)+'× · '+r.peer_count+' '+esc(r.peer_category)+' peers</span></div><table class="mt"><thead><tr><th>Peer</th><th>Category</th><th class="n">TVL</th><th class="n">MCAP</th><th class="n">Multiple</th></tr></thead><tbody>'+rows+'</tbody></table><div class="phi"><span class="phl">Peer multiples (log scale)</span><span class="phs">'+peerHist(set,r.fitted_multiple)+'</span></div></div>'}
function detailHTML(){var r=null;D.rows.forEach(function(x){if(x.slug===S.detail)r=x});
if(!r)return boardHTML();
var f=farm(r,S.dep),prev=D.rows[r.rank-2],next=D.rows[r.rank],catRank=1;
D.rows.forEach(function(x){if(x.category===r.category&&x.tvl_usd>r.tvl_usd)catRank++});
var why='#'+r.rank+' by implied value · '+(catRank===1?'largest':('#'+catRank+' largest'))+' pre-token TVL in '+r.category+' · '+(r.change_7d==null?'no 7d data':(r.change_7d>=0?'up ':'down ')+Math.abs(r.change_7d).toFixed(1)+'% in 7 days')+' · '+(r.age_days==null?'age unknown':'listed '+age(r.age_days)+' ago');
var tags=[];if(r.age_estimated)tags.push('age estimated');if(r.global_fit)tags.push('global fit');if(r.no_7d_data)tags.push('no 7d data');if(r.winsorized)tags.push('winsorized multiple');if(r.method==='median')tags.push('median fallback');
var h='<div class="dtb"><button class="chip" data-act="back">← Back to board</button><div class="rn">'+(prev?'<button class="chip" data-act="open" data-slug="'+prev.slug+'">← #'+prev.rank+' '+esc(prev.name)+'</button>':'')+(next?'<button class="chip" data-act="open" data-slug="'+next.slug+'">#'+next.rank+' '+esc(next.name)+' →</button>':'')+'</div></div>';
h+='<h1>'+esc(r.name)+'</h1><p class="wl">'+esc(why)+'</p><p class="cl">Rank #'+r.rank+(r.rank_min!==r.rank_max?' (refit range '+r.rank_min+'–'+r.rank_max+')':'')+' · '+esc(r.category)+' · '+esc(r.chains.join(', '))+' · TVL '+money(r.tvl_usd)+' · '+(r.age_days==null?'age unknown':'age '+age(r.age_days))+'</p>';
h+='<div class="dca"><div class="dc"><div class="dcl">IMPLIED VALUE</div><div class="dcb">'+money(r.implied_value_usd)+'</div><div class="dcs">range '+money(r.implied_low_usd)+'–'+money(r.implied_high_usd)+'</div></div><div class="dc"><div class="dcl">LAUNCH ODDS</div><div class="dcb">'+pct(r.launch_odds,0)+'</div><div class="dcs">snapshot propensity</div></div><div class="dc"><div class="dcl">RISK-ADJUSTED</div><div class="dcb">'+money(r.risk_adj_usd)+'</div><div class="dcs">implied × odds</div></div><div class="dc '+(f.per>=0?'cg':'cb')+'"><div class="dcl">FARMING $/H AT $'+num(S.dep)+'</div><div class="dcb">'+ph(f.per)+'</div><div class="dcs"><span class="verdict '+vcls(f.v)+'">'+f.v+'</span></div></div></div>';
h+='<div class="fbx"><p><strong>Value:</strong> implied = TVL '+money(r.tvl_usd)+' × fitted '+r.fitted_multiple.toFixed(4)+'× × growth '+r.growth_multiplier.toFixed(2)+'× × maturity '+r.maturity_multiplier.toFixed(2)+'× = '+money(r.implied_value_usd)+'.</p><p><strong>Expected value:</strong> implied '+money(r.implied_value_usd)+' × odds '+pct(r.launch_odds,0)+' = '+money(r.risk_adj_usd)+'.</p><p><strong>$/h:</strong> pool '+money(f.pool)+' × share '+pct(f.sh,4)+' × odds '+pct(r.launch_odds,0)+' − gas $'+r.farm_cost_usd+' − opp. cost $'+Math.round(f.op)+' = net '+money(Math.round(f.net))+' over '+r.farm_hours+'h → '+ph(f.per)+'/h.</p><p>CV MAPE '+r.model_mape+'% ('+(r.model_mape_scope==='category'?'category error':'global error')+') · fitted multiple '+r.fitted_multiple.toFixed(4)+'× vs category median '+(r.category_median_multiple==null?'—':r.category_median_multiple.toFixed(4)+'×')+' vs global median '+r.global_median_multiple.toFixed(4)+'×.</p></div>';
h+=peers(r)+'<div class="fms"><h3>Farm plan — 6 steps</h3><ol class="fst">'+farmSteps(r).map(function(s){return '<li>'+esc(s)+'</li>'}).join('')+'</ol><p class="dfn">Total gas ≈ $'+r.farm_cost_usd+' · '+r.farm_hours+'h. Capital is not a cost — only gas and fees count. Steps are generic templates, priced from this row\'s totals.</p></div>';
if(tags.length)h+='<div class="dbd">'+tags.map(function(t){return '<span class="badge">'+esc(t)+'</span>'}).join('')+'</div>';
return h}
function render(){var ae=document.activeElement,aid=ae&&ae.id,av=ae&&ae.value,ss=ae&&ae.selectionStart;
app.innerHTML=S.detail?detailHTML():boardHTML();
if(aid){var n=document.getElementById(aid);if(n){n.focus();if(av!=null&&n.setSelectionRange){try{n.setSelectionRange(ss,ss)}catch(e){}}}}
writeHash()}
app.addEventListener('click',function(e){var t=e.target.closest('[data-act]');if(!t)return;var a=t.getAttribute('data-act');
if(a==='sort'){var k=t.getAttribute('data-k');if(S.sort===k)S.dir=-S.dir;else{S.sort=k;S.dir=k==='name'?1:-1}render()}
else if(a==='open'){S.detail=t.getAttribute('data-slug');S.tab='board';render();window.scrollTo(0,0)}
else if(a==='back'){S.detail='';render()}
else if(a==='tab'){S.tab=t.getAttribute('data-v');S.detail='';render()}
else if(a==='dep'){S.dep=+t.getAttribute('data-v');render()}
else if(a==='watch'){S.watch=!S.watch;render()}
else if(a==='mt'){S.mt=!S.mt;render()}
else if(a==='mi'){S.mi=!S.mi;render()}
else if(a==='reset'){S.q='';S.cat='';S.chain='';S.verdict='';S.watch=false;S.mt=false;S.mi=false;S.sort='implied';S.dir=-1;render()}});
app.addEventListener('input',function(e){if(e.target.id==='q'){S.q=e.target.value;render()}});
app.addEventListener('change',function(e){var id=e.target.id;
if(id==='catSel')S.cat=e.target.value;else if(id==='chainSel')S.chain=e.target.value;else if(id==='verSel')S.verdict=e.target.value;else if(id==='sortSel'){S.sort=e.target.value;S.dir=S.sort==='name'?1:-1}else return;render()});
window.addEventListener('hashchange',function(){readHash();render()});
readHash();render();
})();
