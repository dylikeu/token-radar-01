// Token-launch radar, v3: a fitted comps model, not a hand-tuned multiple.
//
// The board ranks every protocol in the snapshot that records no token at all
// (market cap, CoinGecko id and symbol all null): 342 rows. The value of each
// row is fitted, at run time, from the snapshot's own traded protocols:
// fitCompsCurve regresses log market cap on log TVL, seven-day growth, age
// since listing and a category effect, with a small ridge penalty, and
// validateCompsFit reports how that fit does on protocols it did not train
// on. Nothing here names a protocol: the same fitted curve scores every row.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
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

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this radar can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
/** The ridge penalty on the comps fit's slopes: small, it only steadies the noisy terms. */
const RIDGE_LAMBDA = 3;
/** A category earns its own dummy in the fit once this many traded comps carry it. */
const CATEGORY_MIN_COMPS = 5;
/** The z value for a central 80% interval: P10 to P90. */
const P90_Z = 1.2816;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to the snapshot date; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** True when the record carries no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the record carries a token a market already prices. */
export function recordsTradedToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

// ------------------------------------------------------------------ linear algebra

/** Solve `matrix * x = rhs` by Gaussian elimination with partial pivoting. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row) => [...row]);
  const b = [...rhs];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) throw new SnapshotError('comps fit: singular design matrix');
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Ridge regression: beta = (X'X + lambda * I*)^-1 X'y, intercept unpenalised. */
export function ridgeFit(design: number[][], target: number[], lambda: number): number[] {
  const k = design[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i]!;
    for (let a = 0; a < k; a++) {
      xty[a]! += row[a]! * target[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let a = 1; a < k; a++) xtx[a]![a]! += lambda;
  return solveLinear(xtx, xty);
}

// ------------------------------------------------------------------ the comps fit

/** One fitted comps curve, with everything the dashboard states about it. */
export interface CompsFit {
  /** Coefficient per design column, in the order designRow builds them. */
  beta: number[];
  /** Mean log TVL of the traded comps: the centring point of the log-TVL terms. */
  logTvlCentre: number;
  /** Categories that earned their own dummy, in design order. */
  dummyCategories: string[];
  /** Traded protocols the fit trained on. */
  comps: number;
  /** Residual standard deviation of log market cap on the training comps. */
  sigma: number;
  /** R-squared of the fit on its training comps. */
  rSquared: number;
  /** The design's column names, for the dashboard's fit panel. */
  columns: string[];
}

/** The design row of one protocol under a fit's columns. */
export function designRow(p: SnapshotProtocol, asOf: string, logTvlCentre: number, dummyCategories: string[]): number[] {
  const logTvl = Math.log(Math.max(1, p.tvl_usd)) - logTvlCentre;
  const growth = clamp(finite(p.change_7d, 0), -60, 120) / 100;
  const age = ageDays(asOf, p.listed_at);
  const logAge = Math.log1p((age ?? 365) / 365);
  const row: number[] = [1, logTvl, logTvl * logTvl, growth, logAge];
  for (const c of dummyCategories) row.push((p.category ?? 'None') === c ? 1 : 0);
  return row;
}

/** Which categories earn a dummy: the ones with at least CATEGORY_MIN_COMPS traded comps. */
function dummyCategoriesFor(comps: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of comps) counts.set(p.category ?? 'None', (counts.get(p.category ?? 'None') ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= CATEGORY_MIN_COMPS)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([c]) => c);
}

/**
 * Fit the comps curve on the snapshot's own traded protocols: log market cap
 * on centred log TVL, its square, clamped seven-day growth, log age since
 * listing, and one dummy per frequent category. No multiple is hand-picked:
 * every coefficient comes out of this regression.
 */
