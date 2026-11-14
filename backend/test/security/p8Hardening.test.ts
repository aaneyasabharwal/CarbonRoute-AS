/**
 * P8 security review regression tests:
 *  S1  login does the same bcrypt work for unknown users and wrong passwords (no enumeration)
 *  S2  public cluster status never exposes kubectl output and does not spawn kubectl per request
 *  S3  public compute endpoints are rate limited per address
 *  S4  unexpected server errors never reach the client (generic message + reference id)
 *  S7  password change: requires the current password, invalidates every older token
 *  S8  account creation and listing are administrator-only and never return password hashes
 */
import crypto from 'crypto';
import express from 'express';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const kubectlCalls: string[][] = [];
vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null) => void) => cb(new Error('exec must not be used')),
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    kubectlCalls.push([file, ...args]);
    if (args[0] === 'cluster-info') {
      return cb(null, { stdout: 'Kubernetes control plane is running at https://10.1.2.3:6443\nCoreDNS is running', stderr: '' });
    }
    return cb(new Error('not simulated'));
  },
}));

let app: Express;
let db: typeof import('../../src/models/db').db;
let auth: typeof import('../support/auth');

beforeAll(async () => {
  ({ default: app } = await import('../../src/app'));
  ({ db } = await import('../../src/models/db'));
  auth = await import('../support/auth');
});

describe('S1: login timing does not reveal whether a username exists', () => {
  it('runs exactly one bcrypt comparison for an unknown user, as for a wrong password', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const spy = vi.spyOn(bcrypt, 'compareSync');
    const { user } = await auth.createAndLoginUser(app);
    spy.mockClear();
    const unknown = await request(app).post('/api/auth/login').send({ username: `nobody-${crypto.randomUUID()}`, password: 'whatever-password-1' });
    const unknownCalls = spy.mock.calls.length;
    spy.mockClear();
    const wrong = await request(app).post('/api/auth/login').send({ username: user.username, password: 'wrong-password-123' });
    const wrongCalls = spy.mock.calls.length;
    spy.mockRestore();
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(unknownCalls).toBe(1);
    expect(wrongCalls).toBe(1);
  });

  it('rejects non-text credentials with 400 instead of crashing', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: { $ne: '' }, password: ['x'] });
    expect(r.status).toBe(400);
  });
});

describe('S2: public cluster status', () => {
  it('returns only availability, never the kubectl output (control-plane address)', async () => {
    const r = await request(app).get('/api/cluster/health');
    expect(r.status).toBe(200);
    expect(r.body.data.isAvailable).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/10\.1\.2\.3|control plane|6443/);
  });

  it('shares one cached probe: repeated requests do not spawn kubectl each time', async () => {
    const { K8sConnector } = await import('../../src/services/k8sConnector');
    K8sConnector.resetHealthCache();
    const before = kubectlCalls.filter((c) => c[1] === 'cluster-info').length;
    await Promise.all(Array.from({ length: 10 }, () => request(app).get('/api/cluster/health')));
    const after = kubectlCalls.filter((c) => c[1] === 'cluster-info').length;
    expect(after - before).toBe(1);
  });
});

describe('S3: public compute endpoints are rate limited per address', () => {
  it('answers 429 with Retry-After once the per-address limit is used up', async () => {
    const old = process.env.RATE_LIMIT_PUBLIC_MAX;
    process.env.RATE_LIMIT_PUBLIC_MAX = '2';
    const { buildRateLimiters, resetRateLimits } = await import('../../src/middleware/rateLimit');
    resetRateLimits();
    const limits = buildRateLimiters();
    process.env.RATE_LIMIT_PUBLIC_MAX = old;
    const mini = express();
    mini.post('/x', limits.publicCompute, (_req, res) => res.json({ ok: true }));
    expect((await request(mini).post('/x')).status).toBe(200);
    expect((await request(mini).post('/x')).status).toBe(200);
    const third = await request(mini).post('/x');
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
  });

  it('the real routes carry the limiter (headers present)', async () => {
    const sim = await request(app).post('/api/scheduler/simulate').send({ durationHours: 2, deadlineHours: 8, riskTolerance: 0.1 });
    expect(sim.headers['ratelimit-limit']).toBeDefined();
    const health = await request(app).get('/api/cluster/health');
    expect(health.headers['ratelimit-limit']).toBeDefined();
  });
});

