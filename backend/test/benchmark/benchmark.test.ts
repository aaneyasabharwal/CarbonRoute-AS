/**
 * P2: metrics, statistics, collected-dataset loading, forecast accuracy and the replay
 * benchmark. The datasets here are small TEST FIXTURES built in code (not provider data);
 * expected values are computed by hand in the comments.
 */
import { describe, it, expect } from 'vitest';
import { errorMetrics, bootstrapMeanCI, pairedBootstrapDiffCI, seededRandom, mean } from '../../src/evaluation/metrics';
import { buildDataset, parseCollection, CollectionRecord } from '../../src/benchmark/dataset';
import { forecastAccuracy, forecastPairs } from '../../src/benchmark/forecastAccuracy';
import { runReplayBenchmark, DEFAULT_BENCHMARK_CONFIG, hashConfig } from '../../src/benchmark/replay';
import { renderSummary } from '../../src/scripts/runBenchmark';

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 14, 0);
const iso = (h: number) => new Date(T0 + h * H).toISOString();

function forecastRecord(zone: string, fetchedHour: number, values: number[], run = 1): CollectionRecord {
  return {
    run,
    runAt: iso(fetchedHour),
    zone,
    kind: 'forecast',
    ok: true,
    data: {
      provider: 'electricitymaps',
      dataClass: 'real',
      zone,
      issuedAt: iso(fetchedHour),
      fetchedAt: new Date(T0 + fetchedHour * H + 10 * 60_000).toISOString(),
      horizonHours: values.length,
      granularity: 'hourly',
      emissionFactorType: 'lifecycle',
      unit: 'gCO2eq/kWh',
      points: values.map((v, i) => ({ datetime: iso(fetchedHour + i), carbonIntensity: v })),
      endpoint: '/carbon-intensity/forecast?zone=' + zone,
      rawSha256: `sha-${zone}-${fetchedHour}-${values.join(',')}`,
    },
  };
}

function historyRecord(zone: string, fromHour: number, values: (number | null)[], fetchedHour: number, quality: 'measured' | 'provider-estimate' = 'measured'): CollectionRecord {
  return {
    run: 1,
    runAt: iso(fetchedHour),
    zone,
    kind: 'history',
    ok: true,
    data: {
      observations: values
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => v !== null)
        .map(({ v, i }) => ({
          zone,
          datetime: iso(fromHour + i),
          granularity: 'hourly',
          carbonIntensity: v,
          isEstimated: quality !== 'measured',
          estimationMethod: null,
          quality,
          emissionFactorType: 'lifecycle',
          providerUpdatedAt: null,
          fetchedAt: iso(fetchedHour),
          provider: 'electricitymaps',
        })),
      missing: [],
      endpoint: '/carbon-intensity/history?zone=' + zone,
      rawSha256: 'x',
    },
  };
}

describe('error metrics', () => {
  it('computes MAE, RMSE and bias by hand', () => {
    // errors +10, -10, 0 -> MAE 20/3, RMSE sqrt(200/3), bias 0
    const m = errorMetrics([
      { forecast: 110, actual: 100 },
      { forecast: 90, actual: 100 },
      { forecast: 100, actual: 100 },
    ]);
    expect(m.n).toBe(3);
    expect(m.mae).toBeCloseTo(20 / 3, 10);
    expect(m.rmse).toBeCloseTo(Math.sqrt(200 / 3), 10);
    expect(m.bias).toBe(0);
    expect(errorMetrics([{ forecast: 130, actual: 100 }]).bias).toBe(30);
  });

  it('returns nulls, not zeros, without data', () => {
    expect(errorMetrics([])).toEqual({ n: 0, mae: null, rmse: null, bias: null });
    expect(mean([])).toBeNull();
  });
});

