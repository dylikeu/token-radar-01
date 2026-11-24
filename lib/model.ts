// The Farmable Radar (token-radar-01 v4): one snapshot of the protocol universe in,
// one ranked board out.
//
// The board ranks every pre-token protocol in the sealed snapshot by its FARMABLE
// expected value: the fitted launch value, times the token odds from its peers'
// record, times a farmability gate (0 or 1). Exchanges, bridges, wrapped or staked
// products of a token that already trades, and stablecoins cannot be farmed for a
// new launch: they stay on the board at the bottom, with the reason shown, because
// the watchlist must be covered and a gate that hides rows is a gate nobody can check.
//
// The fitted value is a ridge regression of log market cap on the snapshot's own
// figures, fitted at runtime on the traded protocols (the comps). Every term of
// that regression is kept or dropped on TWO blind tests — leave-one-out and a
// walk-forward split by listing date — and the dashboard prints both tests' numbers
// per term, so the model is what survived, not what was assumed. Uncertainty is a
// conformal interval per category, from the leave-one-out residuals. Nothing here
// is a hardcoded list of protocol names: the same functions score every row.

import { dot, invert, matVec, median, solve, xtx, xty } from './linalg.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** The ridge penalty grid the leave-one-out search walks, smallest first. */
export const LAMBDAS = [0.03, 0.1, 0.3, 1, 3, 10, 30, 100];

/** The six candidate value terms, in the order they are tested. */
export const TERMS = ['logTVL', 'logTVL^2', 'growth', 'logAge', 'logChains', 'category'] as const;
export type TermName = (typeof TERMS)[number];

/** Verdict thresholds on farmable expected value, in whole dollars. */
export const FARM_FLOOR_USD = 10_000_000;
export const THIN_FLOOR_USD = 3_000_000;

