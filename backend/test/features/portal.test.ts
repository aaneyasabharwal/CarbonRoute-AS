/**
 * Behaviour that must be preserved (remediation plan, section B):
 * authentication, presentations, resources, team, roadmap, audit logs and file serving.
 * These are not tagged legacy: no audit finding requires changing this behaviour.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { loginAsTestAdmin, testAdminCredentials } from '../support/auth';

let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  token = await loginAsTestAdmin(app);
});

describe('authentication', () => {
  it('rejects a login with missing fields (400) and a wrong password (401)', async () => {
    const { username } = testAdminCredentials();
    expect((await request(app).post('/api/auth/login').send({ username })).status).toBe(400);
    expect(
      (await request(app).post('/api/auth/login').send({ username, password: 'wrong-password' })).status
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/login').send({ username: 'no-such-user', password: 'x' })).status
    ).toBe(401);
  });

  it('GET /api/auth/me requires a token and returns the user for a valid one', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(403);
    const me = await request(app).get('/api/auth/me').set(auth());
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ username: testAdminCredentials().username, role: 'admin' });
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  it('logout succeeds and is recorded in the admin-only audit log', async () => {
    expect((await request(app).post('/api/auth/logout').set(auth())).status).toBe(200);
    expect((await request(app).get('/api/admin/audit-logs')).status).toBe(401);
    const logs = await request(app).get('/api/admin/audit-logs').set(auth());
    expect(logs.status).toBe(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining(['USER_LOGIN', 'USER_LOGOUT'])
    );
  });
});

describe('presentations', () => {
  it('lists only published presentations publicly and drafts on request', async () => {
    const published = await request(app).get('/api/presentations');
    expect(published.body.data.every((p: { status: string }) => p.status === 'published')).toBe(true);
    const all = await request(app).get('/api/presentations/versions');
    expect(all.body.data.length).toBeGreaterThan(published.body.data.length);
  });

  // Intended behaviour behind the original tests/version_upload_test.js
  // (whose literal "upload v2" check is kept as it.fails in the legacy suite).
  it('rejects a duplicate version tag with 409 and leaves the existing version unchanged', async () => {
    const before = await request(app).get('/api/presentations/v/v2');
    const res = await request(app)
      .post('/api/presentations/upload')
      .set(auth())
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'Planning_Presentation_V2.pdf')
      .field('title', 'Planning Presentation V2')
      .field('versionTag', 'v2')
      .field('presentationDate', '2026-08-25');
    expect(res.status).toBe(409);
    const after = await request(app).get('/api/presentations/v/v2');
    expect(after.body.data).toEqual(before.body.data);
  });

  it('adds a new version with a SHA-256 checksum while v1 stays retrievable', async () => {
    const upload = await request(app)
      .post('/api/presentations/upload')
      .set(auth())
      .attach('file', Buffer.from('%PDF-1.4\n% test upload\n%%EOF'), 'Planning_Presentation_V9.pdf')
      .field('title', 'Planning Presentation V9 (test)')
      .field('versionTag', 'v9-test')
      .field('presentationDate', '2026-08-25')
      .field('changeSummary', 'Test upload');
    expect(upload.status).toBe(201);
    expect(upload.body.data.versionTag).toBe('v9-test');
    expect(upload.body.data.sha256Checksum).toMatch(/^[0-9a-f]{64}$/);

    expect((await request(app).get('/api/presentations/v/v1')).body.data.versionTag).toBe('v1');
    expect((await request(app).get('/api/presentations/v/v9-test')).body.data.versionTag).toBe('v9-test');
    const tags = (await request(app).get('/api/presentations/versions')).body.data.map(
      (p: { versionTag: string }) => p.versionTag
    );
    expect(tags).toEqual(expect.arrayContaining(['v1', 'v9-test']));
  });

  it('returns 404 for an unknown version tag', async () => {
    expect((await request(app).get('/api/presentations/v/does-not-exist')).status).toBe(404);
  });

  it('requires admin to update or delete a version, and supports both', async () => {
    const upload = await request(app)
      .post('/api/presentations/upload')
      .set(auth())
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), 'edit-me.pdf')
      .field('title', 'Editable')
      .field('versionTag', 'edit-test')
      .field('presentationDate', '2026-09-01');
    expect(upload.status).toBe(201);
    const id = upload.body.data.id;

    expect((await request(app).put(`/api/presentations/versions/${id}`).send({ title: 'x' })).status).toBe(401);
    const updated = await request(app).put(`/api/presentations/versions/${id}`).set(auth()).send({ title: 'Edited' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Edited');

    expect((await request(app).delete(`/api/presentations/versions/${id}`).set(auth())).status).toBe(200);
    expect((await request(app).get('/api/presentations/v/edit-test')).status).toBe(404);
  });

  it('rejects an upload without a file (400) and with a disallowed extension', async () => {
    const noFile = await request(app)
      .post('/api/presentations/upload')
      .set(auth())
      .field('title', 'No file')
      .field('versionTag', 'nofile')
      .field('presentationDate', '2026-09-01');
    expect(noFile.status).toBe(400);

    const badExt = await request(app)
      .post('/api/presentations/upload')
      .set(auth())
      .attach('file', Buffer.from('MZ'), 'malware.exe')
      .field('title', 'Bad')
      .field('versionTag', 'bad-ext')
      .field('presentationDate', '2026-09-01');
    expect(badExt.status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get('/api/presentations/v/bad-ext')).status).toBe(404);
  });
});

describe('resources and file serving', () => {
  it('uploads, serves (with checksum-stable bytes), updates and deletes a resource', async () => {
    const content = Buffer.from('{"hello":"carbonroute"}');
    const upload = await request(app)
      .post('/api/resources/upload')
      .set(auth())
      .attach('file', content, 'dataset.json')
      .field('title', 'Test dataset')
      .field('category', 'dataset');
    expect(upload.status).toBe(201);
    const resource = upload.body.data;
    expect(resource.format).toBe('json');

    const listed = await request(app).get('/api/resources');
    expect(listed.body.data.map((r: { id: string }) => r.id)).toContain(resource.id);

    const served = await request(app).get(resource.fileUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(served.status).toBe(200);
    expect(Buffer.compare(served.body as Buffer, content)).toBe(0);

    const download = await request(app).get(`${resource.fileUrl}?download=true`);
    expect(download.headers['content-disposition']).toContain('attachment');

    expect((await request(app).put(`/api/resources/${resource.id}`).send({ title: 'x' })).status).toBe(401);
    const updated = await request(app).put(`/api/resources/${resource.id}`).set(auth()).send({ title: 'Renamed' });
    expect(updated.body.data.title).toBe('Renamed');

    expect((await request(app).get('/api/resources/all')).status).toBe(401);
    expect((await request(app).get('/api/resources/all').set(auth())).status).toBe(200);

    expect((await request(app).delete(`/api/resources/${resource.id}`).set(auth())).status).toBe(200);
    expect((await request(app).delete(`/api/resources/${resource.id}`).set(auth())).status).toBe(404);
  });

  it('returns 404 for a missing stored file', async () => {
    expect((await request(app).get('/api/storage/resources/missing.pdf')).status).toBe(404);
  });
});

describe('team and roadmap', () => {
  // Intended behaviour behind the original team check in tests/api_integration_test.js.
  // The original compared exact first names and could never match; the API returns
  // full names, which is the correct behaviour. The original literal check is kept as
  // it.fails in test/legacy/apiIntegration.legacy.test.ts.
  it('team members are returned by full name, in display order', async () => {
    const res = await request(app).get('/api/team');
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { name: string }) => m.name)).toEqual([
      'Yuvika Nagpal',
      'Kumkum Gupta',
      'Aaneya Sabharwal',
    ]);
  });

  it('updates a team member only as admin', async () => {
    expect((await request(app).put('/api/team/team-1').send({ bio: 'x' })).status).toBe(401);
    const res = await request(app).put('/api/team/team-1').set(auth()).send({ bio: 'Updated bio' });
    expect(res.status).toBe(200);
    expect(res.body.data.bio).toBe('Updated bio');
    expect((await request(app).put('/api/team/no-such-member').set(auth()).send({ bio: 'x' })).status).toBe(404);
  });

  it('creates, updates, completes and deletes a roadmap task', async () => {
    const roadmap = await request(app).get('/api/roadmap');
    const phaseId: string = roadmap.body.data[0].id;

    expect((await request(app).post(`/api/roadmap/phases/${phaseId}/tasks`).send({ title: 't' })).status).toBe(401);
    const created = await request(app)
      .post(`/api/roadmap/phases/${phaseId}/tasks`)
      .set(auth())
      .send({ title: 'Test task' });
    expect(created.status).toBe(201);
    const taskId: string = created.body.data.task.id;

    expect((await request(app).get(`/api/roadmap/tasks/${taskId}`)).status).toBe(200);
    expect(
      (await request(app).put(`/api/roadmap/tasks/${taskId}`).set(auth()).send({ status: 'not-a-status' })).status
    ).toBe(400);
    expect(
      (await request(app).put(`/api/roadmap/tasks/${taskId}`).set(auth()).send({ status: 'in-progress' })).status
    ).toBe(200);
    expect((await request(app).patch(`/api/roadmap/tasks/${taskId}/complete`).set(auth()).send({})).status).toBe(200);
    const after = await request(app).get(`/api/roadmap/tasks/${taskId}`);
    expect(after.body.data.task.status).toBe('completed');

    expect((await request(app).delete(`/api/roadmap/tasks/${taskId}`).set(auth())).status).toBe(200);
    expect((await request(app).get(`/api/roadmap/tasks/${taskId}`)).status).toBe(404);
  });
});

describe('fallback routing', () => {
  it('returns a JSON 404 for an unknown API route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
