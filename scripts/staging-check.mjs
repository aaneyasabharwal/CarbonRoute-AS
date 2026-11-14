#!/usr/bin/env node
/**
 * Staging verification (P9). Runs the staging checklist against a deployed backend and prints
 * PASS/FAIL per check. It never prints passwords, tokens or keys.
 *
 * Usage (Node 18+, no dependencies):
 *   STAGING_ADMIN_PASSWORD=... node scripts/staging-check.mjs \
 *       --api https://carbonroute-staging-api.onrender.com \
 *       --origin https://carbonroute-staging-web.onrender.com \
 *       --admin <admin username> [--live DE] [--state staging-check.state.json]
 *
 *   After a restart or redeploy, check that the data persisted:
 *   STAGING_ADMIN_PASSWORD=... node scripts/staging-check.mjs --api ... --origin ... --admin ... \
 *       --verify-persisted --state staging-check.state.json
 *
 * It creates two student accounts (random names and passwords, discarded) and one job on the
 * synthetic demo trace (no provider call). --live <zone> adds one live forecast request.
 * The state file holds only the job id and usernames (no secrets); keep it out of the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const API = String(opt('api', '')).replace(/\/+$/, '').replace(/\/api$/, '');
const ORIGIN = String(opt('origin', '')).replace(/\/+$/, '');
const ADMIN = opt('admin', '');
const ADMIN_PASSWORD = process.env.STAGING_ADMIN_PASSWORD || '';
const STATE = opt('state', 'staging-check.state.json');
const LIVE = opt('live', '');
if (!API || !ORIGIN || !ADMIN || !ADMIN_PASSWORD) {
  console.error('Need --api, --origin, --admin and the STAGING_ADMIN_PASSWORD environment variable.');
  process.exit(2);
}
const base = `${API}/api`;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
};
async function call(path, { method = 'GET', token, body, origin } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON (HTML report) */
  }
  return { status: res.status, json, text, headers: res.headers };
}
const login = async (username, password) => (await call('/auth/login', { method: 'POST', body: { username, password } })).json?.token;

async function verifyPersisted() {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const admin = await login(ADMIN, ADMIN_PASSWORD);
  check('admin can sign in after the restart', !!admin);
  const users = await call('/admin/users', { token: admin });
  check('accounts created before the restart still exist', state.users.every((u) => users.json?.data?.some((x) => x.username === u)));
  const jobs = await call('/jobs', { token: admin });
  check('job created before the restart still exists', !!jobs.json?.data?.some((j) => j.id === state.jobId), state.jobId);
  const job = await call(`/jobs/${state.jobId}`, { token: admin });
  check('its decision is still stored', job.status === 200 && !!job.json?.data?.decision);
}