/** The conformal interval's coverage target (an 80% interval). */
export const CONFORMAL_ALPHA = 0.2;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The ranking value: farmable expected value, floored at $1 (the gate needs > 0). */
  implied_value_usd: number;
  /** The fitted launch value before odds and farmability. */
  fitted_value_usd: number;
  fitted_low_usd: number;
  fitted_high_usd: number;
  token_odds: number;
  farmable: 0 | 1;
  farmable_reason: string;
  expected_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  model: {
    intercept: number;
    coef_log_tvl: number;
    coef_growth: number;
    lambda: number;
    log_tvl: number;
    growth_clamped: number;
    equation: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  fitted_value_usd: number;
  fitted_low_usd: number;
  fitted_high_usd: number;
  token_odds: number;
  farmable: 0 | 1;
  farmable_reason: string;
  implied_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  equation: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One term's two blind tests, as the dashboard prints them. */
export interface TermTest {
  term: TermName;
  loo_without_pct: number;
  wf_without_pct: number;
  loo_full_pct: number;
  wf_full_pct: number;
  verdict: 'KEEP' | 'DROP';
}

/** One round of the term-selection procedure. */
export interface SelectionRound {
  round: number;
  lambda: number;
  terms: TermTest[];
}

/** Everything the dashboard and the validation report say about the model. */
export interface ValidationReport {
  model_version: string;
  n_comps: number;
  n_dated_comps: number;
  wf_cutoff_age_days: number;
  wf_train_n: number;
  wf_test_n: number;
  lambda_grid: number[];
  lambda: number;
  surviving_terms: TermName[];
  dropped_terms: TermName[];
  selection_rounds: SelectionRound[];
  intercept: number;
  coef_log_tvl: number;
  coef_growth: number;
  r2: number;
  loo_median_ape_pct: number;
  wf_median_ape_pct: number;
  baseline_median_mcap_ape_pct: number;
  ratio_vs_baseline_loo: number;
  ratio_vs_baseline_wf: number;
  conformal_alpha: number;
  conformal_coverage_pct: number;
  conformal_pooled_q: number;
  conformal_by_category: { category: string; q: number; n: number; source: 'category' | 'pooled' }[];
  odds_global_rate: number;
  odds_mature_n: number;
  odds_alpha: number;
  odds_by_category: { category: string; odds: number; peers: number }[];
  farmability_rules: string[];
  farmable_n: number;
  not_farmable_n: number;
  verdicts: { FARM: number; THIN: number; SKIP: number };
  watchlist_not_farmable: string[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  validation: ValidationReport;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token (a market cap, a CoinGecko id, or a symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return !isPreToken(p);
}

// ------------------------------------------------------------------ features

/** The five continuous features, in term order, before the category dummies. */
export function continuousFeatures(p: SnapshotProtocol, asOf: string): number[] {
  const x1 = (Math.log(p.tvl_usd) - 17) / 3;
  const x2 = x1 * x1;
  const rawGrowth = finite(p.change_7d, 0);
  const g = Math.min(120, Math.max(-60, rawGrowth)) / 100;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const x4 = (Math.log(age + 1) - 6) / 2;
  const x5 = Math.log(p.chains.length + 1) / 2;
  return [x1, x2, g, x4, x5];
}

/** The clamped 7-day growth this protocol's equation uses, in per cent. */
export function growthClamped(p: SnapshotProtocol): number {
  return Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
}

/** A protocol's full feature vector (no intercept), given the dummy categories. */
export function features(p: SnapshotProtocol, asOf: string, cats: string[]): number[] {
  const cont = continuousFeatures(p, asOf);
  for (const c of cats) cont.push(p.category === c ? 1 : 0);
  return cont;
}

/** A term's columns in the design matrix (column 0 is the intercept). */
export function termColumns(term: TermName, nCats: number): number[] {
  switch (term) {
    case 'logTVL':
      return [1];
    case 'logTVL^2':
      return [2];
    case 'growth':
      return [3];
    case 'logAge':
      return [4];
    case 'logChains':
      return [5];
    case 'category': {
      const out: number[] = [];
      for (let i = 0; i < nCats; i++) out.push(6 + i);
      return out;
    }
  }
}

// ------------------------------------------------------------------ ridge

/** A design matrix with an intercept column first. */
export function designMatrix(rows: number[][]): number[][] {
  return rows.map((r) => [1, ...r]);
}

/** Ridge fit: beta for (X'X + lambda D) beta = X'y, D unpenalised on the intercept. */
export function ridgeFit(x: number[][], y: number[], lambda: number): { beta: number[]; a: number[][] } {
  const p = x[0]!.length;
  const a = xtx(x);
  for (let i = 1; i < p; i++) a[i]![i]! += lambda;
  const beta = solve(a, xty(x, y));
  return { beta, a };
}

/** Leave-one-out predictions for a ridge fit, by the PRESS shortcut (exact for ridge). */
export function looPredictions(x: number[][], y: number[], lambda: number): { beta: number[]; looPred: number[]; looResid: number[]; r2: number } {
  const { beta, a } = ridgeFit(x, y, lambda);
  const aInv = invert(a);
  const pred = matVec(x, beta);
  const looPred: number[] = [];
  const looResid: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    let h = 0;
    for (let r = 0; r < xi.length; r++) {
      let s = 0;
      for (let c = 0; c < xi.length; c++) s += aInv[r]![c]! * xi[c]!;
      h += xi[r]! * s;
    }
    const resid = y[i]! - pred[i]!;
    looResid.push(resid / Math.max(1e-6, 1 - h));
    looPred.push(y[i]! - looResid[i]!);
  }
  let ssRes = 0;
  let ssTot = 0;
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  for (let i = 0; i < y.length; i++) {
    ssRes += (y[i]! - pred[i]!) ** 2;
    ssTot += (y[i]! - mean) ** 2;
  }
  return { beta, looPred, looResid, r2: 1 - ssRes / ssTot };
}

/** Median absolute percentage error of log-mcap predictions, in per cent. */
export function medianApePct(predLog: number[], actualMcap: number[]): number {
  const apes = predLog.map((lp, i) => Math.abs(Math.exp(lp) - actualMcap[i]!) / actualMcap[i]!);
  return median(apes) * 100;
}

/** The walk-forward split: train on the older half of dated comps, test on the newer half. */
export function walkForwardSplit(ages: (number | null)[]): { cutoff: number; train: number[]; test: number[] } {
  const dated = ages.map((a, i) => ({ a, i })).filter((d) => d.a !== null) as { a: number; i: number }[];
  const sorted = dated.map((d) => d.a).sort((a, b) => a - b);
  const cutoff = sorted[Math.floor(sorted.length / 2)]!;
  return {
    cutoff,
    train: dated.filter((d) => d.a > cutoff).map((d) => d.i),
    test: dated.filter((d) => d.a <= cutoff).map((d) => d.i),
  };
}

/** Walk-forward median APE: fit on the train rows, predict the test rows. */
export function walkForwardApePct(x: number[][], y: number[], mcaps: number[], train: number[], test: number[], lambda: number): number {
  const xTrain = train.map((i) => x[i]!);
  const yTrain = train.map((i) => y[i]!);
  const { beta } = ridgeFit(xTrain, yTrain, lambda);
  const pred = test.map((i) => dot(x[i]!, beta));
  const actual = test.map((i) => mcaps[i]!);
  return medianApePct(pred, actual);
}

/** The lambda that minimises leave-one-out median APE (ties go to the smaller lambda). */
export function tuneLambda(x: number[][], y: number[], mcaps: number[]): number {
  let best = LAMBDAS[0]!;
  let bestApe = Infinity;
  for (const lam of LAMBDAS) {
    const { looPred } = looPredictions(x, y, lam);
    const ape = medianApePct(looPred, mcaps);
    if (ape < bestApe) {
      bestApe = ape;
      best = lam;
    }
  }
  return best;
}

// ------------------------------------------------------------------ term selection

/** The traded protocols the model is fitted on: a market cap, and not an exchange. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX');
}

/** The dummy categories: those with at least eight comps, alphabetically. */
export function dummyCategories(comps: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of comps) {
    if (p.category === null) continue;
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 8)
    .map(([c]) => c)
    .sort();
}

export interface SelectionResult {
  cols: number[];
  lambda: number;
  rounds: SelectionRound[];
  alive: TermName[];
  dropped: TermName[];
}

/**
 * Keep or drop every value term on two blind tests. A term survives a round only
 * when removing it makes BOTH the leave-one-out and the walk-forward median APE
 * worse; the survivors are re-tuned and re-tested until a round drops nothing.
 */
export function selectTerms(snapshot: Snapshot, comps: SnapshotProtocol[], cats: string[]): SelectionResult {
  const xAll = designMatrix(comps.map((p) => features(p, snapshot.as_of, cats)));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const mcaps = comps.map((p) => p.mcap_usd!);
  const ages = comps.map((p) => ageDays(snapshot.as_of, p.listed_at));
  const split = walkForwardSplit(ages);
  const looApe = (cols: number[], lam: number): number => {
    const { looPred } = looPredictions(pickCols(xAll, cols), y, lam);
    return medianApePct(looPred, mcaps);
  };
  const wfApe = (cols: number[], lam: number): number => walkForwardApePct(pickCols(xAll, cols), y, mcaps, split.train, split.test, lam);

  let cols = xAll[0]!.map((_, i) => i);
  let lambda = tuneLambda(xAll, y, mcaps);
  let alive = [...TERMS] as TermName[];
  const rounds: SelectionRound[] = [];
  for (let round = 1; round <= 3; round++) {
    const fullLoo = looApe(cols, lambda);
    const fullWf = wfApe(cols, lambda);
    const tests: TermTest[] = [];
    const drop: TermName[] = [];
    for (const term of alive) {
      const gone = new Set(termColumns(term, cats.length));
      const keep = cols.filter((c) => !gone.has(c));
      const l = looApe(keep, lambda);
      const w = wfApe(keep, lambda);
      const verdict: 'KEEP' | 'DROP' = l > fullLoo && w > fullWf ? 'KEEP' : 'DROP';
      tests.push({ term, loo_without_pct: l, wf_without_pct: w, loo_full_pct: fullLoo, wf_full_pct: fullWf, verdict });
      if (verdict === 'DROP') drop.push(term);
    }
    rounds.push({ round, lambda, terms: tests });
    if (drop.length === 0) break;
    const gone = new Set(drop.flatMap((t) => termColumns(t, cats.length)));
    alive = alive.filter((t) => !drop.includes(t));
    cols = cols.filter((c) => !gone.has(c));
    lambda = tuneLambda(pickCols(xAll, cols), y, mcaps);
  }
  return { cols, lambda, rounds, alive, dropped: TERMS.filter((t) => !alive.includes(t)) };
}

/** A design matrix with only the given columns, in order. */
export function pickCols(x: number[][], cols: number[]): number[][] {
  return x.map((row) => cols.map((c) => row[c]!));
}

// ------------------------------------------------------------------ token odds

/** The Laplace prior's strength when a category's peer rate is smoothed. */
export const ODDS_ALPHA = 10;

/**
 * A pre-token protocol's chance of ever issuing a token, from its peers' record:
 * the share of mature peers in its own category (listed at least a year before
 * the snapshot) that record a token, Laplace-smoothed toward the global mature
 * rate. A category with fewer than three mature peers takes the global rate.
 * The snapshot records no token-issue dates, so no age adjustment is fitted;
 * that limit is stated on the dashboard.
 */
export function tokenOdds(p: SnapshotProtocol, snapshot: Snapshot): { odds: number; peers: number; categoryRate: number | null } {
  const mature = snapshot.protocols.filter((q) => {
    const a = ageDays(snapshot.as_of, q.listed_at);
    return a !== null && a >= 365;
  });
  const global = mature.filter(hasToken).length / mature.length;
  const clamp = (v: number): number => Math.min(0.95, Math.max(0.05, v));
  if (p.category === null) return { odds: clamp(global), peers: 0, categoryRate: null };
  const peers = mature.filter((q) => q.category === p.category);
  if (peers.length < 3) return { odds: clamp(global), peers: peers.length, categoryRate: null };
  const k = peers.filter(hasToken).length;
  return { odds: clamp((k + ODDS_ALPHA * global) / (peers.length + ODDS_ALPHA)), peers: peers.length, categoryRate: k / peers.length };
}

/** The global mature token rate, for the dashboard's odds table. */
export function globalOddsRate(snapshot: Snapshot): { rate: number; matureN: number; withToken: number } {
  const mature = snapshot.protocols.filter((q) => {
    const a = ageDays(snapshot.as_of, q.listed_at);
    return a !== null && a >= 365;
  });
  const withToken = mature.filter(hasToken).length;
  return { rate: withToken / mature.length, matureN: mature.length, withToken };
}

// ------------------------------------------------------------------ farmability

/** Categories that cannot be farmed for a new launch. */
export const NOFARM_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Stablecoin']);

/** Exchange names: a protocol whose name begins with one is an exchange product. */
export const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word that marks a wrapped, staked or stablecoin product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking|stablecoin)\b/i;