describe('S4: unexpected errors are not leaked', () => {
  it('a controller failure returns a generic message with a reference, not the exception text', async () => {
    const spy = vi.spyOn(db, 'getRoadmapMilestones').mockImplementation(() => {
      throw new Error('ENOENT: C:\\secret\\path\\carbonroute.db.json internal detail');
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await request(app).get('/api/roadmap');
    spy.mockRestore();
    quiet.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/ENOENT|secret|internal detail/);
    expect(r.body.reference).toMatch(/^[0-9a-f]{8}$/);
  });

  it('malformed JSON is a 400 client error; an oversized JSON body is refused (413)', async () => {
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"username":');
    expect(bad.status).toBe(400);
    const big = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ username: 'x'.repeat(1_100_000), password: 'y' }));
    expect(big.status).toBe(413);
  });
});

describe('S7: password change', () => {
  it('requires the current password, enforces strength, and signs out every older token', async () => {
    const username = `pw-${crypto.randomBytes(4).toString('hex')}`;
    const original = crypto.randomBytes(18).toString('base64url');
    db.createUser({ username, email: `${username}@example.invalid`, password: original, role: 'student' });
    const login = async (password: string) => request(app).post('/api/auth/login').send({ username, password });
    const t1 = (await login(original)).body.token;
    const t2 = (await login(original)).body.token; // a second device
    const H = (t: string) => ({ Authorization: `Bearer ${t}` });

    expect((await request(app).post('/api/auth/password').send({ currentPassword: original, newPassword: 'x'.repeat(20) })).status).toBe(401); // no token
    expect((await request(app).post('/api/auth/password').set(H(t1)).send({ currentPassword: 'wrong-password-1', newPassword: 'another-strong-pass-1' })).status).toBe(401);
    expect((await request(app).post('/api/auth/password').set(H(t1)).send({ currentPassword: original, newPassword: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/password').set(H(t1)).send({ currentPassword: original, newPassword: original })).status).toBe(400);

    const next = crypto.randomBytes(18).toString('base64url');
    const ok = await request(app).post('/api/auth/password').set(H(t1)).send({ currentPassword: original, newPassword: next });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
    expect((await request(app).get('/api/auth/me').set(H(t1))).status).toBe(401); // this device's old token
    expect((await request(app).get('/api/auth/me').set(H(t2))).status).toBe(401); // the other device
    expect((await request(app).get('/api/auth/me').set(H(ok.body.token))).status).toBe(200); // the new token
    expect((await login(original)).status).toBe(401);
    expect((await login(next)).status).toBe(200);
  });
});

describe('S8: administrator-only account management', () => {
  it('ordinary users and anonymous callers cannot list or create accounts', async () => {
    const { auth: student } = await auth.createAndLoginUser(app, 'student');
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
    expect((await request(app).get('/api/admin/users').set(student)).status).toBe(403);
    expect((await request(app).post('/api/admin/users').set(student).send({ username: 'evil', email: 'e@x.y', password: 'x'.repeat(20) })).status).toBe(403);
  });

  it('an administrator creates an account that can sign in; no response ever contains a password hash', async () => {
    const adminToken = await auth.loginAsTestAdmin(app);
    const A = { Authorization: `Bearer ${adminToken}` };
    const username = `new-${crypto.randomBytes(4).toString('hex')}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const created = await request(app).post('/api/admin/users').set(A).send({ username, email: `${username}@example.invalid`, password, role: 'evaluator' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ username, role: 'evaluator' });
    const list = await request(app).get('/api/admin/users').set(A);
    expect(list.body.data.some((u: any) => u.username === username)).toBe(true);
    expect(JSON.stringify([created.body, list.body])).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect((await request(app).post('/api/auth/login').send({ username, password })).status).toBe(200);
    // Duplicates, weak passwords, invalid roles and non-text input are refused.
    expect((await request(app).post('/api/admin/users').set(A).send({ username, email: `${username}@example.invalid`, password })).status).toBe(400);
    expect((await request(app).post('/api/admin/users').set(A).send({ username: `${username}x`, email: 'z@example.invalid', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/admin/users').set(A).send({ username: `${username}y`, email: 'y@example.invalid', password, role: 'admin2' })).status).toBe(400);
    expect((await request(app).post('/api/admin/users').set(A).send({ username: ['a'], email: 'w@example.invalid', password })).status).toBe(400);
  });
});
