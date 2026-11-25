// Token Radar v6 (radar-4) offline dashboard. Zero network, zero http/https strings.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var SVG_NS = (function () { var d = document.createElement('div'); d.innerHTML = '<svg></svg>'; return d.firstChild.namespaceURI; })();
  var DEPOSITS = [1000, 5000, 10000, 25000];
  var state = { q: '', liveQ: '', category: 'all', chain: 'all', verdict: 'all', watchOnly: false, minTvl: 0, minImplied: 0, deposit: (DATA.model && DATA.model.default_deposit_usd) || 5000, tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '\u2212' : '', a = Math.abs(n);
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + usd.format(a);
  }
  function fmtUsdCompact(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var a = Math.abs(n), s = n < 0 ? '\u2212' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return s + '$' + (a >= 1e8 ? Math.round(a / 1e6) : (a / 1e6).toFixed(1)) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + usd.format(a);
  }
  function fmtHourly(n) { return (n < 0 ? '\u2212$' : '$') + Math.abs(n).toFixed(2); }
  function fmtExactUsd(n) { return (n < 0 ? '\u2212' : '') + usd.format(Math.abs(Math.round(n))); }
  function fmtRange(lo, hi) { return fmtUsdCompact(lo) + '\u2013' + fmtUsdCompact(hi); }
  function fmtPct(n) { return (n == null || !isFinite(n)) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtOdds(p) { return Math.round(p * 100) + '%'; }
  function fmtAge(days) { return days == null ? 'unknown' : (days >= 365 ? (days / 365).toFixed(1) + 'y' : Math.max(0, Math.round(days)) + 'd'); }
  function fmtRankRange(r) { return r.rank_min != null && r.rank_max != null && r.rank_min !== r.rank_max ? '(' + r.rank_min + '\u2013' + r.rank_max + ')' : ''; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // Live valuation & farming economics recomputation
  function impliedOf(row, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d == null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var age = row.age_days == null ? m.unknown_age_days : row.age_days;
    var mat = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.fitted_multiple * gm * mat));
  }
  function econFor(row, dep) {
    var m = DATA.model, vt = DATA.calibration.verdicts;
    var pool = m.airdrop_pool_share * row.implied_value_usd;
    var fDep = m.farming_deposit_tvl_share * row.tvl_usd;
    var share = fDep > 0 ? dep / fDep : 0;
    var expAir = pool * share * row.launch_odds;
    var opp = dep * m.opp_cost_apr * (m.horizon_days / 365);
    var net = expAir - row.farm_cost_usd - opp;
    var hr = row.farm_hours > 0 ? net / row.farm_hours : net;
    var v = hr >= vt.t1_farm_now ? 'FARM NOW' : hr >= vt.t2_selective ? 'SELECTIVE' : hr >= 0 ? 'THIN' : 'SKIP';
    return { pool: pool, share: share, expAir: Math.round(expAir), opp: Math.round(opp), net: Math.round(net), hr: Math.round(hr * 100) / 100, verdict: v };
  }
  function verdictCls(v) { return v === 'FARM NOW' ? 'v-badge v-farm' : v === 'SELECTIVE' ? 'v-badge v-sel' : v === 'THIN' ? 'v-badge v-thin' : 'v-badge v-skip'; }

  // 6-step farm plan mirroring lib/model.ts
  var FARM_RULES = [
    [['lend', 'cdp', 'collateral'], 'Supply ${cap} of USDC to {n} on {ch} and keep the position open.', 'Borrow a small amount against the supply on {n} and repay it the same week, so the address shows both sides of the market.'],
    [['dex', 'yield', 'leveraged farm'], "Provide ${cap} of liquidity to {n}'s main pool on {ch} and keep the position open.", "Swap a small amount through {n}'s router on {ch} each week, so the address is a trader as well as a liquidity provider."],
    [['bridge'], 'Bridge ${cap} of USDC to {ch} through {n} and use the bridged funds in its app.', 'Use the bridged funds for one swap or deposit in an app on {ch} within the same week, so the bridge is not the only trace.'],
    [['staking', 'restak'], "Stake ${cap} of the chain's staking asset through {n} and keep the receipt.", 'Restake or delegate the receipt token once, and vote in one governance proposal if {n} opens one.'],
    [['perpetual', 'derivative'], 'Deposit ${cap} of USDC as margin on {n} and open one small hedge.', 'Close the hedge and open a second small one the following week, keeping the margin deposit in place throughout.'],
    [['prediction'], 'Fund ${cap} and place one market position on {n}.', 'Settle one market and open a second one the following week, keeping the account funded between them.'],
    [['curator', 'allocator'], 'Deposit ${cap} into a {n} vault on {ch} and keep the shares.', 'Add a second, smaller deposit to a different {n} vault on {ch} the following week.'],
    [['stable'], 'Mint or deposit ${cap} of the stable asset through {n} on {ch}.', 'Use the minted stable asset in one payment or deposit on {ch} each week, then return it to the protocol.'],
    [['rwa'], "Mint ${cap} of the protocol's yield asset on {ch} and hold it.", 'Claim the yield the asset earns once a month and leave the principal in place.'],
    [['insurance'], 'Buy ${cap} of cover from {n} on {ch} and keep the policy.', 'Renew the cover once before it lapses, so the policy runs without a gap.']
  ];
  function farmSteps(p) {
    var ch = p.chains && p.chains.length ? p.chains[0] : 'its main chain';
    var cap = p.tvl_usd >= 5e9 ? 250 : p.tvl_usd >= 1e9 ? 150 : p.tvl_usd >= 1e8 ? 100 : 50;
    var hold = p.age_days == null ? 30 : p.age_days < 180 ? 60 : p.age_days < 365 ? 45 : 30;
    var gas = cap >= 150 ? 8 : 4, c = (p.category || '').toLowerCase(), rule = [null, 'Deposit ${cap} of USDC into {n} on {ch} and keep the position open.', 'Make one more deposit, swap or vote on {n} each week, a different action from the first.'];
    for (var i = 0; i < FARM_RULES.length; i++) for (var j = 0; j < FARM_RULES[i][0].length; j++) if (c.indexOf(FARM_RULES[i][0][j]) >= 0) { rule = FARM_RULES[i]; i = FARM_RULES.length; break; }
    var sub = function (t) { return t.replace(/\{n\}/g, p.name).replace(/\{cap\}/g, String(cap)).replace(/\{ch\}/g, ch); };
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: sub(rule[1]), cost: '$' + cap + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: sub(rule[2]), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
    });
    if (text != null) node.textContent = String(text);
    return node;
  }
  function td(text, cls, title) { return el('td', { 'class': cls || null, text: text, title: title || null }); }
  function tag(text, cls) { return el('span', { 'class': cls ? 'tag ' + cls : 'tag', text: text }); }

  var watchSet = {}, rowByRank = {};
  (DATA.watchlist || []).forEach(function (s) { watchSet[s] = true; });
  DATA.rows.forEach(function (r) { rowByRank[r.rank] = r; });

  function uniq(fn) { var s = {}; DATA.rows.forEach(fn.bind(null, s)); return Object.keys(s).sort(); }
  function categories() { return uniq(function (s, r) { if (r.category) s[r.category] = true; }); }
  function chains() { return uniq(function (s, r) { (r.chains || []).forEach(function (c) { s[c] = true; }); }); }
  function hasActiveFilter() { return state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.verdict !== 'all' || state.watchOnly || state.minTvl > 0 || state.minImplied > 0; }

  function computeVerdictCounts() {
    var counts = { 'FARM NOW': 0, SELECTIVE: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { counts[econFor(r, state.deposit).verdict]++; });
    return counts;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.map(function (r) { return { r: r, e: econFor(r, state.deposit) }; }).filter(function (x) {
      var r = x.r;
      if (state.watchOnly && !watchSet[r.slug]) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.minImplied > 0 && r.implied_value_usd < state.minImplied) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (state.verdict !== 'all' && x.e.verdict !== state.verdict) return false;
      if (q && (r.name || '').toLowerCase().indexOf(q) === -1 && (r.slug || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort, dir = state.dir, vOrd = { 'FARM NOW': 3, SELECTIVE: 2, THIN: 1, SKIP: 0 };
    rows.sort(function (a, b) {
      var v = 0, ra = a.r, rb = b.r;
      if (key === 'rank') v = rb.rank - ra.rank;
      else if (key === 'implied') v = ra.implied_value_usd - rb.implied_value_usd;
      else if (key === 'risk') v = ra.risk_adj_usd - rb.risk_adj_usd;
      else if (key === 'odds') v = ra.launch_odds - rb.launch_odds;
      else if (key === 'hr') v = a.e.hr - b.e.hr;
      else if (key === 'verdict') v = vOrd[a.e.verdict] - vOrd[b.e.verdict] || a.e.hr - b.e.hr;
      else if (key === 'tvl') v = ra.tvl_usd - rb.tvl_usd;
      else if (key === 'growth') v = (ra.change_7d == null ? -1e9 : ra.change_7d) - (rb.change_7d == null ? -1e9 : rb.change_7d);
      else if (key === 'age') v = (ra.age_days == null ? -1 : ra.age_days) - (rb.age_days == null ? -1 : rb.age_days);
      else if (key === 'chains') v = ((ra.chains && ra.chains[0]) || '').localeCompare((rb.chains && rb.chains[0]) || '');
      else if (key === 'name') v = (ra.name || '').localeCompare(rb.name || '');
      return v * dir || (ra.rank - rb.rank);
    });
    return rows;
  }

  function validLivePeers() {
    return (DATA.live || [])
      .filter(function (p) { return p.mcap_usd != null && p.mcap_usd > 0 && p.tvl_usd > 0 && isFinite(p.mcap_usd / p.tvl_usd); })
      .map(function (p) { return { slug: p.slug, name: p.name, category: p.category || 'Uncategorised', tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, ratio: p.mcap_usd / p.tvl_usd }; });
  }

  function peerComparablesFor(r) {
    var all = validLivePeers(), target = r.fitted_multiple;
    var byClose = function (a, b) { return Math.abs(a.ratio - target) - Math.abs(b.ratio - target) || b.mcap_usd - a.mcap_usd; };
    var byAsc = function (a, b) { return a.ratio - b.ratio || b.mcap_usd - a.mcap_usd; };
    if (r.peer_category !== 'all live-token protocols') {
      var same = all.filter(function (p) { return p.category === r.peer_category; });
      if (same.length) {
        return {
          rows: same.slice().sort(byClose).slice(0, 5).sort(byAsc),
          allRatios: same.map(function (p) { return p.ratio; }),
          badge: r.peer_category + ' peers', badgeClass: 'tag accent',
          caption: '5 closest to fitted ' + target.toFixed(3) + '\u00d7 \u00b7 P25\u2013P75 ' + r.peer_p25.toFixed(3) + '\u00d7\u2013' + r.peer_p75.toFixed(3) + '\u00d7 (' + r.peer_count + ' peers)'
        };
      }
    }
    var minP = (DATA.model && DATA.model.peer_min_count) || 3;
    return {
      rows: all.slice().sort(byClose).slice(0, 5).sort(byAsc),
      allRatios: all.map(function (p) { return p.ratio; }),
      badge: 'global median fallback', badgeClass: 'tag watch',
      caption: (r.category || 'Uncategorised') + ' has <' + minP + ' live peers \u00b7 5 closest to fitted ' + target.toFixed(3) + '\u00d7 (P25\u2013P75: ' + r.peer_p25.toFixed(3) + '\u00d7\u2013' + r.peer_p75.toFixed(3) + '\u00d7)'
    };
  }

  function buildDepositPicker() {
    var g = el('div', { 'class': 'dep-group', role: 'group', 'aria-label': 'What-if farming deposit' }, el('span', { 'class': 'dep-lbl', text: 'Deposit:' }));
    DEPOSITS.forEach(function (d) {
      g.appendChild(el('button', {
        type: 'button', 'class': 'dep-btn', 'aria-pressed': String(state.deposit === d),
        text: '$' + d.toLocaleString('en-US'),
        onclick: function () { setDeposit(d); }
      }));
    });
    return g;
  }

  function buildTopChart(items) {
    var top = items.map(function (x) { return x.r; }).sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; }).slice(0, 10);
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Top protocols by implied value' });
    card.appendChild(el('div', { 'class': 'chart-head' },
      el('h2', { text: hasActiveFilter() ? 'Top ' + top.length + ' matching by implied value' : 'Top ' + top.length + ' pre-token by implied value' }),
      el('span', { 'class': 'chart-sub', text: 'Linear scale \u00b7 click bar' })
    ));
    if (!top.length) { card.appendChild(el('p', { 'class': 'empty', text: 'No matching protocols.' })); return card; }
    var maxV = top[0].implied_value_usd || 1, list = el('div', { 'class': 'bar-list' });
    top.forEach(function (r, i) {
      var fill = el('span', { 'class': 'bar-fill' });
      fill.style.width = Math.max(3, (r.implied_value_usd / maxV) * 100).toFixed(2) + '%';
      list.appendChild(el('button', {
        type: 'button', 'class': 'bar-row' + (i === 0 ? ' bar-top' : ''),
        title: '#' + r.rank + ' ' + r.name + ' \u2014 ' + fmtUsd(r.implied_value_usd) + ' (' + fmtOdds(r.launch_odds) + ' odds)',
        onclick: function () { select(r.slug); }
      }, el('span', { 'class': 'bar-rank', text: '#' + r.rank }), el('span', { 'class': 'bar-label', text: r.name }), el('span', { 'class': 'bar-track' }, fill), el('span', { 'class': 'bar-val', text: fmtUsd(r.implied_value_usd) })));
    });
    card.appendChild(list);
    return card;
  }

  function buildScatterChart(items) {
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Market pricing scatter plot' });
    var live = validLivePeers();
    var top20 = items.map(function (x) { return x.r; }).sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; }).slice(0, 20).filter(function (r) { return r.tvl_usd > 0 && r.implied_value_usd > 0; });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h2', { text: 'Market pricing: TVL vs mcap/TVL' }), el('span', { 'class': 'chart-sub', html: '<i class="legend-dot live"></i>Live (' + live.length + ') \u00b7 <i class="legend-dot pre"></i>Top ' + top20.length })));

    var W = 520, H = 186, pad = { l: 42, r: 10, t: 6, b: 22 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var xs = live.map(function (p) { return Math.log10(p.tvl_usd); }).concat(top20.map(function (r) { return Math.log10(r.tvl_usd); }));
    var ys = live.map(function (p) { return Math.log10(p.ratio); }).concat(top20.map(function (r) { return Math.log10(r.implied_value_usd / r.tvl_usd); }));
    var minX = Math.floor(Math.min.apply(null, xs.length ? xs : [6])), maxX = Math.ceil(Math.max.apply(null, xs.length ? xs : [10]));
    if (maxX <= minX) maxX = minX + 2;
    var minY = Math.max(-2.3, Math.min(-1.5, Math.floor(Math.min.apply(null, ys.length ? ys : [-1.3]) * 2) / 2));
    var maxY = Math.min(1.6, Math.max(0.5, Math.ceil(Math.max.apply(null, ys.length ? ys : [0.5]) * 2) / 2));
    if (maxY <= minY) maxY = minY + 1;
    var sx = function (v) { return pad.l + ((Math.max(minX, Math.min(maxX, v)) - minX) / (maxX - minX)) * pw; };
    var sy = function (v) { return pad.t + ph - ((Math.max(minY, Math.min(maxY, v)) - minY) / (maxY - minY)) * ph; };

    var svg = svgEl('svg', { 'class': 'plot', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Scatter plot of log TVL against log market cap per TVL' });
    [[6, '$1M'], [7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B'], [11, '$100B']].forEach(function (t) {
      if (t[0] < minX || t[0] > maxX) return;
      var x = sx(t[0]);
      svg.appendChild(svgEl('line', { 'class': 'grid-line', x1: x, y1: pad.t, x2: x, y2: pad.t + ph }));
      svg.appendChild(svgEl('text', { x: x, y: H - 7, 'text-anchor': 'middle' }, t[1]));
    });
    [[0.02, '0.02\u00d7'], [0.05, '0.05\u00d7'], [0.2, '0.2\u00d7'], [1, '1\u00d7'], [5, '5\u00d7'], [20, '20\u00d7']].forEach(function (t) {
      var lv = Math.log10(t[0]);
      if (lv < minY || lv > maxY) return;
      var y = sy(lv);
      svg.appendChild(svgEl('line', { 'class': 'grid-line', x1: pad.l, y1: y, x2: pad.l + pw, y2: y }));
      svg.appendChild(svgEl('text', { x: pad.l - 5, y: y + 3, 'text-anchor': 'end' }, t[1]));
    });
    if (DATA.global_multiple > 0) svg.appendChild(svgEl('line', { 'class': 'ref-line', x1: pad.l, y1: sy(Math.log10(DATA.global_multiple)), x2: pad.l + pw, y2: sy(Math.log10(DATA.global_multiple)) }));
    var gc = DATA.calibration && DATA.calibration.coefficients && DATA.calibration.coefficients.global;
    if (gc && typeof gc.a === 'number' && typeof gc.b === 'number') {
      var pts = [];
      for (var k = 0; k <= 24; k++) {
        var lx10 = minX + ((maxX - minX) * k) / 24, lnT = lx10 * Math.LN10;
        var ly10 = (gc.a + (gc.b - 1) * lnT + (typeof gc.d === 'number' ? gc.d * lnT * lnT : 0)) / Math.LN10;
        if (isFinite(ly10)) pts.push(sx(lx10).toFixed(1) + ',' + sy(ly10).toFixed(1));
      }
      if (pts.length >= 2) svg.appendChild(svgEl('polyline', { 'class': 'fit-line', points: pts.join(' ') }));
    }
    live.forEach(function (p) {
      var c = svgEl('circle', { 'class': 'dot-live', cx: sx(Math.log10(p.tvl_usd)).toFixed(1), cy: sy(Math.log10(p.ratio)).toFixed(1), r: '2.6' });
      c.appendChild(svgEl('title', null, p.name + ' \u00b7 TVL ' + fmtUsd(p.tvl_usd) + ' \u00b7 ' + p.ratio.toFixed(3) + '\u00d7'));
      svg.appendChild(c);
    });
    top20.forEach(function (r) {
      var rat = r.implied_value_usd / r.tvl_usd;
      var c = svgEl('circle', { 'class': 'dot-pre', cx: sx(Math.log10(r.tvl_usd)).toFixed(1), cy: sy(Math.log10(rat)).toFixed(1), r: '3.8', onclick: function () { select(r.slug); } });
      c.appendChild(svgEl('title', null, '#' + r.rank + ' ' + r.name + ' \u00b7 Implied/TVL ' + rat.toFixed(3) + '\u00d7'));
      svg.appendChild(c);
    });
    card.appendChild(svg);
    card.appendChild(el('p', { 'class': 'chart-caption', text: 'Top pre-token rows inside the live market cloud (dashed grey: global median ' + DATA.global_multiple.toFixed(3) + '\u00d7' + (gc && typeof gc.b === 'number' ? '; amber: ' + DATA.calibration.winner + ' fit' : '') + ').' }));
    return card;
  }

  function buildCalibrationPlot() {
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Held-out calibration plot' }), cal = DATA.calibration;
    var pts = (DATA.live || []).filter(function (p) { return p.mcap_usd > 0 && p.cv_predicted_mcap_usd > 0; });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: 'Value calibration: actual vs 5-fold predicted mcap' }), el('span', { 'class': 'chart-sub', text: cal.winner + ' \u00b7 MAPE ' + cal.winner_mape.toFixed(1) + '%' })));
    var W = 520, H = 228, pad = { l: 46, r: 14, t: 10, b: 30 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var vals = []; pts.forEach(function (p) { vals.push(Math.log10(p.mcap_usd), Math.log10(p.cv_predicted_mcap_usd)); });
    var lo = Math.floor(Math.min.apply(null, vals.length ? vals : [6])), hi = Math.ceil(Math.max.apply(null, vals.length ? vals : [10]));
    if (hi <= lo) hi = lo + 2;
    var sx = function (v) { return pad.l + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * pw; };
    var sy = function (v) { return pad.t + ph - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ph; };
    var svg = svgEl('svg', { 'class': 'plot', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Calibration plot' });
    [[5, '$100K'], [6, '$1M'], [7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B'], [11, '$100B']].forEach(function (t) {
      if (t[0] < lo || t[0] > hi) return;
      var x = sx(t[0]), y = sy(t[0]);
      svg.appendChild(svgEl('line', { 'class': 'grid-line', x1: x, y1: pad.t, x2: x, y2: pad.t + ph }));
      svg.appendChild(svgEl('line', { 'class': 'grid-line', x1: pad.l, y1: y, x2: pad.l + pw, y2: y }));
      svg.appendChild(svgEl('text', { x: x, y: H - 14, 'text-anchor': 'middle' }, t[1]));
      svg.appendChild(svgEl('text', { x: pad.l - 5, y: y + 3, 'text-anchor': 'end' }, t[1]));
    });
    svg.appendChild(svgEl('line', { 'class': 'fit-line', x1: sx(lo), y1: sy(lo), x2: sx(hi), y2: sy(hi) }));
    svg.appendChild(svgEl('text', { x: sx(hi) - 4, y: sy(hi) + 12, 'text-anchor': 'end' }, 'y = x'));
    pts.forEach(function (p) {
      var c = svgEl('circle', { 'class': 'dot-pre', cx: sx(Math.log10(p.mcap_usd)).toFixed(1), cy: sy(Math.log10(p.cv_predicted_mcap_usd)).toFixed(1), r: '2.9' });
      c.appendChild(svgEl('title', null, p.name + ' \u00b7 Actual ' + fmtUsd(p.mcap_usd) + ' \u00b7 Pred ' + fmtUsd(p.cv_predicted_mcap_usd)));
      svg.appendChild(c);
    });
    svg.appendChild(svgEl('text', { 'class': 'axis-title', x: pad.l + pw / 2, y: H - 2, 'text-anchor': 'middle' }, 'Actual live market cap (log)'));
    card.appendChild(svg);
    card.appendChild(el('p', { 'class': 'chart-caption', text: pts.length + ' live protocols out-of-fold (' + cal.fold_scheme + '). Held-out MAPE: ' + cal.winner_mape.toFixed(1) + '%.' }));
    return card;
  }

  function sig2(n, mode) {
    if (!isFinite(n) || n <= 0) return n;
    var p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
    return (mode === 'floor' ? Math.floor(n / p) : mode === 'ceil' ? Math.ceil(n / p) : Math.round(n / p)) * p;
  }
  function fmtEdge(n) {
    if (n >= 1e9) return '$' + (n >= 1e10 ? Math.round(n / 1e9) : +(n / 1e9).toFixed(1)) + 'B';
    if (n >= 1e6) return '$' + (n >= 1e7 ? Math.round(n / 1e6) : +(n / 1e6).toFixed(1)) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function buildHistogram() {
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Implied value distribution histogram' });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: 'Implied-value distribution (6 log-spaced bins)' }), el('span', { 'class': 'chart-sub', text: DATA.rows.length + ' ranked protocols' })));
    var vals = DATA.rows.map(function (r) { return r.implied_value_usd; }).filter(function (v) { return v > 0 && isFinite(v); });
    if (!vals.length) return card;
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals), loL = Math.log10(minV), hiL = Math.log10(maxV > minV ? maxV : minV * 10), edges = [];
    for (var k = 0; k <= 6; k++) {
      var raw = Math.pow(10, loL + ((hiL - loL) * k) / 6), re = k === 0 ? sig2(minV, 'floor') : k === 6 ? sig2(maxV, 'ceil') : sig2(raw, 'round');
      edges.push(k > 0 && re <= edges[k - 1] ? raw : re);
    }
    var bins = [];
    for (var i = 0; i < 6; i++) bins.push({ l: fmtEdge(edges[i]) + '\u2013' + fmtEdge(edges[i + 1]).replace(/^\$/, ''), hi: edges[i + 1], n: 0 });
    vals.forEach(function (v) { for (var j = 0; j < 6; j++) if (j === 5 || v < bins[j].hi) { bins[j].n++; break; } });
    var W = 520, H = 196, pad = { l: 16, r: 12, t: 20, b: 26 }, pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    var maxN = Math.max(1, Math.max.apply(null, bins.map(function (b) { return b.n; }))), slot = pw / 6, bw = slot * 0.62;
    var svg = svgEl('svg', { 'class': 'plot', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Implied value histogram' });
    bins.forEach(function (b, idx) {
      var bh = (b.n / maxN) * ph, x = pad.l + idx * slot + (slot - bw) / 2, y = pad.t + ph - bh;
      svg.appendChild(svgEl('rect', { 'class': 'hist-bar', x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: Math.max(1, bh).toFixed(1), rx: '4' }));
      svg.appendChild(svgEl('text', { 'class': 'hist-val', x: (x + bw / 2).toFixed(1), y: (y - 5).toFixed(1), 'text-anchor': 'middle' }, String(b.n)));
      svg.appendChild(svgEl('text', { x: (x + bw / 2).toFixed(1), y: H - 9, 'text-anchor': 'middle' }, b.l));
    });
    card.appendChild(svg);
    var bestIdx = 0, bestSum = -1;
    for (var m = 0; m < 5; m++) if (bins[m].n + bins[m + 1].n > bestSum) { bestSum = bins[m].n + bins[m + 1].n; bestIdx = m; }
    card.appendChild(el('p', { 'class': 'chart-caption', text: bestSum + ' of ' + vals.length + ' rows (' + Math.round((bestSum / vals.length) * 100) + '%) sit between ' + fmtEdge(edges[bestIdx]) + ' and ' + fmtEdge(edges[bestIdx + 2]) + ' (full board: ' + fmtEdge(minV) + '\u2013' + fmtEdge(maxV) + ').' }));
    return card;
  }

  function buildBakeoffCard() {
    var cal = DATA.calibration, ex = DATA.exclusions, wf = cal.walk_forward;
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Value model 3-way validation bake-off' });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: '7-model bake-off (5-fold / walk-forward / LOO MAPE)' }), el('span', { 'class': 'chart-sub', text: cal.live_sample_size + ' live protocols' })));
    var hr = el('tr');
    ['Candidate', 'P', '5-fold', 'Walk-fwd', 'LOO', 'Status'].forEach(function (h, i) { hr.appendChild(el('th', { 'class': i >= 1 && i <= 4 ? 'num' : '', text: h })); });
    var tbody = el('tbody');
    cal.bakeoff.forEach(function (b) {
      tbody.appendChild(el('tr', { 'class': b.winner ? 'win-row' : '' },
        td(b.name, null, b.label), td(String(b.params), 'num'),
        td(b.mape.toFixed(1) + '%', 'num'), td(b.wf_mape.toFixed(1) + '%', 'num'), td(b.loo_mape.toFixed(1) + '%', 'num'),
        el('td', null, tag(b.winner ? 'Winner' : '+' + (b.mape - cal.winner_mape).toFixed(1) + 'pt', b.winner ? 'accent' : ''))
      ));
    });
    card.appendChild(el('table', { 'class': 'mini-table' }, el('thead', null, hr), tbody));
    card.appendChild(el('p', { 'class': 'excl-line', text: 'Winner by 5-fold MAPE (' + cal.fold_scheme + '; 1pt tie-band prefers fewer params). Walk-forward split ' + (wf.split_date || 'n/a') + ' (' + wf.train_count + ' train / ' + wf.test_count + ' test). Exclusions: ' + ex.total_pre_token + ' pre-token \u2192 ' + ex.ranked + ' ranked (' + ex.excluded_total + ' excluded: ' + ex.wrapped_category + ' wrapped cat, ' + ex.versioned_name + ' versioned, ' + ex.wrapped_word + ' wrapped name, ' + ex.exchange_name + ' exchange).' }));
    return card;
  }

  function buildAblationCard() {
    var cal = DATA.calibration;
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Model ablation table' });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: 'Model ablation (all tried variants)' }), el('span', { 'class': 'chart-sub', text: cal.ablation.length + ' variants evaluated' })));
    var hr = el('tr');
    ['Variant', 'Params', '5-fold MAPE', 'Decision'].forEach(function (h, i) { hr.appendChild(el('th', { 'class': i === 1 || i === 2 ? 'num' : '', text: h })); });
    var tbody = el('tbody');
    cal.ablation.forEach(function (a) {
      tbody.appendChild(el('tr', { 'class': a.kept ? 'win-row' : '' }, td(a.name), td(String(a.params), 'num'), td(a.mape.toFixed(2) + '%', 'num'), td(a.note)));
    });
    card.appendChild(el('table', { 'class': 'mini-table' }, el('thead', null, hr), tbody));
    return card;
  }

  function buildOddsCard() {
    var om = DATA.calibration.odds_model;
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Launch odds validation and calibration' });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: 'Launch odds model (IRLS logistic, ' + om.sample_size + ' protocols)' }), el('span', { 'class': 'chart-sub', text: om.token_count + ' live / ' + om.pre_token_count + ' pre-token' })));
    card.appendChild(el('p', { 'class': 'honest-box', text: 'Honest target: P(protocol has a token in the snapshot). Because pre-token protocols that launch later are coded 0, launch_odds is a snapshot-based launch propensity \u2014 a lower bound on true launch probability, not the probability a protocol will launch.' }));
    var ms = el('div', { 'class': 'odds-metrics' });
    [
      ['5-fold CV', om.cv5.auc, om.cv5.brier, om.cv5.base_brier],
      ['Walk-forward', om.walk_forward.auc, om.walk_forward.brier, om.walk_forward.base_brier],
      ['Leave-one-out', om.loo.auc, om.loo.brier, om.loo.base_brier]
    ].forEach(function (m) {
      ms.appendChild(el('div', { 'class': 'om-cell' }, el('span', { text: m[0] }), el('b', { text: 'AUC ' + m[1].toFixed(3) }), el('small', { text: 'Brier ' + m[2].toFixed(4) + ' (base ' + m[3].toFixed(4) + ')' })));
    });
    card.appendChild(ms);
    var hr = el('tr');
    ['Quintile', 'n', 'Predicted range', 'Mean pred', 'Actual rate'].forEach(function (h, i) { hr.appendChild(el('th', { 'class': i >= 1 ? 'num' : '', text: h })); });
    var tbody = el('tbody');
    om.calibration_bins.forEach(function (b) {
      tbody.appendChild(el('tr', null, td('Q' + b.bin), td(String(b.count), 'num'), td(fmtOdds(b.min_odds) + '\u2013' + fmtOdds(b.max_odds), 'num'), td((b.mean_predicted * 100).toFixed(1) + '%', 'num'), td((b.actual_rate * 100).toFixed(1) + '%', 'num')));
    });
    card.appendChild(el('table', { 'class': 'mini-table' }, el('thead', null, hr), tbody));
    return card;
  }

  function buildCategorySummaryCard() {
    var card = el('section', { 'class': 'chart-card', 'aria-label': 'Category summary' }), byCat = {};
    DATA.rows.forEach(function (r) { var k = r.category || 'Uncategorised'; (byCat[k] = byCat[k] || []).push(r); });
    var sum = Object.keys(byCat).filter(function (k) { return byCat[k].length >= 3; }).map(function (k) {
      var list = byCat[k].slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
      var vals = list.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
      var m = Math.floor(vals.length / 2);
      return { cat: k, n: list.length, med: vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2, top: list[0] };
    }).sort(function (a, b) { return b.med - a.med || b.n - a.n; });
    card.appendChild(el('div', { 'class': 'chart-head' }, el('h3', { text: 'Category summary (\u22653 board rows)' }), el('span', { 'class': 'chart-sub', text: sum.length + ' categories' })));
    var hr = el('tr');
    ['Category', 'Rows', 'Median implied', 'Top protocol'].forEach(function (h, i) { hr.appendChild(el('th', { 'class': i === 1 || i === 2 ? 'num' : '', text: h })); });
    var tbody = el('tbody');
    sum.slice(0, 12).forEach(function (s) {
      tbody.appendChild(el('tr', null, td(s.cat), td(String(s.n), 'num'), td(fmtUsd(s.med), 'num'), el('td', null, el('button', { type: 'button', 'class': 'link-btn', text: '#' + s.top.rank + ' ' + s.top.name, onclick: function () { select(s.top.slug); } }))));
    });
    card.appendChild(el('table', { 'class': 'mini-table' }, el('thead', null, hr), tbody));
    return card;
  }

  function buildPeerMiniHistogram(ratios, fitted) {
    if (!ratios || ratios.length < 3 || !isFinite(fitted) || fitted <= 0) return null;
    var logs = ratios.filter(function (v) { return v > 0 && isFinite(v); }).map(function (v) { return Math.log10(v); });
    if (logs.length < 3) return null;
    var t = Math.log10(fitted), lo = Math.min(t, Math.min.apply(null, logs)), hi = Math.max(t, Math.max.apply(null, logs));
    if (hi - lo < 0.1) { lo -= 0.25; hi += 0.25; }
    var bc = 10, counts = new Array(bc).fill(0);
    logs.forEach(function (v) { counts[Math.min(bc - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bc)))]++; });
    var maxC = Math.max(1, Math.max.apply(null, counts)), W = 132, H = 22, bw = W / bc;
    var svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, 'aria-label': 'Peer multiple distribution' });
    counts.forEach(function (c, i) {
      var bh = Math.max(1, (c / maxC) * (H - 4));
      svg.appendChild(svgEl('rect', { x: (i * bw + 1).toFixed(1), y: (H - bh).toFixed(1), width: Math.max(1, bw - 2).toFixed(1), height: bh.toFixed(1), fill: '#354b75', rx: '1.5' }));
    });
    var mx = ((t - lo) / (hi - lo)) * W;
    svg.appendChild(svgEl('line', { x1: mx.toFixed(1), y1: '0', x2: mx.toFixed(1), y2: String(H), stroke: '#2dd4a7', 'stroke-width': '2' }));
    return el('span', { 'class': 'mini-hist-wrap', title: 'Peer mcap/TVL distribution (green = fitted ' + fitted.toFixed(3) + '\u00d7)' }, el('span', { text: 'Peer spread' }), svg);
  }

  function whyProtocolLine(r) {
    var cat = r.category || 'Uncategorised';
    var same = DATA.rows.filter(function (x) { return (x.category || 'Uncategorised') === cat; }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; });
    var cr = 1; for (var i = 0; i < same.length; i++) if (same[i].slug === r.slug) { cr = i + 1; break; }
    var lead = cr === 1 ? 'Largest pre-token TVL in ' + cat + ' (' + fmtUsd(r.tvl_usd) + ', ' + same.length + ' ranked)' : '#' + cr + ' of ' + same.length + ' in ' + cat + ' by pre-token TVL (' + fmtUsd(r.tvl_usd) + ')';
    var chg = r.change_7d == null ? 'no 7-day TVL delta recorded' : (r.change_7d >= 0 ? 'up ' : 'down ') + Math.abs(r.change_7d).toFixed(2) + '% in 7 days';
    return lead + ', ' + chg + ', ' + (r.age_days == null ? 'listing date unrecorded (365d baseline)' : 'listed ' + fmtAge(r.age_days) + ' ago') + '.';
  }

  function rowHtml(item) {
    var r = item.r, e = item.e;
    var tr = el('tr', { tabindex: '0', onclick: function () { select(r.slug); }, onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(r.slug); } } });
    var rk = el('td', { 'class': 'rank' }, '#' + r.rank);
    var rrng = fmtRankRange(r);
    if (rrng) rk.appendChild(el('span', { text: rrng }));
    tr.appendChild(rk);

    var small = el('small');
    if (watchSet[r.slug]) small.appendChild(tag('watchlist', 'watch'));
    small.appendChild(tag(r.category || 'Uncategorised'));
    if (r.age_estimated) small.appendChild(tag('age est.', 'est'));
    if (r.no_7d_data) small.appendChild(tag('no 7d', 'est'));
    tr.appendChild(el('td', { 'class': 'name' }, el('b', { text: r.name, title: r.name }), small));
    tr.appendChild(td((r.chains || []).slice(0, 2).join(', ') || '\u2014', null, (r.chains || []).join(', ')));
    tr.appendChild(td(fmtUsd(r.tvl_usd), 'num'));
    tr.appendChild(td(fmtPct(r.change_7d), 'num ' + (r.change_7d == null ? '' : (r.change_7d >= 0 ? 'up' : 'down'))));
    tr.appendChild(td(fmtAge(r.age_days), 'num'));
    tr.appendChild(el('td', { 'class': 'num implied-col' }, el('b', { text: fmtUsd(r.implied_value_usd) }), el('span', { text: fmtRange(r.implied_low_usd, r.implied_high_usd) })));
    tr.appendChild(td(fmtOdds(r.launch_odds), 'num odds-col'));
    tr.appendChild(td(fmtUsd(r.risk_adj_usd), 'num risk-col'));
    tr.appendChild(el('td', null, el('span', { 'class': verdictCls(e.verdict), text: e.verdict })));
    tr.appendChild(td(fmtHourly(e.hr), 'num hr-col ' + (e.hr >= 0 ? 'up' : 'down')));
    return tr;
  }

  function detailViewHtml(r) {
    var frag = document.createDocumentFragment(), e = econFor(r, state.deposit);
    var nav = el('div', { 'class': 'nav-group' }), prev = rowByRank[r.rank - 1], next = rowByRank[r.rank + 1];
    if (prev) nav.appendChild(el('button', { type: 'button', 'class': 'nav-btn', text: '\u2190 #' + prev.rank + ' ' + prev.name, onclick: function () { select(prev.slug); } }));
    if (next) nav.appendChild(el('button', { type: 'button', 'class': 'nav-btn', text: '#' + next.rank + ' ' + next.name + ' \u2192', onclick: function () { select(next.slug); } }));
    frag.appendChild(el('div', { 'class': 'detail-topbar' }, el('button', { type: 'button', 'class': 'back-btn', text: '\u2190 Back to board', onclick: backToBoard }), buildDepositPicker(), nav));

    var box = el('section', { 'class': 'detail', 'aria-label': 'Protocol detail' });
    var badges = el('div', { 'class': 'detail-badges' }, el('span', { 'class': verdictCls(e.verdict), text: e.verdict }));
    if (watchSet[r.slug]) badges.appendChild(tag('watchlist', 'watch'));
    badges.appendChild(tag(r.category || 'Uncategorised'));
    badges.appendChild(tag('records no token', 'accent'));
    if (r.global_fit) badges.appendChild(tag('global fit', 'est'));
    if (r.winsorized) badges.appendChild(tag('P5\u2013P95 clamped', 'est'));
    if (r.age_estimated) badges.appendChild(tag('age estimated', 'est'));
    if (r.no_7d_data) badges.appendChild(tag('no 7d data', 'est'));
    var rrng = fmtRankRange(r);
    box.appendChild(el('div', { 'class': 'detail-head' }, el('h2', { text: '#' + r.rank + (rrng ? ' ' + rrng : '') + ' ' + r.name }), badges));
    box.appendChild(el('p', { 'class': 'why-line', text: whyProtocolLine(r) }));
    box.appendChild(el('p', { 'class': 'sub', text: 'Chains: ' + ((r.chains && r.chains.length) ? r.chains.join(', ') : '\u2014') }));

    var grid = el('div', { 'class': 'grid' });
    var catMed = r.category_median_multiple != null ? r.category_median_multiple.toFixed(3) + '\u00d7' : 'n/a';
    [
      { l: 'Implied value', v: fmtUsd(r.implied_value_usd), s: 'range ' + fmtRange(r.implied_low_usd, r.implied_high_usd), p: true },
      { l: 'Launch odds', v: fmtOdds(r.launch_odds), s: 'snapshot propensity (lower bound)' },
      { l: 'Risk-adjusted value', v: fmtUsd(r.risk_adj_usd), s: 'implied \u00d7 odds' },
      { l: 'Farming $/h (@$' + (state.deposit / 1000) + 'K)', v: fmtHourly(e.hr) + '/h', s: 'net ' + fmtExactUsd(e.net) + ' \u00b7 gas $' + r.farm_cost_usd + ' \u00b7 ' + r.farm_hours + 'h', c: e.hr >= 0 ? 'up' : 'down' },
      { l: 'TVL', v: fmtUsd(r.tvl_usd), s: (r.chains ? r.chains.length : 0) + ' chain' + ((r.chains && r.chains.length === 1) ? '' : 's') },
      { l: '7-day change', v: fmtPct(r.change_7d), s: 'growth ' + r.growth_multiplier.toFixed(2) + '\u00d7' + (r.no_7d_data ? ' (0% fallback)' : ''), c: r.change_7d == null ? '' : (r.change_7d >= 0 ? 'up' : 'down') },
      { l: 'Age (no token)', v: fmtAge(r.age_days), s: 'maturity ' + r.maturity_multiplier.toFixed(2) + '\u00d7' + (r.age_estimated ? ' (365d fallback)' : '') },
      { l: 'Fitted (' + DATA.calibration.winner + ')', v: r.fitted_multiple.toFixed(3) + '\u00d7', s: 'cat ' + catMed + ' \u00b7 glob ' + r.global_median_multiple.toFixed(3) + '\u00d7 \u00b7 MAPE ' + r.model_mape.toFixed(1) + '% (' + r.model_mape_scope + ' error)' }
    ].forEach(function (c) {
      grid.appendChild(el('div', { 'class': 'cell' + (c.p ? ' cell-primary' : '') }, el('span', { text: c.l }), el('b', { 'class': c.c || '', text: c.v }), el('small', { text: c.s })));
    });
    box.appendChild(grid);

    var check = impliedOf(r, DATA.model), checkExp = Math.round(check * r.launch_odds);
    var poolPct = Math.round(DATA.model.airdrop_pool_share * 100) + '%';
    var depTvlPct = Math.round(DATA.model.farming_deposit_tvl_share * 100) + '%';
    var sharePct = (e.share * 100 < 0.01 ? (e.share * 100).toFixed(5) : (e.share * 100).toFixed(4)) + '%';
    box.appendChild(el('div', { 'class': 'math' },
      el('div', { html: 'TVL ' + esc(fmtUsd(r.tvl_usd)) + ' \u00d7 fitted <code>' + r.fitted_multiple.toFixed(3) + '</code> \u00d7 growth <code>' + r.growth_multiplier.toFixed(2) + '</code> \u00d7 maturity <code>' + r.maturity_multiplier.toFixed(2) + '</code> = <code>' + esc(fmtUsd(check)) + '</code> (range <code>' + esc(fmtRange(r.implied_low_usd, r.implied_high_usd)) + '</code>, \u00f7/\u00d7 (1 + ' + r.model_mape.toFixed(1) + '% MAPE)). Expected value = implied <code>' + esc(fmtUsd(check)) + '</code> \u00d7 odds <code>' + fmtOdds(r.launch_odds) + '</code> = <code>' + esc(fmtUsd(checkExp)) + '</code>' + (check === r.implied_value_usd && Math.abs(checkExp - r.risk_adj_usd) <= 1 ? ' \u2014 verified live.' : '.') }),
      el('div', { html: 'Farming ($' + state.deposit.toLocaleString('en-US') + '): pool <code>' + esc(fmtUsd(e.pool)) + '</code> (' + poolPct + ') \u00d7 share <code>' + sharePct + '</code> (' + depTvlPct + ' TVL) \u00d7 odds <code>' + fmtOdds(r.launch_odds) + '</code> \u2212 gas <code>$' + r.farm_cost_usd + '</code> \u2212 opp. cost <code>$' + e.opp + '</code> (5%/90d) = net <code>' + esc(fmtExactUsd(e.net)) + '</code> over <code>' + r.farm_hours + 'h</code> \u2192 <code>' + esc(fmtHourly(e.hr)) + '/h</code> (' + esc(e.verdict) + ').' })
    ));

    var pi = peerComparablesFor(r);
    if (pi.rows.length) {
      var phr = el('tr');
      ['Peer protocol', 'Category', 'TVL', 'Market cap', 'Mcap / TVL'].forEach(function (h, i) { phr.appendChild(el('th', { 'class': i >= 2 ? 'num' : '', text: h })); });
      var pbody = el('tbody');
      pi.rows.forEach(function (p) {
        pbody.appendChild(el('tr', null, el('td', { html: '<b>' + esc(p.name) + '</b>' }), td(p.category), td(fmtUsd(p.tvl_usd), 'num'), td(fmtUsd(p.mcap_usd), 'num'), td(p.ratio.toFixed(3) + '\u00d7', 'num ratio')));
      });
      var phead = el('div', { 'class': 'peer-head' }, el('div', { 'class': 'peer-head-left' }, el('h3', { text: 'Peer comparables' }), el('span', { 'class': pi.badgeClass, text: pi.badge }), el('span', { 'class': 'peer-caption', text: pi.caption })), buildPeerMiniHistogram(pi.allRatios, r.fitted_multiple));
      box.appendChild(el('div', { 'class': 'peer-section' }, phead, el('div', { 'class': 'table-shell' }, el('table', { 'class': 'peer-table' }, el('thead', null, phr), pbody))));
    }

    box.appendChild(el('h3', { 'class': 'plan-title', text: 'Farm plan (6 steps \u00b7 sunk gas $' + r.farm_cost_usd + ' \u00b7 ' + r.farm_hours + 'h active)' }));
    var ol = el('ol', { 'class': 'steps' });
    farmSteps(r).forEach(function (s) { ol.appendChild(el('li', null, s.text + ' ', el('span', { 'class': 'meta', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }))); });
    box.appendChild(ol);
    box.appendChild(el('p', { 'class': 'note', text: 'Implied value states what a token would be worth if today\u2019s record held. Launch odds measure snapshot propensity (a lower bound on true launch probability). Farming $/h uses stated assumptions (' + poolPct + ' pool, ' + depTvlPct + ' TVL deposits, 5% APR over 90d), not guarantees.' }));
    frag.appendChild(box);
    return frag;
  }

  function renderLiveView(container) {
    container.innerHTML = '';
    var q = state.liveQ.trim().toLowerCase();
    var rows = (DATA.live || []).filter(function (p) { return !q || (p.name || '').toLowerCase().indexOf(q) >= 0 || (p.category || '').toLowerCase().indexOf(q) >= 0; });
    var cnt = document.getElementById('count');
    if (cnt) cnt.textContent = rows.length + ' of ' + DATA.live.length + ' live-token comparables (non-CEX with market cap, sorted by market cap)';
    var hr = el('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', 'Mcap / TVL', '7d'].forEach(function (h, i) { hr.appendChild(el('th', { 'class': i >= 3 ? 'num' : '', text: h })); });
    var body = el('tbody');
    rows.forEach(function (p) {
      body.appendChild(el('tr', null,
        el('td', { 'class': 'name', html: '<b>' + esc(p.name) + '</b>' }),
        td(p.category || '\u2014'), td((p.chains || []).slice(0, 2).join(', ') || '\u2014', null, (p.chains || []).join(', ')),
        td(fmtUsd(p.tvl_usd), 'num'), td(fmtUsd(p.mcap_usd), 'num'),
        td(p.ratio != null ? p.ratio.toFixed(3) + '\u00d7' : 'n/a', 'num ratio-col'),
        td(fmtPct(p.change_7d), 'num ' + (p.change_7d == null ? '' : (p.change_7d >= 0 ? 'up' : 'down')))
      ));
    });
    container.appendChild(el('div', { 'class': 'table-shell' }, el('table', { 'class': 'board b-live' }, el('thead', null, hr), body)));
  }

  function writeHash() {
    var parts = [];
    if (state.tab === 'live') parts.push('tab=live');
    if (state.selected) parts.push('detail=' + encodeURIComponent(state.selected));
    if (state.deposit !== ((DATA.model && DATA.model.default_deposit_usd) || 5000)) parts.push('deposit=' + state.deposit);
    if (state.verdict !== 'all') parts.push('verdict=' + encodeURIComponent(state.verdict));
    if (state.category !== 'all') parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watchOnly) parts.push('watch=1');
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    var nextHash = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== nextHash) {
      try { history.replaceState(null, '', nextHash || location.pathname + location.search); } catch (err) { location.hash = nextHash; }
    }
  }

  function setDeposit(d) { state.deposit = d; writeHash(); render(); }
  function select(slug) { state.selected = slug; render(); window.scrollTo(0, 0); }
  function backToBoard() { state.selected = null; writeHash(); render(); window.scrollTo(0, 0); }

  function readHash() {
    var h = (location.hash || '').replace(/^#/, ''), parts = {};
    h.split('&').forEach(function (kv) { var eq = kv.indexOf('='); if (eq > 0) parts[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1)); });
    state.tab = parts.tab === 'live' ? 'live' : 'pre';
    state.selected = parts.detail || null;
    state.category = parts.category || 'all';
    state.chain = parts.chain || 'all';
    state.verdict = ['FARM NOW', 'SELECTIVE', 'THIN', 'SKIP'].indexOf(parts.verdict) >= 0 ? parts.verdict : 'all';
    state.watchOnly = parts.watch === '1' || parts.watch === 'true';
    state.minTvl = parts.minTvl ? Number(parts.minTvl) || 0 : 0;
    state.minImplied = parts.minImplied ? Number(parts.minImplied) || 0 : 0;
    state.deposit = DEPOSITS.indexOf(Number(parts.deposit)) >= 0 ? Number(parts.deposit) : ((DATA.model && DATA.model.default_deposit_usd) || 5000);
    state.q = parts.q || '';
    if (parts.sort) state.sort = parts.sort;
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var wrap = el('div', { 'class': 'wrap' });
    var sel = state.tab === 'pre' && state.selected ? DATA.rows.filter(function (r) { return r.slug === state.selected; })[0] : null;
    if (sel) {
      wrap.appendChild(detailViewHtml(sel));
      wrap.appendChild(el('footer', { 'class': 'foot', text: 'Source: ' + DATA.source + ' \u00b7 Model ' + DATA.model_version + ' (' + DATA.calibration.winner + ', 5-fold MAPE ' + DATA.calibration.winner_mape.toFixed(1) + '%, odds AUC ' + DATA.calibration.odds_model.cv5.auc.toFixed(3) + ')' }));
      app.appendChild(wrap);
      return;
    }

    var cal = DATA.calibration, om = cal.odds_model, ex = DATA.exclusions;
    var stats = el('p', { 'class': 'stats' });
    [['Watchlist', DATA.watchlist_size], ['Board rows', DATA.board_size], ['Early finds', DATA.early_size], ['Live tokens', DATA.live_size]].forEach(function (s) {
      stats.appendChild(el('span', { 'class': 'stat' }, el('b', { text: String(s[1]) }), el('span', { text: s[0] })));
    });
    wrap.appendChild(el('header', { 'class': 'hero' },
      el('div', { 'class': 'hero-copy' },
        el('p', { 'class': 'eyebrow', text: 'Token Radar \u00b7 ' + DATA.model_version + ' \u00b7 snapshot ' + DATA.as_of }),
        el('h1', { text: 'Pre-token protocols: calibrated value, launch odds & farming verdicts' }),
        el('p', { 'class': 'lede', text: 'Every row records no token. Ranked by calibrated implied value with held-out error bands, snapshot launch propensity, risk-adjusted value, and live $/hr farming verdicts.' })
      ), stats));

    var cmp = cal.beats_median ? 'beats median by ' + (cal.median_mape - cal.winner_mape).toFixed(1) + ' pts' : (cal.winner === 'median' ? 'median baseline wins 5-fold CV' : 'does not beat median (' + cal.median_mape.toFixed(1) + '%)');
    var mPoolPct = Math.round(DATA.model.airdrop_pool_share * 100) + '%';
    var mDepTvlPct = Math.round(DATA.model.farming_deposit_tvl_share * 100) + '%';
    wrap.appendChild(el('section', { 'class': 'method' },
      el('p', { html: '<strong>Model ' + esc(DATA.model_version) + ' (' + esc(cal.winner) + '):</strong> held-out median error <code>' + cal.winner_mape.toFixed(1) + '%</code> (median method: <code>' + cal.median_mape.toFixed(1) + '%</code>; ' + esc(cmp) + '); range = fitted value \u00f7/\u00d7 (1 + held-out MAPE). <strong>Launch odds</strong> = logistic fit on the ' + om.sample_size + '-protocol snapshot (AUC <code>' + om.cv5.auc.toFixed(3) + '</code>, snapshot launch propensity / lower bound \u2014 see Method); risk-adjusted value = implied \u00d7 odds.' }),
      el('p', { text: 'Verdicts from $/hr at selected deposit (T1=' + fmtHourly(cal.verdicts.t1_farm_now) + '/h, T2=' + fmtHourly(cal.verdicts.t2_selective) + '/h); assumptions: airdrop pool ' + mPoolPct + ' of implied value, farming deposits ' + mDepTvlPct + ' of TVL, 5% annual opp. cost over 90 days. Coverage: ' + ex.total_pre_token + ' pre-token \u2192 ' + ex.ranked + ' ranked (' + ex.excluded_total + ' excluded by rule).' })
    ));

    if (state.tab === 'pre') wrap.appendChild(el('div', { id: 'chartwrap' }));

    var toolbar = el('div', { 'class': 'toolbar' },
      el('div', { 'class': 'tabs', role: 'tablist' },
        el('button', { type: 'button', 'class': 'tab', role: 'tab', 'aria-selected': String(state.tab === 'pre'), text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre'; state.selected = null; render(); } }),
        el('button', { type: 'button', 'class': 'tab', role: 'tab', 'aria-selected': String(state.tab === 'live'), text: 'Live tokens (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; state.selected = null; render(); } })
      ),
      state.tab === 'pre' ? buildDepositPicker() : null
    );
    wrap.appendChild(toolbar);
    wrap.appendChild(el('div', { 'class': 'count-bar' }, el('p', { 'class': 'verdict-sum', id: 'vsum' }), el('p', { 'class': 'count', id: 'count' })));

    if (state.tab === 'live') {
      var lq = el('input', { type: 'search', placeholder: 'Filter live tokens by name or category\u2026', value: state.liveQ, 'aria-label': 'Filter live tokens' });
      var lwrap = el('div', { id: 'livewrap' });
      lq.addEventListener('input', function () { state.liveQ = lq.value; renderLiveView(lwrap); });
      wrap.appendChild(el('div', { 'class': 'controls' }, lq));
      wrap.appendChild(lwrap);
      renderLiveView(lwrap);
    } else {
      var q = el('input', { type: 'search', placeholder: 'Search name or slug\u2026', value: state.q, 'aria-label': 'Search protocols' });
      q.addEventListener('input', function () { state.q = q.value; renderPreContent(); });
      var cat = el('select', { 'aria-label': 'Filter by category' }, el('option', { value: 'all', text: 'All categories' }));
      categories().forEach(function (c) { cat.appendChild(el('option', { value: c, text: c })); });
      cat.value = state.category; cat.addEventListener('change', function () { state.category = cat.value; renderPreContent(); });
      var ch = el('select', { 'aria-label': 'Filter by chain' }, el('option', { value: 'all', text: 'All chains' }));
      chains().forEach(function (c) { ch.appendChild(el('option', { value: c, text: c })); });
      ch.value = state.chain; ch.addEventListener('change', function () { state.chain = ch.value; renderPreContent(); });
      var verd = el('select', { 'aria-label': 'Filter by verdict' });
      [['all', 'All verdicts'], ['FARM NOW', 'Farm now'], ['SELECTIVE', 'Selective'], ['THIN', 'Thin'], ['SKIP', 'Skip']].forEach(function (o) { verd.appendChild(el('option', { value: o[0], text: o[1] })); });
      verd.value = state.verdict; verd.addEventListener('change', function () { state.verdict = verd.value; renderPreContent(); });

      var watchBtn = el('button', { type: 'button', 'class': 'toggle-btn', 'aria-pressed': String(state.watchOnly), text: 'Watchlist', onclick: function () { state.watchOnly = !state.watchOnly; watchBtn.setAttribute('aria-pressed', String(state.watchOnly)); renderPreContent(); } });
      var tvlBtn = el('button', { type: 'button', 'class': 'toggle-btn', 'aria-pressed': String(state.minTvl >= 1e8), text: 'TVL \u2265 $100M', onclick: function () { state.minTvl = state.minTvl >= 1e8 ? 0 : 1e8; tvlBtn.setAttribute('aria-pressed', String(state.minTvl >= 1e8)); renderPreContent(); } });
      var impBtn = el('button', { type: 'button', 'class': 'toggle-btn', 'aria-pressed': String(state.minImplied >= 5e7), text: 'Implied \u2265 $50M', onclick: function () { state.minImplied = state.minImplied >= 5e7 ? 0 : 5e7; impBtn.setAttribute('aria-pressed', String(state.minImplied >= 5e7)); renderPreContent(); } });
      var sort = el('select', { 'aria-label': 'Sort by' });
      [['implied', 'Sort: implied'], ['risk', 'Sort: risk-adj'], ['hr', 'Sort: $/h'], ['odds', 'Sort: odds'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7d'], ['age', 'Sort: age'], ['name', 'Sort: name']].forEach(function (o) { sort.appendChild(el('option', { value: o[0], text: o[1] })); });
      sort.value = ['implied', 'risk', 'hr', 'odds', 'tvl', 'growth', 'age', 'name'].indexOf(state.sort) >= 0 ? state.sort : 'implied';
      sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; renderPreContent(); });
      var resetBtn = el('button', { type: 'button', 'class': 'reset-btn', id: 'resetbtn', text: 'Reset', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.verdict = 'all'; state.watchOnly = false; state.minTvl = 0; state.minImplied = 0; render(); } });

      wrap.appendChild(el('div', { 'class': 'controls' }, q, cat, ch, verd, watchBtn, tvlBtn, impBtn, sort, resetBtn));
      wrap.appendChild(el('div', { id: 'tablewrap' }));
      wrap.appendChild(el('h2', { 'class': 'section-title', text: 'Method, validation, launch odds & distribution' }));
      wrap.appendChild(el('div', { 'class': 'analytics-grid' }, buildBakeoffCard(), buildCalibrationPlot()));
      wrap.appendChild(el('div', { 'class': 'analytics-grid' }, buildAblationCard(), buildOddsCard()));
      wrap.appendChild(el('div', { 'class': 'analytics-grid' }, buildCategorySummaryCard(), buildHistogram()));
    }

    wrap.appendChild(el('footer', { 'class': 'foot', text: 'Source: ' + DATA.source + ' \u00b7 Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' \u00b7 Model ' + DATA.model_version + ' \u00b7 Deterministic build, zero network.' }));
    app.appendChild(wrap);
    if (state.tab === 'pre') renderPreContent();
  }

  function renderPreContent() {
    var items = filteredRows(), vc = computeVerdictCounts();
    var vs = document.getElementById('vsum');
    if (vs) vs.textContent = vc['FARM NOW'] + ' FARM NOW \u00b7 ' + vc.SELECTIVE + ' SELECTIVE \u00b7 ' + vc.THIN + ' THIN \u00b7 ' + vc.SKIP + ' SKIP at $' + state.deposit.toLocaleString('en-US');
    var count = document.getElementById('count');
    if (count) {
      var parts = [items.length + ' of ' + DATA.rows.length + ' protocols'];
      if (state.verdict !== 'all') parts.push(state.verdict);
      if (state.watchOnly) parts.push('watchlist');
      if (state.category !== 'all') parts.push(state.category);
      if (state.chain !== 'all') parts.push(state.chain);
      count.textContent = parts.join(' \u00b7 ');
    }
    var rb = document.getElementById('resetbtn');
    if (rb) rb.style.display = hasActiveFilter() ? '' : 'none';

    var cw = document.getElementById('chartwrap');
    if (cw) { cw.innerHTML = ''; cw.appendChild(el('div', { 'class': 'charts-row' }, buildTopChart(items), buildScatterChart(items))); }

    var tw = document.getElementById('tablewrap');
    if (!tw) return;
    tw.innerHTML = '';
    if (!items.length) { tw.appendChild(el('div', { 'class': 'table-shell' }, el('p', { 'class': 'empty', text: 'No protocol matches that filter.' }))); return; }

    var hr = el('tr');
    [['#', 'rank'], ['Protocol', 'name'], ['Chains', 'chains'], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Implied', 'implied'], ['Odds', 'odds'], ['Risk-Adj', 'risk'], ['Verdict', 'verdict'], ['$/h', 'hr']].forEach(function (h, i) {
      var arrow = state.sort === h[1] ? (state.dir === -1 ? ' \u2193' : ' \u2191') : '';
      var b = el('button', { type: 'button', text: h[0] + arrow });
      b.addEventListener('click', function () {
        if (state.sort === h[1]) state.dir = -state.dir;
        else { state.sort = h[1]; state.dir = (h[1] === 'name' || h[1] === 'chains') ? 1 : -1; }
        renderPreContent();
      });
      hr.appendChild(el('th', { 'class': (i >= 3 && i !== 9) ? 'num' : '' }, b));
    });
    var body = el('tbody');
    items.forEach(function (x) { body.appendChild(rowHtml(x)); });
    tw.appendChild(el('div', { 'class': 'table-shell' }, el('table', { 'class': 'board b-pre' }, el('thead', null, hr), body)));
  }

  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) backToBoard(); });
  readHash();
  render();
})();