/** A stablecoin's ticker as a whole protocol name (USDD, USDT0, USDCx, DAI, FRAX, ...). */
const STABLE_TICKER = /^(usd[a-z0-9]{0,3}|dai|frax|gho|lusd|susd|usdp|tusd|busd|usdn|ust|eurt|eurc|crvusd|usde|usd0|usd1|usdb)$/i;

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Whether a protocol can be farmed for a new launch, and why not when it cannot.
 * The rule is stated on the dashboard; no protocol name is special-cased.
 */
export function farmable(p: SnapshotProtocol): { farmable: 0 | 1; reason: string } {
  if (p.category !== null && NOFARM_CATEGORIES.has(p.category)) {
    return { farmable: 0, reason: `category ${p.category} cannot be farmed for a new launch` };
  }
  if (STABLE_TICKER.test(p.name.trim())) {
    return { farmable: 0, reason: 'a stablecoin that already trades, not a new launch' };
  }
  if (WRAPPED_WORD.test(p.name)) {
    return { farmable: 0, reason: 'wrapped, staked or stablecoin product of a token that already trades' };
  }
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) {
    return { farmable: 0, reason: 'exchange product, not a farmable protocol launch' };
  }
  if (VERSIONED.test(p.name)) {
    return { farmable: 0, reason: 'versioned pool of another protocol' };
  }
  return { farmable: 1, reason: '' };
}