export function fitCompsCurve(snapshot: Snapshot, comps?: SnapshotProtocol[]): CompsFit {
  const traded = (comps ?? snapshot.protocols.filter(recordsTradedToken)).slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (traded.length < 20) throw new SnapshotError(`comps fit: only ${traded.length} traded protocols to learn from`);
  const logTvlCentre = traded.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / traded.length;
  const dummies = dummyCategoriesFor(traded);
  const design = traded.map((p) => designRow(p, snapshot.as_of, logTvlCentre, dummies));
  const target = traded.map((p) => Math.log(p.mcap_usd!));
  const beta = ridgeFit(design, target, RIDGE_LAMBDA);
  let ssRes = 0;
  let ssTot = 0;
  const mean = target.reduce((s, v) => s + v, 0) / target.length;
  for (let i = 0; i < traded.length; i++) {
    const pred = design[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
    ssRes += (target[i]! - pred) ** 2;
    ssTot += (target[i]! - mean) ** 2;
  }
  const k = beta.length;
  const sigma = Math.sqrt(ssRes / Math.max(1, traded.length - k));
  return {
    beta,
    logTvlCentre,
    dummyCategories: dummies,
    comps: traded.length,
    sigma,
    rSquared: 1 - ssRes / ssTot,
    columns: ['intercept', 'log_tvl', 'log_tvl_sq', 'growth_7d', 'log_age', ...dummies.map((c) => `cat_${c}`)],
  };
}

/** A fitted value for one protocol: point estimate and its P10-P90 range, all in dollars. */
export interface FittedValue {
  implied: number;
  p10: number;
  p90: number;
  /** The log-scale contributions, so the detail view can show the factor breakdown. */
  parts: { tvl: number; growth: number; age: number; category: number; intercept: number };
}

/**
 * The implied value of one protocol under a fitted comps curve: exp of the
 * fitted log market cap, with a P10-P90 range from the fit's residual spread.
 */
export function impliedValueFromComps(fit: CompsFit, p: SnapshotProtocol, asOf: string): FittedValue {
  const row = designRow(p, asOf, fit.logTvlCentre, fit.dummyCategories);
  const b = fit.beta;
  const parts = {
    intercept: b[0]!,
    tvl: b[1]! * row[1]! + b[2]! * row[2]!,
    growth: b[3]! * row[3]!,
    age: b[4]! * row[4]!,
    category: row.slice(5).reduce((s, v, j) => s + v * b[5 + j]!, 0),
  };
  const logValue = parts.intercept + parts.tvl + parts.growth + parts.age + parts.category;
  const implied = Math.max(1, Math.round(Math.exp(logValue)));
  const p10 = Math.max(1, Math.round(Math.exp(logValue - P90_Z * fit.sigma)));
  const p90 = Math.max(implied + 1, Math.round(Math.exp(logValue + P90_Z * fit.sigma)));
  return { implied, p10, p90, parts };
}

// ------------------------------------------------------------------ validation

/** How the fit does on protocols it did not train on. */
export interface FitValidation {
  /** Median absolute percentage error on the held-out fifth of traded comps. */
  heldOutMedianApe: number;
  /** Mean absolute percentage error on that held-out fifth. */
  heldOutMeanApe: number;
  /** How many traded comps the held-out set holds. */
  heldOutN: number;
  /** Median absolute percentage error under leave-one-out refits. */
  looMedianApe: number;
  /** Mean absolute percentage error under leave-one-out refits. */
  looMeanApe: number;
  /** How the split was made, so the number can be reproduced. */
  splitRule: string;
}

/**
 * Validate a comps fit two ways, both deterministic: a held-out split (every
 * fifth traded protocol by slug) and leave-one-out refits over all comps.
 * Each error is |predicted mcap - actual mcap| / actual mcap.
 */
export function validateCompsFit(snapshot: Snapshot): FitValidation {
  const traded = snapshot.protocols.filter(recordsTradedToken).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const testIdx = new Set(traded.map((_, i) => i).filter((i) => i % 5 === 0));
  const train = traded.filter((_, i) => !testIdx.has(i));
  const test = traded.filter((_, i) => testIdx.has(i));
  const trainFit = fitCompsCurve(snapshot, train);
  const heldErrors = test.map((p) => {
    const pred = impliedValueFromComps(trainFit, p, snapshot.as_of).implied;
    return Math.abs(pred - p.mcap_usd!) / p.mcap_usd!;
  });
  const looErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const rest = traded.filter((_, j) => j !== i);
    const fit = fitCompsCurve(snapshot, rest);
    const pred = impliedValueFromComps(fit, traded[i]!, snapshot.as_of).implied;
    looErrors.push(Math.abs(pred - traded[i]!.mcap_usd!) / traded[i]!.mcap_usd!);
  }
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  const mean = (xs: number[]): number => xs.reduce((a, v) => a + v, 0) / xs.length;
  return {
    heldOutMedianApe: round4(median(heldErrors)),
    heldOutMeanApe: round4(mean(heldErrors)),
    heldOutN: test.length,
    looMedianApe: round4(median(looErrors)),
    looMeanApe: round4(mean(looErrors)),
    splitRule: 'held out every 5th traded protocol by slug (20%); leave-one-out refits all comps',
  };
}

