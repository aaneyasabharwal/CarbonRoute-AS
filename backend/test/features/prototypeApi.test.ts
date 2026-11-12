/**
 * Current behaviour of the prototype scheduling API routes.
 * Valid behaviour is asserted directly; behaviour the audit flagged is in the
 * describe blocks tagged [legacy] and will be changed by the cited tasks.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null, out?: unknown) => void) =>
    cb(new Error('kubectl disabled in tests')),
}));

import request from 'supertest';
import app from '../../src/app';

const jobBody = {
  name: 'Test batch job',
  commandOrImage: 'carbonroute/test-workload:latest',
  durationHours: 2,
  deadlineHours: 12,
  cpu: 2,
  memoryMb: 1024,
  region: 'US-CAL-CISO',
  riskTolerance: 0.05,
};

describe('prototype job API', () => {
  it('registers a job and rejects one without a name or command', async () => {
    const ok = await request(app).post('/api/jobs').send(jobBody);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ name: 'Test batch job', status: 'pending', region: 'US-CAL-CISO' });
    expect(ok.body.data.id).toMatch(/^job-/);

    expect((await request(app).post('/api/jobs').send({ commandOrImage: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/jobs').send({ name: 'x' })).status).toBe(400);
  });

  it('schedules a registered job in explicit demo mode', async () => {
    const job = await request(app).post('/api/jobs').send(jobBody);
    const res = await request(app).post('/api/schedule').send({ jobId: job.body.data.id, mode: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.data.dataMode).toBe('demo');
    expect(res.body.data.evaluatedPolicies).toHaveLength(5);
    expect(res.body.data.recommendedDecision.policyId).toBe('carbonroute_uncertainty');

    const status = await request(app).get(`/api/jobs/${job.body.data.id}/status`);
    expect(status.body.data.status).toBe('scheduled');
  });

  it('returns 503 in live mode without an Electricity Maps key (no silent demo fallback)', async () => {
    const res = await request(app).post('/api/schedule').send({ jobData: jobBody });
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('Live carbon forecast unavailable');
  });

  it('requires jobId or jobData to schedule', async () => {
    expect((await request(app).post('/api/schedule').send({})).status).toBe(400);
  });

  it('returns a batch/v1 manifest with the job resources', async () => {
    const job = await request(app).post('/api/jobs').send(jobBody);
    const res = await request(app).get(`/api/jobs/${job.body.data.id}/manifest?hour=3`);
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.apiVersion).toBe('batch/v1');
    expect(m.kind).toBe('Job');
    expect(m.metadata.labels['carbonroute.io/scheduled-hour']).toBe('T+3');
    expect(m.spec.template.spec.containers[0].resources.limits).toEqual({ cpu: '2', memory: '1024Mi' });
  });

  it('returns 404 for status and results of an unknown job', async () => {
    expect((await request(app).get('/api/jobs/job-unknown/status')).status).toBe(404);
    expect((await request(app).get('/api/jobs/job-unknown/results')).status).toBe(404);
  });

  it('reports the cluster as unavailable when kubectl fails', async () => {
    const res = await request(app).get('/api/cluster/health');
    expect(res.status).toBe(200);
    expect(res.body.data.isAvailable).toBe(false);
  });
});

describe('carbon data API', () => {
  it('lists the configured regions', async () => {
    const res = await request(app).get('/api/carbon/regions');
    expect(res.body.data.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['US-CAL-CISO', 'US-TEX-ERCO', 'DE', 'IN-NO'])
    );
  });

  it('serves a demo forecast and refuses a live one without a key', async () => {
    const demo = await request(app).get('/api/carbon/forecast?region=DE&mode=demo&horizon=12');
    expect(demo.status).toBe(200);
    expect(demo.body.data.dataMode).toBe('demo');
    expect(demo.body.data.hourlyProfile).toHaveLength(12);

    expect((await request(app).get('/api/carbon/forecast?region=DE')).status).toBe(503);
  });
});

describe('[legacy] behaviour flagged by the audit', () => {
  // Audit C2 -> task M2.2 removes these seeded records.
  it('GET /api/experiments starts with two pre-filled "Completed" records', async () => {
    const res = await request(app).get('/api/experiments');
    expect(res.body.data.map((e: { id: string }) => e.id)).toEqual(
      expect.arrayContaining(['exp-init-001', 'exp-init-002'])
    );
  });

  // Audit C4 -> task M1.2 adds authentication to these routes.
  it('job submission, scheduling, dispatch and experiment recording need no authentication', async () => {
    const job = await request(app).post('/api/jobs').send(jobBody);
    expect(job.status).toBe(201);
    const dispatch = await request(app)
      .post(`/api/jobs/${job.body.data.id}/dispatch`)
      .send({ predictedCarbon: 150, simulatedDurationSec: 1 });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.data.clusterMode).toBe('offline_fallback');
    expect((await request(app).post('/api/experiments').send({ note: 'anon' })).status).toBe(201);
  });
});
