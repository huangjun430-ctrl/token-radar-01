// Token Radar (radar-4): calibrated pre-token valuation + snapshot launch propensity + farming verdicts.
//
// Builds strictly from the sealed snapshot with zero randomness, zero wall-clock timestamps,
// and zero per-protocol special-casing:
//   1. Value model: 7-model bake-off on non-CEX mcap-bearing live protocols with [P5, P95]
//      winsorization, evaluated on 5-fold CV (winner selection), walk-forward, and LOO, plus
//      an ablation table including an extra odds-augmented variant and 5-fold rank ranges.
//   2. Uncertainty band: residual-based low = implied / (1 + model_mape/100),
//      high = implied * (1 + model_mape/100), using category MAPE whenever measured.
//   3. Launch odds model: deterministic IRLS logistic regression on all snapshot protocols
//      predicting P(has token in snapshot) — a snapshot launch propensity (lower bound on
//      true launch probability), validated by AUC/Brier across 5-fold, walk-forward, and LOO
//      plus a 5-fold quintile calibration table.
//   4. Farming economics: numeric gas-only cost and effort hours per 6-step plan, risk-adjusted
//      value (implied * odds), $/hr at default $5,000 deposit, and data-derived verdict thresholds.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_min_count: number;
  category_fit_min_count: number;
  default_deposit_usd: number;
  airdrop_pool_share: number;
  farming_deposit_tvl_share: number;
  opp_cost_apr: number;
  horizon_days: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_min_count: 3,
  category_fit_min_count: 10,
  default_deposit_usd: 5000,
  airdrop_pool_share: 0.05,
  farming_deposit_tvl_share: 0.20,
  opp_cost_apr: 0.05,
  horizon_days: 90,
};

export const MODEL_VERSION = 'radar-4';
export const FOLD_SCHEME = '5-fold cross-validation, sorted by slug, fold = index mod 5';

export type CandidateName =
  | 'median'
  | 'ols-global'
  | 'ols-category'
  | 'ols-global-chains'
  | 'ols-category-chains'
  | 'binned-median'
  | 'ols-quad';

export type Verdict = 'FARM NOW' | 'SELECTIVE' | 'THIN' | 'SKIP';

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
  cost_usd: number;
  hours: number;
}

export interface FarmStepDetail {
  text: string;
  cost_usd: number;
  hours: number;
}

export interface BakeoffEntry {
  name: CandidateName;
  label: string;
  params: number;
  mape: number;
  wf_mape: number;
  loo_mape: number;
  winner: boolean;
}

export interface AblationEntry {
  name: string;
  params: number;
  mape: number;
  kept: boolean;
  note: string;
}

export interface WalkForwardMeta {
  split_date: string | null;
  train_count: number;
  test_count: number;
}

export interface OddsCoefficients {
  intercept: number;
  log_tvl: number;
  log_age: number;
  chg_7d: number;
  n_chains: number;
  cat_launch_rate: number;
}

export interface OddsSplitMetric {
  auc: number;
  brier: number;
  base_brier: number;
}

export interface OddsCalibrationBin {
  bin: number;
  count: number;
  min_odds: number;
  max_odds: number;
  mean_predicted: number;
  actual_rate: number;
}

export interface OddsModelSummary {
  sample_size: number;
  token_count: number;
  pre_token_count: number;
  global_rate: number;
  converged: boolean;
  iterations: number;
  ridge: number;
  coefficients: OddsCoefficients;
  cv5: OddsSplitMetric;
  walk_forward: OddsSplitMetric & WalkForwardMeta;
  loo: OddsSplitMetric;
  calibration_bins: OddsCalibrationBin[];
}

export interface VerdictSummary {
  default_deposit_usd: number;
  t1_farm_now: number;
  t2_selective: number;
  counts: Record<Verdict, number>;
}

export interface FittedCoefficients {
  model: CandidateName;
  global?: Record<string, number>;
  categories?: Record<string, Record<string, number>>;
  quartiles?: { cuts: number[]; medians: number[] };
}

export interface CalibrationSummary {
  fold_scheme: string;
  live_sample_size: number;
  winner: CandidateName;
  winner_mape: number;
  median_mape: number;
  beats_median: boolean;
  walk_forward: WalkForwardMeta;
  bakeoff: BakeoffEntry[];
  ablation: AblationEntry[];
  category_mape: Record<string, number>;
  coefficients: FittedCoefficients;
  odds_coefficients: OddsCoefficients;
  odds_model: OddsModelSummary;
  verdicts: VerdictSummary;
  farm_unpriced_steps: Array<{ slug: string; step: number }>;
}

export interface ExclusionAudit {
  total_pre_token: number;
  ranked: number;
  excluded_total: number;
  wrapped_category: number;
  versioned_name: number;
  wrapped_word: number;
  exchange_name: number;
}

export interface BoardRow {
  rank: number;
  rank_min: number;
  rank_max: number;
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
  implied_low_usd: number;
  implied_high_usd: number;
  launch_odds: number;
  risk_adj_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  expected_airdrop_usd: number;
  net_usd: number;
  farm_per_hour_usd: number;
  verdict: Verdict;
  model: {
    method: 'fit' | 'median';
    winsorized: boolean;
    winner: CandidateName;
    fit_scope: string;
    fitted_multiple: number;
    peer_multiple: number;
    category_median_multiple: number | null;
    global_median_multiple: number;
    peer_count: number;
    peer_category: string;
    peer_p5: number;
    peer_p25: number;
    peer_p75: number;
    peer_p95: number;
    model_mape: number;
    model_mape_scope: 'category' | 'global';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    age_estimated: boolean;
    no_7d_data: boolean;
    global_fit: boolean;
  };
  farm_steps: string[];
  farm_step_details: FarmStepDetail[];
}

export interface RadarRow {
  rank: number;
  rank_min: number;
  rank_max: number;
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
  implied_low_usd: number;
  implied_high_usd: number;
  launch_odds: number;
  risk_adj_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  expected_airdrop_usd: number;
  net_usd: number;
  farm_per_hour_usd: number;
  verdict: Verdict;
  method: 'fit' | 'median';
  winsorized: boolean;
  fit_scope: string;
  fitted_multiple: number;
  peer_multiple: number;
  category_median_multiple: number | null;
  global_median_multiple: number;
  peer_count: number;
  peer_category: string;
  peer_p5: number;
  peer_p25: number;
  peer_p75: number;
  peer_p95: number;
  model_mape: number;
  model_mape_scope: 'category' | 'global';
  growth_multiplier: number;
  maturity_multiplier: number;
  age_estimated: boolean;
  no_7d_data: boolean;
  global_fit: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
  cv_predicted_mcap_usd: number | null;
}

export interface PeerTable {
  [category: string]: { multiple: number; p5: number; p25: number; p75: number; p95: number; count: number };
}

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
  global_p25: number;
  global_p75: number;
  peers: PeerTable;
  calibration: CalibrationSummary;
  exclusions: ExclusionAudit;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantileOf(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Solve k x k linear system A * x = b via Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }
    if (!Number.isFinite(maxAbs) || maxAbs < 1e-12) return null;
    if (pivotRow !== col) {
      const tmp = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmp;
    }
    const piv = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = M[r]![col]! / piv;
      for (let c = col; c <= n; c++) M[r]![c] = M[r]![c]! - factor * M[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= M[r]![c]! * x[c]!;
    const v = sum / M[r]![r]!;
    if (!Number.isFinite(v)) return null;
    x[r] = v;
  }
  return x;
}