describe('bootstrap confidence intervals', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1);

  it('is reproducible for a seed and contains the sample mean', () => {
    const a = bootstrapMeanCI(values, { seed: 7, iterations: 1000 });
    const b = bootstrapMeanCI(values, { seed: 7, iterations: 1000 });
    expect(a).toEqual(b);
    expect(a.estimate).toBe(50.5);
    expect(a.low!).toBeLessThan(50.5);
    expect(a.high!).toBeGreaterThan(50.5);
    // standard error ~ 29/sqrt(100) = 2.9 -> 95% half-width ~ 5.7
    expect(a.high! - a.low!).toBeGreaterThan(8);
    expect(a.high! - a.low!).toBeLessThan(15);
    expect(bootstrapMeanCI(values, { seed: 8, iterations: 1000 })).not.toEqual(a);
  });

  it('degenerates correctly: constant data, tiny samples, mismatched pairs', () => {
    expect(bootstrapMeanCI([5, 5, 5, 5], { seed: 1 })).toMatchObject({ low: 5, high: 5, estimate: 5 });
    expect(bootstrapMeanCI([5], { seed: 1 })).toMatchObject({ low: null, high: null, note: expect.stringMatching(/Fewer than 2/) });
    expect(bootstrapMeanCI([1, 2, 3], { seed: 1 }).note).toMatch(/unreliable/);
    expect(() => pairedBootstrapDiffCI([1, 2], [1])).toThrow(/same length/);
    expect(pairedBootstrapDiffCI([3, 4, 5], [1, 2, 3], { seed: 2 })).toMatchObject({ estimate: 2, low: 2, high: 2 });
  });

  it('seededRandom is deterministic and in [0, 1)', () => {
    const r1 = seededRandom(123);
    const r2 = seededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const x = r1();
      expect(x).toBe(r2());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('collected dataset', () => {
  it('parses JSON lines, counts failed calls, keeps quality, de-duplicates snapshots and keeps the latest revision', () => {
    const failed: CollectionRecord = { run: 1, runAt: iso(0), zone: 'DE', kind: 'forecast', ok: false, error: { code: 'TIMEOUT' } };
    const records = parseCollection(
      [
        forecastRecord('DE', 0, [100, 110]),
        forecastRecord('DE', 0, [100, 110]), // identical re-fetch
        failed,
        historyRecord('DE', 0, [101, 120], 2, 'provider-estimate'),
        historyRecord('DE', 1, [111], 3, 'measured'), // later revision of hour 1
      ].map((r) => JSON.stringify(r))
    );
    const ds = buildDataset(records);
    expect(ds.records).toBe(5);
    expect(ds.failedRecords).toBe(1);
    expect(ds.zones.DE.snapshots).toHaveLength(1);
    expect(ds.zones.DE.realized.map((r) => [r.value, r.quality])).toEqual([
      [101, 'provider-estimate'],
      [111, 'measured'],
    ]);
  });
});

describe('forecast accuracy', () => {
  it('pairs only future intervals with realized values, split by realized quality and lead time', () => {
    // forecast fetched at hour 2 for hours 2..5 = [200, 210, 220, 230]; realized hours 0..4
    const ds = buildDataset([
      forecastRecord('GB', 2, [200, 210, 220, 230]),
      historyRecord('GB', 0, [999, 999, 190, 215], 6, 'measured'),
      historyRecord('GB', 4, [200], 6, 'provider-estimate'),
    ]);
    const pairs = forecastPairs(ds);
    // hour 2: 200 vs 190 (+10, lead 0); hour 3: 210 vs 215 (-5, lead 1); hour 4: 220 vs 200 est. (+20, lead 2); hour 5: no realized
    expect(pairs.map((p) => [p.leadHours, p.forecast - p.actual, p.quality])).toEqual([
      [0, 10, 'measured'],
      [1, -5, 'measured'],
      [2, 20, 'provider-estimate'],
    ]);
    const acc = forecastAccuracy(ds);
    expect(acc.overall.mae).toBeCloseTo(35 / 3, 10);
    expect(acc.measuredOnly).toMatchObject({ n: 2, mae: 7.5, bias: 2.5 });
    expect(acc.zones[0].byLead[0]).toMatchObject({ bucket: '0-5 h', metrics: { n: 3 } });
  });
});

describe('replay benchmark', () => {
  // 30 hours of forecast and identical realized data for one zone (perfect forecast fixture).
  const values = Array.from({ length: 30 }, (_, i) => 200 + 100 * Math.sin(i / 3));
  const perfect = buildDataset([forecastRecord('TST', 0, values.slice(0, 24)), historyRecord('TST', 0, values, 31, 'measured')], ['fixture'], 'fixture-sha');
  const config = { ...DEFAULT_BENCHMARK_CONFIG, workloadsPerSnapshot: 15, bootstrapIterations: 300 };

  it('with a perfect forecast and deterministic runtime, CarbonRoute matches the Oracle (zero regret) and never violates deadlines', () => {
    const r = runReplayBenchmark(perfect, config, { includeWorkloads: true, createdAt: 'fixed' });
    const s0 = r.scenarios.find((s) => s.runtimeCv === 0)!;
    const cr = s0.policies.find((p) => p.policyId === 'carbonroute_uncertainty')!;
    expect(s0.workloads).toBe(15);
    expect(s0.pendingRealized).toBe(0);
    expect(s0.oracleAvailable).toBe(15);
    expect(cr.scored).toBe(15);
    expect(cr.meanRegretVsOracle).toBe(0);
    expect(cr.deadlineViolationRate).toBe(0);
    // A perfect forecast: CarbonRoute is never worse than Immediate on realized intensity.
    expect(cr.diffVsImmediateCI.estimate!).toBeLessThanOrEqual(0);
    for (const w of r.workloads!.filter((x) => x.workload.runtimeCv === 0)) {
      expect(w.policies.carbonroute_uncertainty.realizedIntensity).toBeCloseTo(w.oracle.realizedIntensity!, 2);
    }
  });

  it('is reproducible: same data, config and seed give identical results; another seed differs', () => {
    const a = runReplayBenchmark(perfect, config, { createdAt: 'fixed' });
    const b = runReplayBenchmark(perfect, config, { createdAt: 'fixed' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.configSha256).toBe(hashConfig(config));
    const c = runReplayBenchmark(perfect, { ...config, seed: 99 }, { createdAt: 'fixed' });
    expect(JSON.stringify(c.scenarios)).not.toBe(JSON.stringify(a.scenarios));
  });

  it('with declared runtime variability, simulated violations are counted and CarbonRoute stays within tolerance', () => {
    const r = runReplayBenchmark(perfect, { ...config, workloadsPerSnapshot: 60 }, { includeWorkloads: true, createdAt: 'fixed' });
    const s = r.scenarios.find((x) => x.runtimeCv === 0.2)!;
    const greedy = s.policies.find((p) => p.policyId === 'deterministic_carbon')!;
    const cr = s.policies.find((p) => p.policyId === 'carbonroute_uncertainty')!;
    expect(cr.deadlineViolationRate!).toBeLessThanOrEqual(greedy.deadlineViolationRate!);
    for (const w of r.workloads!.filter((x) => x.workload.runtimeCv === 0.2 && x.policies.carbonroute_uncertainty)) {
      expect(w.policies.carbonroute_uncertainty.withinTolerance).toBe(true);
    }
  });

  it('does not score windows that have not been observed yet', () => {
    const partial = buildDataset([forecastRecord('TST', 0, values.slice(0, 24)), historyRecord('TST', 0, values.slice(0, 3), 4, 'measured')]);
    const r = runReplayBenchmark(partial, config, { createdAt: 'fixed' });
    const s0 = r.scenarios[0];
    expect(s0.pendingRealized).toBeGreaterThan(0);
    // Only workloads whose every candidate lies in hours 0-2 (e.g. 1 h, no slack) have an oracle.
    expect(s0.oracleAvailable).toBeGreaterThan(0);
    expect(s0.oracleAvailable).toBeLessThan(s0.workloads);
    for (const p of s0.policies) expect(p.scored).toBeLessThan(p.decisions);
  });

  it('the summary records hashes, seed and the data labels', () => {
    const r = runReplayBenchmark(perfect, config, { createdAt: 'fixed' });
    const md = renderSummary({ ...r, gitCommit: 'abc123', accuracy: forecastAccuracy(perfect) });
    expect(md).toContain('Git commit: abc123');
    expect(md).toContain(`Config SHA-256: ${r.configSha256}`);
    expect(md).toContain('Dataset SHA-256: fixture-sha');
    expect(md).toContain('real-carbon-data-synthetic-workloads');
    expect(md).toMatch(/ASSUMED energy/);
    expect(md).not.toContain('undefined');
  });
});

describe('forecast-error bands (uncertainty validated separately from deadline risk)', () => {
  it('reports quantiles only with enough pairs; otherwise insufficient-data with nulls', async () => {
    const { errorBands, MIN_PAIRS_FOR_ERROR_BAND } = await import('../../src/benchmark/forecastAccuracy');
    const few = errorBands([{ leadHours: 1, forecast: 110, actual: 100 }]);
    expect(few[0]).toEqual({ bucket: '0-5 h', n: 1, status: 'insufficient-data', p05: null, p50: null, p95: null });
    // errors -50..49 in lead bucket 0-5 h -> p05 = -45, p50 = 0, p95 = 45
    const many = Array.from({ length: 100 }, (_, i) => ({ leadHours: 2, forecast: 100 + (i - 50), actual: 100 }));
    expect(many.length).toBeGreaterThanOrEqual(MIN_PAIRS_FOR_ERROR_BAND);
    expect(errorBands(many)[0]).toEqual({ bucket: '0-5 h', n: 100, status: 'ok', p05: -45, p50: 0, p95: 45 });
  });
});

describe('collector', () => {
  it('writes one record per zone and kind, records failures, and never writes the key', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { runCollector } = await import('../../src/scripts/collectElectricityMaps');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-collect-'));
    const client = {
      isConfigured: () => true,
      getForecast: async (zone: string) => ({ zone, points: [{ datetime: iso(0), carbonIntensity: 100 }], fetchedAt: iso(0) }) as any,
      getHistory: async (zone: string) => {
        if (zone === 'GB') throw Object.assign(new Error('Electricity Maps did not respond'), { code: 'TIMEOUT', apiStatus: 503 });
        return { observations: [], missing: [], endpoint: 'x', rawSha256: 'y' } as any;
      },
    };
    const sleeps: number[] = [];
    const logs: string[] = [];
    const code = await runCollector(client, { zones: ['DE', 'GB'], runs: 2, intervalMs: 1234, outDir: dir }, { sleep: async (ms) => void sleeps.push(ms), log: (m) => logs.push(m), now: () => new Date(T0) });
    expect(code).toBe(0);
    expect(sleeps).toEqual([1234]);
    const lines = fs.readFileSync(path.join(dir, 'collection-2026-11-14.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(8);
    expect(lines.filter((l) => !l.ok)).toEqual([
      expect.objectContaining({ zone: 'GB', kind: 'history', ok: false, error: expect.objectContaining({ code: 'TIMEOUT' }) }),
      expect.objectContaining({ zone: 'GB', kind: 'history', ok: false }),
    ]);
    expect(logs[0]).toMatch(/run 1\/2 .*3 ok, 1 failed/);
    const ds = buildDataset(parseCollection(fs.readFileSync(path.join(dir, 'collection-2026-11-14.jsonl'), 'utf8').split('\n')));
    expect(ds.failedRecords).toBe(2);
    expect(await runCollector({ ...client, isConfigured: () => false }, { zones: ['DE'], runs: 1, intervalMs: 0, outDir: dir }, { log: () => {} })).toBe(2);
  });
});