// ------------------------------------------------------------------ token odds by age

/** One age bucket's empirical token rate. */
export interface OddsBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  protocols: number;
  withToken: number;
  odds: number;
}

/**
 * The empirical odds a protocol has issued a token, by months since it was
 * first listed: among all snapshot protocols in each age bucket, the share
 * that records a token (anything but all three token fields null). A
 * protocol with no listing date gets the bucket of the unlisted.
 */
export function tokenOddsByAge(snapshot: Snapshot): { buckets: OddsBucket[]; overall: number } {
  const defs: { label: string; minDays: number; maxDays: number | null }[] = [
    { label: 'under 6 months', minDays: 0, maxDays: 180 },
    { label: '6-12 months', minDays: 180, maxDays: 365 },
    { label: '1-2 years', minDays: 365, maxDays: 730 },
    { label: '2-4 years', minDays: 730, maxDays: 1460 },
    { label: 'over 4 years', minDays: 1460, maxDays: null },
  ];
  const buckets: OddsBucket[] = defs.map((d) => ({ ...d, protocols: 0, withToken: 0, odds: 0 }));
  let unknownN = 0;
  let unknownWith = 0;
  let totalWith = 0;
  for (const p of snapshot.protocols) {
    const has = !recordsNoToken(p);
    if (has) totalWith++;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null) {
      unknownN++;
      if (has) unknownWith++;
      continue;
    }
    const bucket = buckets.find((b) => age >= b.minDays && (b.maxDays === null || age < b.maxDays));
    if (bucket === undefined) continue;
    bucket.protocols++;
    if (has) bucket.withToken++;
  }
  for (const b of buckets) b.odds = b.protocols > 0 ? round4(b.withToken / b.protocols) : 0;
  buckets.push({
    label: 'listing date unknown',
    minDays: -1,
    maxDays: null,
    protocols: unknownN,
    withToken: unknownWith,
    odds: unknownN > 0 ? round4(unknownWith / unknownN) : 0,
  });
  return { buckets, overall: round4(totalWith / snapshot.protocols.length) };
}

/** The token-issuance odds for one protocol's age, from the fitted buckets. */
export function oddsForAge(buckets: OddsBucket[], age: number | null, overall: number): number {
  if (age === null) {
    const unknown = buckets.find((b) => b.minDays === -1);
    return unknown !== undefined && unknown.protocols > 0 ? unknown.odds : overall;
  }
  const bucket = buckets.find((b) => b.minDays >= 0 && age >= b.minDays && (b.maxDays === null || age < b.maxDays));
  return bucket !== undefined && bucket.protocols > 0 ? bucket.odds : overall;
}

// ------------------------------------------------------------------ farm plans

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  implied_p10_usd: number;
  implied_p90_usd: number;
  token_odds: number;
  expected_value_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_cost_usd: number;
  farm_days: number;
  model: { tvl: number; growth: number; age: number; category: number; intercept: number };
  farm_steps: string[];
}