async function main() {
  if (flag('verify-persisted')) return verifyPersisted();

  const health = await call('/health');
  check('health 200', health.status === 200, health.json?.status);
  const allowed = await call('/health', { origin: ORIGIN });
  check('CORS: the staging frontend origin is allowed', allowed.headers.get('access-control-allow-origin') === ORIGIN);
  const evil = await call('/health', { origin: 'https://evil.example' });
  check('CORS: an unknown origin is not allowed', !evil.headers.get('access-control-allow-origin'));
  check('security headers (CSP) present', !!health.headers.get('content-security-policy'));
  check('jobs without a token -> 401', (await call('/jobs')).status === 401);
  check('wrong password -> 401', (await call('/auth/login', { method: 'POST', body: { username: ADMIN, password: `wrong-${crypto.randomUUID()}` } })).status === 401);

  const admin = await login(ADMIN, ADMIN_PASSWORD);
  if (!check('admin sign-in', !!admin)) return;
  const mk = async () => {
    const username = `check-${crypto.randomBytes(4).toString('hex')}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const r = await call('/admin/users', { method: 'POST', token: admin, body: { username, email: `${username}@example.org`, password, role: 'student' } });
    return { username, password, ok: r.status === 201 };
  };
  const a = await mk();
  const b = await mk();
  check('admin creates student accounts', a.ok && b.ok);
  const ta = await login(a.username, a.password);
  const tb = await login(b.username, b.password);
  check('students sign in', !!ta && !!tb);

  const deadlineAt = new Date(Date.now() + 14 * 3600_000).toISOString();
  const s = await call('/schedule', {
    method: 'POST',
    token: ta,
    body: { mode: 'demo', runtimeCv: 0.2, jobData: { name: 'staging-check', commandOrImage: 'busybox', isContainerImage: true, durationHours: 2, cpu: 1, memoryMb: 256, riskTolerance: 0.05, region: 'BENCHMARK-RESEARCH', deadlineAt } },
  });
  const d = s.json?.data;
  check('schedule (synthetic demo trace) -> RECOMMENDED', s.status === 200 && d?.status === 'RECOMMENDED', `${s.status} ${d?.status ?? s.json?.message ?? ''}`);
  check('5 policies evaluated with an explanation', d?.evaluatedPolicies?.length === 5 && !!d?.explanation?.summary);
  const jobId = d?.job?.id;
  check('job listed for its owner', !!(await call('/jobs', { token: ta })).json?.data?.some((j) => j.id === jobId));
  check("another student cannot read it (404)", (await call(`/jobs/${jobId}`, { token: tb })).status === 404);
  const rep = await call(`/jobs/${jobId}/report?format=html`, { token: ta });
  check('HTML report downloads', rep.status === 200 && /<html/i.test(rep.text));
  const disp = await call(`/jobs/${jobId}/dispatch`, { method: 'POST', token: ta, body: { simulatedDurationSec: 1 } });
  check('dispatch is labelled simulated (no cluster)', disp.status === 200 && /simulated/i.test(disp.json?.message || ''), disp.json?.data?.clusterMode);
  check('a second dispatch is refused (409)', (await call(`/jobs/${jobId}/dispatch`, { method: 'POST', token: ta, body: {} })).status === 409);

  const benches = await call('/results/benchmarks', { token: ta });
  check('benchmark results listed', benches.status === 200 && benches.json?.data?.length > 0, `${benches.json?.data?.length ?? 0} runs`);
  const ml = await call('/results/ml', { token: ta });
  check('model status listed (no invented accuracy)', ml.status === 200 && ml.json?.data?.length > 0, ml.json?.data?.[0]?.status);

  if (LIVE) {
    const f = await call(`/carbon/forecast?region=${encodeURIComponent(LIVE)}&mode=live`, { token: ta });
    check(`live Electricity Maps forecast for ${LIVE}`, f.status === 200 && f.json?.data?.dataClass === 'real', `${f.status} ${f.json?.data?.dataClass ?? f.json?.message ?? ''}`);
  }

  const newPassword = crypto.randomBytes(18).toString('base64url');
  const pw = await call('/auth/password', { method: 'POST', token: tb, body: { currentPassword: b.password, newPassword } });
  check('password change returns a new token', pw.status === 200 && !!pw.json?.token);
  check('the old token stops working', (await call('/jobs', { token: tb })).status === 401);
  check('the new token works', (await call('/jobs', { token: pw.json?.token })).status === 200);
  await call('/auth/logout', { method: 'POST', token: ta });
  check('logout revokes the token', (await call('/jobs', { token: ta })).status === 401);

  fs.writeFileSync(STATE, JSON.stringify({ api: API, jobId, users: [a.username, b.username], at: new Date().toISOString() }, null, 2));
  console.log(`\nState for --verify-persisted written to ${STATE} (job id and usernames only).`);
}

main()
  .catch((err) => {
    failed++;
    console.error('FAIL  unexpected error:', err.message);
  })
  .finally(() => {
    console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
    process.exitCode = failed ? 1 : 0;
  });
