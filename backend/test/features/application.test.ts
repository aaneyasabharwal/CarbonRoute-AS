/**
 * P4 application APIs: decision explanations, job details for the job-management UI, and
 * historical benchmark results. Users and result files are created in temporary folders.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('child_process', () => ({
  exec: (_c: string, cb: (e: Error | null) => void) => cb(new Error('kubectl disabled in tests')),
  execFile: (...a: unknown[]) => (a[a.length - 1] as (e: Error | null) => void)(new Error('kubectl disabled in tests')),
}));

import request from 'supertest';
import app from '../../src/app';
import { SchedulerService, WorkloadJob } from '../../src/services/schedulerService';
import { createAndLoginUser } from '../support/auth';

const pts = (values: number[]) =>
  values.map((v, i) => ({ hour: i, timestamp: new Date(Date.UTC(2026, 10, 14, i)).toISOString(), predictedCarbon: v, carbonIntensity: v, stdDev: null, uncertaintyStdDev: null })) as any[];
const job = (over: Partial<WorkloadJob> = {}): WorkloadJob => ({
  id: 'j', name: 'x', commandOrImage: 'busybox', isContainerImage: true, durationHours: 2, deadlineHours: 8, arrivalHour: 0,
  cpu: 2, memoryMb: 128, region: 'T', riskTolerance: 0.05, createdAt: '2026-11-14T00:00:00Z', ...over,
});
const F = pts([300, 200, 100, 250, 50, 400, 120, 80]); // window averages: t6 = 100 is the minimum

describe('decision explanation', () => {
  it('no binding constraint when the lowest-forecast window is within tolerance', () => {
    const o = SchedulerService.evaluatePolicies(job(), F);
    expect(o.explanation).toMatchObject({ bindingConstraint: 'none', candidates: { total: 7, feasible: 7, rejectedHighRisk: 0, rejectedDataGap: 0 } });
    expect(o.explanation!.summary).toMatch(/lowest forecast intensity \(100 gCO2eq\/kWh\) of the 7 windows/);
    expect(o.explanation!.policies.find((p) => p.policyId === 'edf')!.relation).toMatch(/Same window as immediate/);
    expect(o.explanation!.unavailable.map((u) => u.policyId)).toEqual(['cost_aware', 'oracle']);
  });

  it('risk tolerance is binding when it moves the decision away from the lowest-forecast window', () => {
    const o = SchedulerService.evaluatePolicies(job(), F, { runtimeCv: 0.25 });
    expect(o.explanation!.bindingConstraint).toBe('risk-tolerance');
    expect(o.explanation!.summary).toMatch(/T\+6:00 to T\+8:00, 100 gCO2eq\/kWh\) has a deadline-miss risk of 50\.0%/);
    expect(o.explanation!.candidates.rejectedHighRisk).toBeGreaterThan(0);
    expect(o.explanation!.policies.find((p) => p.policyId === 'deterministic_carbon')!.relation).toMatch(/lower forecast than CarbonRoute, but above the risk tolerance/);
  });

  it('infeasible outcomes are explained without a recommendation', () => {
    const o = SchedulerService.evaluatePolicies(job({ riskTolerance: 0.001 }), F, { runtimeCv: 1 });
    expect(o.status).toBe('INFEASIBLE_RISK');
    expect(o.explanation).toMatchObject({ bindingConstraint: 'risk-tolerance' });
    const none = SchedulerService.evaluatePolicies(job({ deadlineHours: 1 }), F);
    expect(none.explanation!.bindingConstraint).toBe('deadline');
  });
});

describe('job details for the job-management UI', () => {
  let owner: { Authorization: string };
  let other: { Authorization: string };
  beforeAll(async () => {
    owner = (await createAndLoginUser(app)).auth;
    other = (await createAndLoginUser(app)).auth;
  });

  it('returns the stored policy comparison, explanation, provenance and observation summary', async () => {
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const sched = await request(app)
      .post('/api/schedule')
      .set(owner)
      .send({ mode: 'demo', jobData: { name: 'ui job', commandOrImage: 'busybox', durationHours: 2, cpu: 2, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    expect(sched.status).toBe(200);
    expect(sched.body.data.explanation.objective).toMatch(/Minimise forecast carbon intensity/);
    const id = sched.body.data.job.id;

    const d1 = await request(app).get(`/api/jobs/${id}`).set(owner);
    const decision = d1.body.data.decision;
    expect(decision.policies.length).toBe(5);
    expect(decision.policies.filter((p: any) => p.recommended)).toHaveLength(1);
    expect(decision.policies.find((p: any) => p.policyId === 'edf').equivalentTo).toBe('immediate');
    expect(decision.unavailablePolicies.find((u: any) => u.policyId === 'oracle').reason).toMatch(/Offline evaluation only/);
    expect(decision.explanation.bindingConstraint).toBe('none');
    expect(decision.provenance.dataClass).toBe('synthetic');
    expect(decision.energyAssumption.basis).toMatch(/Not measured/);
    expect(d1.body.data.observations).toBeNull();

    await request(app).post(`/api/jobs/${id}/observations`).set(owner);
    const d2 = await request(app).get(`/api/jobs/${id}`).set(owner);
    expect(d2.body.data.observations).toMatchObject({ status: 'NOT_APPLICABLE_SYNTHETIC', measured: 0, providerEstimate: 0, attempts: 1 });

    expect((await request(app).get(`/api/jobs/${id}`).set(other)).status).toBe(404);
  });
});

describe('historical benchmark results', () => {
  let auth: { Authorization: string };
  const dir = () => process.env.BENCHMARK_RESULTS_DIR!;
  const result = (createdAt: string) => ({
    kind: 'carbonroute-replay-benchmark',
    dataClass: 'real-carbon-data-synthetic-workloads',
    createdAt,
    gitCommit: 'abc',
    config: { seed: 42, workloadsPerSnapshot: 5 },
    configSha256: 'c',
    dataset: { sha256: 'd', files: [], zones: ['DE'], snapshots: 2, realizedIntervals: 48, measuredShare: 0.75 },
    scenarios: [{ runtimeCv: 0, workloads: 10, infeasible: 0, pendingRealized: 3, oracleAvailable: 2, policies: [] }],
    notes: ['n'],
    workloads: [{ secretish: 'not returned' }],
  });

  beforeAll(async () => {
    auth = (await createAndLoginUser(app)).auth;
  });

  it('requires sign-in and is empty when no results exist', async () => {
    expect((await request(app).get('/api/results/benchmarks')).status).toBe(401);
    const res = await request(app).get('/api/results/benchmarks').set(auth);
    expect(res.body.data).toEqual([]);
  });

  it('lists valid result files newest first and serves one without per-workload rows', async () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), 'benchmark-2026-11-13T10-00-00-000Z.json'), JSON.stringify(result('2026-11-13T10:00:00.000Z')));
    fs.writeFileSync(path.join(dir(), 'benchmark-2026-11-14T10-00-00-000Z.json'), JSON.stringify(result('2026-11-14T10:00:00.000Z')));
    fs.writeFileSync(path.join(dir(), 'notes.json'), '{}');
    fs.writeFileSync(path.join(dir(), 'benchmark-2026-11-15T10-00-00-000Z.json'), JSON.stringify({ kind: 'something-else' }));
    const list = await request(app).get('/api/results/benchmarks').set(auth);
    expect(list.body.data.map((r: any) => r.id)).toEqual(['benchmark-2026-11-14T10-00-00-000Z', 'benchmark-2026-11-13T10-00-00-000Z']);
    expect(list.body.data[0]).toMatchObject({ dataClass: 'real-carbon-data-synthetic-workloads', seed: 42, dataset: { measuredShare: 0.75 } });

    const one = await request(app).get('/api/results/benchmarks/benchmark-2026-11-14T10-00-00-000Z').set(auth);
    expect(one.status).toBe(200);
    expect(one.body.data.workloads).toBeUndefined();
    expect(one.body.data.scenarios[0].pendingRealized).toBe(3);
  });

  it('refuses unknown or path-like ids', async () => {
    for (const id of ['benchmark-nope-nope-nope', '..%2F..%2Fdatabase%2Fcarbonroute.db', 'notes']) {
      expect((await request(app).get(`/api/results/benchmarks/${id}`).set(auth)).status).toBe(404);
    }
  });
});

describe('failed scheduling attempts leave nothing behind (P4)', () => {
  it('a live-data failure (no key) stores no job, so no phantom "pending" job appears', async () => {
    const auth = (await createAndLoginUser(app)).auth;
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const res = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'live', jobData: { name: 'live without key', commandOrImage: 'busybox', durationHours: 1, cpu: 1, riskTolerance: 0.05, region: 'DE', deadlineAt } });
    expect(res.status).toBe(503);
    expect((await request(app).get('/api/jobs').set(auth)).body.data).toEqual([]);
  });

  it('an impossible deadline is still stored as an INFEASIBLE decision (it needs no forecast)', async () => {
    const auth = (await createAndLoginUser(app)).auth;
    const res = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'live', jobData: { name: 'too late', commandOrImage: 'busybox', durationHours: 3, cpu: 1, riskTolerance: 0.05, region: 'DE', deadlineAt: new Date(Date.now() + 3600_000).toISOString() } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INFEASIBLE');
    const jobs = (await request(app).get('/api/jobs').set(auth)).body.data;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('infeasible');
  });
});

describe('P4 review: the explanation quotes the same numbers as the policy comparison', () => {
  it('with a mid-hour arrival, every relation equals the difference of the displayed (time-weighted) values, and the deadline is in UTC', async () => {
    const { scheduleWorkflow } = await import('../../src/services/schedulingWorkflow');
    const { SchedulingStore } = await import('../../src/models/schedulingStore');
    const os = await import('os');
    const store = new SchedulingStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carbonroute-expl-')), 's.json'));
    const H = 3600_000;
    const now = Math.floor(Date.now() / H) * H + 40 * 60_000; // 40 minutes into the hour
    const out: any = await scheduleWorkflow(
      { name: 'mid-hour', commandOrImage: 'busybox', isContainerImage: true, zone: 'BENCHMARK-RESEARCH', durationHours: 2, cpu: 2, memoryMb: 128, riskTolerance: 0.05, deadlineAt: new Date(now + 12 * H).toISOString(), mode: 'demo' },
      { store, now: () => now }
    );
    expect(out.status).toBe('RECOMMENDED');
    const shown = Object.fromEntries(out.evaluatedPolicies.map((p: any) => [p.policyId, p.forecastIntensityTimeWeighted]));
    const imm = out.evaluatedPolicies.find((p: any) => p.policyId === 'immediate');
    // The Immediate window starts mid-hour, so its time-weighted value differs from the slot average.
    expect(imm.forecastIntensityTimeWeighted).not.toBe(imm.predictedCarbonIntensity);
    const recValue = shown.carbonroute_uncertainty;
    for (const rel of out.explanation.policies) {
      const m = /^([\d.]+) gCO2eq\/kWh (higher|lower)/.exec(rel.relation);
      if (!m) continue;
      const expected = Math.abs(shown[rel.policyId] - recValue).toFixed(2);
      expect(m[1], rel.policyId).toBe(expected);
    }
    expect(out.explanation.summary).toContain(String(recValue));
    expect(out.explanation.constraints[0].value).toMatch(/^the window must end by \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(2 h job\)$/);
    expect(out.explanation.constraints.find((c: any) => c.name === 'Intensities in this explanation').value).toMatch(/time-weighted/);
    // The stored job details give the table the same values.
    const stored = store.latestDecisionForJob(out.job.id)!.result;
    expect(stored.explanation).toEqual(out.explanation);
  });
});

describe('P4 review: admin access to enriched job details', () => {
  it('an admin sees another user\'s explanation and comparison (with the owner name); another user gets 404', async () => {
    const { loginAsTestAdmin } = await import('../support/auth');
    const owner = (await createAndLoginUser(app)).auth;
    const stranger = (await createAndLoginUser(app)).auth;
    const admin = { Authorization: `Bearer ${await loginAsTestAdmin(app)}` };
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const sched = await request(app)
      .post('/api/schedule')
      .set(owner)
      .send({ mode: 'demo', jobData: { name: 'owned', commandOrImage: 'busybox', durationHours: 1, cpu: 1, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    const id = sched.body.data.job.id;
    const asAdmin = await request(app).get(`/api/jobs/${id}`).set(admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.owner).toBeTruthy();
    expect(asAdmin.body.data.decision.explanation).toEqual(sched.body.data.explanation);
    expect(asAdmin.body.data.decision.policies.length).toBe(5);
    const asStranger = await request(app).get(`/api/jobs/${id}`).set(stranger);
    expect(asStranger.status).toBe(404);
    expect(JSON.stringify(asStranger.body)).not.toContain('owned');
  });
});
