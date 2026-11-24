// The Farmable Radar's page: one dataset (window.RADAR, written by main.ts),
// three views chosen by the hash — the board, one protocol's detail, a filtered
// board. No fetch and no network: everything renders from the data script.
//
// Views:
//   (no hash) or #board            the full board, the method, the live tokens
//   #detail/<slug>                 one protocol: its equation, its odds, its plan
//   #filter/verdict=FARM (or category=<name>)  the board, filtered

/** HTML-escape a string from the snapshot. */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Whole dollars with thousands separators. */
function fmtUsd(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/** Short dollars for the table: $12.94M, $843K, $1. */
function fmtShort(n) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + Math.round(n);
}

/** A per-cent change, or an em dash when the snapshot records none. */
function fmtChange(v) {
  if (v === null || v === undefined) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}

/** A verdict badge. */
function verdictBadge(v) {
  const cls = v === 'FARM' ? 'farm' : v === 'THIN' ? 'thin' : 'skip';
  return '<span class="badge ' + cls + '">' + v + '</span>';
}

/** A farmability badge, with the reason as its title. */
function farmableBadge(row) {
  if (row.farmable === 1) return '<span class="badge yes">FARMABLE</span>';
  return '<span class="badge no" title="' + esc(row.farmable_reason) + '">NOT FARMABLE</span>';
}

const DATA = window.RADAR;
const ROWS = DATA.rows;
const V = DATA.validation;

const state = { verdict: '', category: '', search: '', sort: 'ev' };

// ------------------------------------------------------------------ the strip

/** The model's equation in raw form, from the fitted coefficients. */
function rawEquation() {
  const rawIntercept = V.intercept - (V.coef_log_tvl * 17) / 3;
  const rawSlope = V.coef_log_tvl / 3;
  const growth = V.coef_growth === 0 ? '' : ' − ' + Math.abs(V.coef_growth).toFixed(4) + ' × g';
  return 'ln fitted = ' + rawIntercept.toFixed(4) + ' + ' + rawSlope.toFixed(4) + ' × ln(TVL)' + growth;
}

function renderStrip() {
  const el = document.getElementById('strip');
  el.innerHTML =
    '<h2>How this board is built</h2>' +
    '<p class="equation">' + esc(rawEquation()) + '</p>' +
    '<p class="numbers">Fitted on <b>' + V.n_comps + ' traded protocols</b> (ridge, λ = ' + V.lambda + '). ' +
    'R² <b>' + V.r2 + '</b> · leave-one-out median error <b>' + V.loo_median_ape_pct + '%</b> · ' +
    'walk-forward median error <b>' + V.wf_median_ape_pct + '%</b> · ' +
    '80% conformal coverage <b>' + V.conformal_coverage_pct + '%</b>.</p>' +
    '<p>Each row: <b>expected value = fitted value × token odds × farmable (0 or 1)</b>. ' +
    'Exchanges, bridges and wrapped or staked products are farmable 0 — they sit at the bottom with the reason shown. ' +
    'Verdicts: <b>FARM ' + V.verdicts.FARM + '</b> · THIN ' + V.verdicts.THIN + ' · SKIP ' + V.verdicts.SKIP + ' of ' + DATA.board_size + ' rows.</p>';
}

function renderMeta() {
  document.getElementById('meta-line').textContent =
    'Snapshot ' + DATA.as_of + ' · ' + DATA.watchlist_size + ' protocols on the watchlist · ' +
    DATA.board_size + ' pre-token protocols ranked · ' + DATA.live_size + ' live tokens set aside · ' +
    'model ' + DATA.model_version + ' · ' + esc(DATA.source);
  document.getElementById('footer-line').textContent =
    'The Farmable Radar — model ' + DATA.model_version + ', snapshot ' + DATA.as_of + '. ' +
    'Built from the sealed snapshot alone. No network, no live data. Source: DefiLlama protocols, fetched ' + esc(DATA.source) + '.';
}

// ------------------------------------------------------------------ the board