/** Median ISO listing date among records with a non-null listed_at. */
function medianListingDate(items: ReadonlyArray<{ listed_at: string | null }>): string | null {
  const dates = items.map((x) => x.listed_at).filter((d): d is string => d !== null).sort(byCodeUnit);
  if (dates.length < 2) return null;
  return dates[Math.floor((dates.length - 1) / 2)]!;
}

// ---------------------------------------------------------------- Rankability & exclusions

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function exclusionReason(p: SnapshotProtocol): 'wrapped_category' | 'versioned_name' | 'wrapped_word' | 'exchange_name' | null {
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) return 'wrapped_category';
  if (VERSIONED.test(p.name)) return 'versioned_name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_word';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange_name';
  return null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

// ---------------------------------------------------------------- Launch Odds Model (IRLS logistic regression)

interface OddsRow {
  slug: string;
  category: string;
  listed_at: string | null;
  y: number;
  logTvl: number;
  logAge: number;
  chg7d: number;
  nChains: number;
}

const CAT_LAUNCH_MIN = 5;

function buildOddsRows(snapshot: Snapshot, model: ModelConstants): OddsRow[] {
  return snapshot.protocols
    .map((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at) ?? model.unknown_age_days;
      return {
        slug: p.slug,
        category: p.category ?? 'Uncategorised',
        listed_at: p.listed_at,
        y: isPreToken(p) ? 0 : 1,
        logTvl: Math.log10(Math.max(p.tvl_usd, 1)),
        logAge: Math.log10(Math.max(age, 1)),
        chg7d: p.change_7d !== null ? p.change_7d / 100 : 0,
        nChains: p.chains.length,
      };
    })
    .sort((a, b) => byCodeUnit(a.slug, b.slug));
}

function catLaunchStats(rows: OddsRow[]): { globalRate: number; byCat: Map<string, { pos: number; total: number }> } {
  const byCat = new Map<string, { pos: number; total: number }>();
  let pos = 0;
  for (const r of rows) {
    pos += r.y;
    const cur = byCat.get(r.category);
    if (cur) {
      cur.pos += r.y;
      cur.total += 1;
    } else {
      byCat.set(r.category, { pos: r.y, total: 1 });
    }
  }
  return { globalRate: rows.length > 0 ? pos / rows.length : 0.5, byCat };
}

function catRateOf(cat: string, stats: { globalRate: number; byCat: Map<string, { pos: number; total: number }> }): number {
  const s = stats.byCat.get(cat);
  return s !== undefined && s.total >= CAT_LAUNCH_MIN ? s.pos / s.total : stats.globalRate;
}

function oddsFeatureVec(r: OddsRow, catRate: number): number[] {
  return [1, r.logTvl, r.logAge, r.chg7d, r.nChains, catRate];
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

function clipOdds(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

interface LogisticFitResult {
  beta: number[];
  converged: boolean;
  iterations: number;
  ridge: number;
}

function runIrls(X: number[][], y: number[], ridge: number, startBeta?: number[]): LogisticFitResult | null {
  const n = X.length;
  const k = 6;
  let pos = 0;
  for (let i = 0; i < n; i++) pos += y[i]!;
  const p0 = Math.min(1 - 1e-6, Math.max(1e-6, pos / Math.max(1, n)));
  const beta = startBeta ? startBeta.slice() : [Math.log(p0 / (1 - p0)), 0, 0, 0, 0, 0];

  const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const g = new Array<number>(k).fill(0);
  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= 100; iter++) {
    for (let r = 0; r < k; r++) {
      g[r] = 0;
      for (let c = 0; c < k; c++) H[r]![c] = 0;
    }
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let eta = 0;
      for (let j = 0; j < k; j++) eta += beta[j]! * xi[j]!;
      const mu = sigmoid(eta);
      const w = Math.max(mu * (1 - mu), 1e-12);
      const diff = y[i]! - mu;
      for (let j = 0; j < k; j++) {
        const xij = xi[j]!;
        g[j] = g[j]! + xij * diff;
        const wxij = w * xij;
        for (let c = j; c < k; c++) H[j]![c] = H[j]![c]! + wxij * xi[c]!;
      }
    }
    for (let j = 0; j < k; j++) {
      for (let c = 0; c < j; c++) H[j]![c] = H[c]![j]!;
      if (j > 0 && ridge > 0) {
        H[j]![j] = H[j]![j]! + ridge;
        g[j] = g[j]! - ridge * beta[j]!;
      }
    }

    const delta = solveLinear(H, g);
    if (delta === null) return null;

    let maxDelta = 0;
    for (let j = 0; j < k; j++) maxDelta = Math.max(maxDelta, Math.abs(delta[j]!));
    const scale = maxDelta > 10 ? 10 / maxDelta : 1;
    for (let j = 0; j < k; j++) beta[j] = beta[j]! + delta[j]! * scale;
    if (maxDelta < 1e-8) {
      converged = true;
      break;
    }
  }

  return { beta, converged, iterations: Math.min(iter, 100), ridge };
}

function fitLogistic(X: number[][], y: number[], startBeta?: number[]): LogisticFitResult {
  const unpenalized = runIrls(X, y, 0, startBeta);
  if (unpenalized !== null && unpenalized.beta.every((b) => Number.isFinite(b) && Math.abs(b) < 50)) {
    return unpenalized;
  }
  const ridged = runIrls(X, y, 1.0);
  if (ridged !== null) return ridged;
  let pos = 0;
  for (const yi of y) pos += yi;
  const p0 = Math.min(0.99, Math.max(0.01, pos / Math.max(1, y.length)));
  return { beta: [Math.log(p0 / (1 - p0)), 0, 0, 0, 0, 0], converged: false, iterations: 100, ridge: 1.0 };
}

function predictOdds(beta: number[], x: number[]): number {
  let eta = 0;
  for (let j = 0; j < beta.length; j++) eta += beta[j]! * x[j]!;
  return clipOdds(sigmoid(eta));
}

/** Exact deterministic ROC AUC via Mann-Whitney rank sum (average ranks for ties). */
function computeAuc(pairs: ReadonlyArray<{ pred: number; y: number }>): number {
  let nPos = 0;
  let nNeg = 0;
  for (const p of pairs) {
    if (p.y === 1) nPos++;
    else nNeg++;
  }
  if (nPos === 0 || nNeg === 0) return 0.5;
  const sorted = pairs.map((p, idx) => ({ ...p, idx })).sort((a, b) => a.pred - b.pred || a.idx - b.idx);
  let rankSumPos = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.pred === sorted[i]!.pred) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (sorted[k]!.y === 1) rankSumPos += avgRank;
    i = j + 1;
  }
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function computeSplitOddsMetrics(pairs: ReadonlyArray<{ pred: number; y: number }>, baseRate: number): OddsSplitMetric {
  if (pairs.length === 0) return { auc: 0.5, brier: 0.25, base_brier: 0.25 };
  let brierSum = 0;
  let baseSum = 0;
  for (const p of pairs) {
    brierSum += (p.pred - p.y) * (p.pred - p.y);
    baseSum += (baseRate - p.y) * (baseRate - p.y);
  }
  return {
    auc: round4(computeAuc(pairs)),
    brier: round4(brierSum / pairs.length),
    base_brier: round4(baseSum / pairs.length),
  };
}