/** The farmability rule as the dashboard states it, in order. */
export const FARMABILITY_RULES = [
  'Farmable = 0 for exchanges (CEX) and bridges (Bridge, Canonical Bridge, Cross Chain Bridge): moving money is not a launch.',
  'Farmable = 0 for liquid staking, liquid restaking and restaked BTC: the receipt is a staked product of a token that already trades.',
  'Farmable = 0 for a protocol whose name is a stablecoin ticker (USDD, USDT0, USDCx, DAI, FRAX, ...) or carries the whole word wrapped, staked, staking or stablecoin.',
  'Farmable = 0 for a protocol whose name begins with an exchange name, or ends in a version marker (V2, v3, 2.0): a pool of another protocol.',
  'Everything else is farmable = 1. A farmable = 0 row stays on the board at the bottom with its reason, so the gate can be checked.',
];

// ------------------------------------------------------------------ conformal intervals

/** The conformal half-width in log space for one category, from leave-one-out residuals. */
export function conformalQuantile(looResidByCat: Map<string, number[]>, category: string | null, looResidAll: number[]): { q: number; n: number; source: 'category' | 'pooled' } {
  const level = 1 - CONFORMAL_ALPHA;
  const pick = (values: number[]): number => {
    const sorted = [...values].map(Math.abs).sort((a, b) => a - b);
    const k = Math.min(sorted.length, Math.ceil((sorted.length + 1) * level));
    return sorted[k - 1]!;
  };
  if (category !== null) {
    const values = looResidByCat.get(category) ?? [];
    if (values.length >= 8) return { q: pick(values), n: values.length, source: 'category' };
  }
  return { q: pick(looResidAll), n: looResidAll.length, source: 'pooled' };
}

