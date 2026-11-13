/**
 * M1.2: authentication and ownership on job routes (audit C4).
 *
 * Users are created with random names and passwords in this file's temporary database.
 * Tokens are never printed. The simulated execution runner is used (kubectl is disabled).
 */
import crypto from 'crypto';
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null, out?: unknown) => void) => cb(new Error('kubectl disabled in tests')),
  // kubectl is called through execFile (argument arrays) since P0/F10.
  execFile: (...args: unknown[]) =>
    (args[args.length - 1] as (err: Error | null) => void)(new Error('kubectl disabled in tests')),
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import { config } from '../../src/config';
import { db, type User } from '../../src/models/db';
import { schedulingStore } from '../../src/models/schedulingStore';
import { runCreateUser } from '../../src/scripts/createUser';
import { createAndLoginUser, loginAsTestAdmin } from '../support/auth';

type Auth = { Authorization: string };
let owner: { user: User; auth: Auth };
let other: { user: User; auth: Auth };
let evaluator: { user: User; auth: Auth };
let admin: Auth;

const jobBody = {
  name: 'Owner private batch job',
  commandOrImage: 'carbonroute/test-workload:latest',
  durationHours: 1,
  cpu: 1,
  memoryMb: 512,
  region: 'BENCHMARK-RESEARCH',
  riskTolerance: 0.05,
};

/** Schedules a demo job as the given user and returns its id. */
async function scheduleDemoJob(auth: Auth, overrides: Record<string, unknown> = {}): Promise<string> {
  const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
  const res = await request(app)
    .post('/api/schedule')
    .set(auth)
    .send({ mode: 'demo', jobData: { ...jobBody, deadlineAt, ...overrides } });
  expect(res.status).toBe(200);
  expect(res.body.data.status).toBe('RECOMMENDED');
  return res.body.data.job.id as string;
}

/** Every route that takes a job id, with the method used. */
const idRoutes = (id: string): Array<[method: 'get' | 'post', path: string]> => [
  ['get', `/api/jobs/${id}`],
  ['get', `/api/jobs/${id}/status`],
  ['get', `/api/jobs/${id}/results`],
  ['get', `/api/jobs/${id}/manifest?hour=2`],
  ['get', `/api/jobs/${id}/observations`],
  ['post', `/api/jobs/${id}/observations`],
  ['get', `/api/jobs/${id}/report`],
  ['get', `/api/jobs/${id}/report?format=html`],
  ['post', `/api/jobs/${id}/dispatch`],
  ['post', `/api/jobs/${id}/cancel`],
];

const send = (method: 'get' | 'post', path: string, auth?: Auth) => {
  const r = method === 'get' ? request(app).get(path) : request(app).post(path).send({ simulatedDurationSec: 1 });
  return auth ? r.set(auth) : r;
};

const signWith = (secret: string, payload: Record<string, unknown>, options: jwt.SignOptions = {}) =>
  jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '1h', ...options });

beforeAll(async () => {
  owner = await createAndLoginUser(app, 'student');
  other = await createAndLoginUser(app, 'student');
  evaluator = await createAndLoginUser(app, 'evaluator');
  admin = { Authorization: `Bearer ${await loginAsTestAdmin(app)}` };
});

describe('unauthenticated requests', () => {
  it('every job and experiment route answers 401 with a Bearer challenge', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const routes: Array<['get' | 'post', string]> = [
      ['get', '/api/jobs'],
      ['post', '/api/jobs'],
      ['post', '/api/schedule'],
      ['get', '/api/experiments'],
      ['post', '/api/experiments'],
      ...idRoutes(id),
      ...idRoutes('job-does-not-exist'),
    ];
    for (const [method, path] of routes) {
      const res = await send(method, path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
      expect(res.body.code).toBe('UNAUTHENTICATED');
      expect(JSON.stringify(res.body)).not.toContain(jobBody.name);
    }
  });

  it('cannot create, schedule, dispatch or cancel jobs', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const countBefore = (await request(app).get('/api/jobs').set(admin)).body.data.length;
    await request(app).post('/api/jobs').send(jobBody);
    await request(app).post('/api/schedule').send({ mode: 'demo', jobData: jobBody });
    await request(app).post(`/api/jobs/${id}/dispatch`).send({ simulatedDurationSec: 1 });
    await request(app).post(`/api/jobs/${id}/cancel`);
    expect((await request(app).get('/api/jobs').set(admin)).body.data.length).toBe(countBefore);
    const status = await request(app).get(`/api/jobs/${id}/status`).set(owner.auth);
    expect(status.body.data.status).toBe('scheduled');
  });
});