function runOddsModel(
  snapshot: Snapshot,
  model: ModelConstants,
): {
  summary: OddsModelSummary;
  fullOddsBySlug: Map<string, number>;
  cvOddsBySlug: Map<string, number>;
} {
  const rows = buildOddsRows(snapshot, model);
  const n = rows.length;
  const fullStats = catLaunchStats(rows);
  const fullX = rows.map((r) => oddsFeatureVec(r, catRateOf(r.category, fullStats)));
  const fullY = rows.map((r) => r.y);
  const fullFit = fitLogistic(fullX, fullY);

  const fullOddsBySlug = new Map<string, number>();
  for (let i = 0; i < n; i++) fullOddsBySlug.set(rows[i]!.slug, round4(predictOdds(fullFit.beta, fullX[i]!)));

  // 1. 5-fold CV (slug-sorted, index mod 5)
  const cvPairs: Array<{ slug: string; pred: number; y: number }> = [];
  const cvOddsBySlug = new Map<string, number>();
  for (let f = 0; f < 5; f++) {
    const train: OddsRow[] = [];
    const test: OddsRow[] = [];
    for (let i = 0; i < n; i++) {
      if (i % 5 === f) test.push(rows[i]!);
      else train.push(rows[i]!);
    }
    if (test.length === 0) continue;
    const st = catLaunchStats(train);
    const fit = fitLogistic(
      train.map((r) => oddsFeatureVec(r, catRateOf(r.category, st))),
      train.map((r) => r.y),
    );
    for (const r of test) {
      const pred = predictOdds(fit.beta, oddsFeatureVec(r, catRateOf(r.category, st)));
      cvPairs.push({ slug: r.slug, pred, y: r.y });
      cvOddsBySlug.set(r.slug, pred);
    }
  }
  const cv5 = computeSplitOddsMetrics(cvPairs, fullStats.globalRate);

  // 5-fold quintile calibration table
  const sortedCv = cvPairs.slice().sort((a, b) => a.pred - b.pred || byCodeUnit(a.slug, b.slug));
  const calibrationBins: OddsCalibrationBin[] = [];
  for (let b = 0; b < 5; b++) {
    const loIdx = Math.floor((b * sortedCv.length) / 5);
    const hiIdx = Math.floor(((b + 1) * sortedCv.length) / 5);
    const slice = sortedCv.slice(loIdx, hiIdx);
    if (slice.length === 0) continue;
    let sumPred = 0;
    let sumY = 0;
    for (const item of slice) {
      sumPred += item.pred;
      sumY += item.y;
    }
    calibrationBins.push({
      bin: b + 1,
      count: slice.length,
      min_odds: round4(slice[0]!.pred),
      max_odds: round4(slice[slice.length - 1]!.pred),
      mean_predicted: round4(sumPred / slice.length),
      actual_rate: round4(sumY / slice.length),
    });
  }

  // 2. Walk-forward (median listing date; missing listed_at -> TRAIN)
  const splitDate = medianListingDate(rows);
  const wfTrain: OddsRow[] = [];
  const wfTest: OddsRow[] = [];
  for (const r of rows) {
    if (splitDate === null || r.listed_at === null || r.listed_at <= splitDate) wfTrain.push(r);
    else wfTest.push(r);
  }
  const wfStats = catLaunchStats(wfTrain);
  const wfFit = fitLogistic(
    wfTrain.map((r) => oddsFeatureVec(r, catRateOf(r.category, wfStats))),
    wfTrain.map((r) => r.y),
  );
  const wfPairs = wfTest.map((r) => ({ pred: predictOdds(wfFit.beta, oddsFeatureVec(r, catRateOf(r.category, wfStats))), y: r.y }));
  const wfMetrics = computeSplitOddsMetrics(wfPairs, wfStats.globalRate);

  // 3. Leave-one-out across all n protocols (strictly deterministic, exact LOO cat_launch_rate)
  const looPairs: Array<{ pred: number; y: number }> = [];
  let totalPos = 0;
  for (const r of rows) totalPos += r.y;
  for (let leave = 0; leave < n; leave++) {
    const left = rows[leave]!;
    const looGlobal = (totalPos - left.y) / Math.max(1, n - 1);
    const rateFor = (cat: string): number => {
      const s = fullStats.byCat.get(cat);
      if (!s) return looGlobal;
      const tot = s.total - (cat === left.category ? 1 : 0);
      const pos = s.pos - (cat === left.category ? left.y : 0);
      return tot >= CAT_LAUNCH_MIN ? pos / tot : looGlobal;
    };
    const trainX: number[][] = [];
    const trainY: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i === leave) continue;
      const r = rows[i]!;
      trainX.push(oddsFeatureVec(r, rateFor(r.category)));
      trainY.push(r.y);
    }
    const fit = fitLogistic(trainX, trainY, fullFit.ridge === 0 ? fullFit.beta : undefined);
    looPairs.push({ pred: predictOdds(fit.beta, oddsFeatureVec(left, rateFor(left.category))), y: left.y });
  }
  const loo = computeSplitOddsMetrics(looPairs, fullStats.globalRate);

  const b = fullFit.beta;
  const coefficients: OddsCoefficients = {
    intercept: b[0]!,
    log_tvl: b[1]!,
    log_age: b[2]!,
    chg_7d: b[3]!,
    n_chains: b[4]!,
    cat_launch_rate: b[5]!,
  };

  return {
    summary: {
      sample_size: n,
      token_count: totalPos,
      pre_token_count: n - totalPos,
      global_rate: round4(fullStats.globalRate),
      converged: fullFit.converged,
      iterations: fullFit.iterations,
      ridge: fullFit.ridge,
      coefficients,
      cv5,
      walk_forward: {
        split_date: splitDate,
        train_count: wfTrain.length,
        test_count: wfTest.length,
        ...wfMetrics,
      },
      loo,
      calibration_bins: calibrationBins,
    },
    fullOddsBySlug,
    cvOddsBySlug,
  };
}

// ---------------------------------------------------------------- Peer pricing & OLS value models

interface PeerPricingResult {
  peers: PeerTable;
  global: number;
  globalP5: number;
  globalP25: number;
  globalP75: number;
  globalP95: number;
  globalCount: number;
  allRatios: number[];
  ratiosByCategory: Map<string, number[]>;
}

interface LiveSample {
  slug: string;
  category: string;
  listed_at: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  logTvl: number;
  logMcap: number;
  logChains: number;
  odds: number;
}

function toLiveSamples(protocols: SnapshotProtocol[], oddsMap: Map<string, number>): LiveSample[] {
  const out: LiveSample[] = [];
  for (const p of protocols) {
    if (p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    out.push({
      slug: p.slug,
      category: p.category ?? 'Uncategorised',
      listed_at: p.listed_at,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      ratio,
      logTvl: Math.log(p.tvl_usd),
      logMcap: Math.log(p.mcap_usd),
      logChains: Math.log(Math.max(1, p.chains.length)),
      odds: oddsMap.get(p.slug) ?? 0.5,
    });
  }
  out.sort((a, b) => byCodeUnit(a.slug, b.slug));
  return out;
}

function peerPricingFromSamples(samples: LiveSample[], minCount: number): PeerPricingResult {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const s of samples) {
    all.push(s.ratio);
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s.ratio);
  }
  all.sort((a, b) => a - b);
  const global = medianOf(all) ?? 0.25;
  const globalP5 = quantileOf(all, 0.05) ?? global;
  const globalP25 = quantileOf(all, 0.25) ?? global;
  const globalP75 = quantileOf(all, 0.75) ?? global;
  const globalP95 = quantileOf(all, 0.95) ?? global;
  const peers: PeerTable = {};
  for (const [key, ratios] of byCategory) {
    ratios.sort((a, b) => a - b);
    const med = medianOf(ratios);
    if (med !== null && ratios.length >= minCount) {
      peers[key] = {
        multiple: med,
        p5: quantileOf(ratios, 0.05) ?? med,
        p25: quantileOf(ratios, 0.25) ?? med,
        p75: quantileOf(ratios, 0.75) ?? med,
        p95: quantileOf(ratios, 0.95) ?? med,
        count: ratios.length,
      };
    }
  }
  return { peers, global, globalP5, globalP25, globalP75, globalP95, globalCount: all.length, allRatios: all, ratiosByCategory: byCategory };
}

