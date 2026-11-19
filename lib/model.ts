// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.

import { join } from 'node:path';
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) AND every
// other protocol in the snapshot that passes the watchlist's own tests at any TVL: no token on
// record, not a wrapped, staked or bridged product of a token that already trades, not an exchange,
// not a versioned pool. 198 rows in this snapshot (40 watchlist + 158 below the floor).
// (no market cap, no CoinGecko id, no symbol) — the record says it records no token, never that it
// has none. Live-token protocols are kept apart and shown with the market's own values.
//
// Implied value follows only from the snapshot's own figures, in four factors:
//
//   multiple   = the category's own comparable: the MEDIAN market-cap / TVL of the live-token
//                protocols in the same category (at least 5 of them), else the median over all
//                live-token protocols. It is computed from this snapshot at run time, never typed
//                in: a category whose tokens trade richly against TVL is worth more per TVL
//                dollar than one whose tokens trade thinly. Clamped to [0.05, 1.00].
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent (one protocol grew 4,448% in 7 days; the cap
//                keeps a single week from deciding the board)
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//                Age is the time since DefiLlama first listed the protocol: the best record of how
//                long it has run with no token. Older, still tokenless, is more due a launch.
//   breadth    = 1 + 0.03 x min(chains - 1, 4)   (1.00 to 1.12: each extra chain is one more place
//                to farm the same protocol, capped so breadth never outruns TVL)
//   implied    = max(1, round(base x growthMult x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// recomputes each row from these same figures and checks the number board.json carries.

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

/** The model's constants, as the dashboard states them. The multiple is not a constant: it is the
 *  snapshot's own median market-cap / TVL, computed at run time (see comparables()). */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_sample: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 4,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
  min_category_sample: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

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
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so the page shows exactly what
 *  board.json carries instead of regenerating it. */
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
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  watch_slugs: string[];
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

/** The median of a sorted array (the middle value, or the mean of the middle two). */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables: for every category with at least `min_category_sample` live-token protocols,
 * the median market-cap / TVL of those protocols; plus the global median over all live-token
 * protocols, used where a category has too few live tokens to speak for itself. Computed from
 * the snapshot at run time — nothing about any category is typed in.
 */
export function comparables(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, number>; global: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.gecko_id === null || p.symbol === null) continue;
    if (p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = byCategory.get(p.category);
      if (list === undefined) byCategory.set(p.category, [ratio]);
      else list.push(ratio);
    }
  }
  const global = median(all.sort((a, b) => a - b));
  const out = new Map<string, number>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= model.min_category_sample) out.set(category, median(ratios.sort((a, b) => a - b)));
  }
  return { byCategory: out, global };
}

