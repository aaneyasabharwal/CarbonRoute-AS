/**
 * Baselines and one candidate model for predicting realized carbon intensity from a provider
 * forecast (P5, plan M12.3 / M12.4). Pure TypeScript, deterministic, no dependencies.
 *
 * All predictors output a REALIZED-intensity estimate; errors are prediction - actual.
 *   provider-as-is   : the forecast itself (the reference every model must beat)
 *   bias-corrected   : forecast - mean(forecast - actual) per (zone, lead bucket), from TRAIN
 *   persistence      : last realized value known at issue time (falls back to the forecast)
 *   ridge (candidate): forecast - ridge-predicted error, features standardised on TRAIN,
 *                      regularisation chosen on VALIDATION only
 */
import type { ErrorRow } from './dataset';

export type Predictor = (r: ErrorRow) => number;

export const leadBucket = (lead: number) => (lead <= 5 ? '0-5' : lead <= 11 ? '6-11' : lead <= 23 ? '12-23' : '24+');

export const providerAsIs: Predictor = (r) => r.forecast;
export const persistence: Predictor = (r) => (r.lastRealized ?? r.forecast);

export function fitBiasCorrection(train: ErrorRow[]): Predictor {
  const sums = new Map<string, { s: number; n: number }>();
  for (const r of train) {
    const k = `${r.zone}|${leadBucket(r.leadHours)}`;
    const v = sums.get(k) ?? { s: 0, n: 0 };
    v.s += r.forecast - r.actual;
    v.n++;
    sums.set(k, v);
  }
  return (r) => {
    const v = sums.get(`${r.zone}|${leadBucket(r.leadHours)}`);
    return v ? r.forecast - v.s / v.n : r.forecast;
  };
}

/** Feature vector (without intercept) for a row; zones are one-hot against a fixed list. */
export function features(r: ErrorRow, zones: string[]): number[] {
  const angle = (2 * Math.PI * r.hourOfDayUtc) / 24;
  const lag = r.lastRealized === null ? 0 : r.forecast - r.lastRealized;
  // Zone one-hot plus zone x lead interactions: forecast error can grow with lead time at a
  // different rate in each grid zone.
  return [
    r.forecast,
    r.leadHours,
    r.leadHours ** 2,
    Math.sin(angle),
    Math.cos(angle),
    lag,
    r.lastRealized === null ? 1 : 0,
    ...zones.map((z) => (r.zone === z ? 1 : 0)),
    ...zones.map((z) => (r.zone === z ? r.leadHours : 0)),
  ];
}

/** Solves A x = b by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Singular system');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface RidgeModel {
  predict: Predictor;
  lambda: number;
  zones: string[];
  weights: number[];
  means: number[];
  scales: number[];
}

/** Ridge regression on the forecast error (forecast - actual); intercept not penalised. */
export function fitRidge(train: ErrorRow[], lambda: number, zones = [...new Set(train.map((r) => r.zone))].sort()): RidgeModel {
  const X = train.map((r) => features(r, zones));
  const y = train.map((r) => r.forecast - r.actual);
  const d = X[0].length;
  const means = Array.from({ length: d }, (_, j) => X.reduce((s, x) => s + x[j], 0) / X.length);
  const scales = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j] - means[j]) ** 2, 0) / X.length) || 1);
  const Z = X.map((x) => [1, ...x.map((v, j) => (v - means[j]) / scales[j])]);
  const p = d + 1;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((s, z) => s + z[i] * z[j], 0) + (i === j && i > 0 ? lambda : 0)));
  const b = Array.from({ length: p }, (_, i) => Z.reduce((s, z, k) => s + z[i] * y[k], 0));
  const weights = solve(A, b);
  const predictError = (r: ErrorRow) => {
    const x = features(r, zones);
    return weights[0] + x.reduce((s, v, j) => s + weights[j + 1] * ((v - means[j]) / scales[j]), 0);
  };
  return { predict: (r) => r.forecast - predictError(r), lambda, zones, weights, means, scales };
}

export const RIDGE_LAMBDAS = [0.1, 1, 10, 100, 1000];

export const mae = (rows: ErrorRow[], f: Predictor) => (rows.length ? rows.reduce((s, r) => s + Math.abs(f(r) - r.actual), 0) / rows.length : null);

/** Chooses lambda by validation MAE (never by test data). */
export function selectRidge(train: ErrorRow[], validation: ErrorRow[]): { model: RidgeModel; validationMae: Record<string, number | null> } {
  const zones = [...new Set([...train, ...validation].map((r) => r.zone))].sort();
  const scores: Record<string, number | null> = {};
  let best: RidgeModel | null = null;
  let bestMae = Infinity;
  for (const l of RIDGE_LAMBDAS) {
    const m = fitRidge(train, l, zones);
    const v = mae(validation, m.predict);
    scores[String(l)] = v;
    if (v !== null && v < bestMae) {
      bestMae = v;
      best = m;
    }
  }
  return { model: best ?? fitRidge(train, RIDGE_LAMBDAS[0], zones), validationMae: scores };
}