export function peerMultipleFor(
  category: string | null,
  pricing: PeerPricingResult,
): { multiple: number; p5: number; p25: number; p75: number; p95: number; count: number; category: string; categoryMedian: number | null } {
  const key = category ?? 'Uncategorised';
  const own = pricing.peers[key];
  if (own !== undefined) {
    return { multiple: own.multiple, p5: own.p5, p25: own.p25, p75: own.p75, p95: own.p95, count: own.count, category: key, categoryMedian: own.multiple };
  }
  return {
    multiple: pricing.global,
    p5: pricing.globalP5,
    p25: pricing.globalP25,
    p75: pricing.globalP75,
    p95: pricing.globalP95,
    count: pricing.globalCount,
    category: 'all live-token protocols',
    categoryMedian: null,
  };
}

interface Ols1Fit { a: number; b: number; n: number }
interface Ols2Fit { a: number; b: number; c: number; n: number }
interface OlsQuadFit { a: number; b: number; d: number; n: number }

function fitOls1(samples: LiveSample[]): Ols1Fit | null {
  const n = samples.length;
  if (n < 2) return null;
  let meanX = 0, meanY = 0;
  for (const s of samples) { meanX += s.logTvl; meanY += s.logMcap; }
  meanX /= n; meanY /= n;
  let sxx = 0, sxy = 0;
  for (const s of samples) {
    const dx = s.logTvl - meanX;
    sxx += dx * dx;
    sxy += dx * (s.logMcap - meanY);
  }
  if (!Number.isFinite(sxx) || sxx < 1e-12) return null;
  const b = sxy / sxx;
  const a = meanY - b * meanX;
  return Number.isFinite(a) && Number.isFinite(b) ? { a, b, n } : null;
}

function fitOls2Feature(samples: LiveSample[], getZ: (s: LiveSample) => number): Ols2Fit | null {
  const n = samples.length;
  if (n < 4) return null;
  let meanX = 0, meanZ = 0, meanY = 0;
  for (const s of samples) { meanX += s.logTvl; meanZ += getZ(s); meanY += s.logMcap; }
  meanX /= n; meanZ /= n; meanY /= n;
  let sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const s of samples) {
    const dx = s.logTvl - meanX, dz = getZ(s) - meanZ, dy = s.logMcap - meanY;
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxy += dx * dy; szy += dz * dy;
  }
  if (sxx < 1e-12) return null;
  if (szz < 1e-12) {
    const b = sxy / sxx, a = meanY - b * meanX;
    return Number.isFinite(a) && Number.isFinite(b) ? { a, b, c: 0, n } : null;
  }
  const sol = solveLinear([[sxx, sxz], [sxz, szz]], [sxy, szy]);
  if (sol === null) return null;
  const [b, c] = [sol[0]!, sol[1]!];
  const a = meanY - b * meanX - c * meanZ;
  return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) ? { a, b, c, n } : null;
}

function fitOlsQuad(samples: LiveSample[]): OlsQuadFit | null {
  const n = samples.length;
  if (n < 4) return null;
  let meanX = 0;
  for (const s of samples) meanX += s.logTvl;
  meanX /= n;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (const s of samples) {
    const u = s.logTvl - meanX, u2 = u * u;
    s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
    y0 += s.logMcap; y1 += u * s.logMcap; y2 += u2 * s.logMcap;
  }
  if (s2 < 1e-12) return null;
  const sol = solveLinear([[n, s1, s2], [s1, s2, s3], [s2, s3, s4]], [y0, y1, y2]);
  if (sol === null) return null;
  const [c0, c1, c2] = [sol[0]!, sol[1]!, sol[2]!];
  const d = c2, b = c1 - 2 * c2 * meanX, a = c0 - c1 * meanX + c2 * meanX * meanX;
  return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(d) ? { a, b, d, n } : null;
}

interface ModelPrediction {
  multiple: number;
  method: 'fit' | 'median';
  scope: string;
  winsorized: boolean;
}

interface FittedCandidate {
  name: CandidateName;
  predict: (category: string | null, tvlUsd: number, chainCount: number) => ModelPrediction;
  coefficients: FittedCoefficients;
  params: number;
}

const CANDIDATE_SPECS: ReadonlyArray<{ name: CandidateName; label: string; order: number }> = [
  { name: 'median', label: 'Category / global median (radar-2 baseline)', order: 0 },
  { name: 'ols-global', label: 'OLS global: log(mcap) = a + b·log(TVL)', order: 1 },
  { name: 'ols-category', label: 'OLS per-category (≥10 peers, else global)', order: 2 },
  { name: 'ols-global-chains', label: 'OLS global + chains: a + b·log(TVL) + c·log(chains)', order: 3 },
  { name: 'ols-category-chains', label: 'OLS per-category + chains (≥10 peers, else global)', order: 4 },
  { name: 'binned-median', label: 'Binned TVL-quartile median mcap/TVL', order: 5 },
  { name: 'ols-quad', label: 'OLS quadratic: a + b·log(TVL) + d·log(TVL)²', order: 6 },
];

function groupByCategory(samples: LiveSample[]): Map<string, LiveSample[]> {
  const m = new Map<string, LiveSample[]>();
  for (const s of samples) {
    if (!m.has(s.category)) m.set(s.category, []);
    m.get(s.category)!.push(s);
  }
  return m;
}