// ------------------------------------------------------------------ farm steps

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('restak')) return `Deposit $${capital} into ${name} on ${chain} and keep the receipt.`;
  if (c.includes('staking') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('chain')) return `Use ${name} on ${chain} with $${capital} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan. A farmable protocol gets six concrete steps; a protocol
 * the gate marks not farmable gets three honest ones: why it cannot be farmed,
 * what to do instead, and where the capital goes. Every step carries its cost
 * and its time, and every step is derived from the protocol's own record.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, farm: 0 | 1, reason: string): FarmStep[] {
  if (farm === 0) {
    return [
      {
        text: `Do not farm ${p.name} for a new token: ${reason}. Its farmable expected value is $0, so the board shows it at $1.`,
        cost: 'nothing, because there is nothing to farm here',
        time: '2 minutes to read the reason',
      },
      {
        text: `If you already use ${p.name}, keep using it as normal: the protocol itself is sound, only the idea of farming it for a launch is wrong.`,
        cost: 'whatever you already spend using it',
        time: 'no extra time',
      },
      {
        text: `Put the same capital toward a FARM row at the top of this board instead: those are the farmable protocols, ranked by expected value.`,
        cost: 'the capital you would have spent here',
        time: '15 minutes to set up there',
      },
    ];
  }
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Open a fresh wallet for this farm only, fund it with exactly the capital below, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Come back once a week and do one qualifying action the protocol counts, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeat activity and not a single deposit.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `When the protocol opens a points or rewards page, check it from the protocol's own site or docs only; never pay a fee to claim, and never connect through a link from a chat or an ad.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log with the wallet, the dates, the amounts and every transaction hash, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ------------------------------------------------------------------ formatting