/** A live-token protocol, shown as the market's own value, never modelled. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot and the fit. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  protocols_total: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  fit: { beta: number[]; columns: string[]; log_tvl_centre: number; comps: number; sigma: number; r_squared: number };
  validation: FitValidation;
  odds_buckets: OddsBucket[];
  odds_overall: number;
  verdict_rule: string;
  rows: BoardRow[];
  live: LiveRow[];
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** The capital one farm position needs, from the protocol's own TVL tier. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main on-chain action for a category, in the farmer's own words. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow a small amount against it so the position reads as active lending and borrowing`;
  if (c.includes('dex') || c.includes('amm')) return `Provide $${capital} of liquidity to ${n}'s largest pool on ${chain} and keep the LP position open`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} through ${n} on ${chain} and hold the liquid staking receipt in the same wallet`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside the ${n} app so the trip is not a bare transfer`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position`;
  if (c.includes('yield aggregator') || c.includes('leveraged farm') || c === 'yield' || c.includes('farm')) return `Deposit $${capital} into ${n}'s highest-TVL vault on ${chain} and keep the vault shares`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${n} curated vault on ${chain} and keep the vault shares for the whole window`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet`;
  if (c.includes('prediction')) return `Fund ${n} with $${capital} on ${chain} and take one position in its most liquid market`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy live for the whole window`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it`;
  if (c === 'cex') return `Deposit $${capital} of USDC on ${n} and place one spot trade, keeping the trade history on the same account`;
  if (c === 'chain') return `Bridge $${capital} of USDC to ${n} on its own chain and use it in ${n}'s flagship app`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open`;
}

/** A second, different qualifying action for the same category. */
function secondaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay part of the ${n} borrow, then supply another $${Math.round(capital / 2)} of a second asset on ${chain} so the wallet shows two supplied markets`;
  if (c.includes('dex') || c.includes('amm')) return `Swap $${Math.round(capital / 2)} through ${n} on ${chain} in two trades on different days, keeping the LP position untouched`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Restake the ${n} receipt once more on ${chain} if the app offers a restake or delegate step, and vote in any ${n} governance poll that is open`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${n} after a week, so the wallet shows two-way use of the ${n} bridge`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Close the first ${n} hedge, then open a second small position in the opposite direction on ${chain} to keep a trading pattern`;
  if (c.includes('yield aggregator') || c.includes('leveraged farm') || c === 'yield' || c.includes('farm')) return `Harvest any ${n} vault yield on ${chain} once, then redeposit it into the same ${n} vault instead of withdrawing`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Move $${Math.round(capital / 2)} into a second ${n} vault on ${chain} so the wallet holds two different ${n} vault shares`;
  if (c.includes('rwa')) return `Top up the ${n} position with another $${Math.round(capital / 2)} on ${chain} and check the ${n} yield accrual page to confirm the holding is counted`;
  if (c.includes('prediction')) return `Settle the first ${n} market, then fund a second market on ${chain} with $${Math.round(capital / 2)}`;
  if (c.includes('insurance')) return `File a test read of the ${n} cover terms on ${chain} and extend the policy by a month if the app allows it`;
  if (c.includes('stable')) return `Swap half the ${n} stable holding into a second asset and back on ${chain} to show usage beyond a single mint`;
  if (c === 'cex') return `Place a second ${n} spot trade in a different pair and enable any ${n} rewards or points page the account shows`;
  if (c === 'chain') return `Use the bridged funds in a second ${n} app on the chain, such as its DEX or lending market, within the same week`;
  return `Swap $${Math.round(capital / 2)} through ${n} on ${chain} and interact with one more ${n} feature beyond the first deposit`;
}

/** A step as one string: action, cost and time, inside the gate's 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the ${text} position open and check it weekly.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, every one derived from that
 * protocol's own record (name, category, chains, TVL tier, age, 7d growth).
 * The protocol's name appears in every step, so no two rows share a step.
 */
export function buildFarmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; costUsd: number; days: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const growth = finite(p.change_7d, 0);
  const urgency =
    growth >= 25
      ? ` ${p.name}'s TVL is up ${growth.toFixed(1)}% in a week, so start this week while the growth is fresh.`
      : growth <= -25
        ? ` ${p.name}'s TVL is down ${Math.abs(growth).toFixed(1)}% in a week, so start small and add only after a calm week.`
        : '';
  const extraChain = p.chains.length > 1 ? ` ${p.name} also runs on ${p.chains[1]}, so keep all activity on ${chain} where the position is counted.` : '';
  const gas = capital >= 150 ? 8 : 4;
  const steps = [
    stepText(
      `Open a fresh wallet for ${p.name} only, fund it with $${capital + gas * 3} on ${chain}, and keep its seed phrase offline.${extraChain}`,
      `$${capital + gas * 3} moved in, about $${gas} of gas`,
      '10 minutes to set up',
    ),
    stepText(`${primaryAction(p, capital, chain)}.${urgency}`, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText(
      `${secondaryAction(p, capital, chain)}.`,
      `about $${Math.round(capital / 2)} moved and about $${gas} of gas`,
      '15 minutes, on a different day',
    ),
    stepText(
      `Do one qualifying ${p.name} action each week, such as a deposit, a swap, a borrow or a vote on ${chain}, and never let two weeks pass with no ${p.name} activity.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the ${p.name} position for at least ${hold} days so the activity is counted in more than one snapshot, and do not withdraw early even if ${p.name} announces a points campaign mid-window.`,
      `the $${capital} stays in the ${p.name} position`,
      `${hold} days`,
    ),
    stepText(
      `Before you withdraw from ${p.name}, open its own points or rewards page from the link ${p.name} itself publishes and claim only there, never through a link from a chat or a search ad.`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ),
    stepText(
      `Write the ${p.name} wallet, the dates and every transaction in a farm log, then unwind in reverse: claim first, close the ${p.name} position, and move the funds back to one wallet.`,
      'nothing but the log',
      '10 minutes to unwind',
    ),
  ];
  return { steps, costUsd: capital + gas * 3 + 2 * Math.ceil(hold / 7), days: hold };
}

