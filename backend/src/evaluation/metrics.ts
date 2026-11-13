/**
 * Accuracy metrics and resampling statistics (P2, plan M8.1 / M11.3).
 *
 * All functions are pure and deterministic (resampling uses a seeded generator), so the same
 * inputs and seed always give the same numbers.
 */

export interface ErrorMetrics {
  n: number;
  /** Mean absolute error. */
  mae: number | null;
  /** Root mean squared error. */
  rmse: number | null;
  /** Mean of (forecast - actual): positive means the forecast was too high. */
  bias: number | null;
}

/** Errors of forecast vs actual over matched pairs. Empty input gives nulls, never zeros. */
export function errorMetrics(pairs: { forecast: number; actual: number }[]): ErrorMetrics {
  const n = pairs.length;
  if (n === 0) return { n: 0, mae: null, rmse: null, bias: null };
  let abs = 0;
  let sq = 0;
  let sum = 0;
  for (const { forecast, actual } of pairs) {
    const e = forecast - actual;
    abs += Math.abs(e);
    sq += e * e;
    sum += e;
  }
  return { n, mae: abs / n, rmse: Math.sqrt(sq / n), bias: sum / n };
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** mulberry32: small seeded PRNG, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller) from a uniform generator. */
export function normalSample(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface ConfidenceInterval {
  n: number;
  estimate: number | null;
  low: number | null;
  high: number | null;
  level: number;
  method: 'percentile-bootstrap';
  iterations: number;
  seed: number;
  /** Set when n is too small for a meaningful interval. */
  note?: string;
}

const percentile = (sorted: number[], q: number) => {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx];
};

/** Percentile bootstrap confidence interval for the mean. */
export function bootstrapMeanCI(
  values: number[],
  opts: { iterations?: number; level?: number; seed?: number } = {}
): ConfidenceInterval {
  const iterations = opts.iterations ?? 2000;
  const level = opts.level ?? 0.95;
  const seed = opts.seed ?? 1;
  const n = values.length;
  const estimate = mean(values);
  if (n < 2) {
    return { n, estimate, low: null, high: null, level, method: 'percentile-bootstrap', iterations, seed, note: 'Fewer than 2 values: no interval.' };
  }
  const rand = seededRandom(seed);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += values[Math.floor(rand() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    n,
    estimate,
    low: percentile(means, alpha),
    high: percentile(means, 1 - alpha),
    level,
    method: 'percentile-bootstrap',
    iterations,
    seed,
    ...(n < 10 ? { note: 'Fewer than 10 values: the interval is unreliable.' } : {}),
  };
}

/** Paired bootstrap CI for mean(a_i - b_i) over the same units (e.g. the same workloads). */
export function pairedBootstrapDiffCI(
  a: number[],
  b: number[],
  opts: { iterations?: number; level?: number; seed?: number } = {}
): ConfidenceInterval {
  if (a.length !== b.length) throw new Error('Paired samples must have the same length.');
  return bootstrapMeanCI(
    a.map((x, i) => x - b[i]),
    opts
  );
}

/**
 * Paired CLUSTER bootstrap CI for mean(a_i - b_i) (P5 review). Rows that share a cluster id
 * (e.g. the same target hour predicted by several forecast snapshots) are not independent, so
 * whole clusters are resampled. A row-level bootstrap on such data gives intervals that are
 * too narrow. `clusters` is the number of distinct clusters actually used.
 */
export function pairedClusterBootstrapDiffCI(
  a: number[],
  b: number[],
  clusterIds: (string | number)[],
  opts: { iterations?: number; level?: number; seed?: number } = {}
): ConfidenceInterval & { clusters: number; method: 'percentile-bootstrap' } {
  if (a.length !== b.length || a.length !== clusterIds.length) throw new Error('Paired samples and cluster ids must have the same length.');
  const iterations = opts.iterations ?? 2000;
  const level = opts.level ?? 0.95;
  const seed = opts.seed ?? 1;
  const groups = new Map<string, number[]>();
  a.forEach((x, i) => {
    const k = String(clusterIds[i]);
    const g = groups.get(k) ?? [];
    g.push(x - b[i]);
    groups.set(k, g);
  });
  const clusters = [...groups.values()];
  const n = a.length;
  const estimate = mean(a.map((x, i) => x - b[i]));
  if (clusters.length < 2) {
    return { n, estimate, low: null, high: null, level, method: 'percentile-bootstrap', iterations, seed, clusters: clusters.length, note: 'Fewer than 2 clusters: no interval.' };
  }
  const rand = seededRandom(seed);
  const means: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    let c = 0;
    for (let j = 0; j < clusters.length; j++) {
      const g = clusters[Math.floor(rand() * clusters.length)];
      for (const d of g) s += d;
      c += g.length;
    }
    means.push(s / c);
  }
  means.sort((x, y) => x - y);
  const alpha = (1 - level) / 2;
  return {
    n,
    estimate,
    low: percentile(means, alpha),
    high: percentile(means, 1 - alpha),
    level,
    method: 'percentile-bootstrap',
    iterations,
    seed,
    clusters: clusters.length,
    ...(clusters.length < 30 ? { note: `Only ${clusters.length} independent clusters: the interval is unreliable.` } : {}),
  };
}
