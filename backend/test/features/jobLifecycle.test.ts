/**
 * P8 job lifecycle: submit -> validate -> persist -> schedule -> explanation -> view -> dispatch
 * (simulated, labelled) -> status -> results, and the defects found in the P8 audit:
 *  L1 execution status lived only in memory: after a restart a completed job showed as "scheduled";
 *  L2 a job could be dispatched again while running or after completing (duplicate executions);
 *  L3 a job without a recommended window (infeasible or never scheduled) could be dispatched.
 * Demo mode (synthetic trace) is used, so no provider is called; no cluster is available, so every
 * execution is simulated and must say so.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('child_process', () => ({
  exec: (_c: string, cb: (e: Error) => void) => cb(new Error('exec must not be used')),
  execFile: (_f: string, _a: string[], _o: unknown, cb: (e: Error) => void) => cb(new Error('no cluster')),
}));

const H = 3600_000;
let app: Express;
let K8s: typeof import('../../src/services/k8sConnector').K8sConnector;
let store: typeof import('../../src/models/schedulingStore').schedulingStore;
let owner: { Authorization: string };
let other: { Authorization: string };

beforeAll(async () => {
  ({ default: app } = await import('../../src/app'));
  K8s = (await import('../../src/services/k8sConnector')).K8sConnector;
  store = (await import('../../src/models/schedulingStore')).schedulingStore;
  const { createAndLoginUser } = await import('../support/auth');
  owner = (await createAndLoginUser(app)).auth;
  other = (await createAndLoginUser(app)).auth;
});

const schedule = (jobData: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/schedule')
    .set(owner)
    .send({
      mode: 'demo',
      jobData: { name: 'lifecycle', commandOrImage: 'busybox', isContainerImage: true, durationHours: 2, cpu: 2, memoryMb: 256, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt: new Date(Date.now() + 14 * H).toISOString(), ...jobData },
      ...extra,
    });
const status = async (id: string) => (await request(app).get(`/api/jobs/${id}`).set(owner)).body.data.status as string;
async function waitForStatus(id: string, want: string, ms = 15_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await status(id)) === want) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`job ${id} did not reach ${want}; last ${await status(id)}`);
}

describe('complete job lifecycle (simulated execution)', () => {
  it('validates input before anything is stored', async () => {
    const before = (await request(app).get('/api/jobs').set(owner)).body.data.length;
    expect((await schedule({ durationHours: -1 })).status).toBe(400);
    expect((await schedule({ riskTolerance: 2 })).status).toBe(400);
    expect((await schedule({ deadlineAt: '2026-11-14 18:00' })).status).toBe(400); // no time zone
    expect((await request(app).get('/api/jobs').set(owner)).body.data.length).toBe(before);
  });

  it('schedules, explains, shows the job with all its fields, dispatches once, persists the outcome across a restart', async () => {
    const s = await schedule({ name: 'full lifecycle' }, { runtimeCv: 0.1 });
    expect(s.status).toBe(200);
    const d = s.body.data;
    expect(d.status).toBe('RECOMMENDED');
    expect(d.explanation.summary).toBeTruthy();
    const id = d.job.id;

    // View: the owner sees every field; another user gets 404.
    const view = (await request(app).get(`/api/jobs/${id}`).set(owner)).body.data;
    expect(view).toMatchObject({ id, status: 'scheduled' });
    expect(view.ownerId).toBeTruthy();
    expect(view.createdAt).toBeTruthy();
    expect(view.decision.runtimeCv).toBe(0.1);
    expect(view.decision.recommendedWindow.startUtc).toBeTruthy();
    expect(view.decision.policies.find((p: any) => p.recommended).forecastIntensity).toBeGreaterThan(0); // predicted carbon intensity
    expect(view.decision.dataClass).toBe('synthetic');
    expect((await request(app).get(`/api/jobs/${id}`).set(other)).status).toBe(404);

    // Dispatch: simulated, and labelled so.
    const disp = await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({ simulatedDurationSec: 1 });
    expect(disp.status).toBe(200);
    expect(disp.body.data.clusterMode).toBe('offline_fallback');
    expect(disp.body.data.execution.executionMode).toBe('simulated-no-workload');
    expect(disp.body.message).toMatch(/simulated/);

    // L2: no second dispatch while it is waiting or running.
    expect((await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({})).body.code).toBe('JOB_ALREADY_DISPATCHED');

    await waitForStatus(id, 'completed');
    const persisted = store().latestExecutionForJob(id)!;
    expect(persisted.status).toBe('completed');
    expect(persisted.finishedAt).toBeTruthy();
    expect(persisted.measuredEnergyKwh).toBeUndefined(); // simulated: no energy is invented

    // L1: a restart forgets in-memory executions; the persisted status remains.
    K8s.forgetExecutionsForTests();
    expect(await status(id)).toBe('completed');
    expect((await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({})).status).toBe(409);
    const cancel = await request(app).post(`/api/jobs/${id}/cancel`).set(owner);
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('JOB_FINISHED');

    // Results and report remain available to the owner.
    expect((await request(app).get(`/api/jobs/${id}/report`).set(owner)).status).toBe(200);
  }, 30_000);

  it('a run cut off by a restart is reported as interrupted (never completed) and may be dispatched again', async () => {
    const id = (await schedule({ name: 'interrupted' })).body.data.job.id;
    await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({ simulatedDurationSec: 120 });
    await waitForStatus(id, 'running');
    K8s.forgetExecutionsForTests(); // the server stops mid-run
    expect(await status(id)).toBe('interrupted');
    const again = await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({ simulatedDurationSec: 1 });
    expect(again.status).toBe(200);
    const execs = (store() as any).data.executions.filter((e: any) => e.jobId === id);
    expect(execs.map((e: any) => e.status)).toEqual(['interrupted', expect.stringMatching(/scheduled|running|completed/)]);
    await waitForStatus(id, 'completed');
  }, 30_000);

  it('cancelling records the cancellation on the stored execution too', async () => {
    const id = (await schedule({ name: 'cancel me' })).body.data.job.id;
    await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({ simulatedDurationSec: 120 });
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set(owner)).status).toBe(200);
    expect(store().latestExecutionForJob(id)!.status).toBe('cancelled');
    K8s.forgetExecutionsForTests();
    expect(await status(id)).toBe('cancelled');
    expect((await request(app).post(`/api/jobs/${id}/dispatch`).set(owner).send({})).status).toBe(409); // JOB_CANCELLED
  });
});

describe('L3: no dispatch without a recommended window', () => {
  it('an infeasible job cannot be dispatched', async () => {
    const s = await schedule({ name: 'impossible', deadlineAt: new Date(Date.now() + 1 * H).toISOString() });
    expect(s.body.data.status).toBe('INFEASIBLE');
    const r = await request(app).post(`/api/jobs/${s.body.data.job.id}/dispatch`).set(owner).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NO_RECOMMENDATION');
    expect(store().latestExecutionForJob(s.body.data.job.id)).toBeUndefined();
  });

  it('a registered but never scheduled job cannot be dispatched', async () => {
    const reg = await request(app).post('/api/jobs').set(owner).send({ name: 'registered only', commandOrImage: 'busybox', isContainerImage: true, durationHours: 1, cpu: 1, memoryMb: 128, region: 'DE' });
    expect([200, 201]).toContain(reg.status);
    const r = await request(app).post(`/api/jobs/${reg.body.data.id}/dispatch`).set(owner).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NO_RECOMMENDATION');
  });
});