function filteredRows() {
  let rows = ROWS.filter((r) => {
    if (state.verdict === 'FARM' || state.verdict === 'THIN' || state.verdict === 'SKIP') {
      if (r.verdict !== state.verdict) return false;
    }
    if (state.verdict === 'NOTFARM' && r.farmable !== 0) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const key = state.sort === 'fitted' ? 'fitted_value_usd' : state.sort === 'tvl' ? 'tvl_usd' : state.sort === 'odds' ? 'token_odds' : 'implied_value_usd';
  rows = rows.slice().sort((a, b) => b[key] - a[key] || (a.slug < b.slug ? -1 : 1));
  return rows;
}

function renderBoard() {
  const rows = filteredRows();
  const body = document.getElementById('board-body');
  body.innerHTML = rows
    .map((r) => {
      const chains = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      const reason = r.farmable === 0 ? '<span class="reason">' + esc(r.farmable_reason) + '</span>' : '';
      return (
        '<tr>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name"><a href="#detail/' + esc(r.slug) + '">' + esc(r.name) + '</a><br><span class="sub">' + esc(r.slug) + (chains ? ' · ' + esc(chains) : '') + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtChange(r.change_7d) + '</td>' +
        '<td class="num">' + fmtShort(r.fitted_value_usd) + '</td>' +
        '<td class="num">' + r.token_odds.toFixed(2) + '</td>' +
        '<td>' + farmableBadge(r) + reason + '</td>' +
        '<td class="num"><strong>' + fmtShort(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + fmtShort(r.interval_low_usd) + '–' + fmtShort(r.interval_high_usd) + '</td>' +
        '<td>' + verdictBadge(r.verdict) + '</td>' +
        '</tr>'
      );
    })
    .join('');
  document.getElementById('filter-count').textContent =
    rows.length + ' of ' + ROWS.length + ' rows shown' +
    (state.sort !== 'ev' ? ' · sorted by ' + state.sort : '');
}

function renderCategories() {
  const select = document.getElementById('category-filter');
  const cats = [...new Set(ROWS.map((r) => r.category).filter(Boolean))].sort();
  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

// ------------------------------------------------------------------ the detail view

function oddsLine(row) {
  const entry = V.odds_by_category.find((o) => o.category === row.category);
  if (entry) {
    return (
      'Token odds ' + row.token_odds.toFixed(2) + ': ' + entry.peers + ' mature peers in ' + row.category +
      ' record a token at a smoothed rate of ' + row.token_odds.toFixed(2) +
      ' (global mature rate ' + V.odds_global_rate + ', ' + V.odds_mature_n + ' mature peers).'
    );
  }
  return 'Token odds ' + row.token_odds.toFixed(2) + ': the global mature rate (' + V.odds_global_rate + ', ' + V.odds_mature_n + ' mature peers) — too few peers in this category to price it alone.';
}

function renderDetail(slug) {
  const row = ROWS.find((r) => r.slug === slug);
  const el = document.getElementById('detail');
  if (!row) {
    el.hidden = false;
    el.innerHTML = '<a class="back" href="#board">← Back to the board</a><h2>Not on the board</h2><p>No pre-token protocol with the slug “' + esc(slug) + '” is in this snapshot.</p>';
    return;
  }
  const age = row.age_days === null ? '—' : row.age_days + ' days';
  el.hidden = false;
  el.innerHTML =
    '<a class="back" href="#board">← Back to the board</a>' +
    '<h2>' + esc(row.name) + ' <span class="sub">#' + row.rank + ' · ' + esc(row.category || 'no category') + '</span></h2>' +
    '<p>' + verdictBadge(row.verdict) + ' ' + farmableBadge(row) + '</p>' +
    '<dl class="kv">' +
    '<div><dt>Expected value</dt><dd>' + fmtUsd(row.implied_value_usd) + '</dd></div>' +
    '<div><dt>Fitted value</dt><dd>' + fmtUsd(row.fitted_value_usd) + '</dd></div>' +
    '<div><dt>80% range (expected)</dt><dd>' + fmtUsd(row.interval_low_usd) + ' – ' + fmtUsd(row.interval_high_usd) + '</dd></div>' +
    '<div><dt>80% range (fitted)</dt><dd>' + fmtUsd(row.fitted_low_usd) + ' – ' + fmtUsd(row.fitted_high_usd) + '</dd></div>' +
    '<div><dt>Token odds</dt><dd>' + row.token_odds.toFixed(2) + '</dd></div>' +
    '<div><dt>TVL</dt><dd>' + fmtUsd(row.tvl_usd) + '</dd></div>' +
    '<div><dt>7-day change</dt><dd>' + fmtChange(row.change_7d) + '</dd></div>' +
    '<div><dt>Age with no token</dt><dd>' + age + '</dd></div>' +
    '<div><dt>Chains</dt><dd>' + esc(row.chains.join(', ') || '—') + '</dd></div>' +
    '</dl>' +
    '<h3>The equation, with this row\u2019s numbers</h3>' +
    '<p class="equation">' + esc(row.equation) + '</p>' +
    (row.farmable === 0
      ? '<div class="reason-box"><strong>Not farmable:</strong> ' + esc(row.farmable_reason) + '. The expected value is $0, shown as $1 so the board stays a ranking.</div>'
      : '<p>' + esc(oddsLine(row)) + '</p>') +
    '<h3>How to farm it</h3>' +
    '<ol class="steps">' + row.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
}

// ------------------------------------------------------------------ the method tables

function miniTable(head, rows) {
  return (
    '<table class="mini"><thead><tr>' +
    head.map((h) => '<th' + (h.num ? ' class="num"' : '') + '>' + h.label + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (head[i].num ? ' class="num"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>'
  );
}

function renderMethod() {
  const first = V.selection_rounds[0];
  const last = V.selection_rounds[V.selection_rounds.length - 1];
  document.getElementById('term-table').innerHTML =
    '<p>Round 1 (λ = ' + first.lambda + '): each term tested against the full model. ' +
    'A term is kept only when removing it makes <em>both</em> blind tests worse. ' +
    'Round ' + last.round + ' re-tests the survivors at λ = ' + last.lambda + '.</p>' +
    miniTable(
      [
        { label: 'Term' },
        { label: 'LOO without', num: true },
        { label: 'Walk-forward without', num: true },
        { label: 'LOO full', num: true },
        { label: 'Walk-forward full', num: true },
        { label: 'Verdict' },
      ],
      first.terms.map((t) => [
        esc(t.term),
        t.loo_without_pct.toFixed(2) + '%',
        t.wf_without_pct.toFixed(2) + '%',
        t.loo_full_pct.toFixed(2) + '%',
        t.wf_full_pct.toFixed(2) + '%',
        t.verdict,
      ]),
    ) +
    '<p>Survivors after round ' + last.round + ': <strong>' + V.surviving_terms.join(' + ') + '</strong> (λ = ' + V.lambda + '). ' +
    'Dropped: ' + (V.dropped_terms.join(', ') || 'none') + '. ' +
    'Note the margins: growth survives both tests by 0.01–0.06 points — a marginal keep, not a driver. ' +
    'Its coefficient is ' + V.coef_growth + ', so a 100-point swing in seven-day growth moves the fitted value by about 3%.</p>';

  document.getElementById('odds-table').innerHTML =
    '<p>Global mature rate: <strong>' + V.odds_global_rate + '</strong> of ' + V.odds_mature_n + ' mature peers record a token. ' +
    'Smoothing strength α = ' + V.odds_alpha + '.</p>' +
    miniTable(
      [
        { label: 'Category' },
        { label: 'Token odds', num: true },
        { label: 'Mature peers', num: true },
      ],
      V.odds_by_category.map((o) => [esc(o.category), o.odds.toFixed(2), String(o.peers)]),
    );

  document.getElementById('farm-rules').innerHTML =
    '<ul>' + V.farmability_rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' +
    '<p>' + V.farmable_n + ' rows are farmable, ' + V.not_farmable_n + ' are not. ' +
    (V.watchlist_not_farmable.length > 0
      ? 'On the watchlist itself, ' + V.watchlist_not_farmable.map(esc).join(', ') + ' is not farmable — it stays on the board at the bottom with its reason.'
      : 'Every watchlist protocol is farmable.') +
    '</p>';

  document.getElementById('conformal-table').innerHTML =
    '<p>80% conformal intervals from the leave-one-out residuals. Coverage on the traded protocols: <strong>' +
    V.conformal_coverage_pct + '%</strong> (target 80%). Pooled half-width in log space: ' + V.conformal_pooled_q + '.</p>' +
    miniTable(
      [
        { label: 'Category' },
        { label: 'Half-width (log)', num: true },
        { label: 'Interval factor', num: true },
        { label: 'Traded protocols', num: true },
        { label: 'Source' },
      ],
      V.conformal_by_category.map((c) => [
        esc(c.category),
        c.q.toFixed(3),
        '×' + Math.exp(c.q).toFixed(2),
        String(c.n),
        c.source,
      ]),
    );

  document.getElementById('validation-summary').innerHTML =
    '<p><strong>Validation, in one place.</strong> Comps: ' + V.n_comps + ' traded protocols (market cap recorded, exchanges excluded). ' +
    'Walk-forward split at ' + V.wf_cutoff_age_days + ' days: ' + V.wf_train_n + ' older to fit, ' + V.wf_test_n + ' newer to predict. ' +
    'λ grid ' + V.lambda_grid.join(', ') + ', chosen ' + V.lambda + '. R² ' + V.r2 + ' (log scale, in-sample). ' +
    'Median-mcap baseline error ' + V.baseline_median_mcap_ape_pct + '% — the model beats it by ' +
    V.ratio_vs_baseline_loo + '× leave-one-out and ' + V.ratio_vs_baseline_wf + '× walk-forward. ' +
    'That is barely better than the baseline, and the dashboard says so: market cap is only weakly predictable from ' +
    'these figures, and the intervals above are the honest size of that ignorance.</p>';
}

function renderLive() {
  document.getElementById('live-body').innerHTML = DATA.live
    .map(
      (r) =>
        '<tr><td class="name">' + esc(r.name) + '<br><span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + fmtShort(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtShort(r.mcap_usd || 0) + '</td>' +
        '<td class="num">' + fmtChange(r.change_7d) + '</td></tr>',
    )
    .join('');
}

// ------------------------------------------------------------------ routing

function showBoard() {
  document.getElementById('detail').hidden = true;
  document.getElementById('detail').innerHTML = '';
  for (const id of ['strip', 'filters', 'board-wrap', 'method', 'live']) {
    document.getElementById(id).hidden = false;
  }
}

function route() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#detail/')) {
    const slug = decodeURIComponent(hash.slice('#detail/'.length));
    for (const id of ['strip', 'filters', 'board-wrap', 'method', 'live']) {
      document.getElementById(id).hidden = true;
    }
    renderDetail(slug);
    window.scrollTo(0, 0);
    return;
  }
  showBoard();
  if (hash.startsWith('#filter/')) {
    const query = new URLSearchParams(hash.slice('#filter/'.length));
    const verdict = query.get('verdict');
    const category = query.get('category');
    if (verdict) {
      state.verdict = verdict;
      document.querySelectorAll('.chip').forEach((b) => b.classList.toggle('active', b.dataset.verdict === verdict));
    }
    if (category) {
      state.category = category;
      document.getElementById('category-filter').value = category;
    }
  }
  renderBoard();
}

document.querySelectorAll('.chip').forEach((b) => {
  b.addEventListener('click', () => {
    state.verdict = b.dataset.verdict;
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b));
    renderBoard();
  });
});
document.getElementById('category-filter').addEventListener('change', (e) => {
  state.category = e.target.value;
  renderBoard();
});
document.getElementById('search-filter').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderBoard();
});
document.getElementById('sort-filter').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderBoard();
});
window.addEventListener('hashchange', route);

renderMeta();
renderStrip();
renderCategories();
renderMethod();
renderLive();
route();
