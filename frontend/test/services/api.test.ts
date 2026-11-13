/**
 * Tests for src/services/api.ts (the frontend's only HTTP client).
 * fetch is always stubbed; no test reaches a real backend.
 */
import { describe, it, expect, vi } from 'vitest';
import { api, API_BASE, BACKEND_URL, resolveFileUrl, normalizePresentation } from '../../src/services/api';
import type { PresentationVersion } from '../../src/types';
import { stubFetch, bodyOf } from '../support/fetch';

describe('backend URL', () => {
  it('uses the local backend when the page is served from localhost', () => {
    // jsdom serves test pages from http://localhost:3000 by default.
    expect(window.location.hostname).toBe('localhost');
    expect(BACKEND_URL).toBe('http://localhost:5000');
    expect(API_BASE).toBe('http://localhost:5000/api');
  });
});

describe('resolveFileUrl', () => {
  it('returns an empty string when there is no file reference', () => {
    expect(resolveFileUrl()).toBe('');
    expect(resolveFileUrl('  ', ' ', '')).toBe('');
  });

  it('keeps absolute http(s) URLs unchanged', () => {
    expect(resolveFileUrl('https://cdn.example.org/a.pdf')).toBe('https://cdn.example.org/a.pdf');
    expect(resolveFileUrl('HTTP://cdn.example.org/a.pdf')).toBe('HTTP://cdn.example.org/a.pdf');
  });

  it('prefixes /api/storage/ URLs with the backend URL', () => {
    expect(resolveFileUrl('/api/storage/resources/x.json')).toBe(`${BACKEND_URL}/api/storage/resources/x.json`);
  });

  it('maps uploads/ and /uploads/ file paths to the storage API', () => {
    expect(resolveFileUrl('', 'uploads/presentations/p.pdf')).toBe(`${BACKEND_URL}/api/storage/presentations/p.pdf`);
    expect(resolveFileUrl('', '/uploads/resources/r.csv')).toBe(`${BACKEND_URL}/api/storage/resources/r.csv`);
  });

  it('falls back to the presentations folder for a bare file name or URL', () => {
    expect(resolveFileUrl('', '', 'uploads/presentations/deck.pdf')).toBe(`${BACKEND_URL}/api/storage/presentations/deck.pdf`);
    expect(resolveFileUrl('/deck.pdf')).toBe(`${BACKEND_URL}/api/storage/presentations/deck.pdf`);
  });

  it('normalizePresentation rewrites only fileUrl', () => {
    const p = { id: 'x', fileUrl: '', filePath: 'uploads/presentations/a.pdf', fileName: 'a.pdf', title: 'A' } as PresentationVersion;
    const n = normalizePresentation(p);
    expect(n.fileUrl).toBe(`${BACKEND_URL}/api/storage/presentations/a.pdf`);
    expect({ ...n, fileUrl: '' }).toEqual(p);
  });
});

describe('authentication', () => {
  it('login stores the token on success and sends the credentials as JSON', async () => {
    const fetchMock = stubFetch((url) =>
      url === `${API_BASE}/auth/login`
        ? { body: { success: true, token: 'tok-123', user: { id: 'u1', username: 'alice', role: 'admin' } } }
        : undefined
    );
    const res = await api.login('alice', 'pw');
    expect(res.success).toBe(true);
    expect(localStorage.getItem('carbonroute_token')).toBe('tok-123');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ username: 'alice', password: 'pw' });
  });

  it('login returns the backend message and stores nothing on 401', async () => {
    stubFetch(() => ({ status: 401, body: { success: false, message: 'Invalid credentials.' } }));
    const res = await api.login('alice', 'wrong');
    expect(res).toEqual({ success: false, message: 'Invalid credentials.' });
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('login reports a network failure instead of throwing', async () => {
    const res = await api.login('alice', 'pw');
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/disabled in tests/);
  });

  it('getMe does not call the backend without a token', async () => {
    const res = await api.getMe();
    expect(res.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('getMe sends the bearer token and returns the user', async () => {
    localStorage.setItem('carbonroute_token', 'tok-abc');
    const fetchMock = stubFetch(() => ({ body: { success: true, user: { id: 'u1', username: 'alice', role: 'admin' } } }));
    const res = await api.getMe();
    expect(res.user?.username).toBe('alice');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
  });

  it('getMe clears an invalid token', async () => {
    localStorage.setItem('carbonroute_token', 'expired');
    stubFetch(() => ({ status: 403, body: { success: false } }));
    expect((await api.getMe()).success).toBe(false);
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });

  it('logout clears the token even when the backend is unreachable', async () => {
    localStorage.setItem('carbonroute_token', 'tok');
    expect((await api.logout()).success).toBe(true);
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
  });
});

describe('scheduling API calls', () => {
  it('scheduleJob posts the job and defaults to live mode', async () => {
    const fetchMock = stubFetch((url, init) =>
      url === `${API_BASE}/schedule` && init?.method === 'POST' ? { body: { success: true, data: { ok: 1 } } } : undefined
    );
    const res = await api.scheduleJob({ jobData: { name: 'j' } });
    expect(res.success).toBe(true);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ jobData: { name: 'j' }, mode: 'live' });
  });

  it('scheduleJob passes through the backend error (e.g. missing live data)', async () => {
    stubFetch(() => ({ status: 503, body: { success: false, message: 'Live carbon forecast unavailable: no key.' } }));
    const res = await api.scheduleJob({ jobData: { name: 'j' }, mode: 'live' });
    expect(res).toEqual({ success: false, message: 'Live carbon forecast unavailable: no key.' });
  });

  it('getCarbonForecast sends region and mode as query parameters', async () => {
    const fetchMock = stubFetch(() => ({ body: { success: true, data: {} } }));
    await api.getCarbonForecast('DE', 'demo');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE}/carbon/forecast?region=DE&mode=demo`);
  });

  it('job ids are URL-encoded', async () => {
    const fetchMock = stubFetch(() => ({ body: { success: true, data: {} } }));
    await api.getJobStatus('job/../x');
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE}/jobs/job%2F..%2Fx/status`);
  });

  it('getResources returns an empty list, not invented items, when the backend is unreachable', async () => {
    expect(await api.getResources()).toEqual({ success: true, data: [] });
  });
});

