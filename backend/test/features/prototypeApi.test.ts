/**
 * Current behaviour of the prototype scheduling API routes.
 * Valid behaviour is asserted directly; behaviour the audit flagged is in the
 * describe blocks tagged [legacy] and will be changed by the cited tasks.
 * Since M1.2 every job route needs a token: these tests run as an ordinary (non-admin)
 * user. Ownership and authentication cases are in test/security/jobAccess.test.ts.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null, out?: unknown) => void) =>
    cb(new Error('kubectl disabled in tests')),
  // kubectl is called through execFile (argument arrays) since P0/F10.
  execFile: (...args: unknown[]) =>
    (args[args.length - 1] as (err: Error | null) => void)(new Error('kubectl disabled in tests')),
}));

import request from 'supertest';
import app from '../../src/app';
import { createAndLoginUser } from '../support/auth';

let authHeader: { Authorization: string } = { Authorization: '' };
const auth = () => authHeader;
beforeAll(async () => {
  authHeader = (await createAndLoginUser(app, 'student')).auth;
});

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
    const ok = await request(app).post('/api/jobs').set(auth()).send(jobBody);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ name: 'Test batch job', status: 'pending', region: 'US-CAL-CISO' });
    expect(ok.body.data.id).toMatch(/^job-/);

    expect((await request(app).post('/api/jobs').set(auth()).send({ commandOrImage: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/jobs').set(auth()).send({ name: 'x' })).status).toBe(400);
  });

  it('schedules a registered job in explicit demo mode', async () => {
    const job = await request(app).post('/api/jobs').set(auth()).send(jobBody);
    const res = await request(app).post('/api/schedule').set(auth()).send({ jobId: job.body.data.id, mode: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.data.dataMode).toBe('demo');
    expect(res.body.data.evaluatedPolicies).toHaveLength(5);
    expect(res.body.data.recommendedDecision.policyId).toBe('carbonroute_uncertainty');

    const status = await request(app).get(`/api/jobs/${job.body.data.id}/status`).set(auth());
    expect(status.body.data.status).toBe('scheduled');
  });

  it('returns 503 in live mode without an Electricity Maps key (no silent demo fallback)', async () => {
    const res = await request(app).post('/api/schedule').set(auth()).send({ jobData: jobBody });
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('Live carbon forecast unavailable');
  });

  it('requires jobId or jobData to schedule', async () => {
    expect((await request(app).post('/api/schedule').set(auth()).send({})).status).toBe(400);
  });

  it('returns a batch/v1 manifest with the job resources', async () => {
    const job = await request(app).post('/api/jobs').set(auth()).send(jobBody);
    const res = await request(app).get(`/api/jobs/${job.body.data.id}/manifest?hour=3`).set(auth());
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.apiVersion).toBe('batch/v1');
    expect(m.kind).toBe('Job');
    expect(m.metadata.labels['carbonroute.io/scheduled-hour']).toBe('T+3');
    expect(m.spec.template.spec.containers[0].resources.limits).toEqual({ cpu: '2', memory: '1024Mi' });
  });

  it('returns 404 for status and results of an unknown job', async () => {
    expect((await request(app).get('/api/jobs/job-unknown/status').set(auth())).status).toBe(404);
    expect((await request(app).get('/api/jobs/job-unknown/results').set(auth())).status).toBe(404);
  });

  it('reports the cluster as unavailable when kubectl fails', async () => {
    const res = await request(app).get('/api/cluster/health');
    expect(res.status).toBe(200);
    expect(res.body.data.isAvailable).toBe(false);
  });
});

describe('carbon data API', () => {
  // Changed in M5 (audit: hardcoded demo regions presented as live coverage). Live mode now
  // lists the zones the Electricity Maps key can access; the demo profiles are listed only
  // in demo mode and labelled synthetic.
  it('lists the synthetic demo regions in demo mode, labelled as such', async () => {
    const res = await request(app).get('/api/carbon/regions?mode=demo');
    expect(res.body.source).toBe('synthetic-demo-profiles');
    expect(res.body.data.map((r: { code: string }) => r.code)).toEqual(
      expect.arrayContaining(['US-CAL-CISO', 'US-TEX-ERCO', 'DE', 'IN-NO'])
    );
  });

  it('in live mode without a key reports the provider error instead of the demo list', async () => {
    const res = await request(app).get('/api/carbon/regions').set(auth());
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('NO_API_KEY');
    expect(res.body.data).toBeUndefined();
  });

  it('serves a demo forecast and refuses a live one without a key', async () => {
    const demo = await request(app).get('/api/carbon/forecast?region=DE&mode=demo&horizon=12');
    expect(demo.status).toBe(200);
    expect(demo.body.data.dataMode).toBe('demo');
    expect(demo.body.data.hourlyProfile).toHaveLength(12);

    expect((await request(app).get('/api/carbon/forecast?region=DE').set(auth())).status).toBe(503);
  });
});

describe('M5 workflow routes', () => {
  it('schedule -> dispatch -> observations -> report (demo data is labelled synthetic end to end)', async () => {
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const sched = await request(app)
      .post('/api/schedule').set(auth())
      .send({ mode: 'demo', jobData: { ...jobBody, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    expect(sched.status).toBe(200);
    const d = sched.body.data;
    expect(d.status).toBe('RECOMMENDED');
    expect(d.decisionId).toMatch(/^dec-/);
    expect(d.provenance.dataClass).toBe('synthetic');
    expect(Date.parse(d.recommendedWindow.endUtc)).toBeLessThanOrEqual(Date.parse(deadlineAt));

    const dispatch = await request(app).post(`/api/jobs/${d.job.id}/dispatch`).set(auth()).send({ simulatedDurationSec: 1 });
    expect(dispatch.body.data.execution).toMatchObject({ executionMode: 'simulated-no-workload', scheduledStartUtc: d.recommendedWindow.startUtc });

    const obs = await request(app).post(`/api/jobs/${d.job.id}/observations`).set(auth());
    expect(obs.body.data.collected.status).toBe('NOT_APPLICABLE_SYNTHETIC');

    const report = await request(app).get(`/api/jobs/${d.job.id}/report`).set(auth());
    expect(report.body.data.dataClass).toBe('synthetic');
    const html = await request(app).get(`/api/jobs/${d.job.id}/report?format=html`).set(auth());
    expect(html.headers['content-type']).toMatch(/text\/html/);
    expect(html.headers['content-disposition']).toMatch(/attachment; filename="carbonroute-report-/);
  });

  it('returns an explicit INFEASIBLE decision when the deadline is too close', async () => {
    const res = await request(app)
      .post('/api/schedule').set(auth())
      .send({ mode: 'demo', jobData: { ...jobBody, durationHours: 3, deadlineAt: new Date(Date.now() + 3600_000).toISOString() } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'INFEASIBLE', recommendation: null });
  });

  it('rejects invalid input with 400 and invalid zones with 422', async () => {
    expect((await request(app).post('/api/schedule').set(auth()).send({ mode: 'demo', jobData: { ...jobBody, durationHours: 2.5 } })).status).toBe(400);
    const badZone = await request(app).get('/api/carbon/latest?zone=not-a-zone!').set(auth());
    expect(badZone.status).toBe(422);
    expect(badZone.body.code).toBe('INVALID_PARAMETER');
  });

  it('exposes provider status without the key', async () => {
    const res = await request(app).get('/api/carbon/provider');
    expect(res.body.data).toMatchObject({ provider: 'electricitymaps', configured: false, pastRangeAvailable: false, historyWindowHours: 24 });
    expect(JSON.stringify(res.body)).not.toMatch(/auth-token/i);
  });

  it('report and observations for an unknown job are 404', async () => {
    expect((await request(app).get('/api/jobs/job-nope/report').set(auth())).status).toBe(404);
    expect((await request(app).post('/api/jobs/job-nope/observations').set(auth())).status).toBe(404);
  });
});

describe('behaviour fixed after the audit', () => {
  // Audit C2, task M2.2 (done in M5): the two pre-filled "Completed" records with invented
  // realized-carbon values were removed. The list now starts empty.
  it('GET /api/experiments starts empty (no pre-filled records)', async () => {
    const res = await request(app).get('/api/experiments').set(auth());
    expect(res.body.data).toEqual([]);
  });

  // Audit C4, task M1.2: this test used to assert that job submission, scheduling, dispatch
  // and experiment recording need no authentication. They now all require a token.
  it('job submission, scheduling, dispatch and experiment recording require authentication', async () => {
    expect((await request(app).post('/api/jobs').send(jobBody)).status).toBe(401);
    expect((await request(app).post('/api/schedule').send({ mode: 'demo', jobData: jobBody })).status).toBe(401);
    const job = await request(app).post('/api/jobs').set(auth()).send(jobBody);
    expect(job.status).toBe(201);
    const dispatch = await request(app)
      .post(`/api/jobs/${job.body.data.id}/dispatch`)
      .send({ predictedCarbon: 150, simulatedDurationSec: 1 });
    expect(dispatch.status).toBe(401);
    expect((await request(app).post('/api/experiments').send({ note: 'anon' })).status).toBe(401);
  });
});