function fitCandidate(name: CandidateName, train: LiveSample[], model: ModelConstants): FittedCandidate {
  const pricing = peerPricingFromSamples(train, model.peer_min_count);
  const medianFallback = (category: string | null): ModelPrediction => {
    const peer = peerMultipleFor(category, pricing);
    return { multiple: peer.multiple, method: 'median', scope: peer.category, winsorized: false };
  };
  const winsorize = (category: string | null, rawMult: number, scope: string): ModelPrediction => {
    if (!Number.isFinite(rawMult) || rawMult <= 0) return medianFallback(category);
    const peer = peerMultipleFor(category, pricing);
    let clamped = rawMult;
    let winsorized = false;
    if (clamped < peer.p5) { clamped = peer.p5; winsorized = true; }
    else if (clamped > peer.p95) { clamped = peer.p95; winsorized = true; }
    return { multiple: clamped, method: 'fit', scope, winsorized };
  };

  if (name === 'median') {
    return { name, params: 1, predict: (category) => medianFallback(category), coefficients: { model: 'median', global: { median_multiple: round4(pricing.global) } } };
  }
  if (name === 'ols-global') {
    const g = fitOls1(train);
    return {
      name, params: 2,
      predict: (category, tvlUsd) => (g === null || tvlUsd <= 0 ? medianFallback(category) : winsorize(category, Math.exp(g.a + (g.b - 1) * Math.log(tvlUsd)), 'global')),
      coefficients: { model: 'ols-global', global: g ? { a: round4(g.a), b: round4(g.b) } : undefined },
    };
  }
  if (name === 'ols-category') {
    const g = fitOls1(train);
    const byCat = groupByCategory(train);
    const catFits = new Map<string, Ols1Fit>();
    const catCoeffs: Record<string, Record<string, number>> = {};
    for (const [cat, rows] of [...byCat.entries()].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      if (rows.length >= model.category_fit_min_count) {
        const f = fitOls1(rows);
        if (f !== null) { catFits.set(cat, f); catCoeffs[cat] = { a: round4(f.a), b: round4(f.b), n: f.n }; }
      }
    }
    return {
      name, params: 2 * (1 + catFits.size),
      predict: (category, tvlUsd) => {
        if (tvlUsd <= 0) return medianFallback(category);
        const key = category ?? 'Uncategorised';
        const cf = catFits.get(key);
        const fit = cf ?? g;
        return fit === null ? medianFallback(category) : winsorize(category, Math.exp(fit.a + (fit.b - 1) * Math.log(tvlUsd)), cf ? key : 'global');
      },
      coefficients: { model: 'ols-category', global: g ? { a: round4(g.a), b: round4(g.b) } : undefined, categories: catCoeffs },
    };
  }
  if (name === 'ols-global-chains') {
    const g = fitOls2Feature(train, (s) => s.logChains);
    return {
      name, params: 3,
      predict: (category, tvlUsd, chainCount) => (g === null || tvlUsd <= 0 ? medianFallback(category) : winsorize(category, Math.exp(g.a + (g.b - 1) * Math.log(tvlUsd) + g.c * Math.log(Math.max(1, chainCount))), 'global')),
      coefficients: { model: 'ols-global-chains', global: g ? { a: round4(g.a), b: round4(g.b), c: round4(g.c) } : undefined },
    };
  }
  if (name === 'ols-category-chains') {
    const g = fitOls2Feature(train, (s) => s.logChains);
    const byCat = groupByCategory(train);
    const catFits = new Map<string, Ols2Fit>();
    const catCoeffs: Record<string, Record<string, number>> = {};
    for (const [cat, rows] of [...byCat.entries()].sort((a, b) => byCodeUnit(a[0], b[0]))) {
      if (rows.length >= model.category_fit_min_count) {
        const f = fitOls2Feature(rows, (s) => s.logChains);
        if (f !== null) { catFits.set(cat, f); catCoeffs[cat] = { a: round4(f.a), b: round4(f.b), c: round4(f.c), n: f.n }; }
      }
    }
    return {
      name, params: 3 * (1 + catFits.size),
      predict: (category, tvlUsd, chainCount) => {
        if (tvlUsd <= 0) return medianFallback(category);
        const key = category ?? 'Uncategorised';
        const cf = catFits.get(key);
        const fit = cf ?? g;
        return fit === null ? medianFallback(category) : winsorize(category, Math.exp(fit.a + (fit.b - 1) * Math.log(tvlUsd) + fit.c * Math.log(Math.max(1, chainCount))), cf ? key : 'global');
      },
      coefficients: { model: 'ols-category-chains', global: g ? { a: round4(g.a), b: round4(g.b), c: round4(g.c) } : undefined, categories: catCoeffs },
    };
  }
  if (name === 'binned-median') {
    const tvls = train.map((s) => s.tvl_usd).sort((a, b) => a - b);
    const q1 = quantileOf(tvls, 0.25) ?? 0, q2 = quantileOf(tvls, 0.5) ?? q1, q3 = quantileOf(tvls, 0.75) ?? q2;
    const bins: number[][] = [[], [], [], []];
    for (const s of train) bins[s.tvl_usd <= q1 ? 0 : s.tvl_usd <= q2 ? 1 : s.tvl_usd <= q3 ? 2 : 3]!.push(s.ratio);
    const binMedians = bins.map((b) => { b.sort((x, y) => x - y); return medianOf(b) ?? pricing.global; });
    return {
      name, params: 4,
      predict: (category, tvlUsd) => (tvlUsd <= 0 || train.length < 4 ? medianFallback(category) : winsorize(category, binMedians[tvlUsd <= q1 ? 0 : tvlUsd <= q2 ? 1 : tvlUsd <= q3 ? 2 : 3]!, 'global')),
      coefficients: { model: 'binned-median', quartiles: { cuts: [Math.round(q1), Math.round(q2), Math.round(q3)], medians: binMedians.map(round4) } },
    };
  }
  const g = fitOlsQuad(train);
  return {
    name: 'ols-quad', params: 3,
    predict: (category, tvlUsd) => {
      if (g === null || tvlUsd <= 0) return medianFallback(category);
      const lx = Math.log(tvlUsd);
      return winsorize(category, Math.exp(g.a + (g.b - 1) * lx + g.d * lx * lx), 'global');
    },
    coefficients: { model: 'ols-quad', global: g ? { a: round4(g.a), b: round4(g.b), d: round4(g.d) } : undefined },
  };
}

/** Evaluate 5-fold CV for the extra v6 ablation variant: log(mcap) = a + b*log(TVL) + c*launch_odds. */
function evaluateOddsAugmentedAblation(samples: LiveSample[], model: ModelConstants): number {
  const apes: number[] = [];
  for (let f = 0; f < 5; f++) {
    const train: LiveSample[] = [];
    const test: LiveSample[] = [];
    for (let i = 0; i < samples.length; i++) {
      if (i % 5 === f) test.push(samples[i]!);
      else train.push(samples[i]!);
    }
    if (test.length === 0) continue;
    const pricing = peerPricingFromSamples(train, model.peer_min_count);
    const fit = fitOls2Feature(train, (s) => s.odds);
    for (const p of test) {
      const peer = peerMultipleFor(p.category, pricing);
      let mult = peer.multiple;
      if (fit !== null) {
        const raw = Math.exp(fit.a + (fit.b - 1) * p.logTvl + fit.c * p.odds);
        if (Number.isFinite(raw) && raw > 0) mult = Math.min(peer.p95, Math.max(peer.p5, raw));
      }
      const ape = (Math.abs(p.tvl_usd * mult - p.mcap_usd) / p.mcap_usd) * 100;
      if (Number.isFinite(ape)) apes.push(ape);
    }
  }
  apes.sort((a, b) => a - b);
  return round2(medianOf(apes) ?? 100);
}

