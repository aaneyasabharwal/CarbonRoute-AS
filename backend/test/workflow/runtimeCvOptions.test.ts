/**
 * P17: the declared runtime variability (CV) a user may choose is one of exactly 11 values
 * 0, 0.1, ..., 1.0. Each is accepted by the API, stored with the decision, shown in the job view
 * and the report, and used unchanged by the existing deadline-risk formula. Anything else is
 * rejected with 400. CV is a user-declared assumption, not learned from data.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { RUNTIME_CV_OPTIONS, toRuntimeCvOption, UncertaintyService, normalCdf } from '../../src/services/uncertaintyService';
import { SchedulerService, WorkloadJob } from '../../src/services/schedulerService';

const H = 3600_000;
const ALL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

let app: Express;
let owner: { Authorization: string };
beforeAll(async () => {
  ({ default: app } = await import('../../src/app'));
  const { createAndLoginUser } = await import('../support/auth');
  owner = (await createAndLoginUser(app)).auth;
});

const schedule = (runtimeCv: unknown, includeCv = true) =>
  request(app)
    .post('/api/schedule')
    .set(owner)
    .send({
      mode: 'demo',
      ...(includeCv ? { runtimeCv } : {}),
      jobData: {
        name: `cv ${String(runtimeCv)}`,
        commandOrImage: 'busybox',
        isContainerImage: true,
        durationHours: 2,
        cpu: 1,
        memoryMb: 256,
        riskTolerance: 0.05,
        region: 'BENCHMARK-RESEARCH',
        deadlineAt: new Date(Date.now() + 14 * H).toISOString(),
      },
    });

describe('runtime CV options', () => {
  it('are exactly the 11 values 0, 0.1, ..., 1.0', () => {
    expect([...RUNTIME_CV_OPTIONS]).toEqual(ALL);
  });

  it('match the frontend selector list exactly', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '..', '..', '..', 'frontend', 'src', 'lib', 'runtimeCv.ts'), 'utf8');
    const m = src.match(/RUNTIME_CV_OPTIONS = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    expect(m![1].split(',').map((s) => Number(s.trim()))).toEqual(ALL);
  });

  it('normalise equal numbers and numeric strings; reject everything else', () => {
    for (const v of ALL) {
      expect(toRuntimeCvOption(v)).toBe(v);
      expect(toRuntimeCvOption(String(v))).toBe(v);
    }
    expect(toRuntimeCvOption(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004
    for (const bad of [0.05, 0.15, 0.25, 0.35, 1.1, 1.5, 2, -0.1, NaN, Infinity, '', ' ', 'abc', true, false, null, undefined, [0.1], { v: 0.1 }]) {
      expect(toRuntimeCvOption(bad)).toBeNull();
    }
  });
});

describe('deadline risk for every option (existing formula, unchanged)', () => {
  it.each(ALL)('cv %s', (cv) => {
    // d = 2 h, start 4, deadline 8 -> slack 2 h
    const r = UncertaintyService.deadlineRisk(4, 2, 8, cv);
    if (cv === 0) {
      expect(r).toMatchObject({ violationRisk: 0, runtimeStdDevHours: 0, model: 'deterministic' });
    } else {
      expect(r.model).toBe('declared-runtime-cv');
      expect(r.runtimeStdDevHours).toBeCloseTo(cv * 2, 12);
      expect(r.violationRisk).toBeCloseTo(1 - normalCdf(2 / (cv * 2)), 12);
    }
    expect(Number.isFinite(r.violationRisk)).toBe(true);
  });

  it('cv = 0 never divides by zero, at any slack', () => {
    for (const t of [0, 5, 6, 6.5, 7, 9]) {
      const v = UncertaintyService.deadlineRisk(t, 2, 8, 0).violationRisk;
      expect([0, 1]).toContain(v);
    }
  });

  it('the engine reports the cv and risk model it used', () => {
    const job: WorkloadJob = {
      id: 'cv-engine', name: 'cv', commandOrImage: 'busybox', isContainerImage: true, durationHours: 2, deadlineHours: 10,
      arrivalHour: 0, cpu: 1, memoryMb: 256, region: 'TEST', riskTolerance: 0.05, createdAt: '2026-11-15T00:00:00.000Z',
    };
    const pts = Array.from({ length: 12 }, (_, i) => ({
      hour: i, timestamp: new Date(Date.UTC(2026, 10, 15, i)).toISOString(), predictedCarbon: 300 - i * 10, carbonIntensity: 300 - i * 10, stdDev: null, uncertaintyStdDev: null,
    })) as any[];
    for (const cv of ALL) {
      const o = SchedulerService.evaluatePolicies(job, pts, { runtimeCv: cv });
      expect(o.runtimeCv).toBe(cv);
      expect(o.riskModel).toBe(cv === 0 ? 'deterministic' : 'declared-runtime-cv');
      for (const w of o.candidateWindows) {
        expect(w.deadlineRisk).toBeCloseTo(UncertaintyService.deadlineRisk(w.slotIndex, 2, 10, cv).violationRisk, 12);
      }
    }
  });
});

describe('API: every option round-trips; unsupported values are rejected', () => {
  it.each(ALL)('cv %s is accepted, stored, shown in the job view and the report', async (cv) => {
    const s = await schedule(cv);
    expect(s.status).toBe(200);
    expect(s.body.data.runtimeCv).toBe(cv);
    expect(s.body.data.riskModel).toBe(cv === 0 ? 'deterministic' : 'declared-runtime-cv');
    const id = s.body.data.job.id;
    const view = (await request(app).get(`/api/jobs/${id}`).set(owner)).body.data;
    expect(view.decision.runtimeCv).toBe(cv);
    const report = (await request(app).get(`/api/jobs/${id}/report`).set(owner)).body.data;
    expect(report.decision.runtimeCv).toBe(cv);
    const html = (await request(app).get(`/api/jobs/${id}/report?format=html`).set(owner)).text;
    expect(html).toContain('Declared runtime CV');
    expect(html).toContain(cv === 0 ? '0 (deterministic runtime)' : `${cv} (declared, not learned)`);
  });

  it('a numeric string such as "0.7" is accepted as 0.7', async () => {
    const s = await schedule('0.7');
    expect(s.status).toBe(200);
    expect(s.body.data.runtimeCv).toBe(0.7);
  });

  it('no cv keeps the default 0 (deterministic)', async () => {
    const s = await schedule(undefined, false);
    expect(s.status).toBe(200);
    expect(s.body.data.runtimeCv).toBe(0);
    expect(s.body.data.riskModel).toBe('deterministic');
  });

  it.each([0.05, 0.25, 0.15, 1.5, 2, -0.1, 'abc', true])('cv %s is rejected with 400 and nothing is scheduled', async (bad) => {
    const before = (await request(app).get('/api/jobs').set(owner)).body.data.length;
    const s = await schedule(bad);
    expect(s.status).toBe(400);
    expect(JSON.stringify(s.body)).toMatch(/runtimeCv must be one of 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1/);
    expect((await request(app).get('/api/jobs').set(owner)).body.data.length).toBe(before);
  });
});