describe('invalid, expired and revoked tokens', () => {
  const claims = () => ({ id: owner.user.id, username: owner.user.username, role: owner.user.role, iatMs: Date.now() });

  it('rejects malformed tokens, a wrong secret, a wrong algorithm, "none" and tokens without an id', async () => {
    const bad = [
      'not-a-jwt',
      signWith(crypto.randomBytes(48).toString('base64url'), claims(), { jwtid: crypto.randomUUID() }),
      jwt.sign(claims(), config.jwtSecret, { algorithm: 'HS512', jwtid: crypto.randomUUID() }),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims(), jti: 'x' })).toString('base64url')}.`,
      signWith(config.jwtSecret, claims()), // valid signature but no jti
    ];
    for (const token of bad) {
      const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects an expired token', async () => {
    const expired = signWith(config.jwtSecret, { ...claims(), iat: Math.floor(Date.now() / 1000) - 120 }, { expiresIn: '1s', jwtid: crypto.randomUUID() });
    const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('rejects a token for a user that no longer exists', async () => {
    const ghost = signWith(config.jwtSecret, { ...claims(), id: crypto.randomUUID() }, { jwtid: crypto.randomUUID() });
    expect((await request(app).get('/api/jobs').set('Authorization', `Bearer ${ghost}`)).status).toBe(401);
  });

  it('a token revoked by logout no longer works; other sessions keep working', async () => {
    const session = await createAndLoginUser(app, 'student');
    const second = await request(app).post('/api/auth/login'); // no credentials: 400, does not affect sessions
    expect(second.status).toBe(400);
    expect((await request(app).get('/api/jobs').set(session.auth)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set(session.auth)).status).toBe(200);
    const after = await request(app).get('/api/jobs').set(session.auth);
    expect(after.status).toBe(401);
    expect(after.body.message).toMatch(/session has ended/);
    expect((await request(app).get('/api/jobs').set(owner.auth)).status).toBe(200);
  });

  it('changing a password revokes every token issued before the change', async () => {
    const u = await createAndLoginUser(app, 'student');
    const newPassword = crypto.randomBytes(18).toString('base64url');
    db.setUserPassword(u.user.username, newPassword, 'test');
    expect((await request(app).get('/api/jobs').set(u.auth)).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ username: u.user.username, password: newPassword });
    expect(login.status).toBe(200);
    expect((await request(app).get('/api/jobs').set('Authorization', `Bearer ${login.body.token}`)).status).toBe(200);
  });
});

describe('job creation assigns the caller as owner', () => {
  it('POST /api/jobs ignores a client-supplied ownerId', async () => {
    const res = await request(app).post('/api/jobs').set(owner.auth).send({ ...jobBody, ownerId: other.user.id });
    expect(res.status).toBe(201);
    expect(res.body.data.ownerId).toBe(owner.user.id);
    expect((await request(app).get(`/api/jobs/${res.body.data.id}`).set(other.auth)).status).toBe(404);
  });

  it('POST /api/schedule stores the owner with the job', async () => {
    const id = await scheduleDemoJob(owner.auth);
    expect(schedulingStore().getJob(id)?.ownerId).toBe(owner.user.id);
  });

  it('a requested id that does not exist is replaced by a server-generated id', async () => {
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const res = await request(app)
      .post('/api/schedule')
      .set(owner.auth)
      .send({ mode: 'demo', jobData: { ...jobBody, id: 'job-chosen-by-client', deadlineAt } });
    expect(res.status).toBe(200);
    expect(res.body.data.job.id).not.toBe('job-chosen-by-client');
    expect(res.body.data.job.id).toMatch(/^job-[0-9a-f]{8}$/);
  });

  it('an owner may re-schedule their own job by id', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const res = await request(app).post('/api/schedule').set(owner.auth).send({ jobId: id, mode: 'demo' });
    expect(res.status).toBe(200);
    expect(res.body.data.job.id).toBe(id);
    expect(schedulingStore().getJob(id)?.ownerId).toBe(owner.user.id);
  });
});

describe('job owners', () => {
  it('can read details, status, manifest, forecasts, observations, execution records and reports, and dispatch', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const details = await request(app).get(`/api/jobs/${id}`).set(owner.auth);
    expect(details.status).toBe(200);
    expect(details.body.data).toMatchObject({ id, name: jobBody.name, ownerId: owner.user.id, status: 'scheduled' });
    expect(details.body.data.decision.snapshotId).toMatch(/^snap-/);
    expect(details.body.data.owner).toBeUndefined(); // owner names are shown to admins only

    expect((await request(app).get(`/api/jobs/${id}/status`).set(owner.auth)).status).toBe(200);
    expect((await request(app).get(`/api/jobs/${id}/manifest?hour=1`).set(owner.auth)).body.data.kind).toBe('Job');

    const dispatch = await request(app).post(`/api/jobs/${id}/dispatch`).set(owner.auth).send({ simulatedDurationSec: 1 });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.data.execution.jobId).toBe(id);
    expect((await request(app).get(`/api/jobs/${id}`).set(owner.auth)).body.data.execution.id).toMatch(/^exe-/);
    expect((await request(app).get(`/api/jobs/${id}/results`).set(owner.auth)).status).toBe(200);

    expect((await request(app).post(`/api/jobs/${id}/observations`).set(owner.auth)).status).toBe(200);
    const obs = await request(app).get(`/api/jobs/${id}/observations`).set(owner.auth);
    expect(obs.status).toBe(200);
    expect(obs.body.data.history.length).toBeGreaterThan(0);

    const report = await request(app).get(`/api/jobs/${id}/report`).set(owner.auth);
    expect(report.status).toBe(200);
    const html = await request(app).get(`/api/jobs/${id}/report?format=html`).set(owner.auth);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toMatch(/text\/html/);
  });
});

describe('authenticated non-owners (IDOR)', () => {
  it('get the same 404 for another user\'s job as for a job that does not exist, with no data leaked', async () => {
    const id = await scheduleDemoJob(owner.auth);
    await request(app).post(`/api/jobs/${id}/dispatch`).set(owner.auth).send({ simulatedDurationSec: 1 });
    for (const who of [other, evaluator]) {
      for (const [[method, path], [, unknownPath]] of idRoutes(id).map((r, i) => [r, idRoutes('job-00000000')[i]] as const)) {
        const res = await send(method, path, who.auth);
        const unknown = await send(method, unknownPath, who.auth);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
        expect(res.body).toEqual(unknown.body);
        expect(res.body).toEqual({ success: false, code: 'JOB_NOT_FOUND', message: 'Job not found.' });
        const text = JSON.stringify(res.body) + (res.text || '');
        expect(text).not.toContain(jobBody.name);
        expect(text).not.toContain(owner.user.username);
      }
    }
  });

  it('cannot dispatch, cancel, re-schedule or attach an experiment to another user\'s job', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const decisionsBefore = schedulingStore().latestDecisionForJob(id)!.id;
    expect((await request(app).post(`/api/jobs/${id}/dispatch`).set(other.auth).send({})).status).toBe(404);
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set(other.auth)).status).toBe(404);
    expect((await request(app).post('/api/schedule').set(other.auth).send({ jobId: id, mode: 'demo' })).status).toBe(404);
    // Hijack attempt: re-use the victim's id inside jobData.
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const hijack = await request(app)
      .post('/api/schedule')
      .set(other.auth)
      .send({ mode: 'demo', jobData: { ...jobBody, id, deadlineAt } });
    expect(hijack.status).toBe(404);
    expect((await request(app).post('/api/experiments').set(other.auth).send({ jobId: id, note: 'x' })).status).toBe(404);

    // Nothing changed for the owner.
    expect(schedulingStore().latestDecisionForJob(id)!.id).toBe(decisionsBefore);
    const status = await request(app).get(`/api/jobs/${id}/status`).set(owner.auth);
    expect(status.body.data.status).toBe('scheduled');
    expect(schedulingStore().getJob(id)?.cancelledAt).toBeUndefined();
  });

  it('changing the id in the URL across many of the owner\'s jobs never succeeds', async () => {
    const ids = await Promise.all([1, 2, 3].map(() => scheduleDemoJob(owner.auth)));
    for (const id of ids) {
      expect((await request(app).get(`/api/jobs/${id}`).set(other.auth)).status).toBe(404);
      expect((await request(app).get(`/api/jobs/${id}/report`).set(other.auth)).status).toBe(404);
    }
  });
});

describe('job listing and filtering', () => {
  it('lists only the caller\'s own jobs, newest first, with status and zone filters', async () => {
    const mine = await scheduleDemoJob(owner.auth);
    const theirs = await scheduleDemoJob(other.auth);
    const list = await request(app).get('/api/jobs').set(owner.auth);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((j: { id: string }) => j.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(list.body.data.every((j: { ownerId: string }) => j.ownerId === owner.user.id)).toBe(true);

    await request(app).post(`/api/jobs/${mine}/cancel`).set(owner.auth);
    const cancelled = await request(app).get('/api/jobs?status=cancelled').set(owner.auth);
    expect(cancelled.body.data.map((j: { id: string }) => j.id)).toContain(mine);
    expect(cancelled.body.data.every((j: { status: string }) => j.status === 'cancelled')).toBe(true);
    expect((await request(app).get('/api/jobs?zone=NOWHERE').set(owner.auth)).body.data).toEqual([]);
    expect((await request(app).get('/api/jobs?owner=me').set(owner.auth)).status).toBe(200);
  });

  it('non-admins cannot list another user\'s jobs with ?owner=', async () => {
    const res = await request(app).get(`/api/jobs?owner=${other.user.username}`).set(owner.auth);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(other.user.id);
  });
});

describe('administrators', () => {
  it('list every job with owner names and can filter by owner', async () => {
    const a = await scheduleDemoJob(owner.auth);
    const b = await scheduleDemoJob(other.auth);
    const all = await request(app).get('/api/jobs').set(admin);
    const byId = new Map(all.body.data.map((j: { id: string }) => [j.id, j]));
    expect(byId.get(a)).toMatchObject({ ownerId: owner.user.id, owner: owner.user.username });
    expect(byId.get(b)).toMatchObject({ ownerId: other.user.id, owner: other.user.username });
    const filtered = await request(app).get(`/api/jobs?owner=${owner.user.username}`).set(admin);
    expect(filtered.body.data.every((j: { ownerId: string }) => j.ownerId === owner.user.id)).toBe(true);
  });

  it('can read and act on any job, and the action is audited; the owner stays the owner', async () => {
    const id = await scheduleDemoJob(owner.auth);
    expect((await request(app).get(`/api/jobs/${id}`).set(admin)).status).toBe(200);
    expect((await request(app).get(`/api/jobs/${id}/report`).set(admin)).status).toBe(200);
    expect((await request(app).post('/api/schedule').set(admin).send({ jobId: id, mode: 'demo' })).status).toBe(200);
    expect(schedulingStore().getJob(id)?.ownerId).toBe(owner.user.id);
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set(admin)).status).toBe(200);
    const logs = (await request(app).get('/api/admin/audit-logs').set(admin)).body.data;
    expect(logs.some((l: { action: string; entityId: string; details: string }) =>
      l.action === 'ADMIN_JOB_ACCESS' && l.entityId === id && /cancelled/.test(l.details))).toBe(true);
  });

  it('only administrators can access jobs stored before M1.2 (no owner)', async () => {
    const legacy = schedulingStore().addJob({
      name: 'pre-M1.2 record',
      commandOrImage: 'x',
      isContainerImage: true,
      zone: 'BENCHMARK-RESEARCH',
      durationHours: 1,
      cpu: 1,
      memoryMb: 512,
      riskTolerance: 0.05,
      arrivalAt: new Date().toISOString(),
      deadlineAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await request(app).get(`/api/jobs/${legacy.id}`).set(owner.auth)).status).toBe(404);
    const asAdmin = await request(app).get(`/api/jobs/${legacy.id}`).set(admin);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.ownerId).toBeNull();
  });

  it('the evaluator role has no administrator rights', async () => {
    expect((await request(app).get('/api/admin/audit-logs').set(evaluator.auth)).status).toBe(403);
    expect((await request(app).get(`/api/jobs?owner=${owner.user.username}`).set(evaluator.auth)).status).toBe(403);
  });
});

describe('cancellation', () => {
  it('cancels a scheduled job; it cannot then be cancelled again, dispatched or re-scheduled', async () => {
    const id = await scheduleDemoJob(owner.auth);
    const res = await request(app).post(`/api/jobs/${id}/cancel`).set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(schedulingStore().getJob(id)?.cancelledBy).toBe(owner.user.username);
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set(owner.auth)).status).toBe(409);
    expect((await request(app).post(`/api/jobs/${id}/dispatch`).set(owner.auth).send({})).status).toBe(409);
    expect((await request(app).post('/api/schedule').set(owner.auth).send({ jobId: id, mode: 'demo' })).status).toBe(409);
    expect((await request(app).get(`/api/jobs/${id}/status`).set(owner.auth)).body.data.status).toBe('cancelled');
  });

  it('stops a running simulated execution', async () => {
    const id = await scheduleDemoJob(owner.auth);
    await request(app).post(`/api/jobs/${id}/dispatch`).set(owner.auth).send({ simulatedDurationSec: 5 });
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set(owner.auth)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    const status = await request(app).get(`/api/jobs/${id}/status`).set(owner.auth);
    expect(status.body.data.status).toBe('cancelled');
    expect(status.body.data.logs.join('\n')).toMatch(/cancelled by/);
    expect(status.body.data.logs.join('\n')).not.toMatch(/Simulated run finished/);
  });

  it('refuses to cancel a finished execution', async () => {
    const id = await scheduleDemoJob(owner.auth);
    await request(app).post(`/api/jobs/${id}/dispatch`).set(owner.auth).send({ simulatedDurationSec: 1 });
    for (let i = 0; i < 40; i++) {
      const s = await request(app).get(`/api/jobs/${id}/status`).set(owner.auth);
      if (s.body.data.status === 'completed') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const res = await request(app).post(`/api/jobs/${id}/cancel`).set(owner.auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('JOB_FINISHED');
  });
});

describe('experiments', () => {
  it('are owned by their creator; server fields cannot be overridden', async () => {
    const res = await request(app)
      .post('/api/experiments')
      .set(owner.auth)
      .send({ note: 'mine', ownerId: other.user.id, id: 'exp-fixed', timestamp: '2000-01-01T00:00:00Z' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ note: 'mine', ownerId: owner.user.id });
    expect(res.body.data.id).not.toBe('exp-fixed');
    expect(res.body.data.timestamp).not.toBe('2000-01-01T00:00:00Z');
    const theirs = (await request(app).get('/api/experiments').set(other.auth)).body.data;
    expect(theirs.some((e: { id: string }) => e.id === res.body.data.id)).toBe(false);
    const all = (await request(app).get('/api/experiments').set(admin)).body.data;
    expect(all.some((e: { id: string }) => e.id === res.body.data.id)).toBe(true);
  });
});

describe('user accounts (npm run user:create)', () => {
  it('creates a user without logging the password, and rejects weak, duplicate or invalid input', () => {
    const log = vi.fn();
    const password = crypto.randomBytes(18).toString('base64url');
    const username = `cli-${crypto.randomBytes(4).toString('hex')}`;
    const env = { NEW_USER_USERNAME: username, NEW_USER_EMAIL: `${username}@example.invalid`, NEW_USER_PASSWORD: password };
    expect(runCreateUser(env, db, log)).toBe(0);
    expect(db.getUserByUsername(username)?.role).toBe('student');
    expect(JSON.stringify(log.mock.calls)).not.toContain(password);
    expect(runCreateUser(env, db, log)).toBe(1); // duplicate
    expect(runCreateUser({ ...env, NEW_USER_USERNAME: 'weakpw-user', NEW_USER_EMAIL: 'w@example.invalid', NEW_USER_PASSWORD: 'short' }, db, log)).toBe(1);
    expect(runCreateUser({ ...env, NEW_USER_USERNAME: 'badrole-user', NEW_USER_EMAIL: 'b@example.invalid', NEW_USER_ROLE: 'root' }, db, log)).toBe(1);
    expect(runCreateUser({}, db, log)).toBe(2);
  });
});