/** 3-way validation bake-off (5-fold CV, walk-forward, LOO) + ablation table + 5 fold-fitted winners. */
function runBakeoff(samples: LiveSample[], model: ModelConstants) {
  const folds = 5;
  const fullFits = new Map<CandidateName, FittedCandidate>();
  const splitDate = medianListingDate(samples);
  const wfTrain: LiveSample[] = [];
  const wfTest: LiveSample[] = [];
  for (const s of samples) {
    if (splitDate === null || s.listed_at === null || s.listed_at <= splitDate) wfTrain.push(s);
    else wfTest.push(s);
  }

  const rawResults: Array<{
    name: CandidateName;
    label: string;
    order: number;
    params: number;
    mape: number;
    wfMape: number;
    looMape: number;
    cvPreds: Map<string, number>;
    catApes: Map<string, number[]>;
    foldFits: FittedCandidate[];
  }> = [];

  for (const spec of CANDIDATE_SPECS) {
    const full = fitCandidate(spec.name, samples, model);
    fullFits.set(spec.name, full);

    // 1. 5-fold CV
    const apes: number[] = [];
    const cvPreds = new Map<string, number>();
    const catApes = new Map<string, number[]>();
    const foldFits: FittedCandidate[] = [];
    for (let f = 0; f < folds; f++) {
      const train: LiveSample[] = [];
      const test: LiveSample[] = [];
      for (let i = 0; i < samples.length; i++) {
        if (i % folds === f) test.push(samples[i]!);
        else train.push(samples[i]!);
      }
      const fitted = fitCandidate(spec.name, train, model);
      foldFits.push(fitted);
      for (const p of test) {
        const pred = fitted.predict(p.category, p.tvl_usd, Math.round(Math.exp(p.logChains)));
        const predMcap = p.tvl_usd * pred.multiple;
        const ape = (Math.abs(predMcap - p.mcap_usd) / p.mcap_usd) * 100;
        if (Number.isFinite(ape)) {
          apes.push(ape);
          cvPreds.set(p.slug, predMcap);
          if (!catApes.has(p.category)) catApes.set(p.category, []);
          catApes.get(p.category)!.push(ape);
        }
      }
    }
    apes.sort((a, b) => a - b);
    const mape = medianOf(apes) ?? 100;

    // 2. Walk-forward
    const wfApes: number[] = [];
    if (wfTrain.length >= 2 && wfTest.length > 0) {
      const wfFit = fitCandidate(spec.name, wfTrain, model);
      for (const p of wfTest) {
        const pred = wfFit.predict(p.category, p.tvl_usd, Math.round(Math.exp(p.logChains)));
        const ape = (Math.abs(p.tvl_usd * pred.multiple - p.mcap_usd) / p.mcap_usd) * 100;
        if (Number.isFinite(ape)) wfApes.push(ape);
      }
    }
    wfApes.sort((a, b) => a - b);
    const wfMape = medianOf(wfApes) ?? mape;

    // 3. Leave-one-out (all live samples, no subsampling)
    const looApes: number[] = [];
    for (let leave = 0; leave < samples.length; leave++) {
      const train: LiveSample[] = [];
      for (let i = 0; i < samples.length; i++) if (i !== leave) train.push(samples[i]!);
      const p = samples[leave]!;
      const looFit = fitCandidate(spec.name, train, model);
      const pred = looFit.predict(p.category, p.tvl_usd, Math.round(Math.exp(p.logChains)));
      const ape = (Math.abs(p.tvl_usd * pred.multiple - p.mcap_usd) / p.mcap_usd) * 100;
      if (Number.isFinite(ape)) looApes.push(ape);
    }
    looApes.sort((a, b) => a - b);
    const looMape = medianOf(looApes) ?? mape;

    rawResults.push({ name: spec.name, label: spec.label, order: spec.order, params: full.params, mape, wfMape, looMape, cvPreds, catApes, foldFits });
  }

  const bestMape = Math.min(...rawResults.map((r) => r.mape));
  const withinOne = rawResults.filter((r) => r.mape <= bestMape + 1.0);
  withinOne.sort((a, b) => a.params - b.params || a.order - b.order);
  const chosen = withinOne[0]!;
  const medianEntry = rawResults.find((r) => r.name === 'median')!;

  const categoryMape: Record<string, number> = {};
  for (const [cat, errs] of [...chosen.catApes.entries()].sort((a, b) => byCodeUnit(a[0], b[0]))) {
    if (errs.length >= model.peer_min_count) {
      const sorted = errs.slice().sort((a, b) => a - b);
      const med = medianOf(sorted);
      if (med !== null) categoryMape[cat] = round2(med);
    }
  }

  const bakeoff: BakeoffEntry[] = rawResults.map((r) => ({
    name: r.name,
    label: r.label,
    params: r.params,
    mape: round2(r.mape),
    wf_mape: round2(r.wfMape),
    loo_mape: round2(r.looMape),
    winner: r.name === chosen.name,
  }));

  // Build ablation table from computed MAPEs (all 7 candidates + v6 odds-feature ablation)
  const ablation: AblationEntry[] = rawResults.map((r) => {
    const diff = round2(r.mape - chosen.mape);
    if (r.name === chosen.name) {
      return { name: r.name, params: r.params, mape: round2(r.mape), kept: true, note: r.mape <= bestMape + 1e-6 ? 'kept \u2014 lowest 5-fold MAPE' : 'kept \u2014 within 1pt of best with fewer params' };
    }
    if (diff < 0) {
      return { name: r.name, params: r.params, mape: round2(r.mape), kept: false, note: `not kept \u2014 ${Math.abs(diff).toFixed(1)}pt better, within 1pt tie-band for +${r.params - chosen.params} params` };
    }
    return { name: r.name, params: r.params, mape: round2(r.mape), kept: false, note: `not kept \u2014 +${diff.toFixed(1)}pt worse 5-fold MAPE` };
  });

  const oddsAugMape = evaluateOddsAugmentedAblation(samples, model);
  const oddsDiff = round2(oddsAugMape - chosen.mape);
  ablation.push({
    name: 'ols-global + odds',
    params: 3,
    mape: oddsAugMape,
    kept: false,
    note: oddsDiff >= 0
      ? `not kept \u2014 +${oddsDiff.toFixed(1)}pt vs winner; odds kept orthogonal in risk-adj`
      : `not kept \u2014 ${Math.abs(oddsDiff).toFixed(1)}pt diff; odds kept orthogonal to avoid double-counting`,
  });

  return {
    winner: chosen.name,
    winnerMape: round2(chosen.mape),
    medianMape: round2(medianEntry.mape),
    beatsMedian: chosen.name !== 'median' && chosen.mape < medianEntry.mape,
    walkForward: { split_date: splitDate, train_count: wfTrain.length, test_count: wfTest.length },
    bakeoff,
    ablation,
    categoryMape,
    winningFit: fullFits.get(chosen.name)!,
    foldFits: chosen.foldFits,
    cvPredictions: chosen.cvPreds,
  };
}

// ---------------------------------------------------------------- Farm plans with numeric cost_usd & hours

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(), name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(), name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the supply on ${name} and repay it the same week, so the address shows both sides of the market.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap a small amount through ${name}'s router on ${chain} each week, so the address is a trader as well as a liquidity provider.`;
  if (c.includes('bridge')) return `Use the bridged funds for one swap or deposit in an app on ${chain} within the same week, so the bridge is not the only trace.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or delegate the receipt token once, and vote in one governance proposal if ${name} opens one.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge and open a second small one the following week, keeping the margin deposit in place throughout.`;
  if (c.includes('prediction')) return `Settle one market and open a second one the following week, keeping the account funded between them.`;
  if (c.includes('curator') || c.includes('allocator')) return `Add a second, smaller deposit to a different ${name} vault on ${chain} the following week.`;
  if (c.includes('stable')) return `Use the minted stable asset in one payment or deposit on ${chain} each week, then return it to the protocol.`;
  if (c.includes('rwa')) return `Claim the yield the asset earns once a month and leave the principal in place.`;
  if (c.includes('insurance')) return `Renew the cover once before it lapses, so the policy runs without a gap.`;
  return `Make one more deposit, swap or vote on ${name} each week, a different action from the first.`;
}

