// Token Launch Radar — renders window.RADAR (written by main.ts from the
// same rows as board.json) into a sortable, filterable board with a detail
// view per protocol. No network: every number on the page comes from RADAR.
(function () {
  var R = window.RADAR;
  if (!R) return;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n, digits) { return (n * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }
  function ageText(d) {
    if (d === null || d === undefined) return '—';
    if (d < 365) return Math.round(d / 30) + ' mo';
    return (d / 365).toFixed(1) + ' y';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- header + KPIs -------------------------------------------------
  $('asof').textContent = 'Snapshot ' + R.as_of + ' · floor ' + money(R.floor_usd) + ' · model ' + R.model_version;
  var farmN = R.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
  var med = R.rows.slice().sort(function (a, b) { return a.implied_value_usd - b.implied_value_usd; })[Math.floor(R.rows.length / 2)].implied_value_usd;
  var kpis = [
    [R.board_size, 'protocols ranked — all that record no token'],
    [R.watchlist_size, 'on the watchlist (all covered)'],
    [farmN, 'FARM verdicts'],
    [money(med), 'median implied value'],
    [R.fit.comps, 'traded comps fitted'],
    [pct(R.validation.heldOutMedianApe, 0), 'held-out median error'],
  ];
  $('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span></div>';
  }).join('');

  // ---- fit + validation panel ----------------------------------------
  $('fittext').textContent =
    'fitCompsCurve fits log market cap on log TVL, 7d growth, log age and a category dummy, ' +
    'ridge-regularised, on the snapshot\u2019s ' + R.fit.comps + ' traded protocols — no multiple is hand-picked. ' +
    'impliedValueFromComps then prices each pre-token protocol from that curve; ' +
    'tokenOddsByAge gives the empirical token rate for its age bucket.';
  var fitRows = R.fit.columns.map(function (col, i) {
    return '<tr><td>' + esc(col) + '</td><td class="num">' + R.fit.beta[i].toFixed(3) + '</td></tr>';
  }).join('');
  $('fittable').innerHTML = '<tr><th>Term</th><th class="num">Coefficient</th></tr>' + fitRows;
  $('fitnote').textContent =
    'Log TVL is centred at ' + R.fit.log_tvl_centre.toFixed(2) + '. R\u00B2 ' + R.fit.r_squared.toFixed(3) +
    '; residual \u03C3 ' + R.fit.sigma.toFixed(2) + ' in log points, so P10–P90 spans \u00D7' +
    Math.exp(-1.2816 * R.fit.sigma).toFixed(2) + ' to \u00D7' + Math.exp(1.2816 * R.fit.sigma).toFixed(1) + '.';
  var v = R.validation;
  $('validtable').innerHTML =
    '<tr><th>Check</th><th class="num">Median error</th><th class="num">Mean error</th></tr>' +
    '<tr><td>Held out (' + v.heldOutN + ' comps)</td><td class="num">' + pct(v.heldOutMedianApe) + '</td><td class="num">' + pct(v.heldOutMeanApe) + '</td></tr>' +
    '<tr><td>Leave-one-out (' + R.fit.comps + ' refits)</td><td class="num">' + pct(v.looMedianApe) + '</td><td class="num">' + pct(v.looMeanApe) + '</td></tr>' +
    '<tr><td colspan="3" style="color:var(--muted)">Error is |predicted mcap \u2212 actual mcap| / actual mcap. ' + esc(v.splitRule) + '.</td></tr>';
  $('oddstable').innerHTML = '<tr><th>Age since listing</th><th class="num">Protocols</th><th class="num">With token</th><th class="num">Odds</th></tr>' +
    R.odds_buckets.map(function (b) {
      return '<tr><td>' + esc(b.label) + '</td><td class="num">' + b.protocols + '</td><td class="num">' + b.withToken + '</td><td class="num">' + pct(b.odds) + '</td></tr>';
    }).join('') +
    '<tr><td>Overall (all ' + R.protocols_total + ' protocols)</td><td class="num">—</td><td class="num">—</td><td class="num">' + pct(R.odds_overall) + '</td></tr>';
  $('verdictrule').textContent = 'Verdict rule: ' + R.verdict_rule;

  // ---- board ---------------------------------------------------------
  var cats = [];
  R.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function visibleRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value;
    var ver = $('verdict').value;
    var watch = $('watchonly').checked;
    var list = R.rows.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0)) return false;
      if (cat && r.category !== cat) return false;
      if (ver && r.verdict !== ver) return false;
      if (watch && !r.watchlist) return false;
      return true;
    });
    var sort = $('sort').value;
    var key = { implied: 'implied_value_usd', expected: 'expected_value_usd', odds: 'token_odds', tvl: 'tvl_usd', growth: 'change_7d' }[sort];
    list.sort(function (a, b) {
      var av = a[key] === null || a[key] === undefined ? -Infinity : a[key];
      var bv = b[key] === null || b[key] === undefined ? -Infinity : b[key];
      return bv - av || a.rank - b.rank;
    });
    return list;
  }

  function renderBoard() {
    var list = visibleRows();
    $('count').textContent = list.length + ' of ' + R.rows.length + ' shown';
    $('rows').innerHTML = list.map(function (r) {
      var g = r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td>' + esc(r.name) + (r.watchlist ? '<span class="wl">WL</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + g + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + money(r.implied_p10_usd) + '–' + money(r.implied_p90_usd) + '</td>' +
        '<td class="num">' + pct(r.token_odds, 0) + '</td>' +
        '<td class="num">' + money(r.expected_value_usd) + '</td>' +
        '<td><span class="badge ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td class="num">$' + r.farm_cost_usd + ' / ' + r.farm_days + 'd</td></tr>';
    }).join('');
  }

  // ---- detail view ---------------------------------------------------
  var current = null;
  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return;
    current = r;
    document.body.classList.add('detail-mode');
    $('detail').hidden = false;
    $('dname').textContent = '#' + r.rank + ' ' + r.name + ' — implied ' + money(r.implied_value_usd) +
      ' (P10 ' + money(r.implied_p10_usd) + ' – P90 ' + money(r.implied_p90_usd) + ')';
    $('dmeta').textContent = (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · TVL ' + money(r.tvl_usd) +
      ' · 7d ' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + ' · listed ' + (r.listed_at || 'unknown') +
      ' · token odds ' + pct(r.token_odds, 0) + ' · expected ' + money(r.expected_value_usd) +
      ' · verdict ' + r.verdict + (r.watchlist ? ' · on the watchlist' : '');
    var m = r.model;
    var parts = [['Intercept', m.intercept], ['TVL (log TVL + square)', m.tvl], ['7d growth', m.growth], ['Age since listing', m.age], ['Category', m.category]];
    $('dfactors').innerHTML = '<tr><th>Factor</th><th class="num">Log points</th><th class="num">× value</th></tr>' +
      parts.map(function (p) { return '<tr><td>' + p[0] + '</td><td class="num">' + p[1].toFixed(2) + '</td><td class="num">' + (p[0] === 'Intercept' ? '—' : '×' + Math.exp(p[1]).toFixed(2)) + '</td></tr>'; }).join('') +
      '<tr><td><b>Fitted log mcap</b></td><td class="num"><b>' + (m.intercept + m.tvl + m.growth + m.age + m.category).toFixed(2) + '</b></td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    var same = R.live.filter(function (c) { return c.category === r.category; });
    var comps = (same.length >= 3 ? same : R.live).slice(0, 5);
    $('dcompshead').textContent = same.length >= 3
      ? 'Nearest traded comps in this category'
      : 'Traded comps — too few in this category, so the largest traded comps overall';
    $('dcomps').innerHTML = '<tr><th>Traded comp</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr>' +
      comps.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + money(c.tvl_usd) + '</td><td class="num">' + (c.mcap_usd / c.tvl_usd).toFixed(2) + '×</td></tr>';
      }).join('');
    $('dcost').textContent = '$' + r.farm_cost_usd + ' total, about ' + r.farm_days + ' days';
    $('dsteps').innerHTML = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    document.querySelectorAll('#rows tr').forEach(function (tr) { tr.classList.toggle('sel', tr.getAttribute('data-slug') === slug); });
    $('detail').scrollIntoView({ block: 'start' });
  }
  function hideDetail() { $('detail').hidden = true; document.body.classList.remove('detail-mode'); current = null; }
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    location.hash = 'detail=' + tr.getAttribute('data-slug');
  });
  $('closedetail').addEventListener('click', function () { history.replaceState(null, '', location.pathname); hideDetail(); });

  // ---- traded comps table --------------------------------------------
  $('liverows').innerHTML = R.live.map(function (c) {
    return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.category || '—') + '</td><td>' +
      esc(c.chains.slice(0, 2).join(', ')) + '</td><td class="num">' + money(c.tvl_usd) + '</td>' +
      '<td class="num">' + money(c.mcap_usd) + '</td><td class="num">' + (c.mcap_usd / c.tvl_usd).toFixed(2) + '×</td>' +
      '<td class="num">' + (c.change_7d === null ? '—' : c.change_7d.toFixed(1) + '%') + '</td></tr>';
  }).join('');
  $('src').textContent = 'Source: ' + R.source + '.';

  // ---- controls + hash routing ---------------------------------------
  function applyHash() {
    var h = location.hash.slice(1);
    var params = {};
    h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) params[p[0]] = decodeURIComponent(p[1] || ''); });
    if (params.verdict) $('verdict').value = params.verdict;
    if (params.cat) $('cat').value = params.cat;
    if (params.q) $('q').value = params.q;
    if (params.sort) $('sort').value = params.sort;
    if (params.watch) $('watchonly').checked = params.watch === '1';
    renderBoard();
    if (params.detail) showDetail(params.detail); else hideDetail();
  }
  ['q', 'cat', 'verdict', 'watchonly', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
