// Token Radar dashboard (v2 presentation).
// Reads window.RADAR — the dataset main.ts writes beside dashboard/ — and renders
// the ranked board with a Top-10 bar chart, a filterable table, a standalone
// detail view with an auditable peer table, and a 6-step farm plan per protocol.
// Everything runs offline: no fetch, no fonts, no images, no external requests.
(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR) return;
  var mount = document.getElementById('board');

  // ---------- view state ----------
  var view = {
    query: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre',
    sortKey: 'implied',
    sortDir: -1,
    openSlug: null
  };

  var watchlist = {};
  (RADAR.watchlist || []).forEach(function (slug) { watchlist[slug] = true; });

  // ---------- small formatters ----------
  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- tiny DOM builder ----------
  // h('div', {class: 'x', onclick: fn}, child, child, ...)
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), val);
        else if (val !== null && val !== undefined) node.setAttribute(key, val);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- radar-2 recompute (mirrors lib/model.ts exactly) ----------
  function recompute(row) {
    var m = RADAR.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d == null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days == null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor +
      (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity));
  }

  // ---------- farm plan (mirrors lib/model.ts: same categories, capital, hold) ----------
  function firstChain(p) { return (p.chains && p.chains.length > 0) ? p.chains[0] : 'its main chain'; }
  function stakeSize(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(p, amount, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + amount + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + amount + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + amount + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + amount + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + amount + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + amount + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + amount + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + amount + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + amount + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + amount + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + amount + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function followAction(p, amount, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the supply on ' + name + ' and repay it the same week, so the address shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap a small amount through ' + name + "'s router on " + chain + ' each week, so the address is a trader as well as a liquidity provider.';
    if (c.indexOf('bridge') >= 0) return 'Use the bridged funds for one swap or deposit in an app on ' + chain + ' within the same week, so the bridge is not the only trace.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake or delegate the receipt token once, and vote in one governance proposal if ' + name + ' opens one.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge and open a second small one the following week, keeping the margin deposit in place throughout.';
    if (c.indexOf('prediction') >= 0) return 'Settle one market and open a second one the following week, keeping the account funded between them.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Add a second, smaller deposit to a different ' + name + ' vault on ' + chain + ' the following week.';
    if (c.indexOf('stable') >= 0) return 'Use the minted stable asset in one payment or deposit on ' + chain + ' each week, then return it to the protocol.';
    if (c.indexOf('rwa') >= 0) return 'Claim the yield the asset earns once a month and leave the principal in place.';
    if (c.indexOf('insurance') >= 0) return 'Renew the cover once before it lapses, so the policy runs without a gap.';
    return 'Make one more deposit, swap or vote on ' + name + ' each week, a different action from the first.';
  }
  function farmPlan(p) {
    var chain = firstChain(p);
    var amount = stakeSize(p);
    var hold = holdDays(p.age_days);
    var gas = amount >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, amount, chain), cost: '$' + amount + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: followAction(p, amount, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + amount + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // ---------- peer comparables, strictly from RADAR.live ----------
  function livePeers() {
    return (RADAR.live || [])
      .filter(function (p) {
        return p.mcap_usd !== null && p.mcap_usd !== undefined && p.mcap_usd > 0 &&
          p.tvl_usd > 0 && isFinite(p.mcap_usd / p.tvl_usd);
      })
      .map(function (p) {
        return {
          name: p.name,
          category: p.category || 'Uncategorised',
          tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd,
          ratio: p.mcap_usd / p.tvl_usd
        };
      });
  }
  function comparablesFor(row) {
    var all = livePeers();
    var target = row.peer_multiple;
    var global = row.peer_category === 'all live-token protocols';
    var byDistance = function (a, b) {
      return Math.abs(a.ratio - target) - Math.abs(b.ratio - target) || b.mcap_usd - a.mcap_usd;
    };
    var byRatio = function (a, b) { return a.ratio - b.ratio || b.mcap_usd - a.mcap_usd; };

    if (!global) {
      var sameCat = all.filter(function (p) { return p.category === row.peer_category; }).sort(byDistance);
      if (sameCat.length > 0) {
        var picked = sameCat.slice(0, 5).sort(byRatio);
        return {
          rows: picked,
          tag: row.peer_category + ' peers',
          tagClass: 'pill pill-accent',
          note: 'Category median ' + target.toFixed(3) + '\u00d7 across ' + row.peer_count + ' snapshot peers' +
            (picked.length < row.peer_count ? ' \u00b7 showing ' + picked.length + ' in live table' : '')
        };
      }
      var near = all.slice().sort(byDistance).slice(0, 5).sort(byRatio);
      return {
        rows: near,
        tag: row.peer_category + ' median',
        tagClass: 'pill pill-accent',
        note: 'Category median ' + target.toFixed(3) + '\u00d7 (' + row.peer_count + ' snapshot peers; none in top-' +
          (RADAR.live ? RADAR.live.length : 0) + ' live sample) \u00b7 showing 5 closest live comparables'
      };
    }
    var closest = all.slice().sort(byDistance).slice(0, 5).sort(byRatio);
    var minPeers = (RADAR.model && RADAR.model.peer_min_count) || 3;
    return {
      rows: closest,
      tag: 'global median fallback',
      tagClass: 'pill pill-watch',
      note: (row.category || 'Uncategorised') + ' has <' + minPeers + ' live peers \u00b7 5 live peers closest to global median ' +
        target.toFixed(3) + '\u00d7 (' + row.peer_count + ' snapshot peers)'
    };
  }

  // ---------- filtering & sorting ----------
  function distinctCategories() {
    var seen = {};
    RADAR.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function distinctChains() {
    var seen = {};
    RADAR.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function filteringActive() {
    return view.query.trim() !== '' || view.category !== 'all' || view.chain !== 'all' || view.watchlistOnly;
  }
  function visibleRows() {
    var q = view.query.trim().toLowerCase();
    var rows = RADAR.rows.filter(function (r) {
      if (view.watchlistOnly && !watchlist[r.slug]) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) === -1) return false;
      if (q && (r.name || '').toLowerCase().indexOf(q) === -1 && (r.slug || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = view.sortKey;
    var dir = view.sortDir;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = b.rank - a.rank;
      else if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'growth') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else if (key === 'name') d = (a.name || '').localeCompare(b.name || '');
      return d * dir || (a.rank - b.rank);
    });
    return rows;
  }

  // ---------- Top-10 bar chart (pure HTML/CSS, linear scale) ----------
  function topChart(rows) {
    var top = rows.slice().sort(function (a, b) {
      return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank;
    }).slice(0, 10);
    if (top.length === 0) return null;
    var maxVal = top[0].implied_value_usd || 1;
    var card = h('section', { 'class': 'chart-card', 'aria-label': 'Top protocols by implied value' });
    var head = h('div', { 'class': 'chart-head' });
    head.appendChild(h('h2', {
      text: filteringActive()
        ? 'Top ' + top.length + ' matching protocols by implied value'
        : 'Top ' + top.length + ' pre-token protocols by implied value'
    }));
    head.appendChild(h('span', { 'class': 'chart-note', text: 'Linear scale \u00b7 Click any bar for detail' }));
    card.appendChild(head);
    var list = h('div', { 'class': 'bars' });
    top.forEach(function (r, i) {
      var width = Math.max(3, (r.implied_value_usd / maxVal) * 100);
      var bar = h('button', {
        type: 'button',
        'class': 'bar-row',
        title: '#' + r.rank + ' ' + r.name + ' \u2014 ' + money(r.implied_value_usd) + ' implied value',
        onclick: function () { openDetail(r.slug); }
      });
      bar.appendChild(h('span', { 'class': 'bar-rank', text: '#' + r.rank }));
      bar.appendChild(h('span', { 'class': 'bar-name', text: r.name }));
      var track = h('span', { 'class': 'bar-track' });
      var fill = h('span', { 'class': 'bar-fill' });
      fill.style.width = width.toFixed(2) + '%';
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(h('span', { 'class': 'bar-value', text: money(r.implied_value_usd) }));
      list.appendChild(bar);
    });
    card.appendChild(list);
    return card;
  }

  // ---------- board table ----------
  function boardRow(r) {
    var tr = h('tr', {
      'class': view.openSlug === r.slug ? 'sel' : '',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    });
    tr.appendChild(h('td', { 'class': 'rank', text: '#' + r.rank }));
    var name = h('td', { 'class': 'name' });
    name.appendChild(h('b', { text: r.name, title: r.name }));
    var pills = h('small');
    if (watchlist[r.slug]) pills.appendChild(h('span', { 'class': 'pill pill-watch', text: 'watchlist' }));
    pills.appendChild(h('span', { 'class': 'pill', text: r.category || 'Uncategorised' }));
    name.appendChild(pills);
    tr.appendChild(name);
    tr.appendChild(h('td', { text: (r.chains || []).slice(0, 2).join(', ') || '\u2014', title: (r.chains || []).join(', ') }));
    tr.appendChild(h('td', { 'class': 'num', text: money(r.tvl_usd) }));
    tr.appendChild(h('td', { 'class': 'num ' + ((r.change_7d || 0) >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }));
    tr.appendChild(h('td', { 'class': 'num', text: ageLabel(r.age_days) }));
    tr.appendChild(h('td', { 'class': 'num implied-col', text: money(r.implied_value_usd) }));
    return tr;
  }

  // ---------- standalone detail view (board hidden while open) ----------
  function detailFragment(r) {
    var frag = document.createDocumentFragment();

    var bar = h('div', { 'class': 'detail-bar' });
    bar.appendChild(h('button', {
      type: 'button',
      'class': 'back-link',
      text: '\u2190 Back to board',
      onclick: function () { closeDetail(); }
    }));
    bar.appendChild(h('span', {
      'class': 'crumb',
      text: 'Token Radar \u00b7 model ' + RADAR.model_version + ' \u00b7 snapshot ' + RADAR.as_of
    }));
    frag.appendChild(bar);

    var card = h('section', { 'class': 'detail-card', 'aria-label': 'Protocol detail' });
    var title = h('div', { 'class': 'detail-title' });
    title.appendChild(h('h2', { text: '#' + r.rank + ' ' + r.name }));
    var badges = h('div', { 'class': 'badges' });
    if (watchlist[r.slug]) badges.appendChild(h('span', { 'class': 'pill pill-watch', text: 'watchlist' }));
    badges.appendChild(h('span', { 'class': 'pill', text: r.category || 'Uncategorised' }));
    badges.appendChild(h('span', { 'class': 'pill pill-accent', text: 'records no token' }));
    title.appendChild(badges);
    card.appendChild(title);
    card.appendChild(h('p', {
      'class': 'chains-line',
      text: 'Chains: ' + ((r.chains && r.chains.length > 0) ? r.chains.join(', ') : '\u2014')
    }));

    // six metric cards, 3 across x 2 down
    var grid = h('div', { 'class': 'metrics' });
    var peerNote = (r.peer_category === 'all live-token protocols' ? 'global median, ' : r.peer_category + ' median, ') +
      r.peer_count + ' peers';
    var metrics = [
      { label: 'Implied value', value: money(r.implied_value_usd), primary: true },
      { label: 'TVL', value: money(r.tvl_usd) },
      { label: '7-day change', value: pct(r.change_7d), tone: (r.change_7d || 0) >= 0 ? 'up' : 'down' },
      { label: 'Age (no token)', value: ageLabel(r.age_days) },
      { label: 'Peer multiple', value: r.peer_multiple.toFixed(3) + '\u00d7', sub: peerNote },
      { label: 'Growth \u00d7 maturity', value: r.growth_multiplier.toFixed(2) + ' \u00d7 ' + r.maturity_multiplier.toFixed(2) }
    ];
    metrics.forEach(function (m) {
      var cell = h('div', { 'class': 'metric' + (m.primary ? ' metric-primary' : '') });
      cell.appendChild(h('span', { 'class': 'metric-label', text: m.label }));
      cell.appendChild(h('b', { 'class': 'metric-value ' + (m.tone || ''), text: m.value }));
      if (m.sub) cell.appendChild(h('small', { 'class': 'metric-sub', text: m.sub }));
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    // arithmetic check: the page recomputes the board's number
    var check = recompute(r);
    var formula = h('p', { 'class': 'formula' });
    formula.innerHTML =
      'TVL ' + esc(money(r.tvl_usd)) +
      ' \u00d7 peer multiple <code>' + r.peer_multiple.toFixed(3) + '</code>' +
      ' \u00d7 growth <code>' + r.growth_multiplier.toFixed(2) + '</code>' +
      ' \u00d7 maturity <code>' + r.maturity_multiplier.toFixed(2) + '</code>' +
      ' = <code>' + esc(money(check)) + '</code>' +
      (check === r.implied_value_usd
        ? ' \u2014 the page recomputes the board\u2019s number exactly.'
        : ' \u2014 the page\u2019s recomputation differs; the board\u2019s number governs.');
    card.appendChild(formula);

    // peer comparables, from RADAR.live only
    var peers = comparablesFor(r);
    if (peers.rows.length > 0) {
      var sec = h('div', { 'class': 'peers' });
      var head = h('div', { 'class': 'peers-head' });
      var h3 = h('h3');
      h3.appendChild(document.createTextNode('Peer comparables '));
      h3.appendChild(h('span', { 'class': peers.tagClass, text: peers.tag }));
      head.appendChild(h3);
      head.appendChild(h('p', { 'class': 'peers-note', text: peers.note }));
      sec.appendChild(head);
      var shell = h('div', { 'class': 'table-wrap' });
      var table = h('table', { 'class': 'peer-grid' });
      var thead = h('thead');
      var hr = h('tr');
      ['Peer protocol', 'Category', 'TVL', 'Market cap', 'Mcap / TVL'].forEach(function (txt, i) {
        hr.appendChild(h('th', { 'class': i >= 2 ? 'num' : '', text: txt }));
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = h('tbody');
      peers.rows.forEach(function (p) {
        var pr = h('tr');
        pr.appendChild(h('td', { html: '<b>' + esc(p.name) + '</b>' }));
        pr.appendChild(h('td', { text: p.category }));
        pr.appendChild(h('td', { 'class': 'num', text: money(p.tvl_usd) }));
        pr.appendChild(h('td', { 'class': 'num', text: money(p.mcap_usd) }));
        pr.appendChild(h('td', { 'class': 'num ratio', text: p.ratio.toFixed(3) + '\u00d7' }));
        tbody.appendChild(pr);
      });
      table.appendChild(tbody);
      shell.appendChild(table);
      sec.appendChild(shell);
      card.appendChild(sec);
    }

    // six-step farm plan
    card.appendChild(h('h3', { 'class': 'farm-title', text: 'Farm plan (6 steps)' }));
    var ol = h('ol', { 'class': 'farm-list' });
    farmPlan(r).forEach(function (s) {
      var li = h('li');
      li.appendChild(document.createTextNode(s.text + ' '));
      li.appendChild(h('span', { 'class': 'farm-meta', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      ol.appendChild(li);
    });
    card.appendChild(ol);
    card.appendChild(h('p', {
      'class': 'disclaimer',
      text: 'This board states what a token would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued. A protocol that records no token may still have one its DefiLlama record does not carry.'
    }));
    frag.appendChild(card);
    return frag;
  }

  // ---------- live-token comparison table ----------
  function liveTable() {
    var shell = h('div', { 'class': 'table-wrap' });
    var table = h('table', { 'class': 'board board--live' });
    var thead = h('thead');
    var hr = h('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d'].forEach(function (txt, i) {
      hr.appendChild(h('th', { 'class': i >= 3 ? 'num' : '', text: txt }));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = h('tbody');
    RADAR.live.forEach(function (p) {
      var tr = h('tr');
      tr.appendChild(h('td', { 'class': 'name', html: '<b>' + esc(p.name) + '</b>' }));
      tr.appendChild(h('td', { text: p.category || '\u2014' }));
      tr.appendChild(h('td', { text: (p.chains || []).slice(0, 2).join(', ') || '\u2014', title: (p.chains || []).join(', ') }));
      tr.appendChild(h('td', { 'class': 'num', text: money(p.tvl_usd) }));
      tr.appendChild(h('td', { 'class': 'num', text: money(p.mcap_usd) }));
      tr.appendChild(h('td', { 'class': 'num ' + ((p.change_7d || 0) >= 0 ? 'up' : 'down'), text: pct(p.change_7d) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    shell.appendChild(table);
    return shell;
  }

  // ---------- navigation ----------
  function openDetail(slug) {
    view.openSlug = slug;
    render();
    window.scrollTo(0, 0);
  }
  function closeDetail() {
    view.openSlug = null;
    if (location.hash && location.hash.indexOf('detail=') >= 0) location.hash = '';
    render();
    window.scrollTo(0, 0);
  }
  function readHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    var parts = {};
    raw.split('&').forEach(function (pair) {
      var eq = pair.indexOf('=');
      if (eq > 0) parts[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1));
    });
    view.tab = parts.tab === 'live' ? 'live' : 'pre';
    view.openSlug = parts.detail || null;
    view.category = parts.category || 'all';
    view.chain = parts.chain || 'all';
    view.watchlistOnly = parts.watch === '1' || parts.watch === 'true';
    view.query = parts.q || '';
    if (parts.sort) view.sortKey = parts.sort;
  }

  // ---------- render ----------
  function render() {
    mount.setAttribute('aria-busy', 'false');
    mount.innerHTML = '';
    var wrap = h('div', { 'class': 'wrap' });

    // detail open: board, chart and filters are hidden entirely
    var selected = null;
    if (view.tab === 'pre' && view.openSlug) {
      selected = RADAR.rows.filter(function (r) { return r.slug === view.openSlug; })[0] || null;
    }
    if (selected) {
      wrap.appendChild(detailFragment(selected));
      wrap.appendChild(h('footer', {
        'class': 'page-foot',
        text: 'Source: ' + RADAR.source + ' \u00b7 Floor $' + RADAR.floor_usd.toLocaleString('en-US') + ' \u00b7 Model ' + RADAR.model_version
      }));
      mount.appendChild(wrap);
      return;
    }

    // board header
    var hero = h('header', { 'class': 'hero' });
    var copy = h('div', { 'class': 'hero-text' });
    copy.appendChild(h('p', { 'class': 'eyebrow', text: 'Token Radar \u00b7 snapshot ' + RADAR.as_of }));
    copy.appendChild(h('h1', { text: 'Pre-token protocols, ranked by implied value' }));
    copy.appendChild(h('p', {
      'class': 'lede',
      text: 'Every protocol below records no token. Implied value reflects today\u2019s TVL at live peer multiples \u2014 not a launch forecast. Click any bar or row for full valuation audit and 6-step farm plan.'
    }));
    hero.appendChild(copy);
    var stats = h('p', { 'class': 'stat-row' });
    [['Watchlist', RADAR.watchlist_size], ['Board rows', RADAR.board_size], ['Early finds', RADAR.early_size], ['Live tokens', RADAR.live_size]]
      .forEach(function (s) {
        var st = h('span', { 'class': 'stat' });
        st.appendChild(h('b', { text: String(s[1]) }));
        st.appendChild(h('span', { text: s[0] }));
        stats.appendChild(st);
      });
    hero.appendChild(stats);
    wrap.appendChild(hero);

    var method = h('section', { 'class': 'method-box' });
    method.appendChild(h('p', {
      html: '<strong>Model ' + esc(RADAR.model_version) + ':</strong> Implied value = TVL \u00d7 <code>peer multiple</code> (category median with \u22653 live peers, else global <code>' +
        RADAR.global_multiple.toFixed(3) + '\u00d7</code>) \u00d7 growth (7d TVL change clamped \u221260%\u2026+120%, half weight) \u00d7 maturity (0.6\u21921.0 over 3y). No name special-cased.'
    }));
    wrap.appendChild(method);

    if (view.tab === 'pre') wrap.appendChild(h('div', { id: 'chart-slot' }));

    var toolbar = h('div', { 'class': 'toolbar' });
    var tabs = h('div', { role: 'tablist' });
    tabs.appendChild(h('button', {
      type: 'button',
      'class': 'tab-btn',
      role: 'tab',
      'aria-selected': view.tab === 'pre' ? 'true' : 'false',
      text: 'Pre-token board',
      onclick: function () { view.tab = 'pre'; view.openSlug = null; render(); }
    }));
    tabs.appendChild(h('button', {
      type: 'button',
      'class': 'tab-btn',
      role: 'tab',
      'aria-selected': view.tab === 'live' ? 'true' : 'false',
      text: 'Live tokens (' + RADAR.live_size + ')',
      onclick: function () { view.tab = 'live'; view.openSlug = null; render(); }
    }));
    toolbar.appendChild(tabs);
    toolbar.appendChild(h('p', { 'class': 'row-count', id: 'row-count' }));
    wrap.appendChild(toolbar);

    if (view.tab === 'live') {
      wrap.appendChild(liveTable());
      var liveCount = wrap.querySelector('#row-count');
      if (liveCount) liveCount.textContent = RADAR.live.length + ' live-token comparables (by market cap)';
    } else {
      var filters = h('div', { 'class': 'filters' });
      var q = h('input', {
        type: 'search',
        placeholder: 'Search name or slug\u2026',
        value: view.query,
        'aria-label': 'Search protocols'
      });
      q.addEventListener('input', function () { view.query = q.value; refreshPre(); });
      filters.appendChild(q);

      var cat = h('select', { 'aria-label': 'Filter by category' });
      cat.appendChild(h('option', { value: 'all', text: 'All categories' }));
      distinctCategories().forEach(function (c) { cat.appendChild(h('option', { value: c, text: c })); });
      cat.value = view.category;
      cat.addEventListener('change', function () { view.category = cat.value; refreshPre(); });
      filters.appendChild(cat);

      var ch = h('select', { 'aria-label': 'Filter by chain' });
      ch.appendChild(h('option', { value: 'all', text: 'All chains' }));
      distinctChains().forEach(function (c) { ch.appendChild(h('option', { value: c, text: c })); });
      ch.value = view.chain;
      ch.addEventListener('change', function () { view.chain = ch.value; refreshPre(); });
      filters.appendChild(ch);

      var watchBtn = h('button', {
        type: 'button',
        'class': 'watch-toggle',
        'aria-pressed': view.watchlistOnly ? 'true' : 'false',
        text: 'Watchlist only',
        onclick: function () {
          view.watchlistOnly = !view.watchlistOnly;
          watchBtn.setAttribute('aria-pressed', view.watchlistOnly ? 'true' : 'false');
          refreshPre();
        }
      });
      filters.appendChild(watchBtn);

      var sort = h('select', { 'aria-label': 'Sort by' });
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day change'], ['age', 'Sort: age'], ['name', 'Sort: name']]
        .forEach(function (o) { sort.appendChild(h('option', { value: o[0], text: o[1] })); });
      sort.value = view.sortKey;
      sort.addEventListener('change', function () { view.sortKey = sort.value; view.sortDir = -1; refreshPre(); });
      filters.appendChild(sort);

      var reset = h('button', {
        type: 'button',
        'class': 'reset-link',
        id: 'reset-btn',
        text: 'Reset',
        onclick: function () {
          view.query = '';
          view.category = 'all';
          view.chain = 'all';
          view.watchlistOnly = false;
          render();
        }
      });
      filters.appendChild(reset);
      wrap.appendChild(filters);
      wrap.appendChild(h('div', { id: 'table-slot' }));
    }

    wrap.appendChild(h('footer', {
      'class': 'page-foot',
      text: 'Source: ' + RADAR.source + ' \u00b7 Floor $' + RADAR.floor_usd.toLocaleString('en-US') + ' \u00b7 The watchlist is a floor, never a ceiling: the board also ranks pre-token protocols below it.'
    }));
    mount.appendChild(wrap);
    if (view.tab === 'pre') refreshPre();
  }

  // refresh only the chart + table (keeps the search input focused)
  function refreshPre() {
    var rows = visibleRows();
    var count = document.getElementById('row-count');
    if (count) {
      var bits = [rows.length + ' of ' + RADAR.rows.length + ' protocols'];
      if (view.watchlistOnly) bits.push('watchlist only');
      if (view.category !== 'all') bits.push(view.category);
      if (view.chain !== 'all') bits.push(view.chain);
      count.textContent = bits.join(' \u00b7 ');
    }
    var resetBtn = document.getElementById('reset-btn');
    if (resetBtn) resetBtn.style.display = filteringActive() ? '' : 'none';

    var chartSlot = document.getElementById('chart-slot');
    if (chartSlot) {
      chartSlot.innerHTML = '';
      var chart = topChart(rows);
      if (chart) chartSlot.appendChild(chart);
    }

    var tableSlot = document.getElementById('table-slot');
    if (!tableSlot) return;
    tableSlot.innerHTML = '';
    if (rows.length === 0) {
      var empty = h('div', { 'class': 'table-wrap' });
      empty.appendChild(h('p', { 'class': 'empty-msg', text: 'No protocol matches that filter.' }));
      tableSlot.appendChild(empty);
      return;
    }
    var shell = h('div', { 'class': 'table-wrap' });
    var table = h('table', { 'class': 'board board--pre' });
    var thead = h('thead');
    var hr = h('tr');
    [['#', 'rank'], ['Protocol', 'name'], ['Chains', null], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Implied', 'implied']]
      .forEach(function (col, i) {
        var th = h('th', { 'class': i >= 3 ? 'num' : '' });
        if (col[1]) {
          var arrow = view.sortKey === col[1] ? (view.sortDir === -1 ? ' \u2193' : ' \u2191') : '';
          var btn = h('button', { type: 'button', text: col[0] + arrow });
          btn.addEventListener('click', function () {
            if (view.sortKey === col[1]) view.sortDir = -view.sortDir;
            else { view.sortKey = col[1]; view.sortDir = -1; }
            refreshPre();
          });
          th.appendChild(btn);
        } else {
          th.textContent = col[0];
        }
        hr.appendChild(th);
      });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = h('tbody');
    rows.slice(0, 200).forEach(function (r) { tbody.appendChild(boardRow(r)); });
    table.appendChild(tbody);
    shell.appendChild(table);
    tableSlot.appendChild(shell);
    if (rows.length > 200) {
      tableSlot.appendChild(h('p', {
        'class': 'row-count',
        text: 'Showing the first 200 of ' + rows.length + ' \u2014 narrow the filter to see more.'
      }));
    }
  }

  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && view.openSlug) closeDetail();
  });

  readHash();
  render();
})();