/** 6-step farm plan with explicit gas-only cost_usd (never capital) and active hours over the hold window. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const weeks = Math.max(1, Math.round(hold / 7));
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
      cost_usd: 3,
      hours: round3(5 / 60),
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
      cost_usd: gas,
      hours: round3(15 / 60),
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
      cost_usd: 2 * weeks,
      hours: round3((10 / 60) * weeks),
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
      cost_usd: 0,
      hours: 0,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
      cost_usd: 0,
      hours: round3(10 / 60),
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
      cost_usd: 0,
      hours: round3(5 / 60),
    },
  ];
}

// ---------------------------------------------------------------- Farming economics & verdicts

export function farmingEconomics(
  impliedUsd: number,
  tvlUsd: number,
  launchOdds: number,
  farmCostUsd: number,
  farmHours: number,
  depositUsd: number,
  model: ModelConstants,
): { expectedAirdropUsd: number; netUsd: number; perHourUsd: number } {
  const airdropPool = model.airdrop_pool_share * impliedUsd;
  const farmingDeposits = model.farming_deposit_tvl_share * tvlUsd;
  const farmerShare = farmingDeposits > 0 ? depositUsd / farmingDeposits : 0;
  const expectedAirdrop = airdropPool * farmerShare * launchOdds;
  const oppCost = depositUsd * model.opp_cost_apr * (model.horizon_days / 365);
  const net = expectedAirdrop - farmCostUsd - oppCost;
  const perHour = farmHours > 0 ? net / farmHours : net;
  return {
    expectedAirdropUsd: Math.round(expectedAirdrop),
    netUsd: Math.round(net),
    perHourUsd: round2(perHour),
  };
}

export function verdictFor(perHour: number, t1: number, t2: number): Verdict {
  if (perHour >= t1) return 'FARM NOW';
  if (perHour >= t2) return 'SELECTIVE';
  if (perHour >= 0) return 'THIN';
  return 'SKIP';
}

// ---------------------------------------------------------------- Scoring & board construction

function growthAndMaturity(protocol: SnapshotProtocol, asOf: string, model: ModelConstants) {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  return { age, growthPct, growthMult, maturityMult };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function liveRows(snapshot: Snapshot, cvPredictions: Map<string, number> = new Map()): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && Number.isFinite(p.mcap_usd / p.tvl_usd))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug))
    .map((p) => {
      const cvPred = cvPredictions.get(p.slug);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        ratio: round4(p.mcap_usd! / p.tvl_usd),
        cv_predicted_mcap_usd: cvPred !== undefined && Number.isFinite(cvPred) ? Math.max(1, Math.round(cvPred)) : null,
      };
    });
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    rank_min: row.rank_min,
    rank_max: row.rank_max,
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
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    launch_odds: row.launch_odds,
    risk_adj_usd: row.risk_adj_usd,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    expected_airdrop_usd: row.expected_airdrop_usd,
    net_usd: row.net_usd,
    farm_per_hour_usd: row.farm_per_hour_usd,
    verdict: row.verdict,
    method: row.model.method,
    winsorized: row.model.winsorized,
    fit_scope: row.model.fit_scope,
    fitted_multiple: row.model.fitted_multiple,
    peer_multiple: row.model.peer_multiple,
    category_median_multiple: row.model.category_median_multiple,
    global_median_multiple: row.model.global_median_multiple,
    peer_count: row.model.peer_count,
    peer_category: row.model.peer_category,
    peer_p5: row.model.peer_p5,
    peer_p25: row.model.peer_p25,
    peer_p75: row.model.peer_p75,
    peer_p95: row.model.peer_p95,
    model_mape: row.model.model_mape,
    model_mape_scope: row.model.model_mape_scope,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    age_estimated: row.model.age_estimated,
    no_7d_data: row.model.no_7d_data,
    global_fit: row.model.global_fit,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  // 1. Launch odds model on ALL snapshot protocols
  const oddsRun = runOddsModel(snapshot, model);

  // 2. Value model 3-way bake-off on non-CEX mcap-bearing live protocols
  const samples = toLiveSamples(snapshot.protocols, oddsRun.cvOddsBySlug);
  const pricing = peerPricingFromSamples(samples, model.peer_min_count);
  const bake = runBakeoff(samples, model);

  // 3. Select watchlist + all rankable pre-token protocols + exclusion audit
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const additional = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || byCodeUnit(a.slug, b.slug));
  for (const p of additional) chosen.set(p.slug, p);

  const exclusions: ExclusionAudit = {
    total_pre_token: 0, ranked: chosen.size, excluded_total: 0,
    wrapped_category: 0, versioned_name: 0, wrapped_word: 0, exchange_name: 0,
  };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    exclusions.total_pre_token++;
    if (chosen.has(p.slug)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) { exclusions.excluded_total++; exclusions[reason]++; }
  }

  const chosenList = [...chosen.values()];

  // 4. 5-fold rank range across refits
  const rankMin = new Map<string, number>();
  const rankMax = new Map<string, number>();
  for (const p of chosenList) { rankMin.set(p.slug, chosenList.length); rankMax.set(p.slug, 1); }
  for (const foldFit of bake.foldFits) {
    const foldScored = chosenList.map((p) => {
      const gm = growthAndMaturity(p, snapshot.as_of, model);
      const pred = foldFit.predict(p.category, p.tvl_usd, Math.max(1, p.chains.length));
      const imp = Math.max(1, Math.round(p.tvl_usd * pred.multiple * gm.growthMult * gm.maturityMult));
      return { slug: p.slug, imp };
    });
    foldScored.sort((a, b) => b.imp - a.imp || byCodeUnit(a.slug, b.slug));
    for (let i = 0; i < foldScored.length; i++) {
      const slug = foldScored[i]!.slug;
      const r = i + 1;
      if (r < rankMin.get(slug)!) rankMin.set(slug, r);
      if (r > rankMax.get(slug)!) rankMax.set(slug, r);
    }
  }

  // 5. Score every row (implied value, residual range, odds, risk-adj, farm plan, economics)
  const farmUnpricedSteps: Array<{ slug: string; step: number }> = [];
  const prelim = chosenList.map((p) => {
    const gm = growthAndMaturity(p, snapshot.as_of, model);
    const peer = peerMultipleFor(p.category, pricing);
    const pred = bake.winningFit.predict(p.category, p.tvl_usd, Math.max(1, p.chains.length));
    const implied = Math.max(1, Math.round(p.tvl_usd * pred.multiple * gm.growthMult * gm.maturityMult));

    const catKey = p.category ?? 'Uncategorised';
    const isCategoryFit = pred.scope !== 'global' && pred.scope !== 'all live-token protocols';
    const catMape = bake.categoryMape[catKey];
    const modelMape = catMape !== undefined ? catMape : bake.winnerMape;
    const modelMapeScope: 'category' | 'global' = catMape !== undefined ? 'category' : 'global';

    const errFactor = 1 + Math.max(0, modelMape) / 100;
    const impliedLow = Math.min(implied, Math.max(1, Math.round(implied / errFactor)));
    const impliedHigh = Math.max(implied, Math.max(1, Math.round(implied * errFactor)));

    const launchOdds = oddsRun.fullOddsBySlug.get(p.slug) ?? round4(clipOdds(oddsRun.summary.global_rate));
    const riskAdj = Math.round(implied * launchOdds);

    const steps = farmSteps(p, gm.age);
    let costSum = 0;
    let hoursSum = 0;
    const details: FarmStepDetail[] = steps.map((s, idx) => {
      const c = Number.isFinite(s.cost_usd) ? s.cost_usd : 0;
      const h = Number.isFinite(s.hours) ? s.hours : 0;
      if (!Number.isFinite(s.cost_usd) || !Number.isFinite(s.hours)) {
        farmUnpricedSteps.push({ slug: p.slug, step: idx + 1 });
      }
      costSum += c;
      hoursSum += h;
      return { text: stepText(s), cost_usd: c, hours: h };
    });
    const farmCostUsd = Math.round(costSum);
    const farmHours = round1(hoursSum);
    const econ = farmingEconomics(implied, p.tvl_usd, launchOdds, farmCostUsd, farmHours, model.default_deposit_usd, model);

    return {
      p, gm, peer, pred, implied, impliedLow, impliedHigh, isCategoryFit, modelMape, modelMapeScope,
      launchOdds, riskAdj, steps, details, farmCostUsd, farmHours, econ,
    };
  });

  // Sort strictly by implied_value_usd descending (NEVER re-rank by risk-adjusted)
  prelim.sort((a, b) => b.implied - a.implied || byCodeUnit(a.p.slug, b.p.slug));

  // Derive verdict thresholds T1 / T2 from default-deposit $/hr distribution
  const sortedHourly = prelim.map((x) => x.econ.perHourUsd).sort((a, b) => a - b);
  const p80 = quantileOf(sortedHourly, 0.80) ?? 25;
  const p50 = quantileOf(sortedHourly, 0.50) ?? 0;
  const t1 = round2(Math.max(25, p80));
  const t2 = round2(Math.min(t1, Math.max(0, p50)));
  const verdictCounts: Record<Verdict, number> = { 'FARM NOW': 0, SELECTIVE: 0, THIN: 0, SKIP: 0 };

  const board: BoardRow[] = prelim.map((x, i) => {
    const rank = i + 1;
    const verdict = verdictFor(x.econ.perHourUsd, t1, t2);
    verdictCounts[verdict]++;
    return {
      rank,
      rank_min: Math.min(rank, rankMin.get(x.p.slug) ?? rank),
      rank_max: Math.max(rank, rankMax.get(x.p.slug) ?? rank),
      slug: x.p.slug,
      name: x.p.name,
      category: x.p.category,
      chains: x.p.chains,
      tvl_usd: x.p.tvl_usd,
      change_7d: x.p.change_7d,
      mcap_usd: x.p.mcap_usd,
      listed_at: x.p.listed_at,
      gecko_id: x.p.gecko_id,
      symbol: x.p.symbol,
      token_status: 'pre-token' as const,
      age_days: x.gm.age,
      implied_value_usd: x.implied,
      implied_low_usd: x.impliedLow,
      implied_high_usd: x.impliedHigh,
      launch_odds: x.launchOdds,
      risk_adj_usd: x.riskAdj,
      farm_cost_usd: x.farmCostUsd,
      farm_hours: x.farmHours,
      expected_airdrop_usd: x.econ.expectedAirdropUsd,
      net_usd: x.econ.netUsd,
      farm_per_hour_usd: x.econ.perHourUsd,
      verdict,
      model: {
        method: x.pred.method,
        winsorized: x.pred.winsorized,
        winner: bake.winner,
        fit_scope: x.pred.scope,
        fitted_multiple: x.pred.multiple,
        peer_multiple: x.peer.multiple,
        category_median_multiple: x.peer.categoryMedian !== null ? round4(x.peer.categoryMedian) : null,
        global_median_multiple: round4(pricing.global),
        peer_count: x.peer.count,
        peer_category: x.peer.category,
        peer_p5: round4(x.peer.p5),
        peer_p25: round4(x.peer.p25),
        peer_p75: round4(x.peer.p75),
        peer_p95: round4(x.peer.p95),
        model_mape: x.modelMape,
        model_mape_scope: x.modelMapeScope,
        growth_pct: x.gm.growthPct,
        growth_multiplier: round4(x.gm.growthMult),
        maturity_multiplier: round4(x.gm.maturityMult),
        age_days: x.gm.age,
        age_estimated: x.gm.age === null,
        no_7d_data: x.p.change_7d === null,
        global_fit: !x.isCategoryFit,
      },
      farm_steps: x.steps.map(stepText),
      farm_step_details: x.details,
    };
  });

  const live = liveRows(snapshot, bake.cvPredictions);
  const watchSet = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchSet.has(r.slug)).length;

  const roundedPeers: PeerTable = {};
  for (const key of Object.keys(pricing.peers).sort(byCodeUnit)) {
    const e = pricing.peers[key]!;
    roundedPeers[key] = { multiple: round4(e.multiple), p5: round4(e.p5), p25: round4(e.p25), p75: round4(e.p75), p95: round4(e.p95), count: e.count };
  }

  const calibration: CalibrationSummary = {
    fold_scheme: FOLD_SCHEME,
    live_sample_size: samples.length,
    winner: bake.winner,
    winner_mape: bake.winnerMape,
    median_mape: bake.medianMape,
    beats_median: bake.beatsMedian,
    walk_forward: bake.walkForward,
    bakeoff: bake.bakeoff,
    ablation: bake.ablation,
    category_mape: bake.categoryMape,
    coefficients: bake.winningFit.coefficients,
    odds_coefficients: oddsRun.summary.coefficients,
    odds_model: oddsRun.summary,
    verdicts: {
      default_deposit_usd: model.default_deposit_usd,
      t1_farm_now: t1,
      t2_selective: t2,
      counts: verdictCounts,
    },
    farm_unpriced_steps: farmUnpricedSteps,
  };

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
    global_multiple: round4(pricing.global),
    global_p25: round4(pricing.globalP25),
    global_p75: round4(pricing.globalP75),
    peers: roundedPeers,
    calibration,
    exclusions,
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
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

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_low_usd > r.implied_value_usd || r.implied_value_usd > r.implied_high_usd) return `${r.slug} violates low <= implied <= high`;
    if (r.launch_odds < 0.01 || r.launch_odds > 0.99) return `${r.slug} has out-of-range launch_odds ${r.launch_odds}`;
    if (Math.abs(r.risk_adj_usd - r.implied_value_usd * r.launch_odds) > 1) return `${r.slug} violates risk_adj_usd == round(implied * odds)`;
    if (r.rank_min > r.rank || r.rank > r.rank_max) return `${r.slug} violates rank_min <= rank <= rank_max`;
  }
  return null;
}

export function validationReportJson(radar: RadarData): string {
  const cal = radar.calibration;
  const om = cal.odds_model;
  const report = {
    model_version: radar.model_version,
    as_of: radar.as_of,
    board_size: radar.board_size,
    watchlist_size: radar.watchlist_size,
    early_size: radar.early_size,
    live_size: radar.live_size,
    fold_scheme: cal.fold_scheme,
    walk_forward: cal.walk_forward,
    winner: cal.winner,
    winner_mape: cal.winner_mape,
    median_mape: cal.median_mape,
    beats_median: cal.beats_median,
    bakeoff: cal.bakeoff,
    ablation: cal.ablation,
    coefficients: cal.coefficients,
    odds_converged: om.converged,
    odds_ridge: om.ridge,
    odds_model: om,
    verdicts: cal.verdicts,
    farm_unpriced_steps: cal.farm_unpriced_steps,
    exclusions: radar.exclusions,
  };
  return `${JSON.stringify(report)}\n`;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
