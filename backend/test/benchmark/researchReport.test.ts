/**
 * P8 research report generator: guardrails and reproducibility. Fixtures are hand-written objects in
 * the shape of saved benchmark / ML results (not provider data).
 */
import { describe, it, expect } from 'vitest';
import { buildResearchReport, describeDifference } from '../../src/scripts/researchReport';

const ci = (estimate: number, low: number | null, high: number | null, n = 100, clusters = 40) => ({ n, estimate, low, high, clusters, level: 0.95 });
const policy = (policyId: string, cluster: any, extra: Record<string, unknown> = {}) => ({
  policyId,
  decisions: 100,
  scored: 90,
  meanRealizedIntensity: 200,
  meanForecastIntensity: 195,
  meanEstimatedEmissionsGrams: 100,
  meanDelayHours: 1,
  deadlineViolationRate: 0.01,
  meanRegretVsOracle: 2,
  realizedIntensityCI: ci(200, 190, 210),
  diffVsImmediateCI: ci(-5, -6, -4),
  ...(cluster === undefined ? {} : { diffVsImmediateClusterCI: cluster }),
  ...extra,
});
const bench = (clusters: any[], sha = 'sha-bench') => ({
  kind: 'carbonroute-replay-benchmark',
  createdAt: '2026-11-20T00:00:00.000Z',
  gitCommit: 'abc1234567890',
  configSha256: 'cfg',
  config: { seed: 42, workloadsPerSnapshot: 20, riskTolerance: 0.05, runtimeCvs: [0.2] },
  dataset: { sha256: sha, snapshots: 300, realizedIntervals: 900, measuredShare: 0.6, zones: ['DE'] },
  accuracy: { zones: [{ zone: 'DE', pairs: 500, all: { n: 500, mae: 20, rmse: 25, bias: 3 }, measuredOnly: { n: 300, mae: 18 }, errorBands: [{ status: 'ok' }] }], overall: { n: 500, mae: 20, rmse: 25, bias: 3 }, measuredOnly: { n: 300, mae: 18 } },
  scenarios: [{ runtimeCv: 0.2, workloads: 100, infeasible: 2, pendingRealized: 5, oracleAvailable: 50, policies: [policy('immediate', ci(0, 0, 0)), ...clusters] }],
});
const mlInsufficient = (sha = 'sha-bench', spanDays = 2) => ({
  createdAt: '2026-11-20T00:00:01.000Z',
  gitCommit: 'abc',
  status: 'insufficient-data',
  dataset: { sha256: sha, rows: 100, measuredRows: 40, spanDays },
  thresholds: { minTrainRows: 500, minValidationRows: 100, minTestRows: 200, minSpanDays: 7 },
});

describe('describeDifference', () => {
  it('only calls a difference lower/higher when the interval excludes 0', () => {
    expect(describeDifference(ci(-3, -5, 1))).toMatch(/no evidence/);
    expect(describeDifference(ci(-3, -5, -1))).toBe('lower than Immediate in this sample');
    expect(describeDifference(ci(3, 1, 5))).toBe('higher than Immediate in this sample');
    expect(describeDifference(ci(-3, null, null))).toMatch(/no interval/);
    expect(describeDifference(null)).toBe('not available');
  });
});

describe('buildResearchReport guardrails', () => {
  it('short data: "not statistically conclusive", and no model accuracy when the model was not trained', () => {
    const { markdown, summary } = buildResearchReport({ benchmark: bench([policy('carbonroute_uncertainty', ci(-8, -12, -4))]), ml: mlInsufficient('sha-bench', 2) });
    expect(markdown).toMatch(/Not statistically conclusive: 2\.00 days of data \(minimum 7\)/);
    expect(summary.conclusive).toBe(false);
    expect(markdown).toMatch(/No model was trained; no model accuracy exists/);
    expect(markdown).not.toMatch(/\| ridge/);
    expect(markdown).toMatch(/Emissions use the assumed energy model/);
    expect(markdown).toMatch(/simulated runtimes/);
    expect(markdown).toMatch(/Resource utilisation is \*\*not modelled\*\*/);
  });

  it('enough days and clusters: no inconclusive banner, but readings still follow the intervals', () => {
    const { markdown, summary } = buildResearchReport({
      benchmark: bench([policy('deterministic_carbon', ci(-2, -6, 1)), policy('carbonroute_uncertainty', ci(-8, -12, -4))]),
      ml: mlInsufficient('sha-bench', 10),
    });
    expect(summary.conclusive).toBe(true);
    expect(markdown).not.toMatch(/Not statistically conclusive/);
    const greedy = summary.scenarios[0].policies.find((p: any) => p.policyId === 'deterministic_carbon');
    expect(greedy.reading).toMatch(/no evidence of a difference/);
  });

  it('too few snapshot clusters makes it inconclusive even with enough days', () => {
    const { summary } = buildResearchReport({ benchmark: bench([policy('carbonroute_uncertainty', ci(-8, -12, -4, 100, 12))]), ml: mlInsufficient('sha-bench', 30) });
    expect(summary.conclusive).toBe(false);
    expect(summary.verdict).toMatch(/12 snapshot clusters \(minimum 30\)/);
  });

  it('a data span is only attributed to the benchmark when the dataset hash matches', () => {
    const r = buildResearchReport({
      benchmark: bench([policy('carbonroute_uncertainty', ci(-8, -12, -4))]),
      ml: mlInsufficient('other-sha', 30),
      collection: { sha256: 'newer-sha', records: 999, failedCalls: 0, firstRunAt: 'a', lastRunAt: 'b', spanDays: 30, zones: [] },
    });
    expect(r.summary.spanDays).toBeNull();
    expect(r.summary.conclusive).toBe(false);
    expect(r.markdown).toMatch(/unknown data duration/);
    expect(r.markdown).toMatch(/Current collection \(newer than the benchmark input/);
  });

  it('an older result without the snapshot-cluster interval is not given a reading', () => {
    const { markdown } = buildResearchReport({ benchmark: bench([policy('carbonroute_uncertainty', undefined)]), ml: null });
    expect(markdown).toMatch(/workload-level interval only \(older file\): not reported/);
  });

  it('an evaluated model shows held-out scores and says it is not used by the scheduler', () => {
    const ml = { ...mlInsufficient('sha-bench', 10), status: 'evaluated-promoted', split: { test: 250 }, testScores: [{ model: 'ridge-error-correction', all: { mae: 10, rmse: 12, bias: 0 }, measuredOnly: { mae: 9, n: 120 } }] };
    const { markdown } = buildResearchReport({ benchmark: bench([policy('carbonroute_uncertainty', ci(-8, -12, -4))]), ml });
    expect(markdown).toMatch(/\| ridge-error-correction \| 10\.00/);
    expect(markdown).toMatch(/not used by the scheduler/);
  });
});

describe('reproducibility', () => {
  it('the same saved results give the same report; overhead is machine-dependent and excluded from the hash', () => {
    const input = { benchmark: bench([policy('carbonroute_uncertainty', ci(-8, -12, -4))]), ml: mlInsufficient() };
    const a = buildResearchReport(input);
    const b = buildResearchReport(JSON.parse(JSON.stringify(input)));
    expect(b.markdown).toBe(a.markdown);
    const withOverhead = buildResearchReport({ ...input, overhead: { samples: 10, medianMs: 0.1, p95Ms: 0.2, machine: 'x' } });
    expect(withOverhead.summary.reportSha256).toBe(a.summary.reportSha256);
    expect(withOverhead.markdown).toMatch(/machine-dependent/);
  });
});