/** A protocol's base multiple: its category's comparable, else the global one, clamped. */
export function baseMultiple(p: SnapshotProtocol, comps: { byCategory: Map<string, number>; global: number }, model: ModelConstants): number {
  const raw = p.category !== null && comps.byCategory.has(p.category) ? comps.byCategory.get(p.category)! : comps.global;
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_per_chain;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades, not a
 *  protocol still waiting on a launch of its own — the watchlist rule's own list. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking in the name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol name must not begin with: the product belongs to the exchange. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 *  product of a token that already trades, not an exchange, not a versioned pool. The same tests
 *  the watchlist rule applies, minus its TVL floor: the board is every protocol the rule would
 *  keep, at any size. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comps = comparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar is not a top-N by TVL: it is EVERY other rankable pre-token protocol in the
  // snapshot, so a small protocol growing fast can outrank a big quiet one on implied value.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const multiple = baseMultiple(p, comps, model);
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(p, snapshot.as_of, model, multiple);
    return { p, multiple, implied, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    model: {
      // The exact multiple, unrounded: the dashboard recomputes this row from it, and a rounded
      // copy would drift the recomputation away from the board's own number.
      base_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it, so both sides of the position are on record.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain}, in the pair it lists first, and keep the position in range.`;
  if (c.includes('leveraged farm') || c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares instead of rotating them.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside the destination app instead of bridging straight back.`;
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade, then close it the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name} on ${chain}, then settle or close it before the market resolves.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('onchain capital')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares while the curator reallocates them.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet that minted it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full qualifying window.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the whole window.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} across at least two separate transactions in different weeks.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it instead of trading in and out.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name} on ${chain} and vote once in a live proposal with the same wallet.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s main farm on ${chain} and claim the farm's own rewards weekly.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The second-week action: a different chain when the protocol runs on more than one, else a
 *  repeat of the core action so the wallet shows activity in a second week. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    return `Repeat the same position on ${second} with $${Math.max(25, Math.round(capital / 2))} so the wallet is active on a second chain, not only on ${chain}.`;
  }
  return `In the second week, add another $${Math.max(25, Math.round(capital / 2))} to the same position or make one more qualifying action, so the wallet shows activity in two separate weeks.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Costs are the capital tier plus gas; times are the minutes or days each step takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(2, Math.round(gas / 2))} of gas`,
      time: '10 minutes in week 2',
    },
    {
      text: `Make one qualifying action each week — a deposit, a borrow, a swap or a vote — and never leave the wallet untouched for a whole month.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then unwind gradually instead of withdrawing everything in one transaction.`,
      cost: 'nothing but the log',
      time: '5 minutes to log, 10 minutes to unwind',
    },
  ];
}

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
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const comps = comparables(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(comps.global),
    watch_slugs: [...snapshot.watchlist].sort(),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
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

/** Why a board's own rows are not usable, or null: every row carries a slug and a name, a finite
 *  positive implied value and multiple, at least one farm step of usable length, and a slug the
 *  snapshot itself records. boardIssue checks coverage, ranks and order; this checks the numbers
 *  and steps the rows themselves carry, so a board the model misbuilt is refused before it is
 *  written. */
export function assertBoardUsable(board: BoardRow[], snapshot: Snapshot): string | null {
  if (!Array.isArray(board) || board.length === 0) return 'board is not a non-empty array';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (typeof row.slug !== 'string' || row.slug.length === 0) return 'a row has no slug';
    if (typeof row.name !== 'string' || row.name.length === 0) return `${row.slug} has no name`;
    if (typeof row.implied_value_usd !== 'number' || !Number.isFinite(row.implied_value_usd)) return `${row.slug} has no finite implied value`;
    if (row.implied_value_usd <= 0) return `${row.slug} has an implied value of ${row.implied_value_usd}`;
    const multiple = row.model.base_multiple;
    if (typeof multiple !== 'number' || !Number.isFinite(multiple)) return `${row.slug} has no finite multiple`;
    if (multiple <= 0) return `${row.slug} has a multiple of ${multiple}`;
    if (typeof row.tvl_usd !== 'number' || !Number.isFinite(row.tvl_usd) || row.tvl_usd < 0) return `${row.slug} has no usable tvl_usd`;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 1) return `${row.slug} has no farm steps`;
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${typeof step === 'string' ? step.length : 0} characters`;
    }
    if (!known.has(row.slug)) return `${row.slug} is not in the snapshot`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * Whether the parsed snapshot is one the model can score, as a short reason
 * when it is not, or null when it is usable. This is a shape check only: the
 * field-by-field parsing already happened in parseSnapshot, so this guards the
 * few things the run itself depends on — a non-empty protocol list, a watchlist
 * array, a usable as-of date, and a numeric TVL with a string slug on every row.
 * A snapshot that passes here still has to survive the model's own scoring.
 */
export function assertSnapshotUsable(snapshot: Snapshot): string | null {
  if (typeof snapshot.as_of !== 'string' || snapshot.as_of.trim().length === 0) {
    return 'as_of is not a non-empty string';
  }
  if (!Array.isArray(snapshot.protocols) || snapshot.protocols.length === 0) {
    return 'protocols is not a non-empty array';
  }
  if (!Array.isArray(snapshot.watchlist)) {
    return 'watchlist is not an array';
  }
  for (const p of snapshot.protocols) {
    if (typeof p.slug !== 'string' || p.slug.length === 0) {
      return 'a protocol has no slug';
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      return `${p.slug} has no usable tvl_usd`;
    }
  }
  return null;
}

/**
 * The run's two stdout lines: how many protocols the snapshot held, how many
 * rows the model scored, and what the run wrote, with the output paths joined
 * the same way main.ts joins them. The first line counts the snapshot and the
 * board; the second names every file the run produced, with the dashboard and
 * screenshot counts in parentheses, so a reader can see at a glance that the
 * board, the data, the page, the images and the dossier all landed.
 */
export function summarizeRun(
  snapshot: Snapshot,
  board: BoardRow[],
  radar: RadarData,
  shots: string[],
  dashboardFiles: string[],
  out: string,
): string[] {
  const first =
    `token radar: ${snapshot.protocols.length} protocols, ` +
    `${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`;
  const second =
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ` +
    `${join(out, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}`;
  return [first, second];
}
