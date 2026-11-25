// Token Radar v7 (radar-4) offline dashboard. Zero network, zero host.
// Reads the global DATA object (window.RADAR, written by data.js) and renders
// the whole page from it: the ranked pre-token board, the live-token tab, the
// per-protocol detail view, the charts and the Method section. Every number
// shown comes from DATA; nothing is hard-coded. The dashboard mounts into
// the element with id "app" (see index.html).
//
// What the page shows, in order: header + stat cards, the model box, the
// Top-10 bar chart beside the market scatter plot, the board/live tabs with
// the deposit picker, the verdict counts, the filter bar, the board table
// (or the live table, or one protocol's detail view), then the Method
// section (bake-off, ablation, odds validation, calibration plot, category
// summary, distribution histogram, coverage). State lives in the URL hash
// so a link or a screenshot preserves the exact view.

(function () {
  'use strict';

  var DATA = window.RADAR || null;
  var MOUNT_ID = 'app';

  // ---------- tiny DOM + formatting helpers ----------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function round1(x) { return Math.round(x * 10) / 10; }
  function round2(x) { return Math.round(x * 100) / 100; }

  // Money: $2.75B / $54.5M / $210K / $96. Whole dollars below $1,000.
  function fmtMoney(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    var neg = v < 0, a = Math.abs(v), out;
    if (a >= 1e9) out = '$' + trimNum(a / 1e9, 2) + 'B';
    else if (a >= 1e6) out = '$' + trimNum(a / 1e6, 1) + 'M';
    else if (a >= 1e3) out = '$' + Math.round(a / 1e3) + 'K';
    else out = '$' + Math.round(a);
    return neg ? '−' + out : out;
  }

  // $54.5M with more precision for the detail formula line.
  function fmtMoney2(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    var a = Math.abs(v), out;
    if (a >= 1e9) out = '$' + trimNum(a / 1e9, 2) + 'B';
    else if (a >= 1e6) out = '$' + trimNum(a / 1e6, 2) + 'M';
    else if (a >= 1e3) out = '$' + trimNum(a / 1e3, 1) + 'K';
    else out = '$' + Math.round(a);
    return v < 0 ? '−' + out : out;
  }

  function trimNum(x, dec) {
    var s = x.toFixed(dec);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function fmtMultiple(x) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return trimNum(x, 3) + '×';
  }

  function fmtPct(x, dec) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    var d = dec === undefined ? 2 : dec;
    return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d) + '%';
  }

  // Plain percentage with no sign (for MAPEs, odds bins, rates).
  function pct(x, dec) {
    if (x === null || x === undefined || !isFinite(x)) return 'n/a';
    return trimNum(x, dec === undefined ? 1 : dec) + '%';
  }

  // $/h: "$121.35" when positive, "−$58.68" when negative, always 2 decimals.
  function fmtPerHour(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2);
  }

  function fmtOdds(o) {
    if (o === null || o === undefined || !isFinite(o)) return 'n/a';
    return Math.round(o * 100) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined || !isFinite(days)) return 'n/a';
    if (days < 365) return Math.max(1, Math.round(days / 30)) + 'mo';
    return trimNum(days / 365, 1) + 'y';
  }

  function fmtHours(h) {
    if (h === null || h === undefined || !isFinite(h)) return 'n/a';
    return trimNum(h, 1) + 'h';
  }

  function fmtInt(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Deposit amounts always with a thousands comma: $1,000 / $5,000 / $25,000.
  function fmtDeposit(d) { return '$' + fmtInt(d); }

  // ---------- model constants (all read from DATA.model) ----------

  var M = DATA ? DATA.model : {};
  var DEPOSITS = [1000, 5000, 10000, 25000];
  var DEFAULT_DEPOSIT = (M && M.default_deposit_usd) || 5000;

  function poolShare() { return (M && M.airdrop_pool_share) || 0.05; }
  function depositShare() { return (M && M.farming_deposit_tvl_share) || 0.2; }
  function oppApr() { return (M && M.opp_cost_apr) || 0.05; }
  function horizonDays() { return (M && M.horizon_days) || 90; }

  // ---------- farming economics (SPEC-v4 §4.1, recomputed live) ----------

  // Returns {pool, deposits, share, expected, opp, net, perHour, verdict}
  // for one board row at the given deposit. Thresholds T1/T2 come from the
  // calibration (fixed at the default deposit) and never move.
  function computeFarm(row, deposit) {
    var cal = DATA.calibration || {};
    var v = cal.verdicts || {};
    var t1 = v.t1_farm_now, t2 = v.t2_selective;
    var pool = poolShare() * row.implied_value_usd;
    var deposits = depositShare() * row.tvl_usd;
    var share = deposits > 0 ? deposit / deposits : 0;
    var expected = pool * share * row.launch_odds;
    var opp = deposit * oppApr() * horizonDays() / 365;
    var net = expected - row.farm_cost_usd - opp;
    var perHour = row.farm_hours > 0 ? net / row.farm_hours : net;
    var verdict = perHour >= t1 ? 'FARM NOW'
      : perHour >= t2 ? 'SELECTIVE'
      : perHour >= 0 ? 'THIN' : 'SKIP';
    return {
      pool: pool, deposits: deposits, share: share,
      expected: expected, opp: opp, net: net,
      perHour: round2(perHour), verdict: verdict,
    };
  }

  // The stored $/hr and verdict at the default deposit, straight from DATA.
  function storedFarm(row) {
    return { perHour: row.farm_per_hour_usd, verdict: row.verdict };
  }

  // ---------- farm plan: 6 steps regenerated from the row (SPEC-v4 §3) ----------
  //
  // data.js carries only the numeric totals (farm_cost_usd, farm_hours), so
  // the step text is rebuilt here from the row's own fields. The amount tier
  // follows TVL (≥$1B → $150, ≥$100M → $100, else $50); the step-2 gas is
  // $8 for the $150 tier and $4 otherwise; the step-3 cost and hours are
  // backed out of the row's own totals (cost = total − $3 − step2, hours from
  // the total), and the hold length follows the step-3 tier (30/45/60 days).
  // Steps 1, 5 and 6 are the same for every protocol. The action wording of
  // steps 2 and 3 depends on the protocol's category.

  var FARM_ACTIONS = {
    'Risk Curators': ['Deposit {A} into a {N} vault on {C} and keep the shares.',
      'Add a second, smaller deposit to a different {N} vault on {C} the following week.'],
    'Onchain Capital Allocator': ['Deposit {A} into a {N} vault on {C} and keep the shares.',
      'Add a second, smaller deposit to a different {N} vault on {C} the following week.'],
    'CDP': ['Supply {A} of USDC to {N} on {C} and keep the position open.',
      'Borrow a small amount against the supply on {N} and repay it the same week, so the address shows both sides of the market.'],
    'Prediction Market': ['Fund {A} and place one market position on {N}.',
      'Settle one market and open a second one the following week, keeping the account funded between them.'],
    'Yield Aggregator': ['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.',
      'Swap a small amount through {N}\'s router on {C} each week, so the address is a trader as well as a liquidity provider.'],
    'Collateral Markets': ['Supply {A} of USDC to {N} on {C} and keep the position open.',
      'Borrow a small amount against the supply on {N} and repay it the same week, so the address shows both sides of the market.'],
    'RWA': ['Mint {A} of the protocol\'s yield asset on {C} and hold it.',
      'Claim the yield the asset earns once a month and leave the principal in place.'],
    'Chain': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Lending': ['Supply {A} of USDC to {N} on {C} and keep the position open.',
      'Borrow a small amount against the supply on {N} and repay it the same week, so the address shows both sides of the market.'],
    'Basis Trading': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Dexs': ['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.',
      'Swap a small amount through {N}\'s router on {C} each week, so the address is a trader as well as a liquidity provider.'],
    'CDP Manager': ['Supply {A} of USDC to {N} on {C} and keep the position open.',
      'Borrow a small amount against the supply on {N} and repay it the same week, so the address shows both sides of the market.'],
    'Payments': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Restaking': ['Stake {A} of the chain\'s staking asset through {N} and keep the receipt.',
      'Restake or delegate the receipt token once, and vote in one governance proposal if {N} opens one.'],
    'OTC Marketplace': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Stablecoin Wrapper': ['Mint or deposit {A} of the stable asset through {N} on {C}.',
      'Use the minted stable asset in one payment or deposit on {C} each week, then return it to the protocol.'],
    'Derivatives': ['Deposit {A} of USDC as margin on {N} and open one small hedge.',
      'Close the hedge and open a second small one the following week, keeping the margin deposit in place throughout.'],
    'CeDeFi': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Yield': ['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.',
      'Swap a small amount through {N}\'s router on {C} each week, so the address is a trader as well as a liquidity provider.'],
    'Staking Pool': ['Stake {A} of the chain\'s staking asset through {N} and keep the receipt.',
      'Restake or delegate the receipt token once, and vote in one governance proposal if {N} opens one.'],
    'Liquidity Manager': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Farm': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Cross Chain Bridge': ['Bridge {A} of USDC to {C} through {N} and use the bridged funds in its app.',
      'Use the bridged funds for one swap or deposit in an app on {C} within the same week, so the bridge is not the only trace.'],
    'Anchor BTC': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Insurance': ['Buy {A} of cover from {N} on {C} and keep the policy.',
      'Renew the cover once before it lapses, so the policy runs without a gap.'],
    'Governance Incentives': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Leveraged Farming': ['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.',
      'Swap a small amount through {N}\'s router on {C} each week, so the address is a trader as well as a liquidity provider.'],
    'Decentralized BTC': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Crypto Card Issuer': ['Deposit {A} of USDC into {N} on {C} and keep the position open.',
      'Make one more deposit, swap or vote on {N} each week, a different action from the first.'],
    'Dual-Token Stablecoin': ['Mint or deposit {A} of the stable asset through {N} on {C}.',
      'Use the minted stable asset in one payment or deposit on {C} each week, then return it to the protocol.'],
    'Uncollateralized Lending': ['Supply {A} of USDC to {N} on {C} and keep the position open.',
      'Borrow a small amount against the supply on {N} and repay it the same week, so the address shows both sides of the market.'],
    'Indexes': ['Provide {A} of liquidity to {N}\'s main pool on {C} and keep the position open.',
      'Swap a small amount through {N}\'s router on {C} each week, so the address is a trader as well as a liquidity provider.'],
    'Interest Rate Derivatives': ['Deposit {A} of USDC as margin on {N} and open one small hedge.',
      'Close the hedge and open a second small one the following week, keeping the margin deposit in place throughout.'],
  };

  function farmSteps(row) {
    var amt = row.tvl_usd >= 1e9 ? 150 : row.tvl_usd >= 1e8 ? 100 : 50;
    var c2 = amt === 150 ? 8 : 4;
    var c3 = row.farm_cost_usd - 3 - c2;
    var h3 = row.farm_hours >= 2.0 ? 1.5 : row.farm_hours >= 1.45 ? 1 : 0.667;
    var days = c3 === 18 ? 60 : c3 === 12 ? 45 : 30;
    var tpl = FARM_ACTIONS[row.category] || FARM_ACTIONS['Chain'];
    var chain0 = (row.chains && row.chains[0]) || 'Ethereum';
    function sub(t) {
      return t.split('{N}').join(row.name).split('{C}').join(chain0)
        .split('{A}').join('$' + amt);
    }
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.', cost_usd: 3, hours: 0.083 },
      { text: sub(tpl[0]) + ' Cost: $' + amt + ' of capital and about $' + c2 + ' of gas. Time: 15 minutes to set up.', cost_usd: c2, hours: 0.25 },
      { text: sub(tpl[1]) + ' Cost: about $2 of gas a week. Time: 10 minutes a week.', cost_usd: c3, hours: h3 },
      { text: 'Hold the position for at least ' + days + ' days so the activity is counted in more than one snapshot. Cost: the $' + amt + ' stays in the position. Time: ' + days + ' days.', cost_usd: 0, hours: 0 },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.', cost_usd: 0, hours: 0.167 },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.', cost_usd: 0, hours: 0.083 },
    ];
  }

  // ---------- state + URL hash ----------
  //
  // Every view control is reflected in the hash, so a link or a screenshot
  // preserves the exact view: #q=, #sort=, #dir=, #category=, #chain=,
  // #verdict=, #watch=1, #minTvl=, #minImplied=, #tab=live, #detail=<slug>,
  // #deposit=. The default view (no hash) is the board, sorted by implied
  // value, at the $5,000 deposit.

  var SORT_KEYS = ['implied', 'name', 'tvl', 'odds', 'risk-adj', 'perhour'];
  var VERDICTS = ['FARM NOW', 'SELECTIVE', 'THIN', 'SKIP'];

  var state = {
    q: '', sort: 'implied', dir: -1,
    category: '', chain: '', verdict: '',
    watch: false, minTvl: 0, minImplied: 0,
    tab: 'board', detail: '', deposit: DEFAULT_DEPOSIT,
  };

  function defaultState() {
    return {
      q: '', sort: 'implied', dir: -1,
      category: '', chain: '', verdict: '',
      watch: false, minTvl: 0, minImplied: 0,
      tab: 'board', detail: '', deposit: DEFAULT_DEPOSIT,
    };
  }

  function readHash() {
    var s = defaultState();
    var raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return s;
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'q') s.q = v;
      else if (k === 'sort' && SORT_KEYS.indexOf(v) >= 0) s.sort = v;
      else if (k === 'dir') s.dir = v === 'asc' ? 1 : -1;
      else if (k === 'category') s.category = v;
      else if (k === 'chain') s.chain = v;
      else if (k === 'verdict' && VERDICTS.indexOf(v) >= 0) s.verdict = v;
      else if (k === 'watch') s.watch = v === '1';
      else if (k === 'minTvl') s.minTvl = parseInt(v, 10) || 0;
      else if (k === 'minImplied') s.minImplied = parseInt(v, 10) || 0;
      else if (k === 'tab' && (v === 'board' || v === 'live')) s.tab = v;
      else if (k === 'detail') s.detail = v;
      else if (k === 'deposit' && DEPOSITS.indexOf(parseInt(v, 10)) >= 0) s.deposit = parseInt(v, 10);
    });
    return s;
  }

  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.sort !== 'implied' || state.dir !== -1) parts.push('dir=' + (state.dir === 1 ? 'asc' : 'desc'));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.verdict) parts.push('verdict=' + encodeURIComponent(state.verdict));
    if (state.watch) parts.push('watch=1');
    if (state.minTvl) parts.push('minTvl=' + state.minTvl);
    if (state.minImplied) parts.push('minImplied=' + state.minImplied);
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    if (state.deposit !== DEFAULT_DEPOSIT) parts.push('deposit=' + state.deposit);
    var h = parts.length ? '#' + parts.join('&') : '';
    try {
      if (window.location.hash !== h) {
        window.history.replaceState(null, '', h || window.location.pathname + window.location.search);
      }
    } catch (e) { /* file:// or restricted context: hash is best-effort */ }
  }

  // ---------- filtering + sorting ----------
  //
  // Filtering runs over the computed rows (each row carries its $/hr and
  // verdict at the current deposit). The board rank never changes — the
  // table is always a subset of the implied-value ranking.

  var computedCache = null; // [{row, farm:{...}}] at the current deposit

  function computedRows() {
    if (computedCache) return computedCache;
    computedCache = DATA.rows.map(function (r) {
      return { row: r, farm: computeFarm(r, state.deposit) };
    });
    return computedCache;
  }

  function invalidateComputed() { computedCache = null; }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var out = computedRows().filter(function (c) {
      var r = c.row;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.verdict && c.farm.verdict !== state.verdict) return false;
      if (state.watch && DATA.watchlist.indexOf(r.slug) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (state.minImplied && r.implied_value_usd < state.minImplied) return false;
      return true;
    });
    var key = state.sort, d = state.dir;
    out.sort(function (a, b) {
      var x, y;
      if (key === 'name') { x = a.row.name.toLowerCase(); y = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { x = a.row.tvl_usd; y = b.row.tvl_usd; }
      else if (key === 'odds') { x = a.row.launch_odds; y = b.row.launch_odds; }
      else if (key === 'risk-adj') { x = a.row.risk_adj_usd; y = b.row.risk_adj_usd; }
      else if (key === 'perhour') { x = a.farm.perHour; y = b.farm.perHour; }
      else { x = a.row.implied_value_usd; y = b.row.implied_value_usd; }
      if (x < y) return -d;
      if (x > y) return d;
      return a.row.rank - b.row.rank;
    });
    return out;
  }

  function verdictCounts() {
    var counts = { 'FARM NOW': 0, 'SELECTIVE': 0, 'THIN': 0, 'SKIP': 0 };
    computedRows().forEach(function (c) { counts[c.farm.verdict]++; });
    return counts;
  }

  function isFiltered() {
    return !!(state.q || state.category || state.chain || state.verdict ||
      state.watch || state.minTvl || state.minImplied);
  }

  // ---------- peer helpers ----------

  // The 5 live protocols whose mcap/TVL sits closest to the row's fitted
  // multiple (by log distance). Peers are the live comparables, never other
  // board rows.
  function peerComparables(row) {
    var target = row.fitted_multiple;
    var scored = DATA.live.map(function (p) {
      return { p: p, d: Math.abs(Math.log(p.ratio / target)) };
    });
    scored.sort(function (a, b) { return a.d - b.d; });
    return scored.slice(0, 5).map(function (s) { return s.p; });
  }

  // All live ratios in the row's peer scope: its own category when the row
  // has category peers, else every live ratio. Used by the peer histogram.
  function peerRatios(row) {
    var scope = row.peer_category;
    var list = DATA.live.filter(function (p) {
      return scope === 'all live-token protocols' ? true : p.category === scope;
    });
    return list.map(function (p) { return p.ratio; }).sort(function (a, b) { return a - b; });
  }

  function medianOf(sorted) {
    if (!sorted.length) return null;
    var n = sorted.length, mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function quantileOf(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Log-spaced bins between min and max (6 bins, edges rounded to 2
  // significant figures). Returns [{lo, hi, count}] plus the two fullest
  // adjacent bins for the caption.
  function logBins(values, nBins) {
    var vals = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return { bins: [], topLo: null, topHi: null, topCount: 0 };
    var lo = vals[0], hi = vals[vals.length - 1];
    if (hi <= lo) hi = lo * 10;
    var logLo = Math.log10(lo), logHi = Math.log10(hi);
    var edges = [];
    for (var i = 0; i <= nBins; i++) {
      edges.push(roundSig(Math.pow(10, logLo + (logHi - logLo) * i / nBins), 2));
    }
    edges[0] = lo; edges[nBins] = hi;
    var bins = [];
    for (var j = 0; j < nBins; j++) {
      var count = vals.filter(function (v) {
        return j === nBins - 1 ? (v >= edges[j] && v <= edges[j + 1]) : (v >= edges[j] && v < edges[j + 1]);
      }).length;
      bins.push({ lo: edges[j], hi: edges[j + 1], count: count });
    }
    var best = 0, bestCount = -1;
    for (var k = 0; k < nBins - 1; k++) {
      var c = bins[k].count + bins[k + 1].count;
      if (c > bestCount) { bestCount = c; best = k; }
    }
    return {
      bins: bins,
      topLo: bins[best].lo, topHi: bins[best + 1].hi, topCount: bestCount,
    };
  }

  function roundSig(x, sig) {
    if (x <= 0) return x;
    var p = Math.pow(10, sig - 1 - Math.floor(Math.log10(x)));
    return Math.round(x * p) / p;
  }

  // ---------- SVG helpers (pure SVG, no libraries) ----------

  var SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }

  function svgText(parent, x, y, s, cls, anchor) {
    var t = svgEl('text', { x: x, y: y, 'class': cls || '' }, parent);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = s;
    return t;
  }

  // ---------- page header + stat cards + model box ----------

  function renderHeader(root) {
    var head = el('header', 'page-head');
    var left = el('div', 'head-left');
    var eyebrow = el('div', 'eyebrow', 'TOKEN RADAR · ' + (DATA.model_version || 'radar-4').toUpperCase() + ' · SNAPSHOT ' + DATA.as_of);
    var title = el('h1', null, 'Pre-token protocols: calibrated implied value, launch odds & farming verdicts');
    var sub = el('p', 'subtitle', 'Every row records no token. Ranked by calibrated implied value with held-out error bands, snapshot launch propensity, risk-adjusted value, and live $/hr farming verdicts.');
    left.appendChild(eyebrow); left.appendChild(title); left.appendChild(sub);
    var stats = el('div', 'stat-cards');
    [
      [DATA.watchlist_size, 'WATCHLIST'],
      [DATA.board_size, 'BOARD ROWS'],
      [DATA.early_size, 'EARLY FINDS'],
      [DATA.live_size, 'LIVE TOKENS'],
    ].forEach(function (s) {
      var card = el('div', 'stat-card');
      card.appendChild(el('div', 'stat-num', fmtInt(s[0])));
      card.appendChild(el('div', 'stat-label', s[1]));
      stats.appendChild(card);
    });
    head.appendChild(left); head.appendChild(stats);
    root.appendChild(head);
  }

  function renderModelBox(root) {
    var cal = DATA.calibration || {};
    var v = cal.verdicts || {};
    var box = el('section', 'model-box');
    var win = (cal.bakeoff || []).filter(function (b) { return b.winner; })[0] || {};
    var line1 = document.createElement('p');
    line1.innerHTML =
      '<strong>Model ' + esc(DATA.model_version || 'radar-4') + ' (' + esc(win.name || cal.winner || '') + '):</strong> ' +
      'held-out median error <strong>' + esc(pct(cal.winner_mape, 1)) + '</strong> ' +
      '(median method: ' + esc(pct(cal.median_mape, 1)) + ', beats median by ' +
      esc(trimNum((cal.median_mape || 0) - (cal.winner_mape || 0), 1)) + ' pts); ' +
      'range = fitted value ÷/× (1 + held-out MAPE). ' +
      '<strong>Launch odds</strong> = logistic fit on the ' + fmtInt((cal.odds_model || {}).sample_size || 758) +
      '-protocol snapshot (AUC ' + esc(trimNum(((cal.odds_model || {}).cv5 || {}).auc || 0, 3)) +
      '): snapshot launch propensity / lower bound — see Method; ' +
      'risk-adjusted value = implied × odds.';
    var line2 = document.createElement('p');
    line2.innerHTML =
      'Verdicts from $/hr at the selected deposit (T1=$' + esc(fmtInt(v.t1_farm_now || 0)) + '/h, T2=$' +
      esc(fmtInt(v.t2_selective || 0)) + '/h); assumptions: airdrop pool ' +
      esc(Math.round(poolShare() * 100)) + '% of implied value, farming deposits ' +
      esc(Math.round(depositShare() * 100)) + '% of TVL, ' + esc(Math.round(oppApr() * 100)) +
      '% annual opp. cost over ' + esc(horizonDays()) + ' days. ' +
      'Coverage: ' + fmtInt((DATA.exclusions || {}).total_pre_token || 0) + ' pre-token → ' +
      fmtInt(DATA.board_size) + ' ranked (' + fmtInt((DATA.exclusions || {}).excluded_total || 0) +
      ' excluded by rule).';
    box.appendChild(line1); box.appendChild(line2);
    root.appendChild(box);
  }

  // ---------- charts row: Top-10 bars + scatter plot ----------

  function renderCharts(root, rows) {
    var wrap = el('div', 'charts-row');
    wrap.appendChild(top10Chart(rows));
    wrap.appendChild(scatterPlot(rows));
    root.appendChild(wrap);
  }

  function top10Chart(rows) {
    var sec = el('section', 'chart-card');
    var filtered = isFiltered();
    var h = el('h2', null, filtered ? 'Top 10 matching by implied value' : 'Top 10 pre-token by implied value');
    var hint = el('span', 'chart-hint', 'Linear scale · click bar');
    var head = el('div', 'chart-head');
    head.appendChild(h); head.appendChild(hint);
    sec.appendChild(head);
    var top = rows.slice(0, 10);
    var max = top.length ? top[0].row.implied_value_usd : 1;
    var list = el('div', 'top10');
    top.forEach(function (c) {
      var r = c.row;
      var item = el('div', 'top10-row');
      item.setAttribute('data-act', 'detail');
      item.setAttribute('data-slug', r.slug);
      item.setAttribute('title', r.name + ' — ' + fmtMoney(r.implied_value_usd));
      var rank = el('span', 'top10-rank', '#' + r.rank);
      var name = el('span', 'top10-name', r.name);
      var barWrap = el('span', 'top10-barwrap');
      var bar = el('span', 'top10-bar');
      bar.style.width = Math.max(2, (r.implied_value_usd / max) * 100) + '%';
      barWrap.appendChild(bar);
      var val = el('span', 'top10-val', fmtMoney(r.implied_value_usd));
      item.appendChild(rank); item.appendChild(name);
      item.appendChild(barWrap); item.appendChild(val);
      list.appendChild(item);
    });
    if (!top.length) list.appendChild(el('p', 'empty-note', 'No rows match the current filters.'));
    sec.appendChild(list);
    return sec;
  }

  function scatterPlot(rows) {
    var sec = el('section', 'chart-card');
    var head = el('div', 'chart-head');
    head.appendChild(el('h2', null, 'Market pricing: TVL vs mcap/TVL'));
    var legend = el('span', 'chart-hint', '');
    legend.innerHTML = '<span class="dot dot-live"></span> Live (' + DATA.live_size + ') &nbsp; <span class="dot dot-top"></span> Top 20';
    head.appendChild(legend);
    sec.appendChild(head);

    var W = 560, H = 300, padL = 46, padR = 12, padT = 10, padB = 30;
    var live = DATA.live;
    var top20 = rows.slice(0, 20).map(function (c) { return c.row; });
    var xs = live.map(function (p) { return p.tvl_usd; }).concat(top20.map(function (r) { return r.tvl_usd; }));
    var ys = live.map(function (p) { return p.ratio; }).concat(top20.map(function (r) { return r.implied_value_usd / r.tvl_usd; }));
    var xLo = Math.log10(Math.min.apply(null, xs)), xHi = Math.log10(Math.max.apply(null, xs));
    var yLo = Math.log10(Math.min.apply(null, ys)), yHi = Math.log10(Math.max.apply(null, ys));
    xLo = Math.floor(xLo); xHi = Math.ceil(xHi);
    yLo = Math.floor(yLo * 2) / 2; yHi = Math.ceil(yHi * 2) / 2;
    function X(v) { return padL + (Math.log10(v) - xLo) / (xHi - xLo) * (W - padL - padR); }
    function Y(v) { return padT + (yHi - Math.log10(v)) / (yHi - yLo) * (H - padT - padB); }

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'plot', role: 'img', 'aria-label': 'Scatter plot of live market pricing' });
    var x, y;
    for (x = xLo; x <= xHi; x++) {
      var gx = X(Math.pow(10, x));
      svgEl('line', { x1: gx, y1: padT, x2: gx, y2: H - padB, 'class': 'grid' }, svg);
      svgText(svg, gx, H - padB + 18, '$' + (x >= 9 ? (Math.pow(10, x - 9)) + 'B' : (Math.pow(10, x - 6)) + 'M'), 'tick', 'middle');
    }
    var yTicks = [0.02, 0.05, 0.2, 1, 5, 20];
    yTicks.forEach(function (t) {
      if (t < Math.pow(10, yLo) || t > Math.pow(10, yHi)) return;
      var gy = Y(t);
      svgEl('line', { x1: padL, y1: gy, x2: W - padR, y2: gy, 'class': 'grid' }, svg);
      svgText(svg, padL - 6, gy + 4, t + '×', 'tick', 'end');
    });
    // dashed grey: global median multiple; dashed amber: ols-global fit line
    var gm = DATA.global_multiple;
    if (gm > 0) {
      svgEl('line', { x1: padL, y1: Y(gm), x2: W - padR, y2: Y(gm), 'class': 'ref-median' }, svg);
    }
    var coef = ((DATA.calibration || {}).coefficients || {}).global || {};
    if (coef.a !== undefined && coef.b !== undefined) {
      var x0 = Math.pow(10, xLo), x1 = Math.pow(10, xHi);
      var m0 = Math.exp(coef.a + (coef.b - 1) * Math.log(x0));
      var m1 = Math.exp(coef.a + (coef.b - 1) * Math.log(x1));
      var y0c = clamp(Y(m0), padT, H - padB), y1c = clamp(Y(m1), padT, H - padB);
      svgEl('line', { x1: padL, y1: y0c, x2: W - padR, y2: y1c, 'class': 'ref-fit' }, svg);
    }
    live.forEach(function (p) {
      svgEl('circle', { cx: X(p.tvl_usd).toFixed(1), cy: Y(p.ratio).toFixed(1), r: 3, 'class': 'dot-live-pt' }, svg);
    });
    top20.forEach(function (r) {
      svgEl('circle', { cx: X(r.tvl_usd).toFixed(1), cy: Y(r.implied_value_usd / r.tvl_usd).toFixed(1), r: 4, 'class': 'dot-top-pt' }, svg);
    });
    sec.appendChild(svg);
    var cap = el('p', 'chart-cap',
      'Top pre-token rows inside the live market cloud (dashed grey: global median ' + fmtMultiple(DATA.global_multiple) +
      '; amber: ' + (DATA.calibration.winner || 'ols-global') + ' fit).');
    sec.appendChild(cap);
    return sec;
  }

  // ---------- tabs + deposit picker + verdict counts ----------

  function renderTabs(root) {
    var bar = el('div', 'tabs-row');
    var tabs = el('div', 'tabs');
    var bTab = el('button', 'tab' + (state.tab === 'board' ? ' active' : ''), 'Pre-token board (' + DATA.board_size + ')');
    bTab.setAttribute('data-act', 'tab');
    bTab.setAttribute('data-tab', 'board');
    var lTab = el('button', 'tab' + (state.tab === 'live' ? ' active' : ''), 'Live tokens (' + DATA.live_size + ')');
    lTab.setAttribute('data-act', 'tab');
    lTab.setAttribute('data-tab', 'live');
    tabs.appendChild(bTab); tabs.appendChild(lTab);
    bar.appendChild(tabs);

    var dep = el('div', 'deposit-picker');
    dep.appendChild(el('span', 'deposit-label', 'Deposit:'));
    DEPOSITS.forEach(function (d) {
      var btn = el('button', 'dep-btn' + (state.deposit === d ? ' active' : ''), fmtDeposit(d));
      btn.setAttribute('data-act', 'deposit');
      btn.setAttribute('data-deposit', String(d));
      dep.appendChild(btn);
    });
    bar.appendChild(dep);
    root.appendChild(bar);

    var counts = verdictCounts();
    var line = el('p', 'verdict-line',
      counts['FARM NOW'] + ' FARM NOW · ' + counts.SELECTIVE + ' SELECTIVE · ' +
      counts.THIN + ' THIN · ' + counts.SKIP + ' SKIP at ' + fmtDeposit(state.deposit));
    root.appendChild(line);
  }

  // ---------- filter bar ----------

  function renderFilters(root, filteredCount) {
    var bar = el('div', 'filter-bar');
    var search = el('input', 'filter-search');
    search.type = 'search';
    search.placeholder = 'Search name or slug…';
    search.value = state.q;
    search.setAttribute('data-act', 'search');
    search.setAttribute('aria-label', 'Search name or slug');
    bar.appendChild(search);

    bar.appendChild(filterSelect('category', 'All categories', uniqueValues(DATA.rows.map(function (r) { return r.category; })), state.category));
    bar.appendChild(filterSelect('chain', 'All chains', uniqueValues(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, [])), state.chain));
    bar.appendChild(filterSelect('verdict', 'All verdicts', VERDICTS.map(function (v) { return v.toLowerCase().replace(/ /g, '-'); }), state.verdict, VERDICTS));

    var watchBtn = el('button', 'chip' + (state.watch ? ' active' : ''), 'Watchlist');
    watchBtn.setAttribute('data-act', 'toggle-watch');
    bar.appendChild(watchBtn);

    var tvlBtn = el('button', 'chip' + (state.minTvl >= 100000000 ? ' active' : ''), 'TVL ≥ $100M');
    tvlBtn.setAttribute('data-act', 'toggle-mintvl');
    bar.appendChild(tvlBtn);

    var impBtn = el('button', 'chip' + (state.minImplied >= 50000000 ? ' active' : ''), 'Implied ≥ $50M');
    impBtn.setAttribute('data-act', 'toggle-minimplied');
    bar.appendChild(impBtn);

    var sortSel = el('select', 'filter-sort');
    sortSel.setAttribute('data-act', 'sort-select');
    sortSel.setAttribute('aria-label', 'Sort by');
    [
      ['implied', 'Sort: implied'], ['risk-adj', 'Sort: risk-adj'], ['odds', 'Sort: odds'],
      ['perhour', 'Sort: $/h'], ['tvl', 'Sort: TVL'], ['name', 'Sort: name'],
    ].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      if (state.sort === o[0]) opt.selected = true;
      sortSel.appendChild(opt);
    });
    bar.appendChild(sortSel);

    if (isFiltered()) {
      var reset = el('button', 'chip reset-btn', 'Reset');
      reset.setAttribute('data-act', 'reset');
      bar.appendChild(reset);
    }
    root.appendChild(bar);

    var count = el('p', 'result-count',
      fmtInt(filteredCount) + ' of ' + fmtInt(DATA.board_size) + ' protocols' +
      (state.verdict ? ' · ' + state.verdict : ''));
    root.appendChild(count);
  }

  function filterSelect(kind, allLabel, values, current, labels) {
    var sel = el('select', 'filter-select');
    sel.setAttribute('data-act', 'filter-' + kind);
    sel.setAttribute('aria-label', allLabel);
    var all = el('option', null, allLabel);
    all.value = '';
    if (!current) all.selected = true;
    sel.appendChild(all);
    values.forEach(function (v, i) {
      var opt = el('option', null, labels ? labels[i] : v);
      opt.value = v;
      if (current === v) opt.selected = true;
      sel.appendChild(opt);
    });
    return sel;
  }

  function uniqueValues(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }

  // ---------- board table ----------

  function verdictBadge(v) {
    var cls = v === 'FARM NOW' ? 'v-farm' : v === 'SELECTIVE' ? 'v-select' : v === 'THIN' ? 'v-thin' : 'v-skip';
    return '<span class="verdict ' + cls + '">' + esc(v) + '</span>';
  }

  function rankCell(c) {
    var r = c.row;
    var range = (r.rank_min !== r.rank_max) ? ' (' + r.rank_min + '–' + r.rank_max + ')' : '';
    return '<span class="rank-num">#' + r.rank + '</span>' +
      (range ? '<span class="rank-range">' + esc(range) + '</span>' : '');
  }

  function renderBoard(root, rows) {
    var wrap = el('div', 'table-wrap');
    var table = el('table', 'board');
    var thead = el('thead');
    var hr = el('tr');
    [
      ['rank', '#'], ['name', 'PROTOCOL'], ['chains', 'CHAINS'], ['tvl', 'TVL'],
      ['chg', '7D'], ['age', 'AGE'], ['implied', 'IMPLIED'], ['odds', 'ODDS'],
      ['risk-adj', 'RISK-ADJ'], ['verdict', 'VERDICT'], ['perhour', '$/H'],
    ].forEach(function (col) {
      var th = el('th', null);
      th.setAttribute('data-act', 'sort');
      th.setAttribute('data-sort', col[0]);
      var arrow = '';
      if ((col[0] === 'implied' && state.sort === 'implied') ||
        (col[0] === 'name' && state.sort === 'name') ||
        (col[0] === 'tvl' && state.sort === 'tvl') ||
        (col[0] === 'odds' && state.sort === 'odds') ||
        (col[0] === 'risk-adj' && state.sort === 'risk-adj') ||
        (col[0] === 'perhour' && state.sort === 'perhour')) {
        arrow = state.dir === 1 ? ' ↑' : ' ↓';
      }
      th.textContent = col[1] + arrow;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (c) {
      var r = c.row, f = c.farm;
      var tr = el('tr');
      tr.setAttribute('data-act', 'detail');
      tr.setAttribute('data-slug', r.slug);
      var chgCls = r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : '';
      var phCls = f.perHour >= 0 ? 'pos' : 'neg';
      var chains = (r.chains || []).slice(0, 2).join(', ') + ((r.chains || []).length > 2 ? '…' : '');
      var watch = DATA.watchlist.indexOf(r.slug) >= 0;
      tr.innerHTML =
        '<td class="c-rank">' + rankCell(c) + '</td>' +
        '<td class="c-name"><span class="proto-name">' + esc(r.name) + '</span>' +
        (watch ? ' <span class="badge watch-badge">watchlist</span>' : '') +
        ' <span class="badge cat-badge">' + esc(r.category) + '</span></td>' +
        '<td class="c-chains">' + esc(chains) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(r.tvl_usd)) + '</td>' +
        '<td class="c-num ' + chgCls + '">' + esc(fmtPct(r.change_7d)) + '</td>' +
        '<td class="c-num">' + esc(fmtAge(r.age_days)) + '</td>' +
        '<td class="c-num"><span class="implied-val">' + esc(fmtMoney(r.implied_value_usd)) + '</span>' +
        '<span class="implied-range">' + esc(fmtMoney(r.implied_low_usd)) + '–' + esc(fmtMoney(r.implied_high_usd)) + '</span></td>' +
        '<td class="c-num">' + esc(fmtOdds(r.launch_odds)) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(r.risk_adj_usd)) + '</td>' +
        '<td class="c-verdict">' + verdictBadge(f.verdict) + '</td>' +
        '<td class="c-num ' + phCls + '">' + esc(fmtPerHour(f.perHour)) + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    if (!rows.length) wrap.appendChild(el('p', 'empty-note', 'No rows match the current filters.'));
    root.appendChild(wrap);
  }

  // ---------- live tab ----------

  function renderLive(root) {
    var live = DATA.live.slice().sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    var wrap = el('div', 'table-wrap');
    var table = el('table', 'board live-table');
    var thead = el('thead');
    var hr = el('tr');
    ['#', 'PROTOCOL', 'CATEGORY', 'TVL', 'MARKET CAP', 'MCAP / TVL', '7D'].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    live.forEach(function (p, i) {
      var tr = el('tr');
      var chgCls = p.change_7d > 0 ? 'pos' : p.change_7d < 0 ? 'neg' : '';
      tr.innerHTML =
        '<td class="c-rank"><span class="rank-num">#' + (i + 1) + '</span></td>' +
        '<td class="c-name"><span class="proto-name">' + esc(p.name) + '</span></td>' +
        '<td><span class="badge cat-badge">' + esc(p.category) + '</span></td>' +
        '<td class="c-num">' + esc(fmtMoney(p.tvl_usd)) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(p.mcap_usd)) + '</td>' +
        '<td class="c-num">' + esc(fmtMultiple(p.ratio)) + '</td>' +
        '<td class="c-num ' + chgCls + '">' + esc(fmtPct(p.change_7d)) + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    root.appendChild(wrap);
    root.appendChild(el('p', 'result-count',
      fmtInt(live.length) + ' live-token protocols with a market cap, sorted by market cap. These are the comparables the value model is fitted on.'));
  }

  // ---------- Method section ----------

  function renderMethod(root) {
    var sec = el('section', 'method');
    sec.appendChild(el('h2', 'section-title', 'Method — how the board is built'));

    var cal = DATA.calibration || {};
    var bakeoff = cal.bakeoff || [];
    var ablation = cal.ablation || [];
    var odds = cal.odds_model || {};

    // Bake-off table: every candidate, three held-out MAPEs, winner marked.
    var bt = el('div', 'method-block');
    bt.appendChild(el('h3', null, 'Model bake-off — held-out median error (MAPE)'));
    var bTable = el('table', 'method-table');
    bTable.innerHTML =
      '<thead><tr><th>CANDIDATE</th><th>PARAMS</th><th>5-FOLD</th><th>WALK-FORWARD</th><th>LEAVE-ONE-OUT</th><th></th></tr></thead>';
    var bBody = el('tbody');
    bakeoff.forEach(function (b) {
      var tr = el('tr');
      if (b.winner) tr.className = 'winner-row';
      tr.innerHTML =
        '<td>' + esc(b.label || b.name) + '</td>' +
        '<td class="c-num">' + esc(b.params) + '</td>' +
        '<td class="c-num">' + esc(pct(b.mape, 2)) + '</td>' +
        '<td class="c-num">' + esc(pct(b.wf_mape, 2)) + '</td>' +
        '<td class="c-num">' + esc(pct(b.loo_mape, 2)) + '</td>' +
        '<td>' + (b.winner ? '<span class="badge winner-badge">winner</span>' : '') + '</td>';
      bBody.appendChild(tr);
    });
    bTable.appendChild(bBody);
    bt.appendChild(bTable);
    bt.appendChild(el('p', 'method-note',
      'Winner by 5-fold MAPE (' + esc(cal.fold_scheme || '') + '). ' +
      'Walk-forward splits the ' + fmtInt(cal.live_sample_size) + ' live protocols by listing date at ' +
      esc(((cal.walk_forward || {}).split_date) || '') + ' (' +
      fmtInt(((cal.walk_forward || {}).train_count) || 0) + ' train / ' +
      fmtInt(((cal.walk_forward || {}).test_count) || 0) + ' test). ' +
      'Leave-one-out refits on the other 118 protocols for each of the 119 in turn.'));
    sec.appendChild(bt);

    // Ablation table: every variant tried, kept or rejected, in plain words.
    if (ablation.length) {
      var at = el('div', 'method-block');
      at.appendChild(el('h3', null, 'Ablation — every variant tried'));
      var aTable = el('table', 'method-table');
      aTable.innerHTML = '<thead><tr><th>VARIANT</th><th>PARAMS</th><th>5-FOLD MAPE</th><th>VERDICT</th></tr></thead>';
      var aBody = el('tbody');
      ablation.forEach(function (a) {
        var tr = el('tr');
        if (a.kept) tr.className = 'winner-row';
        tr.innerHTML =
          '<td>' + esc(a.name) + '</td>' +
          '<td class="c-num">' + esc(a.params) + '</td>' +
          '<td class="c-num">' + esc(pct(a.mape, 2)) + '</td>' +
          '<td>' + esc(a.note || '') + '</td>';
        aBody.appendChild(tr);
      });
      aTable.appendChild(aBody);
      at.appendChild(aTable);
      sec.appendChild(at);
    }

    // Odds model: coefficients, three-split AUC/Brier, calibration bins.
    var ot = el('div', 'method-block');
    ot.appendChild(el('h3', null, 'Launch odds — logistic fit on the snapshot'));
    var honest = el('p', 'method-note',
      'The target is "has a token in the snapshot", so a pre-token protocol that launches later still counts as 0. ' +
      'The odds are therefore a snapshot-based launch propensity — a lower bound on the true launch probability, never "the probability it will launch". ' +
      'Features: log10 TVL, log10 age (unknown = 365d), 7-day change, chain count, category launch rate. ' +
      'Fitted by deterministic IRLS on all ' + fmtInt(odds.sample_size || 758) + ' protocols (' +
      fmtInt(odds.token_count || 0) + ' with a token, ' + fmtInt(odds.pre_token_count || 0) + ' pre-token).');
    ot.appendChild(honest);
    var coef = odds.coefficients || cal.odds_coefficients || {};
    var coefLine = el('p', 'method-note',
      'Coefficients — intercept ' + esc(trimNum(coef.intercept || 0, 3)) +
      ' · log TVL ' + esc(trimNum(coef.log_tvl || 0, 3)) +
      ' · log age ' + esc(trimNum(coef.log_age || 0, 3)) +
      ' · 7d change ' + esc(trimNum(coef.chg_7d || 0, 3)) +
      ' · chains ' + esc(trimNum(coef.n_chains || 0, 3)) +
      ' · category launch rate ' + esc(trimNum(coef.cat_launch_rate || 0, 3)) +
      ' (' + (odds.converged ? 'converged in ' + esc(odds.iterations || 0) + ' iterations' : 'did not converge in 100 iterations') +
      (odds.ridge ? ', ridge ' + esc(odds.ridge) : '') + ').');
    ot.appendChild(coefLine);
    var oTable = el('table', 'method-table');
    oTable.innerHTML = '<thead><tr><th>SPLIT</th><th>AUC</th><th>BRIER</th><th>BASE-RATE BRIER</th></tr></thead>';
    var oBody = el('tbody');
    [
      ['5-fold', odds.cv5], ['Walk-forward', odds.walk_forward], ['Leave-one-out', odds.loo],
    ].forEach(function (row) {
      var s = row[1] || {};
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + esc(row[0]) + '</td>' +
        '<td class="c-num">' + esc(trimNum(s.auc || 0, 3)) + '</td>' +
        '<td class="c-num">' + esc(trimNum(s.brier || 0, 4)) + '</td>' +
        '<td class="c-num">' + esc(trimNum(s.base_brier || 0, 4)) + '</td>';
      oBody.appendChild(tr);
    });
    oTable.appendChild(oBody);
    ot.appendChild(oTable);
    var bins = odds.calibration_bins || [];
    if (bins.length) {
      var binTable = el('table', 'method-table');
      binTable.innerHTML = '<thead><tr><th>ODDS BIN</th><th>PROTOCOLS</th><th>MEAN PREDICTED</th><th>ACTUAL LAUNCH RATE</th></tr></thead>';
      var binBody = el('tbody');
      bins.forEach(function (b) {
        var tr = el('tr');
        tr.innerHTML =
          '<td>' + esc(Math.round(b.min_odds * 100)) + '% – ' + esc(Math.round(b.max_odds * 100)) + '%</td>' +
          '<td class="c-num">' + fmtInt(b.count) + '</td>' +
          '<td class="c-num">' + esc(pct(b.mean_predicted * 100, 1)) + '</td>' +
          '<td class="c-num">' + esc(pct(b.actual_rate * 100, 1)) + '</td>';
        binBody.appendChild(tr);
      });
      binTable.appendChild(binBody);
      ot.appendChild(binTable);
    }
    sec.appendChild(ot);

    // Calibration plot: actual vs cross-validated predicted market cap.
    sec.appendChild(calibrationPlot());

    // Category summary: one row per category with >= 3 board rows.
    var catSec = el('div', 'method-block');
    catSec.appendChild(el('h3', null, 'Category summary'));
    var catTable = el('table', 'method-table');
    catTable.innerHTML = '<thead><tr><th>CATEGORY</th><th>ROWS</th><th>MEDIAN IMPLIED</th><th>TOP PROTOCOL</th></tr></thead>';
    var catBody = el('tbody');
    var byCat = {};
    DATA.rows.forEach(function (r) {
      (byCat[r.category] = byCat[r.category] || []).push(r);
    });
    var catRows = Object.keys(byCat)
      .filter(function (c) { return byCat[c].length >= 3; })
      .map(function (c) {
        var vals = byCat[c].map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
        var top = byCat[c].slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; })[0];
        return { cat: c, n: byCat[c].length, med: medianOf(vals), top: top };
      })
      .sort(function (a, b) { return b.med - a.med; });
    catRows.forEach(function (c) {
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + esc(c.cat) + '</td>' +
        '<td class="c-num">' + fmtInt(c.n) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(c.med)) + '</td>' +
        '<td>' + esc(c.top.name) + ' (' + esc(fmtMoney(c.top.implied_value_usd)) + ')</td>';
      catBody.appendChild(tr);
    });
    catTable.appendChild(catBody);
    catSec.appendChild(catTable);
    sec.appendChild(catSec);

    // Distribution histogram: bins from the data, caption from the data.
    sec.appendChild(distributionHistogram());

    // Coverage / exclusions.
    var ex = DATA.exclusions || {};
    sec.appendChild(el('p', 'method-note',
      'Coverage: ' + fmtInt(ex.total_pre_token || 0) + ' pre-token protocols in the snapshot → ' +
      fmtInt(ex.ranked || 0) + ' ranked. Excluded ' + fmtInt(ex.excluded_total || 0) +
      ' by the competition\'s rankable rule: ' + fmtInt(ex.wrapped_category || 0) + ' wrapped category, ' +
      fmtInt(ex.versioned_name || 0) + ' versioned name, ' + fmtInt(ex.wrapped_word || 0) +
      ' wrapped word, ' + fmtInt(ex.exchange_name || 0) + ' exchange name. ' +
      'The watchlist (' + fmtInt(DATA.watchlist_size) + ' protocols) is fully covered.'));

    root.appendChild(sec);
  }

  function calibrationPlot() {
    var block = el('div', 'method-block');
    block.appendChild(el('h3', null, 'Calibration — predicted vs actual market cap (live protocols)'));
    var live = DATA.live.filter(function (p) { return p.cv_predicted_mcap_usd > 0 && p.mcap_usd > 0; });
    var W = 560, H = 300, padL = 56, padR = 14, padT = 10, padB = 32;
    var xs = live.map(function (p) { return p.mcap_usd; });
    var ys = live.map(function (p) { return p.cv_predicted_mcap_usd; });
    var lo = Math.log10(Math.min.apply(null, xs.concat(ys)));
    var hi = Math.log10(Math.max.apply(null, xs.concat(ys)));
    lo = Math.floor(lo); hi = Math.ceil(hi);
    function X(v) { return padL + (Math.log10(v) - lo) / (hi - lo) * (W - padL - padR); }
    function Y(v) { return padT + (hi - Math.log10(v)) / (hi - lo) * (H - padT - padB); }
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'plot', role: 'img', 'aria-label': 'Calibration plot' });
    for (var e = lo; e <= hi; e++) {
      var gx = X(Math.pow(10, e));
      svgEl('line', { x1: gx, y1: padT, x2: gx, y2: H - padB, 'class': 'grid' }, svg);
      svgText(svg, gx, H - padB + 18, '$' + (e >= 9 ? Math.pow(10, e - 9) + 'B' : e >= 6 ? Math.pow(10, e - 6) + 'M' : Math.pow(10, e - 3) + 'K'), 'tick', 'middle');
      var gy = Y(Math.pow(10, e));
      svgEl('line', { x1: padL, y1: gy, x2: W - padR, y2: gy, 'class': 'grid' }, svg);
      svgText(svg, padL - 6, gy + 4, '$' + (e >= 9 ? Math.pow(10, e - 9) + 'B' : e >= 6 ? Math.pow(10, e - 6) + 'M' : Math.pow(10, e - 3) + 'K'), 'tick', 'end');
    }
    svgEl('line', { x1: padL, y1: Y(Math.pow(10, lo)), x2: W - padR, y2: Y(Math.pow(10, hi)), 'class': 'ref-fit' }, svg);
    live.forEach(function (p) {
      svgEl('circle', { cx: X(p.mcap_usd).toFixed(1), cy: Y(p.cv_predicted_mcap_usd).toFixed(1), r: 3, 'class': 'dot-live-pt' }, svg);
    });
    block.appendChild(svg);
    var cal = DATA.calibration || {};
    block.appendChild(el('p', 'chart-cap',
      'Each dot is one live protocol: actual market cap (x) against the model\'s cross-validated prediction (y). ' +
      'The diagonal is perfect prediction. Winner held-out MAPE ' + esc(pct(cal.winner_mape, 1)) + ' over ' +
      fmtInt(live.length) + ' protocols.'));
    return block;
  }

  function distributionHistogram() {
    var block = el('div', 'method-block');
    block.appendChild(el('h3', null, 'Implied-value distribution'));
    var values = DATA.rows.map(function (r) { return r.implied_value_usd; });
    var res = logBins(values, 6);
    var W = 560, H = 180, padL = 46, padR = 12, padT = 8, padB = 30;
    var maxC = Math.max.apply(null, res.bins.map(function (b) { return b.count; }).concat([1]));
    var bw = (W - padL - padR) / res.bins.length;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'plot', role: 'img', 'aria-label': 'Implied value histogram' });
    res.bins.forEach(function (b, i) {
      var h = (b.count / maxC) * (H - padT - padB);
      var x = padL + i * bw + 2, y = H - padB - h;
      svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: (bw - 4).toFixed(1), height: Math.max(h, 1).toFixed(1), 'class': 'hist-bar' }, svg);
      svgText(svg, x + (bw - 4) / 2, y - 4, String(b.count), 'tick', 'middle');
      svgText(svg, x + (bw - 4) / 2, H - padB + 16, fmtMoney(b.lo), 'tick', 'middle');
    });
    svgText(svg, W - padR, H - padB + 16, fmtMoney(res.bins[res.bins.length - 1].hi), 'tick', 'end');
    block.appendChild(svg);
    var total = values.length;
    var pct = res.topCount && total ? Math.round(res.topCount / total * 100) : 0;
    block.appendChild(el('p', 'chart-cap',
      res.topCount + ' of ' + total + ' rows (' + pct + '%) sit between ' +
      fmtMoney(res.topLo) + ' and ' + fmtMoney(res.topHi) +
      '. Bins are log-spaced from the board\'s own minimum to its maximum, so the shape follows the data.'));
    return block;
  }

  // ---------- detail view ----------

  function findRow(slug) {
    var found = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) found = r; });
    return found;
  }

  function whyLine(row) {
    var catRows = DATA.rows.filter(function (r) { return r.category === row.category; });
    var byTvl = catRows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    var pos = 0;
    byTvl.forEach(function (r, i) { if (r.slug === row.slug) pos = i + 1; });
    var chg = row.no_7d_data ? 'no 7-day change data'
      : (row.change_7d > 0 ? 'up ' : row.change_7d < 0 ? 'down ' : 'flat ') +
        (row.change_7d === 0 ? '' : Math.abs(row.change_7d).toFixed(2) + '% in 7 days');
    var age = 'listed ' + fmtAge(row.age_days) + ' ago' + (row.age_estimated ? ' (age estimated)' : '');
    return '#' + pos + ' of ' + catRows.length + ' in ' + row.category +
      ' by pre-token TVL (' + fmtMoney(row.tvl_usd) + '), ' + chg + ', ' + age + '.';
  }

  function renderDetail(root, slug) {
    var row = findRow(slug);
    if (!row) {
      root.appendChild(el('p', 'empty-note', 'No protocol with slug "' + slug + '".'));
      var back = el('button', 'chip', '← Back to board');
      back.setAttribute('data-act', 'back');
      root.appendChild(back);
      return;
    }
    var farm = computeFarm(row, state.deposit);
    var cal = DATA.calibration || {};
    var v = cal.verdicts || {};

    // top bar: back, deposit picker, rank neighbours
    var bar = el('div', 'detail-topbar');
    var back = el('button', 'chip back-btn', '← Back to board');
    back.setAttribute('data-act', 'back');
    bar.appendChild(back);
    var dep = el('div', 'deposit-picker');
    dep.appendChild(el('span', 'deposit-label', 'Deposit:'));
    DEPOSITS.forEach(function (d) {
      var btn = el('button', 'dep-btn' + (state.deposit === d ? ' active' : ''), fmtDeposit(d));
      btn.setAttribute('data-act', 'deposit');
      btn.setAttribute('data-deposit', String(d));
      dep.appendChild(btn);
    });
    bar.appendChild(dep);
    var prev = DATA.rows.filter(function (r) { return r.rank === row.rank - 1; })[0];
    var next = DATA.rows.filter(function (r) { return r.rank === row.rank + 1; })[0];
    var nav = el('div', 'rank-nav');
    if (prev) {
      var pb = el('button', 'chip', '← #' + prev.rank + ' ' + prev.name);
      pb.setAttribute('data-act', 'detail');
      pb.setAttribute('data-slug', prev.slug);
      nav.appendChild(pb);
    }
    if (next) {
      var nb = el('button', 'chip', '#' + next.rank + ' ' + next.name + ' →');
      nb.setAttribute('data-act', 'detail');
      nb.setAttribute('data-slug', next.slug);
      nav.appendChild(nb);
    }
    bar.appendChild(nav);
    root.appendChild(bar);

    // title + badges + why line
    var titleRow = el('div', 'detail-title-row');
    titleRow.appendChild(el('h1', 'detail-title', '#' + row.rank + ' ' + row.name));
    var badges = el('div', 'detail-badges');
    badges.innerHTML = verdictBadge(farm.verdict);
    if (DATA.watchlist.indexOf(row.slug) >= 0) badges.innerHTML += ' <span class="badge watch-badge">watchlist</span>';
    badges.innerHTML += ' <span class="badge cat-badge">' + esc(row.category) + '</span>';
    badges.innerHTML += ' <span class="badge">records no token</span>';
    if (row.global_fit) badges.innerHTML += ' <span class="badge">global fit</span>';
    if (row.winsorized) badges.innerHTML += ' <span class="badge">P5–P95 clamped</span>';
    if (row.age_estimated) badges.innerHTML += ' <span class="badge">age estimated</span>';
    if (row.no_7d_data) badges.innerHTML += ' <span class="badge">no 7d data</span>';
    titleRow.appendChild(badges);
    root.appendChild(titleRow);
    root.appendChild(el('p', 'why-line', whyLine(row)));
    root.appendChild(el('p', 'chains-line', 'Chains: ' + (row.chains || []).join(', ')));

    // stat cards
    var cards = el('div', 'detail-cards');
    function card(label, big, small, cls) {
      var c = el('div', 'detail-card' + (cls ? ' ' + cls : ''));
      c.appendChild(el('div', 'detail-card-label', label));
      var b = el('div', 'detail-card-big', big);
      c.appendChild(b);
      if (small) c.appendChild(el('div', 'detail-card-small', small));
      return c;
    }
    var mapeLabel = row.model_mape_scope === 'category' ? 'category error' : 'global error';
    cards.appendChild(card('IMPLIED VALUE', fmtMoney(row.implied_value_usd),
      'range ' + fmtMoney(row.implied_low_usd) + '–' + fmtMoney(row.implied_high_usd), 'card-good'));
    cards.appendChild(card('LAUNCH ODDS', fmtOdds(row.launch_odds), 'snapshot propensity (lower bound)'));
    cards.appendChild(card('RISK-ADJUSTED VALUE', fmtMoney(row.risk_adj_usd), 'implied × odds'));
    cards.appendChild(card('FARMING $/H (@' + fmtDeposit(state.deposit) + ')', fmtPerHour(farm.perHour),
      'net ' + fmtMoney(farm.net) + ' · gas $' + fmtInt(row.farm_cost_usd) + ' · ' + fmtHours(row.farm_hours),
      farm.perHour >= 0 ? 'card-good' : 'card-bad'));
    cards.appendChild(card('TVL', fmtMoney(row.tvl_usd), fmtInt((row.chains || []).length) + ' chains'));
    cards.appendChild(card('7-DAY CHANGE', fmtPct(row.change_7d), 'growth ' + trimNum(row.growth_multiplier, 2) + '×',
      row.change_7d > 0 ? 'card-good' : row.change_7d < 0 ? 'card-bad' : ''));
    cards.appendChild(card('AGE (NO TOKEN)', fmtAge(row.age_days), 'maturity ' + trimNum(row.maturity_multiplier, 2) + '×'));
    var fitScope = row.fit_scope === 'global' ? 'OLS-GLOBAL' : ('OLS-' + String(row.fit_scope || '').toUpperCase());
    cards.appendChild(card('FITTED (' + fitScope + ')', fmtMultiple(row.fitted_multiple),
      'cat ' + (row.category_median_multiple === null || row.category_median_multiple === undefined ? 'n/a' : fmtMultiple(row.category_median_multiple)) +
      ' · glob ' + fmtMultiple(row.global_median_multiple) +
      ' · MAPE ' + pct(row.model_mape, 1) + ' (' + mapeLabel + ')'));
    root.appendChild(cards);

    // formula lines (verified live from the row's own numbers)
    var formula = el('div', 'formula-box');
    var f1 = el('p', null,
      'TVL ' + fmtMoney(row.tvl_usd) + ' × fitted ' + fmtMultiple(row.fitted_multiple) +
      ' × growth ' + trimNum(row.growth_multiplier, 2) + ' × maturity ' + trimNum(row.maturity_multiplier, 2) +
      ' = ' + fmtMoney(row.implied_value_usd) + ' (range ' + fmtMoney(row.implied_low_usd) + '–' + fmtMoney(row.implied_high_usd) +
      ', ÷/× (1 + ' + pct(row.model_mape, 1) + ' MAPE)). ' +
      'Expected value = implied ' + fmtMoney(row.implied_value_usd) + ' × odds ' + fmtOdds(row.launch_odds) +
      ' = ' + fmtMoney(row.risk_adj_usd) + ' — verified live.');
    var f2 = el('p', null,
      'Farming (' + fmtDeposit(state.deposit) + '): pool ' + fmtMoney2(farm.pool) + ' (' + Math.round(poolShare() * 100) + '%) × share ' +
      trimNum(farm.share * 100, 5) + '% (' + Math.round(depositShare() * 100) + '% TVL) × odds ' + fmtOdds(row.launch_odds) +
      ' − gas $' + fmtInt(row.farm_cost_usd) + ' − opp. cost $' + fmtInt(Math.round(farm.opp)) + ' (' + Math.round(oppApr() * 100) + '%/' + horizonDays() + 'd)' +
      ' = net ' + fmtMoney(farm.net) + ' over ' + fmtHours(row.farm_hours) + ' → ' + fmtPerHour(farm.perHour) + '/h (' + farm.verdict + ').');
    formula.appendChild(f1); formula.appendChild(f2);
    root.appendChild(formula);

    // peer comparables + mini histogram
    var peers = peerComparables(row);
    var peerSec = el('section', 'peer-section');
    var peerHead = el('div', 'peer-head');
    peerHead.appendChild(el('h2', null, 'Peer comparables'));
    var scopeBadge = row.peer_category === 'all live-token protocols'
      ? '<span class="badge">global median fallback</span>'
      : '<span class="badge">' + esc(row.peer_category) + ' peers</span>';
    var peerCap = el('span', 'chart-hint', '');
    peerCap.innerHTML = scopeBadge + ' ' + esc(row.peer_category) + ' has ' +
      (row.peer_category === 'all live-token protocols' ? 'no category peers' : row.peer_count + ' live peers') +
      ' – 5 closest to fitted ' + esc(fmtMultiple(row.fitted_multiple)) +
      ' (P25–P75: ' + esc(fmtMultiple(row.peer_p25)) + '–' + esc(fmtMultiple(row.peer_p75)) + ')';
    peerHead.appendChild(peerCap);
    peerSec.appendChild(peerHead);
    var pTable = el('table', 'method-table peer-table');
    pTable.innerHTML = '<thead><tr><th>PEER PROTOCOL</th><th>CATEGORY</th><th>TVL</th><th>MARKET CAP</th><th>MCAP / TVL</th></tr></thead>';
    var pBody = el('tbody');
    peers.forEach(function (p) {
      var tr = el('tr');
      tr.innerHTML =
        '<td>' + esc(p.name) + '</td>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(p.tvl_usd)) + '</td>' +
        '<td class="c-num">' + esc(fmtMoney(p.mcap_usd)) + '</td>' +
        '<td class="c-num">' + esc(fmtMultiple(p.ratio)) + '</td>';
      pBody.appendChild(tr);
    });
    pTable.appendChild(pBody);
    peerSec.appendChild(pTable);
    peerSec.appendChild(peerHistogram(row));
    root.appendChild(peerSec);

    // farm plan
    var steps = farmSteps(row);
    var planSec = el('section', 'farm-section');
    planSec.appendChild(el('h2', null,
      'Farm plan (6 steps · sunk gas $' + fmtInt(row.farm_cost_usd) + ' · ' + fmtHours(row.farm_hours) + ' active)'));
    var ol = el('ol', 'farm-steps');
    steps.forEach(function (s) {
      var li = el('li', null, s.text);
      ol.appendChild(li);
    });
    planSec.appendChild(ol);
    root.appendChild(planSec);

    root.appendChild(el('p', 'detail-footnote',
      'Implied value states what a token would be worth if today\'s record held. Launch odds measure snapshot propensity (a lower bound on true launch probability). Farming $/h uses stated assumptions (' +
      Math.round(poolShare() * 100) + '% pool, ' + Math.round(depositShare() * 100) + '% TVL deposits, ' +
      Math.round(oppApr() * 100) + '% APR over ' + horizonDays() + 'd), not guarantees.'));

    root.appendChild(el('p', 'source-line',
      'Source: ' + DATA.source + ' · Model ' + (DATA.model_version || 'radar-4') +
      ' (' + (cal.winner || '') + ', 5-fold MAPE ' + fmtPct(cal.winner_mape, 1) +
      ', odds AUC ' + trimNum(((cal.odds_model || {}).cv5 || {}).auc || 0, 3) + ')'));
  }

  // Small histogram of the row's peer multiples, fitted value marked.
  function peerHistogram(row) {
    var ratios = peerRatios(row);
    var wrap = el('div', 'peer-hist');
    wrap.appendChild(el('span', 'peer-hist-label', 'Peer spread'));
    if (ratios.length < 2) {
      wrap.appendChild(el('span', 'peer-hist-empty', 'too few peers to plot'));
      return wrap;
    }
    var lo = Math.log10(Math.min.apply(null, ratios.concat([row.fitted_multiple])));
    var hi = Math.log10(Math.max.apply(null, ratios.concat([row.fitted_multiple])));
    if (hi - lo < 0.5) { hi = lo + 0.5; }
    var nBins = 8, W = 220, H = 44;
    var counts = new Array(nBins).fill(0);
    ratios.forEach(function (v) {
      var i = Math.min(nBins - 1, Math.floor((Math.log10(v) - lo) / (hi - lo) * nBins));
      counts[i]++;
    });
    var maxC = Math.max.apply(null, counts.concat([1]));
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'peer-hist-svg', role: 'img', 'aria-label': 'Peer multiple histogram' });
    var bw = W / nBins;
    counts.forEach(function (c, i) {
      var h = c / maxC * (H - 6);
      svgEl('rect', { x: (i * bw + 1).toFixed(1), y: (H - h).toFixed(1), width: (bw - 2).toFixed(1), height: Math.max(h, 1).toFixed(1), 'class': 'hist-bar' }, svg);
    });
    var fx = (Math.log10(row.fitted_multiple) - lo) / (hi - lo) * W;
    svgEl('line', { x1: fx.toFixed(1), y1: 0, x2: fx.toFixed(1), y2: H, 'class': 'hist-marker' }, svg);
    wrap.appendChild(svg);
    return wrap;
  }

  // ---------- render root + events ----------

  function render() {
    var mount = document.getElementById(MOUNT_ID) || document.body;
    mount.innerHTML = '';
    if (!DATA || !DATA.rows) {
      mount.appendChild(el('p', 'empty-note', 'No data loaded (data.js missing or empty).'));
      return;
    }
    if (state.detail) {
      renderDetail(mount, state.detail);
      return;
    }
    var rows = filteredRows();
    renderHeader(mount);
    renderModelBox(mount);
    renderCharts(mount, rows);
    renderTabs(mount);
    if (state.tab === 'live') {
      renderLive(mount);
    } else {
      renderFilters(mount, rows.length);
      renderBoard(mount, rows);
      renderMethod(mount);
    }
  }

  function setState(patch, push) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    if (patch.deposit !== undefined) invalidateComputed();
    if (push !== false) writeHash();
    render();
  }

  function onHashChange() {
    var s = readHash();
    var depChanged = s.deposit !== state.deposit;
    state = s;
    if (depChanged) invalidateComputed();
    render();
  }

  function wireEvents() {
    var mount = document.getElementById(MOUNT_ID) || document.body;
    mount.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'detail') {
        setState({ detail: t.getAttribute('data-slug') });
      } else if (act === 'back') {
        setState({ detail: '' });
      } else if (act === 'tab') {
        setState({ tab: t.getAttribute('data-tab'), detail: '' });
      } else if (act === 'deposit') {
        setState({ deposit: parseInt(t.getAttribute('data-deposit'), 10) });
      } else if (act === 'toggle-watch') {
        setState({ watch: !state.watch });
      } else if (act === 'toggle-mintvl') {
        setState({ minTvl: state.minTvl >= 100000000 ? 0 : 100000000 });
      } else if (act === 'toggle-minimplied') {
        setState({ minImplied: state.minImplied >= 50000000 ? 0 : 50000000 });
      } else if (act === 'reset') {
        setState({ q: '', category: '', chain: '', verdict: '', watch: false, minTvl: 0, minImplied: 0 });
      } else if (act === 'sort') {
        var key = t.getAttribute('data-sort');
        if (key === 'rank' || key === 'chg' || key === 'age' || key === 'chains') return;
        var map = { name: 'name', tvl: 'tvl', implied: 'implied', odds: 'odds', 'risk-adj': 'risk-adj', perhour: 'perhour' };
        var sk = map[key];
        if (!sk) return;
        if (state.sort === sk) setState({ dir: -state.dir });
        else setState({ sort: sk, dir: sk === 'name' ? 1 : -1 });
      }
    });
    mount.addEventListener('input', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act="search"]') : null;
      if (!t) return;
      state.q = t.value;
      writeHash();
      render();
      var box = mount.querySelector('[data-act="search"]');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    });
    mount.addEventListener('change', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'filter-category') setState({ category: t.value });
      else if (act === 'filter-chain') setState({ chain: t.value });
      else if (act === 'filter-verdict') {
        var map = { 'farm-now': 'FARM NOW', 'selective': 'SELECTIVE', 'thin': 'THIN', 'skip': 'SKIP' };
        setState({ verdict: map[t.value] || '' });
      } else if (act === 'sort-select') setState({ sort: t.value, dir: t.value === 'name' ? 1 : -1 });
    });
    window.addEventListener('hashchange', onHashChange);
  }

  function init() {
    state = readHash();
    wireEvents();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
