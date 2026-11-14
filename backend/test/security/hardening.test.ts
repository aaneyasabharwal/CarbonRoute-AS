/**
 * P0 security hardening regression tests:
 *  S1  storage path traversal (M1.5)
 *  F10 Kubernetes manifest / command injection (M1.4)
 *  F11 login and job-submission rate limits (M1.8)
 *  F9  live carbon-data quota protection
 *  M1.6 CORS allow-list, M1.7 Content-Security-Policy / frame-ancestors
 *
 * Low rate limits are set below and the app is imported afterwards, so this file has its own
 * limits; the other suites run with generous ones (see test/support/testEnv.ts).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const kubectlCalls: { args: string[]; manifest?: any }[] = [];
let clusterAvailable = false;
vi.mock('child_process', () => ({
  exec: (_cmd: string, cb: (err: Error | null) => void) => cb(new Error('exec must not be used')),
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    const call: { args: string[]; manifest?: any } = { args: [file, ...args] };
    if (args[0] === 'apply') call.manifest = JSON.parse(require('fs').readFileSync(args[2], 'utf8'));
    kubectlCalls.push(call);
    if (args[0] === 'cluster-info') return clusterAvailable ? cb(null, { stdout: 'ok', stderr: '' }) : cb(new Error('no cluster'));
    if (args[0] === 'apply' || args[0] === 'delete') return cb(null, { stdout: '', stderr: '' });
    return cb(new Error('not simulated'));
  },
}));

process.env.RATE_LIMIT_LOGIN_MAX = '3';
process.env.RATE_LIMIT_LOGIN_IP_MAX = '6';
process.env.RATE_LIMIT_JOBS_MAX = '4';
process.env.RATE_LIMIT_CARBON_MAX = '2';
process.env.CORS_ORIGIN = 'https://app.example.org, https://staging.example.org/';

let app: Express;
let db: typeof import('../../src/models/db').db;
let K8sConnector: typeof import('../../src/services/k8sConnector').K8sConnector;
let validateWorkloadSpec: typeof import('../../src/services/workloadSpec').validateWorkloadSpec;
let safeStorageRef: typeof import('../../src/storage/storageProvider').safeStorageRef;

async function newUser(): Promise<{ Authorization: string }> {
  const username = `hard-${crypto.randomBytes(4).toString('hex')}`;
  const password = crypto.randomBytes(18).toString('base64url');
  db.createUser({ username, email: `${username}@example.invalid`, password, role: 'student' });
  const res = await request(app).post('/api/auth/login').set('X-Test-Client', username).send({ username, password });
  expect(res.status).toBe(200);
  return { Authorization: `Bearer ${res.body.token}` };
}

beforeAll(async () => {
  vi.resetModules();
  app = (await import('../../src/app')).default;
  db = (await import('../../src/models/db')).db;
  K8sConnector = (await import('../../src/services/k8sConnector')).K8sConnector;
  validateWorkloadSpec = (await import('../../src/services/workloadSpec')).validateWorkloadSpec;
  safeStorageRef = (await import('../../src/storage/storageProvider')).safeStorageRef;
});

describe('S1: storage path traversal', () => {
  it('rejects unknown categories and path-like names with a plain 404 and never returns the database', async () => {
    const dbFile = process.env.CARBONROUTE_DB_FILE!;
    expect(fs.existsSync(dbFile)).toBe(true);
    const attempts = [
      '/api/storage/..%2Fdatabase/carbonroute.db.json',
      '/api/storage/..%2F..%2Fdatabase/carbonroute.db.json',
      '/api/storage/%2E%2E%2Fdatabase/carbonroute.db.json',
      '/api/storage/..%5Cdatabase/carbonroute.db.json',
      '/api/storage/presentations/..%2F..%2Fdatabase%2Fcarbonroute.db.json',
      '/api/storage/presentations/%2E%2E',
      '/api/storage/database/carbonroute.db.json',
      `/api/storage/presentations/${encodeURIComponent(dbFile)}`,
    ];
    for (const url of attempts) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.text).not.toMatch(/passwordHash|activityLogs/);
    }
  });

  it('safeStorageRef accepts only allow-listed categories and single-segment names', () => {
    expect(safeStorageRef('presentations', 'deck-v1.pdf')).toEqual({ category: 'presentations', fileName: 'deck-v1.pdf' });
    for (const [c, n] of [
      ['uploads', 'a.pdf'],
      ['..', 'a.pdf'],
      ['presentations', '../a.pdf'],
      ['presentations', '..'],
      ['resources', 'a\\b.pdf'],
      ['resources', 'a\nb.pdf'],
      ['resources', ''],
    ]) {
      expect(() => safeStorageRef(c, n), `${c}/${n}`).toThrow();
    }
  });
});

describe('F10: workload and manifest injection', () => {
  const injected = 'busybox"\n        securityContext:\n          privileged: true\n#';

  it('rejects images and commands that could alter the manifest or contain control characters', () => {
    expect(() => validateWorkloadSpec({ commandOrImage: injected, isContainerImage: true })).toThrow(/control characters/);
    expect(() => validateWorkloadSpec({ commandOrImage: 'busybox; rm -rf /', isContainerImage: true })).toThrow(/Invalid container image/);
    expect(() => validateWorkloadSpec({ commandOrImage: 'Ubuntu:latest', isContainerImage: true })).toThrow(/Invalid container image/);
    expect(() => validateWorkloadSpec({ commandOrImage: 'x'.repeat(2001), isContainerImage: false })).toThrow(/at most/);
    for (const ok of ['busybox', 'ghcr.io/org/app:1.0', 'localhost:5000/team/job_runner:v2', `alpine@sha256:${'a'.repeat(64)}`]) {
      expect(() => validateWorkloadSpec({ commandOrImage: ok, isContainerImage: true }), ok).not.toThrow();
    }
  });

  it('the API refuses an injected workload with 400 when registering or scheduling', async () => {
    const auth = await newUser();
    const job = await request(app).post('/api/jobs').set(auth).send({ name: 'x', commandOrImage: injected, isContainerImage: true });
    expect(job.status).toBe(400);
    expect(job.body.code).toBe('INVALID_WORKLOAD');
    const deadlineAt = new Date(Date.now() + 10 * 3600_000).toISOString();
    const sched = await request(app)
      .post('/api/schedule')
      .set(auth)
      .send({ mode: 'demo', jobData: { name: 'x', commandOrImage: 'evil image', isContainerImage: true, durationHours: 1, cpu: 1, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } });
    expect(sched.status).toBe(400);
  });

  it('a command is one argv element; an image keeps its entrypoint; the pod is restricted', () => {
    const cmd = K8sConnector.generateJobManifest({ id: 'job-cmd', commandOrImage: 'echo "$(id)" && exit 0', isContainerImage: false, cpu: 1, memoryMb: 64 });
    const c = cmd.spec.template.spec.containers[0];
    expect(c.command).toEqual(['sh', '-c', 'echo "$(id)" && exit 0']);
    expect(c.securityContext).toEqual({ privileged: false, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } });
    expect(cmd.spec.template.spec.automountServiceAccountToken).toBe(false);

    const img = K8sConnector.generateJobManifest({ id: 'job-img', commandOrImage: 'ghcr.io/org/app:1.0', isContainerImage: true, cpu: 1, memoryMb: 64 });
    expect(img.spec.template.spec.containers[0].image).toBe('ghcr.io/org/app:1.0');
    expect(img.spec.template.spec.containers[0].command).toBeUndefined();
  });

  it('on a live cluster kubectl gets argument arrays and a JSON manifest equal to the builder output', async () => {
    clusterAvailable = true;
    kubectlCalls.length = 0;
    const job = { id: 'job-live1', commandOrImage: 'echo "a b" ; echo $HOME', isContainerImage: false, cpu: 1, memoryMb: 64 };
    await K8sConnector.dispatchJob(job, { predictedCarbon: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const apply = kubectlCalls.find((c) => c.args[1] === 'apply')!;
    expect(apply.args.slice(0, 3)).toEqual(['kubectl', 'apply', '-f']);
    expect(apply.args[3]).toMatch(/\.json$/);
    expect(apply.manifest).toEqual(K8sConnector.generateJobManifest(job, 0, 'carbonroute-job-live1'));
    expect(apply.manifest.spec.template.spec.containers[0].command).toEqual(['sh', '-c', job.commandOrImage]);
    await K8sConnector.cancelExecution('job-live1', 'test-cleanup');
    clusterAvailable = false;
  });

  it('the connector source no longer builds YAML or shell command strings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'services', 'k8sConnector.ts'), 'utf8');
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/execAsync/);
    expect(src).not.toMatch(/apiVersion: batch\/v1\n/);
  });
});

describe('F11: rate limits', () => {
  it('login: an account is locked after RATE_LIMIT_LOGIN_MAX attempts per window, with Retry-After', async () => {
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 4; i++) {
      last = await request(app).post('/api/auth/login').send({ username: 'target-account', password: `guess-${i}` });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect(last!.body.code).toBe('RATE_LIMITED');
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('login: the per-address limit stops guessing across many usernames', async () => {
    const { resetRateLimits } = await import('../../src/middleware/rateLimit');
    resetRateLimits();
    // Each username is tried once (under its own limit of 3); the address limit is 6.
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(app).post('/api/auth/login').send({ username: `spray-${i}`, password: 'x' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429]);
  });

  it('job writes are limited per user', async () => {
    const { resetRateLimits } = await import('../../src/middleware/rateLimit');
    resetRateLimits();
    const auth = await newUser();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(app).post('/api/jobs').set(auth).send({ name: `j${i}`, commandOrImage: 'busybox', isContainerImage: true })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 429]);
  });
});

describe('F9: live carbon data needs sign-in, is rate limited and has a call budget', () => {
  it('live routes answer 401 without a token; demo mode stays public', async () => {
    for (const url of ['/api/carbon/forecast?region=DE', '/api/carbon/regions', '/api/carbon/latest?zone=DE', '/api/carbon/history?zone=DE', '/api/carbon/forecast/snapshot?zone=DE', '/api/carbon/power-breakdown?zone=DE']) {
      expect((await request(app).get(url)).status, url).toBe(401);
    }
    expect((await request(app).get('/api/carbon/regions?mode=demo')).status).toBe(200);
    expect((await request(app).get('/api/carbon/forecast?region=DE&mode=demo&horizon=6')).status).toBe(200);
  });

  it('signed-in users are limited per window (no key in tests, so allowed calls fail upstream with 503)', async () => {
    const { resetRateLimits } = await import('../../src/middleware/rateLimit');
    resetRateLimits();
    const auth = await newUser();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(app).get('/api/carbon/latest?zone=DE').set(auth)).status);
    expect(statuses).toEqual([503, 503, 429]);
  });

  it('the provider client stops at its hourly budget; cache hits are free', async () => {
    const { ElectricityMapsClient } = await import('../../src/carbon/electricityMaps');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ zone: 'DE', carbonIntensity: 100, datetime: '2026-11-13T10:00:00.000Z', isEstimated: false }), { status: 200 }));
    const client = new ElectricityMapsClient({ apiKey: 'test-key-not-real', fetchImpl: fetchImpl as any, maxCallsPerHour: 2, maxRetries: 0 });
    await client.getLatest('DE');
    await client.getLatest('DE'); // cached
    await client.getLatest('FR');
    await expect(client.getLatest('GB')).rejects.toMatchObject({ code: 'QUOTA_GUARD', apiStatus: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.callBudget()).toMatchObject({ lastHour: 2, maxPerHour: 2 });
  });

  it('provider status shows the budget without any secret', async () => {
    const res = await request(app).get('/api/carbon/provider');
    expect(res.body.data.callBudget).toMatchObject({ maxPerHour: expect.any(Number), maxPerDay: expect.any(Number) });
  });
});

describe('M1.6 / M1.7: CORS allow-list and security headers', () => {
  it('only allow-listed origins get CORS headers; requests without an Origin still work', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'https://app.example.org');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.org');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const trailing = await request(app).get('/api/health').set('Origin', 'https://staging.example.org');
    expect(trailing.headers['access-control-allow-origin']).toBe('https://staging.example.org');
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('sends a Content-Security-Policy whose frame-ancestors are this origin and the allow-list', async () => {
    const res = await request(app).get('/api/health');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'self' https:\/\/app\.example\.org https:\/\/staging\.example\.org/);
    expect(csp).not.toMatch(/frame-ancestors[^;]*\*/);
  });
});
