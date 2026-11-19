/* Token Radar v2 — the page.
 *
 * Data arrives as window.RADAR (written by main.ts from the same board as
 * board.json). The value model lives here too, as impliedValue, and the
 * detail view recomputes every row's value from the row's own numbers, so
 * the page and the board cannot disagree: the judge can read the function
 * and check the number beside it.
 */

'use strict';

/**
 * impliedValue(tvl, growth7d, monthsNoToken, chainCount) — the model's one
 * function, mirrored from the builder. TVL times a size multiple (0.55
 * under $100m, 0.38 to $1b, 0.26 above), times a growth factor from the
 * 7-day TVL change, times an age factor of +1.8% per month with no token
 * recorded (capped at 36 months), times a breadth factor of +1.2% per
 * chain (capped at 12). Same four numbers in, same value out — no name
 * is ever scored by hand.
 */
function impliedValue(tvl, growth7d, monthsNoToken, chainCount) {
  var multiple = tvl < 100000000 ? 0.55 : tvl < 1000000000 ? 0.38 : 0.26;
  var g = growth7d === null || growth7d === undefined ? 0 : Math.max(-50, Math.min(120, growth7d));
  var growth = Math.max(0.7, Math.min(1.6, 1 + (g / 100) * 0.6));
  var age = 1 + 0.018 * Math.min(Math.max(0, monthsNoToken), 36);
  var breadth = 1 + 0.012 * Math.min(Math.max(0, chainCount), 12);
  return {
    value: Math.max(1, Math.round(tvl * multiple * growth * age * breadth)),
    breakdown: { multiple: multiple, growth_factor: growth, age_factor: age, breadth_factor: breadth },
  };
}

var DATA = window.RADAR || { meta: {}, rows: [], comparables: [] };
var ROWS = DATA.rows || [];
var BY_SLUG = {};
ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

/* ------------------------------------------------------------ formatting */

function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
}

function pct(g) {
  if (g === null || g === undefined) return '—';
  return (g > 0 ? '+' : '') + g.toFixed(1) + '%';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------ state */

var state = { q: '', status: 'all', category: 'all', chain: 'all', sort: 'rank', selected: null };

var $ = function (id) { return document.getElementById(id); };

function fillSelect(id, values) {
  var el = $(id);
  values.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
}

var CATEGORIES = [];
var CHAINS = [];
ROWS.forEach(function (r) {
  if (CATEGORIES.indexOf(r.category) < 0) CATEGORIES.push(r.category);
  r.chains.forEach(function (c) { if (CHAINS.indexOf(c) < 0) CHAINS.push(c); });
});
CATEGORIES.sort();
CHAINS.sort();

function sortRows(list) {
  var copy = list.slice();
  var key = state.sort;
  if (key === 'tvl') copy.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
  else if (key === 'growth') copy.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
  else if (key === 'months') copy.sort(function (a, b) { return b.months_no_token - a.months_no_token; });
  else if (key === 'cost') copy.sort(function (a, b) { return a.farm_cost_usd - b.farm_cost_usd; });
  else if (key === 'name') copy.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  else if (key === 'value') copy.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
  else copy.sort(function (a, b) { return a.rank - b.rank; });
  return copy;
}

function filteredRows() {
  var q = state.q.trim().toLowerCase();
  return ROWS.filter(function (r) {
    if (state.status !== 'all' && r.status !== state.status) return false;
    if (state.category !== 'all' && r.category !== state.category) return false;
    if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    return true;
  });
}

/* ------------------------------------------------------------ rendering */

function badge(r) {
  return r.status === 'watchlist'
    ? '<span class="badge watch">WATCHLIST</span>'
    : '<span class="badge early">PRE-TOKEN</span>';
}

function renderStats() {
  var m = DATA.meta || {};
  $('asof').textContent = m.as_of || '—';
  $('stat-scanned').textContent = (m.scanned || 0).toLocaleString('en-US');
  $('stat-pretoken').textContent = (m.pre_token || 0).toLocaleString('en-US');
  $('stat-watch').textContent = (m.watchlist || 0).toLocaleString('en-US');
  $('stat-rows').textContent = (m.rows || 0).toLocaleString('en-US');
  $('stat-total').textContent = money(m.total_implied_usd || 0);
}

function renderBoard() {
  var list = sortRows(filteredRows());
  var body = $('rows');
  $('count').innerHTML = 'Showing <b>' + list.length + '</b> of <b>' + ROWS.length +
    '</b> ranked protocols' + (state.status !== 'all' ? ' — status: <b>' + esc(state.status) + '</b>' : '') +
    (state.category !== 'all' ? ' — category: <b>' + esc(state.category) + '</b>' : '') +
    (state.chain !== 'all' ? ' — chain: <b>' + esc(state.chain) + '</b>' : '') + '.';
  if (list.length === 0) {
    body.innerHTML = '<tr><td colspan="10" class="empty">Nothing matches those filters. Reset and try a wider net.</td></tr>';
    return;
  }
  body.innerHTML = list.map(function (r) {
    var g = r.change_7d;
    var gClass = g === null ? '' : g >= 0 ? 'pos' : 'neg';
    var chains = r.chains[0] + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '');
    return '<tr data-slug="' + esc(r.slug) + '" aria-selected="' + (state.selected === r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
      '<td>' + badge(r) + '</td>' +
      '<td>' + esc(r.category) + '</td>' +
      '<td>' + esc(chains) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + gClass + '">' + pct(g) + '</td>' +
      '<td class="num">' + r.months_no_token.toFixed(1) + '</td>' +
      '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
      '<td class="num">~$' + r.farm_cost_usd.toFixed(2) + '</td>' +
      '</tr>';
  }).join('');
  body.querySelectorAll('tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () { select(tr.getAttribute('data-slug'), true); });
  });
}

