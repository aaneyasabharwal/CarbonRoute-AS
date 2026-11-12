/**
 * Tests for src/services/api.ts (the frontend's only HTTP client).
 * fetch is always stubbed; no test reaches a real backend.
 */
import { describe, it, expect } from 'vitest';
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
  // Audit H4 -> task M2.5: the frontend fabricates a full scheduling result.
  it('simulateFeasibility returns success with a client-generated result', async () => {
    const res = await api.simulateFeasibility(2, 12, 0.1, 'US-CAL-CISO');
    expect(res.success).toBe(true);
    expect(res.data?.timeSlots).toHaveLength(12);
    expect(res.data?.feasibilityConclusion).toBeTruthy();
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
