/**
 * P5: forecast-error ML pipeline. All datasets here are SYNTHETIC TEST FIXTURES generated with a
 * seeded generator (they are not provider data and are never reported as results). They check
 * that the pipeline is leakage-free, refuses to train on too little data, promotes a model only
 * when the forecast error has learnable structure, and does NOT promote on pure noise.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { buildErrorRows, chronologicalSplit, assertNoLeakage } from '../../src/ml/dataset';
import { runMlPipeline, ML_THRESHOLDS } from '../../src/ml/pipeline';
import { residualAnomalies } from '../../src/ml/anomaly';
import { solve, fitRidge } from '../../src/ml/models';
import { renderMlSummary } from '../../src/scripts/runMlPipeline';
import { seededRandom, normalSample } from '../../src/evaluation/metrics';
import type { CollectionRecord } from '../../src/benchmark/dataset';
import { createAndLoginUser } from '../support/auth';

const H = 3600_000;
const T0 = Date.UTC(2026, 9, 1, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Hourly collection runs over `days` days for each zone. truth(t) is a daily cycle; the
 * provider forecast = truth + bias(zone, lead) + noise. History holds the last 24 realized hours.
 */
function synthetic(opts: { days: number; zones: string[]; bias: (zone: string, lead: number) => number; noiseSd: number; seed?: number; spike?: { zone: string; hour: number; add: number }; randomTruth?: boolean }): CollectionRecord[] {
  const rand = seededRandom(opts.seed ?? 1);
  // randomTruth: independent values per hour (unpredictable from any feature), fixed per seed.
  const truthRand = seededRandom((opts.seed ?? 1) + 777);
  const table = new Map<string, number>();
  const truth = (zone: string, t: number) => {
    if (!opts.randomTruth) return 300 + (zone === opts.zones[0] ? 0 : 80) + 100 * Math.sin((2 * Math.PI * (t / H)) / 24);
    const k = `${zone}|${t}`;
    if (!table.has(k)) table.set(k, 300 + 100 * normalSample(truthRand));
    return table.get(k)!;
  };
  const records: CollectionRecord[] = [];
  for (let run = 1; run <= opts.days * 24; run++) {
    const fetchHour = T0 + run * H;
    const fetchedAt = fetchHour + 30 * 60_000;
    for (const zone of opts.zones) {
      const points = Array.from({ length: 24 }, (_, lead) => {
        const t = fetchHour + lead * H;
        let v = truth(zone, t) + opts.bias(zone, lead) + opts.noiseSd * normalSample(rand);
        if (opts.spike && opts.spike.zone === zone && run === opts.spike.hour && lead === 1) v += opts.spike.add;
        return { datetime: iso(t), carbonIntensity: v };
      });
      records.push({ run, runAt: iso(fetchedAt - 1000), zone, kind: 'forecast', ok: true, data: { provider: 'electricitymaps', dataClass: 'real', zone, issuedAt: iso(fetchHour), fetchedAt: iso(fetchedAt), horizonHours: 24, granularity: 'hourly', emissionFactorType: 'lifecycle', unit: 'gCO2eq/kWh', points, endpoint: 'x', rawSha256: `${zone}-${run}` } });
      const observations = Array.from({ length: 24 }, (_, k) => {
        const t = fetchHour - (24 - k) * H;
        return { zone, datetime: iso(t), granularity: 'hourly', carbonIntensity: truth(zone, t), isEstimated: zone !== opts.zones[0], estimationMethod: null, quality: zone === opts.zones[0] ? 'measured' : 'provider-estimate', emissionFactorType: 'lifecycle', providerUpdatedAt: null, fetchedAt: iso(fetchedAt), provider: 'electricitymaps' };
      });
      records.push({ run, runAt: iso(fetchedAt - 1000), zone, kind: 'history', ok: true, data: { observations, missing: [], endpoint: 'y', rawSha256: 'z' } });
    }
  }
  return records;
}

