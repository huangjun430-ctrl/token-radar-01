// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table and a per-protocol detail view with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
// decide the action, the capital, the hold and every cost and time. No name is special-cased. The
// page recomputes a row's implied value from the snapshot figures and checks the number board.json
// carries, so the page's code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The model in one function, mirroring lib/model.ts.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * maturity));
  }

  // The farm plan, mirroring lib/model.ts: same categories, same capital, same hold.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
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
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
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

  var watchSet = {};
  (DATA.watchlist || []).forEach(function (s) { watchSet[s] = true; });

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (q && (r.name || '').toLowerCase().indexOf(q) === -1 && (r.slug || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var v = 0;
      if (key === 'implied') v = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') v = a.tvl_usd - b.tvl_usd;
      else if (key === 'growth') v = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') v = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else if (key === 'name') v = (a.name || '').localeCompare(b.name || '');
      return v * dir || (a.rank - b.rank);
    });
    return rows;
  }

  function rowHtml(r) {
    var tr = el('tr', { 'class': state.selected === r.slug ? 'sel' : '', onclick: function () { select(r.slug); } });
    tr.appendChild(el('td', { 'class': 'rank', text: '#' + r.rank }));
    var name = el('td', { 'class': 'name' });
    name.appendChild(el('b', { text: r.name }));
    var small = el('small');
    if (watchSet[r.slug]) small.appendChild(el('span', { 'class': 'tag watch', text: 'watchlist' }));
    small.appendChild(el('span', { 'class': 'tag', text: r.category || 'Uncategorised' }));
    name.appendChild(small);
    tr.appendChild(name);
    tr.appendChild(el('td', { text: (r.chains || []).slice(0, 2).join(', ') || '—' }));
    tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
    var g = el('td', { 'class': 'num ' + ((r.change_7d || 0) >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
    tr.appendChild(g);
    tr.appendChild(el('td', { 'class': 'num', text: fmtAge(r.age_days) }));
    tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.implied_value_usd) }));
    return tr;
  }

  function detailHtml(r) {
    var box = el('section', { 'class': 'detail', 'aria-label': 'Protocol detail' });
    box.appendChild(el('h2', { text: '#' + r.rank + ' ' + r.name }));
    box.appendChild(el('p', { 'class': 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains || []).join(', ') + ' · records no token' + (watchSet[r.slug] ? ' · on the watchlist' : '') }));
    var grid = el('div', { 'class': 'grid' });
    var cells = [
      ['Implied value', fmtUsd(r.implied_value_usd)],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['7-day change', fmtPct(r.change_7d)],
      ['Age (no token)', fmtAge(r.age_days)],
      ['Peer multiple', r.peer_multiple.toFixed(3) + '× (' + (r.peer_category === 'all live-token protocols' ? 'global median, ' : r.peer_category + ' median, ') + r.peer_count + ' peers)'],
      ['Growth × maturity', r.growth_multiplier.toFixed(2) + ' × ' + r.maturity_multiplier.toFixed(2)]
    ];
    cells.forEach(function (c) {
      var cell = el('div', { 'class': 'cell' });
      cell.appendChild(el('span', { text: c[0] }));
      cell.appendChild(el('b', { text: c[1] }));
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    var check = impliedOf(r, DATA.model);
    var math = el('p', { 'class': 'math' });
    math.innerHTML = 'TVL ' + esc(fmtUsd(r.tvl_usd)) + ' × peer multiple <code>' + r.peer_multiple.toFixed(3) + '</code> × growth <code>' + r.growth_multiplier.toFixed(2) + '</code> × maturity <code>' + r.maturity_multiplier.toFixed(2) + '</code> = <code>' + esc(fmtUsd(check)) + '</code>' +
      (check === r.implied_value_usd ? ' — the page recomputes the board\u2019s number exactly.' : ' — the page\u2019s recomputation differs; the board\u2019s number governs.');
    box.appendChild(math);
    box.appendChild(el('h3', { text: 'Farm plan' }));
    var ol = el('ol', { 'class': 'steps' });
    farmSteps(r).forEach(function (s) {
      var li = el('li');
      li.appendChild(document.createTextNode(s.text + ' '));
      li.appendChild(el('span', { 'class': 'meta', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      ol.appendChild(li);
    });
    box.appendChild(ol);
    box.appendChild(el('p', { 'class': 'note', text: 'This board states what a token would be worth if the protocol\u2019s record stayed as it is. It does not predict whether or when a token is issued. A protocol that records no token may still have one its DefiLlama record does not carry.' }));
    return box;
  }

  function liveHtml() {
    var table = el('table', { 'class': 'board' });
    var head = el('thead');
    var hr = el('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', 'Market cap', '7d'].forEach(function (h, i) {
      hr.appendChild(el('th', { 'class': i >= 3 ? 'num' : '', text: h }));
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    DATA.live.forEach(function (p) {
      var tr = el('tr');
      tr.appendChild(el('td', { 'class': 'name', html: '<b>' + esc(p.name) + '</b>' }));
      tr.appendChild(el('td', { text: p.category || '—' }));
      tr.appendChild(el('td', { text: (p.chains || []).slice(0, 2).join(', ') || '—' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(p.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(p.mcap_usd) }));
      tr.appendChild(el('td', { 'class': 'num ' + ((p.change_7d || 0) >= 0 ? 'up' : 'down'), text: fmtPct(p.change_7d) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
  }

  function select(slug) {
    state.selected = slug;
    render();
    var box = document.querySelector('.detail');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    var parts = {};
    h.split('&').forEach(function (kv) {
      var eq = kv.indexOf('=');
      if (eq > 0) parts[decodeURIComponent(kv.slice(0, eq))] = decodeURIComponent(kv.slice(eq + 1));
    });
    if (parts.tab === 'live' || parts.tab === 'pre') state.tab = parts.tab;
    if (parts.detail) state.selected = parts.detail;
    if (parts.category) state.category = parts.category;
    if (parts.q) state.q = parts.q;
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    var wrap = el('div', { 'class': 'wrap' });
    var hero = el('header', { 'class': 'hero' });
    hero.appendChild(el('p', { 'class': 'eyebrow', text: 'Token Radar · snapshot ' + DATA.as_of }));
    hero.appendChild(el('h1', { text: 'Pre-token protocols, ranked by implied value' }));
    hero.appendChild(el('p', { 'class': 'lede', text: 'Every protocol below records no token. The board states what a token would be worth if the protocol\u2019s record stayed as it is — it does not predict whether or when a token is issued. Each row carries the steps to farm it.' }));
    var stats = el('p', { 'class': 'stats' });
    [['Watchlist', DATA.watchlist_size], ['Board rows', DATA.board_size], ['Early finds', DATA.early_size], ['Live tokens', DATA.live_size]].forEach(function (s) {
      var st = el('span', { 'class': 'stat' });
      st.appendChild(el('b', { text: String(s[1]) }));
      st.appendChild(el('span', { text: s[0] }));
      stats.appendChild(st);
    });
    hero.appendChild(stats);
    wrap.appendChild(hero);

    var method = el('section', { 'class': 'method' });
    method.appendChild(el('h2', { text: 'How the value is priced — model ' + DATA.model_version }));
    method.appendChild(el('p', { html: 'Implied value = TVL × <code>peer multiple</code> × growth × maturity. The peer multiple is the median market-cap-per-TVL of the live-token protocols in the row\u2019s own category (at least 3 peers, else the median over all live-token protocols, <code>' + DATA.global_multiple.toFixed(3) + '</code>). Growth is the 7-day TVL change clamped to −60%…+120% at half weight; maturity rises from 0.6 to 1.0 over three years with no token. No protocol name is special-cased.' }));
    wrap.appendChild(method);

    var tabs = el('div', { 'class': 'tabs', role: 'tablist' });
    var tabPre = el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre'; state.selected = null; render(); } });
    var tabLive = el('button', { 'class': 'tab', role: 'tab', 'aria-selected': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens', onclick: function () { state.tab = 'live'; state.selected = null; render(); } });
    tabs.appendChild(tabPre);
    tabs.appendChild(tabLive);
    wrap.appendChild(tabs);

    if (state.tab === 'live') {
      wrap.appendChild(el('p', { 'class': 'count', text: 'Protocols whose token already trades, by market cap. The market\u2019s own values — never mixed into the ranked board.' }));
      wrap.appendChild(liveHtml());
    } else {
      var controls = el('div', { 'class': 'controls' });
      var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
      q.addEventListener('input', function () { state.q = q.value; renderTable(); });
      controls.appendChild(q);
      var cat = el('select', { 'aria-label': 'Filter by category' });
      cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
      categories().forEach(function (c) { cat.appendChild(el('option', { value: c, text: c })); });
      cat.value = state.category;
      cat.addEventListener('change', function () { state.category = cat.value; renderTable(); });
      controls.appendChild(cat);
      var ch = el('select', { 'aria-label': 'Filter by chain' });
      ch.appendChild(el('option', { value: 'all', text: 'All chains' }));
      chains().forEach(function (c) { ch.appendChild(el('option', { value: c, text: c })); });
      ch.value = state.chain;
      ch.addEventListener('change', function () { state.chain = ch.value; renderTable(); });
      controls.appendChild(ch);
      var sort = el('select', { 'aria-label': 'Sort by' });
      [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day change'], ['age', 'Sort: age'], ['name', 'Sort: name']].forEach(function (o) {
        sort.appendChild(el('option', { value: o[0], text: o[1] }));
      });
      sort.value = state.sort;
      sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; renderTable(); });
      controls.appendChild(sort);
      wrap.appendChild(controls);
      wrap.appendChild(el('p', { 'class': 'count', id: 'count' }));
      wrap.appendChild(el('div', { id: 'tablewrap' }));
      var sel = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (sel) wrap.appendChild(detailHtml(sel));
    }

    var foot = el('footer', { 'class': 'foot', text: 'Source: ' + DATA.source + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · The watchlist is a floor, never a ceiling: the board also ranks pre-token protocols below it.' });
    wrap.appendChild(foot);
    app.appendChild(wrap);
    if (state.tab === 'pre') renderTable();
  }

  function renderTable() {
    var rows = filteredRows();
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
    var tw = document.getElementById('tablewrap');
    if (!tw) return;
    tw.innerHTML = '';
    if (rows.length === 0) {
      tw.appendChild(el('p', { 'class': 'empty', text: 'No protocol matches that filter.' }));
      return;
    }
    var table = el('table', { 'class': 'board' });
    var head = el('thead');
    var hr = el('tr');
    [['#', 'rank'], ['Protocol', 'name'], ['Chains', null], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Implied', 'implied']].forEach(function (h, i) {
      var th = el('th', { 'class': i >= 3 ? 'num' : '' });
      if (h[1]) {
        var b = el('button', { text: h[0] + (state.sort === h[1] ? (state.dir === -1 ? ' ↓' : ' ↑') : '') });
        b.addEventListener('click', function () {
          if (state.sort === h[1]) state.dir = -state.dir;
          else { state.sort = h[1]; state.dir = -1; }
          renderTable();
        });
        th.appendChild(b);
      } else th.textContent = h[0];
      hr.appendChild(th);
    });
    head.appendChild(hr);
    table.appendChild(head);
    var body = el('tbody');
    rows.slice(0, 200).forEach(function (r) { body.appendChild(rowHtml(r)); });
    table.appendChild(body);
    tw.appendChild(table);
    if (rows.length > 200) tw.appendChild(el('p', { 'class': 'count', text: 'Showing the first 200 of ' + rows.length + ' — narrow the filter to see more.' }));
  }

  readHash();
  render();
})();