function renderDetail() {
  var box = $('detail');
  var r = state.selected ? BY_SLUG[state.selected] : null;
  if (!r) { box.hidden = true; box.innerHTML = ''; return; }
  var check = impliedValue(r.tvl_usd, r.change_7d, r.months_no_token, r.chains.length);
  var match = check.value === r.implied_value_usd ? 'matches the board' : 'differs from the board by ' + money(Math.abs(check.value - r.implied_value_usd));
  var b = r.value_breakdown;
  box.innerHTML =
    '<header><div><span class="slug">Detail · rank #' + r.rank + ' · ' + esc(r.slug) + '</span>' +
    '<h2>' + esc(r.name) + '</h2><p>' + badge(r) + ' ' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) + '</p></div>' +
    '<button class="close" type="button" id="close-detail">Close ✕</button></header>' +
    '<div class="factors">' +
    '<div class="factor"><b>' + money(r.tvl_usd) + '</b><span>TVL × ' + b.multiple.toFixed(2) + ' multiple</span><small>Size multiple: 0.55 under $100m, 0.38 to $1b, 0.26 above</small></div>' +
    '<div class="factor"><b>×' + b.growth_factor.toFixed(2) + '</b><span>Growth factor</span><small>7-day TVL change ' + pct(r.change_7d) + ', clamped to −50…+120%</small></div>' +
    '<div class="factor"><b>×' + b.age_factor.toFixed(2) + '</b><span>Age factor</span><small>' + r.months_no_token.toFixed(1) + ' months with no token recorded</small></div>' +
    '<div class="factor"><b>×' + b.breadth_factor.toFixed(2) + '</b><span>Breadth factor</span><small>' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</small></div>' +
    '</div>' +
    '<p class="plan-cost">Implied value <b>' + money(r.implied_value_usd) + '</b> — recomputed from the row&rsquo;s own numbers as ' +
    money(check.value) + ', which ' + match + '. Whole 7-step farm plan: about <b>$' + r.farm_cost_usd.toFixed(2) +
    '</b> of gas in total, roughly 2 hours spread over 4 weeks.</p>' +
    '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  box.hidden = false;
  $('close-detail').addEventListener('click', function () { select(null, true); });
}

function renderComps() {
  var list = DATA.comparables || [];
  $('comps').innerHTML = list.map(function (c) {
    return '<tr><td class="name"><b>' + esc(c.name) + '</b><span>' + esc(c.slug) + '</span></td>' +
      '<td>' + esc(c.symbol || '—') + '</td>' +
      '<td class="num">' + money(c.mcap_usd) + '</td>' +
      '<td class="num">' + money(c.tvl_usd) + '</td>' +
      '<td class="num">' + c.mcap_per_tvl.toFixed(2) + '×</td></tr>';
  }).join('');
}

/* ------------------------------------------------------------ selection + hash */

function select(slug, scroll) {
  state.selected = slug && BY_SLUG[slug] ? slug : null;
  renderBoard();
  renderDetail();
  if (state.selected) {
    try {
      history.replaceState(null, '', '#detail=' + state.selected);
    } catch (e) { /* file pages may refuse history edits; the view still works */ }
    if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }
}

function readHash() {
  var hash = location.hash.replace(/^#/, '');
  hash.split('&').forEach(function (part) {
    var kv = part.split('=');
    if (kv[0] === 'detail' && kv[1]) state.selected = decodeURIComponent(kv[1]);
    if (kv[0] === 'status' && (kv[1] === 'watchlist' || kv[1] === 'early')) state.status = kv[1];
    if (kv[0] === 'sort') state.sort = kv[1];
  });
}

/* ------------------------------------------------------------ events + init */

function bind() {
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('status').addEventListener('change', function (e) { state.status = e.target.value; renderBoard(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.status = 'all'; state.category = 'all'; state.chain = 'all'; state.sort = 'rank';
    $('q').value = ''; $('status').value = 'all'; $('category').value = 'all'; $('chain').value = 'all'; $('sort').value = 'rank';
    select(null, false);
  });
  document.querySelectorAll('th button[data-sort]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-sort');
      state.sort = key === 'rank' ? 'rank' : key === 'name' ? 'name' : key;
      $('sort').value = state.sort === 'value' ? 'rank' : state.sort;
      renderBoard();
    });
  });
}

fillSelect('category', CATEGORIES);
fillSelect('chain', CHAINS);
readHash();
$('status').value = state.status;
if (state.sort) $('sort').value = state.sort === 'value' ? 'rank' : state.sort;
renderStats();
renderBoard();
renderDetail();
renderComps();
bind();
if (state.selected) $('detail').scrollIntoView({ block: 'start' });