describe('dataset: leakage-free rows and chronological splits', () => {
  const records = synthetic({ days: 3, zones: ['AA', 'BB'], bias: () => 0, noiseSd: 1 });
  const rows = buildErrorRows(records);

  it('uses only information available at issue time', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.leadHours).toBeGreaterThanOrEqual(0);
      if (r.lastRealizedEnd !== null) expect(r.lastRealizedEnd).toBeLessThanOrEqual(r.issuedAt);
    }
    expect(() => assertNoLeakage(rows)).not.toThrow();
    expect(() => assertNoLeakage([{ ...rows[0], lastRealizedEnd: rows[0].issuedAt + 1 }])).toThrow(/Leakage/);
  });

  it('keeps measured vs provider-estimate quality of the target', () => {
    expect(new Set(rows.filter((r) => r.zone === 'AA').map((r) => r.quality))).toEqual(new Set(['measured']));
    expect(new Set(rows.filter((r) => r.zone === 'BB').map((r) => r.quality))).toEqual(new Set(['provider-estimate']));
  });

  it('splits chronologically with no target of an earlier split overlapping a later split', () => {
    const s = chronologicalSplit(rows);
    const vStart = Date.parse(s.boundaries.validationStart!);
    const tStart = Date.parse(s.boundaries.testStart!);
    for (const r of s.train) expect(r.targetTime + H).toBeLessThanOrEqual(vStart);
    for (const r of s.validation) {
      expect(r.issuedAt).toBeGreaterThanOrEqual(vStart);
      expect(r.targetTime + H).toBeLessThanOrEqual(tStart);
    }
    for (const r of s.test) expect(r.issuedAt).toBeGreaterThanOrEqual(tStart);
    expect(s.droppedForGap).toBeGreaterThan(0);
  });
});

describe('pipeline status', () => {
  it('with collection-sized data (3 hours) it fits nothing and says why', () => {
    const r = runMlPipeline(synthetic({ days: 1, zones: ['AA'], bias: () => 5, noiseSd: 3 }).filter((x) => x.run <= 4), { createdAt: 'fixed' });
    expect(r.status).toBe('insufficient-data');
    expect(r.candidate).toBeNull();
    expect(r.testScores).toBeNull();
    expect(r.statusReasons.join(' ')).toMatch(/spans .* days; at least 7/);
    expect(r.statusReasons.join(' ')).toMatch(/No model was fitted/);
    expect(renderMlSummary(r)).toContain('insufficient-data');
    // The provider's own error is still reported, descriptively.
    expect(r.providerErrorAllRows.all.n).toBeGreaterThan(0);
  });

  it('promotes the candidate only when the error has learnable structure (lead-dependent bias)', () => {
    const r = runMlPipeline(synthetic({ days: 10, zones: ['AA', 'BB'], bias: (z, lead) => (z === 'AA' ? 4 * lead : -3 * lead + 20), noiseSd: 3, seed: 5, randomTruth: true }), { createdAt: 'fixed' });
    expect(r.split!.train).toBeGreaterThanOrEqual(ML_THRESHOLDS.minTrainRows);
    expect(r.status).toBe('evaluated-promoted');
    const by = Object.fromEntries(r.testScores!.map((s) => [s.model, s.all.mae!]));
    expect(by['ridge-error-correction']).toBeLessThan(by['provider-as-is']);
    expect(by['ridge-error-correction']).toBeLessThan(by['bias-corrected']);
    expect(r.promotion!.maeRatio!).toBeLessThanOrEqual(0.95);
    expect(r.promotion!.diffCI.high!).toBeLessThan(0);
    // measured-only metrics only use the measured zone
    const ridge = r.testScores!.find((s) => s.model === 'ridge-error-correction')!;
    expect(ridge.measuredOnly.n).toBeLessThan(ridge.all.n);
  });

  it('does NOT promote a model when nothing about the error is predictable (random truth, unbiased noisy forecast)', () => {
    const r = runMlPipeline(synthetic({ days: 10, zones: ['AA', 'BB'], bias: () => 0, noiseSd: 10, seed: 9, randomTruth: true }), { createdAt: 'fixed' });
    expect(r.status).toBe('evaluated-not-promoted');
    expect(r.statusReasons[0]).toMatch(/^Not promoted/);
  });

  it('is deterministic for the same input', () => {
    const recs = synthetic({ days: 8, zones: ['AA'], bias: (_z, l) => 2 * l, noiseSd: 2, seed: 3 });
    expect(JSON.stringify(runMlPipeline(recs, { createdAt: 'x' }))).toBe(JSON.stringify(runMlPipeline(recs, { createdAt: 'x' })));
  });
});