// ------------------------------------------------------------------ the board

/** The verdict rule, stated on the dashboard: expected value is implied value times token odds. */
export const VERDICT_RULE =
  'FARM when implied value x token odds is at least $15,000,000; THIN when it is at least $3,000,000; otherwise SKIP.';

/** A verdict from the expected value under the stated rule. */
export function verdictFor(expectedUsd: number): 'FARM' | 'THIN' | 'SKIP' {
  if (expectedUsd >= 15_000_000) return 'FARM';
  if (expectedUsd >= 3_000_000) return 'THIN';
  return 'SKIP';
}

/**
 * Build the whole board: fit the comps curve, price every protocol that
 * records no token, attach its token odds and its farm plan, and rank by
 * implied value. The watchlist is inside the 342 by construction.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitCompsCurve(snapshot);
  const validation = validateCompsFit(snapshot);
  const odds = tokenOddsByAge(snapshot);
  const watch = new Set(snapshot.watchlist);
  const scored: BoardRow[] = snapshot.protocols
    .filter(recordsNoToken)
    .map((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      const value = impliedValueFromComps(fit, p, snapshot.as_of);
      const tokenOdds = oddsForAge(odds.buckets, age, odds.overall);
      const expected = Math.round(value.implied * tokenOdds);
      const plan = buildFarmPlan(p, age);
      return {
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_days: age,
        watchlist: watch.has(p.slug),
        implied_value_usd: value.implied,
        implied_p10_usd: value.p10,
        implied_p90_usd: value.p90,
        token_odds: tokenOdds,
        expected_value_usd: expected,
        verdict: verdictFor(expected),
        farm_cost_usd: plan.costUsd,
        farm_days: plan.days,
        model: {
          tvl: round4(value.parts.tvl),
          growth: round4(value.parts.growth),
          age: round4(value.parts.age),
          category: round4(value.parts.category),
          intercept: round4(value.parts.intercept),
        },
        farm_steps: plan.steps,
      };
    });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
    }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-3-fitted-comps',
    protocols_total: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: scored.length,
    live_size: live.length,
    fit: {
      beta: fit.beta.map(round4),
      columns: fit.columns,
      log_tvl_centre: round4(fit.logTvlCentre),
      comps: fit.comps,
      sigma: round4(fit.sigma),
      r_squared: round4(fit.rSquared),
    },
    validation,
    odds_buckets: odds.buckets,
    odds_overall: odds.overall,
    verdict_rule: VERDICT_RULE,
    rows: scored,
    live,
  };
  return { board: scored, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the radar scores. */
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
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
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's data as one script: `window.RADAR = {...};`, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
