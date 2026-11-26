// Token Radar v7 (radar-4) — offline dashboard. Reads window.RADAR (data.js),
// renders the board, live tab, detail view, charts and Method section. All
// numbers come from DATA; nothing is hard-coded. Mounts into #app.
(function(){
'use strict';
var DATA=window.RADAR||null;
function A(p,t,c,x){var n=document.createElement(t);if(c)n.className=c;if(x!=null)n.textContent=x;if(p)p.appendChild(n);return n;}
function D(n,o){for(var k in o)n.setAttribute('data-'+k,o[k]);return n;}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function clamp(x,lo,hi){return x<lo?lo:x>hi?hi:x;}
function r2(x){return Math.round(x*100)/100;}
function tn(x,d){var s=x.toFixed(d);if(s.indexOf('.')>=0)s=s.replace(/0+$/,'').replace(/\.$/,'');return s;}
function fmtMoney(v,d){if(v==null||!isFinite(v))return 'n/a';var neg=v<0,a=Math.abs(v),o;d=d||1;if(a>=1e9)o='$'+tn(a/1e9,2)+'B';else if(a>=1e6)o='$'+tn(a/1e6,d)+'M';else if(a>=1e3)o='$'+tn(a/1e3,d-1)+'K';else o='$'+Math.round(a);return neg?'−'+o:o;}
function fmtMultiple(x){return x==null||!isFinite(x)?'n/a':tn(x,3)+'×';}
function fmtPct(x,d){if(x==null||!isFinite(x))return 'n/a';d=d==null?2:d;return (x>0?'+':x<0?'−':'')+Math.abs(x).toFixed(d)+'%';}
function pct(x,d){return x==null||!isFinite(x)?'n/a':tn(x,d==null?1:d)+'%';}
function fmtPerHour(v){return v==null||!isFinite(v)?'n/a':(v<0?'−$':'$')+Math.abs(v).toFixed(2);}
function fmtOdds(o){return o==null||!isFinite(o)?'n/a':Math.round(o*100)+'%';}
function fmtAge(d){if(d==null||!isFinite(d))return 'n/a';return d<365?Math.max(1,Math.round(d/30))+'mo':tn(d/365,1)+'y';}
function fmtHours(h){return h==null||!isFinite(h)?'n/a':tn(h,1)+'h';}
function fmtInt(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function fmtDeposit(d){return '$'+fmtInt(d);}
var M=DATA?DATA.model:{};
var DEPOSITS=[1000,5000,10000,25000];
var DEFAULT_DEPOSIT=(M&&M.default_deposit_usd)||5000;
function poolShare(){return (M&&M.airdrop_pool_share)||0.05;}
function depositShare(){return (M&&M.farming_deposit_tvl_share)||0.2;}
function oppApr(){return (M&&M.opp_cost_apr)||0.05;}
function horizonDays(){return (M&&M.horizon_days)||90;}
function computeFarm(row,deposit){
  var v=(DATA.calibration||{}).verdicts||{};
  var t1=v.t1_farm_now,t2=v.t2_selective;
  var pool=poolShare()*row.implied_value_usd;
  var deposits=depositShare()*row.tvl_usd;
  var share=deposits>0?deposit/deposits:0;
  var expected=pool*share*row.launch_odds;
  var opp=deposit*oppApr()*horizonDays()/365;
  var net=expected-row.farm_cost_usd-opp;
  var perHour=row.farm_hours>0?net/row.farm_hours:net;
  var verdict=perHour>=t1?'FARM NOW':perHour>=t2?'SELECTIVE':perHour>=0?'THIN':'SKIP';
  return{pool:pool,deposits:deposits,share:share,expected:expected,opp:opp,net:net,perHour:r2(perHour),verdict:verdict};
}

// Farm plan: 6 steps regenerated from the row. data.js carries only the
// numeric totals (farm_cost_usd, farm_hours), so the step text is rebuilt
// here. Amount tier follows TVL (≥$1B $150, ≥$100M $100, else $50); step-2
// gas is $8 for the $150 tier, $4 otherwise; step-3 cost/hours are backed
// out of the row's own totals; hold length follows the step-3 tier.
var TP={
vault:['Deposit {A} into a {N} vault on {C} and keep the shares.','Add a second, smaller deposit to a different {N} vault on {C} next week.'],
supply:['Supply {A} of USDC to {N} on {C} and keep the position open.','Borrow a little against the supply on {N}, repay it the same week.'],
deposit:['Deposit {A} of USDC into {N} on {C} and keep the position open.','Do one more deposit, swap or vote on {N} weekly — a different action from the first.'],
liquid:['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.','Swap a little through {N}\'s router on {C} each week.'],
stake:['Stake {A} of the chain\'s staking asset through {N} and keep the receipt.','Restake or delegate the receipt once, and vote in one governance proposal if {N} opens one.'],
yield:['Mint {A} of the protocol\'s yield asset on {C} and hold it.','Claim the yield monthly and leave the principal in place.'],
stable:['Mint or deposit {A} of the stable asset through {N} on {C}.','Use the minted stable asset in one payment or deposit on {C} weekly, then return it.'],
margin:['Deposit {A} of USDC as margin on {N} and open one small hedge.','Close the hedge and open a second small one next week, keeping the margin deposit in place.'],
market:['Fund {A} and place one market position on {N}.','Settle one market and open a second one next week, keeping the account funded.'],
bridge:['Bridge {A} of USDC to {C} through {N} and use the bridged funds in its app.','Use the bridged funds for one swap or deposit in an app on {C} the same week.'],
cover:['Buy {A} of cover from {N} on {C} and keep the policy.','Renew the cover once before it lapses.']};
var FC={};
[['vault','Risk Curators','Onchain Capital Allocator'],['supply','CDP','Collateral Markets','Lending','CDP Manager','Uncollateralized Lending'],['deposit','Chain','Basis Trading','Payments','OTC Marketplace','CeDeFi','Liquidity Manager','Farm','Anchor BTC','Governance Incentives','Decentralized BTC','Crypto Card Issuer'],['liquid','Yield Aggregator','Dexs','Yield','Leveraged Farming','Indexes'],['stake','Restaking','Staking Pool'],['yield','RWA'],['stable','Stablecoin Wrapper','Dual-Token Stablecoin'],['margin','Derivatives','Interest Rate Derivatives'],['market','Prediction Market'],['bridge','Cross Chain Bridge'],['cover','Insurance']].forEach(function(g){for(var i=1;i<g.length;i++)FC[g[i]]=g[0];});
function farmSteps(row){
  var amt=row.tvl_usd>=1e9?150:row.tvl_usd>=1e8?100:50;
  var c2=amt===150?8:4;
  var c3=row.farm_cost_usd-3-c2;
  var h3=row.farm_hours>=2?1.5:row.farm_hours>=1.45?1:0.667;
  var days=c3===18?60:c3===12?45:30;
  var tpl=TP[FC[row.category]||'deposit'];
  var ch=(row.chains&&row.chains[0])||'Ethereum';
  function sub(t){return t.split('{N}').join(row.name).split('{C}').join(ch).split('{A}').join('$'+amt);}
  return[
   {text:'Use a fresh wallet for farming only; keep its seed phrase offline. Cost: under $3 gas for the first transaction. Time: 5 minutes.',cost_usd:3,hours:0.083},
   {text:sub(tpl[0])+' Cost: $'+amt+' of capital and about $'+c2+' of gas. Time: 15 minutes to set up.',cost_usd:c2,hours:0.25},
   {text:sub(tpl[1])+' Cost: about $2 of gas a week. Time: 10 minutes a week.',cost_usd:c3,hours:h3},
   {text:'Hold the position at least '+days+' days so the activity is counted in more than one snapshot. Cost: the $'+amt+' stays in the position. Time: '+days+' days.',cost_usd:0,hours:0},
   {text:'Before withdrawing, open the protocol\'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check; never pay to claim. Time: 10 minutes.',cost_usd:0,hours:0.167},
   {text:'Log the wallet, the dates and every transaction so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',cost_usd:0,hours:0.083}
  ];
}

// State lives in the URL hash (#q=, #sort=, #dir=, #category=, #chain=,
// #verdict=, #watch=1, #minTvl=, #minImplied=, #tab=live, #detail=<slug>,
// #deposit=), so a link or screenshot preserves the exact view.
var SORT_KEYS=['implied','name','tvl','odds','risk-adj','perhour'];
var VERDICTS=['FARM NOW','SELECTIVE','THIN','SKIP'];
function defState(){return{q:'',sort:'implied',dir:-1,category:'',chain:'',verdict:'',watch:false,minTvl:0,minImplied:0,tab:'board',detail:'',deposit:DEFAULT_DEPOSIT};}
var state=defState();
var HK={q:function(s,v){s.q=v;},sort:function(s,v){if(SORT_KEYS.indexOf(v)>=0)s.sort=v;},dir:function(s,v){s.dir=v==='asc'?1:-1;},category:function(s,v){s.category=v;},chain:function(s,v){s.chain=v;},verdict:function(s,v){if(VERDICTS.indexOf(v)>=0)s.verdict=v;},watch:function(s,v){s.watch=v==='1';},minTvl:function(s,v){s.minTvl=parseInt(v,10)||0;},minImplied:function(s,v){s.minImplied=parseInt(v,10)||0;},tab:function(s,v){if(v==='board'||v==='live')s.tab=v;},detail:function(s,v){s.detail=v;},deposit:function(s,v){if(DEPOSITS.indexOf(parseInt(v,10))>=0)s.deposit=parseInt(v,10);}};
function readHash(){
  var s=defState();
  var raw=(window.location.hash||'').replace(/^#/,'');
  if(!raw)return s;
  raw.split('&').forEach(function(pair){
    var kv=pair.split('='),k=decodeURIComponent(kv[0]||''),v=decodeURIComponent(kv[1]||'');
    if(HK[k])HK[k](s,v);
  });
  return s;
}
function writeHash(){
  var p=[];
  if(state.q)p.push('q='+encodeURIComponent(state.q));
  if(state.sort!=='implied')p.push('sort='+state.sort);
  if(state.sort!=='implied'||state.dir!==-1)p.push('dir='+(state.dir===1?'asc':'desc'));
  if(state.category)p.push('category='+encodeURIComponent(state.category));
  if(state.chain)p.push('chain='+encodeURIComponent(state.chain));
  if(state.verdict)p.push('verdict='+encodeURIComponent(state.verdict));
  if(state.watch)p.push('watch=1');
  if(state.minTvl)p.push('minTvl='+state.minTvl);
  if(state.minImplied)p.push('minImplied='+state.minImplied);
  if(state.tab!=='board')p.push('tab='+state.tab);
  if(state.detail)p.push('detail='+encodeURIComponent(state.detail));
  if(state.deposit!==DEFAULT_DEPOSIT)p.push('deposit='+state.deposit);
  var h=p.length?'#'+p.join('&'):'';
  try{if(window.location.hash!==h)window.history.replaceState(null,'',h||window.location.pathname+window.location.search);}catch(e){}
}
var computedCache=null;
function computedRows(){
  if(computedCache)return computedCache;
  computedCache=DATA.rows.map(function(r){return{row:r,farm:computeFarm(r,state.deposit)};});
  return computedCache;
}
function invalidateComputed(){computedCache=null;}
function filteredRows(){
  var q=state.q.trim().toLowerCase();
  var out=computedRows().filter(function(c){
    var r=c.row;
    if(q&&r.name.toLowerCase().indexOf(q)<0&&r.slug.toLowerCase().indexOf(q)<0)return false;
    if(state.category&&r.category!==state.category)return false;
    if(state.chain&&(!r.chains||r.chains.indexOf(state.chain)<0))return false;
    if(state.verdict&&c.farm.verdict!==state.verdict)return false;
    if(state.watch&&DATA.watchlist.indexOf(r.slug)<0)return false;
    if(state.minTvl&&r.tvl_usd<state.minTvl)return false;
    if(state.minImplied&&r.implied_value_usd<state.minImplied)return false;
    return true;
  });
  var key=state.sort,d=state.dir;
  out.sort(function(a,b){
    var x,y;
    if(key==='name'){x=a.row.name.toLowerCase();y=b.row.name.toLowerCase();}
    else if(key==='tvl'){x=a.row.tvl_usd;y=b.row.tvl_usd;}
    else if(key==='odds'){x=a.row.launch_odds;y=b.row.launch_odds;}
    else if(key==='risk-adj'){x=a.row.risk_adj_usd;y=b.row.risk_adj_usd;}
    else if(key==='perhour'){x=a.farm.perHour;y=b.farm.perHour;}
    else{x=a.row.implied_value_usd;y=b.row.implied_value_usd;}
    if(x<y)return -d;
    if(x>y)return d;
    return a.row.rank-b.row.rank;
  });
  return out;
}
function verdictCounts(){
  var counts={'FARM NOW':0,'SELECTIVE':0,'THIN':0,'SKIP':0};
  computedRows().forEach(function(c){counts[c.farm.verdict]++;});
  return counts;
}
function isFiltered(){return !!(state.q||state.category||state.chain||state.verdict||state.watch||state.minTvl||state.minImplied);}
function peerComparables(row){
  var target=row.fitted_multiple;
  var scored=DATA.live.map(function(p){return{p:p,d:Math.abs(Math.log(p.ratio/target))};});
  scored.sort(function(a,b){return a.d-b.d;});
  return scored.slice(0,5).map(function(s){return s.p;});
}
function peerRatios(row){
  var scope=row.peer_category;
  var list=DATA.live.filter(function(p){return scope==='all live-token protocols'?true:p.category===scope;});
  return list.map(function(p){return p.ratio;}).sort(function(a,b){return a-b;});
}
function medianOf(sorted){
  if(!sorted.length)return null;
  var n=sorted.length,mid=Math.floor(n/2);
  return n%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}
function logBins(values,nBins){
  var vals=values.filter(function(v){return v>0;}).sort(function(a,b){return a-b;});
  if(!vals.length)return{bins:[],topLo:null,topHi:null,topCount:0};
  var lo=vals[0],hi=vals[vals.length-1];
  if(hi<=lo)hi=lo*10;
  var logLo=Math.log10(lo),logHi=Math.log10(hi);
  var edges=[];
  for(var i=0;i<=nBins;i++)edges.push(roundSig(Math.pow(10,logLo+(logHi-logLo)*i/nBins),2));
  edges[0]=lo;edges[nBins]=hi;
  var bins=[];
  for(var j=0;j<nBins;j++){
    var count=vals.filter(function(v){return j===nBins-1?(v>=edges[j]&&v<=edges[j+1]):(v>=edges[j]&&v<edges[j+1]);}).length;
    bins.push({lo:edges[j],hi:edges[j+1],count:count});
  }
  var best=0,bestCount=-1;
  for(var k=0;k<nBins-1;k++){var c=bins[k].count+bins[k+1].count;if(c>bestCount){bestCount=c;best=k;}}
  return{bins:bins,topLo:bins[best].lo,topHi:bins[best+1].hi,topCount:bestCount};
}
function roundSig(x,sig){
  if(x<=0)return x;
  var p=Math.pow(10,sig-1-Math.floor(Math.log10(x)));
  return Math.round(x*p)/p;
}
var SVGNS='http://www.w3.org/2000/svg';
function svgEl(tag,attrs,parent){
  var n=document.createElementNS(SVGNS,tag);
  Object.keys(attrs).forEach(function(k){n.setAttribute(k,attrs[k]);});
  if(parent)parent.appendChild(n);
  return n;
}
function svgText(parent,x,y,s,cls,anchor){
  var t=svgEl('text',{x:x,y:y,'class':cls||''},parent);
  if(anchor)t.setAttribute('text-anchor',anchor);
  t.textContent=s;
  return t;
}

function renderHeader(root){
  var head=A(root,'header','ph');
  var left=A(head,'div','hl');
  A(left,'div','eyebrow','TOKEN RADAR · '+(DATA.model_version||'radar-4').toUpperCase()+' · SNAPSHOT '+DATA.as_of);
  A(left,'h1',null,'Pre-token protocols: calibrated implied value, launch odds & farming verdicts');
  A(left,'p','subtitle','Every row records no token. Ranked by calibrated implied value with held-out error bands, snapshot launch propensity, risk-adjusted value, live $/hr verdicts.');
  var stats=A(head,'div','scs');
  [[DATA.watchlist_size,'WATCHLIST'],[DATA.board_size,'BOARD ROWS'],[DATA.early_size,'EARLY FINDS'],[DATA.live_size,'LIVE TOKENS']].forEach(function(s){
    var card=A(stats,'div','sc');
    A(card,'div','sn',fmtInt(s[0]));
    A(card,'div','sl',s[1]);
  });
}
function renderModelBox(root){
  var cal=DATA.calibration||{};
  var v=cal.verdicts||{};
  var box=A(root,'section','mx');
  var win=(cal.bakeoff||[]).filter(function(b){return b.winner;})[0]||{};
  var line1=document.createElement('p');
  line1.innerHTML='<strong>Model '+esc(DATA.model_version||'radar-4')+' ('+esc(win.name||cal.winner||'')+'):</strong> held-out median error <strong>'+pct(cal.winner_mape,1)+'</strong> (median: '+pct(cal.median_mape,1)+', beats it by '+tn((cal.median_mape||0)-(cal.winner_mape||0),1)+' pts); range = fitted ÷/× (1 + held-out MAPE). <strong>Launch odds</strong> = logistic fit on '+fmtInt((cal.odds_model||{}).sample_size||758)+' protocols (AUC '+tn(((cal.odds_model||{}).cv5||{}).auc||0,3)+'): snapshot propensity / lower bound — see Method; risk-adjusted = implied × odds.';
  var line2=document.createElement('p');
  line2.innerHTML='Verdicts from $/hr at the selected deposit (T1=$'+fmtInt(v.t1_farm_now||0)+'/h, T2=$'+fmtInt(v.t2_selective||0)+'/h); assumptions: airdrop pool '+Math.round(poolShare()*100)+'% of implied, deposits '+Math.round(depositShare()*100)+'% of TVL, '+Math.round(oppApr()*100)+'% opp. cost/yr over '+horizonDays()+' days. Coverage: '+fmtInt((DATA.exclusions||{}).total_pre_token||0)+' pre-token → '+fmtInt(DATA.board_size)+' ranked ('+fmtInt((DATA.exclusions||{}).excluded_total||0)+' excluded).';
  box.appendChild(line1);box.appendChild(line2);
}
function renderCharts(root,rows){
  var wrap=A(root,'div','cr');
  wrap.appendChild(top10Chart(rows));
  wrap.appendChild(scatterPlot(rows));
}
function top10Chart(rows){
  var sec=A(null,'section','cc');
  var head=A(sec,'div','ch');
  A(head,'h2',null,isFiltered()?'Top 10 matching by implied value':'Top 10 pre-token by implied value');
  A(head,'span','ci','Linear scale · click bar');
  var top=rows.slice(0,10);
  var max=top.length?top[0].row.implied_value_usd:1;
  var list=A(sec,'div','t10');
  top.forEach(function(c){
    var r=c.row;
    var item=A(list,'div','t10r');
    D(item,{act:'detail',slug:r.slug});
    item.setAttribute('title',r.name+' — '+fmtMoney(r.implied_value_usd));
    A(item,'span','t10k','#'+r.rank);
    A(item,'span','t10n',r.name);
    var barWrap=A(item,'span','t10w');
    var bar=A(barWrap,'span','t10b');
    bar.style.width=Math.max(2,(r.implied_value_usd/max)*100)+'%';
    A(item,'span','t10v',fmtMoney(r.implied_value_usd));
  });
  if(!top.length)A(list,'p','en','No rows match the current filters.');
  return sec;
}
function scatterPlot(rows){
  var sec=A(null,'section','cc');
  var head=A(sec,'div','ch');
  A(head,'h2',null,'Market pricing: TVL vs mcap/TVL');
  var legend=A(head,'span','ci');
  legend.innerHTML='<span class="dot dot-live"></span> Live ('+DATA.live_size+') &nbsp; <span class="dot dot-top"></span> Top 20';
  var W=560,H=300,padL=46,padR=12,padT=10,padB=30;
  var live=DATA.live;
  var top20=rows.slice(0,20).map(function(c){return c.row;});
  var xs=live.map(function(p){return p.tvl_usd;}).concat(top20.map(function(r){return r.tvl_usd;}));
  var ys=live.map(function(p){return p.ratio;}).concat(top20.map(function(r){return r.implied_value_usd/r.tvl_usd;}));
  var xLo=Math.log10(Math.min.apply(null,xs)),xHi=Math.log10(Math.max.apply(null,xs));
  var yLo=Math.log10(Math.min.apply(null,ys)),yHi=Math.log10(Math.max.apply(null,ys));
  xLo=Math.floor(xLo);xHi=Math.ceil(xHi);
  yLo=Math.floor(yLo*2)/2;yHi=Math.ceil(yHi*2)/2;
  function X(v){return padL+(Math.log10(v)-xLo)/(xHi-xLo)*(W-padL-padR);}
  function Y(v){return padT+(yHi-Math.log10(v))/(yHi-yLo)*(H-padT-padB);}
  var svg=svgEl('svg',{viewBox:'0 0 '+W+' '+H,'class':'plot',role:'img','aria-label':'Scatter plot of live market pricing'});
  var x;
  for(x=xLo;x<=xHi;x++){
    var gx=X(Math.pow(10,x));
    svgEl('line',{x1:gx,y1:padT,x2:gx,y2:H-padB,'class':'grid'},svg);
    svgText(svg,gx,H-padB+18,'$'+(x>=9?(Math.pow(10,x-9))+'B':(Math.pow(10,x-6))+'M'),'tick','middle');
  }
  [0.02,0.05,0.2,1,5,20].forEach(function(t){
    if(t<Math.pow(10,yLo)||t>Math.pow(10,yHi))return;
    var gy=Y(t);
    svgEl('line',{x1:padL,y1:gy,x2:W-padR,y2:gy,'class':'grid'},svg);
    svgText(svg,padL-6,gy+4,t+'×','tick','end');
  });
  var gm=DATA.global_multiple;
  if(gm>0)svgEl('line',{x1:padL,y1:Y(gm),x2:W-padR,y2:Y(gm),'class':'ref-median'},svg);
  var coef=((DATA.calibration||{}).coefficients||{}).global||{};
  if(coef.a!==undefined&&coef.b!==undefined){
    var x0=Math.pow(10,xLo),x1=Math.pow(10,xHi);
    var m0=Math.exp(coef.a+(coef.b-1)*Math.log(x0));
    var m1=Math.exp(coef.a+(coef.b-1)*Math.log(x1));
    svgEl('line',{x1:padL,y1:clamp(Y(m0),padT,H-padB),x2:W-padR,y2:clamp(Y(m1),padT,H-padB),'class':'ref-fit'},svg);
  }
  live.forEach(function(p){svgEl('circle',{cx:X(p.tvl_usd).toFixed(1),cy:Y(p.ratio).toFixed(1),r:3,'class':'dot-live-pt'},svg);});
  top20.forEach(function(r){svgEl('circle',{cx:X(r.tvl_usd).toFixed(1),cy:Y(r.implied_value_usd/r.tvl_usd).toFixed(1),r:4,'class':'dot-top-pt'},svg);});
  sec.appendChild(svg);
  A(sec,'p','cp','Top pre-token rows in the live market cloud (grey dashed: global median '+fmtMultiple(DATA.global_multiple)+'; amber: '+(DATA.calibration.winner||'ols-global')+' fit).');
  return sec;
}
function depositPicker(){
  var dep=A(null,'div','dp');
  A(dep,'span','dl','Deposit:');
  DEPOSITS.forEach(function(d){
    var b=A(dep,'button','db'+(state.deposit===d?' on':''),fmtDeposit(d));
    D(b,{act:'deposit',deposit:String(d)});
  });
  return dep;
}
function renderTabs(root){
  var bar=A(root,'div','tabs-row');
  var tabs=A(bar,'div','tabs');
  var bTab=A(tabs,'button','tab'+(state.tab==='board'?' on':''),'Pre-token board ('+DATA.board_size+')');
  D(bTab,{act:'tab',tab:'board'});
  var lTab=A(tabs,'button','tab'+(state.tab==='live'?' on':''),'Live tokens ('+DATA.live_size+')');
  D(lTab,{act:'tab',tab:'live'});
  bar.appendChild(depositPicker());
  var counts=verdictCounts();
  A(root,'p','vl',counts['FARM NOW']+' FARM NOW · '+counts.SELECTIVE+' SELECTIVE · '+counts.THIN+' THIN · '+counts.SKIP+' SKIP at '+fmtDeposit(state.deposit));
}

function filterSelect(kind,allLabel,values,current,labels){
  var sel=A(null,'select','ft');
  D(sel,{act:'filter-'+kind});
  sel.setAttribute('aria-label',allLabel);
  var all=A(sel,'option',null,allLabel);
  all.value='';
  if(!current)all.selected=true;
  values.forEach(function(v,i){
    var opt=A(sel,'option',null,labels?labels[i]:v);
    opt.value=v;
    if(current===v)opt.selected=true;
  });
  return sel;
}
function uniqueValues(arr){
  var seen={},out=[];
  arr.forEach(function(v){if(v&&!seen[v]){seen[v]=true;out.push(v);}});
  return out.sort();
}
function renderFilters(root,filteredCount){
  var bar=A(root,'div','fb');
  var search=A(bar,'input','fs');
  search.type='search';
  search.placeholder='Search name or slug…';
  search.value=state.q;
  D(search,{act:'search'});
  search.setAttribute('aria-label','Search name or slug');
  bar.appendChild(filterSelect('category','All categories',uniqueValues(DATA.rows.map(function(r){return r.category;})),state.category));
  bar.appendChild(filterSelect('chain','All chains',uniqueValues(DATA.rows.reduce(function(a,r){return a.concat(r.chains||[]);},[])),state.chain));
  bar.appendChild(filterSelect('verdict','All verdicts',VERDICTS.map(function(v){return v.toLowerCase().replace(/ /g,'-');}),state.verdict,VERDICTS));
  var watchBtn=A(bar,'button','chip'+(state.watch?' on':''),'Watchlist');
  D(watchBtn,{act:'toggle-watch'});
  var tvlBtn=A(bar,'button','chip'+(state.minTvl>=100000000?' on':''),'TVL ≥ $100M');
  D(tvlBtn,{act:'toggle-mintvl'});
  var impBtn=A(bar,'button','chip'+(state.minImplied>=50000000?' on':''),'Implied ≥ $50M');
  D(impBtn,{act:'toggle-minimplied'});
  var sortSel=A(bar,'select','fo');
  D(sortSel,{act:'sort-select'});
  sortSel.setAttribute('aria-label','Sort by');
  ['implied','risk-adj','odds','perhour','tvl','name'].forEach(function(k){
    var opt=A(sortSel,'option',null,'Sort: '+(k==='perhour'?'$/h':k==='tvl'?'TVL':k));
    opt.value=k;
    if(state.sort===k)opt.selected=true;
  });
  if(isFiltered()){
    var reset=A(bar,'button','chip reset-btn','Reset');
    D(reset,{act:'reset'});
  }
  A(root,'p','rc',fmtInt(filteredCount)+' of '+fmtInt(DATA.board_size)+' protocols'+(state.verdict?' · '+state.verdict:''));
}
function verdictBadge(v){
  var cls=v==='FARM NOW'?'v-farm':v==='SELECTIVE'?'v-select':v==='THIN'?'v-thin':'v-skip';
  return '<span class="verdict '+cls+'">'+esc(v)+'</span>';
}
function rankCell(c){
  var r=c.row;
  var range=(r.rank_min!==r.rank_max)?' ('+r.rank_min+'–'+r.rank_max+')':'';
  return '<span class="rnu">#'+r.rank+'</span>'+(range?'<span class="rr">'+esc(range)+'</span>':'');
}
function renderBoard(root,rows){
  var wrap=A(root,'div','tw');
  var table=A(wrap,'table','board');
  var thead=A(table,'thead');
  var hr=A(thead,'tr');
  ['rank','name','chains','tvl','chg','age','implied','odds','risk-adj','verdict','perhour'].forEach(function(k){
    var th=A(hr,'th');
    D(th,{act:'sort',sort:k});
    var lbl={rank:'#',name:'PROTOCOL',chg:'7D',perhour:'$/H'}[k]||k.toUpperCase();
    var arrow=(['implied','name','tvl','odds','risk-adj','perhour'].indexOf(k)>=0&&state.sort===k)?(state.dir===1?' ↑':' ↓'):'';
    th.textContent=lbl+arrow;
  });
  var tbody=A(table,'tbody');
  rows.forEach(function(c){
    var r=c.row,f=c.farm;
    var tr=A(tbody,'tr');
    D(tr,{act:'detail',slug:r.slug});
    var chgCls=r.change_7d>0?'pos':r.change_7d<0?'neg':'';
    var phCls=f.perHour>=0?'pos':'neg';
    var chains=(r.chains||[]).slice(0,2).join(', ')+((r.chains||[]).length>2?'…':'');
    var watch=DATA.watchlist.indexOf(r.slug)>=0;
    tr.innerHTML='<td class="rk">'+rankCell(c)+'</td>'+
      '<td class="nm"><span class="pn">'+esc(r.name)+'</span>'+
      (watch?' <span class="badge wb">watchlist</span>':'')+
      ' <span class="badge ct">'+esc(r.category)+'</span></td>'+
      '<td class="chn">'+esc(chains)+'</td>'+
      '<td class="n">'+fmtMoney(r.tvl_usd)+'</td>'+
      '<td class="n '+chgCls+'">'+fmtPct(r.change_7d)+'</td>'+
      '<td class="n">'+fmtAge(r.age_days)+'</td>'+
      '<td class="n"><span class="iv">'+fmtMoney(r.implied_value_usd)+'</span>'+
      '<span class="ir">'+fmtMoney(r.implied_low_usd)+'–'+fmtMoney(r.implied_high_usd)+'</span></td>'+
      '<td class="n">'+fmtOdds(r.launch_odds)+'</td>'+
      '<td class="n">'+fmtMoney(r.risk_adj_usd)+'</td>'+
      '<td class="vd">'+verdictBadge(f.verdict)+'</td>'+
      '<td class="n '+phCls+'">'+fmtPerHour(f.perHour)+'</td>';
  });
  if(!rows.length)A(wrap,'p','en','No rows match the current filters.');
}
function renderLive(root){
  var live=DATA.live.slice().sort(function(a,b){return b.mcap_usd-a.mcap_usd;});
  var wrap=A(root,'div','tw');
  var table=A(wrap,'table','board live-table');
  var thead=A(table,'thead');
  var hr=A(thead,'tr');
  ['#','PROTOCOL','CATEGORY','TVL','MARKET CAP','MCAP / TVL','7D'].forEach(function(h){A(hr,'th',null,h);});
  var tbody=A(table,'tbody');
  live.forEach(function(p,i){
    var tr=A(tbody,'tr');
    var chgCls=p.change_7d>0?'pos':p.change_7d<0?'neg':'';
    tr.innerHTML='<td class="rk"><span class="rnu">#'+(i+1)+'</span></td>'+
      '<td class="nm"><span class="pn">'+esc(p.name)+'</span></td>'+
      '<td><span class="badge ct">'+esc(p.category)+'</span></td>'+
      '<td class="n">'+fmtMoney(p.tvl_usd)+'</td>'+
      '<td class="n">'+fmtMoney(p.mcap_usd)+'</td>'+
      '<td class="n">'+fmtMultiple(p.ratio)+'</td>'+
      '<td class="n '+chgCls+'">'+fmtPct(p.change_7d)+'</td>';
  });
  A(root,'p','rc',fmtInt(live.length)+' live-token protocols with a market cap, sorted by market cap — the comparables the value model is fitted on.');
}

function renderMethod(root){
  var sec=A(root,'section','method');
  A(sec,'h2','st','Method — how the board is built');
  var cal=DATA.calibration||{};
  var bakeoff=cal.bakeoff||[];
  var ablation=cal.ablation||[];
  var odds=cal.odds_model||{};
  var bt=A(sec,'div','mb');
  A(bt,'h3',null,'Model bake-off — held-out median error (MAPE)');
  var bTable=A(bt,'table','mt');
  bTable.innerHTML='<thead><tr><th>CANDIDATE</th><th>PARAMS</th><th>5-FOLD</th><th>WALK-FORWARD</th><th>LEAVE-ONE-OUT</th><th></th></tr></thead>';
  var bBody=A(bTable,'tbody');
  bakeoff.forEach(function(b){
    var tr=A(bBody,'tr');
    if(b.winner)tr.className='wr';
    tr.innerHTML='<td>'+esc(b.label||b.name)+'</td>'+
      '<td class="n">'+esc(b.params)+'</td>'+
      '<td class="n">'+pct(b.mape,2)+'</td>'+
      '<td class="n">'+pct(b.wf_mape,2)+'</td>'+
      '<td class="n">'+pct(b.loo_mape,2)+'</td>'+
      '<td>'+(b.winner?'<span class="badge wnb">winner</span>':'')+'</td>';
  });
  A(bt,'p','mn','Winner by 5-fold MAPE ('+esc(cal.fold_scheme||'')+'). Walk-forward splits the '+fmtInt(cal.live_sample_size)+' live protocols by listing date at '+esc(((cal.walk_forward||{}).split_date)||'')+' ('+fmtInt(((cal.walk_forward||{}).train_count)||0)+' train / '+fmtInt(((cal.walk_forward||{}).test_count)||0)+' test). Leave-one-out refits on the other 118 for each of the 119 in turn.');
  if(ablation.length){
    var at=A(sec,'div','mb');
    A(at,'h3',null,'Ablation — every variant tried');
    var aTable=A(at,'table','mt');
    aTable.innerHTML='<thead><tr><th>VARIANT</th><th>PARAMS</th><th>5-FOLD MAPE</th><th>VERDICT</th></tr></thead>';
    var aBody=A(aTable,'tbody');
    ablation.forEach(function(a){
      var tr=A(aBody,'tr');
      if(a.kept)tr.className='wr';
      tr.innerHTML='<td>'+esc(a.name)+'</td>'+
        '<td class="n">'+esc(a.params)+'</td>'+
        '<td class="n">'+pct(a.mape,2)+'</td>'+
        '<td>'+esc(a.note||'')+'</td>';
    });
  }
  var ot=A(sec,'div','mb');
  A(ot,'h3',null,'Launch odds — logistic fit on the snapshot');
  A(ot,'p','mn','Target is "has a token in the snapshot", so a pre-token protocol that launches later still counts as 0. The odds are a snapshot-based launch propensity — a lower bound on the true launch probability, never "the probability it will launch". Features: log10 TVL, log10 age (unknown = 365d), 7-day change, chain count, category launch rate. Fitted by deterministic IRLS on all '+fmtInt(odds.sample_size||758)+' protocols ('+fmtInt(odds.token_count||0)+' with a token, '+fmtInt(odds.pre_token_count||0)+' pre-token).');
  var coef=odds.coefficients||cal.odds_coefficients||{};
  A(ot,'p','mn','Coefficients — intercept '+tn(coef.intercept||0,3)+' · log TVL '+tn(coef.log_tvl||0,3)+' · log age '+tn(coef.log_age||0,3)+' · 7d '+tn(coef.chg_7d||0,3)+' · chains '+tn(coef.n_chains||0,3)+' · cat. rate '+tn(coef.cat_launch_rate||0,3)+' ('+(odds.converged?'converged in '+odds.iterations||0+' iters':'no convergence in 100 iters')+(odds.ridge?', ridge '+odds.ridge:'')+').');
  var oTable=A(ot,'table','mt');
  oTable.innerHTML='<thead><tr><th>SPLIT</th><th>AUC</th><th>BRIER</th><th>BASE-RATE BRIER</th></tr></thead>';
  var oBody=A(oTable,'tbody');
  [['5-fold',odds.cv5],['Walk-forward',odds.walk_forward],['Leave-one-out',odds.loo]].forEach(function(row){
    var s=row[1]||{};
    var tr=A(oBody,'tr');
    tr.innerHTML='<td>'+esc(row[0])+'</td>'+
      '<td class="n">'+tn(s.auc||0,3)+'</td>'+
      '<td class="n">'+tn(s.brier||0,4)+'</td>'+
      '<td class="n">'+tn(s.base_brier||0,4)+'</td>';
  });
  var bins=odds.calibration_bins||[];
  if(bins.length){
    var binTable=A(ot,'table','mt');
    binTable.innerHTML='<thead><tr><th>ODDS BIN</th><th>PROTOCOLS</th><th>MEAN PREDICTED</th><th>ACTUAL LAUNCH RATE</th></tr></thead>';
    var binBody=A(binTable,'tbody');
    bins.forEach(function(b){
      var tr=A(binBody,'tr');
      tr.innerHTML='<td>'+Math.round(b.min_odds*100)+'% – '+Math.round(b.max_odds*100)+'%</td>'+
        '<td class="n">'+fmtInt(b.count)+'</td>'+
        '<td class="n">'+pct(b.mean_predicted*100,1)+'</td>'+
        '<td class="n">'+pct(b.actual_rate*100,1)+'</td>';
    });
  }
  sec.appendChild(calibrationPlot());
  var catSec=A(sec,'div','mb');
  A(catSec,'h3',null,'Category summary');
  var catTable=A(catSec,'table','mt');
  catTable.innerHTML='<thead><tr><th>CATEGORY</th><th>ROWS</th><th>MEDIAN IMPLIED</th><th>TOP PROTOCOL</th></tr></thead>';
  var catBody=A(catTable,'tbody');
  var byCat={};
  DATA.rows.forEach(function(r){(byCat[r.category]=byCat[r.category]||[]).push(r);});
  Object.keys(byCat).filter(function(c){return byCat[c].length>=3;}).map(function(c){
    var vals=byCat[c].map(function(r){return r.implied_value_usd;}).sort(function(a,b){return a-b;});
    var top=byCat[c].slice().sort(function(a,b){return b.implied_value_usd-a.implied_value_usd;})[0];
    return{cat:c,n:byCat[c].length,med:medianOf(vals),top:top};
  }).sort(function(a,b){return b.med-a.med;}).forEach(function(c){
    var tr=A(catBody,'tr');
    tr.innerHTML='<td>'+esc(c.cat)+'</td>'+
      '<td class="n">'+fmtInt(c.n)+'</td>'+
      '<td class="n">'+fmtMoney(c.med)+'</td>'+
      '<td>'+esc(c.top.name)+' ('+fmtMoney(c.top.implied_value_usd)+')</td>';
  });
  sec.appendChild(distributionHistogram());
  var ex=DATA.exclusions||{};
  A(sec,'p','mn','Coverage: '+fmtInt(ex.total_pre_token||0)+' pre-token in the snapshot → '+fmtInt(ex.ranked||0)+' ranked. Excluded '+fmtInt(ex.excluded_total||0)+' by the rankable rule: '+fmtInt(ex.wrapped_category||0)+' wrapped category, '+fmtInt(ex.versioned_name||0)+' versioned name, '+fmtInt(ex.wrapped_word||0)+' wrapped word, '+fmtInt(ex.exchange_name||0)+' exchange name. Watchlist ('+fmtInt(DATA.watchlist_size)+') fully covered.');
}
function calibrationPlot(){
  var block=A(null,'div','mb');
  A(block,'h3',null,'Calibration — predicted vs actual market cap (live protocols)');
  var live=DATA.live.filter(function(p){return p.cv_predicted_mcap_usd>0&&p.mcap_usd>0;});
  var W=560,H=300,padL=56,padR=14,padT=10,padB=32;
  var xs=live.map(function(p){return p.mcap_usd;});
  var ys=live.map(function(p){return p.cv_predicted_mcap_usd;});
  var lo=Math.log10(Math.min.apply(null,xs.concat(ys)));
  var hi=Math.log10(Math.max.apply(null,xs.concat(ys)));
  lo=Math.floor(lo);hi=Math.ceil(hi);
  function X(v){return padL+(Math.log10(v)-lo)/(hi-lo)*(W-padL-padR);}
  function Y(v){return padT+(hi-Math.log10(v))/(hi-lo)*(H-padT-padB);}
  var svg=svgEl('svg',{viewBox:'0 0 '+W+' '+H,'class':'plot',role:'img','aria-label':'Calibration plot'});
  function moneyTick(e){return '$'+(e>=9?Math.pow(10,e-9)+'B':e>=6?Math.pow(10,e-6)+'M':Math.pow(10,e-3)+'K');}
  for(var e=lo;e<=hi;e++){
    var gx=X(Math.pow(10,e));
    svgEl('line',{x1:gx,y1:padT,x2:gx,y2:H-padB,'class':'grid'},svg);
    svgText(svg,gx,H-padB+18,moneyTick(e),'tick','middle');
    var gy=Y(Math.pow(10,e));
    svgEl('line',{x1:padL,y1:gy,x2:W-padR,y2:gy,'class':'grid'},svg);
    svgText(svg,padL-6,gy+4,moneyTick(e),'tick','end');
  }
  svgEl('line',{x1:padL,y1:Y(Math.pow(10,lo)),x2:W-padR,y2:Y(Math.pow(10,hi)),'class':'ref-fit'},svg);
  live.forEach(function(p){svgEl('circle',{cx:X(p.mcap_usd).toFixed(1),cy:Y(p.cv_predicted_mcap_usd).toFixed(1),r:3,'class':'dot-live-pt'},svg);});
  block.appendChild(svg);
  var cal=DATA.calibration||{};
  A(block,'p','cp','Each dot is one live protocol: actual market cap (x) vs the model\'s cross-validated prediction (y). Diagonal = perfect prediction. Winner held-out MAPE '+pct(cal.winner_mape,1)+' over '+fmtInt(live.length)+' protocols.');
  return block;
}
function distributionHistogram(){
  var block=A(null,'div','mb');
  A(block,'h3',null,'Implied-value distribution');
  var values=DATA.rows.map(function(r){return r.implied_value_usd;});
  var res=logBins(values,6);
  var W=560,H=180,padL=46,padR=12,padT=8,padB=30;
  var maxC=Math.max.apply(null,res.bins.map(function(b){return b.count;}).concat([1]));
  var bw=(W-padL-padR)/res.bins.length;
  var svg=svgEl('svg',{viewBox:'0 0 '+W+' '+H,'class':'plot',role:'img','aria-label':'Implied value histogram'});
  res.bins.forEach(function(b,i){
    var h=(b.count/maxC)*(H-padT-padB);
    var x=padL+i*bw+2,y=H-padB-h;
    svgEl('rect',{x:x.toFixed(1),y:y.toFixed(1),width:(bw-4).toFixed(1),height:Math.max(h,1).toFixed(1),'class':'hist-bar'},svg);
    svgText(svg,x+(bw-4)/2,y-4,String(b.count),'tick','middle');
    svgText(svg,x+(bw-4)/2,H-padB+16,fmtMoney(b.lo),'tick','middle');
  });
  svgText(svg,W-padR,H-padB+16,fmtMoney(res.bins[res.bins.length-1].hi),'tick','end');
  block.appendChild(svg);
  var total=values.length;
  var pc=res.topCount&&total?Math.round(res.topCount/total*100):0;
  A(block,'p','cp',res.topCount+' of '+total+' rows ('+pc+'%) sit between '+fmtMoney(res.topLo)+' and '+fmtMoney(res.topHi)+'. Bins are log-spaced from the board\'s own min to max.');
  return block;
}

function findRow(slug){
  var found=null;
  DATA.rows.forEach(function(r){if(r.slug===slug)found=r;});
  return found;
}
function whyLine(row){
  var catRows=DATA.rows.filter(function(r){return r.category===row.category;});
  var byTvl=catRows.slice().sort(function(a,b){return b.tvl_usd-a.tvl_usd;});
  var pos=0;
  byTvl.forEach(function(r,i){if(r.slug===row.slug)pos=i+1;});
  var chg=row.no_7d_data?'no 7-day change data':(row.change_7d>0?'up ':row.change_7d<0?'down ':'flat ')+(row.change_7d===0?'':Math.abs(row.change_7d).toFixed(2)+'% in 7 days');
  var age='listed '+fmtAge(row.age_days)+' ago'+(row.age_estimated?' (age estimated)':'');
  return '#'+pos+' of '+catRows.length+' in '+row.category+' by pre-token TVL ('+fmtMoney(row.tvl_usd)+'), '+chg+', '+age+'.';
}
function renderDetail(root,slug){
  var row=findRow(slug);
  if(!row){
    A(root,'p','en','No protocol with slug "'+slug+'".');
    var back0=A(root,'button','chip','← Back to board');
    D(back0,{act:'back'});
    return;
  }
  var farm=computeFarm(row,state.deposit);
  var cal=DATA.calibration||{};
  var bar=A(root,'div','dtb');
  var back=A(bar,'button','chip bb','← Back to board');
  D(back,{act:'back'});
  bar.appendChild(depositPicker());
  var prev=DATA.rows.filter(function(r){return r.rank===row.rank-1;})[0];
  var next=DATA.rows.filter(function(r){return r.rank===row.rank+1;})[0];
  var nav=A(bar,'div','rn');
  if(prev){
    var pb=A(nav,'button','chip','← #'+prev.rank+' '+prev.name);
    D(pb,{act:'detail',slug:prev.slug});
  }
  if(next){
    var nb=A(nav,'button','chip','#'+next.rank+' '+next.name+' →');
    D(nb,{act:'detail',slug:next.slug});
  }
  var titleRow=A(root,'div','dtr');
  A(titleRow,'h1','dti','#'+row.rank+' '+row.name);
  var badges=A(titleRow,'div','dbd');
  badges.innerHTML=verdictBadge(farm.verdict);
  if(DATA.watchlist.indexOf(row.slug)>=0)badges.innerHTML+=' <span class="badge wb">watchlist</span>';
  badges.innerHTML+=' <span class="badge ct">'+esc(row.category)+'</span>';
  badges.innerHTML+=' <span class="badge">records no token</span>';
  if(row.global_fit)badges.innerHTML+=' <span class="badge">global fit</span>';
  if(row.winsorized)badges.innerHTML+=' <span class="badge">P5–P95 clamped</span>';
  if(row.age_estimated)badges.innerHTML+=' <span class="badge">age estimated</span>';
  if(row.no_7d_data)badges.innerHTML+=' <span class="badge">no 7d data</span>';
  A(root,'p','wl',whyLine(row));
  A(root,'p','cl','Chains: '+(row.chains||[]).join(', '));
  var cards=A(root,'div','dca');
  function card(label,big,small,cls){
    var c=A(cards,'div','dc'+(cls?' '+cls:''));
    A(c,'div','dcl',label);
    A(c,'div','dcb',big);
    if(small)A(c,'div','dcs',small);
    return c;
  }
  var mapeLabel=row.model_mape_scope==='category'?'category error':'global error';
  card('IMPLIED VALUE',fmtMoney(row.implied_value_usd),'range '+fmtMoney(row.implied_low_usd)+'–'+fmtMoney(row.implied_high_usd),'cg');
  card('LAUNCH ODDS',fmtOdds(row.launch_odds),'snapshot propensity (lower bound)');
  card('RISK-ADJUSTED VALUE',fmtMoney(row.risk_adj_usd),'implied × odds');
  card('FARMING $/H (@'+fmtDeposit(state.deposit)+')',fmtPerHour(farm.perHour),'net '+fmtMoney(farm.net)+' · gas $'+fmtInt(row.farm_cost_usd)+' · '+fmtHours(row.farm_hours),farm.perHour>=0?'cg':'cb');
  card('TVL',fmtMoney(row.tvl_usd),fmtInt((row.chains||[]).length)+' chains');
  card('7-DAY CHANGE',fmtPct(row.change_7d),'growth '+tn(row.growth_multiplier,2)+'×',row.change_7d>0?'cg':row.change_7d<0?'cb':'');
  card('AGE (NO TOKEN)',fmtAge(row.age_days),'maturity '+tn(row.maturity_multiplier,2)+'×');
  var fitScope=row.fit_scope==='global'?'OLS-GLOBAL':('OLS-'+String(row.fit_scope||'').toUpperCase());
  card('FITTED ('+fitScope+')',fmtMultiple(row.fitted_multiple),'cat '+(row.category_median_multiple==null?'n/a':fmtMultiple(row.category_median_multiple))+' · glob '+fmtMultiple(row.global_median_multiple)+' · MAPE '+pct(row.model_mape,1)+' ('+mapeLabel+')');
  var formula=A(root,'div','fbx');
  A(formula,'p',null,'TVL '+fmtMoney(row.tvl_usd)+' × fitted '+fmtMultiple(row.fitted_multiple)+' × growth '+tn(row.growth_multiplier,2)+' × maturity '+tn(row.maturity_multiplier,2)+' = '+fmtMoney(row.implied_value_usd)+' (range '+fmtMoney(row.implied_low_usd)+'–'+fmtMoney(row.implied_high_usd)+', ÷/× (1 + '+pct(row.model_mape,1)+' MAPE)). Expected = implied '+fmtMoney(row.implied_value_usd)+' × odds '+fmtOdds(row.launch_odds)+' = '+fmtMoney(row.risk_adj_usd)+' — verified live.');
  A(formula,'p',null,'Farming ('+fmtDeposit(state.deposit)+'): pool '+fmtMoney(farm.pool,2)+' ('+Math.round(poolShare()*100)+'%) × share '+tn(farm.share*100,5)+'% ('+Math.round(depositShare()*100)+'% TVL) × odds '+fmtOdds(row.launch_odds)+' − gas $'+fmtInt(row.farm_cost_usd)+' − opp. $'+fmtInt(Math.round(farm.opp))+' ('+Math.round(oppApr()*100)+'%/'+horizonDays()+'d) = net '+fmtMoney(farm.net)+' over '+fmtHours(row.farm_hours)+' → '+fmtPerHour(farm.perHour)+'/h ('+farm.verdict+').');
  var peers=peerComparables(row);
  var peerSec=A(root,'section','ps');
  var peerHead=A(peerSec,'div','phd');
  A(peerHead,'h2',null,'Peer comparables');
  var peerCap=A(peerHead,'span','ci');
  peerCap.innerHTML=(row.peer_category==='all live-token protocols'?'<span class="badge">global median fallback</span>':'<span class="badge">'+esc(row.peer_category)+' peers</span>')+' '+esc(row.peer_category)+' has '+(row.peer_category==='all live-token protocols'?'no category peers':row.peer_count+' live peers')+' – 5 closest to fitted '+fmtMultiple(row.fitted_multiple)+' (P25–P75: '+fmtMultiple(row.peer_p25)+'–'+fmtMultiple(row.peer_p75)+')';
  var pTable=A(peerSec,'table','mt peer-table');
  pTable.innerHTML='<thead><tr><th>PEER PROTOCOL</th><th>CATEGORY</th><th>TVL</th><th>MARKET CAP</th><th>MCAP / TVL</th></tr></thead>';
  var pBody=A(pTable,'tbody');
  peers.forEach(function(p){
    var tr=A(pBody,'tr');
    tr.innerHTML='<td>'+esc(p.name)+'</td>'+
      '<td>'+esc(p.category)+'</td>'+
      '<td class="n">'+fmtMoney(p.tvl_usd)+'</td>'+
      '<td class="n">'+fmtMoney(p.mcap_usd)+'</td>'+
      '<td class="n">'+fmtMultiple(p.ratio)+'</td>';
  });
  peerSec.appendChild(peerHistogram(row));
  var steps=farmSteps(row);
  var planSec=A(root,'section','fms');
  A(planSec,'h2',null,'Farm plan (6 steps · sunk gas $'+fmtInt(row.farm_cost_usd)+' · '+fmtHours(row.farm_hours)+' on)');
  var ol=A(planSec,'ol','fst');
  steps.forEach(function(s){A(ol,'li',null,s.text);});
  A(root,'p','dfn','Implied value is what a token would be worth if today\'s record held. Launch odds are snapshot propensity (a lower bound on true launch probability). Farming $/h uses stated assumptions ('+Math.round(poolShare()*100)+'% pool, '+Math.round(depositShare()*100)+'% TVL deposits, '+Math.round(oppApr()*100)+'% APR over '+horizonDays()+'d), not guarantees.');
  A(root,'p','sr','Source: '+DATA.source+' · Model '+(DATA.model_version||'radar-4')+' ('+(cal.winner||'')+', 5-fold MAPE '+fmtPct(cal.winner_mape,1)+', odds AUC '+tn(((cal.odds_model||{}).cv5||{}).auc||0,3)+')');
}
function peerHistogram(row){
  var ratios=peerRatios(row);
  var wrap=A(null,'div','phi');
  A(wrap,'span','phl','Peer spread');
  if(ratios.length<2){
    A(wrap,'span','phe','too few peers to plot');
    return wrap;
  }
  var lo=Math.log10(Math.min.apply(null,ratios.concat([row.fitted_multiple])));
  var hi=Math.log10(Math.max.apply(null,ratios.concat([row.fitted_multiple])));
  if(hi-lo<0.5)hi=lo+0.5;
  var nBins=8,W=220,H=44;
  var counts=new Array(nBins).fill(0);
  ratios.forEach(function(v){
    var i=Math.min(nBins-1,Math.floor((Math.log10(v)-lo)/(hi-lo)*nBins));
    counts[i]++;
  });
  var maxC=Math.max.apply(null,counts.concat([1]));
  var svg=svgEl('svg',{viewBox:'0 0 '+W+' '+H,'class':'phs',role:'img','aria-label':'Peer multiple histogram'});
  var bw=W/nBins;
  counts.forEach(function(c,i){
    var h=c/maxC*(H-6);
    svgEl('rect',{x:(i*bw+1).toFixed(1),y:(H-h).toFixed(1),width:(bw-2).toFixed(1),height:Math.max(h,1).toFixed(1),'class':'hist-bar'},svg);
  });
  var fx=(Math.log10(row.fitted_multiple)-lo)/(hi-lo)*W;
  svgEl('line',{x1:fx.toFixed(1),y1:0,x2:fx.toFixed(1),y2:H,'class':'hist-marker'},svg);
  wrap.appendChild(svg);
  return wrap;
}
function render(){
  var mount=document.getElementById('app')||document.body;
  mount.innerHTML='';
  if(!DATA||!DATA.rows){
    A(mount,'p','en','No data loaded (data.js missing or empty).');
    return;
  }
  if(state.detail){renderDetail(mount,state.detail);return;}
  var rows=filteredRows();
  renderHeader(mount);
  renderModelBox(mount);
  renderCharts(mount,rows);
  renderTabs(mount);
  if(state.tab==='live'){renderLive(mount);}
  else{renderFilters(mount,rows.length);renderBoard(mount,rows);renderMethod(mount);}
}
function setState(patch,push){
  Object.keys(patch).forEach(function(k){state[k]=patch[k];});
  if(patch.deposit!==undefined)invalidateComputed();
  if(push!==false)writeHash();
  render();
}
function onHashChange(){
  var s=readHash();
  var depChanged=s.deposit!==state.deposit;
  state=s;
  if(depChanged)invalidateComputed();
  render();
}
var ACT={
detail:function(t){setState({detail:t.getAttribute('data-slug')});},
back:function(){setState({detail:''});},
tab:function(t){setState({tab:t.getAttribute('data-tab'),detail:''});},
deposit:function(t){setState({deposit:parseInt(t.getAttribute('data-deposit'),10)});},
'toggle-watch':function(){setState({watch:!state.watch});},
'toggle-mintvl':function(){setState({minTvl:state.minTvl>=100000000?0:100000000});},
'toggle-minimplied':function(){setState({minImplied:state.minImplied>=50000000?0:50000000});},
reset:function(){setState({q:'',category:'',chain:'',verdict:'',watch:false,minTvl:0,minImplied:0});},
sort:function(t){
  var key=t.getAttribute('data-sort');
  if(key==='rank'||key==='chg'||key==='age'||key==='chains')return;
  var map={name:'name',tvl:'tvl',implied:'implied',odds:'odds','risk-adj':'risk-adj',perhour:'perhour'};
  var sk=map[key];
  if(!sk)return;
  if(state.sort===sk)setState({dir:-state.dir});
  else setState({sort:sk,dir:sk==='name'?1:-1});
}};
function wireEvents(){
  var mount=document.getElementById('app')||document.body;
  mount.addEventListener('click',function(ev){
    var t=ev.target.closest?ev.target.closest('[data-act]'):null;
    if(!t)return;
    var f=ACT[t.getAttribute('data-act')];
    if(f)f(t);
  });
  mount.addEventListener('input',function(ev){
    var t=ev.target.closest?ev.target.closest('[data-act="search"]'):null;
    if(!t)return;
    state.q=t.value;
    writeHash();
    render();
    var box=mount.querySelector('[data-act="search"]');
    if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length);}
  });
  mount.addEventListener('change',function(ev){
    var t=ev.target.closest?ev.target.closest('[data-act]'):null;
    if(!t)return;
    var act=t.getAttribute('data-act');
    if(act==='filter-category')setState({category:t.value});
    else if(act==='filter-chain')setState({chain:t.value});
    else if(act==='filter-verdict'){
      var map={'farm-now':'FARM NOW','selective':'SELECTIVE','thin':'THIN','skip':'SKIP'};
      setState({verdict:map[t.value]||''});
    }
    else if(act==='sort-select')setState({sort:t.value,dir:t.value==='name'?1:-1});
  });
  window.addEventListener('hashchange',onHashChange);
}
function init(){
  state=readHash();
  wireEvents();
  render();
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
else{init();}
})();