/** A number rounded to `places` decimals, without trailing zeros. */
export function fmtNum(n: number, places = 4): string {
  const r = Math.round(n * 10 ** places) / 10 ** places;
  return String(r);
}

/** Whole dollars with thousands separators. */
export function fmtUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ------------------------------------------------------------------ board

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The odds table: one row per category on the board, best odds first. */
function oddsTable(snapshot: Snapshot, categories: string[]): { category: string; odds: number; peers: number }[] {
  const dummy = (category: string): SnapshotProtocol => ({
    slug: '',
    name: '',
    category,
    chains: [],
    tvl_usd: 0,
    change_7d: null,
    mcap_usd: null,
    listed_at: null,
    gecko_id: null,
    symbol: null,
  });
  return categories
    .map((category) => {
      const { odds, peers } = tokenOdds(dummy(category), snapshot);
      return { category, odds, peers };
    })
    .sort((a, b) => b.odds - a.odds || (a.category < b.category ? -1 : 1));
}

/** The whole radar: the fitted model, the ranked board, the live set, the report. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const comps = compsOf(snapshot);
  const cats = dummyCategories(comps);
  const selection = selectTerms(snapshot, comps, cats);
  const xAll = designMatrix(comps.map((p) => features(p, snapshot.as_of, cats)));
  const y = comps.map((p) => Math.log(p.mcap_usd!));
  const mcaps = comps.map((p) => p.mcap_usd!);
  const xFinal = pickCols(xAll, selection.cols);
  const { beta, looPred, looResid, r2 } = looPredictions(xFinal, y, selection.lambda);
  const looApe = medianApePct(looPred, mcaps);
  const ages = comps.map((p) => ageDays(snapshot.as_of, p.listed_at));
  const split = walkForwardSplit(ages);
  const wfApe = walkForwardApePct(xFinal, y, mcaps, split.train, split.test, selection.lambda);
  const medMcap = median(mcaps);
  const baseApe = median(mcaps.map((m) => Math.abs(medMcap - m) / m)) * 100;

  // Conformal intervals from the leave-one-out residuals, per category.
  const looResidByCat = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const key = p.category ?? '';
    if (!looResidByCat.has(key)) looResidByCat.set(key, []);
    looResidByCat.get(key)!.push(looResid[i]!);
  });
  const conformalByCat = [...looResidByCat.keys()]
    .filter((c) => c !== '')
    .map((category) => {
      const { q, n, source } = conformalQuantile(looResidByCat, category, looResid);
      return { category, q, n, source };
    })
    .sort((a, b) => a.category < b.category ? -1 : 1);
  const pooled = conformalQuantile(looResidByCat, null, looResid);
  let inside = 0;
  comps.forEach((p, i) => {
    const { q } = conformalQuantile(looResidByCat, p.category, looResid);
    if (Math.abs(y[i]! - looPred[i]!) <= q) inside++;
  });

  // The fitted value's terms, for the per-row equation.
  const coefOf = (col: number): number => {
    const at = selection.cols.indexOf(col);
    return at === -1 ? 0 : beta[at]!;
  };
  const intercept = beta[0]!;
  const coefX1 = coefOf(1);
  const coefGrowth = coefOf(3);

  const pre = snapshot.protocols.filter(isPreToken);
  const scored = pre.map((p) => {
    const feats = features(p, snapshot.as_of, cats);
    const row = [1, ...feats].filter((_, i) => selection.cols.includes(i));
    const predLog = dot(row, beta);
    const fitted = Math.exp(predLog);
    const { odds, peers } = tokenOdds(p, snapshot);
    const { farmable: farm, reason } = farmable(p);
    const ev = fitted * odds * farm;
    const { q } = conformalQuantile(looResidByCat, p.category, looResid);
    const fittedLow = Math.exp(predLog - q);
    const fittedHigh = Math.exp(predLog + q);
    const implied = Math.max(1, Math.round(ev));
    const verdict: 'FARM' | 'THIN' | 'SKIP' = farm === 0 ? 'SKIP' : ev >= FARM_FLOOR_USD ? 'FARM' : ev >= THIN_FLOOR_USD ? 'THIN' : 'SKIP';
    const age = ageDays(snapshot.as_of, p.listed_at);
    const x1 = feats[0]!;
    const g = feats[2]!;
    // The equation, in the transformed features, with this row's inputs plugged in.
    const termLabel = (col: number): string => {
      if (col === 1) return 'x1';
      if (col === 2) return 'x1²';
      if (col === 3) return 'g';
      if (col === 4) return 'x4';
      if (col === 5) return 'x5';
      return `[${cats[col - 6]!}]`;
    };
    const terms: string[] = [fmtNum(intercept)];
    for (const col of selection.cols) {
      if (col === 0) continue;
      terms.push(`${fmtNum(coefOf(col))} × ${termLabel(col)}`);
    }
    const inputs: string[] = [];
    if (selection.cols.includes(1) || selection.cols.includes(2)) inputs.push(`x1 = (ln ${fmtUsd(p.tvl_usd)} − 17)/3 = ${fmtNum(x1, 3)}`);
    if (selection.cols.includes(3)) inputs.push(`g = ${fmtNum(growthClamped(p), 2)}%/100 = ${fmtNum(g, 3)}`);
    if (selection.cols.includes(4)) inputs.push(`x4 = (ln(${age ?? 365}+1) − 6)/2 = ${fmtNum(feats[3]!, 3)}`);
    if (selection.cols.includes(5)) inputs.push(`x5 = ln(${p.chains.length}+1)/2 = ${fmtNum(feats[4]!, 3)}`);
    for (const col of selection.cols) {
      if (col >= 6) inputs.push(`${termLabel(col)} = ${p.category === cats[col - 6] ? 1 : 0}`);
    }
    const equation =
      `ln fitted = ${terms.join(' + ').replace(/\+ -/g, '− ')} = ${fmtNum(predLog, 2)} ` +
      `(${inputs.join(', ')}) → fitted ${fmtUsd(fitted)} ` +
      `(80% interval ${fmtUsd(fittedLow)}–${fmtUsd(fittedHigh)}). ` +
      `EV = ${fmtUsd(fitted)} × ${fmtNum(odds, 2)} odds × ${farm} farmable = ${fmtUsd(ev)}.`;
    return {
      p,
      age,
      fitted,
      fittedLow,
      fittedHigh,
      odds,
      peers,
      farm,
      reason,
      ev,
      implied,
      verdict,
      equation,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    fitted_value_usd: Math.round(s.fitted),
    fitted_low_usd: Math.max(1, Math.round(s.fittedLow)),
    fitted_high_usd: Math.round(s.fittedHigh),
    token_odds: Math.round(s.odds * 10000) / 10000,
    farmable: s.farm,
    farmable_reason: s.reason,
    expected_value_usd: Math.round(s.ev),
    interval_low_usd: Math.max(1, Math.round(s.fittedLow * s.odds * s.farm)),
    interval_high_usd: Math.max(1, Math.round(s.fittedHigh * s.odds * s.farm)),
    verdict: s.verdict,
    model: {
      intercept: Math.round(intercept * 10000) / 10000,
      coef_log_tvl: Math.round(coefX1 * 10000) / 10000,
      coef_growth: Math.round(coefGrowth * 10000) / 10000,
      lambda: selection.lambda,
      log_tvl: Math.round(Math.log(s.p.tvl_usd) * 10000) / 10000,
      growth_clamped: Math.round((growthClamped(s.p) / 100) * 10000) / 10000,
      equation: s.equation,
    },
    farm_steps: farmSteps(s.p, s.age, s.farm, s.reason).map(stepText),
  }));

  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categories = [...new Set(board.map((r) => r.category).filter((c): c is string => c !== null))].sort();
  const global = globalOddsRate(snapshot);
  const validation: ValidationReport = {
    model_version: MODEL_VERSION,
    n_comps: comps.length,
    n_dated_comps: split.train.length + split.test.length,
    wf_cutoff_age_days: split.cutoff,
    wf_train_n: split.train.length,
    wf_test_n: split.test.length,
    lambda_grid: LAMBDAS,
    lambda: selection.lambda,
    surviving_terms: selection.alive,
    dropped_terms: selection.dropped,
    selection_rounds: selection.rounds,
    intercept: Math.round(intercept * 10000) / 10000,
    coef_log_tvl: Math.round(coefX1 * 10000) / 10000,
    coef_growth: Math.round(coefGrowth * 10000) / 10000,
    r2: Math.round(r2 * 1000) / 1000,
    loo_median_ape_pct: Math.round(looApe * 100) / 100,
    wf_median_ape_pct: Math.round(wfApe * 100) / 100,
    baseline_median_mcap_ape_pct: Math.round(baseApe * 100) / 100,
    ratio_vs_baseline_loo: Math.round((baseApe / looApe) * 100) / 100,
    ratio_vs_baseline_wf: Math.round((baseApe / wfApe) * 100) / 100,
    conformal_alpha: CONFORMAL_ALPHA,
    conformal_coverage_pct: Math.round((inside / comps.length) * 1000) / 10,
    conformal_pooled_q: Math.round(pooled.q * 1000) / 1000,
    conformal_by_category: conformalByCat.map((c) => ({ category: c.category, q: Math.round(c.q * 1000) / 1000, n: c.n, source: c.source })),
    odds_global_rate: Math.round(global.rate * 1000) / 1000,
    odds_mature_n: global.matureN,
    odds_alpha: ODDS_ALPHA,
    odds_by_category: oddsTable(snapshot, categories),
    farmability_rules: FARMABILITY_RULES,
    farmable_n: board.filter((r) => r.farmable === 1).length,
    not_farmable_n: board.filter((r) => r.farmable === 0).length,
    verdicts: {
      FARM: board.filter((r) => r.verdict === 'FARM').length,
      THIN: board.filter((r) => r.verdict === 'THIN').length,
      SKIP: board.filter((r) => r.verdict === 'SKIP').length,
    },
    watchlist_not_farmable: board.filter((r) => snapshot.watchlist.includes(r.slug) && r.farmable === 0).map((r) => r.slug),
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    validation,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      mcap_usd: r.mcap_usd,
      listed_at: r.listed_at,
      age_days: r.age_days,
      fitted_value_usd: r.fitted_value_usd,
      fitted_low_usd: r.fitted_low_usd,
      fitted_high_usd: r.fitted_high_usd,
      token_odds: r.token_odds,
      farmable: r.farmable,
      farmable_reason: r.farmable_reason,
      implied_value_usd: r.implied_value_usd,
      interval_low_usd: r.interval_low_usd,
      interval_high_usd: r.interval_high_usd,
      verdict: r.verdict,
      equation: r.model.equation,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

// ------------------------------------------------------------------ gate + parsing

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** The validation report as a readable JSON file for the dashboard directory. */
export function validationScript(report: ValidationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}