describe('models and anomaly flags', () => {
  it('solve() and ridge recover a known linear relation', () => {
    expect(solve([[2, 1], [1, 3]], [3, 5]).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.8, 1.4]);
    const rows = buildErrorRows(synthetic({ days: 3, zones: ['AA'], bias: (_z, l) => 10 + 2 * l, noiseSd: 0, seed: 2 }));
    const m = fitRidge(rows, 1e-6);
    for (const r of rows.slice(0, 50)) expect(Math.abs(m.predict(r) - r.actual)).toBeLessThan(0.5);
  });

  it('flags an injected error spike, and does not flag zones with too few rows', () => {
    const rows = buildErrorRows(synthetic({ days: 3, zones: ['AA', 'BB'], bias: () => 0, noiseSd: 2, seed: 4, spike: { zone: 'AA', hour: 30, add: 400 } }));
    const rep = residualAnomalies(rows);
    const aa = rep.zones.find((z) => z.zone === 'AA')!;
    expect(aa.status).toBe('ok');
    expect(aa.flagged.some((f) => f.error > 300)).toBe(true);
    expect(rep.method).toMatch(/unsupervised/);
    expect(residualAnomalies(rows.slice(0, 10)).zones.every((z) => z.status === 'insufficient-data')).toBe(true);
  });
});

describe('ML results API', () => {
  let auth: { Authorization: string };
  beforeAll(async () => {
    auth = (await createAndLoginUser(app)).auth;
  });

  it('requires sign-in, lists valid evaluations newest first, and refuses other ids', async () => {
    expect((await request(app).get('/api/results/ml')).status).toBe(401);
    expect((await request(app).get('/api/results/ml').set(auth)).body.data).toEqual([]);
    const dir = process.env.ML_RESULTS_DIR!;
    fs.mkdirSync(dir, { recursive: true });
    const r = runMlPipeline(synthetic({ days: 1, zones: ['AA'], bias: () => 0, noiseSd: 1 }).filter((x) => x.run <= 3), { createdAt: '2026-11-13T18:00:00.000Z' });
    fs.writeFileSync(path.join(dir, 'ml-2026-11-13T18-00-00-000Z.json'), JSON.stringify(r));
    fs.writeFileSync(path.join(dir, 'ml-2026-11-13T19-00-00-000Z.json'), JSON.stringify({ kind: 'other' }));
    const list = await request(app).get('/api/results/ml').set(auth);
    expect(list.body.data.map((x: any) => [x.id, x.status])).toEqual([['ml-2026-11-13T18-00-00-000Z', 'insufficient-data']]);
    const one = await request(app).get('/api/results/ml/ml-2026-11-13T18-00-00-000Z').set(auth);
    expect(one.body.data.statusReasons.join(' ')).toMatch(/No model was fitted/);
    for (const id of ['ml-2026-11-13T19-00-00-000Z', '..%2Fx', 'benchmark-2026-11-13T18-00-00-000Z']) {
      expect((await request(app).get(`/api/results/ml/${id}`).set(auth)).status).toBe(404);
    }
  });
});