/**
 * [legacy] Behaviour recorded as it is today. Each block names the audit finding
 * or new observation, and the task expected to change it. Do not edit these
 * assertions except in the PR that intentionally changes the behaviour.
 */
describe('[legacy] client-side fallbacks when the backend is unreachable', () => {
  // Audit H4 -> task M2.5 (done in P1): the frontend used to fabricate a full scheduling
  // result when the backend was unreachable. The original assertion is kept as it.fails.
  it.fails('[original check, fails] simulateFeasibility returns success with a client-generated result', async () => {
    const res = await api.simulateFeasibility(2, 12, 0.1, 'US-CAL-CISO');
    expect(res.success).toBe(true);
    expect(res.data?.timeSlots).toHaveLength(12);
    expect(res.data?.feasibilityConclusion).toBeTruthy();
  });

  it('simulateFeasibility reports failure instead of inventing a result (M2.5)', async () => {
    const res = await api.simulateFeasibility(2, 12, 0.1, 'US-CAL-CISO');
    expect(res.success).toBe(false);
    expect(res.data).toBeUndefined();
    expect(res.message).toBeTruthy();
  });

  // New observation (not in the original audit): built-in presentation records,
  // including hardcoded SHA-256 checksums, are shown as if they came from the backend.
  it('getPresentations returns built-in records with hardcoded checksums', async () => {
    const res = await api.getPresentations();
    expect(res.success).toBe(true);
    expect(res.data!.length).toBeGreaterThan(0);
    expect((res.data![0] as PresentationVersion).sha256Checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  // New observation: built-in team list (roles differ from the backend's seeded roles).
  it('getTeam returns a built-in team list', async () => {
    const res = await api.getTeam();
    expect(res.success).toBe(true);
    expect(res.data!.map((m) => m.name)).toEqual(['Yuvika Nagpal', 'Aaneya Sabharwal', 'Kumkum Gupta']);
  });

  it('getRoadmap returns a built-in roadmap', async () => {
    const res = await api.getRoadmap();
    expect(res.success).toBe(true);
    expect(res.data!.length).toBeGreaterThan(0);
  });

  // New observation: updateTeamMember never calls the backend, so edits are not saved.
  it('updateTeamMember reports success without any request', async () => {
    const res = await api.updateTeamMember('team-2', { bio: 'changed' });
    expect(res.success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('job requests are authenticated (M1.2)', () => {
  const header = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers).get('Authorization');

  it('every job, schedule and experiment call sends the stored token', async () => {
    localStorage.setItem('carbonroute_token', 'tok-1');
    const fetchMock = stubFetch(() => ({ body: { success: true, data: {} } }));
    await api.submitJob({ name: 'j' });
    await api.scheduleJob({ jobData: { name: 'j' } });
    await api.dispatchJob('job-1');
    await api.getJobStatus('job-1');
    await api.getJobResults('job-1');
    await api.getJobManifest('job-1', 2);
    await api.collectObservations('job-1');
    await api.recordExperiment({ note: 'x' });
    await api.getExperiments();
    expect(fetchMock.mock.calls).toHaveLength(9);
    for (const call of fetchMock.mock.calls) expect(header(call)).toBe('Bearer tok-1');
    localStorage.removeItem('carbonroute_token');
  });

  it('a 401 is reported as "sign in required" and a rejected token is removed', async () => {
    localStorage.setItem('carbonroute_token', 'expired');
    stubFetch(() => ({
      status: 401,
      body: { success: false, code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' },
    }));
    const res = await api.scheduleJob({ jobData: { name: 'j' } });
    expect(res).toEqual({ success: false, authRequired: true, message: 'Your session has expired. Please sign in again.' });
    expect(localStorage.getItem('carbonroute_token')).toBeNull();
    expect(api.hasSession()).toBe(false);
  });

  it('without any token the message asks the user to sign in', async () => {
    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED', message: 'Authentication required. Sign in ...' } }));
    const res = await api.getJobStatus('job-1');
    expect(res.authRequired).toBe(true);
    expect(res.message).toMatch(/^Sign in to schedule and inspect jobs/);
  });

  it('a job the user may not access is a plain failure (404), not a sign-in prompt', async () => {
    localStorage.setItem('carbonroute_token', 'tok-2');
    stubFetch(() => ({ status: 404, body: { success: false, code: 'JOB_NOT_FOUND', message: 'Job not found.' } }));
    const res = await api.getJobStatus('job-x');
    expect(res).toEqual({ success: false, message: 'Job not found.' });
    expect(localStorage.getItem('carbonroute_token')).toBe('tok-2');
    localStorage.removeItem('carbonroute_token');
  });

  it('downloadReport fetches the report with the token and saves it as a file', async () => {
    localStorage.setItem('carbonroute_token', 'tok-3');
    const fetchMock = stubFetch(() => ({ body: { success: true, data: { jobId: 'job-1' } } }));
    const createUrl = vi.fn(() => 'blob:report');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const res = await api.downloadReport('job-1', 'json');
    expect(res.success).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${API_BASE}/jobs/job-1/report`);
    expect(header(fetchMock.mock.calls[0])).toBe('Bearer tok-3');
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    localStorage.removeItem('carbonroute_token');
  });

  it('downloadReport asks the user to sign in on 401', async () => {
    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED' } }));
    const res = await api.downloadReport('job-1', 'html');
    expect(res.authRequired).toBe(true);
  });
});

describe('live carbon data requires sign-in (P0/F9)', () => {
  const header = (call: unknown[]) => new Headers((call[1] as RequestInit | undefined)?.headers).get('Authorization');

  it('forecast and region requests send the stored token', async () => {
    localStorage.setItem('carbonroute_token', 'tok-live');
    const fetchMock = stubFetch(() => ({ body: { success: true, data: [] } }));
    await api.getCarbonForecast('DE', 'live');
    await api.getCarbonRegions('live');
    for (const call of fetchMock.mock.calls) expect(header(call)).toBe('Bearer tok-live');
    localStorage.removeItem('carbonroute_token');
  });

  it('a 401 on live data asks the user to sign in and mentions demo mode', async () => {
    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED', message: 'Authentication required. Sign in ...' } }));
    const res = await api.getCarbonForecast('DE', 'live');
    expect(res.authRequired).toBe(true);
    expect(res.message).toMatch(/Sign in to use live Electricity Maps data/);
    expect(res.message).toMatch(/Demo mode works without signing in/);
    const regions = await api.getCarbonRegions('live');
    expect(regions.authRequired).toBe(true);
  });
});

describe('P4 job and results calls', () => {
  it('send the token, report 401 as sign-in, and never invent data when the backend is unreachable', async () => {
    localStorage.setItem('carbonroute_token', 'tok-p4');
    const fetchMock = stubFetch(() => ({ body: { success: true, data: [] } }));
    await api.listJobs({ status: 'scheduled' });
    await api.getJobDetails('job-1');
    await api.cancelJob('job-1');
    await api.getJobOracle('job-1');
    await api.listBenchmarks();
    await api.getBenchmark('benchmark-x');
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      `${API_BASE}/jobs?status=scheduled`,
      `${API_BASE}/jobs/job-1`,
      `${API_BASE}/jobs/job-1/cancel`,
      `${API_BASE}/jobs/job-1/oracle`,
      `${API_BASE}/results/benchmarks`,
      `${API_BASE}/results/benchmarks/benchmark-x`,
    ]);
    for (const c of fetchMock.mock.calls) expect(new Headers((c[1] as RequestInit).headers).get('Authorization')).toBe('Bearer tok-p4');

    stubFetch(() => ({ status: 401, body: { success: false, code: 'UNAUTHENTICATED', message: 'Authentication required.' } }));
    expect((await api.listJobs()).authRequired).toBe(true);

    stubFetch(() => undefined); // unreachable backend
    for (const res of [await api.listJobs(), await api.getJobDetails('x'), await api.listBenchmarks()]) {
      expect(res.success).toBe(false);
      expect(res.data).toBeUndefined();
    }
    localStorage.removeItem('carbonroute_token');
  });
});
